import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createController } from '../ui/controller.mjs';
import { createFakeClient, ok, businessError } from './support/fake-host.mjs';

const snapshot = JSON.parse(await readFile(new URL('./fixtures/1688-detail-snapshot.json', import.meta.url), 'utf8'));
const SOURCE = 'https://detail.1688.com/offer/826500000001.html';

const ROUTES = {
  '/open-api/goods/product/check-supplierSku-repeated': () => ok({ repeated_supplier_sku_list: [] }),
  '/open-api/goods/product/check-publish-permission': () => ok({ can_publish: true }),
  '/open-api/goods-publish-quotas/detail': () => ok({ remaining_quota: 10, total_quota: 20 }),
  '/open-api/goods/upload-pic': () => ok({ image_url: 'https://img.shein.test/p.jpg' }),
  '/open-api/goods/product/publishOrEdit': () => ok({ spu_name: 'SPU-1', skc_list: [{ skc_name: 'SKC-1' }], sku_list: [{ sku_code: 'SKU-1' }] })
};

function routeOverrides(overrides = {}) {
  return options => {
    const path = new URL(options.url).pathname;
    const handler = overrides[path] ?? ROUTES[path];
    if (!handler) throw new Error('未预期的请求：' + path);
    return typeof handler === 'function' ? handler(options) : handler;
  };
}

function networkPaths(calls) {
  return calls.network.map(options => new URL(options.url).pathname);
}

async function readyController(overrides = {}) {
  const fake = createFakeClient({ snapshot, respond: routeOverrides(overrides) });
  const controller = createController({ client: fake.client, now: () => 1760000000000 });
  await controller.load();
  await controller.saveSettings({ openKeyId: 'KEYID', provider: 'openai' });
  await controller.setSecret('shein-secret-key', 'secret-value');
  return { ...fake, controller };
}

function patchFor(draft) {
  return {
    product: {
      ...draft.product,
      title: { ...draft.product.title, en: 'Cotton knit winter scarf for couples' },
      bullets: [{ en: 'Soft cotton knit' }, { en: 'Thick winter warmth' }],
      description: { ...draft.product.description, en: 'A soft cotton scarf for winter.' },
      category: { ...draft.product.category, sheinCategoryId: '1234', sheinProductTypeId: '5678', confirmed: true },
      images: [{ id: 'img-1', role: 'main', token: 'file-img', name: 'main.jpg', size: 102400, mime: 'image/jpeg', width: 1000, height: 1000, excluded: false, uploadedUrl: '' }],
      skus: draft.product.skus.map(sku => ({ ...sku, colorEn: sku.color === '米白' ? 'Cream' : 'Black' }))
    }
  };
}

async function collected(controller) {
  const draft = await controller.collect(SOURCE);
  const saved = await controller.saveDraft(draft.id, patchFor(draft));
  assert.equal(saved.status, 'review');
  return saved;
}

test('采集链接后生成草稿，并把标签页归属记在草稿上', async () => {
  const { controller, calls } = await readyController();
  const draft = await controller.collect(SOURCE);
  assert.equal(draft.status, 'collected');
  assert.equal(draft.source.price, 12.5);
  assert.match(draft.source.tabId, /^tab-/);
  assert.ok(calls.browser.some(([name]) => name === 'snapshot'));
  await assert.rejects(() => controller.collect('https://www.taobao.com/item/1'), /1688/);
});

test('未点确认时提交直接被拒绝，发品网关零调用', async () => {
  const { controller, calls } = await readyController();
  const draft = await collected(controller);
  await assert.rejects(() => controller.submit(draft.id), /确认/);
  await assert.rejects(() => controller.submit(draft.id, { confirm: false }), /确认/);
  assert.equal(calls.network.length, 0);
});

test('确认后只发一次品，签名头与幂等键正确', async () => {
  const { controller, calls } = await readyController();
  const draft = await collected(controller);
  const submitted = await controller.submit(draft.id, { confirm: true });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.submission.spuName, 'SPU-1');
  assert.equal(submitted.submission.key, draft.product.skus[0].supplierSku);

  assert.deepEqual(networkPaths(calls), [
    '/open-api/goods/product/check-supplierSku-repeated',
    '/open-api/goods/product/check-publish-permission',
    '/open-api/goods-publish-quotas/detail',
    '/open-api/goods/upload-pic',
    '/open-api/goods/product/publishOrEdit'
  ]);
  const publishCall = calls.network.at(-1);
  assert.equal(publishCall.headers['x-lt-openKeyId'], 'KEYID');
  assert.ok(publishCall.headers['x-lt-signature'].length > 5);
  assert.equal(publishCall.json.skc_list[0].sku_list[0].supplier_sku, draft.product.skus[0].supplierSku);
  assert.equal(publishCall.json.skc_list[0].sku_list[0].supplier_price, 16.88);
});

test('重复供货 SKU 在发品前被拦下', async () => {
  const { controller, calls } = await readyController({
    '/open-api/goods/product/check-supplierSku-repeated': () => ok({ repeated_supplier_sku_list: ['DTEST-01'] })
  });
  const draft = await collected(controller);
  await assert.rejects(() => controller.submit(draft.id, { confirm: true }), /已存在/);
  assert.deepEqual(networkPaths(calls), ['/open-api/goods/product/check-supplierSku-repeated']);
});

test('发品失败保留未确认状态，重试必须先核对后台', async () => {
  let attempt = 0;
  const { controller, storage } = await readyController({
    '/open-api/goods/product/publishOrEdit': () => {
      attempt += 1;
      if (attempt === 1) return businessError(50001, '网关超时');
      return ok({ spu_name: 'SPU-2' });
    }
  });
  const draft = await collected(controller);
  await assert.rejects(() => controller.submit(draft.id, { confirm: true }), /网关超时/);
  const failed = controller.find(draft.id);
  assert.equal(failed.status, 'review');
  assert.equal(failed.submission.pending, true);
  assert.equal(failed.submission.spuName, undefined);
  assert.match(failed.submission.error, /网关超时/);
  assert.equal(storage.get('drafts')[0].submission.pending, true);

  await assert.rejects(() => controller.submit(draft.id, { confirm: true }), /核对/);
  const retried = await controller.submit(draft.id, { confirm: true, retryUnverified: true });
  assert.equal(retried.status, 'submitted');
  assert.equal(retried.submission.spuName, 'SPU-2');
  assert.equal(attempt, 2);
});

test('图片转存只用草稿自己的标签页，不会串到其它草稿', async () => {
  const { controller, calls, tabs, storage } = await readyController();
  const first = await controller.collect(SOURCE);
  const second = await controller.collect('https://detail.1688.com/offer/826500000002.html');
  assert.notEqual(first.source.tabId, second.source.tabId);

  await controller.prepareImages(first.id);
  const usedTabs = new Set(calls.resources.map(options => options.tabId));
  assert.deepEqual([...usedTabs], [first.source.tabId]);

  // 模拟历史草稿：early 版本没有记录 tabId，必须重新打开自己的来源页，
  // 而不是借用另一条草稿正在用的标签页。
  const stored = storage.get('drafts').map(item => item.id === second.id ? { ...item, source: { ...item.source, tabId: '' } } : item);
  storage.set('drafts', stored);
  await controller.load();
  const before = calls.browser.filter(([name]) => name === 'open').length;
  await controller.prepareImages(second.id);
  const opened = calls.browser.filter(([name]) => name === 'open');
  assert.equal(opened.length, before + 1);
  assert.equal(opened.at(-1)[1], 'https://detail.1688.com/offer/826500000002.html');
  assert.equal(tabs.length, 3);
  assert.equal(controller.find(second.id).source.tabId, tabs.at(-1).id);
});

test('驳回后保存草稿不会自动回到待审核', async () => {
  const { controller } = await readyController({
    '/open-api/goods/query-document-state': () => ok({ document_state: '3', reject_reason: '主图不清晰' })
  });
  const draft = await collected(controller);
  await controller.submit(draft.id, { confirm: true });
  const rejected = await controller.poll(draft.id);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.submission.rejectedReason, '主图不清晰');

  const saved = await controller.saveDraft(draft.id, { product: { ...rejected.product } });
  assert.equal(saved.status, 'rejected');
  const resumed = await controller.resume(draft.id);
  assert.equal(resumed.status, 'review');
});

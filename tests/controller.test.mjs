import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCipheriv } from 'node:crypto';
import { createController } from '../ui/controller.mjs';
import { createFakeClient, ok, businessError } from './support/fake-host.mjs';

const snapshot = JSON.parse(await readFile(new URL('./fixtures/1688-detail-snapshot.json', import.meta.url), 'utf8'));
const SOURCE = 'https://detail.1688.com/offer/826500000001.html';

const APP_ID = '10ADAABD6E000B247A428884951B4';
const APP_SECRET = '50CBFA17A9C3423EB14608B481DF364F';

// 希音把店铺 secretKey 用 APP_SecretKey 前 16 字节做 AES-128-CBC 加密后下发。
function encryptSecret(text, appSecretKey = APP_SECRET) {
  const key = Buffer.from(appSecretKey, 'utf8').subarray(0, 16);
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.from('space-station-de', 'utf8'));
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

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
  await controller.saveSettings({ openKeyId: 'KEYID' });
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

test('1688 原文可编辑，标题翻译只写英文标题并保存到草稿', async () => {
  const { controller, calls, storage } = await readyController();
  const draft = await controller.collect(SOURCE);
  const edited = await controller.saveDraft(draft.id, { product: { title: { zh: '定制中文标题', en: '' } } });
  assert.equal(edited.product.title.zh, '定制中文标题');

  const saved = await controller.translateOnlyTitle(draft.id);
  assert.equal(saved.product.title.en, 'Mock translated title');
  assert.equal(saved.product.title.zh, '定制中文标题');
  assert.equal(saved.source.title, draft.source.title);
  assert.equal(storage.get('drafts')[0].product.title.en, 'Mock translated title');
  const request = calls.ai.filter(([name]) => name === 'complete').at(-1)[1];
  assert.equal(JSON.parse(request.messages[1].content).title, '定制中文标题');
});

test('标题建议把主图和商品信息一起交给模型，选定后才写回英文标题', async () => {
  const versions = [
    { angle: '主推爆款长标题', why: '英站首选，字符合规', title: 'Cream cotton knit scarf' },
    { angle: '加长 SEO 长尾款', why: '抓更多搜索词，流量更大', title: 'Winter warm knit scarf for couples' },
    { angle: '精简稳妥款', why: '不容易超字符，属性匹配', title: 'Soft ribbed knit scarf in cream' }
  ];
  const fake = createFakeClient({ snapshot, complete: () => ({ content: JSON.stringify({ versions }), model: 'mock-translator' }) });
  const controller = createController({
    client: fake.client,
    now: () => 1760000000000,
    prepareVisionImage: async (data, mime) => ({ data, mime })
  });
  await controller.load();
  const draft = await controller.collect(SOURCE);
  await controller.prepareImages(draft.id);

  const result = await controller.suggestTitles(draft.id);
  assert.deepEqual(result.versions.map(item => item.title), versions.map(item => item.title));
  assert.equal(result.versions[1].angle, '加长 SEO 长尾款');
  assert.equal(result.usedImage, true);
  assert.ok(result.image.token);

  const request = fake.calls.ai.filter(([name]) => name === 'complete').at(-1)[1];
  assert.equal(request.messages[1].content[0].type, 'text');
  assert.equal(request.messages[1].content[1].type, 'image_url');
  assert.match(request.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(JSON.parse(request.messages[1].content[0].text).title, draft.source.title);

  // 生成候选不改草稿，选定之后才写英文标题。
  assert.equal(fake.storage.get('drafts')[0].product.title.en, '');
  const saved = await controller.applyTitle(draft.id, result.versions[1]);
  assert.equal(saved.product.title.en, versions[1].title);
  assert.equal(fake.storage.get('drafts')[0].product.title.en, versions[1].title);
  // 直接传字符串的老用法保持可用。
  assert.equal((await controller.applyTitle(draft.id, versions[2].title)).product.title.en, versions[2].title);
  await assert.rejects(controller.applyTitle(draft.id, '   '), /请先选择一条标题/);
  await assert.rejects(controller.applyTitle(draft.id, { angle: '精简稳妥款', title: '  ' }), /请先选择一条标题/);
});

test('整篇翻译使用编辑后的 1688 原文', async () => {
  const { controller, calls } = await readyController();
  const draft = await controller.collect(SOURCE);
  await controller.saveDraft(draft.id, { product: { title: { zh: '定制中文标题' } } });
  await controller.translate(draft.id);
  const request = calls.ai.filter(([name]) => name === 'complete').at(-1)[1];
  assert.equal(JSON.parse(request.messages[1].content).title, '定制中文标题');
});

test('旧版全托管正式接口域名自动迁移到当前域名', async () => {
  const fake = createFakeClient({ snapshot });
  await fake.storage.set('settings', {
    model: 'mock-translator',
    coefficient: 1.35,
    site: 'shein',
    baseUrl: 'https://openapi.sheincorp.com',
    appId: APP_ID,
    openKeyId: 'STORE-KEY'
  });
  const controller = createController({ client: fake.client, now: () => 1760000000000 });
  await controller.load();
  assert.equal(controller.getState().settings.baseUrl, 'https://openapi.sheincorp.cn');
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

test('用 APP_ID 与 APP_SecretKey 换取店铺凭据后即可直接发品', async () => {
  const fake = createFakeClient({
    snapshot,
    respond: routeOverrides({
      '/open-api/auth/get-by-token': () => ok({ openKeyId: 'STORE-KEY', secretKey: encryptSecret('store-secret'), supplierId: 7788 })
    })
  });
  const controller = createController({ client: fake.client, now: () => 1760000000000, sleep: async () => {} });
  await controller.load();

  // 授权页与回调地址都由插件自己生成，商家在内嵌浏览器里确认后由插件读回 tempToken。
  const started = await controller.startAuthorization({
    appId: APP_ID, appSecretKey: APP_SECRET, baseUrl: 'https://openapi-test01.sheincorp.cn'
  });
  assert.equal(started.callbackUrl, 'https://zhipentu.github.io/qingzuo-desktop/shein-auth-callback.html?from=qingzuo');
  const address = new URL(started.authorizeUrl);
  assert.equal(address.origin, 'https://openapi-test01.sheincorp.cn');
  const params = new URLSearchParams(address.hash.slice(address.hash.indexOf('?') + 1));
  assert.equal(params.get('appid'), APP_ID);
  assert.equal(atob(params.get('redirectUrl')), started.callbackUrl);
  assert.equal(params.get('state'), started.state);
  assert.deepEqual(fake.calls.browser.find(call => call[0] === 'open'), ['open', started.authorizeUrl]);
  assert.equal(fake.secrets.get('shein-app-secret'), APP_SECRET);

  fake.tabs.find(item => item.id === started.tabId).url = started.callbackUrl + '&tempToken=TMP-TOKEN&state=' + started.state;
  const captured = await controller.awaitAuthorization({ tabId: started.tabId, state: started.state, intervalMs: 1, timeoutMs: 50 });
  assert.deepEqual(captured, { tempToken: 'TMP-TOKEN', state: started.state });

  const result = await controller.authorize({
    appId: APP_ID, appSecretKey: APP_SECRET, tempToken: captured.tempToken, baseUrl: 'https://openapi-test01.sheincorp.cn'
  });

  assert.deepEqual(result, { openKeyId: 'STORE-KEY', supplierId: 7788 });
  assert.equal(controller.getState().settings.appId, APP_ID);
  assert.equal(controller.getState().settings.openKeyId, 'STORE-KEY');
  assert.equal(controller.getState().settings.baseUrl, 'https://openapi-test01.sheincorp.cn');
  assert.equal(fake.secrets.get('shein-app-secret'), APP_SECRET);
  assert.equal(fake.secrets.get('shein-secret-key'), 'store-secret');
  assert.equal((await controller.credentialStatus()).sheinSecret, true);

  const exchange = fake.calls.network.at(-1);
  assert.equal(exchange.url, 'https://openapi-test01.sheincorp.cn/open-api/auth/get-by-token');
  assert.equal(exchange.headers['x-lt-appid'], APP_ID);
  assert.deepEqual(exchange.json, { tempToken: 'TMP-TOKEN' });

  // 换到的 openKeyId / secretKey 直接用于业务接口，不再需要单独的 openKeyId 配置。
  const draft = await collected(controller);
  const submitted = await controller.submit(draft.id, { confirm: true });
  assert.equal(submitted.status, 'submitted');
  const publishCall = fake.calls.network.filter(call => call.url.endsWith('/open-api/goods/product/publishOrEdit')).at(-1);
  assert.equal(publishCall.headers['x-lt-openKeyId'], 'STORE-KEY');
});

test('回调的 state 与本次授权对不上时不会拿去换密钥', async () => {
  const fake = createFakeClient({ snapshot, respond: routeOverrides() });
  const controller = createController({ client: fake.client, now: () => 1760000000000, sleep: async () => {} });
  await controller.load();
  const started = await controller.startAuthorization({
    appId: APP_ID, appSecretKey: APP_SECRET, baseUrl: 'https://openapi-test01.sheincorp.cn'
  });
  fake.tabs.find(item => item.id === started.tabId).url = started.callbackUrl + '&tempToken=OTHER-TOKEN&state=qz-older';
  await assert.rejects(
    () => controller.awaitAuthorization({ tabId: started.tabId, state: started.state, intervalMs: 1, timeoutMs: 5 }),
    /超时/
  );
  assert.equal(fake.calls.network.length, 0);
});

test('商家放弃授权时可以取消等待', async () => {
  const fake = createFakeClient({ snapshot, respond: routeOverrides() });
  const controller = createController({ client: fake.client, now: () => 1760000000000, sleep: async () => {} });
  await controller.load();
  const started = await controller.startAuthorization({
    appId: APP_ID, appSecretKey: APP_SECRET, baseUrl: 'https://openapi-test01.sheincorp.cn'
  });
  await assert.rejects(
    () => controller.awaitAuthorization({ tabId: started.tabId, state: started.state, intervalMs: 1, timeoutMs: 50, isCancelled: () => true }),
    /已取消/
  );
  assert.equal(fake.calls.network.length, 0);
});

test('授权失败时不会留下半套店铺凭据', async () => {
  const fake = createFakeClient({
    snapshot,
    respond: routeOverrides({
      '/open-api/auth/get-by-token': () => ok({ openKeyId: 'STORE-KEY', secretKey: encryptSecret('store-secret', 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF') })
    })
  });
  const controller = createController({ client: fake.client, now: () => 1760000000000 });
  await controller.load();
  await assert.rejects(() => controller.authorize({ appId: APP_ID, appSecretKey: APP_SECRET, tempToken: 'TMP-TOKEN' }), /无法解密/);
  assert.equal(controller.getState().settings.openKeyId, '');
  assert.equal((await controller.credentialStatus()).sheinSecret, false);
  await assert.rejects(() => controller.submit('missing', { confirm: true }), /草稿不存在/);
});

test('未连接希音时提交提示先完成授权', async () => {
  const fake = createFakeClient({ snapshot, respond: routeOverrides() });
  const controller = createController({ client: fake.client, now: () => 1760000000000 });
  await controller.load();
  const draft = await collected(controller);
  await assert.rejects(() => controller.submit(draft.id, { confirm: true }), /连接希音/);
  assert.equal(fake.calls.network.length, 0);
});

test('读取店铺类目树后复用缓存，换店铺或手动刷新才重新请求', async () => {
  const tree = {
    data: [{
      category_id: 1200,
      category_name: '服饰配饰',
      last_category: false,
      children: [{ category_id: 1234, category_name: '围巾', last_category: true, product_type_id: 5678 }]
    }]
  };
  const { controller, calls } = await readyController({
    '/open-api/goods/query-category-tree': () => ok(tree)
  });
  const categories = await controller.loadCategories();
  assert.equal(categories[0].categoryId, '1200');
  assert.equal(categories[0].children[0].productTypeId, '5678');
  assert.equal(networkPaths(calls).filter(path => path === '/open-api/goods/query-category-tree').length, 1);

  await controller.loadCategories();
  assert.equal(networkPaths(calls).filter(path => path === '/open-api/goods/query-category-tree').length, 1);

  await controller.loadCategories({ force: true });
  assert.equal(networkPaths(calls).filter(path => path === '/open-api/goods/query-category-tree').length, 2);

  // 修改店铺设置后缓存失效，下一次读取会重新拉取。
  await controller.saveSettings({ openKeyId: 'OTHER-KEY' });
  await controller.loadCategories();
  assert.equal(networkPaths(calls).filter(path => path === '/open-api/goods/query-category-tree').length, 3);
});

test('未连接希音时不会请求类目树', async () => {
  const fake = createFakeClient({ snapshot, respond: routeOverrides() });
  const controller = createController({ client: fake.client, now: () => 1760000000000 });
  await controller.load();
  await assert.rejects(() => controller.loadCategories(), /连接希音/);
  assert.equal(fake.calls.network.length, 0);
});

test('提交时按当前版本上传图片，原图与译文不会混用', async () => {
  const { controller, calls } = await readyController();
  const draft = await controller.collect(SOURCE);
  const patch = patchFor(draft);
  patch.product.images = [{
    id: 'img-1', role: 'main', name: 'main.jpg', mime: 'image/jpeg', size: 102400, width: 1000, height: 1000,
    excluded: false, uploadedUrl: '', token: 'file-img',
    translated: { token: 'file-en', mime: 'image/jpeg', size: 120000, width: 1000, height: 1000 },
    useTranslated: true
  }];
  await controller.saveDraft(draft.id, patch);
  const submitted = await controller.submit(draft.id, { confirm: true });
  assert.equal(submitted.status, 'submitted');
  const uploads = calls.network
    .filter(options => new URL(options.url).pathname === '/open-api/goods/upload-pic')
    .map(options => options.multipart.files[0].token);
  assert.deepEqual(uploads, ['file-en']);
  const image = controller.find(draft.id).product.images[0];
  assert.equal(image.token, 'file-img');
  assert.equal(image.translated.token, 'file-en');
  assert.equal(image.uploadedToken, 'file-en');
  assert.ok(image.uploadedUrl);
});

test('删除草稿会同时释放原图与译文文件', async () => {
  const { controller, client, calls } = await readyController();
  const draft = await controller.collect(SOURCE);
  const original = await client.storage.saveFile({ data: 'AA==', filename: 'a.png', mime: 'image/png' });
  const translated = await client.storage.saveFile({ data: 'AA==', filename: 'a-en.png', mime: 'image/png' });
  const patch = patchFor(draft);
  patch.product.images = [{
    id: 'img-1', role: 'main', name: 'a.png', mime: 'image/png', size: 1024, width: 1000, height: 1000,
    excluded: false, token: original.token,
    translated: { token: translated.token, mime: 'image/png', size: 1024 },
    useTranslated: true
  }];
  await controller.saveDraft(draft.id, patch);
  await controller.remove(draft.id);
  assert.deepEqual(calls.removed.slice().sort(), [original.token, translated.token].sort());
  assert.equal(controller.getState().drafts.length, 0);
});

test('图片模型列表来自底座的代理模型目录', async () => {
  const fake = createFakeClient({
    snapshot,
    respond: routeOverrides(),
    imageModels: [{ id: 'gpt-image', source: 'proxy', provider: 'openai', title: 'Image', sizes: ['1024x1024'] }]
  });
  const controller = createController({ client: fake.client, now: () => 1760000000000 });
  await controller.load();
  const models = await controller.imageCatalog();
  assert.deepEqual(models.map(model => model.id), ['gpt-image']);
  assert.deepEqual(fake.calls.ai.find(call => call[0] === 'models')[1], { source: 'proxy' });
});

test('保存设置可持久化自定义图像修改提示词', async () => {
  const fake = createFakeClient({ snapshot, respond: routeOverrides() });
  const controller = createController({ client: fake.client, now: () => 1760000000000 });
  await controller.load();
  assert.equal(controller.getState().settings.imagePrompt, '');
  await controller.saveSettings({ imagePrompt: '  只把主标题改成英文，保留其余字样  ' });
  assert.equal(controller.getState().settings.imagePrompt, '只把主标题改成英文，保留其余字样');
});

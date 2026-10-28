import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseProductSnapshot } from '../ui/collect.mjs';
import {
  applyDocumentState, applyTranslation, blockingIssues, canTransition, createDraft, markSubmitted,
  setImages, skuSupplyPriceOf, submissionKey, transition, upsertDraft, validateDraft
} from '../ui/store.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/1688-detail-snapshot.json', import.meta.url), 'utf8'));

function collectedDraft() {
  return createDraft(parseProductSnapshot(fixture), { id: 'd-test', now: 1700000000000, coefficient: 1.35 });
}

function reviewReadyDraft() {
  let draft = collectedDraft();
  draft = applyTranslation(draft, {
    title: 'Cotton knit winter scarf for couples',
    bullets: ['Soft cotton knit', 'Thick winter warmth'],
    description: 'A soft cotton scarf for winter.',
    attributes: [{ name: '材质', value: 'Cotton' }]
  });
  draft = setImages(draft, [{ id: 'img-1', role: 'main', token: 'file-1', name: 'main.png', size: 1024, mime: 'image/png', width: 1000, height: 1000, excluded: false }]);
  draft = {
    ...draft,
    product: {
      ...draft.product,
      category: { ...draft.product.category, sheinCategoryId: '1234', sheinProductTypeId: '5678', confirmed: true, colorAttributeId: '11' },
      skus: draft.product.skus.map(sku => ({ ...sku, colorEn: sku.color === '米白' ? 'Cream' : 'Black', colorAttributeValueId: '21' }))
    }
  };
  return transition(draft, 'review', '进入待审核');
}

test('新草稿从 1688 采集结果生成，并自动分配供货 SKU', () => {
  const draft = collectedDraft();
  assert.equal(draft.status, 'collected');
  assert.equal(draft.source.price, 12.5);
  assert.equal(draft.source.moq, 2);
  assert.deepEqual(draft.product.skus.map(sku => sku.supplierSku), ['DTEST-01', 'DTEST-02']);
  assert.equal(draft.product.coefficient, 1.35);
  assert.equal(draft.history.at(-1).status, 'collected');
});

test('手动改过的供货价优先，未改的仍按加价系数换算', () => {
  const draft = collectedDraft();
  draft.product.skus[0].supplyPriceOverride = 20;
  assert.equal(skuSupplyPriceOf(draft.product.skus[0], draft), 20);
  assert.equal(skuSupplyPriceOf(draft.product.skus[1], draft), 17.55);
  draft.product.skus[0].supplyPriceOverride = null;
  assert.equal(skuSupplyPriceOf(draft.product.skus[0], draft), 16.88);
});

test('手动供货价超出范围时按 SKU 逐条拦截', () => {
  const draft = reviewReadyDraft();
  assert.deepEqual(blockingIssues(draft), []);
  draft.product.skus[0].supplyPriceOverride = 20000;
  assert.ok(blockingIssues(draft).some(issue => /SKU「米白」供货价高于/.test(issue.message)));
});

test('类目模板带尺码时，有规格的 SKU 必须匹配尺码值', () => {
  const draft = reviewReadyDraft();
  draft.product.category.sizeAttributeId = '31';
  draft.product.skus[0].spec = 'XL';
  assert.ok(blockingIssues(draft).some(issue => /规格「XL」未匹配希音尺码值/.test(issue.message)));
  draft.product.skus[0].sizeAttributeValueId = '3101';
  assert.deepEqual(blockingIssues(draft), []);
});

test('状态机只允许相邻推进，未审核不能直接提交', () => {
  assert.equal(canTransition('collected', 'translated'), true);
  assert.equal(canTransition('collected', 'submitted'), false);
  assert.equal(canTransition('review', 'submitted'), true);
  assert.equal(canTransition('rejected', 'review'), true);
  assert.equal(canTransition('approved', 'review'), false);
  const draft = collectedDraft();
  assert.throws(() => transition(draft, 'submitted'), /不能从/);
  assert.throws(() => markSubmitted(draft, { spuName: 'S' }), /只有待审核/);
});

test('翻译结果写入标题、卖点和属性值', () => {
  let draft = collectedDraft();
  draft = applyTranslation(draft, {
    title: 'Cotton knit winter scarf',
    bullets: ['Soft cotton knit', 'Warm for winter'],
    description: 'A soft scarf.',
    attributes: [{ name: '材质', value: 'Cotton' }]
  });
  assert.equal(draft.status, 'translated');
  assert.equal(draft.product.title.en, 'Cotton knit winter scarf');
  assert.deepEqual(draft.product.bullets, [{ en: 'Soft cotton knit' }, { en: 'Warm for winter' }]);
  assert.equal(draft.product.attributes.find(item => item.name.zh === '材质').value.en, 'Cotton');
  assert.throws(() => applyTranslation(draft, { bullets: ['x'] }), /英文标题/);
});

test('必填项缺失会阻断提交并给出字段级原因', () => {
  const draft = collectedDraft();
  const messages = blockingIssues(draft).map(issue => issue.message);
  assert.ok(messages.includes('缺少英文标题'));
  assert.ok(messages.includes('请选择希音末级类目'));
  assert.ok(messages.includes('至少需要一张主图'));

  const ready = reviewReadyDraft();
  assert.deepEqual(blockingIssues(ready), []);
});

test('类目未确认、颜色未匹配、SKU 缺英文色都会阻断', () => {
  let draft = reviewReadyDraft();
  draft = { ...draft, product: { ...draft.product, category: { ...draft.product.category, confirmed: false } } };
  assert.ok(validateDraft(draft).some(issue => issue.message === '类目尚未确认'));

  draft = reviewReadyDraft();
  draft = { ...draft, product: { ...draft.product, skus: draft.product.skus.map(sku => ({ ...sku, colorAttributeValueId: '' })) } };
  assert.ok(validateDraft(draft).some(issue => issue.message.includes('未匹配希音颜色值')));

  draft = reviewReadyDraft();
  draft = { ...draft, product: { ...draft.product, skus: draft.product.skus.map(sku => ({ ...sku, colorEn: '' })) } };
  assert.ok(validateDraft(draft).some(issue => issue.message.includes('缺少英文颜色')));
});

test('提交成功记录 SPU 与幂等键，审核结果回填草稿', () => {
  const ready = reviewReadyDraft();
  assert.equal(submissionKey(ready), 'DTEST-01');
  const submitted = markSubmitted(ready, { spuName: 'SPU-9', skcNames: ['SKC-1'], skuCodes: ['SKU-1'] }, 1700000001000);
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.submission.spuName, 'SPU-9');
  assert.equal(submitted.submission.key, 'DTEST-01');

  const approved = applyDocumentState(submitted, { status: 'APPROVED', reason: '' }, 1700000002000);
  assert.equal(approved.status, 'approved');

  const rejected = applyDocumentState(submitted, { status: 'REJECTED', reason: '图片不清晰' }, 1700000003000);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.submission.rejectedReason, '图片不清晰');
});

test('草稿列表按更新时间置顶并限制上限', () => {
  const draft = collectedDraft();
  const list = upsertDraft([{ id: 'x' }], draft);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'd-test');
  const updated = upsertDraft(list, { ...draft, notes: ['改过'] });
  assert.equal(updated.length, 2);
  assert.deepEqual(updated[0].notes, ['改过']);
  assert.equal(updated[1].id, 'x');
  const many = Array.from({ length: 120 }, (_, index) => ({ id: 'd' + index }));
  assert.equal(upsertDraft(many, { id: 'new' }).length, 100);
});

test('译文不合规时按提交版本拦截，原图合规也不放行', () => {
  const draft = reviewReadyDraft();
  const withTranslation = {
    ...draft,
    product: {
      ...draft.product,
      images: [{
        id: 'img-1', role: 'main', token: 'file-1', name: 'main.png', size: 1024, mime: 'image/png', width: 1000, height: 1000, excluded: false,
        translated: { token: 'file-en', mime: 'image/webp', size: 1024, width: 1000, height: 1000 },
        useTranslated: true
      }]
    }
  };
  assert.equal(blockingIssues(withTranslation).some(issue => issue.message.includes('JPG')), true);

  const oversized = {
    ...withTranslation,
    product: {
      ...withTranslation.product,
      images: [{ ...withTranslation.product.images[0], translated: { token: 'file-en', mime: 'image/jpeg', size: 3 * 1024 * 1024 + 1, width: 1000, height: 1000 } }]
    }
  };
  assert.equal(blockingIssues(oversized).some(issue => issue.message.includes('3 MB')), true);

  // 切回原图后同一条草稿恢复可提交，译文不再参与校验。
  const backToOriginal = {
    ...withTranslation,
    product: { ...withTranslation.product, images: [{ ...withTranslation.product.images[0], useTranslated: false }] }
  };
  assert.deepEqual(blockingIssues(backToOriginal), []);
});

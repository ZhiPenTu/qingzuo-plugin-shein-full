import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublishPayload, groupSkcs, spuSupplierCode } from '../ui/shein-payload.mjs';
import { createDraft } from '../ui/store.mjs';

function sampleDraft() {
  const draft = createDraft({
    url: 'https://detail.1688.com/offer/1.html',
    title: '纯棉针织围巾 冬季加厚保暖',
    price: 12.5,
    breadcrumb: ['围巾', '针织'],
    attributes: [{ name: '材质', value: '棉' }],
    skus: [{ color: '米白', price: 12.5, stock: 900 }, { color: '墨黑', price: 13, stock: 800 }],
    images: []
  }, { id: 'd-payload', now: 1 });
  draft.product.title.en = 'Cotton Knit Scarf';
  draft.product.description = { zh: '纯棉围巾', en: 'A cotton knit scarf.' };
  draft.product.category = {
    ...draft.product.category,
    sheinCategoryId: '1234',
    sheinProductTypeId: '5678',
    colorAttributeId: '2001',
    confirmed: true
  };
  draft.product.attributes = [{ attributeId: '1001', name: { zh: '材质', en: '材质' }, value: { zh: '棉', en: 'Cotton' }, required: true, values: [] }];
  draft.product.skus = draft.product.skus.map((sku, index) => ({
    ...sku,
    colorEn: ['Off White', 'Ink Black'][index],
    colorAttributeValueId: ['9001', '9002'][index]
  }));
  draft.product.images = [
    { id: 'img-1', role: 'main', token: 't1', uploadedUrl: 'https://img.test/1.jpg', excluded: false },
    { id: 'img-2', role: 'detail', token: 't2', uploadedUrl: 'https://img.test/2.jpg', excluded: false },
    { id: 'img-3', role: 'detail', token: 't3', uploadedUrl: 'https://img.test/3.jpg', excluded: true }
  ];
  return draft;
}

test('发品载荷只声明英语站点，中文原稿留在草稿里', () => {
  const payload = buildPublishPayload(sampleDraft(), { site: 'shein' });
  assert.equal(payload.default_language, 'en');
  assert.equal(payload.main_site, 'shein');
  assert.deepEqual(payload.sub_site_list, ['shein']);
  assert.deepEqual(payload.multi_language_name_list, [{ language: 'en', name: 'Cotton Knit Scarf' }]);
  assert.deepEqual(payload.multi_language_desc_list, [{ language: 'en', name: 'A cotton knit scarf.' }]);
});

test('一个颜色一个 SKC，价格按系数换算，排除的图片不上传', () => {
  const draft = sampleDraft();
  const payload = buildPublishPayload(draft);
  assert.equal(payload.category_id, 1234);
  assert.equal(payload.product_type_id, 5678);
  assert.equal(payload.supplier_code, spuSupplierCode(draft));
  assert.equal(payload.skc_list.length, 2);
  assert.deepEqual(payload.skc_list.map(skc => skc.sku_list[0].supplier_price), [16.88, 17.55]);
  assert.deepEqual(payload.skc_list.map(skc => skc.sale_attribute.attribute_value_id), [9001, 9002]);
  const images = payload.skc_list[0].image_info.image_info_list;
  assert.deepEqual(images.map(image => [image.image_sort, image.image_type, image.image_url]), [
    [1, 1, 'https://img.test/1.jpg'],
    [2, 2, 'https://img.test/2.jpg']
  ]);
  assert.deepEqual(payload.product_attribute_list, [{ attribute_id: 1001, custom_attribute_value: 'Cotton' }]);
});

test('同一颜色下的多个 SKU 归入同一个 SKC，供货 SKU 原样透传', () => {
  const draft = sampleDraft();
  draft.product.skus = [
    { ...draft.product.skus[0], supplierSku: 'A-01' },
    { ...draft.product.skus[0], supplierSku: 'A-02' }
  ];
  const groups = groupSkcs(draft);
  assert.equal(groups.length, 1);
  const payload = buildPublishPayload(draft);
  assert.equal(payload.skc_list.length, 1);
  assert.deepEqual(payload.skc_list[0].sku_list.map(sku => sku.supplier_sku), ['A-01', 'A-02']);
});

test('类目或图片缺失时拒绝组装载荷', () => {
  const missingCategory = sampleDraft();
  missingCategory.product.category.sheinCategoryId = '';
  assert.throws(() => buildPublishPayload(missingCategory), /末级类目/);
  const missingImages = sampleDraft();
  missingImages.product.images = [];
  assert.throws(() => buildPublishPayload(missingImages), /没有可提交的图片/);
  const missingColor = sampleDraft();
  missingColor.product.skus[0].colorAttributeValueId = '';
  assert.throws(() => buildPublishPayload(missingColor), /颜色/);
});

test('手动改过的供货价进入发品载荷，未改的仍按系数换算', () => {
  const draft = sampleDraft();
  draft.product.skus[0].supplyPriceOverride = 25.99;
  const payload = buildPublishPayload(draft);
  assert.deepEqual(payload.skc_list.map(skc => skc.sku_list[0].supplier_price), [25.99, 17.55]);
});

test('类目模板带尺码时，同一颜色的 SKU 分别带上尺码属性值', () => {
  const draft = sampleDraft();
  draft.product.category.sizeAttributeId = '3001';
  draft.product.skus = [
    { ...draft.product.skus[0], supplierSku: 'A-01', sizeAttributeValueId: '9101' },
    { ...draft.product.skus[0], supplierSku: 'A-02', sizeAttributeValueId: '9102' }
  ];
  const payload = buildPublishPayload(draft);
  assert.equal(payload.skc_list.length, 1);
  assert.deepEqual(payload.skc_list[0].sku_list.map(sku => sku.sale_attribute_list), [
    [{ attribute_id: 2001, attribute_value_id: 9001 }, { attribute_id: 3001, attribute_value_id: 9101 }],
    [{ attribute_id: 2001, attribute_value_id: 9001 }, { attribute_id: 3001, attribute_value_id: 9102 }]
  ]);
});

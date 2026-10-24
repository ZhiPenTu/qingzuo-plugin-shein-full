import { skuSupplyPriceOf } from './store.mjs';
import { imageTypeFor } from './images.mjs';

export function spuSupplierCode(draft) {
  const base = String(draft.id ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (base || 'SHEIN') + '-SPU';
}

export function groupSkcs(draft) {
  const groups = new Map();
  for (const [index, sku] of (draft.product?.skus ?? []).entries()) {
    const key = (sku.colorEn || sku.color || 'Default').trim();
    if (!groups.has(key)) groups.set(key, { key, index, skus: [] });
    groups.get(key).skus.push(sku);
  }
  return [...groups.values()];
}

// v1 只发布英语站点：多语言列表里多塞一种语言会让平台的审核与站点映射
// 变得不可预期，中文原稿始终保留在草稿里给运营对照。
function languageList(name) {
  return name ? [{ language: 'en', name }] : [];
}

function selectedImages(draft) {
  return (draft.product?.images ?? []).filter(image => image && !image.excluded && image.uploadedUrl);
}

// 发品载荷按希音 publishOrEdit 的字段形状组装。字段映射集中在
// 此模块，真实环境验收时只需改这里，不影响采集与审核流程。
export function buildPublishPayload(draft, { site = 'shein', categoryId, productTypeId } = {}) {
  const category = draft.product?.category ?? {};
  const sheinCategoryId = Number(categoryId ?? category.sheinCategoryId);
  const sheinProductTypeId = Number(productTypeId ?? category.sheinProductTypeId);
  if (!Number.isInteger(sheinCategoryId) || sheinCategoryId <= 0) throw new Error('希音末级类目无效。');
  if (!Number.isInteger(sheinProductTypeId) || sheinProductTypeId <= 0) throw new Error('希音 product_type_id 无效。');

  const images = selectedImages(draft);
  if (!images.length) throw new Error('没有可提交的图片。');
  const imageInfoList = images.map((image, index) => ({
    image_sort: index + 1,
    image_type: imageTypeFor(image.role),
    image_url: image.uploadedUrl
  }));
  const colorAttributeId = Number(category.colorAttributeId);
  const skcs = groupSkcs(draft);
  if (!skcs.length) throw new Error('没有可提交的 SKU。');

  const skcList = skcs.map((group, index) => {
    if (Number.isInteger(colorAttributeId) && colorAttributeId > 0) {
      if (!group.skus[0].colorAttributeValueId) throw new Error('颜色「' + group.key + '」未匹配希音颜色值。');
    }
    return {
      supplier_code: spuSupplierCode(draft).replace(/-SPU$/, '') + '-' + String(index + 1).padStart(2, '0'),
      skc_name: '',
      shelf_way: '1',
      ...(Number.isInteger(colorAttributeId) && colorAttributeId > 0
        ? { sale_attribute: { attribute_id: colorAttributeId, attribute_value_id: Number(group.skus[0].colorAttributeValueId) } }
        : {}),
      image_info: { image_info_list: imageInfoList },
      sku_list: group.skus.map(sku => ({
        supplier_sku: String(sku.supplierSku),
        mall_state: 1,
        stop_purchase: 1,
        supplier_price: skuSupplyPriceOf(sku, draft),
        ...(Number.isInteger(colorAttributeId) && colorAttributeId > 0
          ? { sale_attribute_list: [{ attribute_id: colorAttributeId, attribute_value_id: Number(sku.colorAttributeValueId) }] }
          : {})
      }))
    };
  });

  const attributes = (draft.product?.attributes ?? [])
    .filter(attribute => attribute.valueId || attribute.value?.en)
    .map(attribute => {
      const id = Number(attribute.attributeId);
      if (!Number.isInteger(id) || id <= 0) return null;
      const valueId = Number(attribute.valueId);
      return Number.isInteger(valueId) && valueId > 0
        ? { attribute_id: id, attribute_value_id: valueId }
        : { attribute_id: id, custom_attribute_value: attribute.value.en };
    })
    .filter(Boolean);

  return {
    category_id: sheinCategoryId,
    product_type_id: sheinProductTypeId,
    supplier_code: spuSupplierCode(draft),
    default_language: 'en',
    multi_language_name_list: languageList(draft.product?.title?.en),
    multi_language_desc_list: languageList(draft.product?.description?.en || draft.product?.title?.en),
    suit_flag: 0,
    main_site: site,
    sub_site_list: [site],
    ...(attributes.length ? { product_attribute_list: attributes } : {}),
    skc_list: skcList
  };
}

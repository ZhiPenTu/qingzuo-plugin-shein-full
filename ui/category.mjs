const SALES_ATTRIBUTE = 1;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pick(object, keys) {
  for (const key of keys) if (object?.[key] !== undefined && object[key] !== null) return object[key];
  return undefined;
}

export function parseAttributeTemplate(info) {
  const list = Array.isArray(info) ? info : pick(info, ['attribute_list', 'attributeList', 'list', 'items']) ?? [];
  const attributes = (Array.isArray(list) ? list : []).map(item => {
    const values = pick(item, ['attribute_value_list', 'attributeValueList', 'values', 'value_list']) ?? [];
    return {
      id: String(pick(item, ['attribute_id', 'attributeId', 'id']) ?? ''),
      name: text(pick(item, ['attribute_name', 'attributeName', 'name']) ?? ''),
      type: Number(pick(item, ['attribute_type', 'attributeType', 'type']) ?? 0),
      dimension: Number(pick(item, ['data_dimension', 'dataDimension', 'dimension']) ?? 0),
      required: Boolean(pick(item, ['is_required', 'isRequired', 'required']) ?? false),
      values: (Array.isArray(values) ? values : []).map(value => ({
        id: String(pick(value, ['attribute_value_id', 'attributeValueId', 'id']) ?? ''),
        label: text(pick(value, ['attribute_value', 'attributeValue', 'value', 'name']) ?? '')
      })).filter(value => value.id)
    };
  }).filter(attribute => attribute.id && attribute.name);
  const color = attributes.find(attribute => attribute.type === SALES_ATTRIBUTE && /颜色|色|color/i.test(attribute.name))
    ?? attributes.find(attribute => attribute.type === SALES_ATTRIBUTE)
    ?? null;
  // 全托管按「颜色 = SKC，尺码 = SKU」拆分；类目模板里的另一个销售属性就是尺码。
  const size = attributes.find(attribute => attribute.type === SALES_ATTRIBUTE && attribute.id !== color?.id && /尺码|尺寸|码数|size/i.test(attribute.name))
    ?? attributes.find(attribute => attribute.type === SALES_ATTRIBUTE && attribute.id !== color?.id)
    ?? null;
  return { attributes, colorAttribute: color, sizeAttribute: size };
}

export function applyAttributeTemplate(draft, template) {
  if (!template || !Array.isArray(template.attributes)) throw new Error('属性模板无效。');
  const previous = draft.product?.attributes ?? [];
  const attributes = template.attributes.map(attribute => {
    const existing = previous.find(item =>
      text(item.name?.en).toLowerCase() === attribute.name.toLowerCase() ||
      text(item.name?.zh) === attribute.name ||
      (attribute.id && String(item.attributeId) === attribute.id)
    );
    return {
      attributeId: attribute.id,
      name: { zh: existing?.name?.zh || attribute.name, en: attribute.name },
      value: { zh: existing?.value?.zh ?? '', en: existing?.value?.en ?? '' },
      valueId: existing?.valueId ?? '',
      required: attribute.required,
      type: attribute.type,
      dimension: attribute.dimension,
      values: attribute.values
    };
  });
  return {
    ...draft,
    product: {
      ...draft.product,
      attributes,
      category: {
        ...draft.product.category,
        colorAttributeId: template.colorAttribute?.id ?? '',
        sizeAttributeId: template.sizeAttribute?.id ?? '',
        confirmed: true
      }
    }
  };
}

export function templateValueFor(draft, attributeId) {
  return (draft.product?.attributes ?? []).find(attribute => String(attribute.attributeId) === String(attributeId));
}

const CATEGORY_LIST_KEYS = ['data', 'category_list', 'categoryList', 'list', 'items', 'categories'];
const CATEGORY_CHILD_KEYS = ['children', 'child_list', 'childList', 'sub_category_list', 'subCategoryList', 'category_list', 'categoryList', 'sub_list', 'subList'];

function categoryListOf(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of CATEGORY_LIST_KEYS) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function normalizeCategory(item) {
  if (!item || typeof item !== 'object') return null;
  const categoryId = String(pick(item, ['category_id', 'categoryId']) ?? '').trim();
  if (!categoryId) return null;
  const name = text(pick(item, ['category_name', 'categoryName', 'name'])) || categoryId;
  const children = categoryListOf(pick(item, CATEGORY_CHILD_KEYS))
    .map(child => normalizeCategory(child))
    .filter(Boolean);
  const productTypeValue = pick(item, ['product_type_id', 'productTypeId']);
  const productTypeId = productTypeValue === undefined || productTypeValue === null ? '' : String(productTypeValue).trim();
  // 官方文档：product_type_id 只存在于末级分类；last_category 缺失时以子节点和商品类型兜底。
  const leaf = Boolean(pick(item, ['last_category', 'lastCategory'])) || (!children.length && Boolean(productTypeId));
  return { categoryId, name, productTypeId: leaf ? productTypeId : '', leaf, children };
}

export function parseCategoryTree(info) {
  let list = categoryListOf(info);
  if (!list.length && info && typeof info === 'object' && !Array.isArray(info)) list = categoryListOf(info.data);
  return list.map(item => normalizeCategory(item)).filter(Boolean);
}

export function findCategoryPath(nodes, categoryId) {
  const target = String(categoryId ?? '').trim();
  if (!target) return [];
  const walk = (list, trail) => {
    for (const node of Array.isArray(list) ? list : []) {
      const next = [...trail, node];
      if (node.categoryId === target) return next;
      const found = walk(node.children, next);
      if (found.length) return found;
    }
    return [];
  };
  return walk(nodes, []);
}

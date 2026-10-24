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
  return { attributes, colorAttribute: color };
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
      category: { ...draft.product.category, colorAttributeId: template.colorAttribute?.id ?? '', confirmed: true }
    }
  };
}

export function templateValueFor(draft, attributeId) {
  return (draft.product?.attributes ?? []).find(attribute => String(attribute.attributeId) === String(attributeId));
}

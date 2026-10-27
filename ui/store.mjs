import { DEFAULT_COEFFICIENT, priceIssues, priceSpreadWarning, supplyPrice } from './pricing.mjs';
import { submitImage } from './images.mjs';

export const STATUS_LABEL = Object.freeze({
  collected: '已采集',
  translated: '已翻译',
  imaged: '已配图',
  review: '待审核',
  submitted: '已提交',
  approved: '通过',
  rejected: '驳回'
});

const TRANSITIONS = Object.freeze({
  collected: ['translated', 'imaged', 'review'],
  translated: ['imaged', 'review'],
  imaged: ['review'],
  review: ['submitted', 'collected', 'review'],
  submitted: ['approved', 'rejected'],
  approved: [],
  rejected: ['review']
});

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDraft(collected, { id, now, coefficient = DEFAULT_COEFFICIENT } = {}) {
  const stamp = typeof now === 'number' ? now : Date.now();
  const draftId = id ?? 'd-' + stamp.toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const price = Number(collected.price) || 0;
  const skus = (collected.skus?.length ? collected.skus : [{ color: '', price, stock: null }]).map((sku, index) => ({
    color: sku.color ?? '',
    colorEn: '',
    colorAttributeValueId: '',
    price: Number(sku.price) || price,
    stock: sku.stock ?? null,
    supplierSku: draftId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) + '-' + String(index + 1).padStart(2, '0')
  }));
  return {
    id: draftId,
    status: 'collected',
    created: stamp,
    updated: stamp,
    source: {
      url: collected.url ?? '',
      pageTitle: collected.pageTitle ?? '',
      title: collected.title ?? '',
      price,
      moq: collected.moq ?? null,
      unit: collected.unit ?? '',
      breadcrumb: collected.breadcrumb ?? [],
      attributes: collected.attributes ?? [],
      images: collected.images ?? [],
      capturedAt: stamp
    },
    product: {
      title: { zh: collected.title ?? '', en: '' },
      bullets: [],
      description: { zh: '', en: '' },
      attributes: (collected.attributes ?? []).map(attribute => ({
        attributeId: '',
        attributeValueId: '',
        name: { zh: attribute.name, en: '' },
        value: { zh: attribute.value, en: '' },
        required: false,
        values: []
      })),
      category: {
        sourcePath: collected.breadcrumb ?? [],
        sheinCategoryId: '',
        sheinProductTypeId: '',
        sheinCategoryName: '',
        colorAttributeId: '',
        confirmed: false
      },
      images: [],
      skus,
      coefficient: Number(coefficient) || DEFAULT_COEFFICIENT,
      currency: 'USD'
    },
    submission: null,
    notes: collected.notes ?? [],
    issues: [],
    history: [{ at: stamp, status: 'collected', note: '从 1688 采集' }]
  };
}

export function transition(draft, status, note = '', now = Date.now()) {
  if (!canTransition(draft.status, status)) throw new Error('不能从「' + (STATUS_LABEL[draft.status] ?? draft.status) + '」变为「' + (STATUS_LABEL[status] ?? status) + '」。');
  const at = typeof now === 'number' ? now : Date.now();
  return { ...draft, status, updated: at, history: [...draft.history, { at, status, note }] };
}

export function coefficientOf(draft) {
  return Number(draft.product?.coefficient) || DEFAULT_COEFFICIENT;
}

export function supplyPriceOf(draft) {
  return supplyPrice(draft.source?.price ?? 0, coefficientOf(draft));
}

export function skuSupplyPriceOf(sku, draft) {
  return supplyPrice(sku?.price ?? draft.source?.price ?? 0, coefficientOf(draft));
}

export function applyTranslation(draft, translation, now = Date.now()) {
  if (!translation || typeof translation !== 'object') throw new Error('翻译结果无效。');
  const title = text(translation.title);
  if (!title) throw new Error('翻译结果缺少英文标题。');
  const bullets = (Array.isArray(translation.bullets) ? translation.bullets : []).map(item => text(item)).filter(Boolean).slice(0, 6);
  const translated = new Map((Array.isArray(translation.attributes) ? translation.attributes : []).map(item => [text(item?.name), text(item?.value)]));
  const attributes = (draft.product?.attributes ?? []).map(attribute => {
    const key = attribute.name?.zh;
    const value = translated.get(key);
    return {
      ...attribute,
      name: { ...attribute.name, en: text(value) ? key : attribute.name.en },
      value: { ...attribute.value, en: text(value) || attribute.value.en }
    };
  });
  const product = {
    ...draft.product,
    title: { ...draft.product.title, en: title.slice(0, 200) },
    bullets: bullets.map(item => ({ en: item })),
    description: { ...draft.product.description, en: text(translation.description) },
    attributes
  };
  const next = { ...draft, product, updated: now };
  return canTransition(next.status, 'translated') ? transition(next, 'translated', '完成图文翻译', now) : next;
}

export function setImages(draft, images, now = Date.now()) {
  return { ...draft, product: { ...draft.product, images: images.slice(0, 30) }, updated: now };
}

export function validateDraft(draft) {
  const issues = [];
  const push = (field, message, level = 'error') => issues.push({ field, message, level });
  const title = text(draft.product?.title?.en);
  if (!title) push('title', '缺少英文标题');
  else if (title.length < 5) push('title', '英文标题过短');
  else if (title.length > 200) push('title', '英文标题超过 200 字符');
  if (text(draft.product?.title?.zh) && !title) push('title', '中文标题已翻译但英文为空');

  if (!(draft.product?.bullets ?? []).some(item => text(item.en))) push('bullets', '至少需要一条英文卖点');

  const category = draft.product?.category ?? {};
  if (!text(category.sheinCategoryId)) push('category', '请选择希音末级类目');
  if (!text(category.sheinProductTypeId)) push('category', '缺少 product_type_id');
  if (!category.confirmed) push('category', '类目尚未确认');

  const images = draft.product?.images ?? [];
  if (!images.filter(image => image.role === 'main' && !image.excluded).length) push('images', '至少需要一张主图');
  for (const image of images) {
    if (image.excluded) continue;
    // 译文可能改过尺寸或格式，校验以最终要提交的那一张为准。
    const version = submitImage(image);
    if (!version.token) push('images', '图片「' + (image.name || '未命名') + '」尚未转存');
    if (version.size && version.size > 3 * 1024 * 1024) push('images', '图片「' + (image.name || '未命名') + '」超过希音 3 MB 上限');
    if (version.mime && !['image/jpeg', 'image/png'].includes(version.mime)) push('images', '图片「' + (image.name || '未命名') + '」需为 JPG 或 PNG');
    if (image.role === 'main' && version.width && version.height) {
      const square = Math.abs(version.width - version.height) <= Math.min(version.width, version.height) * 0.05;
      if (square && Math.min(version.width, version.height) < 900) push('images', '主图「' + (image.name || '未命名') + '」低于 900 px，希音可能拒收', 'warning');
      if (!square && Math.min(version.width, version.height) < 1340) push('images', '主图「' + (image.name || '未命名') + '」低于希音建议尺寸 1340×1785', 'warning');
    }
  }

  const skus = draft.product?.skus ?? [];
  if (!skus.length) push('skus', '缺少 SKU');
  for (const sku of skus) {
    if (!text(sku.supplierSku)) push('skus', '有 SKU 缺少供货 SKU 编号');
    if (!text(sku.colorEn)) push('skus', '有 SKU 缺少英文颜色');
    if (text(category.colorAttributeId) && !text(sku.colorAttributeValueId)) push('skus', '颜色「' + (sku.color || sku.colorEn) + '」未匹配希音颜色值');
  }

  const coefficient = coefficientOf(draft);
  if (!Number.isFinite(coefficient) || coefficient < 1.05 || coefficient > 3) push('price', '加价系数需在 1.05 到 3 之间');
  let price = 0;
  try { price = supplyPrice(draft.source?.price ?? 0, coefficient); }
  catch { push('price', '1688 单价无效，请重新采集'); }
  for (const message of priceIssues(price)) push('price', message);
  const spread = priceSpreadWarning(skus);
  if (spread) push('skus', spread, 'warning');

  for (const attribute of draft.product?.attributes ?? []) {
    if (attribute.required && !text(attribute.value?.en)) push('attributes', '必填属性「' + (attribute.name?.en || attribute.name?.zh) + '」未填写');
  }
  return issues;
}

export function blockingIssues(draft) {
  return validateDraft(draft).filter(issue => issue.level !== 'warning');
}

export function upsertDraft(drafts, draft) {
  const list = Array.isArray(drafts) ? drafts.slice() : [];
  const index = list.findIndex(item => item.id === draft.id);
  if (index >= 0) list[index] = draft; else list.unshift(draft);
  return list.slice(0, 100);
}

export function submissionKey(draft) {
  const first = (draft.product?.skus ?? []).find(sku => text(sku.supplierSku));
  return first ? text(first.supplierSku) : '';
}

export function markSubmitted(draft, result, now = Date.now()) {
  if (!canTransition(draft.status, 'submitted')) throw new Error('只有待审核的草稿才能提交。');
  const submitted = transition(draft, 'submitted', '已提交希音审核', now);
  return {
    ...submitted,
    submission: {
      key: submissionKey(draft),
      at: now,
      spuName: result?.spuName ?? '',
      skcNames: result?.skcNames ?? [],
      skuCodes: result?.skuCodes ?? [],
      documentState: 'PENDING',
      rejectedReason: ''
    }
  };
}

export function applyDocumentState(draft, state, now = Date.now()) {
  const status = String(state?.status ?? '').toUpperCase();
  const reason = text(state?.reason);
  const submission = { ...(draft.submission ?? {}), documentState: status || 'PENDING', rejectedReason: reason };
  if (status === 'APPROVED' && canTransition(draft.status, 'approved')) return { ...transition(draft, 'approved', '希音审核通过', now), submission };
  if (status === 'REJECTED' && canTransition(draft.status, 'rejected')) return { ...transition(draft, 'rejected', reason || '希音驳回', now), submission };
  return { ...draft, submission, updated: now };
}

import { buildSignMessage, composeSignature, randomKey, signHeaders, signJsonHeaders } from './shein-sign.mjs';

export const SHEIN_BASE_URL = 'https://openapi.sheincorp.com';
export const SHEIN_TEST_BASE_URL = 'https://openapi-test01.sheincorp.cn';
export const SECRET_CREDENTIAL = 'shein-secret-key';

export const PATHS = Object.freeze({
  publishPermission: '/open-api/goods/product/check-publish-permission',
  fillInStandard: '/open-api/goods/query-publish-fill-in-standard',
  categoryTree: '/open-api/goods/query-category-tree',
  categorySuggestion: '/open-api/goods/image-category-suggestion',
  attributeTemplate: '/open-api/goods/query-attribute-template',
  supplierSkuRepeated: '/open-api/goods/product/check-supplierSku-repeated',
  uploadPic: '/open-api/goods/upload-pic',
  publish: '/open-api/goods/product/publishOrEdit',
  documentState: '/open-api/goods/query-document-state',
  quota: '/open-api/goods-publish-quotas/detail'
});

export function decodeBase64Utf8(data) {
  if (typeof data !== 'string' || !data) return '';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

export class SheinError extends Error {
  constructor(message, code = '') {
    super(message);
    this.name = 'SheinError';
    this.code = String(code ?? '');
  }
}

export function parseEnvelope(response) {
  if (!response || typeof response.status !== 'number') throw new SheinError('希音接口没有返回结果。');
  if (response.status === 401 || response.status === 403) throw new SheinError('希音凭据无效或未授权，请检查 openKeyId 与 secretKey。', String(response.status));
  if (response.status === 429) throw new SheinError('希音接口请求过于频繁，请稍后手动重试。', '429');
  if (response.status >= 500) throw new SheinError('希音服务暂时不可用（' + response.status + '）。', String(response.status));
  if (response.status < 200 || response.status >= 300) throw new SheinError('希音接口调用失败（' + response.status + '）。', String(response.status));
  let payload;
  try { payload = JSON.parse(decodeBase64Utf8(response.data)); }
  catch { throw new SheinError('希音接口返回了无法解析的内容。'); }
  const code = payload?.code;
  if (code !== undefined && code !== null && String(code) !== '0') throw new SheinError(String(payload?.msg || payload?.message || '希音接口返回错误。'), String(code));
  return payload?.info !== undefined ? payload.info : payload?.data;
}

export function createSheinClient({ client, openKeyId, baseUrl = SHEIN_BASE_URL, now = () => Date.now() }) {
  const keyId = typeof openKeyId === 'string' ? openKeyId.trim() : '';
  if (!keyId) throw new SheinError('请先配置希音 openKeyId。');
  const origin = String(baseUrl).replace(/\/+$/, '');

  async function post(path, body, { multipart } = {}) {
    const timestamp = String(now());
    const random = randomKey(5);
    const message = buildSignMessage({ openKeyId: keyId, timestamp, path });
    const signed = await client.network.sign({ credential: SECRET_CREDENTIAL, algorithm: 'hmac-sha256', message, keySuffix: random });
    const signature = composeSignature(random, signed.digest);
    const sign = { openKeyId: keyId, timestamp, signature };
    const options = {
      url: origin + path,
      method: 'POST',
      headers: multipart ? signHeaders(sign) : signJsonHeaders(sign)
    };
    if (multipart) options.multipart = multipart; else options.json = body ?? {};
    return parseEnvelope(await client.network.request(options));
  }

  return Object.freeze({
    baseUrl: origin,
    checkPublishPermission: (body = {}) => post(PATHS.publishPermission, body),
    queryFillInStandard: body => post(PATHS.fillInStandard, body),
    queryCategoryTree: () => post(PATHS.categoryTree, {}),
    suggestCategory: body => post(PATHS.categorySuggestion, body),
    queryAttributeTemplate: productTypeIds => post(PATHS.attributeTemplate, { product_type_id_list: productTypeIds }),
    checkSupplierSkuRepeated: supplierSkus => post(PATHS.supplierSkuRepeated, { supplierSkuList: supplierSkus }),
    uploadPic: ({ token, imageType }) => post(PATHS.uploadPic, undefined, { multipart: { fields: { image_type: String(imageType) }, files: [{ field: 'file', token }] } }),
    publish: payload => post(PATHS.publish, payload),
    queryDocumentState: body => post(PATHS.documentState, body),
    quota: () => post(PATHS.quota, {})
  });
}

export function parsePermission(info) {
  if (info && typeof info === 'object') {
    if (typeof info.can_publish === 'boolean') return { allowed: info.can_publish, message: String(info.reason || info.msg || '') };
    if (typeof info.canPublish === 'boolean') return { allowed: info.canPublish, message: String(info.reason || info.msg || '') };
    if (typeof info.success === 'boolean') return { allowed: info.success, message: String(info.msg || '') };
  }
  return { allowed: true, message: '' };
}

export function parseQuota(info) {
  if (!info || typeof info !== 'object') return { remaining: null, total: null, used: null };
  const pick = (...keys) => {
    for (const key of keys) {
      const value = info[key];
      if (value !== undefined && value !== null && value !== '') return Number(value);
    }
    return null;
  };
  const remaining = pick('remaining_quota', 'remainingQuota', 'remaining', 'available_quantity');
  const total = pick('total_quota', 'totalQuota', 'total');
  const used = pick('used_quota', 'usedQuota', 'used');
  return { remaining: Number.isFinite(remaining) ? remaining : null, total: Number.isFinite(total) ? total : null, used: Number.isFinite(used) ? used : null };
}

// 供货价币种由希音按类目下发，不能假设所有店铺都是美元。
export function parseFillInStandard(info) {
  if (!info || typeof info !== 'object') return { currency: '' };
  const raw = info.currency ?? info.currency_code ?? info.currencyCode ?? info.price_currency ?? info.priceCurrency;
  const currency = String(raw ?? '').trim().toUpperCase();
  return { currency: /^[A-Z]{3}$/.test(currency) ? currency : '' };
}

export function parseRepeated(info) {
  if (Array.isArray(info)) return info.filter(Boolean);
  if (!info || typeof info !== 'object') return info ? ['unknown'] : [];
  const list = info.repeated_supplier_sku_list ?? info.repeatedSupplierSkuList ?? info.existed_list ?? info.existedList;
  if (Array.isArray(list)) return list.map(value => String(value)).filter(Boolean);
  if (info.repeated === true || info.exists === true || info.existed === true) return ['unknown'];
  return [];
}

export function parseUploadedUrl(info) {
  if (typeof info === 'string' && /^https:\/\//.test(info)) return info;
  if (!info || typeof info !== 'object') return '';
  const candidates = [info.image_url, info.imageUrl, info.url, info.pic_url, info.picUrl];
  for (const value of candidates) if (typeof value === 'string' && /^https:\/\//.test(value)) return value;
  if (Array.isArray(info.url_list) && typeof info.url_list[0] === 'string') return info.url_list[0];
  if (info.image_info && typeof info.image_info === 'object') return parseUploadedUrl(info.image_info);
  return '';
}

export function parsePublishResult(info) {
  if (!info || typeof info !== 'object') return { spuName: '', skcNames: [], skuCodes: [] };
  const spuName = String(info.spu_name ?? info.spuName ?? '');
  const skcs = info.skc_list ?? info.skcList ?? [];
  const skus = info.sku_list ?? info.skuList ?? [];
  return {
    spuName,
    skcNames: (Array.isArray(skcs) ? skcs : []).map(item => String(item?.skc_name ?? item?.skcName ?? '')).filter(Boolean),
    skuCodes: (Array.isArray(skus) ? skus : []).map(item => String(item?.sku_code ?? item?.skuCode ?? '')).filter(Boolean)
  };
}

export function parseDocumentState(info) {
  if (!info || typeof info !== 'object') return { status: 'PENDING', reason: '' };
  const raw = info.document_state ?? info.documentState ?? info.state ?? info.audit_state ?? info.auditState ?? '';
  const status = String(raw).toUpperCase();
  const reason = String(info.reject_reason ?? info.reason ?? info.rejectReason ?? info.remark ?? '');
  const mapped = status === '2' || status === 'APPROVED' || status === 'PASS' || status === 'PASSED' ? 'APPROVED'
    : status === '3' || status === 'REJECTED' || status === 'REJECT' || status === 'FAILED' ? 'REJECTED'
      : 'PENDING';
  return { status: mapped, reason };
}

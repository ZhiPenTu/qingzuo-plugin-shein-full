export const SIGN_HEADERS = Object.freeze({
  openKeyId: 'x-lt-openKeyId',
  timestamp: 'x-lt-timestamp',
  signature: 'x-lt-signature'
});

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function randomKey(size = 5) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  let value = '';
  for (const byte of bytes) value += ALPHABET[byte % ALPHABET.length];
  return value;
}

// SHEIN signs "openKeyId&timestamp&path" with key "secretKey + randomKey".
export function buildSignMessage({ openKeyId, timestamp, path }) {
  if (typeof openKeyId !== 'string' || !openKeyId.trim()) throw new Error('请先配置希音 openKeyId。');
  if (!/^\d{13}$/.test(String(timestamp))) throw new Error('签名时间戳无效。');
  if (typeof path !== 'string' || !path.startsWith('/open-api/')) throw new Error('签名路径无效。');
  return openKeyId.trim() + '&' + timestamp + '&' + path;
}

export function base64ToHex(value) {
  if (typeof value !== 'string' || !BASE64.test(value)) throw new Error('签名结果无效。');
  const binary = atob(value);
  let hex = '';
  for (let index = 0; index < binary.length; index += 1) hex += binary.charCodeAt(index).toString(16).padStart(2, '0');
  return hex;
}

// The host returns the raw HMAC digest as base64; SHEIN wants
// randomKey + base64(hex(digest)).
export function composeSignature(random, digestBase64) {
  if (typeof random !== 'string' || !/^[A-Za-z0-9]{5}$/.test(random)) throw new Error('签名随机串无效。');
  return random + btoa(base64ToHex(digestBase64));
}

// Multipart uploads must let the host set Content-Type with its boundary,
// so the JSON content type is added only for JSON requests.
export function signHeaders({ openKeyId, timestamp, signature }) {
  return {
    language: 'zh-cn',
    [SIGN_HEADERS.openKeyId]: openKeyId,
    [SIGN_HEADERS.timestamp]: timestamp,
    [SIGN_HEADERS.signature]: signature
  };
}

export function signJsonHeaders(options) {
  return { ...signHeaders(options), 'Content-Type': 'application/json;charset=UTF-8' };
}

// 希音授权：拼授权链接、读回回调里的 tempToken、用 APP_SecretKey 解密下发的
// 店铺 secretKey。密文用「APP_SecretKey 的 UTF-8 前 16 字节」做 AES-128-CBC 加密，
// IV 固定为 space-station-de，PKCS7 补齐。解密只在连接店铺的这一次发生，
// 结果直接存进系统凭据库，不再参与签名前的任何读取。
const BASE64 = /^[A-Za-z0-9+/\s]*={0,2}$/;
const IV_SEED = 'space-station-de';
const AES_KEY_BYTES = 16;
const STATE_BYTES = 12;
const AUTHORIZE_ROUTE = '#/empower';
const CALLBACK_FLAG = 'from=qingzuo';
// 回调落在接口域名上不存在的路径：接口只回一个 401，地址栏里的 tempToken
// 原样留着；授权站点会把未知路径 302 到登录页，参数就没了。
const CALLBACK_PATH = '/plugin/callback';

// 授权页与接口域名不是同一个：正式环境的授权页在 openapi-sem，测试环境两者一致。
export const AUTHORIZE_ORIGINS = Object.freeze({
  'https://openapi.sheincorp.com': 'https://openapi-sem.sheincorp.com',
  'https://openapi.sheincorp.cn': 'https://openapi-sem.sheincorp.com',
  'https://openapi-test01.sheincorp.cn': 'https://openapi-test01.sheincorp.cn'
});

export function authorizeOriginOf(baseUrl) {
  const origin = new URL(String(baseUrl)).origin;
  return AUTHORIZE_ORIGINS[origin] ?? origin;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// 授权一次一个随机值，回调里回来对不上就不是这次授权的结果。
export function createAuthorizationState(random = globalThis.crypto) {
  if (!random?.getRandomValues) throw new Error('当前环境无法生成授权请求，请在轻作桌面端里操作。');
  const bytes = new Uint8Array(STATE_BYTES);
  random.getRandomValues(bytes);
  return 'qz' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// 回调地址指向接口域名本身：插件在内嵌浏览器里读回跳转后的地址，
// 不需要在本机开监听端口，也不要求回调页能渲染出内容。
export function callbackUrlOf(baseUrl) {
  return new URL(String(baseUrl)).origin + CALLBACK_PATH + '?' + CALLBACK_FLAG;
}

export function authorizationUrl({ appId, baseUrl, state, callbackUrl }) {
  const value = String(appId ?? '').trim();
  if (!value) throw new Error('请先填写希音 APP_ID。');
  const nonce = String(state ?? '').trim();
  if (!nonce) throw new Error('授权请求无效，请重新连接希音。');
  const origin = authorizeOriginOf(baseUrl);
  const redirect = encodeURIComponent(bytesToBase64(new TextEncoder().encode(callbackUrl ?? callbackUrlOf(baseUrl))));
  return `${origin}/${AUTHORIZE_ROUTE}?appid=${encodeURIComponent(value)}&redirectUrl=${redirect}&state=${encodeURIComponent(nonce)}`;
}

function readParam(text, name) {
  const match = new RegExp('[?&#]' + name + '=([^&#]*)', 'i').exec(text);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

// 解析回调地址：希音把 tempToken 与 state 追加在 redirectUrl 后面，
// 不同环境拼接的符号不完全一致，所以整条地址都按参数形态扫一遍。
export function readAuthorizationCallback(address, expectedState) {
  if (typeof address !== 'string' || !address) return null;
  const tempToken = readParam(address, 'tempToken').trim();
  if (!tempToken) return null;
  const state = readParam(address, 'state').trim();
  if (expectedState !== undefined && state !== String(expectedState)) return null;
  return { tempToken, state };
}

export function base64ToBytes(value) {
  if (typeof value !== 'string' || !BASE64.test(value)) throw new Error('希音返回的密钥格式无效，请重新授权。');
  const binary = atob(value.replace(/\s+/g, ''));
  if (!binary.length) throw new Error('希音返回的密钥为空，请重新授权。');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function aesKeyOf(appSecretKey) {
  const raw = new TextEncoder().encode(String(appSecretKey ?? '').trim());
  if (raw.length < AES_KEY_BYTES) throw new Error('希音 APP_SecretKey 长度不足，请确认已完整复制。');
  return raw.slice(0, AES_KEY_BYTES);
}

export async function decryptSecretKey(encrypted, appSecretKey, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('当前环境无法解密希音密钥，请在轻作桌面端里操作。');
  const key = await subtle.importKey('raw', aesKeyOf(appSecretKey), { name: 'AES-CBC' }, false, ['decrypt']);
  let plain;
  try {
    // Web Crypto 的 AES-CBC 在解密时会校验并去掉 PKCS7 补齐，密钥不对会直接报错。
    plain = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: new TextEncoder().encode(IV_SEED) }, key, base64ToBytes(encrypted)));
  } catch (error) {
    if (error instanceof Error && /密钥格式|密钥为空|长度不足/.test(error.message)) throw error;
    throw new Error('希音返回的密钥无法解密，请确认 APP_ID 与 APP_SecretKey 属于同一个应用。');
  }
  const text = new TextDecoder().decode(plain).trim();
  if (!text) throw new Error('希音返回的密钥为空，请重新授权。');
  return text;
}

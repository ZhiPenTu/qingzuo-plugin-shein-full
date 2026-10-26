import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import {
  aesKeyOf, authorizationUrl, base64ToBytes, callbackUrlOf, createAuthorizationState, decryptSecretKey, readAuthorizationCallback
} from '../ui/shein-auth.mjs';

// 与希音开放平台一致：APP_SecretKey 的 UTF-8 前 16 字节做 AES-128-CBC 密钥，
// IV 固定，PKCS7 补齐。
const APP_SECRET = '50CBFA17A9C3423EB14608B481DF364F';
const SECRET_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const IV = Buffer.from('space-station-de', 'utf8');

function encrypt(text, appSecretKey = APP_SECRET) {
  const key = Buffer.from(appSecretKey, 'utf8').subarray(0, 16);
  const cipher = createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

test('用 APP_SecretKey 解密希音下发的 secretKey', async () => {
  assert.equal(await decryptSecretKey(encrypt(SECRET_KEY), APP_SECRET), SECRET_KEY);
});

test('跨多个分组长度的密钥也能完整解密', async () => {
  const long = '0123456789abcdef'.repeat(4);
  assert.equal(await decryptSecretKey(encrypt(long), APP_SECRET), long);
  assert.equal(await decryptSecretKey(encrypt('x'), APP_SECRET), 'x');
});

test('APP_SecretKey 与 APP_ID 不匹配时给出可操作的提示', async () => {
  const encrypted = encrypt(SECRET_KEY, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
  await assert.rejects(() => decryptSecretKey(encrypted, APP_SECRET), /无法解密/);
});

test('密钥长度不足或密文格式不对时拒绝解密', async () => {
  assert.throws(() => aesKeyOf('too-short'), /长度不足/);
  assert.throws(() => base64ToBytes('not base64!!'), /格式无效/);
  assert.throws(() => base64ToBytes(''), /密钥为空/);
  await assert.rejects(() => decryptSecretKey('%%%%', APP_SECRET), /格式无效/);
  await assert.rejects(() => decryptSecretKey(encrypt(''), APP_SECRET), /密钥为空/);
});

test('解密只截取 APP_SecretKey 前 16 字节', () => {
  assert.equal(aesKeyOf(APP_SECRET).length, 16);
  assert.equal(Buffer.from(aesKeyOf(APP_SECRET)).toString('utf8'), APP_SECRET.slice(0, 16));
  assert.equal(Buffer.from(aesKeyOf('  ' + APP_SECRET + '  ')).toString('utf8'), APP_SECRET.slice(0, 16));
});

test('授权链接带上应用的 appid、回调地址与本次授权的 state', () => {
  const callbackUrl = callbackUrlOf('https://openapi.sheincorp.cn');
  // 授权页在 openapi-sem，正式回调用接口侧已注册的 .com 地址。
  assert.equal(callbackUrl, 'https://openapi.sheincorp.com/plugin/callback?from=qingzuo');
  const address = new URL(authorizationUrl({ appId: '10ADAABD6E000B247A428884951B4', baseUrl: 'https://openapi.sheincorp.cn', state: 'qz-1', callbackUrl }));
  assert.equal(address.origin, 'https://openapi-sem.sheincorp.com');
  assert.equal(address.pathname, '/');
  assert.equal(address.hash, `#/empower?appid=10ADAABD6E000B247A428884951B4&redirectUrl=${encodeURIComponent(btoa(callbackUrl))}&state=qz-1`);
  const params = new URLSearchParams(address.hash.slice(address.hash.indexOf('?') + 1));
  assert.equal(params.get('appid'), '10ADAABD6E000B247A428884951B4');
  assert.equal(params.get('state'), 'qz-1');
  assert.equal(atob(params.get('redirectUrl')), 'https://openapi.sheincorp.com/plugin/callback?from=qingzuo');
  // 回调地址按当前环境生成，不能把测试环境的授权结果发到正式环境；测试环境授权页与接口同域。
  assert.equal(callbackUrlOf('https://openapi-test01.sheincorp.cn/'), 'https://openapi-test01.sheincorp.cn/plugin/callback?from=qingzuo');
  assert.equal(new URL(authorizationUrl({ appId: 'APP', baseUrl: 'https://openapi-test01.sheincorp.cn', state: 'qz-2' })).origin, 'https://openapi-test01.sheincorp.cn');
  assert.throws(() => authorizationUrl({ appId: '', baseUrl: 'https://openapi.sheincorp.cn', state: 'qz-1' }), /APP_ID/);
  assert.throws(() => authorizationUrl({ appId: 'APP', baseUrl: 'https://openapi.sheincorp.cn', state: '' }), /重新连接/);
});

test('授权 state 每次都不同', () => {
  const seen = new Set();
  for (let index = 0; index < 20; index += 1) seen.add(createAuthorizationState());
  assert.equal(seen.size, 20);
  for (const value of seen) assert.match(value, /^qz[0-9a-f]{24}$/);
});

test('只接收带本次 state 的回调地址', () => {
  assert.deepEqual(readAuthorizationCallback('https://openapi.sheincorp.com/?from=qingzuo&tempToken=TMP-1&state=qz-1', 'qz-1'), { tempToken: 'TMP-1', state: 'qz-1' });
  // 希音把参数拼在 hash 路由后面时同样能读到。
  assert.deepEqual(readAuthorizationCallback('https://openapi.sheincorp.com/#/callback?tempToken=TMP-2&state=qz-2', 'qz-2'), { tempToken: 'TMP-2', state: 'qz-2' });
  // 拼接符号不规范时也不能漏掉授权码。
  assert.deepEqual(readAuthorizationCallback('https://openapi.sheincorp.com/?from=qingzuo?tempToken=TMP-3&state=qz-3', 'qz-3'), { tempToken: 'TMP-3', state: 'qz-3' });
  assert.deepEqual(readAuthorizationCallback('https://openapi.sheincorp.com/?tempToken=a%2Bb%3D&state=qz-4', 'qz-4'), { tempToken: 'a+b=', state: 'qz-4' });
  assert.equal(readAuthorizationCallback('https://openapi.sheincorp.com/?from=qingzuo&tempToken=TMP-1&state=qz-older', 'qz-1'), null);
  assert.equal(readAuthorizationCallback('https://openapi.sheincorp.com/?from=qingzuo&tempToken=TMP-1', 'qz-1'), null);
  assert.equal(readAuthorizationCallback('https://openapi.sheincorp.com/?from=qingzuo', 'qz-1'), null);
  assert.equal(readAuthorizationCallback('', 'qz-1'), null);
});

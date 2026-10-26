import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeWithTempToken, createSheinClient, decodeBase64Utf8, parseAuthorization, parseDocumentState, parseEnvelope,
  parseFillInStandard, parsePermission, parsePublishResult, parseQuota, parseRepeated, parseUploadedUrl, PATHS,
  SHEIN_BASE_URL, SheinError
} from '../ui/shein-client.mjs';
import { createFakeClient, ok, businessError } from './support/fake-host.mjs';

function gateway(respond) {
  const fake = createFakeClient({ respond });
  fake.secrets.set('shein-secret-key', 'test-secret');
  const client = createSheinClient({ client: fake.client, openKeyId: 'KEYID', now: () => 1740709414000 });
  return { ...fake, gateway: client };
}

test('发品请求带上希音签名头与 JSON Content-Type', async () => {
  const { gateway: client, calls } = gateway(() => ok({ spu_name: 'SPU-1' }));
  const result = await client.publish({ category_id: 1 });
  assert.equal(result.spu_name, 'SPU-1');
  const [request] = calls.network;
  assert.equal(request.url, SHEIN_BASE_URL + PATHS.publish);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['Content-Type'], 'application/json;charset=UTF-8');
  assert.equal(request.headers['x-lt-openKeyId'], 'KEYID');
  assert.equal(request.headers['x-lt-timestamp'], '1740709414000');
  const signature = request.headers['x-lt-signature'];
  assert.equal(signature.length, 5 + 88);
  assert.equal(Buffer.from(signature.slice(5), 'base64').toString('utf8').length, 64);
  assert.deepEqual(request.json, { category_id: 1 });
});

test('类目树请求走店铺签名并发送空 JSON', async () => {
  const { gateway: client, calls } = gateway(() => ok({ data: [] }));
  await client.queryCategoryTree();
  const [request] = calls.network;
  assert.equal(request.url, SHEIN_BASE_URL + PATHS.categoryTree);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['x-lt-openKeyId'], 'KEYID');
  assert.equal(request.headers.language, 'zh-cn');
  assert.deepEqual(request.json, {});
});

test('图片上传走 multipart，不覆盖宿主的 Content-Type boundary', async () => {
  const { gateway: client, calls } = gateway(() => ok({ image_url: 'https://img.shein.test/a.jpg' }));
  const info = await client.uploadPic({ token: 'file-7', imageType: 1 });
  assert.equal(parseUploadedUrl(info), 'https://img.shein.test/a.jpg');
  const [request] = calls.network;
  assert.equal(request.url, SHEIN_BASE_URL + PATHS.uploadPic);
  assert.deepEqual(request.multipart, { fields: { image_type: '1' }, files: [{ field: 'file', token: 'file-7' }] });
  assert.equal('Content-Type' in request.headers, false);
  assert.equal(request.json, undefined);
});

test('未配置密钥时签名在宿主侧失败，不会发出请求', async () => {
  const fake = createFakeClient({ respond: () => ok({}) });
  const client = createSheinClient({ client: fake.client, openKeyId: 'KEYID' });
  await assert.rejects(() => client.quota(), /凭据/);
  assert.equal(fake.calls.network.length, 0);
});

test('业务错误码与 HTTP 错误都转成带原因的异常', async () => {
  const { gateway: client } = gateway(() => businessError(11001, '供货 SKU 已存在'));
  await assert.rejects(() => client.publish({}), error => error instanceof SheinError && error.code === '11001' && /供货 SKU/.test(error.message));
  const { gateway: unauthorized } = gateway(() => ({ status: 401, mime: 'application/json', data: '' }));
  await assert.rejects(() => unauthorized.quota(), /凭据无效/);
  assert.throws(() => parseEnvelope({ status: 200, data: 'not-base64-json' }), /无法解析/);
});

test('Base64 信封解码为 UTF-8 文本', () => {
  assert.equal(decodeBase64Utf8(Buffer.from('{"code":"0"}', 'utf8').toString('base64')), '{"code":"0"}');
  assert.equal(decodeBase64Utf8(''), '');
});

test('响应解析容错不同字段命名', () => {
  assert.deepEqual(parsePermission({ can_publish: false, reason: '未签约' }), { allowed: false, message: '未签约' });
  assert.equal(parsePermission(null).allowed, true);
  assert.deepEqual(parseQuota({ remaining_quota: 8, total_quota: 10, used_quota: 2 }), { remaining: 8, total: 10, used: 2 });
  assert.deepEqual(parseRepeated({ repeated_supplier_sku_list: ['A-01'] }), ['A-01']);
  assert.deepEqual(parseRepeated({ existed: true }), ['unknown']);
  assert.equal(parseUploadedUrl({ image_info: { image_url: 'https://img/x.jpg' } }), 'https://img/x.jpg');
  assert.deepEqual(parsePublishResult({ spu_name: 'SPU', skc_list: [{ skc_name: 'SKC' }], sku_list: [{ sku_code: 'SKU' }] }), { spuName: 'SPU', skcNames: ['SKC'], skuCodes: ['SKU'] });
  assert.deepEqual(parseDocumentState({ document_state: '2' }), { status: 'APPROVED', reason: '' });
  assert.deepEqual(parseDocumentState({ audit_state: 'REJECTED', reject_reason: '图片模糊' }), { status: 'REJECTED', reason: '图片模糊' });
  assert.deepEqual(parseDocumentState({}), { status: 'PENDING', reason: '' });
  assert.equal(parseFillInStandard({ currency: 'usd' }).currency, 'USD');
  assert.equal(parseFillInStandard({ currency: 'RMB' }).currency, 'RMB');
  assert.equal(parseFillInStandard({ currency: '人民币' }).currency, '');
});

test('应用授权：用 APP_ID 顶替签名身份，请求头带 x-lt-appid', async () => {
  const fake = createFakeClient({ respond: () => ok({ openKeyId: 'STORE-KEY', secretKey: 'ZW5jcnlwdGVk', supplierId: 7788 }) });
  fake.secrets.set('shein-app-secret', 'APP-SECRET');
  const info = await authorizeWithTempToken({ client: fake.client, appId: ' APP-ID ', tempToken: ' TMP-TOKEN ', now: () => 1740709414000 });
  assert.deepEqual(info, { openKeyId: 'STORE-KEY', secretKey: 'ZW5jcnlwdGVk', supplierId: 7788 });
  const [request] = fake.calls.network;
  assert.equal(request.url, SHEIN_BASE_URL + PATHS.authorize);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['x-lt-appid'], 'APP-ID');
  assert.equal(request.headers['x-lt-openKeyId'], undefined);
  assert.equal(request.headers['x-lt-timestamp'], '1740709414000');
  assert.equal(request.headers['Content-Type'], 'application/json;charset=UTF-8');
  assert.deepEqual(request.json, { tempToken: 'TMP-TOKEN' });
  assert.equal(request.headers['x-lt-signature'].length, 5 + 88);
});

test('没有保存 APP_SecretKey 时授权在宿主侧失败，不会发出请求', async () => {
  const fake = createFakeClient({ respond: () => ok({}) });
  await assert.rejects(() => authorizeWithTempToken({ client: fake.client, appId: 'APP-ID', tempToken: 'TMP' }), /凭据/);
  assert.equal(fake.calls.network.length, 0);
  await assert.rejects(() => authorizeWithTempToken({ client: fake.client, appId: '  ', tempToken: 'TMP' }), /APP_ID/);
  await assert.rejects(() => authorizeWithTempToken({ client: fake.client, appId: 'APP-ID', tempToken: ' ' }), /授权码/);
});

test('授权结果解析容错字段命名，缺凭据时中断', () => {
  assert.deepEqual(parseAuthorization({ openKeyId: 'K', secretKey: 'S', supplierId: 9 }), { openKeyId: 'K', secretKey: 'S', supplierId: 9 });
  assert.deepEqual(parseAuthorization({ open_key_id: 'K', secret_key: 'S' }), { openKeyId: 'K', secretKey: 'S', supplierId: null });
  assert.throws(() => parseAuthorization({ openKeyId: 'K' }), /没有返回店铺凭据/);
  assert.throws(() => parseAuthorization(null), /没有返回内容/);
});

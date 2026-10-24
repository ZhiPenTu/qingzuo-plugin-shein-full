import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSheinClient, decodeBase64Utf8, parseDocumentState, parseEnvelope, parseFillInStandard, parsePermission,
  parsePublishResult, parseQuota, parseRepeated, parseUploadedUrl, PATHS, SHEIN_BASE_URL, SheinError
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

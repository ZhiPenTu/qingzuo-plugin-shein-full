import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildSignMessage, composeSignature, base64ToHex, signHeaders, signJsonHeaders } from '../ui/shein-sign.mjs';

const VECTOR = Object.freeze({
  openKeyId: 'B96C15416C9240DF96BAA0BC9B367C6D',
  secretKey: '6BEC9C4B668B4B14B17EEF106BB98AE5',
  timestamp: '1740709414000',
  path: '/open-api/order/purchase-order-info',
  randomKey: 'test1',
  signature: 'test1ZDZjYTJjNzg5ZjUzMDdkZTU2N2Y3NzcxN2ZjZjA5OGIxMTRhZWI0MTU1MzQxNjZlNjFkMGQxOTJiYTk1YWNjYQ=='
});

test('希音官方签名示例可用本地 HMAC 复现', () => {
  const message = buildSignMessage(VECTOR);
  assert.equal(message, VECTOR.openKeyId + '&' + VECTOR.timestamp + '&' + VECTOR.path);
  const digest = createHmac('sha256', VECTOR.secretKey + VECTOR.randomKey).update(message, 'utf8').digest('base64');
  assert.equal(composeSignature(VECTOR.randomKey, digest), VECTOR.signature);
});

test('签名串拼接顺序与随机串长度必须符合希音规范', () => {
  assert.throws(() => buildSignMessage({ openKeyId: '', timestamp: '1740709414000', path: VECTOR.path }), /openKeyId/);
  assert.throws(() => buildSignMessage({ openKeyId: VECTOR.openKeyId, timestamp: '1740709414', path: VECTOR.path }), /时间戳/);
  assert.throws(() => buildSignMessage({ openKeyId: VECTOR.openKeyId, timestamp: VECTOR.timestamp, path: '/api/x' }), /路径/);
  assert.throws(() => composeSignature('toolong', 'AAAA'), /随机串/);
});

test('摘要转十六进制后按 Base64 复编码', () => {
  assert.equal(base64ToHex('AQID'), '010203');
  assert.equal(composeSignature('abcde', 'AQID'), 'abcde' + Buffer.from('010203').toString('base64'));
  assert.throws(() => base64ToHex('not base64 !'), /签名结果/);
});

test('JSON 请求声明 Content-Type，multipart 交给宿主设置 boundary', () => {
  const sign = { openKeyId: 'K', timestamp: '1', signature: 's' };
  assert.deepEqual(signHeaders(sign), { language: 'zh-cn', 'x-lt-openKeyId': 'K', 'x-lt-timestamp': '1', 'x-lt-signature': 's' });
  assert.equal(signJsonHeaders(sign)['Content-Type'], 'application/json;charset=UTF-8');
  assert.ok(!('Content-Type' in signHeaders(sign)));
});

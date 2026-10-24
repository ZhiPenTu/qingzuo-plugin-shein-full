import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readImageSize, validateImage, imageTypeFor, imageNeedsConversion, base64Bytes, bytesToBase64, MAX_IMAGE_BYTES } from '../ui/images.mjs';
import { PNG_1X1 } from './support/fake-host.mjs';

test('PNG 尺寸从 IHDR 读取', () => {
  const size = readImageSize(PNG_1X1);
  assert.equal(size.mime, 'image/png');
  assert.equal(size.width, 1);
  assert.equal(size.height, 1);
});

test('JPEG 尺寸从 SOF0 段读取', () => {
  const bytes = new Uint8Array(32);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x07, 0x38, 0x05, 0x3c], 8);
  const size = readImageSize(bytesToBase64(bytes));
  assert.equal(size.mime, 'image/jpeg');
  assert.equal(size.height, 0x0738);
  assert.equal(size.width, 0x053c);
});

test('希音图片限制：JPG/PNG、3 MB 以内', () => {
  assert.deepEqual(validateImage({ token: 'f', mime: 'image/png', size: 1024, role: 'detail' }), []);
  assert.equal(validateImage({ mime: 'image/png', size: 1024 }).some(issue => issue.level === 'error'), true);
  assert.equal(validateImage({ token: 'f', mime: 'image/gif', size: 10 }).some(issue => issue.message.includes('JPG')), true);
  assert.equal(validateImage({ token: 'f', mime: 'image/png', size: MAX_IMAGE_BYTES + 1 }).some(issue => issue.message.includes('3 MB')), true);
  assert.equal(validateImage({ token: 'f', mime: 'image/png', size: 10, role: 'main', width: 800, height: 800 }).some(issue => issue.level === 'warning'), true);
});

test('图片类型按希音枚举映射，非 JPG/PNG 需要转换', () => {
  assert.equal(imageTypeFor('main'), 1);
  assert.equal(imageTypeFor('detail'), 2);
  assert.equal(imageTypeFor('unknown'), 2);
  assert.equal(imageNeedsConversion({ mime: 'image/webp' }), true);
  assert.equal(imageNeedsConversion({ mime: 'image/jpeg' }), false);
});

test('Base64 与字节互转保持原样', () => {
  const bytes = base64Bytes(PNG_1X1);
  assert.equal(bytesToBase64(bytes), PNG_1X1);
});

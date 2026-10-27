import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTranslationResults, translationFailures, translationTargets, withSourceVersion, withTranslated } from '../ui/image-translate.mjs';

const IMAGES = [
  { id: 'img-1', role: 'main', token: 'file-1', mime: 'image/png', size: 1024, width: 1000, height: 1000, excluded: false, uploadedUrl: 'https://img.test/1.png', uploadedToken: 'file-1' },
  { id: 'img-2', role: 'detail', token: 'file-2', mime: 'image/png', size: 1024, width: 1000, height: 1000, excluded: true, uploadedUrl: '' },
  { id: 'img-3', role: 'detail', token: '', mime: 'image/png', size: 0, excluded: false }
];

test('处理范围只包含已转存且未排除的图片', () => {
  assert.deepEqual(translationTargets(IMAGES, { scope: 'current', imageId: 'img-1' }).map(image => image.id), ['img-1']);
  assert.deepEqual(translationTargets(IMAGES, { scope: 'current', imageId: 'img-2' }), []);
  assert.deepEqual(translationTargets(IMAGES, { scope: 'all' }).map(image => image.id), ['img-1']);
  assert.deepEqual(translationTargets(null, { scope: 'all' }), []);
});

test('写入译文后默认提交译文，并让旧的希音地址失效', () => {
  const next = withTranslated(IMAGES[0], { token: 'file-en', mime: 'image/jpeg', size: 2048, width: 1000, height: 1000 });
  assert.equal(next.useTranslated, true);
  assert.equal(next.translated.token, 'file-en');
  assert.equal(next.token, 'file-1');
  assert.equal(next.uploadedUrl, '');
  assert.equal(next.uploadedToken, '');
});

test('切成原图只改提交版本，译文仍保留', () => {
  const translated = withTranslated(IMAGES[0], { token: 'file-en', mime: 'image/jpeg', size: 2048 });
  const back = withSourceVersion(translated, false);
  assert.equal(back.useTranslated, false);
  assert.equal(back.translated.token, 'file-en');
  assert.equal(back.token, 'file-1');
  const again = withSourceVersion(back, true);
  assert.equal(again.useTranslated, true);
});

test('批量结果只覆盖对应图片，其它图片保持原样', () => {
  const merged = mergeTranslationResults(IMAGES, [{ imageId: 'img-1', translated: { token: 'file-en' } }, { imageId: 'img-2', translated: { token: '' } }]);
  assert.equal(merged[0].translated.token, 'file-en');
  assert.equal(merged[1].translated, undefined);
  assert.equal(merged[2], IMAGES[2]);
});

test('失败的批量项带出可读原因', () => {
  const batch = { items: [{ name: 'a.png', state: 'failed', error: '模型拒绝处理' }, { name: 'b.png', state: 'succeeded' }, { name: 'c.png', state: 'save-failed', error: '' }] };
  const failures = translationFailures(batch);
  assert.equal(failures.length, 2);
  assert.equal(failures[0].message, '模型拒绝处理');
  assert.equal(failures[1].message, '没有生成译文');
  assert.deepEqual(translationFailures(null), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, parseTranslationContent, translateProduct } from '../ui/translate.mjs';

test('翻译结果必须是严格 JSON，缺标题或卖点直接报错', () => {
  assert.deepEqual(parseTranslationContent('```json\n{"title":"Cotton scarf","bullets":["Soft"],"description":"d","attributes":[]}\n```'), {
    title: 'Cotton scarf', bullets: ['Soft'], description: 'd', attributes: []
  });
  assert.throws(() => parseTranslationContent('not json'), /有效的 JSON/);
  assert.throws(() => parseTranslationContent('{"bullets":["x"]}'), /缺少标题/);
  assert.throws(() => parseTranslationContent('{"title":"Cotton scarf","bullets":[]}'), /缺少卖点/);
});

test('模型编造的属性名会被丢弃，只保留 1688 原始属性', () => {
  const content = JSON.stringify({
    title: 'Cotton scarf',
    bullets: ['Soft'],
    attributes: [{ name: '材质', value: 'Cotton' }, { name: '品牌', value: 'Gucci' }]
  });
  const result = parseTranslationContent(content, { attributes: [{ name: '材质', value: '棉' }] });
  assert.deepEqual(result.attributes, [{ name: '材质', value: 'Cotton' }]);
});

test('提示词带上术语表并要求 JSON 输出', () => {
  const messages = buildMessages({ title: '围巾', attributes: [{ name: '材质', value: '棉' }] }, { 材质: 'Cotton' });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /材质 → Cotton/);
  assert.match(messages[0].content, /JSON/);
  assert.equal(messages[1].role, 'user');
  assert.equal(JSON.parse(messages[1].content).title, '围巾');
});

test('翻译通过底座文本 AI 补全，插件不持有地址与密钥', async () => {
  const calls = [];
  const content = '{"title":"Cotton scarf","bullets":["Soft cotton"],"description":"d","attributes":[]}';
  const client = {
    ai: {
      async complete(options) { calls.push(options); return { content, model: options.model ?? 'default-model' }; }
    }
  };
  const result = await translateProduct({ client, model: '', input: { title: '围巾' }, glossary: {} });
  assert.equal(result.title, 'Cotton scarf');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, undefined);
  assert.equal(calls[0].responseFormat.type, 'json_object');
  assert.equal(calls[0].temperature, 0.2);
  await translateProduct({ client, model: 'gpt-5.6-terra', input: { title: '围巾' }, glossary: {} });
  assert.equal(calls[1].model, 'gpt-5.6-terra');
});

test('底座 AI 的错误原因原样透出', async () => {
  const client = { ai: { async complete() { throw new Error('AI 服务密钥无效或未授权。'); } } };
  await assert.rejects(() => translateProduct({ client, model: '', input: { title: 'x' }, glossary: {} }), /密钥无效/);
});

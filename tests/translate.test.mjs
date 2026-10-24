import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, parseTranslationContent, providerOf, translateProduct } from '../ui/translate.mjs';

function chatResponse(content) {
  return { status: 200, mime: 'application/json', data: Buffer.from(JSON.stringify({ choices: [{ message: { content } }] }), 'utf8').toString('base64') };
}

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

test('翻译走插件自己的网络请求，不占用共享 AI 助手', async () => {
  const calls = [];
  const client = {
    network: {
      async request(options) { calls.push(options); return chatResponse('{"title":"Cotton scarf","bullets":["Soft cotton"],"description":"d","attributes":[]}'); }
    }
  };
  const result = await translateProduct({ client, provider: 'deepseek', input: { title: '围巾' }, glossary: {} });
  assert.equal(result.title, 'Cotton scarf');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].credential, 'deepseek-api-key');
  assert.equal(calls[0].json.response_format.type, 'json_object');
  assert.equal(calls[0].json.model, 'deepseek-chat');
});

test('翻译服务报错时给出可读原因', async () => {
  const client = { network: { async request() { return { status: 401, mime: 'application/json', data: '' }; } } };
  await assert.rejects(() => translateProduct({ client, provider: 'openai', input: { title: 'x' }, glossary: {} }), /密钥无效/);
  assert.equal(providerOf('unknown').id, 'openai');
});

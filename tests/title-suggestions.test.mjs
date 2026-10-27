import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_COUNT, buildTitleSuggestionMessages, parseTitleSuggestions, suggestTitles } from '../ui/title-suggestions.mjs';

const INPUT = {
  title: '纯棉针织围巾',
  attributes: [{ name: '材质', value: '棉' }],
  colors: ['米白'],
  categoryPath: ['服饰', '围巾']
};
const TITLES = [
  'Cream cotton knit scarf with ribbed texture',
  'Winter warm knit scarf for couples',
  'Soft everyday knit scarf in cream and black'
];

test('带图时同一张消息里既有商品信息也有图片片段', () => {
  const messages = buildTitleSuggestionMessages(INPUT, { imageUrl: 'data:image/png;base64,AAAA', glossary: { 材质: 'Cotton' } });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /材质 → Cotton/);
  const parts = messages[1].content;
  assert.equal(parts[0].type, 'text');
  assert.deepEqual(JSON.parse(parts[0].text), INPUT);
  assert.deepEqual(parts[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
});

test('没有图片时退回纯文本消息', () => {
  const messages = buildTitleSuggestionMessages(INPUT);
  assert.equal(typeof messages[1].content, 'string');
  assert.deepEqual(JSON.parse(messages[1].content), INPUT);
});

test('标题建议必须是三条互不相同的候选', () => {
  assert.deepEqual(parseTitleSuggestions('```json\n' + JSON.stringify({ titles: TITLES }) + '\n```'), TITLES);
  assert.throws(() => parseTitleSuggestions('不是 JSON'), /有效的 JSON/);
  assert.throws(() => parseTitleSuggestions(JSON.stringify({ titles: TITLES.slice(0, 2) })), /3 条/);
  // 重复和过短的候选会被丢掉，剩下的凑不够三条就报错，不拿半成品糊弄用户。
  assert.throws(() => parseTitleSuggestions(JSON.stringify({ titles: [TITLES[0], TITLES[0].toUpperCase(), TITLES[0], TITLES[1]] })), /3 条/);
});

test('模型读不了图时自动退回纯文字，其它错误照原样抛出', async () => {
  const calls = [];
  const client = {
    ai: {
      async complete(options) {
        calls.push(options);
        if (calls.length === 1) throw new Error('消息内容无效。');
        return { content: JSON.stringify({ titles: TITLES }) };
      }
    }
  };
  const result = await suggestTitles({ client, input: INPUT, imageUrl: 'data:image/png;base64,AAAA' });
  assert.equal(result.usedImage, false);
  assert.deepEqual(result.titles, TITLES);
  assert.equal(typeof calls[1].messages[1].content, 'string');

  const failing = { ai: { async complete() { throw new Error('AI 服务密钥无效或未授权。'); } } };
  await assert.rejects(suggestTitles({ client: failing, input: INPUT, imageUrl: 'data:image/png;base64,AAAA' }), /密钥无效/);
  assert.equal(TITLE_COUNT, 3);
});

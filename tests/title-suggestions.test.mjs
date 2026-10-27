import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_COUNT, buildTitleSuggestionMessages, parseTitleSuggestions, suggestTitles } from '../ui/title-suggestions.mjs';

const INPUT = {
  title: '纯棉针织围巾',
  attributes: [{ name: '材质', value: '棉' }],
  colors: ['米白'],
  categoryPath: ['服饰', '围巾']
};
const VERSIONS = [
  { angle: '主推爆款长标题', why: '英站首选，字符合规', title: 'Cream cotton knit scarf with ribbed texture, soft winter warm neck wrap for daily wear' },
  { angle: '加长 SEO 长尾款', why: '抓更多搜索词，流量更大', title: 'Winter warm knit scarf for couples, ribbed cream cotton neck wrap, soft everyday scarf for travel and outdoor' },
  { angle: '精简稳妥款', why: '不容易超字符，属性匹配', title: 'Cream ribbed knit scarf' }
];

test('带图时同一张消息里既有商品信息也有图片片段', () => {
  const messages = buildTitleSuggestionMessages(INPUT, { imageUrl: 'data:image/png;base64,AAAA', glossary: { 材质: 'Cotton' } });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /材质 → Cotton/);
  assert.match(messages[0].content, /主推爆款长标题/);
  assert.match(messages[0].content, /"versions"/);
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

test('三条候选各自带策略说明和字符数', () => {
  const parsed = parseTitleSuggestions('```json\n' + JSON.stringify({ versions: VERSIONS }) + '\n```');
  assert.deepEqual(parsed.map(item => item.angle), ['主推爆款长标题', '加长 SEO 长尾款', '精简稳妥款']);
  assert.deepEqual(parsed.map(item => item.title), VERSIONS.map(item => item.title));
  assert.deepEqual(parsed.map(item => item.length), VERSIONS.map(item => item.title.length));
  assert.equal(parsed[1].why, '抓更多搜索词，流量更大');
  assert.throws(() => parseTitleSuggestions('不是 JSON'), /有效的 JSON/);
  assert.throws(() => parseTitleSuggestions(JSON.stringify({ versions: VERSIONS.slice(0, 2) })), /3 条/);
  // 重复和过短的候选会被丢掉，剩下的凑不够三条就报错，不拿半成品糊弄用户。
  const repeated = [VERSIONS[0], { ...VERSIONS[1], title: VERSIONS[0].title.toUpperCase() }, VERSIONS[0], VERSIONS[2]];
  assert.throws(() => parseTitleSuggestions(JSON.stringify({ versions: repeated })), /3 条/);
});

test('策略名缺失时按预设顺序补上，超长标题按空格收口', () => {
  const long = ('Soft cotton knit scarf for winter travel ' .repeat(8)).trim();
  const parsed = parseTitleSuggestions(JSON.stringify({ titles: [long, VERSIONS[1].title, VERSIONS[2].title] }));
  assert.equal(parsed[0].angle, '主推爆款长标题');
  assert.equal(parsed[0].why, '英站首选，字符合规');
  assert.ok(parsed[0].length <= 200);
  assert.ok(long.startsWith(parsed[0].title));
  assert.ok(!parsed[0].title.endsWith(' '));
  assert.equal(parsed[0].length, parsed[0].title.length);
});

test('模型读不了图时自动退回纯文字，其它错误照原样抛出', async () => {
  const calls = [];
  const client = {
    ai: {
      async complete(options) {
        calls.push(options);
        if (calls.length === 1) throw new Error('消息内容无效。');
        return { content: JSON.stringify({ versions: VERSIONS }) };
      }
    }
  };
  const result = await suggestTitles({ client, input: INPUT, imageUrl: 'data:image/png;base64,AAAA' });
  assert.equal(result.usedImage, false);
  assert.deepEqual(result.versions.map(item => item.title), VERSIONS.map(item => item.title));
  assert.equal(typeof calls[1].messages[1].content, 'string');

  const failing = { ai: { async complete() { throw new Error('AI 服务密钥无效或未授权。'); } } };
  await assert.rejects(suggestTitles({ client: failing, input: INPUT, imageUrl: 'data:image/png;base64,AAAA' }), /密钥无效/);
  assert.equal(TITLE_COUNT, 3);
});

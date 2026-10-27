// 「爆款标题」只产出候选、不直接改草稿：三个标题要分别站住外观、场景和卖点，
// 而且必须能被图片和 1688 文字信息共同支撑，避免模型自由发挥。
const SYSTEM_PROMPT = [
  '你是跨境电商标题编辑，为希音全托管商品写英文标题。',
  '输入是一张商品主图和从 1688 采集到的中文商品信息。',
  '只输出一个 JSON 对象，结构为 {"titles":["标题1","标题2","标题3"]}，不要 Markdown、不要解释。',
  '规则：',
  '1. 三个标题分别突出外观版型、使用场景、核心卖点，彼此不能只换同义词。',
  '2. 必须用到图片里能看到的颜色、图案、材质质感或结构特征；图里看不出来的不要写。',
  '3. 每条 40 到 150 个字符，符合英文标题语序，不堆砌关键词，不写促销语、价格、折扣、店铺名或 hot sale 一类词。',
  '4. 不得编造图片和文字都没有的材质、尺寸、认证、品牌或功能。',
  '5. 服装类用美式英语，避免中英混排和全大写。'
].join('\n');

export const TITLE_COUNT = 3;

// 底座或模型不支持图片时的兜底信号：这类错误退回纯文字标题建议，
// 其它错误（鉴权、额度、网络）照原样抛给界面。
const VISION_UNSUPPORTED = /消息内容无效|消息图片|最多 4 张图片|附件|image|vision|multimodal/i;

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function buildTitleSuggestionMessages(input, { imageUrl = '', glossary = {} } = {}) {
  const glossaryLines = Object.entries(glossary).slice(0, 80).map(([key, value]) => key + ' → ' + value);
  const payload = JSON.stringify({
    title: text(input?.title).slice(0, 300),
    attributes: (Array.isArray(input?.attributes) ? input.attributes : []).slice(0, 40),
    colors: (Array.isArray(input?.colors) ? input.colors : []).slice(0, 30),
    categoryPath: (Array.isArray(input?.categoryPath) ? input.categoryPath : []).slice(0, 5)
  });
  const system = SYSTEM_PROMPT + (glossaryLines.length ? '\n术语表（优先沿用）：\n' + glossaryLines.join('\n') : '');
  // 没有图片时保持纯文本消息，不支持图片的底座和模型也能直接用。
  if (!imageUrl) return [{ role: 'system', content: system }, { role: 'user', content: payload }];
  return [
    { role: 'system', content: system },
    { role: 'user', content: [{ type: 'text', text: payload }, { type: 'image_url', image_url: { url: imageUrl } }] }
  ];
}

export function parseTitleSuggestions(content) {
  const raw = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('标题建议没有返回有效的 JSON。'); }
  const seen = new Set();
  const titles = [];
  for (const item of Array.isArray(value?.titles) ? value.titles : []) {
    const title = text(item).slice(0, 200);
    const key = title.toLowerCase();
    if (title.length < 5 || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length === TITLE_COUNT) break;
  }
  // 少于三条说明模型没按要求给差异化的候选，让用户重新生成比硬凑更好。
  if (titles.length < TITLE_COUNT) throw new Error('标题建议需要 3 条不同的结果。');
  return titles;
}

export async function suggestTitles({ client, model, input, imageUrl = '', glossary = {}, temperature = 0.8 }) {
  const complete = messages => client.ai.complete({
    ...(text(model) ? { model: text(model) } : {}),
    messages,
    temperature,
    responseFormat: { type: 'json_object' }
  });
  let usedImage = Boolean(imageUrl);
  let response;
  try {
    response = await complete(buildTitleSuggestionMessages(input, { imageUrl, glossary }));
  } catch (error) {
    if (!usedImage || !VISION_UNSUPPORTED.test(String(error?.message ?? ''))) throw error;
    usedImage = false;
    response = await complete(buildTitleSuggestionMessages(input, { glossary }));
  }
  return { titles: parseTitleSuggestions(response.content), usedImage };
}

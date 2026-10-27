// 「爆款标题」只产出候选、不直接改草稿：三条候选分别对应主推、SEO 长尾和精简稳妥三种投放策略，
// 并且必须能被图片和 1688 文字信息共同支撑，避免模型自由发挥。
const MAX_TITLE = 200;

const ANGLES = [
  { angle: '主推爆款长标题', why: '英站首选，字符合规', brief: '主推款：150 到 200 字符，把属性、款式、场景和人群一次写全，关键词密度最高。' },
  { angle: '加长 SEO 长尾款', why: '抓更多搜索词，流量更大', brief: 'SEO 款：180 到 200 字符，覆盖同义词、用途、场景和人群，词多但必须读得通顺。' },
  { angle: '精简稳妥款', why: '不容易超字符，属性匹配', brief: '精简款：60 到 110 字符，只留最关键的款式和属性，短而完整。' }
];

const SYSTEM_PROMPT = [
  '你是跨境电商标题编辑，为希音全托管商品写英文标题。',
  '输入是一张商品主图和从 1688 采集到的中文商品信息。',
  '只输出一个 JSON 对象，结构为 {"versions":[{"angle":"策略名","why":"一句话说明","title":"英文标题"}]}，不要 Markdown、不要解释。',
  '固定输出三条，顺序与策略不能互换：',
  ...ANGLES.map((item, index) => (index + 1) + '. ' + item.angle + '：' + item.brief),
  '共同规则：',
  '1. 三条标题必须真正不同，不只是换同义词：关键词数量、堆叠顺序和长尾方向都要有区别。',
  `2. 每条不超过 ${MAX_TITLE} 个字符（含空格），不许截断单词凑长度，也不许把同一个词重复堆砌。`,
  '3. 必须用到图片里能看到的颜色、图案、材质质感或结构特征；图里看不出来的不要写。',
  '4. 不得编造图片和文字都没有的材质、尺寸、认证、品牌或功能。',
  '5. 不写促销语、价格、折扣、店铺名和 hot sale 一类词；成人商品避免童装、儿童相关措辞。',
  '6. 服装类用美式英语，避免中英混排和全大写。',
  'angle 与 why 按上面的策略名和说明原样输出。'
].join('\n');

export const TITLE_COUNT = 3;

// 底座或模型不支持图片时的兜底信号：这类错误退回纯文字标题建议，
// 其它错误（鉴权、额度、网络）照原样抛给界面。
const VISION_UNSUPPORTED = /消息内容无效|消息图片|最多 4 张图片|附件|image|vision|multimodal/i;

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

// 模型偶尔超长，这里在上限前按空格断开，避免把最后一个单词切成半个。
function fitTitle(value) {
  const title = text(value);
  if (title.length <= MAX_TITLE) return title;
  const cut = title.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(' ');
  const kept = space > MAX_TITLE * 0.7 ? cut.slice(0, space) : cut;
  return kept.replace(/[\s,;:+\-/]+$/, '');
}

function angleOf(item, index) {
  const preset = ANGLES[index] ?? ANGLES[ANGLES.length - 1];
  const angle = text(item?.angle).slice(0, 40) || preset.angle;
  const why = text(item?.why).slice(0, 80) || preset.why;
  return { angle, why };
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
  // 兼容只给字符串数组的返回：策略名按预设顺序补上，候选本身照样可用。
  const items = Array.isArray(value?.versions) ? value.versions
    : Array.isArray(value?.titles) ? value.titles : [];
  const seen = new Set();
  const versions = [];
  for (const item of items) {
    const title = fitTitle(typeof item === 'string' ? item : item?.title);
    const key = title.toLowerCase();
    if (title.length < 5 || seen.has(key)) continue;
    seen.add(key);
    versions.push({ ...angleOf(item, versions.length), title, length: title.length });
    if (versions.length === TITLE_COUNT) break;
  }
  // 少于三条说明模型没按要求给差异化的候选，让用户重新生成比硬凑更好。
  if (versions.length < TITLE_COUNT) throw new Error('标题建议需要 3 条不同的结果。');
  return versions;
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
  return { versions: parseTitleSuggestions(response.content), usedImage };
}

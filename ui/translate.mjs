const SYSTEM_PROMPT = [
  '你是跨境电商商品本地化编辑，把中文 1688 商品信息写成地道的英文商品文案。',
  '只输出一个 JSON 对象，不要 Markdown、不要解释。JSON 结构：',
  '{"title":"英文标题","bullets":["卖点1","卖点2","卖点3"],"description":"英文描述","attributes":[{"name":"原属性名","value":"英文属性值"}]}',
  '规则：',
  '1. title 不超过 150 字符，只描述商品本身，不堆砌关键词，不写促销语。',
  '2. bullets 3 到 5 条，每条不超过 120 字符，只写能从原始信息确认的事实。',
  '3. 不得编造材质、尺寸、认证、品牌或功能；不确定的参数留空或写 general。',
  '4. attributes 必须覆盖输入的每个属性名，name 保持中文原样，value 写英文。',
  '5. 服装类用美式英语，避免中英混排。'
].join('\n');

// 图内文字翻译只改文字，不动商品：模型很容易顺手「美化」商品，
// 提示词把可改与不可改的边界写死，减少人工返工。
export const IMAGE_TEXT_PROMPT = [
  '你是一名跨境电商图片本地化设计师，负责把商品图片里的中文文字改成自然的英文。',
  '要求：',
  '1. 只替换文字内容，商品本体、颜色、材质、纹理、人物、构图和图片尺寸保持不变。',
  '2. 位置、对齐、字号层级、颜色和留白尽量与原图一致；英文更长时允许微调字号，但不能超出原来的文字区域。',
  '3. 品牌名、型号、数字、单位和原本就是英文的内容保持原样；没有中文的图片不要改动。',
  '4. 不要新增、删除或重绘任何图形元素，不要添加水印、边框、贴纸或营销文案。',
  '5. 保留原图的背景与光影，不要把照片重绘成插画或渲染图。',
  '输出一张与原图同尺寸的图片。'
].join('\n');

export function buildMessages(input, glossary = {}) {
  const glossaryLines = Object.entries(glossary).slice(0, 80).map(([key, value]) => key + ' → ' + value);
  const user = {
    title: String(input?.title ?? '').slice(0, 300),
    attributes: (Array.isArray(input?.attributes) ? input.attributes : []).slice(0, 40),
    colors: (Array.isArray(input?.colors) ? input.colors : []).slice(0, 30),
    categoryPath: (Array.isArray(input?.categoryPath) ? input.categoryPath : []).slice(0, 5)
  };
  return [
    { role: 'system', content: SYSTEM_PROMPT + (glossaryLines.length ? '\n术语表（优先沿用）：\n' + glossaryLines.join('\n') : '') },
    { role: 'user', content: JSON.stringify(user) }
  ];
}

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function parseTranslationContent(content, input = {}) {
  const raw = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('翻译服务没有返回有效的 JSON。'); }
  const title = text(value?.title).slice(0, 200);
  if (!title) throw new Error('翻译结果缺少标题。');
  const bullets = (Array.isArray(value?.bullets) ? value.bullets : []).map(item => text(item)).filter(Boolean).slice(0, 6);
  if (!bullets.length) throw new Error('翻译结果缺少卖点。');
  const sourceNames = new Set((input?.attributes ?? []).map(item => text(item?.name)).filter(Boolean));
  const attributes = (Array.isArray(value?.attributes) ? value.attributes : [])
    .map(item => ({ name: text(item?.name), value: text(item?.value) }))
    .filter(item => item.name && item.value && (!sourceNames.size || sourceNames.has(item.name)))
    .slice(0, 40);
  return { title, bullets, description: text(value?.description).slice(0, 4000), attributes };
}

export async function translateProduct({ client, model, input, glossary, temperature = 0.2 }) {
  const response = await client.ai.complete({
    ...(text(model) ? { model: text(model) } : {}),
    messages: buildMessages(input, glossary),
    temperature,
    responseFormat: { type: 'json_object' }
  });
  return parseTranslationContent(response.content, input);
}

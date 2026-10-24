import { decodeBase64Utf8 } from './shein-client.mjs';

export const PROVIDERS = Object.freeze({
  openai: { id: 'openai', title: 'OpenAI', origin: 'https://api.openai.com', path: '/v1/chat/completions', model: 'gpt-4o-mini', credential: 'openai-api-key' },
  deepseek: { id: 'deepseek', title: 'DeepSeek', origin: 'https://api.deepseek.com', path: '/chat/completions', model: 'deepseek-chat', credential: 'deepseek-api-key' }
});

export function providerOf(id) {
  const provider = PROVIDERS[id] ?? PROVIDERS.openai;
  return provider;
}

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

export async function translateProduct({ client, provider: providerId, model, input, glossary, temperature = 0.2 }) {
  const provider = providerOf(providerId);
  const body = {
    model: text(model) || provider.model,
    messages: buildMessages(input, glossary),
    temperature,
    response_format: { type: 'json_object' }
  };
  const response = await client.network.request({
    url: provider.origin + provider.path,
    method: 'POST',
    json: body,
    credential: provider.credential
  });
  if (response.status === 401 || response.status === 403) throw new Error(provider.title + ' 密钥无效或未授权。');
  if (response.status === 429) throw new Error(provider.title + ' 请求过于频繁，请稍后手动重试。');
  if (response.status < 200 || response.status >= 300) throw new Error(provider.title + ' 翻译失败（' + response.status + '）。');
  let payload;
  try { payload = JSON.parse(decodeBase64Utf8(response.data)); } catch { throw new Error('翻译服务返回了无法解析的内容。'); }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('翻译服务没有返回内容。');
  return parseTranslationContent(content, input);
}

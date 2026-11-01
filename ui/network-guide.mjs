export const NETWORK_EXIT_URL = 'https://ipinfo.io/json';

// Keep the list ordered by the workflow the operator sees: login/collection,
// images, Shein authorization/API, then the authorization callback page.
export const NETWORK_DIRECT_RULES = Object.freeze([
  Object.freeze({ type: 'DOMAIN-SUFFIX', value: '1688.com', label: '1688 登录、采集与商品页' }),
  Object.freeze({ type: 'DOMAIN-SUFFIX', value: 'taobao.com', label: '1688 登录跳转' }),
  Object.freeze({ type: 'DOMAIN-SUFFIX', value: 'tmall.com', label: '1688 登录跳转' }),
  Object.freeze({ type: 'DOMAIN-SUFFIX', value: 'alicdn.com', label: '1688 商品图片' }),
  Object.freeze({ type: 'DOMAIN-SUFFIX', value: 'sheincorp.cn', label: '希音接口与测试环境' }),
  Object.freeze({ type: 'DOMAIN-SUFFIX', value: 'sheincorp.com', label: '希音授权与正式接口' }),
  Object.freeze({ type: 'DOMAIN', value: 'zhipentu.github.io', label: '希音授权回调页' })
]);

export function directRuleLines() {
  return NETWORK_DIRECT_RULES.map(rule => `${rule.type},${rule.value},DIRECT`);
}

export function clashDirectRules() {
  return ['rules:', ...directRuleLines().map(line => '  - ' + line)].join('\n');
}

export function surgeDirectRules() {
  return directRuleLines().join('\n');
}

function decodeBase64Utf8(data) {
  if (typeof data !== 'string' || !data) return '';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseNetworkExit(response) {
  if (!response || response.status !== 200) throw new Error('网络出口检测服务暂时不可用，请稍后重试。');
  let payload;
  try { payload = JSON.parse(decodeBase64Utf8(response.data)); }
  catch { throw new Error('网络出口检测返回了无法识别的数据。'); }
  const ip = text(payload?.ip);
  if (!ip) throw new Error('网络出口检测没有返回 IP 地址。');
  return {
    ip,
    location: [text(payload.city), text(payload.region), text(payload.country)].filter(Boolean).join(' · '),
    org: text(payload.org)
  };
}

export function networkExitText(value) {
  if (!value?.ip) return '';
  return [value.ip, value.location, value.org].filter(Boolean).join(' · ');
}

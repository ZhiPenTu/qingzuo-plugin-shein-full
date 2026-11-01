import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORK_DIRECT_RULES, NETWORK_EXIT_URL, clashDirectRules, networkExitText, parseNetworkExit, surgeDirectRules
} from '../ui/network-guide.mjs';

function jsonResponse(payload, status = 200) {
  return { status, mime: 'application/json', data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') };
}

test('网络直连规则覆盖采集、图片、希音授权与回调域名', () => {
  const values = NETWORK_DIRECT_RULES.map(rule => rule.value);
  for (const domain of ['1688.com', 'taobao.com', 'tmall.com', 'alicdn.com', 'sheincorp.cn', 'sheincorp.com', 'zhipentu.github.io']) {
    assert.ok(values.includes(domain), '缺少 DIRECT 域名：' + domain);
  }
});

test('Clash 与 Surge 复制内容使用各自的规则格式', () => {
  assert.equal(clashDirectRules(), [
    'rules:',
    '  - DOMAIN-SUFFIX,1688.com,DIRECT',
    '  - DOMAIN-SUFFIX,taobao.com,DIRECT',
    '  - DOMAIN-SUFFIX,tmall.com,DIRECT',
    '  - DOMAIN-SUFFIX,alicdn.com,DIRECT',
    '  - DOMAIN-SUFFIX,sheincorp.cn,DIRECT',
    '  - DOMAIN-SUFFIX,sheincorp.com,DIRECT',
    '  - DOMAIN,zhipentu.github.io,DIRECT'
  ].join('\n'));
  assert.equal(surgeDirectRules(), [
    'DOMAIN-SUFFIX,1688.com,DIRECT',
    'DOMAIN-SUFFIX,taobao.com,DIRECT',
    'DOMAIN-SUFFIX,tmall.com,DIRECT',
    'DOMAIN-SUFFIX,alicdn.com,DIRECT',
    'DOMAIN-SUFFIX,sheincorp.cn,DIRECT',
    'DOMAIN-SUFFIX,sheincorp.com,DIRECT',
    'DOMAIN,zhipentu.github.io,DIRECT'
  ].join('\n'));
});

test('网络出口解析展示 IP、位置和运营商', () => {
  const value = parseNetworkExit(jsonResponse({
    ip: '203.0.113.8',
    city: 'Hangzhou',
    region: 'Zhejiang',
    country: 'CN',
    org: 'Example ISP'
  }));
  assert.deepEqual(value, {
    ip: '203.0.113.8',
    location: 'Hangzhou · Zhejiang · CN',
    org: 'Example ISP'
  });
  assert.equal(networkExitText(value), '203.0.113.8 · Hangzhou · Zhejiang · CN · Example ISP');
  assert.equal(NETWORK_EXIT_URL, 'https://ipinfo.io/json');
});

test('网络出口检测拒绝失败响应和缺失 IP', () => {
  assert.throws(() => parseNetworkExit({ status: 503, data: '' }), /暂时不可用/);
  assert.throws(() => parseNetworkExit(jsonResponse({ city: 'Hangzhou' })), /没有返回 IP/);
  assert.throws(() => parseNetworkExit({ status: 200, data: 'not-base64-json' }), /无法识别/);
});

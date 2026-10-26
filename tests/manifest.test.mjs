import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { validateManifest } from '@commerce/plugin-sdk/manifest';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const [markup, app] = await Promise.all([readFile('ui/index.html', 'utf8'), readFile('ui/app.mjs', 'utf8')]);

test('插件清单通过底座的清单校验', () => {
  const manifest = validateManifest(pkg);
  assert.equal(manifest.id, 'official.shein-full');
  assert.equal(manifest.permissions.storage, true);
  assert.equal(manifest.permissions.files, true);
});

test('只申请 1.4 新增能力所需的最小权限', () => {
  const permissions = pkg.commerce.permissions;
  assert.match(pkg.commerce.api, /\^1\.4\.0/);
  assert.deepEqual(permissions.browser, ['automate']);
  assert.ok(permissions.browserOrigins.includes('https://detail.1688.com'));
  // 授权页与回调地址都在希音域名下，内嵌浏览器要能打开并读回跳转结果。
  for (const origin of ['https://openapi-sem.sheincorp.com', 'https://openapi-test01.sheincorp.cn']) {
    assert.ok(permissions.browserOrigins.includes(origin), '缺少授权页面权限：' + origin);
  }
  for (const header of ['x-lt-appid', 'x-lt-openKeyId', 'x-lt-timestamp', 'x-lt-signature', 'Content-Type']) {
    assert.ok(permissions.networkHeaders.includes(header), '缺少请求头权限：' + header);
  }
  assert.deepEqual(permissions.network, ['https://openapi.sheincorp.cn', 'https://openapi-test01.sheincorp.cn']);
  // 声明的凭据必须都真的会被用到：APP_SecretKey 只用于换取与解密店铺凭据，
  // 店铺 secretKey 用于业务签名；openKeyId 不是密钥，存在设置里，不该占凭据槽。
  assert.deepEqual(permissions.credentials, ['shein-app-secret', 'shein-secret-key']);
  assert.ok(!permissions.browser.includes('download'));
  // 翻译复用底座 AI 配置，图像处理保留底座图像编辑能力。
  assert.deepEqual(permissions.ai, ['image-edit', 'text']);
  assert.equal(permissions.files, true);
});

test('打包需要的界面文件都在仓库里', async () => {
  for (const file of ['ui/index.html', 'ui/app.mjs', 'ui/style.css', 'ui/sdk.mjs', 'ui/shein-auth.mjs', 'LICENSE']) {
    await access(file);
  }
});

test('界面引用的元素都存在，事件绑定不会落空', () => {
  const ids = new Set([...markup.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const used = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]));
  const missing = [...used].filter(id => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('插件界面只用 textContent 写文本，不注入 HTML', () => {
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(markup, /<script type="module" src="\.\/app\.mjs">/);
});

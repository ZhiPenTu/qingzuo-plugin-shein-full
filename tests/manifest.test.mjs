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

test('只申请 1.3 新增能力所需的最小权限', () => {
  const permissions = pkg.commerce.permissions;
  assert.match(pkg.commerce.api, /\^1\.3\.0/);
  assert.deepEqual(permissions.browser, ['automate']);
  assert.ok(permissions.browserOrigins.includes('https://detail.1688.com'));
  for (const header of ['x-lt-openKeyId', 'x-lt-timestamp', 'x-lt-signature', 'Content-Type']) {
    assert.ok(permissions.networkHeaders.includes(header), '缺少请求头权限：' + header);
  }
  for (const origin of ['https://openapi.sheincorp.com', 'https://openapi-test01.sheincorp.cn', 'https://api.openai.com', 'https://api.deepseek.com']) {
    assert.ok(permissions.network.includes(origin), '缺少网络权限：' + origin);
  }
  // 声明的凭据必须都真的会被用到：openKeyId 不是密钥，存在设置里，不该占一个凭据槽。
  assert.deepEqual(permissions.credentials, ['shein-secret-key', 'openai-api-key', 'deepseek-api-key']);
  assert.ok(!permissions.browser.includes('download'));
  // v1 保持商品原貌，不改图也不调用图像编辑，就不该申请 AI 权限。
  assert.equal(permissions.ai, undefined);
  assert.equal(permissions.files, true);
});

test('打包需要的界面文件都在仓库里', async () => {
  for (const file of ['ui/index.html', 'ui/app.mjs', 'ui/style.css', 'ui/sdk.mjs', 'LICENSE']) {
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

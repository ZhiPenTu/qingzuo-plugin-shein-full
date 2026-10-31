import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { launchPluginTestHost } from '@commerce/plugin-sdk/testing';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const platform = process.platform + '-' + process.arch;
if (!process.env.QINGZUO_HOST_EXECUTABLE) throw new Error('需要指向轻作桌面安装包的可执行文件：QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo');
const host = await launchPluginTestHost({
  executablePath: process.env.QINGZUO_HOST_EXECUTABLE,
  artifactPath: `release/${pkg.commerce.id}-${pkg.version}-${platform}.ecplugin`,
  pluginId: pkg.commerce.id
});
try {
  await expect(host.plugin.locator('h1')).toHaveText('1688 选品 · 希音草稿');
  await expect(host.plugin.locator('#gate-note')).toHaveText('未确认不会发品');
  await expect(host.plugin.locator('#collect')).toBeEnabled();
  await expect(host.plugin.locator('#submit-dialog')).toBeHidden();
  await expect(host.plugin.locator('#draft-empty')).toContainText('采集链接后');
  await host.plugin.locator('#toggle-settings').click();
  // 主流程是应用授权：APP_ID / APP_SecretKey 与插件生成的回调地址就在设置首屏。
  await expect(host.plugin.locator('#app-id')).toBeVisible();
  await expect(host.plugin.locator('#app-secret')).toHaveAttribute('type', 'password');
  await host.plugin.locator('#app-secret').fill('APP-SECRET');
  await host.plugin.locator('#app-secret-toggle').click();
  await expect(host.plugin.locator('#app-secret')).toHaveAttribute('type', 'text');
  await expect(host.plugin.locator('#app-secret-toggle')).toHaveAttribute('aria-pressed', 'true');
  await host.plugin.locator('#app-secret-toggle').click();
  await expect(host.plugin.locator('#app-secret')).toHaveAttribute('type', 'password');
  await expect(host.plugin.locator('#callback-url')).toBeVisible();
  await expect(host.plugin.locator('#authorize')).toBeEnabled();
  await expect(host.plugin.locator('#base-url')).toContainText('测试环境');
  // 直接填店铺凭据是兜底入口，展开后才出现。
  await host.plugin.locator('.credential-fallback > summary').click();
  await expect(host.plugin.locator('#open-key')).toBeVisible();
  await expect(host.plugin.locator('#secret-key')).toHaveAttribute('type', 'password');
  await host.plugin.locator('#secret-key').fill('STORE-SECRET');
  await host.plugin.locator('#secret-key-toggle').click();
  await expect(host.plugin.locator('#secret-key')).toHaveAttribute('type', 'text');
  await host.plugin.locator('#secret-key-toggle').click();
  await expect(host.plugin.locator('#secret-key')).toHaveAttribute('type', 'password');
  console.log('希音全托管插件在真实宿主中加载成功，设置在启用前保持静默。');
} finally {
  await host.close();
}

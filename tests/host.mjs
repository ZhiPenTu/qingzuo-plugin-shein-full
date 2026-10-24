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
  await expect(host.plugin.locator('#open-key')).toBeVisible();
  await expect(host.plugin.locator('#secret-key')).toHaveAttribute('type', 'password');
  await expect(host.plugin.locator('#base-url')).toContainText('测试环境');
  console.log('希音全托管插件在真实宿主中加载成功，设置在启用前保持静默。');
} finally {
  await host.close();
}

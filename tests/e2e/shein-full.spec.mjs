import { test, expect, _electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pack } from '@commerce/plugin-sdk/cli';
import { OFFER_URL, OPEN_KEY_ID, SECRET_KEY, TRANSLATION, startGateway, startStorefront } from './support/servers.mjs';

const repo = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));

// 端到端测试跑在真实的轻作底座上，需要指到一个已构建的开发工作区。
function desktopRoot() {
  if (process.env.QINGZUO_DESKTOP_ROOT) return path.resolve(process.env.QINGZUO_DESKTOP_ROOT);
  const sibling = path.resolve(repo, '..', 'qingzuo-desktop');
  return existsSync(path.join(sibling, 'node_modules/electron/path.txt')) ? sibling : null;
}

function electronBinary(root) {
  const relative = readFileSync(path.join(root, 'node_modules/electron/path.txt'), 'utf8').trim();
  return path.join(root, 'node_modules/electron/dist', relative);
}

function certificate(directory) {
  const key = path.join(directory, 'key.pem');
  const cert = path.join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=detail.1688.com', '-addext', 'subjectAltName=DNS:detail.1688.com'], { stdio: 'ignore' });
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

async function packArtifact(directory) {
  const stage = path.join(directory, 'plugin');
  await mkdir(stage, { recursive: true });
  await cp(path.join(repo, 'ui'), path.join(stage, 'ui'), { recursive: true });
  const sdk = new URL('./index.mjs', import.meta.resolve('@commerce/plugin-sdk/cli'));
  await cp(sdk, path.join(stage, 'ui/sdk.mjs'));
  await cp(path.join(repo, 'LICENSE'), path.join(stage, 'LICENSE'));
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, commerce: pkg.commerce }, null, 2));
  const artifact = path.join(directory, pkg.commerce.id + '.ecplugin');
  await pack(stage, artifact);
  return artifact;
}

function expectedSignature(random, timestamp, requestPath) {
  const digest = createHmac('sha256', SECRET_KEY + random).update(OPEN_KEY_ID + '&' + timestamp + '&' + requestPath, 'utf8').digest('hex');
  return random + Buffer.from(digest).toString('base64');
}

test('1688 采集到希音提交：确认前零发品调用，签名与幂等键正确', async () => {
  const root = desktopRoot();
  test.skip(!root, '需要指向已构建的轻作底座：QINGZUO_DESKTOP_ROOT=/path/to/qingzuo-desktop');
  test.skip(!existsSync(path.join(root, 'dist', 'index.html')), '底座尚未构建：先运行 npm run build 与 npm run platform:prepare');

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shein-full-e2e-'));
  const gateway = await startGateway();
  const { key, cert } = certificate(temporary);
  const storefront = await startStorefront({ key, cert });
  let app;
  try {
    const artifact = await packArtifact(temporary);
    const env = { ...process.env, COMMERCE_TEST_NETWORK_ROUTES: JSON.stringify(gateway.routes) };
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;
    app = await _electron.launch({
      executablePath: electronBinary(root),
      args: [root, '--user-data-dir=' + path.join(temporary, 'profile'),
        '--host-resolver-rules=MAP detail.1688.com 127.0.0.1:' + storefront.port, '--ignore-certificate-errors'],
      cwd: temporary, env, timeout: 120000
    });
    const shell = await app.firstWindow();
    await expect(shell.getByText('工具服务已就绪', { exact: true })).toBeVisible({ timeout: 120000 });
    await app.evaluate(({ dialog }, artifactPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [artifactPath] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, artifact);
    await shell.evaluate(() => window.commerceDesktop.invoke('plugins.import'));
    const status = await shell.evaluate(() => window.commerceDesktop.invoke('status'));
    expect(status.plugins.some(candidate => candidate.id === pkg.commerce.id)).toBe(true);

    await shell.getByRole('button', { name: '工具中心', exact: true }).click();
    await shell.locator('[data-slot="card"]')
      .filter({ has: shell.getByRole('heading', { name: pkg.commerce.title, exact: true }) })
      .getByRole('button', { name: '打开工具', exact: true }).click();
    const prefix = 'commerce-plugin://' + pkg.commerce.id + '/';
    await expect.poll(() => app.context().pages().some(candidate => candidate.url().startsWith(prefix)), { timeout: 120000 }).toBe(true);
    const plugin = app.context().pages().find(candidate => candidate.url().startsWith(prefix));

    await plugin.locator('#toggle-settings').click();
    await plugin.locator('#provider').selectOption('openai');
    await plugin.locator('#base-url').selectOption('https://openapi-test01.sheincorp.cn');
    await plugin.locator('#open-key').fill(OPEN_KEY_ID);
    await plugin.locator('#save-settings').click();
    await expect(plugin.locator('#settings-status')).toHaveText('设置已保存。');
    await plugin.locator('#translation-key').fill('sk-e2e');
    await plugin.locator('#save-translation').click();
    await expect(plugin.locator('#translation-status')).toHaveText('已保存。');
    await plugin.locator('#secret-key').fill(SECRET_KEY);
    await plugin.locator('#save-secret').click();
    await expect(plugin.locator('#secret-status')).toHaveText('已保存。');
    await plugin.locator('#toggle-settings').click();

    await plugin.locator('#source-url').fill(OFFER_URL);
    await plugin.locator('#collect').click();
    await expect(plugin.locator('#draft-count')).toHaveText('1', { timeout: 90000 });
    await expect(plugin.locator('#review-title')).toHaveText('纯棉针织围巾 冬季加厚保暖 韩版百搭情侣款');
    await expect(shell.locator('.commerce-browser-pane')).toBeVisible();
    await expect.poll(() => app.context().pages().some(candidate => candidate.url() === OFFER_URL)).toBe(true);

    await plugin.locator('#translate').click();
    await expect(plugin.locator('#action-status')).toHaveText('已生成英文文案，请逐项校对。', { timeout: 90000 });
    await expect(plugin.locator('#title-en')).toHaveValue(TRANSLATION.title);

    await plugin.locator('#category-id').fill('1234');
    await plugin.locator('#product-type-id').fill('5678');
    await plugin.locator('#load-template').click();
    await expect(plugin.locator('#action-status')).toHaveText('已加载必填属性，请补全英文值。', { timeout: 90000 });
    await expect(plugin.locator('#attributes .attribute-row')).toHaveCount(2);

    await plugin.locator('#prepare-images').click();
    await expect(plugin.locator('#action-status')).toHaveText(/已转存 2 张图片/, { timeout: 120000 });
    await expect(plugin.locator('#image-hint')).toHaveText('2 张可提交');

    const rows = plugin.locator('#sku-body tr');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).locator('input').first().fill('Off White');
    await rows.nth(1).locator('input').first().fill('Ink Black');
    await rows.nth(0).locator('select').selectOption('9001');
    await rows.nth(1).locator('select').selectOption('9002');
    await plugin.locator('#attributes .attribute-row input').first().fill('Cotton');
    await plugin.locator('#attributes .attribute-row select').selectOption('9001');
    await plugin.locator('#category-confirmed').check();

    await plugin.locator('#save').click();
    await expect(plugin.locator('#action-status')).toHaveText('草稿已保存。', { timeout: 90000 });
    await expect(plugin.locator('#review-status')).toHaveText('待审核');

    // 硬约束：进入待审核但未确认时，任何发品或写操作都不能发生。
    // 编辑阶段读取属性模板、币种属于只读准备，不计入其中。
    expect(gateway.submissions()).toEqual([]);
    await plugin.locator('#submit').click();
    await expect(plugin.locator('#submit-dialog')).toBeVisible();
    await expect(plugin.locator('#submit-summary')).toContainText('16.88');
    await plugin.locator('#submit-cancel').click();
    await expect(plugin.locator('#submit-dialog')).toBeHidden();
    expect(gateway.submissions()).toEqual([]);

    await plugin.locator('#submit').click();
    await plugin.locator('#submit-confirm').click();
    await expect(plugin.locator('#review-status')).toHaveText('已提交', { timeout: 120000 });
    await expect(plugin.locator('#submission')).toContainText('SPU-E2E');
    await expect(plugin.locator('#submit')).toBeDisabled();

    const sheet = gateway.submissions();
    expect(sheet.map(call => call.path)).toEqual([
      '/open-api/goods/product/check-supplierSku-repeated',
      '/open-api/goods/product/check-publish-permission',
      '/open-api/goods-publish-quotas/detail',
      '/open-api/goods/upload-pic',
      '/open-api/goods/upload-pic',
      '/open-api/goods/product/publishOrEdit'
    ]);
    for (const call of sheet) {
      expect(call.headers['x-lt-openkeyid']).toBe(OPEN_KEY_ID);
      expect(call.headers.language).toBe('zh-cn');
      expect(call.headers['x-lt-timestamp']).toMatch(/^\d{13}$/);
      const signature = call.headers['x-lt-signature'];
      expect(signature).toMatch(/^[A-Za-z0-9]{5}.+={0,2}$/);
      // 服务端签名 = 5 位随机串 + base64(hex(HMAC(secretKey + 随机串, openKeyId&timestamp&path)))
      expect(signature).toBe(expectedSignature(signature.slice(0, 5), call.headers['x-lt-timestamp'], call.path));
    }
    for (const call of sheet.filter(item => !item.path.endsWith('/upload-pic'))) {
      expect(call.headers['content-type']).toBe('application/json;charset=UTF-8');
    }
    const uploads = sheet.filter(call => call.path.endsWith('/upload-pic'));
    for (const [index, call] of uploads.entries()) {
      expect(call.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
      const text = call.body.toString('latin1');
      expect(text).toContain('name="image_type"');
      expect(text).toContain('name="file"; filename="' + (index === 0 ? 'main.png' : 'detail.png') + '"');
    }

    const publish = gateway.json(sheet.at(-1));
    expect(publish.default_language).toBe('en');
    expect(publish.main_site).toBe('shein');
    expect(publish.category_id).toBe(1234);
    expect(publish.product_type_id).toBe(5678);
    expect(publish.multi_language_name_list).toEqual([{ language: 'en', name: TRANSLATION.title }]);
    expect(publish.skc_list).toHaveLength(2);
    expect(publish.skc_list.map(skc => skc.sku_list[0].supplier_price)).toEqual([16.88, 17.55]);
    expect(publish.skc_list.map(skc => skc.sale_attribute.attribute_value_id)).toEqual([9001, 9002]);
    const idempotencyKeys = gateway.json(sheet[0]).supplierSkuList;
    expect(idempotencyKeys).toEqual(publish.skc_list.map(skc => skc.sku_list[0].supplier_sku));
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[0].toUpperCase());
    expect(gateway.json(sheet[1])).toEqual({ category_id: 1234, product_type_id: 5678 });

    await plugin.locator('#poll').click();
    await expect(plugin.locator('#submission')).toContainText('审核通过', { timeout: 90000 });
    expect(gateway.sheet().at(-1).path).toBe('/open-api/goods/query-document-state');
  } finally {
    await app?.close().catch(() => {});
    await gateway.close();
    await storefront.close();
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

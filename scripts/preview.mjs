import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const pluginDir = new URL('../ui', import.meta.url).pathname;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const filePath = path.join(pluginDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

function poster({ title, subtitle, background, ink }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1125" viewBox="0 0 900 1125">
  <rect width="900" height="1125" fill="${background}"/>
  <rect x="80" y="120" width="740" height="700" rx="24" fill="#ffffff" opacity="0.55"/>
  <text x="450" y="400" font-family="PingFang SC, system-ui, sans-serif" font-size="86" font-weight="700" text-anchor="middle" fill="${ink}">${title}</text>
  <text x="450" y="520" font-family="PingFang SC, system-ui, sans-serif" font-size="52" text-anchor="middle" fill="${ink}" opacity="0.72">${subtitle}</text>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const IMAGES = {
  'tok-1': poster({ title: '透气网格地主帽', subtitle: '四季通用 · 可调节', background: '#e7e1d6', ink: '#2c2a26' }),
  'tok-1-en': poster({ title: 'Breathable Mesh Docker Cap', subtitle: 'All-season · Adjustable', background: '#e7e1d6', ink: '#2c2a26' }),
  'tok-2': poster({ title: '细节展示', subtitle: '帽檐与后扣', background: '#dde5e2', ink: '#233029' }),
  'tok-2-en': poster({ title: 'Product Detail', subtitle: 'Brim and back buckle', background: '#dde5e2', ink: '#233029' }),
  'tok-3': poster({ title: '三种颜色', subtitle: '黑色 / 咖啡色 / 藏青', background: '#e3e0e8', ink: '#2a2733' })
};

const now = Date.now();
const draft = {
  id: 'd-1',
  status: 'imaged',
  created: now - 3600000,
  updated: now,
  source: {
    url: 'https://detail.1688.com/offer/826500000001.html',
    title: '亚马逊爆款塑形网格无檐帽男士透气地主帽瓜皮帽子水手帽流氓帽子定制',
    price: 2.0,
    moq: 2,
    unit: '个',
    breadcrumb: ['服饰配饰', '帽子', '地主帽/瓜皮帽'],
    capturedAt: now - 4000000,
    attributes: [
      { name: '材质', value: '涤纶' },
      { name: '帽顶', value: '圆顶' },
      { name: '帽檐款式', value: '无檐' },
      { name: '图案', value: '纯色' },
      { name: '产地', value: '浙江温州' }
    ],
    images: []
  },
  product: {
    title: {
      zh: '亚马逊爆款塑形网格无檐帽男士透气地主帽瓜皮帽子水手帽流氓帽子定制',
      en: 'Mesh Brimless Tactical Docker Beanie Cap Men Breathable Sailor Skullcap'
    },
    bullets: [
      { en: 'Breathable mesh fabric keeps the head cool and ventilated' },
      { en: 'Vintage brimless docker cap design suitable for all seasons' },
      { en: 'Adjustable buckle at the back fits head circumference 56-60 cm' }
    ],
    description: { zh: '', en: 'Premium breathable mesh docker beanie for daily outdoor wear.' },
    category: { sheinCategoryId: '2048', sheinProductTypeId: '1092', sheinCategoryName: '男装 > 帽子 > 地主帽', confirmed: true },
    coefficient: 1.35,
    currency: 'USD',
    attributes: [
      { attributeId: '6', name: { zh: '材质', en: 'Material' }, value: { en: 'Polyester mesh' }, required: true },
      { attributeId: '9', name: { zh: '帽檐款式', en: 'Brim Style' }, value: { en: 'Brimless' }, required: true }
    ],
    skus: [
      { color: '黑色', colorEn: 'Black', colorAttributeValueId: '', price: 2.0, stock: 500, supplierSku: 'SKU-001' },
      { color: '咖啡色', colorEn: 'Coffee Brown', colorAttributeValueId: '', price: 2.0, stock: 450, supplierSku: 'SKU-002' }
    ],
    images: [
      { id: 'img-1', name: 'main-1.jpg', role: 'main', width: 900, height: 1125, size: 102400, mime: 'image/jpeg', excluded: false, token: 'tok-1', uploadedUrl: '', translated: { token: 'tok-1-en', mime: 'image/jpeg', size: 118000, width: 900, height: 1125 }, useTranslated: true },
      { id: 'img-2', name: 'detail-1.jpg', role: 'detail', width: 900, height: 1125, size: 95400, mime: 'image/jpeg', excluded: false, token: 'tok-2', uploadedUrl: '', translated: { token: 'tok-2-en', mime: 'image/jpeg', size: 96000, width: 900, height: 1125 }, useTranslated: true },
      { id: 'img-3', name: 'detail-2.jpg', role: 'detail', width: 900, height: 1125, size: 88400, mime: 'image/jpeg', excluded: false, token: 'tok-3', uploadedUrl: '' }
    ]
  },
  history: [{ status: 'collected', at: now - 3600000, note: '已采集' }],
  notes: []
};

const VISION_TITLES = [
  'Breathable mesh docker cap for daily wear',
  'All-season brimless sailor cap in black and navy',
  'Adjustable mesh skullcap with vintage docker fit'
];
const VISION_IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const mockScript = `(() => {
  const titles = ${JSON.stringify(VISION_TITLES)};
  const images = ${JSON.stringify(IMAGES)};
  const store = {
    settings: { coefficient: 1.35, site: 'shein', baseUrl: 'https://openapi.sheincorp.cn', openKeyId: 'test-key', model: '', imageModel: 'gpt-image-1' },
    drafts: ${JSON.stringify([draft])}
  };
  window.commercePlugin = {
    async invoke(method, args = {}) {
      if (method === 'storage.get') return store[args.key] ?? null;
      if (method === 'storage.set') { store[args.key] = args.value; return true; }
      if (method === 'storage.keys') return Object.keys(store);
      if (method === 'files.url') return images[args.token] ?? '';
      if (method === 'files.read') return { data: '${VISION_IMAGE}', mime: 'image/png' };
      if (method === 'credentials.status') return false;
      if (method === 'ai.textModels') return { models: [{ id: 'mock-writer', title: 'Mock Writer' }], defaultModel: 'mock-writer' };
      if (method === 'ai.complete') return { content: JSON.stringify({ titles }), model: 'mock-writer' };
      if (method === 'ai.models') return [
        { id: 'gpt-image-1', source: 'proxy', provider: 'openai', title: 'GPT Image', sizes: ['1024x1024'] },
        { id: 'nano-banana', source: 'proxy', provider: 'google', title: 'Nano Banana', sizes: ['1024x1024'] }
      ];
      return null;
    },
    onDispose() {}
  };
})();`;

const browser = await chromium.launch({ headless: true });

async function open(width, height, script) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript({ content: mockScript });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.draft-item');
  await page.click('.draft-item:first-child');
  await page.waitForTimeout(250);
  if (script) await script(page);
  return page;
}

async function shot(page, out, fullPage = false) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: out, fullPage });
  console.log('Saved ' + out);
  await page.close();
}

// 常见窗口尺寸下不允许出现横向溢出；分区内部滚动只应发生在纵向。
async function auditLayout(page, label) {
  const problems = await page.evaluate(() => {
    const doc = document.documentElement;
    const rows = [];
    if (doc.scrollWidth > window.innerWidth + 1) rows.push(`文档宽度 ${doc.scrollWidth} > 视口 ${window.innerWidth}`);
    for (const selector of ['.app', '.review', '.image-workspace', '.image-toolbar', '.image-controls-bar', '.review-footer', '.pane:not([hidden])', '.thumb-grid', '.title-dialog-body']) {
      const node = document.querySelector(selector);
      if (node && node.scrollWidth > node.clientWidth + 1) rows.push(`${selector} 横向溢出 ${node.scrollWidth - node.clientWidth}px`);
    }
    return rows;
  });
  if (problems.length) throw new Error(label + ' 布局异常：' + problems.join('；'));
}

async function auditViewer(page, label, { translated = false } = {}) {
  await page.locator('#viewer').waitFor({ state: 'visible' });
  if (translated) {
    await page.click('#viewer-translated');
    const active = await page.locator('#viewer-translated').getAttribute('aria-pressed');
    if (active !== 'true') throw new Error(label + ' 查看器未能切到译文');
  }
  await page.waitForFunction(() => document.querySelector('#viewer-image')?.naturalWidth > 0);
  await auditLayout(page, label + ' 查看器');
  const box = await page.locator('#viewer-image').boundingBox();
  const frame = await page.locator('#viewer-frame').boundingBox();
  if (!box || !frame) throw new Error(label + ' 查看器图片未渲染');
  const fit = await page.locator('#viewer-image').evaluate(node => getComputedStyle(node).objectFit);
  if (fit !== 'contain') throw new Error(label + ' 查看器没有按完整图片显示：' + fit);
  if (box.width > frame.width + 1 || box.height > frame.height + 1) {
    throw new Error(label + ' 查看器图片超出容器');
  }
}

await shot(await open(1600, 1000), '/tmp/preview_1600_content.png');
await shot(await open(1280, 720), '/tmp/preview_1280_content.png');
await shot(await open(1280, 720, async page => {
  await page.click('#tab-images');
  await page.waitForTimeout(200);
}), '/tmp/preview_1280_images.png');
await shot(await open(1280, 720, async page => {
  await page.click('#tab-source');
  await page.waitForTimeout(200);
}), '/tmp/preview_1280_source.png');
await shot(await open(1280, 720, async page => {
  await page.evaluate(() => { const pane = document.querySelector('#pane-content'); pane.scrollTop = pane.scrollHeight; });
  await page.waitForTimeout(200);
}), '/tmp/preview_1280_content_scrolled.png');
await shot(await open(1600, 1000, async page => {
  await page.click('#tab-images');
  await page.waitForTimeout(200);
}), '/tmp/preview_1600_images.png');
await shot(await open(1600, 1000, async page => {
  await page.click('#tab-images');
  await page.click('#view-compare');
  await page.waitForTimeout(200);
}), '/tmp/preview_1600_compare.png');
await shot(await open(1000, 900, async page => {
  await page.click('#tab-images');
  await page.waitForTimeout(200);
}), '/tmp/preview_1000_images.png');
await shot(await open(900, 900, async page => {
  await page.click('#tab-images');
  await page.waitForTimeout(200);
}), '/tmp/preview_900_images.png');
await shot(await open(1600, 1000, async page => {
  await page.click('#tab-images');
  await page.click('#image-zoom');
  await page.waitForTimeout(200);
}), '/tmp/preview_1600_viewer.png');
await shot(await open(1600, 1000, async page => {
  await page.click('#tab-images');
  await page.click('#image-zoom');
  await page.click('#viewer-translated');
  await page.waitForTimeout(200);
}), '/tmp/preview_1600_viewer_translated.png');
await shot(await open(820, 700, async page => {
  await page.click('#tab-images');
  await page.waitForTimeout(200);
}), '/tmp/preview_820_images.png');
await shot(await open(1600, 1000, async page => {
  await page.click('#tab-images');
  await page.click('#translate-images');
  await page.waitForTimeout(300);
}), '/tmp/preview_1600_translate.png');
await shot(await open(1600, 1000, async page => {
  await page.click('#translate-zh-title');
  await page.locator('.title-option').first().waitFor();
  await page.locator('.title-option').nth(1).click();
  await auditLayout(page, '标题建议弹窗');
}), '/tmp/preview_1600_title_dialog.png');
await shot(await open(1600, 1000, async page => {
  await page.click('#toggle-settings');
  await page.waitForTimeout(300);
}), '/tmp/preview_1600_settings.png');

await shot(await open(1280, 720, async page => {
  await page.click('#tab-source');
  await page.waitForTimeout(200);
  await page.locator('.source-thumb').first().click();
  await page.waitForTimeout(200);
  await auditViewer(page, '原貌查看器', { translated: true });
}), '/tmp/preview_1280_source_viewer.png');

await shot(await open(700, 700, async page => {
  await page.click('#tab-images');
  await page.waitForTimeout(200);
  await auditLayout(page, '700x700 图片页');
}), '/tmp/preview_700_images.png');

await shot(await open(700, 700, async page => {
  await auditLayout(page, '700x700 内容页');
}), '/tmp/preview_700_content.png');

const checked = await open(1280, 720, async page => {
  await page.click('#tab-images');
  await page.click('#view-compare');
  await page.waitForTimeout(200);
  if (!(await page.locator('#compare-control').isVisible())) throw new Error('对比滑杆没有显示');
  if ((await page.locator('.stage-compare img').count()) !== 2) throw new Error('对比视图缺少原图或译文');
  await page.click('#image-zoom');
  await auditViewer(page, '图片查看器', { translated: true });
  await page.click('#viewer-close');
  await page.click('#translate-images');
  await page.locator('#translate-dialog').waitFor({ state: 'visible' });
  if ((await page.locator('#translate-model option').count()) < 1) throw new Error('翻译弹窗没有图片模型');
  if (!(await page.locator('#translate-prompt').isVisible())) throw new Error('翻译弹窗没有修改提示词输入框');
  const defaultPrompt = await page.locator('#translate-prompt').inputValue();
  if (!defaultPrompt.includes('英文')) throw new Error('翻译弹窗默认提示词不正确');
  await page.fill('#translate-prompt', '把所有中文替换成简洁的美式英文标题');
  await page.click('#translate-prompt-reset');
  if ((await page.locator('#translate-prompt').inputValue()) !== defaultPrompt) throw new Error('恢复默认提示词未生效');
  console.log('交互断言通过：对比滑杆、查看器、翻译弹窗');
});
await checked.close();

await browser.close();
server.close();

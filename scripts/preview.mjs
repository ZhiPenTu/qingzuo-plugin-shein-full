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

const mockScript = `(() => {
  const store = {
    settings: { coefficient: 1.35, site: 'shein', baseUrl: 'https://openapi.sheincorp.com', openKeyId: 'test-key' },
    drafts: [{
      id: 'd-1',
      status: 'translated',
      created: Date.now() - 3600000,
      updated: Date.now(),
      source: {
        title: '亚马逊爆款塑形网格无檐帽男士透气地主帽瓜皮帽子水手帽流氓帽子定制',
        price: 2.00,
        moq: 2,
        breadcrumb: ['服饰配饰', '帽子', '地主帽/瓜皮帽'],
        capturedAt: Date.now() - 4000000,
        attributes: [
          { name: '视频', value: '有' },
          { name: '晚发必赔', value: '支持' },
          { name: '适用年龄段', value: '成年' },
          { name: '货号', value: 'ZL1006-X121' },
          { name: '材质', value: '涤纶' },
          { name: '帽顶', value: '圆顶' },
          { name: '帽檐款式', value: '无檐' },
          { name: '图案', value: '纯色' },
          { name: '产地', value: '浙江温州' },
          { name: '主要下游平台', value: '亚马逊, 独立站, 速卖通' }
        ],
        images: []
      },
      product: {
        titleZh: '亚马逊爆款塑形网格无檐帽男士透气地主帽瓜皮帽子水手帽流氓帽子定制',
        titleEn: 'Mesh Brimless Tactical Docker Beanie Cap Men Breathable Sailor Skullcap',
        bullets: [
          'Breathable mesh fabric keeps head cool and ventilated',
          'Vintage brimless docker cap design suitable for all seasons',
          'Adjustable buckle at back fits head circumferences 56-60cm'
        ],
        description: 'Premium quality breathable mesh docker beanie cap for men and women. Made of durable polyester mesh, lightweight and comfortable for daily outdoor sports, cycling, street casual fashion.',
        category: { sheinCategoryId: '2048', sheinProductTypeId: '1092', sheinCategoryName: '男装 > 帽子 > 地主帽', confirmed: true },
        coefficient: 1.35,
        attributes: [
          { attributeId: '1', name: { zh: '视频', en: 'Video' }, value: { en: 'Product explanation' }, required: false },
          { attributeId: '2', name: { zh: '晚发必赔', en: 'Late Dispatch Compensation' }, value: { en: 'Customer service' }, required: false },
          { attributeId: '3', name: { zh: '适用年龄段成年', en: 'Applicable Age' }, value: { en: 'Adults; unisex for men and women' }, required: true },
          { attributeId: '4', name: { zh: '货号', en: 'Item No.' }, value: { en: 'ZL1006-X121' }, required: true },
          { attributeId: '5', name: { zh: '定制链接', en: 'Customization' }, value: { en: 'Custom processing' }, required: false },
          { attributeId: '6', name: { zh: '材质', en: 'Material' }, value: { en: 'Polyester, Cotton mesh' }, required: true },
          { attributeId: '7', name: { zh: '库存类型', en: 'Stock Type' }, value: { en: 'Whole order' }, required: false },
          { attributeId: '8', name: { zh: '帽顶', en: 'Crown Style' }, value: { en: 'Round dome' }, required: true },
          { attributeId: '9', name: { zh: '帽檐款式', en: 'Brim Style' }, value: { en: 'Brimless' }, required: true },
          { attributeId: '10', name: { zh: '图案', en: 'Pattern' }, value: { en: 'Solid color' }, required: true },
          { attributeId: '11', name: { zh: '适用场景', en: 'Applicable Scene' }, value: { en: 'Outdoor, casual sports' }, required: false },
          { attributeId: '12', name: { zh: '颜色', en: 'Color' }, value: { en: 'Black, Coffee brown, Navy' }, required: true },
          { attributeId: '13', name: { zh: '尺码', en: 'Size' }, value: { en: 'Large: 28.5 x 20 cm; Small: 26 x 16 cm' }, required: true },
          { attributeId: '14', name: { zh: '主要下游平台', en: 'Downstream Platforms' }, value: { en: 'Wish, AliExpress, independent stores' }, required: false },
          { attributeId: '15', name: { zh: '包装信息', en: 'Package Info' }, value: { en: 'Product details' }, required: false },
          { attributeId: '16', name: { zh: '48h揽收率', en: '48h Pickup Rate' }, value: { en: '92.00% collection rate within 48h' }, required: false },
          { attributeId: '17', name: { zh: '24h揽收率', en: '24h Pickup Rate' }, value: { en: '15.00% collection rate within 24h' }, required: false },
          { attributeId: '18', name: { zh: '铺货分销商数', en: 'Distributors' }, value: { en: '2,000+ distributors' }, required: false }
        ],
        skus: [
          { color: '黑色', colorEn: 'Black', colorAttributeValueId: '', price: 2.00, stock: 500, supplierSku: 'SKU-001' },
          { color: '咖啡色', colorEn: 'Coffee Brown', colorAttributeValueId: '', price: 2.00, stock: 450, supplierSku: 'SKU-002' },
          { color: '藏青色', colorEn: 'Navy Blue', colorAttributeValueId: '', price: 2.00, stock: 300, supplierSku: 'SKU-003' }
        ],
        images: [
          { id: 'img-1', name: 'main-1.jpg', role: 'main', width: 800, height: 800, size: 102400, excluded: false, token: 'tok-1' },
          { id: 'img-2', name: 'detail-1.jpg', role: 'detail', width: 800, height: 800, size: 95400, excluded: false, token: 'tok-2' },
          { id: 'img-3', name: 'detail-2.jpg', role: 'detail', width: 800, height: 800, size: 88400, excluded: false, token: 'tok-3' }
        ]
      }
    }, {
      id: 'd-2',
      status: 'collected',
      created: Date.now() - 7200000,
      updated: Date.now() - 3600000,
      source: { title: '复古机车帽潮牌冷帽', price: 5.50 },
      product: {}
    }]
  };

  window.commercePlugin = {
    async invoke(method, args) {
      if (method === 'storage.get') return store[args.key] ?? null;
      if (method === 'storage.set') { store[args.key] = args.value; return true; }
      if (method === 'credentials.status') return { configured: true };
      if (method === 'ai.models') return [];
      return null;
    },
    onDispose() {}
  };
})();`;

const browser = await chromium.launch({ headless: true });

async function capture({ width, height, out, scrollTo, settings }) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript({ content: mockScript });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.draft-item');
  if (settings) {
    await page.click('#toggle-settings');
  } else {
    await page.click('.draft-item:first-child');
  }
  await page.waitForTimeout(300);
  if (scrollTo) await page.locator(scrollTo).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`Saved ${out} (${width}x${height}${scrollTo ? ' @ ' + scrollTo : ''}${settings ? ' settings' : ''})`);
  await page.close();
}

await capture({ width: 2560, height: 1440, out: '/tmp/preview_2560.png' });
await capture({ width: 1600, height: 1000, out: '/tmp/preview_1600.png' });
await capture({ width: 1280, height: 900, out: '/tmp/preview_1280.png' });
await capture({ width: 900, height: 900, out: '/tmp/preview_900.png' });
await capture({ width: 2560, height: 1440, out: '/tmp/preview_2560_sku.png', scrollTo: '#sku-body' });
await capture({ width: 2560, height: 1440, out: '/tmp/preview_2560_settings.png', settings: true });

await browser.close();
server.close();

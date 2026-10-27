import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { createCipheriv } from 'node:crypto';
import { pngBytes } from './png.mjs';

export const OFFER_PATH = '/offer/826500000001.html';
export const OFFER_URL = 'https://detail.1688.com' + OFFER_PATH;
export const OPEN_KEY_ID = 'E2E-OPEN-KEY';
export const SECRET_KEY = 'E2E-SECRET-KEY';
export const APP_ID = 'E2E-APP-ID';
export const APP_SECRET = 'E2E-APP-SECRET-0123456789ABCDEF';
export const TEMP_TOKEN = 'E2E-TEMP-TOKEN';
export const CALLBACK_HOST = 'zhipentu.github.io';
// 授权页与回调地址都在希音的授权域名下，端到端里同样靠主机映射指到本机。
export const AUTHORIZE_HOST = 'openapi-test01.sheincorp.cn';

// 希音把店铺 secretKey 用 APP_SecretKey 前 16 字节做 AES-128-CBC 加密后下发。
function encryptedStoreSecret() {
  const key = Buffer.from(APP_SECRET, 'utf8').subarray(0, 16);
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.from('space-station-de', 'utf8'));
  return Buffer.concat([cipher.update(SECRET_KEY, 'utf8'), cipher.final()]).toString('base64');
}

export const TRANSLATION = Object.freeze({
  title: 'Cotton Knit Scarf Winter Warm Couple Style',
  bullets: ['Soft cotton knit for daily wear', 'Warm double-layer texture', 'Unisex styling for couples'],
  description: 'A cotton knit scarf made for winter wear.',
  attributes: [
    { name: '材质', value: 'Cotton' },
    { name: '风格', value: 'Minimalist' },
    { name: '适用季节', value: 'Autumn and winter' }
  ]
});

// 标题建议走带图的补全请求，假服务据此返回三条候选，也顺带证明图片确实发到了模型服务。
export const TITLE_SUGGESTIONS = Object.freeze([
  'Cream cotton knit scarf with ribbed texture',
  'Winter warm knit scarf for couples',
  'Soft everyday knit scarf in cream and black'
]);

// 只有这些接口会真正动希音后台：查重、发品权限、额度、图片上传、发品、审核状态。
// 编辑阶段允许调用只读的模板与币种接口，所以"未确认零调用"针对的是这一组。
export const SUBMISSION_PATHS = Object.freeze(new Set([
  '/open-api/goods/product/check-supplierSku-repeated',
  '/open-api/goods/product/check-publish-permission',
  '/open-api/goods-publish-quotas/detail',
  '/open-api/goods/upload-pic',
  '/open-api/goods/product/publishOrEdit',
  '/open-api/goods/query-document-state'
]));

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>纯棉针织围巾 冬季加厚保暖 韩版百搭情侣款-阿里巴巴</title>
<style>body{font-family:-apple-system,sans-serif;width:1200px;margin:0;padding:16px}
table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #ccc;padding:4px 10px}</style></head><body>
<nav><a href="/">首页</a><a href="/c/scarf">围巾</a><a href="/c/knit">针织</a></nav>
<h1>纯棉针织围巾 冬季加厚保暖 韩版百搭情侣款</h1>
<div class="price">¥ 12.50</div>
<div class="moq">2 件起批</div>
<table><tbody>
<tr><th>材质</th><td>棉</td></tr>
<tr><th>风格</th><td>简约</td></tr>
<tr><th>适用季节</th><td>秋冬</td></tr>
</tbody></table>
<table><thead><tr><th>颜色</th><th>单价</th><th>库存</th></tr></thead><tbody>
<tr><td>米白</td><td>12.50</td><td>900</td></tr>
<tr><td>墨黑</td><td>13.00</td><td>800</td></tr>
</tbody></table>
<div><img src="/main.png" alt="主图" style="width:1000px;height:1000px"></div>
<div><img src="/detail.png" alt="详情图" style="width:900px;height:600px"></div>
</body></html>`;

const AUTHORIZE_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>希音授权</title></head>
<body><p>正在完成店铺授权…</p>
<script>
const query = new URLSearchParams(location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : location.search);
const redirect = query.get('redirectUrl');
const state = query.get('state') || '';
// 授权页把 appid 与回调地址原样带回来，测试才能在服务端看到这次授权用了什么参数。
if (redirect) location.replace(atob(redirect) + '&tempToken=${TEMP_TOKEN}&state=' + encodeURIComponent(state) +
  '&appid=' + encodeURIComponent(query.get('appid') || '') + '&redirect=' + encodeURIComponent(redirect));
</script></body></html>`;

const CALLBACK_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>希音授权成功 · 轻作</title></head>
  <body><main><h1>希音授权成功</h1><p>请返回轻作继续操作。</p></main></body></html>`;

// 1688 页面与希音授权页都用真实域名提供：测试靠 Chromium 的主机映射把它们指到本机 HTTPS 服务。
export async function startStorefront({ key, cert }) {
  const main = pngBytes(1000, 1000);
  const detail = pngBytes(900, 600, [206, 180, 150]);
  const hits = [];
  const server = createHttpsServer({ key, cert }, (request, response) => {
    const host = String(request.headers.host || '').split(':')[0];
    const address = new URL(request.url, 'https://' + (host || AUTHORIZE_HOST));
    const pathname = address.pathname;
    // 授权链接的参数在页面 search 里，浏览器会和服务端一起收到。
    hits.push({ host, path: pathname, url: request.url, query: Object.fromEntries(address.searchParams) });
    if (host === AUTHORIZE_HOST) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(address.searchParams.has('tempToken') ? CALLBACK_PAGE : AUTHORIZE_PAGE);
      return;
    }
    if (host === CALLBACK_HOST && pathname === '/qingzuo-desktop/shein-auth-callback.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(CALLBACK_PAGE);
      return;
    }
    if (pathname === '/main.png' || pathname === '/detail.png') {
      const body = pathname === '/main.png' ? main : detail;
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(body.length), 'cache-control': 'no-store' });
      response.end(body);
      return;
    }
    if (pathname === OFFER_PATH) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(PAGE);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, hits, port: server.address().port, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

const TEMPLATE = {
  attribute_list: [
    { attribute_id: '1001', attribute_name: '材质', attribute_type: 0, is_required: true },
    {
      attribute_id: '2001', attribute_name: '颜色', attribute_type: 1, is_required: true,
      attribute_value_list: [
        { attribute_value_id: '9001', attribute_value: 'Off White' },
        { attribute_value_id: '9002', attribute_value: 'Ink Black' }
      ]
    }
  ]
};

// 店铺类目树按官方结构返回：只有末级分类带 product_type_id。
const CATEGORY_TREE = {
  data: [
    {
      category_id: 1200,
      category_name: '服饰配饰',
      parent_category_id: 0,
      last_category: false,
      children: [
        {
          category_id: 1234,
          category_name: '围巾',
          parent_category_id: 1200,
          last_category: true,
          product_type_id: 5678,
          children: []
        }
      ]
    }
  ]
};

const RESPONSES = {
  '/open-api/auth/get-by-token': { openKeyId: OPEN_KEY_ID, secretKey: encryptedStoreSecret(), supplierId: 9001 },
  '/open-api/goods/query-category-tree': CATEGORY_TREE,
  '/open-api/goods/product/check-supplierSku-repeated': { repeated_supplier_sku_list: [] },
  '/open-api/goods/product/check-publish-permission': { can_publish: true },
  '/open-api/goods-publish-quotas/detail': { remaining_quota: 50, total_quota: 100 },
  '/open-api/goods/query-publish-fill-in-standard': { currency: 'USD' },
  '/open-api/goods/query-attribute-template': TEMPLATE,
  '/open-api/goods/product/publishOrEdit': { spu_name: 'SPU-E2E', skc_list: [{ skc_name: 'SKC-E2E-01' }], sku_list: [{ sku_code: 'SKU-E2E-01' }, { sku_code: 'SKU-E2E-02' }] },
  '/open-api/goods/query-document-state': { document_state: 'APPROVED' }
};

function readBody(request) {
  return new Promise(resolve => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// 模拟翻译服务与希音开放网关，记录每一次调用，供断言"未确认前零发品调用"。
export async function startGateway() {
  const calls = [];
  let uploads = 0;
  const server = createHttpServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const body = await readBody(request);
    calls.push({ path: pathname, headers: { ...request.headers }, body });
    if (pathname === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'mock-translator', display_name: 'Mock Translator' }] }));
      return;
    }
    if (pathname === '/v1/chat/completions') {
      const withImage = body.toString('utf8').includes('"image_url"');
      const content = withImage ? { titles: TITLE_SUGGESTIONS } : TRANSLATION;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
      return;
    }
    if (pathname === '/open-api/goods/upload-pic') {
      uploads += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 0, info: { image_url: 'https://img.shein-e2e.test/' + uploads + '.jpg' } }));
      return;
    }
    const info = RESPONSES[pathname];
    if (info) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 0, info }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: 404, msg: 'unknown ' + pathname }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    calls,
    origin,
    routes: {
      'https://openapi-test01.sheincorp.cn': origin
    },
    sheet: () => calls.filter(call => call.path.startsWith('/open-api/')),
    submissions: () => calls.filter(call => SUBMISSION_PATHS.has(call.path)),
    json: call => JSON.parse(call.body.toString('utf8')),
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })
  };
}

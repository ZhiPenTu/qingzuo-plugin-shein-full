import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectLoginState, needsManualStep, parseProductSnapshot } from '../ui/collect.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/1688-detail-snapshot.json', import.meta.url), 'utf8'));

test('从 1688 详情页快照提取标题、价格、起批量和属性', () => {
  const product = parseProductSnapshot(fixture);
  assert.equal(product.title, '纯棉针织围巾 冬季加厚保暖 韩版百搭情侣款');
  assert.equal(product.price, 12.5);
  assert.equal(product.moq, 2);
  assert.deepEqual(product.attributes.map(item => [item.name, item.value]), [
    ['材质', '棉'],
    ['风格', '简约'],
    ['适用季节', '秋冬']
  ]);
  assert.equal(product.needsHuman, false);
  assert.equal(product.truncated, false);
});

test('SKU 表格按颜色、价格和库存逐行提取', () => {
  const product = parseProductSnapshot(fixture);
  assert.deepEqual(product.skus, [
    { color: '米白', spec: '', price: 12.5, stock: 900, code: '' },
    { color: '墨黑', spec: '', price: 13, stock: 800, code: '' }
  ]);
});

test('表头是 th 时属性表与 SKU 表同样可以提取', () => {
  const cell = (ref, role, name, x, y) => ({ ref, role, name, value: '', visible: true, rect: { x, y, width: 80, height: 24 } });
  const product = parseProductSnapshot({
    url: 'https://detail.1688.com/offer/1.html',
    title: '示例针织围巾-阿里巴巴',
    nodes: [
      cell('n1', 'heading', '示例针织围巾', 10, 10),
      cell('n2', 'generic', '¥ 9.90', 10, 40),
      // 真实快照会带上 table / row 容器，它们不能把单元格行拆散。
      cell('n0', 'table', '材质棉', 10, 80),
      cell('n3', 'rowheader', '材质', 10, 80),
      cell('n4', 'cell', '棉', 100, 80),
      cell('n0b', 'row', '材质棉', 10, 80),
      cell('n5', 'columnheader', '颜色', 10, 120),
      cell('n6', 'columnheader', '单价', 100, 120),
      cell('n7', 'columnheader', '库存', 190, 120),
      cell('n8', 'cell', '米白', 10, 160),
      cell('n9', 'cell', '9.90', 100, 160),
      cell('n10', 'cell', '50', 190, 160),
      cell('n11', 'cell', '墨黑', 10, 200),
      cell('n12', 'cell', '10.50', 100, 200),
      cell('n13', 'cell', '60', 190, 200)
    ]
  });
  assert.deepEqual(product.attributes.map(item => [item.name, item.value]), [['材质', '棉']]);
  assert.deepEqual(product.skus, [
    { color: '米白', spec: '', price: 9.9, stock: 50, code: '' },
    { color: '墨黑', spec: '', price: 10.5, stock: 60, code: '' }
  ]);
});

const node = (ref, role, name, x, y, width = 90, height = 24) => ({ ref, role, name, value: '', visible: true, rect: { x, y, width, height } });

test('颜色与规格分列时逐条保留，并读取货号与库存', () => {
  const product = parseProductSnapshot({
    url: 'https://detail.1688.com/offer/2.html',
    title: '示例针织围巾',
    nodes: [
      node('h1', 'heading', '示例针织围巾', 10, 10, 300),
      node('p1', 'generic', '¥ 12.50', 10, 50, 90),
      node('c1', 'columnheader', '颜色', 10, 120),
      node('c2', 'columnheader', '规格', 120, 120),
      node('c3', 'columnheader', '单价', 230, 120),
      node('c4', 'columnheader', '库存', 340, 120),
      node('c5', 'columnheader', '货号', 450, 120),
      node('r1', 'cell', '米白', 10, 160),
      node('r2', 'cell', 'XL', 120, 160),
      node('r3', 'cell', '12.50', 230, 160),
      node('r4', 'cell', '900', 340, 160),
      node('r5', 'cell', 'A-1001', 450, 160),
      node('r6', 'cell', '米白', 10, 196),
      node('r7', 'cell', 'L', 120, 196),
      node('r8', 'cell', '12.80', 230, 196),
      node('r9', 'cell', '800', 340, 196),
      node('r10', 'cell', 'A-1002', 450, 196),
      node('r11', 'cell', '墨黑', 10, 232),
      node('r12', 'cell', 'M', 120, 232),
      node('r13', 'cell', '13.00', 230, 232),
      node('r14', 'cell', '700', 340, 232),
      node('r15', 'cell', 'A-1003', 450, 232)
    ]
  });
  assert.deepEqual(product.skus, [
    { color: '米白', spec: 'XL', price: 12.5, stock: 900, code: 'A-1001' },
    { color: '米白', spec: 'L', price: 12.8, stock: 800, code: 'A-1002' },
    { color: '墨黑', spec: 'M', price: 13, stock: 700, code: 'A-1003' }
  ]);
});

test('颜色单元格跨行合并时沿用上一行颜色，不丢规格 SKU', () => {
  const product = parseProductSnapshot({
    url: 'https://detail.1688.com/offer/5.html',
    title: '示例袜子',
    nodes: [
      node('h1', 'heading', '示例袜子', 10, 10, 300),
      node('c1', 'columnheader', '颜色', 10, 80),
      node('c2', 'columnheader', '尺码', 120, 80),
      node('c3', 'columnheader', '单价', 230, 80),
      node('r1', 'cell', '米白', 10, 120),
      node('r2', 'cell', 'S', 120, 120),
      node('r3', 'cell', '2.10', 230, 120),
      node('r4', 'cell', 'M', 120, 156),
      node('r5', 'cell', '2.20', 230, 156),
      node('r6', 'cell', '墨黑', 10, 192),
      node('r7', 'cell', 'S', 120, 192),
      node('r8', 'cell', '2.30', 230, 192)
    ]
  });
  assert.deepEqual(product.skus.map(item => [item.color, item.spec, item.price]), [
    ['米白', 'S', 2.1],
    ['米白', 'M', 2.2],
    ['墨黑', 'S', 2.3]
  ]);
});

test('表格中间夹一行说明时继续采集后面的 SKU', () => {
  const product = parseProductSnapshot({
    url: 'https://detail.1688.com/offer/3.html',
    title: '示例围巾',
    nodes: [
      node('h1', 'heading', '示例围巾', 10, 10, 300),
      node('c1', 'columnheader', '颜色', 10, 80),
      node('c2', 'columnheader', '单价', 160, 80),
      node('r1', 'cell', '米白', 10, 120),
      node('r2', 'cell', '12.50', 160, 120),
      node('note', 'cell', '运费说明', 10, 156, 240),
      node('r3', 'cell', '墨黑', 10, 192),
      node('r4', 'cell', '13.00', 160, 192),
      node('r5', 'cell', '深灰', 10, 228),
      node('r6', 'cell', '13.50', 160, 228)
    ]
  });
  assert.deepEqual(product.skus.map(item => item.color), ['米白', '墨黑', '深灰']);
});

test('SKU 做成卡片列表时按颜色区域兜底采集，不把推荐位算进来', () => {
  const product = parseProductSnapshot({
    url: 'https://detail.1688.com/offer/4.html',
    title: '示例围巾',
    nodes: [
      node('h1', 'heading', '示例围巾', 10, 10, 300),
      node('m1', 'generic', '颜色分类', 10, 100),
      node('k1', 'generic', '米白', 10, 140),
      node('k2', 'generic', '¥ 12.50', 120, 140),
      node('k3', 'generic', '墨黑', 10, 180),
      node('k4', 'generic', '¥ 13.00', 120, 180),
      node('m2', 'generic', '推荐商品', 10, 220),
      node('k5', 'generic', '热销围巾', 10, 260),
      node('k6', 'generic', '¥ 9.90', 120, 260)
    ]
  });
  assert.deepEqual(product.skus.map(item => [item.color, item.price]), [['米白', 12.5], ['墨黑', 13]]);
});

test('登录态只看首页成员入口和登录页标记', () => {
  const home = nodes => ({ url: 'https://www.1688.com/', title: '1688', nodes });
  assert.equal(detectLoginState(home([
    node('a', 'link', '请登录', 900, 10, 50),
    node('b', 'link', '免费注册', 960, 10, 60)
  ])), 'signed-out');
  assert.equal(detectLoginState(home([
    node('a', 'link', '我的阿里', 900, 10, 60),
    node('b', 'link', '消息', 970, 10, 40)
  ])), 'signed-in');
  // 未登录首页也会挂「我的阿里」这种入口，不能据此认定已登录。
  assert.equal(detectLoginState(home([
    node('a', 'link', '我的阿里', 900, 10, 60),
    node('b', 'link', '登录', 980, 10, 40),
    node('c', 'link', '免费注册', 1030, 10, 60)
  ])), 'signed-out');
  // 已登录页面页脚可能带「免费注册」推广链接，账号区的退出入口优先。
  assert.equal(detectLoginState(home([
    node('a', 'link', '我的阿里', 900, 10, 60),
    node('b', 'link', '退出登录', 970, 10, 60),
    node('c', 'link', '免费注册', 10, 900, 60)
  ])), 'signed-in');
  assert.equal(detectLoginState(home([
    node('a', 'link', '我的阿里', 900, 10, 60),
    node('c', 'link', '免费注册', 10, 900, 60)
  ])), 'signed-in');
  assert.equal(detectLoginState(home([])), 'unknown');
  assert.equal(detectLoginState({ url: 'https://login.1688.com/member/signin.htm', nodes: [] }), 'signed-out');
});

test('主图优先取方形大图，详情图不重复计入', () => {
  const product = parseProductSnapshot(fixture);
  const main = product.images.filter(image => image.role === 'main');
  const detail = product.images.filter(image => image.role === 'detail');
  assert.equal(main.length, 3);
  assert.equal(detail.length, 2);
  assert.ok(main.every(image => image.width === image.height));
  assert.ok(product.images.every(image => /^https:\/\//.test(image.url)));
});

test('面包屑只保留标题上方的类目链接', () => {
  const product = parseProductSnapshot(fixture);
  assert.deepEqual(product.breadcrumb, ['围巾']);
});

test('登录页或验证码页面停在人工处理，不做绕过', () => {
  const snapshot = {
    url: 'https://detail.1688.com/offer/1.html',
    title: '阿里巴巴登录',
    nodes: [
      { ref: 'qz-1', role: 'heading', name: '请登录后查看商品', value: '', visible: true, rect: { x: 0, y: 0, width: 400, height: 40 } },
      { ref: 'qz-2', role: 'textbox', name: '请输入验证码', value: '', visible: true, rect: { x: 0, y: 60, width: 200, height: 32 } }
    ]
  };
  const product = parseProductSnapshot(snapshot);
  assert.equal(needsManualStep(product), true);
  assert.equal(product.title, '请登录后查看商品');
});

test('隐藏节点不参与采集', () => {
  const snapshot = {
    url: 'https://detail.1688.com/offer/2.html',
    title: '测试商品',
    nodes: [
      { ref: 'qz-1', role: 'heading', name: '隐藏的假标题', value: '', visible: false, rect: { x: 0, y: 0, width: 400, height: 40 } },
      { ref: 'qz-2', role: 'heading', name: '真正的商品标题', value: '', visible: true, rect: { x: 0, y: 100, width: 400, height: 40 } }
    ]
  };
  const product = parseProductSnapshot(snapshot);
  assert.equal(product.title, '真正的商品标题');
  assert.ok(product.notes.includes('未识别到价格'));
});

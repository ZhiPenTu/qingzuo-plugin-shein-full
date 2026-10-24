import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseProductSnapshot, needsManualStep } from '../ui/collect.mjs';

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
    { color: '米白', price: 12.5, stock: 900 },
    { color: '墨黑', price: 13, stock: 800 }
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
    { color: '米白', price: 9.9, stock: 50 },
    { color: '墨黑', price: 10.5, stock: 60 }
  ]);
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

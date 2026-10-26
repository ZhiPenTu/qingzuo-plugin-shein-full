import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCategoryPath, parseCategoryTree } from '../ui/category.mjs';

const TREE = {
  data: [
    {
      category_id: 1200,
      category_name: '服饰配饰',
      parent_category_id: 0,
      last_category: false,
      children: [
        {
          category_id: '1234',
          category_name: '围巾',
          parent_category_id: 1200,
          last_category: true,
          product_type_id: '5678',
          children: []
        }
      ]
    },
    {
      category_id: 1300,
      category_name: '家居',
      children: [
        {
          category_id: 1301,
          category_name: '抱枕',
          product_type_id: 7001
        }
      ]
    }
  ]
};

test('类目树保留层级，末级分类带 product_type_id', () => {
  const tree = parseCategoryTree(TREE);
  assert.equal(tree.length, 2);
  assert.deepEqual(tree[0], {
    categoryId: '1200',
    name: '服饰配饰',
    productTypeId: '',
    leaf: false,
    children: [{ categoryId: '1234', name: '围巾', productTypeId: '5678', leaf: true, children: [] }]
  });
  // last_category 缺失时，没有子节点且带商品类型也视为末级。
  assert.equal(tree[1].children[0].leaf, true);
  assert.equal(tree[1].children[0].productTypeId, '7001');
});

test('按类目 ID 找到从根到末级的路径', () => {
  const tree = parseCategoryTree(TREE);
  assert.deepEqual(findCategoryPath(tree, '1234').map(node => node.name), ['服饰配饰', '围巾']);
  assert.deepEqual(findCategoryPath(tree, 1301).map(node => node.categoryId), ['1300', '1301']);
  assert.deepEqual(findCategoryPath(tree, '9999'), []);
  assert.deepEqual(findCategoryPath(tree, ''), []);
});

test('兼容直接数组与常见字段别名', () => {
  const direct = parseCategoryTree([
    { categoryId: '1', categoryName: '女装', child_list: [{ category_id: 2, category_name: '上衣', productTypeId: 3 }] }
  ]);
  assert.equal(direct[0].categoryId, '1');
  assert.equal(direct[0].children[0].categoryId, '2');
  assert.equal(direct[0].children[0].productTypeId, '3');
});

test('空值与无效节点不会污染类目树', () => {
  assert.deepEqual(parseCategoryTree(null), []);
  assert.deepEqual(parseCategoryTree({}), []);
  assert.deepEqual(parseCategoryTree({ data: [null, { category_name: '缺少 ID' }, { category_id: 7 }] }), [
    { categoryId: '7', name: '7', productTypeId: '', leaf: false, children: [] }
  ]);
});

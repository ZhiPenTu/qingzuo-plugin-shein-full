import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COEFFICIENT, supplyPrice, validateCoefficient, priceIssues, priceSpreadWarning, skuSupplyPrices } from '../ui/pricing.mjs';

test('默认加价系数把 1688 单价换算成两位小数供货价', () => {
  assert.equal(DEFAULT_COEFFICIENT, 1.35);
  assert.equal(supplyPrice(12.5), 16.88);
  assert.equal(supplyPrice(13, 1.4), 18.2);
});

test('加价系数限制在 1.05 到 3 之间', () => {
  assert.equal(validateCoefficient(1.35), 1.35);
  assert.throws(() => validateCoefficient(1), /加价系数/);
  assert.throws(() => validateCoefficient(3.5), /加价系数/);
  assert.throws(() => validateCoefficient('abc'), /加价系数/);
});

test('供货价异常（过低、过高、多余小数）会被指出', () => {
  assert.deepEqual(priceIssues(16.88), []);
  assert.ok(priceIssues(0.2).length > 0);
  assert.ok(priceIssues(20000).length > 0);
  assert.ok(priceIssues(1.234).some(message => message.includes('两位小数')));
  assert.throws(() => supplyPrice(0), /单价无效/);
});

test('SKU 单价差距过大时给出采集核对提示', () => {
  assert.equal(priceSpreadWarning([{ price: 10 }, { price: 20 }]), null);
  assert.match(priceSpreadWarning([{ price: 10 }, { price: 45 }]), /3 倍/);
  assert.equal(priceSpreadWarning([{ price: 10 }]), null);
});

test('批量换算保留每个 SKU 的供货价', () => {
  assert.deepEqual(skuSupplyPrices([{ price: 10 }, { price: 20 }], 1.5), [
    { price: 10, supplyPrice: 15 },
    { price: 20, supplyPrice: 30 }
  ]);
});

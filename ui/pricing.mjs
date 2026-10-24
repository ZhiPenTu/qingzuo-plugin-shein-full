export const DEFAULT_COEFFICIENT = 1.35;
export const MIN_COEFFICIENT = 1.05;
export const MAX_COEFFICIENT = 3;
export const MIN_SUPPLY_PRICE = 0.5;
export const MAX_SUPPLY_PRICE = 10000;

export function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

export function validateCoefficient(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('加价系数无效。');
  if (number < MIN_COEFFICIENT || number > MAX_COEFFICIENT) throw new Error('加价系数需在 ' + MIN_COEFFICIENT + ' 到 ' + MAX_COEFFICIENT + ' 之间。');
  return Math.round(number * 1000) / 1000;
}

export function supplyPrice(unitPrice, coefficient = DEFAULT_COEFFICIENT) {
  const price = Number(unitPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error('1688 单价无效。');
  return roundMoney(price * validateCoefficient(coefficient));
}

export function priceIssues(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return ['供货价无效'];
  const issues = [];
  if (price < MIN_SUPPLY_PRICE) issues.push('供货价低于 ' + MIN_SUPPLY_PRICE);
  if (price > MAX_SUPPLY_PRICE) issues.push('供货价高于 ' + MAX_SUPPLY_PRICE);
  if (Math.abs(roundMoney(price) - price) > 1e-9) issues.push('供货价需保留两位小数');
  return issues;
}

export function skuSupplyPrices(skus, coefficient) {
  return (Array.isArray(skus) ? skus : []).map(sku => ({ ...sku, supplyPrice: supplyPrice(sku.price, coefficient) }));
}

// A draft whose SKU prices swing wildly is usually a parsing mistake, not a business decision.
export function priceSpreadWarning(skus) {
  const values = (Array.isArray(skus) ? skus : []).map(sku => Number(sku.price)).filter(value => Number.isFinite(value) && value > 0);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max > min * 3 ? '各 SKU 单价差距超过 3 倍，请确认采集结果。' : null;
}

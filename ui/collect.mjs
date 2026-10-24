const NAV_WORDS = /^(首页|商品|商品详情|公司档案|联系方式|登录|注册|购物车|我的阿里|1688首页)$/;
const TITLE_NOISE = /(-阿里巴巴|_阿里巴巴|阿里巴巴批发网|1688\.com|批发网)$/g;
const PRICE = /[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/;
const MOQ = /([0-9]+)\s*(件|个|条|双|套|只|支|包|箱|米|台|把|张|卷)?\s*起批/;
const MOQ_ALT = /起订量?\s*[:：]?\s*([0-9]+)/;
const COLOR_HEADER = /颜色|色号|规格|款式/;
const PRICE_HEADER = /单价|价格|批发价/;
const STOCK_HEADER = /库存|可售/;
const IMAGE_URL = /\.(jpe?g|png|webp|avif)(?:[?#]|$)/i;
const NEEDS_HUMAN = /(滑动验证|安全验证|验证码|请先登录|登录后查看|访问受限|页面不存在)/;

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function money(value) {
  const match = String(value ?? '').match(PRICE) || String(value ?? '').match(/^\s*([0-9]+(?:\.[0-9]{1,2})?)\s*$/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// 快照会同时给出 table / row 容器和它们的单元格；容器只是把子节点文字重复
// 一遍，留在行里会让整行被判成未知角色，表格就整张漏掉。
const STRUCTURAL_ROLES = new Set(['table', 'row']);

function groupedRows(nodes) {
  const buckets = new Map();
  for (const node of nodes) {
    if (!node.rect) continue;
    if (STRUCTURAL_ROLES.has(node.role)) continue;
    const key = Math.round(node.rect.y / 8);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.sort((a, b) => a.rect.x - b.rect.x));
}

function pickTitle(nodes, pageTitle) {
  const headings = nodes
    .filter(node => node.role === 'heading')
    .map(node => clean(node.name))
    .filter(name => name.length >= 4 && !NAV_WORDS.test(name));
  if (headings.length) return headings.sort((a, b) => b.length - a.length)[0].slice(0, 200);
  const fallback = clean(pageTitle).replace(TITLE_NOISE, '').trim();
  return fallback.length >= 4 ? fallback.slice(0, 200) : '';
}

function pickPrice(nodes) {
  const values = [];
  for (const node of nodes) {
    const value = money(node.name) ?? money(node.value);
    if (value) values.push(value);
  }
  return values.length ? Math.min(...values) : null;
}

function pickMoq(nodes) {
  for (const node of nodes) {
    const text = clean(node.name) + ' ' + clean(node.value);
    const match = text.match(MOQ) || text.match(MOQ_ALT);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return { moq: value, unit: match[2] ?? '' };
    }
  }
  return { moq: null, unit: '' };
}

// <th> 在无障碍树里是 rowheader / columnheader，1688 的属性表与 SKU 表都用它，
// 只认 cell 会把整张带表头的表格漏掉。
const CELL_ROLES = new Set(['cell', 'label', 'columnheader', 'rowheader']);
const ATTRIBUTE_ROLES = new Set([...CELL_ROLES, 'generic', 'textbox', 'listitem']);

function isTableRow(row) {
  return row.every(node => CELL_ROLES.has(node.role));
}

function isAttributeRow(row) {
  return row.every(node => ATTRIBUTE_ROLES.has(node.role));
}

function pushAttribute(attributes, seen, name, value) {
  const label = clean(name).replace(/[:：*＊]+$/, '').trim();
  const text = clean(value).slice(0, 200);
  if (!label || !text || label.length > 30 || NAV_WORDS.test(label) || seen.has(label)) return;
  if (label === text || /^[0-9]+(?:\.[0-9]+)?$/.test(text)) return;
  if (PRICE.test(text) || MOQ.test(text) || MOQ_ALT.test(text)) return;
  seen.add(label);
  attributes.push({ name: label, value: text });
}

// 1688 同时存在表格型属性（单元格成对）和键值行（"材质：棉"），
// 两种都要采集，否则新版详情页只剩标题和价格。
function parseAttributes(rows, skuHeaderIndex = -1) {
  const attributes = [];
  const seen = new Set();
  const limit = skuHeaderIndex >= 0 ? skuHeaderIndex : rows.length;
  for (const row of rows.slice(0, limit)) {
    if (!isAttributeRow(row)) continue;
    if (row.length === 1) {
      const match = clean(row[0].name).match(/^([^:：]{1,30})[:：]\s*(.+)$/);
      if (match) pushAttribute(attributes, seen, match[1], match[2]);
      continue;
    }
    for (let index = 0; index + 1 < row.length; index += 2) pushAttribute(attributes, seen, row[index].name, row[index + 1].name);
  }
  return attributes.slice(0, 40);
}

function findSkuHeader(rows) {
  return rows.findIndex(row => isTableRow(row) && row.some(node => COLOR_HEADER.test(clean(node.name))) && row.some(node => PRICE_HEADER.test(clean(node.name))));
}

function parseSkus(rows, headerIndex) {
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map(node => clean(node.name));
  const colorIndex = header.findIndex(name => COLOR_HEADER.test(name));
  const priceIndex = header.findIndex(name => PRICE_HEADER.test(name));
  const stockIndex = header.findIndex(name => STOCK_HEADER.test(name));
  const skus = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.length < 2) continue;
    const color = clean(row[colorIndex]?.name);
    const price = money(row[priceIndex]?.name);
    if (!color || !price) break;
    const stockText = clean(row[stockIndex]?.name);
    const stock = stockIndex >= 0 && /^[0-9]+$/.test(stockText) ? Number(stockText) : null;
    skus.push({ color: color.slice(0, 60), price, stock });
    if (skus.length >= 60) break;
  }
  return skus;
}

function pickImages(nodes) {
  const seen = new Set();
  const images = [];
  for (const node of nodes) {
    if (node.role !== 'img' || typeof node.url !== 'string' || !/^https?:\/\//.test(node.url)) continue;
    if (!IMAGE_URL.test(node.url)) continue;
    const width = Math.round(node.rect?.width ?? 0);
    const height = Math.round(node.rect?.height ?? 0);
    if (width < 300 || height < 300) continue;
    const key = node.url.split('?')[0].replace(/_(\d+x\d+|sum)\.(\w+)$/i, '.$2');
    if (seen.has(key)) continue;
    seen.add(key);
    images.push({ url: node.url, width, height, role: 'detail', area: width * height });
  }
  images.sort((a, b) => b.area - a.area);
  const square = images.filter(image => Math.abs(image.width - image.height) <= Math.max(image.width, image.height) * 0.18);
  const main = square.slice(0, 5);
  if (!main.length && images.length) main.push(images[0]);
  const mainUrls = new Set(main.map(image => image.url));
  return {
    main: main.map(({ url, width, height }) => ({ url, width, height, role: 'main' })),
    detail: images.filter(image => !mainUrls.has(image.url)).slice(0, 20).map(({ url, width, height }) => ({ url, width, height, role: 'detail' }))
  };
}

function pickBreadcrumb(nodes, titleNode) {
  const limit = titleNode?.rect?.y ?? Number.POSITIVE_INFINITY;
  return nodes
    .filter(node => node.role === 'link' && node.rect && node.rect.y < limit)
    .map(node => clean(node.name))
    .filter(name => name && !NAV_WORDS.test(name) && name.length <= 30)
    .slice(-3);
}

export function parseProductSnapshot(snapshot) {
  const nodes = (Array.isArray(snapshot?.nodes) ? snapshot.nodes : []).filter(node => node && node.visible !== false && typeof node.name === 'string');
  const rows = groupedRows(nodes);
  const titleNode = nodes.find(node => node.role === 'heading' && clean(node.name).length >= 4);
  const title = pickTitle(nodes, snapshot?.pageTitle ?? snapshot?.title ?? '');
  const { moq, unit } = pickMoq(nodes);
  const images = pickImages(nodes);
  const skuHeaderIndex = findSkuHeader(rows);
  const attributes = parseAttributes(rows, skuHeaderIndex);
  const skus = parseSkus(rows, skuHeaderIndex);
  const price = pickPrice(nodes) ?? (skus.length ? Math.min(...skus.map(sku => sku.price)) : null);
  const notes = [];
  if (!title) notes.push('未识别到商品标题');
  if (!price) notes.push('未识别到价格');
  if (!skus.length) notes.push('未识别到 SKU 表格，将使用单一默认 SKU');
  if (!images.main.length) notes.push('未识别到主图');
  if (!attributes.length) notes.push('未识别到属性表');
  const text = nodes.map(node => clean(node.name)).join(' ');
  const needsHuman = NEEDS_HUMAN.test(text) || (!title && !price);
  return {
    url: snapshot?.url ?? '',
    pageTitle: snapshot?.title ?? snapshot?.pageTitle ?? '',
    title,
    price,
    moq,
    unit,
    breadcrumb: pickBreadcrumb(nodes, titleNode),
    attributes,
    skus,
    images: [...images.main, ...images.detail],
    notes,
    needsHuman,
    truncated: Boolean(snapshot?.truncated)
  };
}

export function needsManualStep(state) {
  return Boolean(state?.needsHuman);
}

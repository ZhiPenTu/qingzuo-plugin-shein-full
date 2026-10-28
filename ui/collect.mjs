const NAV_WORDS = /^(首页|商品|商品详情|公司档案|联系方式|登录|注册|购物车|我的阿里|1688首页)$/;
const TITLE_NOISE = /(-阿里巴巴|_阿里巴巴|阿里巴巴批发网|1688\.com|批发网)$/g;
const PRICE = /[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/;
const MOQ = /([0-9]+)\s*(件|个|条|双|套|只|支|包|箱|米|台|把|张|卷)?\s*起批/;
const MOQ_ALT = /起订量?\s*[:：]?\s*([0-9]+)/;
const COLOR_HEADER = /颜色|色号|款式/;
const SPEC_HEADER = /规格|尺码|尺寸|型号|码数/;
const PRICE_HEADER = /单价|价格|批发价|售价/;
const STOCK_HEADER = /库存|可售|剩余/;
const CODE_HEADER = /货号|编码|SKU/i;
const IMAGE_URL = /\.(jpe?g|png|webp|avif)(?:[?#]|$)/i;
const NEEDS_HUMAN = /(滑动验证|安全验证|验证码|请先登录|登录后查看|访问受限|页面不存在)/;
const LOGIN_HOST = /^(login|passport)\.(1688|taobao|tmall)\.com$/i;
// 只有登录后才会出现的账号区入口。
const LOGIN_IN_STRONG = /(退出登录|退出账号|安全退出|切换账号)/;
// 只有未登录才会出现的登录条文案。已登录页脚常带「免费注册」这类推广链接，
// 所以推广词不算未登录证据，避免把已登录的运营挡在采集之外。
const LOGIN_OUT_TEXT = /(请先登录|亲，请登录|请登录|账号登录|密码登录|登录\/注册|立即登录)/;
const LOGIN_OUT_ACTION = /^(登录|立即登录)$/;
// 「我的阿里」「消息」等在未登录时也会展示，只能当兜底证据。
const LOGIN_IN_WEAK = /(我的阿里|卖家中心|买家中心|采购中心|消息中心|账户设置)/;
const TIER_LABEL = /^(≥|>|满)|^[0-9]+([-~～至][0-9]+)?\s*(件|个|条|双|套|只|支|包|箱|米|台|把|张|卷|起批)/;
const MAX_SKUS = 200;

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
  const list = nodes
    .filter(node => node.rect && !STRUCTURAL_ROLES.has(node.role))
    .sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
  const rows = [];
  for (const node of list) {
    const height = Number(node.rect.height) || 0;
    const center = node.rect.y + height / 2;
    const tolerance = Math.max(6, Math.min(24, height * 0.6));
    const row = rows[rows.length - 1];
    // 按 y 聚成行，但容差跟着单元格高度走：多行文字的单元格不会把同一行拆散，
    // 相邻两行也不会因为 8 px 抖动被并成一行。
    if (row && Math.abs(center - row.center) <= Math.max(tolerance, row.tolerance)) {
      row.nodes.push(node);
      row.center = (row.center * row.count + center) / (row.count + 1);
      row.count += 1;
      row.tolerance = Math.max(row.tolerance, tolerance);
    } else {
      rows.push({ center, count: 1, tolerance, nodes: [node] });
    }
  }
  return rows.map(row => row.nodes.sort((a, b) => a.rect.x - b.rect.x));
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

// 表头只认短标签，避免把「颜色：红色」这类属性行误判成表头。
function headerRoleOf(name) {
  const value = clean(name).replace(/[（(][^）)]*[)）]/g, '').trim();
  if (/^(单价|价格|批发价|售价)$/.test(value)) return 'price';
  if (/^(库存|可售|剩余)$/.test(value)) return 'stock';
  if (/^(货号|编码|SKU|商品编码|SKU编码)$/i.test(value)) return 'code';
  if (/^(规格|尺码|尺寸|型号|码数)$/.test(value)) return 'spec';
  if (/^(颜色|颜色分类|色号|款式)$/.test(value)) return 'color';
  return '';
}

// 表头可能只有一层，也可能「颜色」和「单价」拆成两行；两行都算进列定义。
function findSkuHeader(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!isAttributeRow(row)) continue;
    const roles = row.map(node => headerRoleOf(node.name));
    const variant = roles.includes('color') || roles.includes('spec');
    if (!variant) continue;
    if (roles.includes('price')) return { index, span: 1 };
    const next = rows[index + 1];
    if (next && isAttributeRow(next) && next.some(node => headerRoleOf(node.name) === 'price')) return { index, span: 2 };
  }
  return { index: -1, span: 0 };
}

function headerColumns(rows, header) {
  const nodes = header.span === 2 ? [...rows[header.index], ...rows[header.index + 1]] : rows[header.index];
  const columns = [];
  const seen = new Set();
  for (const node of nodes) {
    const role = headerRoleOf(node.name);
    if (!role || seen.has(role)) continue;
    seen.add(role);
    columns.push({
      role,
      center: (node.rect?.x ?? 0) + (node.rect?.width ?? 0) / 2,
      width: Number(node.rect?.width) || 0
    });
  }
  return columns;
}

function columnRoleAt(node, columns) {
  if (!node?.rect) return '';
  const center = node.rect.x + (Number(node.rect.width) || 0) / 2;
  let role = '';
  let nearest = Number.POSITIVE_INFINITY;
  for (const column of columns) {
    const distance = Math.abs(center - column.center);
    const tolerance = Math.max(90, column.width / 2 + 40);
    if (distance <= tolerance && distance < nearest) {
      nearest = distance;
      role = column.role;
    }
  }
  return role;
}

function readSkuRow(row, columns, hasColorColumn, inheritedColor = '') {
  const values = { color: '', spec: '', price: null, stock: null, code: '' };
  const filled = new Set();
  for (const node of row) {
    const role = columnRoleAt(node, columns);
    if (!role || filled.has(role)) continue;
    const value = clean(node.name);
    if (!value) continue;
    if (role === 'price') {
      const price = money(value);
      if (price) { values.price = price; filled.add(role); }
      continue;
    }
    if (role === 'stock') {
      const digits = value.match(/[0-9]+/g);
      if (digits && digits.length === 1) { values.stock = Number(digits[0]); filled.add(role); }
      continue;
    }
    values[role] = value;
    filled.add(role);
  }
  if (!hasColorColumn && values.spec) {
    values.color = values.spec;
    values.spec = '';
  }
  // 1688 的颜色单元格常常跨行合并，后续行只剩规格和价格；沿用上一行的颜色才不会整行丢掉。
  if (!values.color && inheritedColor && values.price !== null) values.color = inheritedColor;
  if (!values.color || values.price === null) return null;
  return values;
}

// 有些详情页把 SKU 做成卡片列表而不是表格：在「颜色/规格」区块里找
// “名称 + ¥价格”的行，跳过阶梯价和推荐位。
function skuRegion(nodes) {
  const markers = nodes.filter(node => {
    const text = clean(node.name);
    return text.length <= 12 && /^(颜色分类|颜色|规格|尺码|型号|款式)$/.test(text);
  });
  const marker = markers[markers.length - 1];
  if (!marker?.rect) return null;
  const start = marker.rect.y - 40;
  const stops = nodes
    .filter(node => node.rect && node.rect.y > start && /^(商品详情|宝贝详情|推荐|猜你喜欢|看了又看|相关推荐|热销)/.test(clean(node.name)))
    .map(node => node.rect.y);
  return { start, end: stops.length ? Math.min(...stops) : start + 1600 };
}

function isSkuLabel(value) {
  const text = clean(value);
  if (!text || text.length > 30) return false;
  if (NAV_WORDS.test(text)) return false;
  if (TIER_LABEL.test(text)) return false;
  if (/[¥￥]/.test(text) || PRICE_HEADER.test(text) || STOCK_HEADER.test(text) || CODE_HEADER.test(text)) return false;
  if (COLOR_HEADER.test(text) || SPEC_HEADER.test(text)) return false;
  if (/起批|优惠|运费|服务|包邮|销量|评价|收藏|已售|库存/.test(text)) return false;
  if (/^[0-9]+(\.[0-9]+)?$/.test(text)) return false;
  return true;
}

function parseSkuCards(nodes, rows) {
  const region = skuRegion(nodes);
  if (!region) return [];
  const found = new Map();
  for (const row of rows) {
    const y = row[0]?.rect?.y;
    if (!Number.isFinite(y) || y < region.start || y > region.end) continue;
    if (row.length < 2 || row.length > 8) continue;
    const texts = row.map(node => clean(node.name)).filter(Boolean);
    if (texts.length < 2) continue;
    const priced = texts.filter(text => /[¥￥]/.test(text) && money(text));
    if (priced.length !== 1) continue;
    const price = money(priced[0]);
    const label = texts.find(text => text !== priced[0] && isSkuLabel(text));
    if (!label || !price) continue;
    const key = label.slice(0, 60);
    const existing = found.get(key);
    // 同一颜色出现多档价格时按最低价保留，避免把阶梯价当成多个 SKU。
    if (!existing || price < existing.price) found.set(key, { color: key, spec: '', price, stock: null, code: '' });
  }
  return [...found.values()].slice(0, MAX_SKUS);
}

function parseSkus(nodes, rows, header) {
  if (!header || header.index < 0) return parseSkuCards(nodes, rows);
  const columns = headerColumns(rows, header);
  if (!columns.length) return [];
  const hasColorColumn = columns.some(column => column.role === 'color');
  const skus = [];
  const seen = new Set();
  let misses = 0;
  let lastColor = '';
  for (const row of rows.slice(header.index + header.span)) {
    const values = readSkuRow(row, columns, hasColorColumn, lastColor);
    if (!values) {
      misses += 1;
      // 允许表格中间夹着“运费说明”“查看更多”这类行，连续两行没有数据才认为表格结束。
      if (skus.length && misses >= 2) break;
      continue;
    }
    misses = 0;
    lastColor = values.color;
    const key = values.color + '\u0000' + values.spec + '\u0000' + values.price;
    if (seen.has(key)) continue;
    seen.add(key);
    skus.push({
      color: values.color.slice(0, 60),
      spec: values.spec.slice(0, 40),
      price: values.price,
      stock: values.stock,
      code: values.code.slice(0, 60)
    });
    if (skus.length >= MAX_SKUS) break;
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
  const skuHeader = findSkuHeader(rows);
  const attributes = parseAttributes(rows, skuHeader.index);
  let skus = parseSkus(nodes, rows, skuHeader);
  if (!skus.length) skus = parseSkuCards(nodes, rows);
  const price = pickPrice(nodes) ?? (skus.length ? Math.min(...skus.map(sku => sku.price)) : null);
  const notes = [];
  if (!title) notes.push('未识别到商品标题');
  if (!price) notes.push('未识别到价格');
  if (!skus.length) notes.push('未识别到 SKU 表格，将使用单一默认 SKU；可在右侧浏览器展开规格后重新采集');
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

// 只看可见节点，按 1688 顶部导航的成员入口判断登录态；
// 命中登录域名或登录按钮说明还没登录，两者都没有时返回 unknown，不臆测。
export function detectLoginState(snapshot) {
  const url = String(snapshot?.url ?? '');
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch {}
  if (LOGIN_HOST.test(host)) return 'signed-out';
  const nodes = (Array.isArray(snapshot?.nodes) ? snapshot.nodes : [])
    .filter(node => node && node.visible !== false && typeof node.name === 'string');
  const names = nodes.map(node => clean(node.name)).filter(Boolean);
  const text = names.join(' ');
  // 顺序很重要：账号区的退出入口是明确登录证据，不能被页脚推广链接推翻。
  if (LOGIN_IN_STRONG.test(text)) return 'signed-in';
  if (LOGIN_OUT_TEXT.test(text)) return 'signed-out';
  if (names.some(name => LOGIN_OUT_ACTION.test(name))) return 'signed-out';
  if (LOGIN_IN_WEAK.test(text)) return 'signed-in';
  return 'unknown';
}

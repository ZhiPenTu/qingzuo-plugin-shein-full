import { createPluginClient } from './sdk.mjs';
import { createController } from './controller.mjs';
import { STATUS_LABEL, blockingIssues, validateDraft } from './store.mjs';
import { ROLE_LABEL, fitForShein, readImageSize, submitImage, translatedVersion, usesTranslation, validateImage } from './images.mjs';
import { mergeTranslationResults, translationFailures, translationRecord, translationTargets, withSourceVersion } from './image-translate.mjs';
import { IMAGE_TEXT_PROMPT } from './translate.mjs';
import { supplyPrice } from './pricing.mjs';
import { SECRET_CREDENTIAL } from './shein-client.mjs';
import { callbackUrlOf } from './shein-auth.mjs';
import { findCategoryPath } from './category.mjs';

const client = createPluginClient();
const controller = createController({ client });
const $ = id => document.getElementById(id);

const IMAGE_ROLES = [['main', '主图'], ['detail', '详情图']];
const AUDIT_LABEL = { PENDING: '希音审核中', APPROVED: '审核通过', REJECTED: '已驳回' };
const CURRENCY_SYMBOL = { USD: '$', EUR: '€', GBP: '£', CNY: '¥', JPY: '¥' };
const TRANSLATE_POLL_MS = 1200;

const state = {
  selectedId: null,
  form: null,
  dirty: false,
  busy: false,
  imageUrls: new Map(),
  suggestions: [],
  categories: null,
  categoriesLoading: false,
  categoriesError: '',
  categoriesPromise: null,
  categoryPath: [],
  categoryDraftId: null,
  credentials: null,
  settingsOpen: false,
  credentialRevision: 0,
  authCancelled: false,
  tab: 'content',
  imageId: null,
  imageView: 'original',
  compare: 50,
  viewer: { open: false, images: [], index: 0, version: 'original', zoom: 1 },
  imageModels: [],
  imageModelsLoading: false,
  imageModelsError: '',
  imageModelsPromise: null,
  translateRunning: false,
  translateBatch: null,
  translateTotal: 0,
  translateDone: 0
};

// APP_SecretKey 只在换取店铺凭据时需要明文：签名走主进程里的凭据，
// 解密希音下发的 secretKey 需要原值。输入框在成功后清空，本次会话内改用内存副本，
// 这样重新授权时不用反复填密钥。
let appSecretValue = '';

const clone = value => JSON.parse(JSON.stringify(value ?? null));

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function statusClass(status) {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'bad';
  if (status === 'review') return 'warn';
  if (status === 'submitted') return 'info';
  return '';
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? '操作未完成。');
}

function formatTime(value) {
  const stamp = Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return '—';
  return new Date(stamp).toLocaleString('zh-CN', { hour12: false });
}

function formatSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '—';
  return size >= 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB';
}

function safeSupply(sku, form) {
  try { return supplyPrice(sku?.price ?? form.source?.price ?? 0, form.product?.coefficient); } catch { return 0; }
}

function money(value, currency = 'USD') {
  const amount = Number(value) || 0;
  const code = String(currency || 'USD').toUpperCase();
  const symbol = CURRENCY_SYMBOL[code];
  return symbol ? symbol + amount.toFixed(2) : amount.toFixed(2) + ' ' + code;
}

function setStatus(id, text, error = false) {
  const node = $(id);
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('error', Boolean(error));
}

function selectedDraft() {
  const id = state.selectedId;
  return id ? controller.getState().drafts.find(draft => draft.id === id) ?? null : null;
}

function syncForm() {
  const draft = selectedDraft();
  if (!draft) {
    state.selectedId = null;
    state.form = null;
    state.dirty = false;
    return null;
  }
  if (!state.form || state.form.id !== draft.id) {
    state.form = clone(draft);
    state.dirty = false;
  } else if (!state.dirty && state.form.updated !== draft.updated) {
    state.form = clone(draft);
  }
  return state.form;
}

function render() {
  renderDrafts();
  const form = syncForm();
  renderTabs();
  renderReview(form);
}

// 窄窗口下面板内容很长，分区比纵向堆叠更好用；当前分区跟着草稿走，切换草稿不跳回第一页。
function renderTabs() {
  for (const [name, pane] of [['content', 'pane-content'], ['images', 'pane-images'], ['source', 'pane-source']]) {
    const tab = $('tab-' + name);
    const active = state.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    $(pane).hidden = !active;
  }
}

function selectTab(name) {
  state.tab = name;
  renderTabs();
}

function renderDrafts() {
  const drafts = controller.getState().drafts;
  $('draft-count').textContent = String(drafts.length);
  $('draft-empty').hidden = drafts.length > 0;
  const list = $('draft-list');
  list.replaceChildren();
  for (const draft of drafts) {
    const title = draft.product?.title?.en || draft.product?.title?.zh || '未命名商品';
    const price = Number(draft.source?.price) || 0;
    const button = el('button', {
      type: 'button',
      class: 'draft-item' + (draft.id === state.selectedId ? ' is-active' : ''),
      onclick: () => selectDraft(draft.id)
    },
      el('span', { class: 'draft-status ' + statusClass(draft.status), text: STATUS_LABEL[draft.status] ?? draft.status }),
      el('strong', { text: title }),
      el('span', { class: 'draft-meta', text: price ? '1688 ¥' + price.toFixed(2) : '未识别价格' })
    );
    list.append(el('li', {}, button));
  }
}

function renderReview(form) {
  $('review').hidden = !form;
  $('no-draft').hidden = Boolean(form);
  if (!form) return;

  $('review-status').textContent = STATUS_LABEL[form.status] ?? form.status;
  $('review-status').className = 'chip ' + statusClass(form.status);
  $('review-title').textContent = form.product?.title?.en || form.product?.title?.zh || '未命名商品';
  const price = Number(form.source?.price) || 0;
  const moq = form.source?.moq ? ` · ${form.source.moq}${form.source.unit || ''} 起批` : '';
  $('review-meta').textContent = `${price ? '¥' + price.toFixed(2) : '无价格'}${moq} · 采集于 ${formatTime(form.source?.capturedAt)}`;

  renderSubmission(form);
  renderSource(form);
  renderForm(form);
  renderImages(form);
  renderIssues(form);
  updateGate();
  void loadImageUrls();
}

function renderSubmission(form) {
  const box = $('submission');
  const submission = form.submission;
  if (!submission || (!submission.spuName && !submission.pending)) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  const rows = [];
  if (submission.spuName) rows.push(['希音 SPU', submission.spuName]);
  if (submission.skcNames?.length) rows.push(['SKC', submission.skcNames.join('、')]);
  if (submission.skuCodes?.length) rows.push(['SKU 编码', submission.skuCodes.join('、')]);
  if (submission.documentState) rows.push(['审核状态', AUDIT_LABEL[submission.documentState] ?? submission.documentState]);
  if (submission.at) rows.push(['提交时间', formatTime(submission.at)]);
  box.append(el('dl', { class: 'facts' }, ...rows.map(([term, value]) => el('div', { class: 'fact' }, el('dt', { text: term }), el('dd', { text: value })))));
  if (submission.rejectedReason) box.append(el('p', { class: 'warning', text: '驳回原因：' + submission.rejectedReason }));
  if (submission.pending && !submission.spuName) {
    box.append(el('p', { class: 'warning', text: '上次提交结果未确认' + (submission.error ? '：' + submission.error : '。') + '请先在希音后台核对，再决定是否重新提交。' }));
  }
}

function renderSource(form) {
  $('source-title').textContent = form.source?.title || '未识别标题';
  const rows = [
    ['1688 单价', form.source?.price ? '¥' + Number(form.source.price).toFixed(2) : '未识别'],
    ['起批量', form.source?.moq ? `${form.source.moq}${form.source.unit || ''}` : '未识别'],
    ['来源类目', (form.source?.breadcrumb ?? []).join(' / ') || '未识别'],
    ['SKU', String((form.product?.skus ?? []).length)],
    ['采集时间', formatTime(form.source?.capturedAt)]
  ];
  $('source-facts').replaceChildren(...rows.map(([term, value]) => el('div', { class: 'fact' }, el('dt', { text: term }), el('dd', { text: value }))));

  const attributes = form.source?.attributes ?? [];
  $('source-attributes').replaceChildren(...(attributes.length
    ? attributes.map(item => el('div', { class: 'fact' }, el('dt', { text: item.name }), el('dd', { text: item.value })))
    : [el('div', { class: 'fact' }, el('dt', { text: '属性' }), el('dd', { text: '未识别' }))]));
  $('source-attributes-wrap').open = attributes.length > 0;

  const grid = $('source-images');
  grid.replaceChildren();
  const images = form.product?.images ?? [];
  if (!images.length) {
    grid.append(el('p', { class: 'hint', text: '图片转存后会显示在这里，和终稿对照。' }));
    return;
  }
  images.forEach((image, index) => {
    // 原貌页只看 1688 原图；译文在查看器里切换对比。
    const url = state.imageUrls.get(image.token) || '';
    const cell = el('button', {
      type: 'button',
      class: 'source-thumb',
      title: '查看大图：' + (image.name || '图片 ' + (index + 1)),
      onclick: () => openViewer('original', images, index)
    });
    if (url) cell.append(el('img', { src: url, alt: image.name || '原图', loading: 'lazy' }));
    else cell.append(el('div', { class: 'thumb-empty', text: '无预览' }));
    cell.append(el('span', {
      class: 'source-caption',
      text: (image.excluded ? '已排除 · ' : '') + (ROLE_LABEL[image.role] ?? image.role)
    }));
    if (translatedVersion(image)) cell.append(el('span', { class: 'source-flag', text: '译' }));
    grid.append(cell);
  });
}

function renderForm(form) {
  $('title-en').value = form.product?.title?.en ?? '';
  $('title-zh').textContent = form.product?.title?.zh ? '1688 原文：' + form.product.title.zh : '';
  $('bullets').value = (form.product?.bullets ?? []).map(item => item.en).filter(Boolean).join('\n');
  $('description').value = form.product?.description?.en ?? '';
  $('category-confirmed').checked = Boolean(form.product?.category?.confirmed);
  renderCategoryPicker(form);
  $('coefficient').value = form.product?.coefficient ?? 1.35;
  $('coefficient-hint').textContent = form.source?.price ? '1688 ¥' + Number(form.source.price).toFixed(2) + ' 起算' : '';
  renderAttributes(form);
  renderSkus(form);
  renderSuggestions();
}

const CATEGORY_LEVEL_LABEL = ['一级类目', '二级类目', '三级类目', '四级类目', '五级类目'];

function syncCategoryPath(form) {
  const draftId = form?.id ?? null;
  const switched = state.categoryDraftId !== draftId;
  if (switched) {
    state.categoryDraftId = draftId;
    state.categoryPath = [];
  }
  const categoryId = String(form?.product?.category?.sheinCategoryId ?? '').trim();
  if (!state.categories || !categoryId) return;
  const path = findCategoryPath(state.categories, categoryId).map(node => node.categoryId);
  if (path.length) state.categoryPath = path;
}

function categoryLevelNodes(depth) {
  let nodes = state.categories ?? [];
  for (let index = 0; index < depth; index += 1) {
    const node = nodes.find(item => item.categoryId === state.categoryPath[index]);
    if (!node?.children?.length) return [];
    nodes = node.children;
  }
  return nodes;
}

function renderCategoryHint(form) {
  const category = form?.product?.category ?? {};
  const categoryId = String(category.sheinCategoryId ?? '').trim();
  if (!categoryId) {
    $('category-hint').textContent = '';
    return;
  }
  const path = findCategoryPath(state.categories ?? [], categoryId);
  if (!path.length) {
    $('category-hint').textContent = state.categories
      ? '当前类目不在店铺可用类目中，请重新选择。'
      : '';
    return;
  }
  const leaf = path[path.length - 1];
  $('category-hint').textContent = '已选：' + path.map(node => node.name).join(' / ') +
    `（${leaf.categoryId} / ${leaf.productTypeId || '无 product_type_id'}）`;
}

function renderCategoryPicker(form) {
  const host = $('category-picker');
  if (!host) return;
  syncCategoryPath(form);
  host.replaceChildren();
  if (!form) {
    $('category-hint').textContent = '';
    return;
  }
  if (!state.credentials?.openKeyId || !state.credentials?.sheinSecret) {
    host.append(el('p', { class: 'hint', text: '连接希音后会自动读取店铺类目。' }));
    renderCategoryHint(form);
    return;
  }
  if (state.categoriesLoading) {
    host.append(el('p', { class: 'hint', text: '正在读取店铺类目…' }));
    return;
  }
  if (state.categoriesError) {
    host.append(el('p', { class: 'hint error', text: state.categoriesError }));
    renderCategoryHint(form);
    return;
  }
  if (!state.categories) {
    host.append(el('p', { class: 'hint', text: '正在读取店铺类目…' }));
    return;
  }
  if (!state.categories.length) {
    host.append(el('p', { class: 'hint', text: '这家店铺没有可用类目，请确认希音已开通商品发布权限。' }));
    renderCategoryHint(form);
    return;
  }

  let depth = 0;
  let nodes = state.categories;
  while (nodes.length) {
    const select = el('select', { 'data-level': String(depth) });
    select.append(el('option', { value: '', text: CATEGORY_LEVEL_LABEL[depth] ?? `第 ${depth + 1} 级类目` }));
    for (const node of nodes) select.append(el('option', { value: node.categoryId, text: node.name }));
    select.value = state.categoryPath[depth] ?? '';
    select.disabled = state.busy;
    select.addEventListener('change', () => chooseCategory(depth, select.value));
    host.append(select);
    const selected = nodes.find(node => node.categoryId === state.categoryPath[depth]);
    if (!selected?.children.length) break;
    nodes = selected.children;
    depth += 1;
  }
  renderCategoryHint(form);
}

function chooseCategory(depth, categoryId) {
  const form = state.form;
  if (!form) return;
  const node = categoryLevelNodes(depth).find(item => item.categoryId === categoryId) ?? null;
  state.categoryPath = categoryId
    ? state.categoryPath.slice(0, depth).concat(categoryId)
    : state.categoryPath.slice(0, depth);
  const leaf = node?.leaf ? node : null;
  form.product.category.sheinCategoryId = leaf ? leaf.categoryId : '';
  form.product.category.sheinProductTypeId = leaf ? leaf.productTypeId : '';
  form.product.category.sheinCategoryName = leaf ? leaf.name : '';
  form.product.category.confirmed = false;
  $('category-confirmed').checked = false;
  markDirty();
  renderCategoryPicker(form);
  const next = $('category-picker').querySelector(`select[data-level="${depth + 1}"]`);
  if (next) next.focus();
}

function renderAttributes(form) {
  const host = $('attributes');
  const attributes = form.product?.attributes ?? [];
  host.replaceChildren();
  if (!attributes.length) {
    host.append(el('p', { class: 'hint', text: '选择希音类目并读取属性模板后，这里会列出必填属性。' }));
    return;
  }
  attributes.forEach((attribute, index) => {
    const label = attribute.name?.en || attribute.name?.zh || '未命名属性';
    const row = el('div', { class: 'attribute-row' },
      el('span', { class: 'attribute-name' + (attribute.required ? ' required' : ''), text: label })
    );
    if (Array.isArray(attribute.values) && attribute.values.length) {
      const select = el('select', {});
      select.append(el('option', { value: '', text: '请选择' }));
      for (const value of attribute.values) select.append(el('option', { value: value.id, text: value.label || value.id }));
      select.value = attribute.valueId ?? '';
      select.addEventListener('change', () => {
        const item = state.form.product.attributes[index];
        item.valueId = select.value;
        const chosen = (item.values ?? []).find(value => value.id === select.value);
        if (chosen) item.value.en = chosen.label;
        markDirty();
      });
      row.append(select);
    } else {
      const input = el('input', { type: 'text', value: attribute.value?.en ?? '', placeholder: '填写或翻译英文值' });
      input.addEventListener('input', () => {
        state.form.product.attributes[index].value.en = input.value;
        markDirty();
      });
      row.append(input);
    }
    host.append(row);
  });
}

function renderSkus(form) {
  const body = $('sku-body');
  body.replaceChildren();
  const colorId = String(form.product?.category?.colorAttributeId ?? '');
  const colorAttribute = (form.product?.attributes ?? []).find(attribute => String(attribute.attributeId) === colorId) ?? null;
  const values = colorAttribute?.values ?? [];
  const skus = form.product?.skus ?? [];
  skus.forEach((sku, index) => {
    const colorEn = el('input', { type: 'text', value: sku.colorEn ?? '', placeholder: '英文颜色' });
    colorEn.addEventListener('input', () => {
      state.form.product.skus[index].colorEn = colorEn.value;
      markDirty();
    });

    let colorValueNode;
    if (values.length) {
      const select = el('select', {});
      select.append(el('option', { value: '', text: '选择颜色值' }));
      for (const value of values) select.append(el('option', { value: value.id, text: value.label || value.id }));
      select.value = sku.colorAttributeValueId ?? '';
      select.addEventListener('change', () => {
        state.form.product.skus[index].colorAttributeValueId = select.value;
        markDirty();
      });
      colorValueNode = select;
    } else {
      colorValueNode = el('span', { class: 'hint', text: '读取模板后可选' });
    }

    const supplyCell = el('td', { class: 'supply', text: money(safeSupply(sku, form), form.product?.currency), 'data-index': String(index) });
    const skuInput = el('input', { type: 'text', value: sku.supplierSku ?? '' });
    skuInput.addEventListener('input', () => {
      state.form.product.skus[index].supplierSku = skuInput.value;
      markDirty();
    });
    const stock = sku.stock === null || sku.stock === undefined ? '—' : String(sku.stock);

    body.append(el('tr', {},
      el('td', { class: 'muted', text: sku.color || '默认' }),
      el('td', {}, colorEn),
      el('td', {}, colorValueNode),
      el('td', { class: 'muted', text: '¥' + (Number(sku.price) || 0).toFixed(2) }),
      supplyCell,
      el('td', {}, skuInput),
      el('td', { class: 'muted', text: stock })
    ));
  });
  if (!skus.length) body.append(el('tr', {}, el('td', { colspan: '7', class: 'hint', text: '没有识别到 SKU。' })));
}

function imageUrlOf(image) {
  if (!image) return '';
  const version = usesTranslation(image) ? translatedVersion(image) : null;
  return state.imageUrls.get(version ? version.token : image.token) || '';
}

function currentImages() {
  return state.form?.product?.images ?? [];
}

function currentImage() {
  const images = currentImages();
  return images.find(image => image.id === state.imageId) ?? images[0] ?? null;
}

// 只有存在译文时才允许切到译文或对比，否则按钮会把用户带到空白区。
function imageViewOf(image) {
  if (!translatedVersion(image)) return 'original';
  return ['original', 'translated', 'compare'].includes(state.imageView) ? state.imageView : 'original';
}

function imageTokensOf(image) {
  const tokens = [];
  if (image?.token) tokens.push(image.token);
  const translated = translatedVersion(image);
  if (translated?.token) tokens.push(translated.token);
  return tokens;
}

function selectImage(imageId) {
  state.imageId = imageId;
  state.viewer.zoom = 1;
  renderImages(state.form);
}

function renderImages(form) {
  renderStage(form);
  renderFilmstrip(form);
  renderImageControls(form);
}

function renderStage(form) {
  const host = $('image-stage');
  host.replaceChildren();
  const image = form ? currentImage() : null;
  state.imageId = image?.id ?? null;
  if (!image) {
    host.classList.remove('is-excluded');
    host.append(el('p', { class: 'stage-empty', text: '还没有转存图片。先在「1688 原貌」里对照商品，再点「从 1688 转存图片」。' }));
    return;
  }
  host.classList.toggle('is-excluded', Boolean(image.excluded));
  const originalUrl = state.imageUrls.get(image.token) || '';
  const translated = translatedVersion(image);
  const translatedUrl = translated ? state.imageUrls.get(translated.token) || '' : '';
  if (!originalUrl) {
    host.append(el('p', { class: 'stage-empty', text: '正在加载预览…' }));
    return;
  }
  const view = imageViewOf(image);
  if (view === 'compare' && translatedUrl) {
    const overlay = el('img', { src: translatedUrl, alt: '译文' });
    overlay.style.clipPath = 'inset(0 0 0 ' + state.compare + '%)';
    const compare = el('div', { class: 'stage-compare' },
      el('img', { src: originalUrl, alt: '原图' }),
      overlay,
      el('span', { class: 'stage-chip left', text: '原图' }),
      el('span', { class: 'stage-chip right', text: '译文' })
    );
    compare.addEventListener('click', () => openViewer('compare'));
    host.append(compare);
    return;
  }
  const useTranslated = view === 'translated' && translatedUrl;
  const node = el('img', { class: 'stage-image', src: useTranslated ? translatedUrl : originalUrl, alt: image.name || '商品图片' });
  node.addEventListener('click', () => openViewer(useTranslated ? 'translated' : 'original'));
  host.append(node);
}

function renderFilmstrip(form) {
  const list = $('image-list');
  list.replaceChildren();
  const images = currentImages();
  const active = currentImage();
  images.forEach((image, index) => {
    const url = imageUrlOf(image);
    const button = el('button', {
      type: 'button',
      class: 'film' + (image.id === active?.id ? ' is-active' : '') + (image.excluded ? ' is-excluded' : ''),
      title: image.name || '图片 ' + (index + 1)
    });
    if (url) button.append(el('img', { src: url, alt: '', loading: 'lazy' }));
    else button.append(el('span', { class: 'film-empty', text: '无预览' }));
    button.append(el('span', { class: 'film-index', text: String(index + 1) }));
    if (translatedVersion(image) && usesTranslation(image)) button.append(el('span', { class: 'film-flag', text: '译' }));
    button.addEventListener('click', () => selectImage(image.id));
    list.append(el('li', {}, button));
  });
}

function renderImageControls(form) {
  const images = currentImages();
  const image = currentImage();
  const enabled = Boolean(image);
  const translated = enabled ? translatedVersion(image) : null;
  for (const [id, name] of [['view-original', 'original'], ['view-translated', 'translated'], ['view-compare', 'compare']]) {
    const node = $(id);
    const active = enabled && imageViewOf(image) === name;
    node.classList.toggle('is-active', active);
    node.setAttribute('aria-pressed', active ? 'true' : 'false');
    node.disabled = Boolean(state.busy) || !enabled || (name !== 'original' && !translated);
  }
  $('compare-control').hidden = !(enabled && imageViewOf(image) === 'compare');
  $('compare-range').value = String(state.compare);

  const role = $('image-role');
  role.value = image?.role === 'main' ? 'main' : 'detail';
  role.disabled = Boolean(state.busy) || !enabled;
  const excluded = $('image-excluded');
  excluded.checked = Boolean(image?.excluded);
  excluded.disabled = Boolean(state.busy) || !enabled;

  $('image-counter').textContent = enabled ? `${images.indexOf(image) + 1} / ${images.length}` : '';
  $('image-version-note').textContent = translated ? (usesTranslation(image) ? '提交时用译文' : '提交时用原图') : '';
  $('image-revert').hidden = !(translated && usesTranslation(image));
  $('image-revert').disabled = Boolean(state.busy);
  $('image-zoom').disabled = Boolean(state.busy) || !originalAvailable(image);

  const submittable = images.filter(item => !item.excluded && submitImage(item).token).length;
  const translatedCount = images.filter(item => !item.excluded && translatedVersion(item)).length;
  $('image-hint').textContent = form && images.length
    ? `${submittable} 张可提交` + (translatedCount ? ` · ${translatedCount} 张已有译文` : '')
    : '';
}

function originalAvailable(image) {
  return Boolean(image?.token && state.imageUrls.get(image.token));
}

function openViewer(version = 'original', images = null, startIndex = null) {
  const list = images ?? currentImages();
  const image = startIndex === null ? currentImage() : list[startIndex];
  if (!image) return;
  if (!originalAvailable(image)) {
    setStatus('action-status', '图片还在加载，稍后再查看大图。');
    return;
  }
  const translated = translatedVersion(image);
  state.viewer = {
    open: true,
    images: list,
    index: Math.max(0, list.indexOf(image)),
    version: version === 'translated' && translated ? 'translated' : 'original',
    zoom: 1
  };
  $('viewer').hidden = false;
  renderViewer();
  $('viewer-close').focus();
}

function closeViewer() {
  state.viewer.open = false;
  $('viewer').hidden = true;
}

function renderViewer() {
  if (!state.viewer.open) return;
  const images = state.viewer.images;
  const image = images[state.viewer.index] ?? null;
  if (!image) {
    closeViewer();
    return;
  }
  const translated = translatedVersion(image);
  const version = state.viewer.version === 'translated' && translated ? 'translated' : 'original';
  const source = version === 'translated' ? translated : image;
  const url = state.imageUrls.get(source.token) || '';
  $('viewer-title').textContent = image.name || '图片 ' + (state.viewer.index + 1);
  $('viewer-meta').textContent = `${source.width || '?'}×${source.height || '?'} · ${formatSize(source.size)} · ${ROLE_LABEL[image.role] ?? image.role}` + (image.excluded ? ' · 已排除' : '');
  const node = $('viewer-image');
  node.src = url;
  node.alt = image.name || '商品图片';
  const zoomed = state.viewer.zoom > 1;
  node.classList.toggle('is-zoomed', zoomed);
  // 适应视图交给样式表（绝对定位 + object-fit: contain），放大时才写行内尺寸。
  node.style.width = zoomed ? Math.round(state.viewer.zoom * 100) + '%' : '';
  node.style.height = zoomed ? 'auto' : '';
  for (const [id, name] of [['viewer-original', 'original'], ['viewer-translated', 'translated']]) {
    const button = $(id);
    const active = version === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.disabled = name === 'translated' && !translated;
  }
  $('viewer-counter').textContent = `${state.viewer.index + 1} / ${images.length}`;
  $('viewer-prev').disabled = images.length < 2;
  $('viewer-next').disabled = images.length < 2;
}

function stepViewer(delta) {
  const images = state.viewer.images;
  if (!images.length) return;
  state.viewer.index = (state.viewer.index + delta + images.length) % images.length;
  state.viewer.zoom = 1;
  state.viewer.version = 'original';
  renderViewer();
}

function zoomViewer(factor) {
  state.viewer.zoom = Math.min(6, Math.max(1, Math.round(state.viewer.zoom * factor * 10) / 10));
  renderViewer();
}

function renderIssues(form) {
  const host = $('issues');
  const issues = form ? validateDraft(form) : [];
  host.replaceChildren();
  host.hidden = !issues.length;
  if (!issues.length) return;
  const list = el('ul', { class: 'issue-list' });
  for (const issue of issues) {
    list.append(el('li', { class: 'issue ' + (issue.level === 'warning' ? 'warning' : 'error') },
      el('span', { class: 'issue-badge', text: issue.level === 'warning' ? '提示' : '必填' }),
      el('span', { text: issue.message })
    ));
  }
  host.append(el('h3', { text: '检查结果' }), list);
}

function renderSuggestions() {
  const host = $('category-suggestions');
  host.replaceChildren();
  state.suggestions.forEach((item, index) => {
    host.append(el('button', { type: 'button', class: 'suggestion', onclick: () => applySuggestion(index) },
      el('strong', { text: item.name || item.categoryId }),
      el('span', { text: `${item.categoryId} / ${item.productTypeId || '—'}` })
    ));
  });
}

function applySuggestion(index) {
  const item = state.suggestions[index];
  const form = state.form;
  if (!item || !form) return;
  form.product.category.sheinCategoryId = item.categoryId;
  form.product.category.sheinProductTypeId = item.productTypeId || '';
  form.product.category.sheinCategoryName = item.name || '';
  form.product.category.confirmed = false;
  $('category-confirmed').checked = false;
  state.categoryPath = findCategoryPath(state.categories ?? [], item.categoryId).map(node => node.categoryId);
  markDirty();
  renderCategoryPicker(form);
}

function updateSupplyPrices(form) {
  for (const cell of $('sku-body').querySelectorAll('td.supply')) {
    const sku = form.product.skus[Number(cell.dataset.index)];
    cell.textContent = money(safeSupply(sku, form), form.product?.currency);
  }
  $('coefficient-hint').textContent = form.source?.price ? '1688 ¥' + Number(form.source.price).toFixed(2) + ' 起算' : '';
}

function submitReason(draft, errors) {
  if (!draft) return '先选择一条草稿';
  if (draft.status !== 'review') return '完成翻译、配图和类目后，保存进入待审核才可提交';
  if (state.dirty) return '还有未保存的修改';
  if (errors.length) return errors[0].message;
  if (state.busy) return '正在处理';
  return '打开确认摘要后提交';
}

function updateGate() {
  const draft = selectedDraft();
  const form = state.form;
  const busy = state.busy;
  $('collect').disabled = busy || !$('source-url').value.trim();
  for (const id of ['translate', 'save', 'prepare-images', 'load-template', 'refresh-categories', 'suggest-category', 'delete-draft', 'translate-images']) {
    const node = $(id);
    if (node) node.disabled = busy || !draft;
  }
  if (form) renderImageControls(form);
  $('open-source').disabled = busy || !draft?.source?.url;
  $('category-confirmed').disabled = busy || !draft;
  for (const select of $('category-picker').querySelectorAll('select')) select.disabled = busy || !draft;

  const issues = form ? validateDraft(form) : [];
  const errors = issues.filter(issue => issue.level !== 'warning');
  const submittable = Boolean(draft && form && draft.status === 'review' && !state.dirty && !errors.length && !busy);
  const button = $('submit');
  button.disabled = !submittable;
  button.title = submittable ? '打开确认摘要' : submitReason(draft, errors);

  $('poll').hidden = !(draft && (draft.status === 'submitted' || draft.submission?.spuName));
  $('poll').disabled = busy;
  $('resume').hidden = !(draft && draft.status === 'rejected');
  $('resume').disabled = busy;
}

async function loadImageUrls() {
  const form = state.form;
  if (!form) return;
  // 原图与译文的文件令牌都要拿到预览地址，对比和切换版本才不会空白。
  const tokens = [...new Set((form.product?.images ?? []).flatMap(imageTokensOf))];
  const missing = tokens.filter(token => !state.imageUrls.has(token));
  if (!missing.length) return;
  for (const token of missing) state.imageUrls.set(token, '');
  let changed = false;
  for (const token of missing) {
    try {
      state.imageUrls.set(token, await client.files.url(token));
      changed = true;
    } catch {
      state.imageUrls.delete(token);
    }
  }
  if (changed && state.form) {
    renderImages(state.form);
    renderSource(state.form);
    if (state.viewer.open) renderViewer();
  }
}

function markDirty() {
  state.dirty = true;
  renderIssues(state.form);
  updateGate();
}

async function run(label, task, statusId = 'action-status') {
  if (state.busy) return false;
  state.busy = true;
  setStatus(statusId, label);
  updateGate();
  try {
    await task();
    return true;
  } catch (error) {
    setStatus(statusId, errorText(error), true);
    return false;
  } finally {
    state.busy = false;
    updateGate();
  }
}

function formPatch() {
  const product = state.form.product;
  return {
    product: clone({
      title: product.title,
      bullets: product.bullets,
      description: product.description,
      attributes: product.attributes,
      category: product.category,
      images: product.images,
      skus: product.skus,
      coefficient: product.coefficient
    })
  };
}

async function saveForm() {
  const draft = selectedDraft();
  if (!draft) return null;
  const saved = await controller.saveDraft(draft.id, formPatch());
  state.form = clone(saved);
  state.dirty = false;
  return saved;
}

async function refreshStatus(draftId) {
  const draft = controller.find(draftId);
  if (!draft || draft.status === 'submitted' || draft.status === 'approved') return draft;
  const saved = await controller.saveDraft(draftId);
  state.form = clone(saved);
  state.dirty = false;
  return saved;
}

function selectDraft(draftId) {
  state.selectedId = draftId;
  state.form = null;
  state.dirty = false;
  state.suggestions = [];
  state.imageId = null;
  state.imageView = 'original';
  if (state.viewer.open) closeViewer();
  render();
  void ensureCategories();
}

async function doCollect() {
  const url = $('source-url').value.trim();
  if (!url) return;
  await run('正在打开页面并采集…', async () => {
    const draft = await controller.collect(url);
    selectDraft(draft.id);
    $('source-url').value = '';
    setStatus('collect-status', '已采集。右侧浏览器保留原页，方便逐项对照。');
    updateGate();
  }, 'collect-status');
}

async function doSave() {
  await run('正在保存草稿…', async () => {
    await saveForm();
    render();
    setStatus('action-status', '草稿已保存。');
  });
}

async function doTranslate() {
  await run('正在翻译标题和属性…', async () => {
    const draft = selectedDraft();
    if (!draft) throw new Error('先选择草稿。');
    await saveForm();
    await controller.translate(draft.id);
    await refreshStatus(draft.id);
    render();
    setStatus('action-status', '已生成英文文案，请逐项校对。');
  });
}

async function doPrepareImages() {
  await run('正在从 1688 转存图片…', async () => {
    const draft = selectedDraft();
    if (!draft) throw new Error('先选择草稿。');
    await saveForm();
    const prepared = await controller.prepareImages(draft.id);
    await refreshStatus(draft.id);
    render();
    const count = (prepared.product?.images ?? []).filter(image => image.token).length;
    setStatus('action-status', count ? `已转存 ${count} 张图片，请确认主图和排除项。` : '没有转存到图片，请确认页面已加载完成。', !count);
  });
}

function setImageView(view) {
  state.imageView = view;
  renderImages(state.form);
}

function setImageRole(role) {
  const image = currentImage();
  if (!image || !state.form) return;
  const index = state.form.product.images.findIndex(item => item.id === image.id);
  if (index < 0) return;
  state.form.product.images[index].role = role === 'main' ? 'main' : 'detail';
  markDirty();
  renderImages(state.form);
  renderSource(state.form);
}

function setImageExcluded(excluded) {
  const image = currentImage();
  if (!image || !state.form) return;
  const index = state.form.product.images.findIndex(item => item.id === image.id);
  if (index < 0) return;
  state.form.product.images[index].excluded = Boolean(excluded);
  markDirty();
  renderImages(state.form);
  renderSource(state.form);
}

// 切回原图只是换提交版本，译文文件仍然保留，随时可以再切回来。
function revertToOriginal() {
  const image = currentImage();
  if (!image || !state.form) return;
  const index = state.form.product.images.findIndex(item => item.id === image.id);
  if (index < 0) return;
  state.form.product.images[index] = withSourceVersion(state.form.product.images[index], false);
  markDirty();
  state.imageView = 'original';
  renderImages(state.form);
}

function fillImageModelSelect(select, models, current = '') {
  const previous = select.value || current || '';
  select.replaceChildren();
  if (!models.length) {
    select.append(new Option('没有可用图片模型', ''));
    select.value = '';
    return;
  }
  for (const model of models) {
    const label = model.title && model.title !== model.id ? model.title + '（' + model.id + '）' : model.id;
    select.append(new Option(label, model.id));
  }
  select.value = models.some(model => model.id === previous) ? previous : models[0].id;
}

function syncImageModelSelects() {
  const current = controller.getState().settings.imageModel || '';
  fillImageModelSelect($('image-model'), state.imageModels, current);
  fillImageModelSelect($('translate-model'), state.imageModels, current);
}

async function loadImageModels() {
  if (state.imageModelsPromise) return state.imageModelsPromise;
  state.imageModelsLoading = true;
  setStatus('image-model-status', '正在读取图片模型…');
  const task = (async () => {
    try {
      state.imageModels = await controller.imageCatalog();
      state.imageModelsError = '';
      setStatus('image-model-status', state.imageModels.length
        ? `可用 ${state.imageModels.length} 个图片模型`
        : '没有可用图片模型，请先在轻作 AI 设置里配置。', !state.imageModels.length);
    } catch (error) {
      state.imageModels = [];
      state.imageModelsError = errorText(error);
      setStatus('image-model-status', state.imageModelsError, true);
    } finally {
      state.imageModelsLoading = false;
      state.imageModelsPromise = null;
      syncImageModelSelects();
    }
    return state.imageModels;
  })();
  state.imageModelsPromise = task;
  return task;
}

function openTranslateDialog() {
  if (!state.form) return;
  syncImageModelSelects();
  if (!state.imageModels.length) void loadImageModels();
  const image = currentImage();
  const translated = image ? translatedVersion(image) : null;
  const total = translationTargets(state.form.product?.images ?? [], { scope: 'all' }).length;
  setStatus('translate-status', translated ? '这张图已有译文，重新生成会覆盖当前译文。' : '');
  const progress = $('translate-progress');
  progress.hidden = true;
  progress.max = 1;
  progress.value = 0;
  $('translate-scope-current').checked = true;
  $('translate-scope-current').disabled = !image;
  $('translate-scope-all').disabled = total === 0;
  $('translate-run').disabled = false;
  $('translate-cancel').textContent = '取消';
  $('translate-dialog').hidden = false;
  $('translate-run').focus();
}

function closeTranslateDialog() {
  if (state.translateRunning) {
    void cancelTranslateBatch();
    return;
  }
  $('translate-dialog').hidden = true;
}

async function cancelTranslateBatch() {
  const batch = state.translateBatch;
  setStatus('translate-status', '正在中止…');
  if (batch?.id) await client.ai.batch.cancel({ id: batch.id }).catch(() => {});
}

async function waitForBatch(id, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const batch = await client.ai.batch.get({ id });
    state.translateBatch = batch;
    const items = batch.items ?? [];
    const done = items.filter(item => !['pending', 'running'].includes(item.state)).length;
    state.translateDone = done;
    $('translate-progress').value = done;
    setStatus('translate-status', `正在生成译文 ${done}/${items.length || state.translateTotal}…`);
    if (['finished', 'canceled', 'interrupted'].includes(batch.state)) return batch;
    if (Date.now() > deadline) {
      await client.ai.batch.cancel({ id }).catch(() => {});
      throw new Error('等待译文超时，可以稍后重试。');
    }
    await new Promise(resolve => setTimeout(resolve, TRANSLATE_POLL_MS));
  }
}

function translationName(image) {
  const base = String(image?.name || image?.id || 'image').replace(/\.[^./]+$/, '');
  return base + '-en.jpg';
}

// 批量任务只把原图交给模型；结果先落成草稿里的持久令牌，再回填到草稿。
async function collectTranslations(batch, targets, modelId) {
  const results = [];
  const items = batch.items ?? [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const image = targets[index] ?? null;
    if (!image || item.state !== 'succeeded') continue;
    let preview = null;
    try {
      preview = await client.ai.batch.preview({ id: batch.id, itemId: item.id });
      const file = await client.files.read(preview.token);
      const fitted = await fitForShein(file.data, file.mime || item.outputMime || '');
      const dimensions = readImageSize(fitted.data) ?? { width: 0, height: 0 };
      const saved = await client.storage.saveFile({ data: fitted.data, filename: translationName(image), mime: fitted.mime });
      results.push({
        imageId: image.id,
        translated: translationRecord({
          token: saved.token,
          mime: fitted.mime,
          size: fitted.size,
          width: fitted.width || dimensions.width || image.width,
          height: fitted.height || dimensions.height || image.height,
          modelId,
          createdAt: Date.now()
        })
      });
    } catch {
      // 单张失败不影响其它图片，最后按成功数量提示。
    } finally {
      if (preview?.token) await client.files.release(preview.token).catch(() => {});
    }
  }
  return results;
}

async function applyTranslations(results) {
  if (!results.length || !state.form) return;
  const previous = state.form.product?.images ?? [];
  const replaced = new Map(results.map(item => [item.imageId, item.translated.token]));
  // 重新生成会换掉旧译文，旧文件不再被引用就直接释放，避免草稿越攒越大。
  const stale = previous
    .filter(image => image.translated?.token && replaced.has(image.id) && image.translated.token !== replaced.get(image.id))
    .map(image => image.translated.token);
  state.form.product.images = mergeTranslationResults(previous, results);
  state.imageId = results[0].imageId;
  state.imageView = 'translated';
  await saveForm();
  for (const token of stale) await client.storage.removeFile(token).catch(() => {});
  render();
}

async function runImageTranslation() {
  if (state.translateRunning || !state.form) return;
  const modelId = $('translate-model').value;
  if (!modelId) {
    setStatus('translate-status', '请先选择图片模型。', true);
    return;
  }
  const scope = $('translate-scope-all').checked ? 'all' : 'current';
  const targets = translationTargets(state.form.product?.images ?? [], { scope, imageId: currentImage()?.id ?? null });
  if (!targets.length) {
    setStatus('translate-status', '没有可翻译的图片，请先转存图片并取消排除。', true);
    return;
  }
  // 译文要写回草稿，先把表单里未保存的改动落到草稿上。
  try {
    await saveForm();
  } catch (error) {
    setStatus('translate-status', errorText(error), true);
    return;
  }
  const directory = await client.files.pickDirectory();
  if (!directory) {
    setStatus('translate-status', '已取消，未生成译文。');
    return;
  }
  state.translateRunning = true;
  state.translateTotal = targets.length;
  state.translateDone = 0;
  $('translate-run').disabled = true;
  $('translate-cancel').textContent = '中止';
  const progress = $('translate-progress');
  progress.hidden = false;
  progress.max = targets.length;
  progress.value = 0;
  setStatus('translate-status', `正在生成译文 0/${targets.length}…`);
  try {
    const batch = await client.ai.batch.create({
      source: 'proxy',
      modelId,
      prompt: IMAGE_TEXT_PROMPT,
      concurrency: Math.min(2, targets.length),
      items: targets.map(image => ({ token: image.token }))
    });
    state.translateBatch = { ...batch };
    await client.ai.batch.start({ id: batch.id, revision: batch.revision, directoryToken: directory.token });
    const finished = await waitForBatch(batch.id);
    const results = await collectTranslations(finished, targets, modelId);
    await applyTranslations(results);
    const failures = translationFailures(finished);
    if (results.length) {
      const note = failures.length ? `，${failures.length} 张没有完成：` + failures[0].message : '，请逐张对比确认。';
      setStatus('translate-status', `已生成 ${results.length} 张译文` + note, failures.length > 0);
    } else {
      setStatus('translate-status', failures.length ? '没有生成译文：' + failures[0].message : '模型没有返回结果，请重试。', true);
    }
  } catch (error) {
    setStatus('translate-status', errorText(error), true);
  } finally {
    state.translateRunning = false;
    state.translateBatch = null;
    $('translate-run').disabled = false;
    $('translate-cancel').textContent = '取消';
    $('translate-progress').hidden = true;
  }
}

async function doLoadTemplate() {
  await run('正在读取希音属性模板…', async () => {
    const draft = selectedDraft();
    if (!draft) throw new Error('先选择草稿。');
    await saveForm();
    await controller.loadTemplate(draft.id);
    await refreshStatus(draft.id);
    render();
    setStatus('action-status', '已加载必填属性，请补全英文值。');
  });
}

async function doSuggestCategory() {
  await run('正在获取类目建议…', async () => {
    const draft = selectedDraft();
    if (!draft) throw new Error('先选择草稿。');
    await saveForm();
    state.suggestions = await controller.suggestCategory(draft.id);
    renderSuggestions();
    setStatus('action-status', state.suggestions.length ? '选择一个建议类目，再读取属性模板。' : '没有返回类目建议，请从店铺类目中选择。');
  });
}

async function ensureCategories({ force = false } = {}) {
  if (state.categoriesPromise) {
    if (!force) return state.categoriesPromise;
    await state.categoriesPromise;
    if (state.categoriesPromise) return state.categoriesPromise;
  }
  const credentials = state.credentials ?? await controller.credentialStatus().catch(() => null);
  if (!credentials?.openKeyId || !credentials?.sheinSecret) {
    state.categories = null;
    state.categoriesError = '';
    renderCategoryPicker(state.form);
    return null;
  }
  state.categoriesLoading = true;
  state.categoriesError = '';
  renderCategoryPicker(state.form);
  const task = (async () => {
    try {
      state.categories = await controller.loadCategories({ force });
      return state.categories;
    } catch (error) {
      state.categories = null;
      state.categoriesError = errorText(error);
      return null;
    } finally {
      state.categoriesLoading = false;
      state.categoriesPromise = null;
      renderCategoryPicker(state.form);
    }
  })();
  state.categoriesPromise = task;
  return task;
}

async function doRefreshCategories() {
  await run('正在读取店铺类目…', async () => {
    const categories = await ensureCategories({ force: true });
    if (state.categoriesError) throw new Error(state.categoriesError);
    if (!categories) throw new Error('请先在设置中连接希音店铺。');
    setStatus('action-status', '店铺类目已更新。');
  });
}

async function doOpenSource() {
  const draft = selectedDraft();
  if (!draft?.source?.url) return;
  await run('正在打开 1688 原页…', async () => {
    await client.browser.open(draft.source.url);
    setStatus('action-status', '原页已在右侧浏览器打开。');
  });
}

async function doDelete() {
  const draft = selectedDraft();
  if (!draft) return;
  if (!globalThis.confirm('删除后不可恢复，确定删除这条草稿吗？')) return;
  await run('正在删除草稿…', async () => {
    await controller.remove(draft.id);
    state.selectedId = null;
    state.form = null;
    state.dirty = false;
    render();
    setStatus('action-status', '草稿已删除。');
  });
}

async function doPoll() {
  const draft = selectedDraft();
  if (!draft) return;
  await run('正在查询希音审核状态…', async () => {
    const saved = await controller.poll(draft.id);
    state.form = clone(saved);
    render();
    const status = saved.submission?.documentState;
    setStatus('action-status', '审核状态：' + (AUDIT_LABEL[status] ?? status ?? '未知'));
  });
}

async function doResume() {
  const draft = selectedDraft();
  if (!draft) return;
  await run('正在恢复编辑…', async () => {
    const saved = await controller.resume(draft.id);
    state.form = clone(saved);
    render();
    setStatus('action-status', '已回到待审核，按驳回原因修改后重新提交。');
  });
}

function openSubmit() {
  const draft = selectedDraft();
  const form = state.form;
  if (!draft || !form) return;
  if (state.dirty) {
    setStatus('action-status', '请先保存草稿再提交。', true);
    return;
  }
  const errors = blockingIssues(form);
  if (errors.length) {
    setStatus('action-status', errors[0].message, true);
    return;
  }
  const skus = form.product.skus ?? [];
  const prices = skus.map(sku => safeSupply(sku, form)).filter(value => value > 0);
  const rows = [
    ['英文标题', form.product.title.en],
    ['希音类目', `${form.product.category.sheinCategoryId || '—'} / ${form.product.category.sheinProductTypeId || '—'}`],
    ['图片', (() => {
      const images = (form.product.images ?? []).filter(image => !image.excluded && submitImage(image).token);
      const translated = images.filter(image => usesTranslation(image)).length;
      return `${images.length} 张` + (translated ? `（其中 ${translated} 张用译文）` : '');
    })()],
    ['SKU', `${skus.length} 个`],
    ['供货价', prices.length ? `${money(Math.min(...prices), form.product.currency)} - ${money(Math.max(...prices), form.product.currency)}` : '—'],
    ['幂等键', skus[0]?.supplierSku || '—']
  ];
  $('submit-summary').replaceChildren(...rows.map(([term, value]) => el('div', {}, el('dt', { text: term }), el('dd', { text: String(value ?? '') }))));
  const pending = Boolean(form.submission?.pending && !form.submission?.spuName);
  $('retry-wrap').hidden = !pending;
  $('retry-check').checked = false;
  $('submit-confirm').disabled = pending;
  $('retry-check').onchange = () => { $('submit-confirm').disabled = !$('retry-check').checked; };
  $('submit-dialog').hidden = false;
  $('submit-cancel').focus();
}

function closeSubmit() {
  $('submit-dialog').hidden = true;
}

async function confirmSubmit() {
  const draft = selectedDraft();
  if (!draft) return;
  const pending = Boolean(state.form?.submission?.pending && !state.form?.submission?.spuName);
  if (pending && !$('retry-check').checked) return;
  closeSubmit();
  await run('正在提交到希音…', async () => {
    const saved = await controller.submit(draft.id, { confirm: true, retryUnverified: pending });
    state.form = clone(saved);
    render();
    setStatus('action-status', '已提交。希音审核结果会显示在草稿顶部。');
  });
}

function fillSettings() {
  const settings = controller.getState().settings;
  $('model').value = settings.model || '';
  if (state.imageModels.length) fillImageModelSelect($('image-model'), state.imageModels, settings.imageModel);
  else $('image-model').value = settings.imageModel || '';
  $('default-coefficient').value = String(settings.coefficient ?? 1.35);
  $('site').value = settings.site || 'shein';
  $('base-url').value = settings.baseUrl || 'https://openapi.sheincorp.cn';
  $('app-id').value = settings.appId || '';
  $('open-key').value = settings.openKeyId || '';
  $('callback-url').value = callbackUrlOf($('base-url').value);
}

async function doSaveSettings() {
  await run('正在保存设置…', async () => {
    state.credentialRevision += 1;
    await controller.saveSettings({
      model: $('model').value.trim(),
      imageModel: $('image-model').value,
      coefficient: $('default-coefficient').value,
      site: $('site').value.trim() || 'shein',
      baseUrl: $('base-url').value,
      appId: $('app-id').value.trim(),
      openKeyId: $('open-key').value.trim()
    });
    fillSettings();
    setStatus('settings-status', '设置已保存。');
  }, 'settings-status');
  // 凭据状态刷新属于后台补充信息，放在忙碌窗口之外，避免它把紧随其后的
  // 保存密钥点击吞掉。
  await renderCredentialStatus();
  void ensureCategories();
}

async function doAuthorize() {
  const appId = $('app-id').value.trim();
  const appSecretKey = $('app-secret').value.trim() || appSecretValue;
  if (!appId) {
    setStatus('shein-status', '请先填写希音 APP_ID。', true);
    return;
  }
  if (!appSecretKey) {
    setStatus('shein-status', '请先填写希音 APP_SecretKey。', true);
    return;
  }
  const baseUrl = $('base-url').value;
  state.authCancelled = false;
  const connected = await run('正在打开希音授权页…', async () => {
    state.credentialRevision += 1;
    const started = await controller.startAuthorization({ appId, appSecretKey, baseUrl });
    appSecretValue = appSecretKey;
    $('app-secret').value = '';
    $('cancel-authorize').hidden = false;
    setStatus('shein-status', '请在希音授权页点击确认授权，完成后会自动连接。');
    const { tempToken } = await controller.awaitAuthorization({
      tabId: started.tabId,
      state: started.state,
      isCancelled: () => state.authCancelled
    });
    await controller.authorize({
      appId,
      appSecretKey,
      tempToken,
      baseUrl
    });
    await controller.resetAuthorizationTab();
    fillSettings();
    setStatus('shein-status', '已连接希音，可以提交发品。');
  }, 'shein-status');
  $('cancel-authorize').hidden = true;
  if (!connected) return;
  await renderCredentialStatus();
  await ensureCategories();
}

async function loadModels() {
  try {
    const { models, defaultModel } = await controller.aiCatalog();
    const select = $('model');
    const current = controller.getState().settings.model || '';
    while (select.options.length) select.remove(0);
    select.append(new Option(defaultModel ? '默认模型（' + defaultModel + '）' : '默认模型', ''));
    for (const model of models) select.append(new Option(model.title && model.title !== model.id ? model.title + '（' + model.id + '）' : model.id, model.id));
    select.value = models.some(item => item.id === current) ? current : '';
  } catch (reason) {
    setStatus('settings-status', reason instanceof Error ? reason.message : '模型列表暂时不可用。', true);
  }
}

async function doSaveSheinSecret() {
  const value = $('secret-key').value.trim();
  if (!value) {
    setStatus('secret-status', '请先填写希音 secretKey。', true);
    return;
  }
  await run('正在保存密钥…', async () => {
    state.credentialRevision += 1;
    await controller.setSecret(SECRET_CREDENTIAL, value);
    $('secret-key').value = '';
    setStatus('secret-status', '已保存。');
  }, 'secret-status');
  await renderCredentialStatus();
  void ensureCategories();
}

async function doClearSheinSecret() {
  await run('正在清除密钥…', async () => {
    state.credentialRevision += 1;
    await controller.clearSecret(SECRET_CREDENTIAL);
    setStatus('secret-status', '已清除。');
  }, 'secret-status');
  await renderCredentialStatus();
  void ensureCategories();
}

async function renderCredentialStatus() {
  const revision = state.credentialRevision;
  try {
    const status = await controller.credentialStatus();
    // 凭据状态与保存密钥是两条异步链路：保存设置期间发起的刷新可能晚于
    // 用户刚看到的保存结果返回，不能让它把新状态覆盖回旧值。
    if (revision !== state.credentialRevision) return;
    state.credentials = { openKeyId: status.openKeyId, sheinSecret: status.sheinSecret };
    if (status.openKeyId && status.sheinSecret) setStatus('shein-status', '已连接希音，可以提交发品。');
    else if (status.appSecret) setStatus('shein-status', 'APP_SecretKey 已保存，可以连接希音。');
    else setStatus('shein-status', '还没有连接希音。');
    setStatus('secret-status', status.sheinSecret ? 'secretKey 已保存。' : 'secretKey 未保存。');
  } catch {
    setStatus('shein-status', '凭据状态暂时不可用。', true);
  }
}

function bindEvents() {
  $('source-url').addEventListener('input', updateGate);
  $('source-url').addEventListener('keydown', event => { if (event.key === 'Enter') void doCollect(); });
  $('collect').addEventListener('click', () => void doCollect());
  $('toggle-settings').addEventListener('click', () => {
    state.settingsOpen = !state.settingsOpen;
    $('settings').hidden = !state.settingsOpen;
    $('toggle-settings').textContent = state.settingsOpen ? '收起设置' : '设置';
    if (state.settingsOpen) {
      fillSettings();
      void loadModels();
      void loadImageModels();
      void renderCredentialStatus();
    }
  });
  $('save-settings').addEventListener('click', () => void doSaveSettings());
  $('authorize').addEventListener('click', () => void doAuthorize());
  $('cancel-authorize').addEventListener('click', () => {
    state.authCancelled = true;
    setStatus('shein-status', '正在取消授权…');
  });
  $('base-url').addEventListener('change', () => { $('callback-url').value = callbackUrlOf($('base-url').value); });
  $('save-secret').addEventListener('click', () => void doSaveSheinSecret());
  $('clear-secret').addEventListener('click', () => void doClearSheinSecret());
  $('refresh-models').addEventListener('click', () => void loadModels());

  $('title-en').addEventListener('input', event => { state.form.product.title.en = event.target.value; markDirty(); });
  $('bullets').addEventListener('input', event => {
    state.form.product.bullets = event.target.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => ({ en: line }));
    markDirty();
  });
  $('description').addEventListener('input', event => { state.form.product.description.en = event.target.value; markDirty(); });
  $('category-confirmed').addEventListener('change', event => { state.form.product.category.confirmed = event.target.checked; markDirty(); });
  $('coefficient').addEventListener('input', event => {
    state.form.product.coefficient = Number(event.target.value);
    updateSupplyPrices(state.form);
    renderSkus(state.form);
    markDirty();
  });

  $('translate').addEventListener('click', () => void doTranslate());
  $('prepare-images').addEventListener('click', () => void doPrepareImages());
  $('translate-images').addEventListener('click', openTranslateDialog);
  $('translate-cancel').addEventListener('click', closeTranslateDialog);
  $('translate-run').addEventListener('click', () => void runImageTranslation());
  $('translate-dialog').addEventListener('click', event => { if (event.target === $('translate-dialog')) closeTranslateDialog(); });
  $('refresh-image-models').addEventListener('click', () => void loadImageModels());

  $('tab-content').addEventListener('click', () => selectTab('content'));
  $('tab-images').addEventListener('click', () => selectTab('images'));
  $('tab-source').addEventListener('click', () => selectTab('source'));

  $('view-original').addEventListener('click', () => setImageView('original'));
  $('view-translated').addEventListener('click', () => setImageView('translated'));
  $('view-compare').addEventListener('click', () => setImageView('compare'));
  $('compare-range').addEventListener('input', event => {
    state.compare = Number(event.target.value);
    renderStage(state.form);
  });
  $('image-role').addEventListener('change', event => setImageRole(event.target.value));
  $('image-excluded').addEventListener('change', event => setImageExcluded(event.target.checked));
  $('image-revert').addEventListener('click', revertToOriginal);
  $('image-zoom').addEventListener('click', () => openViewer(imageViewOf(currentImage()) === 'translated' ? 'translated' : 'original'));

  $('viewer-close').addEventListener('click', closeViewer);
  $('viewer').addEventListener('click', event => { if (event.target === $('viewer')) closeViewer(); });
  $('viewer-original').addEventListener('click', () => { state.viewer.version = 'original'; renderViewer(); });
  $('viewer-translated').addEventListener('click', () => { state.viewer.version = 'translated'; renderViewer(); });
  $('viewer-zoom-in').addEventListener('click', () => zoomViewer(1.25));
  $('viewer-zoom-out').addEventListener('click', () => zoomViewer(0.8));
  $('viewer-zoom-fit').addEventListener('click', () => { state.viewer.zoom = 1; renderViewer(); });
  $('viewer-prev').addEventListener('click', () => stepViewer(-1));
  $('viewer-next').addEventListener('click', () => stepViewer(1));
  document.addEventListener('keydown', event => {
    if (state.viewer.open) {
      if (event.key === 'Escape') { closeViewer(); return; }
      if (event.key === 'ArrowLeft') { stepViewer(-1); return; }
      if (event.key === 'ArrowRight') { stepViewer(1); return; }
      if (event.key === '+' || event.key === '=') { zoomViewer(1.25); return; }
      if (event.key === '-') { zoomViewer(0.8); return; }
    }
    if (event.key === 'Escape' && !$('translate-dialog').hidden) closeTranslateDialog();
  });
  $('load-template').addEventListener('click', () => void doLoadTemplate());
  $('refresh-categories').addEventListener('click', () => void doRefreshCategories());
  $('suggest-category').addEventListener('click', () => void doSuggestCategory());
  $('save').addEventListener('click', () => void doSave());
  $('open-source').addEventListener('click', () => void doOpenSource());
  $('delete-draft').addEventListener('click', () => void doDelete());
  $('poll').addEventListener('click', () => void doPoll());
  $('resume').addEventListener('click', () => void doResume());
  $('submit').addEventListener('click', openSubmit);
  $('submit-cancel').addEventListener('click', closeSubmit);
  $('submit-confirm').addEventListener('click', () => void confirmSubmit());
  $('submit-dialog').addEventListener('click', event => { if (event.target === $('submit-dialog')) closeSubmit(); });
}

controller.subscribe(() => render());
bindEvents();
render();

void (async () => {
  try {
    await controller.load();
    fillSettings();
    render();
    await renderCredentialStatus();
    if (state.form) void ensureCategories();
  } catch (error) {
    setStatus('action-status', errorText(error), true);
  }
})();

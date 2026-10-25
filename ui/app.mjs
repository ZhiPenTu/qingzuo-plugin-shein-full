import { createPluginClient } from './sdk.mjs';
import { createController } from './controller.mjs';
import { STATUS_LABEL, blockingIssues, validateDraft } from './store.mjs';
import { ROLE_LABEL, validateImage } from './images.mjs';
import { supplyPrice } from './pricing.mjs';
import { SECRET_CREDENTIAL } from './shein-client.mjs';

const client = createPluginClient();
const controller = createController({ client });
const $ = id => document.getElementById(id);

const IMAGE_ROLES = [['main', '主图'], ['detail', '详情图']];
const AUDIT_LABEL = { PENDING: '希音审核中', APPROVED: '审核通过', REJECTED: '已驳回' };
const CURRENCY_SYMBOL = { USD: '$', EUR: '€', GBP: '£', CNY: '¥', JPY: '¥' };

const state = {
  selectedId: null,
  form: null,
  dirty: false,
  busy: false,
  imageUrls: new Map(),
  suggestions: [],
  settingsOpen: false,
  credentialRevision: 0
};

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
  renderReview(form);
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
  for (const image of images) {
    const url = state.imageUrls.get(image.token) || '';
    const cell = el('figure', { class: 'source-thumb' });
    if (url) cell.append(el('img', { src: url, alt: image.name || '原图', loading: 'lazy' }));
    else cell.append(el('div', { class: 'thumb-empty', text: '无预览' }));
    cell.append(el('figcaption', { text: (image.excluded ? '已排除 · ' : '') + (ROLE_LABEL[image.role] ?? image.role) }));
    grid.append(cell);
  }
}

function renderForm(form) {
  $('title-en').value = form.product?.title?.en ?? '';
  $('title-zh').textContent = form.product?.title?.zh ? '1688 原文：' + form.product.title.zh : '';
  $('bullets').value = (form.product?.bullets ?? []).map(item => item.en).filter(Boolean).join('\n');
  $('description').value = form.product?.description?.en ?? '';
  $('category-id').value = form.product?.category?.sheinCategoryId ?? '';
  $('product-type-id').value = form.product?.category?.sheinProductTypeId ?? '';
  $('category-confirmed').checked = Boolean(form.product?.category?.confirmed);
  $('category-hint').textContent = form.product?.category?.sheinCategoryName ? '已选：' + form.product.category.sheinCategoryName : '';
  $('coefficient').value = form.product?.coefficient ?? 1.35;
  $('coefficient-hint').textContent = form.source?.price ? '1688 ¥' + Number(form.source.price).toFixed(2) + ' 起算' : '';
  renderAttributes(form);
  renderSkus(form);
  renderSuggestions();
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

function renderImages(form) {
  const host = $('image-list');
  const images = form.product?.images ?? [];
  host.replaceChildren();
  if (!images.length) {
    host.append(el('p', { class: 'hint', text: '还没有转存图片。先从 1688 原页转存，再逐张确认。' }));
    $('image-hint').textContent = '';
    return;
  }
  $('image-hint').textContent = `${images.filter(image => !image.excluded && image.token).length} 张可提交`;
  images.forEach((image, index) => {
    const url = state.imageUrls.get(image.token) || '';
    const thumb = el('div', { class: 'thumb' });
    if (url) thumb.append(el('img', { src: url, alt: image.name || '商品图片', loading: 'lazy' }));
    else thumb.append(el('span', { class: 'thumb-empty', text: '无预览' }));

    const role = el('select', {});
    for (const [value, label] of IMAGE_ROLES) role.append(el('option', { value, text: label }));
    role.value = image.role === 'main' ? 'main' : 'detail';
    role.addEventListener('change', () => {
      state.form.product.images[index].role = role.value;
      markDirty();
      renderImages(state.form);
      renderSource(state.form);
    });

    const exclude = el('input', { type: 'checkbox' });
    exclude.checked = Boolean(image.excluded);
    exclude.addEventListener('change', () => {
      state.form.product.images[index].excluded = exclude.checked;
      markDirty();
      renderImages(state.form);
      renderSource(state.form);
    });

    const error = validateImage(image).find(issue => issue.level === 'error');
    const meta = el('div', { class: 'image-meta' },
      el('strong', { text: image.name || image.id || '图片' }),
      el('span', { class: 'hint', text: `${image.width || '?'}×${image.height || '?'} · ${formatSize(image.size)}` + (image.uploadedUrl ? ' · 已上传希音' : '') }),
      error ? el('span', { class: 'image-error', text: error.message }) : null
    );

    host.append(el('div', { class: 'image-row' + (image.excluded ? ' is-excluded' : '') },
      thumb,
      meta,
      el('div', { class: 'image-controls' }, role, el('label', { class: 'check' }, exclude, '排除'))
    ));
  });
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
  $('category-id').value = item.categoryId;
  $('product-type-id').value = item.productTypeId || '';
  $('category-confirmed').checked = false;
  $('category-hint').textContent = item.name ? '已选：' + item.name : '';
  markDirty();
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
  for (const id of ['translate', 'save', 'prepare-images', 'load-template', 'suggest-category', 'delete-draft']) {
    const node = $(id);
    if (node) node.disabled = busy || !draft;
  }
  $('open-source').disabled = busy || !draft?.source?.url;
  $('category-confirmed').disabled = busy || !draft;

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
  const tokens = (form.product?.images ?? []).map(image => image.token).filter(token => token && !state.imageUrls.has(token));
  if (!tokens.length) return;
  for (const token of tokens) state.imageUrls.set(token, '');
  let changed = false;
  for (const token of tokens) {
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
  }
}

function markDirty() {
  state.dirty = true;
  renderIssues(state.form);
  updateGate();
}

async function run(label, task, statusId = 'action-status') {
  if (state.busy) return;
  state.busy = true;
  setStatus(statusId, label);
  updateGate();
  try {
    await task();
  } catch (error) {
    setStatus(statusId, errorText(error), true);
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
  render();
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

async function doLoadTemplate() {
  await run('正在读取希音属性模板…', async () => {
    const draft = selectedDraft();
    if (!draft) throw new Error('先选择草稿。');
    await saveForm();
    await controller.loadTemplate(draft.id, {
      categoryId: $('category-id').value.trim(),
      productTypeId: $('product-type-id').value.trim()
    });
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
    setStatus('action-status', state.suggestions.length ? '选择一个建议类目，再读取属性模板。' : '没有返回类目建议，请手动填写类目 ID。');
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
    ['图片', `${(form.product.images ?? []).filter(image => !image.excluded && image.token).length} 张`],
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
  $('default-coefficient').value = String(settings.coefficient ?? 1.35);
  $('site').value = settings.site || 'shein';
  $('base-url').value = settings.baseUrl || 'https://openapi.sheincorp.com';
  $('open-key').value = settings.openKeyId || '';
}

async function doSaveSettings() {
  await run('正在保存设置…', async () => {
    state.credentialRevision += 1;
    await controller.saveSettings({
      model: $('model').value.trim(),
      coefficient: $('default-coefficient').value,
      site: $('site').value.trim() || 'shein',
      baseUrl: $('base-url').value,
      openKeyId: $('open-key').value.trim()
    });
    fillSettings();
    setStatus('settings-status', '设置已保存。');
  }, 'settings-status');
  // 凭据状态刷新属于后台补充信息，放在忙碌窗口之外，避免它把紧随其后的
  // 保存密钥点击吞掉。
  await renderCredentialStatus();
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
    setStatus('translation-status', '');
  } catch (reason) {
    setStatus('translation-status', reason instanceof Error ? reason.message : '模型列表暂时不可用。', true);
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
}

async function doClearSheinSecret() {
  await run('正在清除密钥…', async () => {
    state.credentialRevision += 1;
    await controller.clearSecret(SECRET_CREDENTIAL);
    setStatus('secret-status', '已清除。');
  }, 'secret-status');
}

async function renderCredentialStatus() {
  const revision = state.credentialRevision;
  try {
    const status = await controller.credentialStatus();
    // 凭据状态与保存密钥是两条异步链路：保存设置期间发起的刷新可能晚于
    // 用户刚看到的保存结果返回，不能让它把新状态覆盖回旧值。
    if (revision !== state.credentialRevision) return;
    setStatus('secret-status', status.sheinSecret ? 'secretKey 已保存。' : 'secretKey 未保存。');
  } catch {
    setStatus('secret-status', '凭据状态暂时不可用。', true);
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
      void renderCredentialStatus();
    }
  });
  $('save-settings').addEventListener('click', () => void doSaveSettings());
  $('save-secret').addEventListener('click', () => void doSaveSheinSecret());
  $('clear-secret').addEventListener('click', () => void doClearSheinSecret());
  $('refresh-models').addEventListener('click', () => void loadModels());

  $('title-en').addEventListener('input', event => { state.form.product.title.en = event.target.value; markDirty(); });
  $('bullets').addEventListener('input', event => {
    state.form.product.bullets = event.target.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => ({ en: line }));
    markDirty();
  });
  $('description').addEventListener('input', event => { state.form.product.description.en = event.target.value; markDirty(); });
  $('category-id').addEventListener('input', event => {
    if (state.form.product.category.sheinCategoryId !== event.target.value) state.form.product.category.confirmed = false;
    state.form.product.category.sheinCategoryId = event.target.value.trim();
    $('category-confirmed').checked = false;
    markDirty();
  });
  $('product-type-id').addEventListener('input', event => {
    if (state.form.product.category.sheinProductTypeId !== event.target.value) state.form.product.category.confirmed = false;
    state.form.product.category.sheinProductTypeId = event.target.value.trim();
    $('category-confirmed').checked = false;
    markDirty();
  });
  $('category-confirmed').addEventListener('change', event => { state.form.product.category.confirmed = event.target.checked; markDirty(); });
  $('coefficient').addEventListener('input', event => {
    state.form.product.coefficient = Number(event.target.value);
    updateSupplyPrices(state.form);
    renderSkus(state.form);
    markDirty();
  });

  $('translate').addEventListener('click', () => void doTranslate());
  $('prepare-images').addEventListener('click', () => void doPrepareImages());
  $('load-template').addEventListener('click', () => void doLoadTemplate());
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
  } catch (error) {
    setStatus('action-status', errorText(error), true);
  }
})();

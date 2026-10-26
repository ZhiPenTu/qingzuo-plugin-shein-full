import { parseProductSnapshot } from './collect.mjs';
import {
  applyTranslation, blockingIssues, canTransition, coefficientOf, createDraft, markSubmitted, applyDocumentState,
  setImages, skuSupplyPriceOf, submissionKey, transition, upsertDraft, validateDraft
} from './store.mjs';
import {
  APP_SECRET_CREDENTIAL, authorizeWithTempToken, createSheinClient, parseDocumentState, parsePermission,
  parsePublishResult, parseQuota, parseRepeated, parseFillInStandard, parseUploadedUrl, SECRET_CREDENTIAL,
  SHEIN_BASE_URL, SHEIN_LEGACY_BASE_URL
} from './shein-client.mjs';
import { authorizationUrl, authorizeOriginOf, callbackUrlOf, createAuthorizationState, decryptSecretKey, readAuthorizationCallback } from './shein-auth.mjs';
import { applyAttributeTemplate, parseAttributeTemplate, parseCategoryTree } from './category.mjs';
import { buildPublishPayload } from './shein-payload.mjs';
import { translateProduct } from './translate.mjs';
import { convertToJpeg, imageNeedsConversion, imageTypeFor, readImageSize, validateImage } from './images.mjs';

export const DRAFTS_KEY = 'drafts';
export const SETTINGS_KEY = 'settings';
export const AUTH_TIMEOUT_MS = 600000;
const AUTH_POLL_MS = 300;

export const DEFAULT_SETTINGS = Object.freeze({
  model: '',
  coefficient: 1.35,
  site: 'shein',
  baseUrl: SHEIN_BASE_URL,
  appId: '',
  openKeyId: ''
});

const ALLOWED_SOURCE_HOSTS = new Set(['detail.1688.com', 'm.1688.com', 'www.1688.com']);

export function sourceUrlOf(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { throw new Error('请粘贴完整的 1688 商品链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('只支持 https 的 1688 商品链接。');
  if (!ALLOWED_SOURCE_HOSTS.has(url.hostname)) throw new Error('只支持 1688 商品详情链接。');
  return url.href;
}

function mergeSettings(value) {
  const settings = { ...DEFAULT_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  settings.coefficient = coefficientOf({ product: { coefficient: settings.coefficient } });
  if (settings.baseUrl === SHEIN_LEGACY_BASE_URL || !/^https:\/\//.test(settings.baseUrl)) settings.baseUrl = SHEIN_BASE_URL;
  return settings;
}

function mergeConfig(draft, patch) {
  const next = { ...draft, product: { ...draft.product, ...(patch.product ?? {}) } };
  if (patch.product?.category) next.product.category = { ...draft.product.category, ...patch.product.category };
  if (patch.product?.title) next.product.title = { ...draft.product.title, ...patch.product.title };
  if (patch.product?.description) next.product.description = { ...draft.product.description, ...patch.product.description };
  return next;
}

export function createController({ client, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const state = { settings: { ...DEFAULT_SETTINGS }, drafts: [], tabId: null, loaded: false, categories: null };
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) { try { listener(); } catch {} } };

  async function persistDraft(draft) {
    state.drafts = upsertDraft(state.drafts, draft);
    await client.storage.set(DRAFTS_KEY, state.drafts);
    notify();
    return draft;
  }

  function find(draftId) {
    const draft = state.drafts.find(item => item.id === draftId);
    if (!draft) throw new Error('草稿不存在或已删除。');
    return draft;
  }

  async function ensureCredentials() {
    const settings = state.settings;
    if (!settings.openKeyId || !(await client.credentials.status(SECRET_CREDENTIAL))) throw new Error('请先在设置中连接希音店铺。');
    return createSheinClient({ client, openKeyId: settings.openKeyId, baseUrl: settings.baseUrl, now });
  }

  async function ensureTab(draft) {
    if (!draft.source?.url) throw new Error('草稿缺少 1688 来源链接。');
    // 图片转存必须使用这条草稿自己的标签页。混用其它草稿的标签页会
    // 让同域请求带上错误的页面上下文，抓到的图片也就不是这条商品的。
    const known = draft.source.tabId;
    if (known) {
      const status = await client.browser.status();
      if ((status?.tabs ?? []).some(tab => tab.id === known)) return known;
    }
    const tab = await client.browser.open(draft.source.url);
    await persistDraft({ ...draft, source: { ...draft.source, tabId: tab.tabId } });
    return tab.tabId;
  }

  // 采集、翻译和转图可能在任意阶段执行，只有当前状态允许时才推进，
  // 否则保留原状态，避免重复点击把流程打断。
  function advance(draft, status, note) {
    return canTransition(draft.status, status) ? transition(draft, status, note, now()) : draft;
  }

  async function load() {
    state.settings = mergeSettings(await client.storage.get(SETTINGS_KEY));
    const drafts = await client.storage.get(DRAFTS_KEY);
    state.drafts = Array.isArray(drafts) ? drafts.filter(item => item && typeof item.id === 'string') : [];
    state.loaded = true;
    notify();
    return state;
  }

  async function saveSettings(patch) {
    state.settings = mergeSettings({ ...state.settings, ...patch });
    state.categories = null;
    await client.storage.set(SETTINGS_KEY, state.settings);
    notify();
    return state.settings;
  }

  async function setSecret(name, value) {
    if (name !== SECRET_CREDENTIAL) throw new Error('凭据名称无效。');
    if (typeof value !== 'string' || !value.trim()) throw new Error('请填写密钥。');
    await client.credentials.set(name, value.trim());
    notify();
  }

  async function clearSecret(name) {
    await client.credentials.clear(name);
    if (name === SECRET_CREDENTIAL) state.categories = null;
    notify();
  }

  // 应用授权：APP_ID + APP_SecretKey 只用来换店铺凭据，换到的 secretKey 解密后
  // 才用于业务接口签名。任何一步失败都不写半套凭据，避免界面上出现「已连接」但签不了名。
  function appCredentials(appId, appSecretKey) {
    const appIdValue = typeof appId === 'string' ? appId.trim() : '';
    const appSecret = typeof appSecretKey === 'string' ? appSecretKey.trim() : '';
    if (!appIdValue) throw new Error('请先填写希音 APP_ID。');
    if (!appSecret) throw new Error('请填写希音 APP_SecretKey。');
    return { appIdValue, appSecret };
  }

  // 打开希音授权页：回调地址由插件按当前环境生成，授权结果在同一标签页里读回。
  async function startAuthorization({ appId, appSecretKey, baseUrl }) {
    const { appIdValue, appSecret } = appCredentials(appId, appSecretKey);
    state.settings = mergeSettings({ ...state.settings, appId: appIdValue, baseUrl: baseUrl ?? state.settings.baseUrl });
    state.categories = null;
    await client.storage.set(SETTINGS_KEY, state.settings);
    await client.credentials.set(APP_SECRET_CREDENTIAL, appSecret);
    const callbackUrl = callbackUrlOf(state.settings.baseUrl);
    const nonce = createAuthorizationState();
    const address = authorizationUrl({ appId: appIdValue, baseUrl: state.settings.baseUrl, state: nonce, callbackUrl });
    const tab = await client.browser.open(address);
    notify();
    return { tabId: tab.tabId, state: nonce, callbackUrl, authorizeUrl: address };
  }

  // 等商家在授权页点完确认：逐次读回标签页地址，只有 state 对得上的回调才算数。
  async function awaitAuthorization({ tabId, state: expected, timeoutMs = AUTH_TIMEOUT_MS, intervalMs = AUTH_POLL_MS, isCancelled }) {
    const interval = Math.max(1, Number(intervalMs) || AUTH_POLL_MS);
    const attempts = Math.max(1, Math.ceil(Math.max(1, Number(timeoutMs) || AUTH_TIMEOUT_MS) / interval));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (isCancelled?.()) throw new Error('已取消希音授权。');
      const status = await client.browser.status();
      const tab = (status?.tabs ?? []).find(item => item?.id === tabId);
      const captured = readAuthorizationCallback(tab?.url, expected);
      if (captured) return captured;
      await sleep(interval);
    }
    throw new Error('等待希音授权超时，请重新连接。');
  }

  // 授权结束后把标签页收回授权站点首页，免得商家对着一个没有内容的回调页。
  async function resetAuthorizationTab() {
    try { await client.browser.open(authorizeOriginOf(state.settings.baseUrl) + '/'); } catch {}
  }

  async function authorize({ appId, appSecretKey, tempToken, baseUrl }) {
    const { appIdValue, appSecret } = appCredentials(appId, appSecretKey);
    if (!String(tempToken ?? '').trim()) throw new Error('希音授权没有返回临时授权码，请重新连接。');
    // 换密钥要跟着界面上选的环境走，否则选了测试环境却把授权码发到正式环境。
    state.settings = mergeSettings({ ...state.settings, appId: appIdValue, baseUrl: baseUrl ?? state.settings.baseUrl });
    await client.storage.set(SETTINGS_KEY, state.settings);
    await client.credentials.set(APP_SECRET_CREDENTIAL, appSecret);
    const info = await authorizeWithTempToken({ client, appId: appIdValue, tempToken, baseUrl: state.settings.baseUrl, now });
    const secretKey = await decryptSecretKey(info.secretKey, appSecret);
    state.settings = mergeSettings({ ...state.settings, openKeyId: info.openKeyId });
    state.categories = null;
    await client.storage.set(SETTINGS_KEY, state.settings);
    await client.credentials.set(SECRET_CREDENTIAL, secretKey);
    notify();
    return { openKeyId: info.openKeyId, supplierId: info.supplierId };
  }

  async function credentialStatus() {
    return {
      sheinSecret: await client.credentials.status(SECRET_CREDENTIAL),
      appSecret: await client.credentials.status(APP_SECRET_CREDENTIAL),
      openKeyId: Boolean(state.settings.openKeyId),
      model: state.settings.model
    };
  }

  async function aiCatalog() {
    return client.ai.textModels();
  }

  async function collect(link) {
    const url = sourceUrlOf(link);
    const tab = await client.browser.open(url);
    state.tabId = tab.tabId;
    try { await client.browser.waitFor({ tabId: tab.tabId, selector: 'h1', timeoutMs: 15000 }); } catch {}
    const snapshot = await client.browser.snapshot({ tabId: tab.tabId });
    // 标签页地址是权威来源；快照没带地址时用它兜底，草稿才不会丢掉来源链接。
    const collected = parseProductSnapshot({ ...snapshot, url: snapshot.url || tab.url });
    if (collected.needsHuman) throw new Error('页面需要人工处理：请在内嵌浏览器完成登录或验证，再重新采集。');
    if (!collected.title || !collected.price) throw new Error('没有识别到商品标题或价格，请在页面加载完成后重试。');
    const draft = createDraft(collected, { now: now(), coefficient: state.settings.coefficient });
    return persistDraft({ ...draft, source: { ...draft.source, tabId: tab.tabId } });
  }

  async function translate(draftId) {
    const draft = find(draftId);
    const glossaryKey = 'glossary.' + (draft.product?.category?.sheinCategoryId || 'default');
    const glossary = await client.storage.get(glossaryKey);
    const translation = await translateProduct({
      client,
      model: state.settings.model,
      glossary: glossary && typeof glossary === 'object' ? glossary : {},
      input: {
        title: draft.source?.title ?? '',
        attributes: (draft.source?.attributes ?? []).map(item => ({ name: item.name, value: item.value })),
        colors: (draft.product?.skus ?? []).map(item => item.color).filter(Boolean),
        categoryPath: draft.source?.breadcrumb ?? []
      }
    });
    let next = applyTranslation(draft, translation, now());
    if ((next.product?.images ?? []).some(image => image.token)) next = advance(next, 'imaged', '图片已就绪');
    const mergedGlossary = { ...(glossary && typeof glossary === 'object' ? glossary : {}) };
    for (const attribute of translation.attributes ?? []) if (attribute?.name && attribute?.value) mergedGlossary[attribute.name] = attribute.value;
    await client.storage.set(glossaryKey, mergedGlossary);
    return persistDraft(next);
  }

  async function prepareImages(draftId) {
    await ensureTab(find(draftId));
    // ensureTab 可能已经把新标签页写回草稿，这里重新读取，避免用它之前
    // 的副本覆盖 tabId。
    const draft = find(draftId);
    const tabId = draft.source.tabId;
    const sources = (draft.source?.images ?? []).slice(0, 14);
    const existing = new Map((draft.product?.images ?? []).map(image => [image.sourceUrl, image]));
    const images = [];
    const notes = [];
    for (const source of sources) {
      const previous = existing.get(source.url);
      if (previous?.token) { images.push(previous); continue; }
      try {
        const file = await client.browser.saveResource({ tabId, url: source.url });
        let { data, mime } = await client.storage.readFile(file.token);
        let token = file.token;
        let size = file.size;
        let name = file.name;
        let dimensions = readImageSize(data);
        if (imageNeedsConversion({ mime })) {
          const converted = await convertToJpeg(data, mime);
          const saved = await client.storage.saveFile({ data: converted.base64, filename: name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg' });
          await client.storage.removeFile(token);
          token = saved.token;
          size = saved.size;
          name = saved.name;
          mime = saved.mime;
          dimensions = { width: converted.width, height: converted.height };
        }
        const image = {
          id: 'img-' + (images.length + 1),
          role: source.role === 'main' ? 'main' : 'detail',
          sourceUrl: source.url,
          token,
          uploadedUrl: '',
          name,
          size,
          mime,
          width: dimensions?.width ?? source.width ?? 0,
          height: dimensions?.height ?? source.height ?? 0,
          excluded: false
        };
        const issues = validateImage(image);
        if (issues.some(issue => issue.level === 'error')) notes.push(name + '：' + issues.find(issue => issue.level === 'error').message);
        images.push(image);
      } catch (error) {
        notes.push('图片转存失败：' + (error instanceof Error ? error.message : String(error)));
      }
    }
    let next = setImages(draft, images, now());
    if (images.some(image => !image.excluded && image.token)) next = advance(next, 'imaged', '图片已转存 ' + images.length + ' 张');
    next = { ...next, notes: [...new Set([...(next.notes ?? []), ...notes])] };
    return persistDraft(next);
  }

  async function loadTemplate(draftId, { categoryId, productTypeId } = {}) {
    const draft = find(draftId);
    const sheinCategoryId = String(categoryId ?? draft.product.category.sheinCategoryId ?? '').trim();
    const sheinProductTypeId = String(productTypeId ?? draft.product.category.sheinProductTypeId ?? '').trim();
    if (!/^\d+$/.test(sheinCategoryId) || !/^\d+$/.test(sheinProductTypeId)) throw new Error('请先选择希音末级类目，再读取属性模板。');
    const gateway = await ensureCredentials();
    const [info, standard] = await Promise.all([
      gateway.queryAttributeTemplate([Number(sheinProductTypeId)]),
      gateway.queryFillInStandard({ category_id: Number(sheinCategoryId), product_type_id: Number(sheinProductTypeId) }).catch(() => null)
    ]);
    const template = parseAttributeTemplate(info);
    let next = mergeConfig(draft, { product: { category: { sheinCategoryId, sheinProductTypeId } } });
    next = applyAttributeTemplate(next, template);
    const currency = parseFillInStandard(standard).currency;
    if (currency) next = { ...next, product: { ...next.product, currency } };
    next = { ...next, updated: now() };
    if (template.attributes.length) next.notes = [...new Set([...(next.notes ?? []), '已加载 ' + template.attributes.length + ' 个希音属性'])];
    return persistDraft(next);
  }

  // 类目树跟随店铺权限，同一次连接内复用；切换环境或重新授权后由上面几处置空。
  async function loadCategories({ force = false } = {}) {
    if (!force && state.categories) return state.categories;
    const gateway = await ensureCredentials();
    const categories = parseCategoryTree(await gateway.queryCategoryTree());
    state.categories = categories;
    return categories;
  }

  async function suggestCategory(draftId) {
    const draft = find(draftId);
    const gateway = await ensureCredentials();
    const image = (draft.product?.images ?? []).find(item => item.uploadedUrl) ?? null;
    const info = await gateway.suggestCategory(image ? { image_url: image.uploadedUrl } : {});
    const list = Array.isArray(info) ? info : info?.category_list ?? info?.list ?? [];
    return (Array.isArray(list) ? list : []).slice(0, 10).map(item => ({
      categoryId: String(item?.category_id ?? item?.categoryId ?? ''),
      productTypeId: String(item?.product_type_id ?? item?.productTypeId ?? ''),
      name: String(item?.category_name ?? item?.categoryName ?? item?.name ?? ''),
      score: Number(item?.score ?? item?.confidence ?? 0)
    })).filter(item => item.categoryId);
  }

  async function saveDraft(draftId, patch = {}) {
    const draft = find(draftId);
    if (draft.status === 'submitted' || draft.status === 'approved') throw new Error('已提交的商品不能直接修改。');
    let next = mergeConfig(draft, patch);
    next = { ...next, updated: now() };
    next.issues = validateDraft(next);
    const hasErrors = next.issues.some(issue => issue.level === 'error');
    if (next.status === 'review' && hasErrors) next = advance(next, 'collected', '退回修改');
    // 只有还在前段的草稿会自动进入待审核；驳回后要用户点「重新编辑」再提交。
    else if (!hasErrors && ['collected', 'translated', 'imaged'].includes(next.status)) next = advance(next, 'review', '已进入待审核');
    return persistDraft(next);
  }

  async function submit(draftId, { confirm = false, retryUnverified = false } = {}) {
    if (confirm !== true) throw new Error('提交前需要在确认摘要中确认。');
    const draft = find(draftId);
    if (draft.status !== 'review') throw new Error('只有待审核的草稿才能提交。');
    if (draft.submission?.pending && !draft.submission?.spuName && retryUnverified !== true) {
      throw new Error('上次提交结果未确认。请先在希音后台核对是否已建品，再决定是否重新提交。');
    }
    const issues = blockingIssues(draft);
    if (issues.length) throw new Error(issues[0].message);
    const gateway = await ensureCredentials();
    const supplierSkus = (draft.product.skus ?? []).map(item => item.supplierSku).filter(Boolean);
    const repeated = parseRepeated(await gateway.checkSupplierSkuRepeated(supplierSkus));
    if (repeated.length) throw new Error('供货 SKU 已存在：' + repeated.join('、') + '，请修改后再提交。');
    const permission = parsePermission(await gateway.checkPublishPermission({
      category_id: Number(draft.product.category.sheinCategoryId),
      product_type_id: Number(draft.product.category.sheinProductTypeId)
    }));
    if (!permission.allowed) throw new Error(permission.message || '当前店铺不允许发布商品。');
    const quota = parseQuota(await gateway.quota());
    if (quota.remaining !== null && quota.remaining <= 0) throw new Error('希音发品额度不足。');

    const images = [];
    for (const image of draft.product.images ?? []) {
      if (image.excluded || !image.token) continue;
      let uploadedUrl = image.uploadedUrl;
      if (!uploadedUrl) {
        uploadedUrl = parseUploadedUrl(await gateway.uploadPic({ token: image.token, imageType: imageTypeFor(image.role) }));
        if (!uploadedUrl) throw new Error('图片上传没有返回希音地址：' + (image.name || image.id));
      }
      images.push({ ...image, uploadedUrl });
    }
    if (!images.some(image => image.role === 'main')) throw new Error('至少需要一张已上传的主图。');
    let staged = await persistDraft({
      ...draft,
      product: { ...draft.product, images },
      submission: { key: submissionKey(draft), at: now(), pending: true, error: '' }
    });
    const payload = buildPublishPayload(staged, { site: state.settings.site });
    let response;
    try {
      response = await gateway.publish(payload);
    } catch (error) {
      // 结果未知时不自动重试：界面会提示先核对希音后台，重试前仍会做供货 SKU 重复检查。
      await persistDraft({ ...staged, submission: { ...staged.submission, error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
    const result = parsePublishResult(response);
    staged = markSubmitted(staged, result, now());
    return persistDraft(staged);
  }

  async function poll(draftId) {
    const draft = find(draftId);
    if (!draft.submission?.spuName) throw new Error('缺少希音商品编号，无法查询审核状态。');
    const gateway = await ensureCredentials();
    const state = parseDocumentState(await gateway.queryDocumentState({ spu_name: draft.submission.spuName }));
    return persistDraft(applyDocumentState(draft, state, now()));
  }

  async function remove(draftId) {
    const draft = find(draftId);
    for (const image of draft.product?.images ?? []) {
      if (image.token) await client.storage.removeFile(image.token).catch(() => {});
    }
    state.drafts = state.drafts.filter(item => item.id !== draftId);
    await client.storage.set(DRAFTS_KEY, state.drafts);
    notify();
  }

  async function resume(draftId) {
    const draft = find(draftId);
    if (draft.status !== 'rejected') throw new Error('只有被驳回的草稿需要修改。');
    return persistDraft(transition(draft, 'review', '根据驳回原因修改', now()));
  }

  return Object.freeze({
    load, saveSettings, setSecret, clearSecret, startAuthorization, awaitAuthorization, resetAuthorizationTab, authorize, credentialStatus, aiCatalog,
    collect, translate, prepareImages, loadCategories, loadTemplate, suggestCategory, ensureTab,
    saveDraft, submit, poll, remove, resume,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getState() { return state; },
    find,
    draftIssues: draftId => validateDraft(find(draftId)),
    supplyPrice: (draftId, sku) => skuSupplyPriceOf(sku, find(draftId))
  });
}

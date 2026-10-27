import { createHash, createHmac } from 'node:crypto';

export const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function encodeEnvelope(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function ok(info) {
  return { status: 200, mime: 'application/json', data: encodeEnvelope({ code: '0', msg: 'OK', info }) };
}

export function businessError(code, msg) {
  return { status: 200, mime: 'application/json', data: encodeEnvelope({ code: String(code), msg }) };
}

// 最小可用的插件宿主替身：存储、凭据、浏览器和网络都记录调用，方便断言
// “没点确认就绝不发品”这类安全约定。
export function createFakeClient({ snapshot, resource = { data: PNG_1X1, mime: 'image/png', name: 'main.png' }, respond, translation, imageModels, batch } = {}) {
  const storage = new Map();
  const files = new Map();
  const secrets = new Map();
  const tabs = [];
  const calls = { ai: [], browser: [], network: [], storage: [], credentials: [], resources: [], files: [], removed: [] };
  const translated = {
    title: 'Mock translated title',
    bullets: ['Mock benefit one', 'Mock benefit two'],
    description: 'Mock description.',
    attributes: [{ name: '材质', value: 'Cotton' }],
    ...translation
  };
  let sequence = 0;

  async function createFile({ data, filename, mime }) {
    const token = 'file-' + (++sequence);
    files.set(token, { data, mime, name: filename });
    return { token, name: filename, size: Math.ceil((data.length * 3) / 4), mime };
  }

  const client = {
    storage: {
      async get(key) { return storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : null; },
      async set(key, value) {
        calls.storage.push(['set', key]);
        storage.set(key, JSON.parse(JSON.stringify(value)));
        return true;
      },
      async keys() { return [...storage.keys()]; },
      async remove(key) { storage.delete(key); return true; },
      saveFile: options => createFile(options),
      async readFile(token) {
        const item = files.get(token);
        if (!item) throw new Error('文件不存在。');
        return { data: item.data, mime: item.mime };
      },
      async removeFile(token) { calls.removed.push(token); files.delete(token); return true; }
    },
    credentials: {
      async set(name, value) { calls.credentials.push(['set', name]); secrets.set(name, value); },
      async status(name) { return secrets.has(name); },
      async clear(name) { calls.credentials.push(['clear', name]); secrets.delete(name); }
    },
    files: {
      async url(token) { return 'plugin-file://' + token; },
      async read(token) {
        calls.files.push(['read', token]);
        const item = files.get(token);
        if (!item) throw new Error('文件不存在。');
        return { data: item.data, mime: item.mime };
      },
      async release(token) { calls.files.push(['release', token]); return true; },
      async pickDirectory() { calls.files.push(['pickDirectory']); return { token: 'dir-1', name: 'Translation' }; }
    },
    browser: {
      async open(url) {
        calls.browser.push(['open', url]);
        const tab = { id: 'tab-' + (++sequence), title: '1688 商品', url, loading: false, canGoBack: false, canGoForward: false };
        tabs.push(tab);
        return { tabId: tab.id, url, title: tab.title };
      },
      async snapshot(options = {}) {
        calls.browser.push(['snapshot', options.tabId]);
        if (!snapshot) throw new Error('没有准备页面快照。');
        const tab = tabs.find(item => item.id === options.tabId) ?? tabs.at(-1) ?? { id: options.tabId, url: snapshot.url };
        return { tabId: tab.id, url: tab.url || snapshot.url, title: snapshot.title ?? tab.title, nodes: snapshot.nodes ?? [], truncated: Boolean(snapshot.truncated) };
      },
      async waitFor(options = {}) { calls.browser.push(['waitFor', options.tabId]); return { tabId: options.tabId, url: '', ok: true, elapsed: 0 }; },
      async act(options) { calls.browser.push(['act', options.action, options.ref]); return { tabId: options.tabId, url: '', action: options.action, ok: true }; },
      async status() { return { open: tabs.length > 0, activeTabId: tabs.at(-1)?.id ?? null, tabs: tabs.slice(), candidates: [], downloads: [] }; },
      async saveResource(options) {
        calls.resources.push(options);
        if (typeof resource === 'function') return resource(options);
        const token = 'file-' + (++sequence);
        files.set(token, { data: resource.data, mime: resource.mime, name: resource.name });
        return { token, name: resource.name, size: 1024, mime: resource.mime, tabId: options.tabId };
      },
      onEvent() { return () => {}; }
    },
    network: {
      async sign(options = {}) {
        if (!secrets.has(options.credential)) throw new Error('请先配置服务凭据。');
        const secret = secrets.get(options.credential);
        const digest = options.algorithm === 'sha256'
          ? createHash('sha256').update(options.message, 'utf8').digest('base64')
          : createHmac('sha256', secret + (options.keySuffix ?? '')).update(options.message, 'utf8').digest('base64');
        return { algorithm: options.algorithm, encoding: 'base64', digest };
      },
      async request(options) {
        calls.network.push(options);
        if (!respond) throw new Error('未预期的网络请求：' + options.url);
        return respond(options);
      }
    },
    ai: {
      async models(options = {}) {
        calls.ai.push(['models', options]);
        return imageModels ?? [{ id: 'mock-image', source: 'proxy', provider: 'google', title: 'Mock Image', sizes: ['1024x1024'] }];
      },
      async textModels() {
        calls.ai.push(['textModels']);
        return { models: [{ id: 'mock-translator', title: 'Mock Translator' }], defaultModel: 'mock-translator' };
      },
      async complete(options) {
        calls.ai.push(['complete', options]);
        return { content: JSON.stringify(translated), model: options.model || 'mock-translator' };
      },
      batch: {
        async create(options) {
          calls.ai.push(['batch.create', options]);
          const base = batch ? await batch.create(options) : null;
          return base ?? {
            schemaVersion: 1, id: 'batch-1', owner: 'test', revision: 1, created: 1, state: 'draft',
            source: options.source, modelId: options.modelId, parameters: {}, concurrency: options.concurrency ?? 1,
            items: options.items.map((item, index) => ({ id: 'item-' + (index + 1), name: 'item-' + (index + 1), mime: 'image/png', prompt: '', state: 'pending', error: null, output: null }))
          };
        },
        async start(options) { calls.ai.push(['batch.start', options]); return { id: options.id, state: 'running' }; },
        async get(options) {
          calls.ai.push(['batch.get', options]);
          if (batch?.get) return batch.get(options);
          return { schemaVersion: 1, id: options.id, state: 'finished', revision: 1, items: [] };
        },
        async cancel(options) { calls.ai.push(['batch.cancel', options]); return { id: options.id, state: 'canceled' }; },
        async preview(options) {
          calls.ai.push(['batch.preview', options]);
          if (batch?.preview) return batch.preview(options);
          return createFile({ data: PNG_1X1, filename: 'preview.png', mime: 'image/png' });
        }
      }
    }
  };

  return { client, calls, storage, files, secrets, tabs };
}

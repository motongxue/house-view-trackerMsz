/* background.js —— MV3 service worker：保存各站点采集数据、生成导入物、推送到系统。
 * 站点差异只在 sites/*.js；字段清单、CSV、导入桥、消息协议在这里统一，只有一份。 */
importScripts('core.js', 'sites/anjuke.js', 'sites/beike.js', 'mapper.js');
const MAP = globalThis.HVT_MAP;
const SITES = MAP.SITES;

const KEY_STATE = 'hvt_ajk_state';
const KEY_CFG = 'hvt_ajk_cfg';
const KEY_SCHEMA = 'hvt_ajk_schema';
const KEY_CONN = 'hvt_ajk_conn';
const DEFAULT_BASE = 'http://127.0.0.1:8787';

// F259/F262/F263：后端地址统一严格校验——只接受 http(s)，拒绝内嵌凭据 / query / hash，
// 避免 Bearer token 被发往 craft 地址。返回归一化后的 base，非法返回 null。
function safeBase(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.search || u.hash) return null;
  return u.protocol + '//' + u.host + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, ''));
}

const storeGet = (key) => new Promise((resolve) => {
  chrome.storage.local.get(key, (r) => resolve(r[key] || null));
});
const storeSet = (obj) => new Promise((resolve) => {
  chrome.storage.local.set(obj, () => resolve());
});

async function getState() { return (await storeGet(KEY_STATE)) || {}; }
async function getCfg() { return Object.assign({ base: DEFAULT_BASE, token: '' }, (await storeGet(KEY_CFG)) || {}); }

/* 整个 schema（csvCols + imageRules）只从系统同源读取，唯一源 public/js/property-schema.json，
 * 插件里不存第二份。imageRules 决定外链图片要不要补平台处理指令，漏了贝壳图片会全部裂开。
 * 系统没启动时用上次成功读取的缓存（兼容老缓存：只有列数组）；完全离线且无缓存才明确报错。 */
let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const cfg = await getCfg();
    const base = String(cfg.base || DEFAULT_BASE).replace(/\/+$/, '');
    let schema = null;
    try {
      const res = await fetch(base + '/js/property-schema.json', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (Array.isArray(j.csvCols) && j.csvCols.length) {
          // F048：缺 imageRules 会让贝壳图片裂开，明确告警（core.configure 会沿用缓存规则）
          if (!Array.isArray(j.imageRules)) console.warn('[HVT] 系统字段清单缺少 imageRules，贝壳图片可能裂开；沿用缓存规则');
          schema = j;
        }
      }
    } catch (e) { /* 系统未启动，改用缓存 */ }
    if (schema) await storeSet({ [KEY_SCHEMA]: schema });
    else {
      const cached = await storeGet(KEY_SCHEMA);
      schema = Array.isArray(cached) ? { csvCols: cached } : cached;
    }
    if (!schema || !Array.isArray(schema.csvCols) || !schema.csvCols.length) {
      throw new Error('读不到系统字段清单，请先启动择隅系统并打开一次页面');
    }
    MAP.configure(schema);
    return schema.csvCols;
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// 兼容旧存储状态（只有 main/params 没有 site 时按安居客处理）
function resolveSite(s) {
  return s.site || (s.page ? 'beike' : 'anjuke');
}
function siteOf(msg, sender) {
  const fromUrl = MAP.detectSite(sender && sender.tab && sender.tab.url);
  return msg.site || fromUrl || 'anjuke';
}

/* 当前标签页诊断 / 补注入。
 * Chrome 重新加载扩展后，已经打开的标签页不会自动重新注入 content script；
 * 站点也可能把页面跳到人机验证域，此时 URL 不匹配、浮层自然不出现。
 * 这两条消息让弹窗能说清「现在到底卡在哪」，并一键补加载脚本重新采。 */
async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return (tabs && tabs[0]) || null;
}
function siteInfo(url) {
  const id = MAP.detectSite(url || '');
  return { id: id, name: (SITES[id] && SITES[id].name) || '' };
}
async function pingTab(tabId) {
  // 旧标签页里可能残留已失效的 content script（扩展重载后），它既不回包也不报错，
  // 所以必须带超时，否则诊断/重采会永远卡住。
  let timer = null;
  try {
    const r = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'HVT_PING' }),
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, 1200); })
    ]);
    return (r && r.ok) ? r : null;
  } catch (e) { return null; }
  finally { if (timer) clearTimeout(timer); } // F175：落地后清掉超时定时器
}
function blockedHint(url) {
  const u = String(url || '');
  if (/hip\.ke\.com|captcha|forbidden|passport|login/i.test(u))
    return '当前页面是网站的人机验证 / 拦截页，不是房源详情页；请先在页面完成验证，再打开房源链接。';
  if (/^chrome:|^about:|^edge:|^chrome-extension:/i.test(u))
    return '当前是浏览器内部页面，请切到房源详情页。';
  return '';
}

async function buildPayload() {
  await ensureSchema();
  const s = await getState();
  const siteId = resolveSite(s);
  const built = MAP.buildSite(siteId, s, {
    sourceUrl: s.sourceUrl,
    id: s.id || s.loupanId,
    loupanId: s.loupanId || s.id
  });
  const row = built.row;
  return {
    name: row.title,
    id: s.id || s.loupanId || '',
    loupanId: s.loupanId || s.id || '',
    site: siteId,
    siteName: built.siteName,
    singlePage: built.singlePage,
    hasMain: built.hasMain,
    hasParams: built.hasParams,
    sourceUrl: s.sourceUrl || '',
    stats: built.stats,
    fields: MAP.fieldList(row),
    csv: MAP.toCsv(row),
    row: row,
    jsonText: JSON.stringify(row, null, 2)
  };
}

async function handle(msg, sender, sendResponse) {
  try {
    if (msg.type === 'HVT_PROBE') {
      const tabId = sender.tab && sender.tab.id;
      if (!tabId) return sendResponse({ ok: false, error: '找不到标签页' });
      const siteId = siteOf(msg, sender);
      const site = SITES[siteId];
      if (!site || typeof site.probeInPage !== 'function') {
        return sendResponse({ ok: false, error: '没有该站点的采集适配器：' + siteId });
      }
      // content script 处于隔离世界，读不到页面主世界的 window.GLOBAL_INFOS / __NUXT__
      await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: site.probeInPage });
      return sendResponse({ ok: true });
    }

    if (msg.type === 'HVT_SAVE') {
      const old = await getState();
      const id = String(msg.id || old.id || old.loupanId || 'unknown');
      const site = msg.site || old.site || 'anjuke';
      // F260：站点发生变化时统一丢弃上一站点的页面数据，避免跨站点残留
      const siteChanged = !!old.site && old.site !== site;
      const prev = siteChanged ? {} : old;
      // F174：抓取对象做体积校验，避免撑爆 storage 配额
      if (msg.data) {
        let size = 0;
        try { size = JSON.stringify(msg.data).length; } catch (e) { size = 0; }
        if (size > 1000000) return sendResponse({ ok: false, error: '页面数据过大，已跳过保存' });
      }
      const next = {
        site: site,
        id: id,
        loupanId: id,
        sourceUrl: msg.sourceUrl || prev.sourceUrl || '',
        updatedAt: Date.now()
      };
      if (site === 'beike') {
        next.page = msg.data;                 // 单页一次采全
        next.main = null; next.params = null;
      } else {
        next.main = msg.pageType === 'main' ? msg.data : prev.main;
        next.params = msg.pageType === 'params' ? msg.data : prev.params;
        next.page = null;
        // 换了楼盘就丢掉上一个楼盘的详细信息，避免串数据
        if (prev.loupanId && prev.loupanId !== id && msg.pageType === 'main') next.params = null;
      }
      await storeSet({ [KEY_STATE]: next });
      const p = await buildPayload();
      return sendResponse({ ok: true, name: p.name, stats: p.stats, hasMain: p.hasMain, hasParams: p.hasParams });
    }

    if (msg.type === 'HVT_DATA') return sendResponse({ ok: true, data: await buildPayload() });

    if (msg.type === 'HVT_STATE') {
      const p = await buildPayload();
      const cfg = await getCfg();
      const conn = await storeGet(KEY_CONN);
      return sendResponse({
        ok: true, data: p,
        cfg: { base: cfg.base, hasToken: !!cfg.token, tokenAt: cfg.tokenAt || 0,
               connOk: !!(conn && conn.base === cfg.base && conn.at) }
      });
    }

    if (msg.type === 'HVT_TOKEN') {
      const cfg = await getCfg();
      await storeSet({ [KEY_CFG]: Object.assign(cfg, { token: msg.token, base: msg.base || cfg.base, tokenAt: Date.now() }) });
      return sendResponse({ ok: true });
    }

    if (msg.type === 'HVT_CONFIG') {
      const cfg = await getCfg();
      const newBase = safeBase(msg.base || cfg.base);
      if (!newBase) return sendResponse({ ok: false, error: '地址格式不对，请填完整的 http(s) 地址（不要带账号密码或查询参数）' });
      const patch = { base: newBase };
      if (msg.token !== undefined) patch.token = String(msg.token || '').trim();
      await storeSet({ [KEY_CFG]: Object.assign(cfg, patch) });
      // 换了系统地址，旧的「测试连接成功」作废，必须重新测一次
      if (newBase !== cfg.base) await chrome.storage.local.remove(KEY_CONN);
      return sendResponse({ ok: true });
    }

    if (msg.type === 'HVT_CLEAR') {
      await chrome.storage.local.remove(KEY_STATE);
      return sendResponse({ ok: true });
    }

    // 诊断：当前标签页是什么、脚本在不在、state 是哪次采集留下的
    if (msg.type === 'HVT_DIAG') {
      const tab = await activeTab();
      const url = (tab && tab.url) || msg.tabUrl || '';
      const s = await getState();
      const si = siteInfo(url);
      const ping = (tab && tab.id != null) ? await pingTab(tab.id) : null;
      return sendResponse({
        ok: true,
        data: {
          tabUrl: url, tabTitle: (tab && tab.title) || '',
          site: si.id, siteName: si.name, siteSupported: !!si.id,
          scriptAlive: !!ping, scriptPanel: !!(ping && ping.panel),
          blockedHint: blockedHint(url),
          stateSite: s.site || (s.page ? 'beike' : 'anjuke'),
          stateName: (SITES[resolveSite(s)] && SITES[resolveSite(s)].name) || '',
          stateUrl: s.sourceUrl || '', stateId: s.id || s.loupanId || '',
          stateAt: s.updatedAt || 0,
          stateHasData: !!(s.main || s.params || s.page)
        }
      });
    }

    // 确保当前房源页上有采集脚本并在采集（不清数据）；诊断与重采共用这一段
    if (msg.type === 'HVT_ENSURE' || msg.type === 'HVT_RECOLLECT') {
      const tab = await activeTab();
      if (!tab || tab.id == null) return sendResponse({ ok: false, error: '找不到当前标签页' });
      const url = tab.url || msg.tabUrl || '';
      const si = siteInfo(url);
      const hint = blockedHint(url);
      if (!si.id) {
        // 页面不对时先拒绝，别把上一条房源数据白白清掉
        return sendResponse({ ok: false,
          error: hint || '当前页面不是支持的房源页（安居客楼盘页 / 贝壳二手房详情页），请切到房源详情页再点重采。' });
      }
      if (msg.type === 'HVT_RECOLLECT') await chrome.storage.local.remove(KEY_STATE);
      let ping = await pingTab(tab.id);
      let injected = false;
      if (!ping) {
        // 扩展重载后旧标签页没有脚本：按 manifest 同一套 content.js/content.css 补注入
        try {
          // F173：先 executeScript 成功再插 CSS，避免部分失败时重复注入样式表
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
          injected = true;
          await new Promise(function (r) { setTimeout(r, 250); });
          ping = await pingTab(tab.id);
        } catch (e) {
          return sendResponse({ ok: false, error: '无法向当前页注入采集脚本：' + ((e && e.message) || e) });
        }
      }
      if (!ping) return sendResponse({ ok: false, error: '脚本已注入但页面未响应，请刷新房源页后重试' });
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'HVT_RECOLLECT' });
      } catch (e) {
        return sendResponse({ ok: false, error: '触发重采失败，请刷新房源页后重试' });
      }
      return sendResponse({ ok: true, injected: injected, site: si.id, siteName: si.name });
    }

    if (msg.type === 'HVT_DOWNLOAD') {
      // F176：清理来自 content script 的文件名，防止路径分隔符 / 保留字符导致越界或下载失败
      const rawName = String(msg.filename || 'house-import.csv');
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 120) || 'house-import.csv';
      const url = 'data:text/csv;charset=utf-8,' + encodeURIComponent(msg.csv || '');
      try {
        const id = await chrome.downloads.download({
          url: url, filename: safeName, saveAs: true
        });
        return sendResponse({ ok: !!id, downloadId: id });
      } catch (e) {
        return sendResponse({ ok: false, error: '下载失败：' + ((e && e.message) || String(e)) });
      }
    }

    // 测试连接：用当前输入框里的地址探后端，不必先保存、不必登录
    if (msg.type === 'HVT_TEST') {
      const cfgT = await getCfg();
      const testBase = safeBase(msg.base || cfgT.base);
      if (!testBase) {
        return sendResponse({ ok: false, error: '地址格式不对，请填完整地址，如 http://your-host:8787（不要带账号密码或查询参数）' });
      }
      try {
        const tr = await fetch(testBase + '/api/auth/captcha', { cache: 'no-store' });
        const tj = await tr.json().catch(function () { return {}; });
        if (!tr.ok) return sendResponse({ ok: false, error: '系统返回 HTTP ' + tr.status + (tj.error ? ('：' + tj.error) : '') });
        // F172：仅凭 2xx 不足以判定就是择隅系统，校验响应为非空 JSON 对象再记成功
        if (!tj || typeof tj !== 'object' || Array.isArray(tj) || !Object.keys(tj).length) {
          return sendResponse({ ok: false, error: '该地址返回的不是择隅系统接口数据，请确认地址是否正确' });
        }
        // 记住「这个地址测通过」，弹窗里第 3 步才能打勾；换地址时由 HVT_CONFIG 清掉
        await storeSet({ [KEY_CONN]: { base: testBase, at: Date.now() } });
        return sendResponse({ ok: true, base: testBase, msg: '连接成功，系统接口可访问' });
      } catch (e) {
        const tw = (e && e.message) || String(e);
        return sendResponse({ ok: false, error: '连不上：' + tw + '（检查地址是否正确、插件是否授权该地址、服务器是否启动）' });
      }
    }

    if (msg.type === 'HVT_PUSH') {
      const cfg = await getCfg();
      // F261/F262：凭证与目标地址只取存储配置，不接受消息覆盖；发送前严格校验 base
      const base = safeBase(cfg.base);
      if (!base) return sendResponse({ ok: false, error: '系统地址无效，请在面板重新保存地址' });
      const token = cfg.token;
      if (!token) return sendResponse({ ok: false, error: '还没有系统登录态：请先打开一次择隅系统页面，或在插件面板里手动填 token' });
      const p = await buildPayload();
      if (!p.hasMain) return sendResponse({ ok: false, error: '还没有采到房源数据' });
      let res;
      try {
        res = await fetch(base + '/api/properties/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify([p.row])
        });
      } catch (e) {
        const why = (e && e.message) || String(e);
        if (/Failed to fetch|NetworkError|Load failed/i.test(why)) {
          why += '（请确认：① 系统地址填对且服务器已启动；② 插件已授权该地址——在面板点「保存地址」并允许，或到 chrome://extensions 的站点访问权限里加上 ' + base + '）';
        }
        return sendResponse({ ok: false, error: '连不上系统：' + why });
      }
      let body = await res.json().catch(() => ({}));
      if (!body || typeof body !== 'object' || Array.isArray(body)) body = {}; // F045
      if (!res.ok) return sendResponse({ ok: false, error: body.error || ('HTTP ' + res.status) });
      return sendResponse({ ok: true, data: body.data, name: p.name });
    }

    if (msg.type === 'HVT_OPEN_SYSTEM') {
      const cfg = await getCfg();
      const base = safeBase(msg.base || cfg.base) || DEFAULT_BASE;
      chrome.tabs.create({ url: base + '/' });
      return sendResponse({ ok: true });
    }

    return sendResponse({ ok: false, error: '未知消息类型' });
  } catch (e) {
    return sendResponse({ ok: false, error: (e && e.message) || String(e) });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // F046：给 handle 的 promise 兜底 catch，避免 sendResponse 自身抛错成为未处理拒绝
  Promise.resolve(handle(msg, sender, sendResponse)).catch((e) => {
    try { sendResponse({ ok: false, error: (e && e.message) || String(e) }); } catch (_) { /* 通道已关闭 */ }
  });
  return true; // 保持异步响应通道
});

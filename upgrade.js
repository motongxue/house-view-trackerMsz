// ============================================================
// 择隅 · 一键自升级引擎（服务端）
// 职责：双源下载升级包 → 校验 → 备份 → 覆盖 → 重启；失败自动回滚。
// 设计要点：
//   1) 只接受本机管理员从 /api/upgrade/* 调用，权限由 server.js 把关；
//   2) 所有下载链接强制过 assertSafeUrl（DNS 解析拒绝内网），防 SSRF；
//   3) 状态写在 data/ 下（部署包不含 data/，覆盖升级不会冲掉），供前端轮询；
//   4) 依赖（fs / child_process / fetch / now）可注入，便于纯 Node 回归测试；
//   5) Linux + systemd 是目标环境；非 Linux 直接拒绝，不改动本机文件。
// ============================================================
'use strict';
const nodeFs = require('fs');
const nodePath = require('path');
const nodeCp = require('child_process');

const STATE_FILE = 'upgrade-state.json';
const BACKUP_DIR = 'upgrade-backups';
const MAX_PKG = 400 * 1024 * 1024;   // 单包上限 400MB，防下到假包把磁盘撑爆
const DOWNLOAD_TIMEOUT = 10 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;     // 超过 10 分钟的非终态视为卡死，允许重来

function cmpVersion(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map(Number);
  const pb = String(b || '').replace(/^v/i, '').split('.').map(Number);
  if (pa.some(isNaN) || pb.some(isNaN) || pa.length !== 3 || pb.length !== 3) {
    return String(a) === String(b) ? 0 : (String(a) > String(b) ? 1 : -1);
  }
  for (let i = 0; i < 3; i++) { if (pa[i] > pb[i]) return 1; if (pa[i] < pb[i]) return -1; }
  return 0;
}

// ---------- 版本文件多源获取（v1.8.3）----------
// 背景：raw.githubusercontent.com 在部分机房会间歇性 ETIMEDOUT，单源单次尝试＝整条链失败。
// 策略：多个源并发竞速（谁先成功用谁）＋ 单源超时 ＋ 全部失败回落本地缓存。
const VERSION_TIMEOUT = 8000;

// 由 GitHub raw 地址推导 jsDelivr 镜像（同一份仓库文件，国内通常更快更稳）。
function mirrorUrls(baseUrl) {
  const out = [];
  const u = String(baseUrl || '').trim();
  const m = u.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (m) {
    const owner = m[1], repo = m[2], branch = m[3], rest = m[4];
    out.push('https://fastly.jsdelivr.net/gh/' + owner + '/' + repo + '@' + branch + '/' + rest);
    out.push('https://cdn.jsdelivr.net/gh/' + owner + '/' + repo + '@' + branch + '/' + rest);
  }
  return out.filter((x) => x && x !== u);
}

// 候选地址：主地址 → 推导镜像 → 显式配置的镜像；去重保序。
function versionSources(baseUrl, extra) {
  const out = [];
  const push = (v) => { const s = String(v || '').trim(); if (s && out.indexOf(s) < 0) out.push(s); };
  push(baseUrl);
  mirrorUrls(baseUrl).forEach(push);
  if (Array.isArray(extra)) extra.forEach(push);
  return out;
}

// 竞速拉取 version.json。
// 返回 { data, source, cached, cachedAt, errors }；全失败且有缓存 → cached=true。
async function fetchVersionRace(opt) {
  const o = opt || {};
  const list = (o.sources || []).map((s) => String(s || '').trim()).filter(Boolean);
  const fetcher = o.fetch || ((...a) => global.fetch(...a));
  const timeoutMs = Number(o.timeoutMs) || VERSION_TIMEOUT;
  const fs = o.fs || nodeFs;
  const cacheFile = o.cacheFile || '';
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});
  if (!list.length) throw new Error('没有可用的版本文件地址');

  const errors = [];
  const ctrls = [];
  const hostOf = (u) => { try { return new URL(u).host; } catch (_) { return u; } };

  const attempt = (url) => new Promise((resolve, reject) => {
    const ctl = new AbortController();
    ctrls.push(ctl);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ctl.abort(); } catch (_) {}
      errors.push({ url, why: '超时 ' + Math.round(timeoutMs / 1000) + ' 秒' });
      reject(new Error('timeout'));
    }, timeoutMs);
    Promise.resolve()
      .then(() => fetcher(url, { signal: ctl.signal, cache: 'no-store' }))
      .then(async (r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!j || !j.version) throw new Error('版本文件缺少 version 字段');
        return j;
      })
      .then((j) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ url, data: j });
      })
      .catch((e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const why = e.name === 'AbortError'
          ? ('超时 ' + Math.round(timeoutMs / 1000) + ' 秒')
          : ((e.cause && (e.cause.code || e.cause.message)) || e.message || String(e));
        errors.push({ url, why });
        reject(new Error(why));
      });
  });

  const abortAll = () => { ctrls.forEach((c) => { try { c.abort(); } catch (_) {} }); };

  let win = null;
  try {
    win = await new Promise((resolve, reject) => {
      let left = list.length;
      list.forEach((u) => {
        attempt(u).then(resolve).catch(() => { if (--left === 0) reject(new Error('all-failed')); });
      });
    });
  } catch (_) { win = null; }
  abortAll();

  if (win) {
    // 成功即落盘：下次全部源都挂时用它顶上
    if (cacheFile) {
      try {
        fs.mkdirSync(nodePath.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ ts: now(), url: win.url, data: win.data }, null, 2));
      } catch (e) { log('[upgrade] 写版本缓存失败：' + e.message); }
    }
    if (errors.length) log('[upgrade] 部分版本源失败：' + errors.map((e) => hostOf(e.url) + '→' + e.why).join('；'));
    return { data: win.data, source: win.url, cached: false, cachedAt: 0, errors };
  }

  // 全部失败 → 缓存兜底（保证「检查更新」不会因为一次网络抖动就彻底不可用）
  if (cacheFile) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (c && c.data && c.data.version) {
        log('[upgrade] 版本源全部失败，改用本地缓存（' + (c.url || '') + '）');
        return { data: c.data, source: c.url || '', cached: true, cachedAt: Number(c.ts) || 0, errors };
      }
    } catch (_) {}
  }
  const detail = errors.map((e) => hostOf(e.url) + ' → ' + e.why).join('；');
  throw new Error('全部 ' + list.length + ' 个版本源均失败' + (detail ? '（' + detail + '）' : ''));
}

function createUpgrader(opt) {
  const o = opt || {};
  const fs = o.fs || nodeFs;
  const path = o.path || nodePath;
  const cp = o.cp || nodeCp;
  const fetcher = o.fetch || ((...a) => global.fetch(...a));
  const now = o.now || (() => Date.now());
  const assertSafeUrl = o.assertSafeUrl || (async () => {});
  const log = o.log || (() => {});
  // appDir：安装根目录（server.js 所在目录）；dataDir：数据目录（状态/备份写这里，升级包不含它）
  const appDir = o.appDir || nodePath.join(__dirname);
  const dataDir = o.dataDir || nodePath.join(appDir, 'data');
  const serviceName = o.serviceName || 'house-view-tracker';
  const statePath = path.join(dataDir, STATE_FILE);
  const backupRoot = path.join(dataDir, BACKUP_DIR);
  const versionCachePath = path.join(dataDir, 'version-cache.json');
  let running = false;

  // 供 server.js 调用：多源竞速拉版本文件，失败回落 data/version-cache.json
  async function fetchVersion(list, more) {
    const sources = Array.isArray(list) ? list : versionSources(o.updateUrl || '', list);
    return fetchVersionRace(Object.assign({
      sources, fetch: fetcher, fs, now, log, cacheFile: versionCachePath
    }, more || {}));
  }

  function readState() {
    try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
    catch (_) { return { phase: 'idle', ok: false, message: '', progress: 0, ts: 0 }; }
  }
  function writeState(patch) {
    const s = Object.assign(readState(), patch, { ts: now() });
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(statePath + '.tmp', JSON.stringify(s, null, 2));
      fs.renameSync(statePath + '.tmp', statePath);
    } catch (e) { log('[upgrade] 写状态失败：' + e.message); }
    return s;
  }
  function isTerminal(phase) { return phase === 'done' || phase === 'failed' || phase === 'idle'; }

  // 从配置解析下载候选地址：优先 downloadUrls 数组，兼容旧 downloadUrl；
  // 都没有时用 package + GitHub/Gitee release 兜底（release 不存在会 404，自然切下一个源）。
  function sources(info) {
    const out = [];
    const arr = Array.isArray(info && info.downloadUrls) ? info.downloadUrls : [];
    for (const u of arr) { const s = String(u || '').trim(); if (s && out.indexOf(s) < 0) out.push(s); }
    const one = String((info && info.downloadUrl) || '').trim();
    if (one && out.indexOf(one) < 0) out.push(one);
    const pkg = String((info && info.package) || '').trim();
    const tag = String((info && info.version) || '').trim();
    if (pkg && tag) {
      for (const base of [
        'https://gitee.com/motongxue/house-view-trackerMsz/releases/download/',
        'https://github.com/motongxue/house-view-trackerMsz/releases/download/'
      ]) {
        const u = base + tag + '/' + pkg;
        if (out.indexOf(u) < 0) out.push(u);
      }
    }
    return out;
  }

  // 下载单个 URL：流式写临时文件，带大小/超时保护；成功后返回文件路径。
  async function downloadOne(url, tmp) {
    await assertSafeUrl(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), DOWNLOAD_TIMEOUT);
    try {
      const r = await fetcher(url, { signal: ctl.signal, redirect: 'follow', cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = Number(r.headers && r.headers.get && r.headers.get('content-length')) || 0;
      if (total > MAX_PKG) throw new Error('升级包过大（' + Math.round(total / 1048576) + 'MB）');
      if (!r.body || !r.body.getReader) throw new Error('响应没有可读流');
      const reader = r.body.getReader();
      let got = 0, lastPct = -1;
      fs.writeFileSync(tmp, Buffer.alloc(0));
      const fd = fs.openSync(tmp, 'a');
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (got > MAX_PKG) throw new Error('升级包超过 ' + Math.round(MAX_PKG / 1048576) + 'MB 上限');
          fs.writeSync(fd, Buffer.from(value));
          const pct = total ? Math.min(95, Math.floor(got / total * 95)) : -1;
          if (pct >= 0 && pct !== lastPct) { lastPct = pct; writeState({ phase: 'downloading', progress: pct, message: '正在下载升级包 ' + pct + '%' }); }
        }
      } finally { fs.closeSync(fd); }
      if (got < 1024 * 512) { try { fs.unlinkSync(tmp); } catch (_) {} throw new Error('下载内容过小（' + got + ' 字节），可能不是有效升级包'); }
      if (total && got < total * 0.9) throw new Error('下载不完整（' + got + '/' + total + '）');
      return got;
    } finally { clearTimeout(timer); }
  }

  // 校验 tar：必须含 server.js 与 public/index.html，防止把错误页/木马包覆盖进去。
  async function verifyPkg(pkg) {
    if (process.platform === 'win32' && !o.cp) return true; // 本机回归用 mock cp
    const { stdout } = await new Promise((resolve, reject) => {
      cp.execFile('tar', ['-tzf', pkg], { maxBuffer: 32 * 1024 * 1024 }, (e, out) => e ? reject(new Error('升级包不是有效 tar.gz：' + e.message)) : resolve({ stdout: out || '' }));
    });
    const has = (s) => stdout.split('\n').some((l) => /(^|\/)house-view-tracker\//.test(l) && l.replace(/\\/g, '/').endsWith(s));
    if (!has('server.js') || !has('public/index.html')) throw new Error('升级包内容不完整（缺少 server.js 或 public/index.html）');
  }

  function run(cmd, args) {
    return new Promise((resolve, reject) => {
      cp.execFile(cmd, args, { cwd: appDir, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => {
        if (e) return reject(new Error((err || e.message || '').trim().slice(0, 400)));
        resolve(String(out || ''));
      });
    });
  }

  // 备份：除 data/（含备份自己）外的全部程序文件，打包到 data/upgrade-backups/。
  async function backup() {
    const stamp = new Date(now()).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const dir = path.join(backupRoot, stamp);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'program.tar.gz');
    await run('tar', ['-czf', file, '-C', appDir,
      '--exclude=./data', '--exclude=./uploads', '--exclude=./node_modules/.cache', '.']);
    if (!fs.existsSync(file) || fs.statSync(file).size < 1024) throw new Error('备份文件生成失败');
    return file;
  }

  async function restore(file) {
    if (!file || !fs.existsSync(file)) throw new Error('找不到可回滚的备份');
    await run('tar', ['-xzf', file, '-C', appDir]);
  }

  // 重启：延时 2 秒让 HTTP 响应先发出去；systemd 优先，否则 nohup start.sh。
  function scheduleRestart() {
    const cmd = 'sleep 2; if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ' + serviceName +
      ' 2>/dev/null; then systemctl restart ' + serviceName +
      '; else pkill -f "node server.js" 2>/dev/null || true; cd "' + appDir + '" && nohup ./start.sh >> run.log 2>&1 & fi';
    const child = cp.spawn('sh', ['-c', cmd], { detached: true, stdio: 'ignore', cwd: appDir });
    try { child.unref(); } catch (_) {}
    log('[upgrade] 已安排 2 秒后重启服务');
  }

  // 升级主流程（异步，不阻塞请求；状态全部落盘）。
  async function start(info, fromVersion) {
    if (running) throw new Error('已有升级任务正在进行');
    const st = readState();
    if (!isTerminal(st.phase) && now() - (st.ts || 0) < STALE_MS) throw new Error('上一次升级仍在进行中，请稍候');
    if (process.platform !== 'linux' && !o.allowNonLinux) throw new Error('一键升级仅支持 Linux 服务器；本机开发环境不会执行升级');
    const list = sources(info);
    if (!list.length) throw new Error('版本文件没有配置升级包地址（downloadUrls / downloadUrl）');
    running = true;
    const target = String(info.version || '').trim();
    try {
      writeState({ phase: 'downloading', ok: false, progress: 2, target, from: fromVersion, error: '', message: '准备下载升级包', backup: '' });
      const tmp = path.join(dataDir, '.hvt-upgrade-' + target.replace(/[^0-9A-Za-z.-]/g, '_') + '.tar.gz');
      let lastErr = null, size = 0;
      for (const url of list) {
        try { size = await downloadOne(url, tmp); lastErr = null; break; }
        catch (e) { lastErr = e; log('[upgrade] 下载源失败 ' + url + '：' + e.message); writeState({ message: '一个下载源失败，正在切换备用源…' }); }
      }
      if (lastErr) throw new Error('全部下载源均失败：' + lastErr.message);
      writeState({ phase: 'verifying', progress: 96, message: '正在校验升级包（' + Math.round(size / 1048576) + 'MB）' });
      await verifyPkg(tmp);
      writeState({ phase: 'backingup', progress: 97, message: '正在备份当前程序文件' });
      const backupFile = await backup();
      try {
        writeState({ phase: 'extracting', progress: 98, message: '正在覆盖程序文件', backup: backupFile });
        await run('tar', ['-xzf', tmp, '--strip-components=1', '-C', appDir]);
        writeState({ phase: 'restarting', progress: 100, ok: true, message: '升级完成，服务正在重启，请稍后刷新页面' });
        scheduleRestart();
      } catch (e) {
        // 覆盖失败 → 立刻用备份还原
        try { await restore(backupFile); } catch (e2) { log('[upgrade] 自动回滚失败：' + e2.message); }
        throw new Error('覆盖失败已回滚：' + e.message);
      }
      try { fs.unlinkSync(tmp); } catch (_) {}
      return { ok: true, target, size };
    } catch (e) {
      writeState({ phase: 'failed', ok: false, error: String(e.message || e), message: '升级失败：' + String(e.message || e) });
      throw e;
    } finally { running = false; }
  }

  async function rollback() {
    if (running) throw new Error('升级进行中，不能回滚');
    const st = readState();
    const backupFile = st.backup && fs.existsSync(st.backup) ? st.backup : null;
    if (!backupFile) {
      // 扫描已有备份，取最新一份
      try {
        const dirs = fs.readdirSync(backupRoot).filter((d) => /^\d{14}$/.test(d)).sort().reverse();
        for (const d of dirs) { const f = path.join(backupRoot, d, 'program.tar.gz'); if (fs.existsSync(f)) { backupFile = f; break; } }
      } catch (_) {}
    }
    if (!backupFile) throw new Error('没有找到可回滚的备份');
    writeState({ phase: 'backingup', ok: false, message: '正在回滚到升级前版本' });
    try {
      await restore(backupFile);
      writeState({ phase: 'restarting', ok: true, message: '回滚完成，服务正在重启' });
      scheduleRestart();
      return { ok: true };
    } catch (e) {
      writeState({ phase: 'failed', ok: false, error: String(e.message || e), message: '回滚失败：' + String(e.message || e) });
      throw e;
    }
  }

  // 服务重启后调用：若上次停在 restarting，说明进程已起来 = 升级成功，补写 done。
  function onBoot() {
    const st = readState();
    if (st.phase === 'restarting') writeState({ phase: 'done', ok: true, progress: 100, message: '升级完成（' + (st.target || '') + '）' });
  }

  return { readState, writeState, sources, cmpVersion, start, rollback, onBoot, statePath, backupRoot,
    fetchVersion, versionSources, versionCachePath,
    _internal: { downloadOne, verifyPkg, backup, restore, scheduleRestart } };
}

module.exports = { createUpgrader, cmpVersion, STATE_FILE, BACKUP_DIR,
  mirrorUrls, versionSources, fetchVersionRace, VERSION_TIMEOUT };

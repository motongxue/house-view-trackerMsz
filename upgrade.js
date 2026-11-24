// ============================================================
// 择隅 · 一键自升级引擎（服务端）
// 职责：双源下载升级包 → 校验 → 备份 → 覆盖 → 重启；失败自动回滚。
// 设计要点：
//   1) 只接受本机管理员从 /api/upgrade/* 调用，权限由 server.js 把关；
//   2) 所有下载链接强制过 assertSafeUrl（DNS 解析拒绝内网），防 SSRF；
//   3) 状态写在 data/ 下（部署包不含 data/，覆盖升级不会冲掉），供前端轮询；
//   4) 依赖（fs / child_process / fetch / now）可注入，便于纯 Node 回归测试；
//   5) Linux + systemd 是目标环境；非 Linux 直接拒绝，不改动本机文件。
//   6) v2.0.0：Ed25519 验签。信任根放 data/trust/pubkey.pem（升级包从不含 data/），
//      首次安装时从程序目录的 trust/pubkey.pem 复制一次；已存在则永不覆盖。
//      签名覆盖版本/包/hash/下载源，私钥只在发布者本机，仓库被攻陷也无法签发合法包。
// ============================================================
'use strict';
const nodeFs = require('fs');
const nodePath = require('path');
const nodeCp = require('child_process');
const nodeCrypto = require('crypto');

// 与 scripts/sign-release.js 保持逐字一致；改这里必须同步改那边，否则验签永远失败。
function signedPayload(info) {
  return JSON.stringify({
    version: String((info && info.version) || ''),
    package: String((info && info.package) || ''),
    packageSha256: String((info && info.packageSha256) || ''),
    downloadUrls: Array.isArray(info && info.downloadUrls) ? info.downloadUrls.map((x) => String(x)) : [],
    title: String((info && info.title) || ''),
    items: Array.isArray(info && info.items) ? info.items.map((x) => String(x)) : [],
    notes: String((info && info.notes) || ''),
    date: String((info && info.date) || '')
  });
}

const STATE_FILE = 'upgrade-state.json';
const BACKUP_DIR = 'upgrade-backups';
const MAX_PKG = 400 * 1024 * 1024;   // 单包上限 400MB，防下到假包把磁盘撑爆
const DOWNLOAD_TIMEOUT = 10 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;     // 超过 10 分钟的非终态视为卡死，允许重来

// 部署相关标识：硬编码值仅作默认，fork / 私有化部署请用配置或环境覆盖，
// 否则会静默从上游仓库下载不属于本部署的升级包。
// 下载源白名单：只允许 HTTPS + 已知发布域名。HVT_RELEASE_HOSTS 可追加自建域名（逗号分隔），
// 不接受版本文件自带的任意域名——否则攻陷仓库就能把升级指向任意服务器。
function allowedHosts() {
  const base = ['gitee.com', 'github.com', 'raw.githubusercontent.com', 'cdn.jsdelivr.net', 'fastly.jsdelivr.net'];
  const extra = String(process.env.HVT_RELEASE_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return base.concat(extra.filter((h) => base.indexOf(h) < 0));
}
function isAllowedSource(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'https:') return false;
    const host = x.hostname.toLowerCase();
    if (allowedHosts().indexOf(host) >= 0) return true;
    // gitee / github 的 releases 下载会 302 到 objects.githubusercontent.com 等 CDN，
    // 但初始 URL 必须是白名单域名；重定向由 fetchSafe 逐跳 assertSafeUrl 管。
    return false;
  } catch (_) { return false; }
}

function defaultReleaseBases() {
  if (process.env.HVT_RELEASE_BASES) {
    const arr = String(process.env.HVT_RELEASE_BASES).split(',').map((s) => s.trim()).filter(Boolean);
    if (arr.length) return arr;
  }
  return [
    'https://gitee.com/motongxue/house-view-trackerMsz/releases/download/',
    'https://github.com/motongxue/house-view-trackerMsz/releases/download/'
  ];
}

function cmpVersion(a, b) {
  // 允许 1~3 段（如 1.10 / v2），缺失段补 0 后逐段数值比较：
  // 不能退回字典序，否则 '1.10' < '1.9'、'10.0.0' < '9.0.0'，多源竞速会选到旧快照。
  const parse = (v) => {
    const parts = String(v || '').trim().replace(/^v/i, '').split('.').map((x) => Number(x));
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
  };
  const pa = parse(a), pb = parse(b);
  if (pa.some(isNaN) || pb.some(isNaN)) {
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
  // v2.0.0：逐源验签。必须在「挑最高版本」之前做，否则被投毒的镜像报一个更高版本号就能胜出。
  const verify = typeof o.verify === 'function' ? o.verify : null;
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
        if (verify) {
          const vr = verify(j);
          if (!vr || !vr.ok) throw new Error((vr && vr.why) || '版本文件签名校验失败');
        }
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
  // v1.8.6：并发请求 + 取「版本号最大」的那份，而不是「谁先回用谁」（原先 Promise.race 的写法）。
  //   原因：镜像 CDN 会把分支别名（@main）缓存住，推新版本后仍返回旧提交里的版本号；
  //   若按"最快"取胜，快的旧缓存会盖掉慢但正确的主源——结果就是「明明有新版本却提示已是最新」。
  //   策略：首个成功后仍留 GRACE 毫秒收尾（让同样快的源把结果交上来），再按语义化版本取最高。
  const GRACE_MS = 1200;
  const settled = [];
  let closed = false;
  let remaining = list.length;
  let graceTimer = null;
  let resolveAll;
  const allDone = new Promise((r) => { resolveAll = r; });
  const finish = () => { if (!closed) { closed = true; resolveAll(); } };

  const pending = [];
  list.forEach((u) => {
    pending.push(attempt(u)
      .then((v) => {
        if (!closed) settled.push(v);
        if (!graceTimer) graceTimer = setTimeout(finish, GRACE_MS);
      })
      .catch(() => {})
      .finally(() => {
        remaining -= 1;
        if (remaining === 0) finish();
      }));
  });

  // 保存外层超时句柄，避免 race 已经分出胜负后定时器仍挂在事件循环上；
  // abortAll() 后等待所有尝试结算，否则被 abort 的请求会在函数返回后才把错误 push 进 errors。
  let outerTimer = null;
  await Promise.race([allDone, new Promise((r) => { outerTimer = setTimeout(r, timeoutMs + 200); })]);
  finish();
  if (outerTimer) clearTimeout(outerTimer);
  if (graceTimer) clearTimeout(graceTimer);
  abortAll();
  await Promise.allSettled(pending);

  if (settled.length) {
    win = settled.reduce((a, b) => (cmpVersion(b.data.version, a.data.version) > 0 ? b : a));
    if (settled.length > 1) {
      const sig = settled.map((x) => hostOf(x.url) + '=' + x.data.version).join('，');
      log('[upgrade] 多源版本不一致，已取最高：' + sig);
    }
  }

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
  const serviceName = o.serviceName || process.env.HVT_SERVICE_NAME || 'house-view-tracker';
  const statePath = path.join(dataDir, STATE_FILE);
  const backupRoot = path.join(dataDir, BACKUP_DIR);
  const versionCachePath = path.join(dataDir, 'version-cache.json');
  // 信任根：data/trust/pubkey.pem。升级包解包到 appDir 且从不含 data/，所以这里不会被覆盖。
  const trustDir = path.join(dataDir, 'trust');
  const pubkeyPath = path.join(trustDir, 'pubkey.pem');
  let running = false;

  // 首次启动：从程序包的 trust/pubkey.pem 复制一次到 data/trust/。
  // 已有则绝不覆盖——这是整个验签体系的根，覆盖等于把锁和钥匙一起交给攻击者。
  function initTrust() {
    try {
      if (fs.existsSync(pubkeyPath)) return { ok: true, from: 'data', note: '已有信任根，保持不变' };
      const bundled = path.join(appDir, 'trust', 'pubkey.pem');
      if (!fs.existsSync(bundled)) return { ok: false, note: '程序包内没有 trust/pubkey.pem，验签不可用' };
      fs.mkdirSync(trustDir, { recursive: true, mode: 0o700 });
      fs.copyFileSync(bundled, pubkeyPath, fs.constants.COPYFILE_EXCL);
      try { fs.chmodSync(pubkeyPath, 0o600); } catch (_) {}
      log('[upgrade] 已初始化信任根：' + pubkeyPath);
      return { ok: true, from: 'bundle', note: '已从程序包复制信任根' };
    } catch (e) {
      return { ok: false, note: '初始化信任根失败：' + e.message };
    }
  }

  // 验签：从 data/trust/pubkey.pem 读公钥；验不过一律拒绝，不看 packageSha256 是否有值。
  // fail-closed：公钥缺失/损坏/签名无效，全部视为不可用。
  function verifySignature(info) {
    if (!info || typeof info !== 'object') return { ok: false, why: '版本文件内容无效' };
    const sig = String(info.signature || '').trim();
    if (!sig) return { ok: false, why: '版本文件缺少签名（signature），拒绝升级' };
    if (!/^[A-Za-z0-9+/=]{40,}$/.test(sig)) return { ok: false, why: '签名格式非法' };
    // 懒初始化：check 接口在启动后随时可能被调，不能依赖 start() 才去建信任根。
    if (!fs.existsSync(pubkeyPath)) initTrust();
    let pem;
    try { pem = fs.readFileSync(pubkeyPath, 'utf8'); }
    catch (e) { return { ok: false, why: '读取信任根失败：' + e.message + '（请确认程序包内含 trust/pubkey.pem）' }; }
    try {
      const ok = nodeCrypto.verify(null, Buffer.from(signedPayload(info), 'utf8'),
        pem, Buffer.from(sig, 'base64'));
      return ok ? { ok: true } : { ok: false, why: '版本文件签名不匹配——包或版本文件可能被篡改，拒绝升级' };
    } catch (e) {
      return { ok: false, why: '验签失败：' + e.message };
    }
  }

  // 供 server.js 调用：多源竞速拉版本文件，失败回落 data/version-cache.json
  async function fetchVersion(list, more) {
    const sources = Array.isArray(list) ? list : versionSources(o.updateUrl || '', list);
    return fetchVersionRace(Object.assign({
      sources, fetch: fetcher, fs, now, log, cacheFile: versionCachePath,
      verify: verifySignature   // v2.0.0：逐源验签，未签名/签名不符的源直接判失败
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
      const bases = (Array.isArray(o.releaseBases) && o.releaseBases.length)
        ? o.releaseBases.map((b) => String(b || '').trim()).filter(Boolean)
        : defaultReleaseBases();
      for (const base of bases) {
        const u = base + tag + '/' + pkg;
        if (out.indexOf(u) < 0) out.push(u);
      }
    }
    return out;
  }

  // SSRF：redirect:'follow' 会跟随 302 到 127.0.0.1 / 169.254.x.x 而绕过初始校验。
  // 改为 manual 后逐跳重新 assertSafeUrl，并限制跳数；相对 Location 按当前 URL 解析。
  const MAX_DOWNLOAD_REDIRECTS = 5;
  async function fetchSafe(url, init) {
    let cur = url;
    for (let hop = 0; hop <= MAX_DOWNLOAD_REDIRECTS; hop++) {
      await assertSafeUrl(cur);
      const r = await fetcher(cur, Object.assign({}, init, { redirect: 'manual' }));
      const loc = r.headers && r.headers.get && r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) {
        if (hop === MAX_DOWNLOAD_REDIRECTS) throw new Error('升级包下载重定向次数过多');
        cur = new URL(loc, cur).toString();
        continue;
      }
      return r;
    }
    throw new Error('升级包下载重定向次数过多');
  }

  // 下载单个 URL：流式写临时文件，带大小/超时保护；边下边算 sha256，返回 { size, sha256 }。
  // 边下边算是为了不给 400MB 的上限再造一次全量读盘（多花几百毫秒、多一次 IO）。
  async function downloadOne(url, tmp) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), DOWNLOAD_TIMEOUT);
    try {
      const r = await fetchSafe(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = Number(r.headers && r.headers.get && r.headers.get('content-length')) || 0;
      if (total > MAX_PKG) throw new Error('升级包过大（' + Math.round(total / 1048576) + 'MB）');
      if (!r.body || !r.body.getReader) throw new Error('响应没有可读流');
      const reader = r.body.getReader();
      const hash = nodeCrypto.createHash('sha256');
      let got = 0, lastPct = -1, lastWriteAt = 0;
      fs.writeFileSync(tmp, Buffer.alloc(0));
      const fd = fs.openSync(tmp, 'a');
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (got > MAX_PKG) throw new Error('升级包超过 ' + Math.round(MAX_PKG / 1048576) + 'MB 上限');
          const buf = Buffer.from(value);
          hash.update(buf);
          fs.writeSync(fd, buf);
          const pct = total ? Math.min(95, Math.floor(got / total * 95)) : -1;
          // 节流：writeState 是同步 read+mkdir+write+rename，不能每个 1% 都落盘阻塞事件循环。
          // 至少间隔 500ms、或跨过 5% 台阶（以及 95% 收尾）才写一次。
          const t = now();
          if (pct >= 0 && pct !== lastPct && (t - lastWriteAt >= 500 || pct - lastPct >= 5 || pct === 95)) {
            lastPct = pct; lastWriteAt = t;
            writeState({ phase: 'downloading', progress: pct, message: '正在下载升级包 ' + pct + '%' });
          }
        }
      } finally { fs.closeSync(fd); }
      if (got < 1024 * 512) throw new Error('下载内容过小（' + got + ' 字节），可能不是有效升级包');
      if (total && got < total * 0.9) throw new Error('下载不完整（' + got + '/' + total + '）');
      return { size: got, sha256: hash.digest('hex').toLowerCase() };
    } finally { clearTimeout(timer); }
  }

  // 完整性校验：只比对 version.json 里声明的 sha256。
  // 防的是「下载链路被篡改 / 传输出错 / 镜像返回了错文件」，不是防「仓库本身被攻陷」——
  // 后者要靠对 version.json 做签名（私钥在发布者手上），hash 写在同一个文件里挡不住。
  function checkSha256(actual, expected) {
    const want = String(expected || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) return { skipped: true };
    if (String(actual || '').toLowerCase() !== want) {
      throw new Error('升级包完整性校验失败（sha256 不符，文件可能被篡改或传输出错）：期望 ' + want.slice(0, 16) + '…，实际 ' + String(actual || '').slice(0, 16) + '…');
    }
    return { skipped: false };
  }

  // 校验 tar：必须含 server.js 与 public/index.html，防止把错误页/木马包覆盖进去；
  // 同时消毒条目名（拒绝 ../、绝对路径、符号链接），防止篡改包借解包越界写文件。
  async function verifyPkg(pkg) {
    if (process.platform === 'win32' && !o.cp) return true; // 本机回归用 mock cp
    const { stdout } = await new Promise((resolve, reject) => {
      cp.execFile('tar', ['-tvzf', pkg], { maxBuffer: 32 * 1024 * 1024 }, (e, out) => e ? reject(new Error('升级包不是有效 tar.gz：' + e.message)) : resolve({ stdout: out || '' }));
    });
    const names = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      // -tvzf 行首是类型字符：l=符号链接、h=硬链接，两种都必须拒绝。
      // 硬链接可以指向包外已有文件，借解包越界写 data/ 或凭据文件。
      if (/^[lh][rwxstST-]{9}/.test(line)) throw new Error('升级包包含符号链接或硬链接，已拒绝');
      const mm = line.match(/\s\d{2}:\d{2}\s+(.+)$/); // verbose 输出「时:分」之后才是文件名
      const name = (mm ? mm[1] : line).trim().replace(/\\/g, '/'); // mock cp 的纯名字列表同样兼容
      if (!name) continue;
      if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').indexOf('..') >= 0) {
        throw new Error('升级包包含非法路径条目，已拒绝：' + name.slice(0, 200));
      }
      // data/ 是运行时数据（含信任根 pubkey.pem、备份、上传），升级包绝不允许携带，
      // 否则一次"合法签名但打包含错"的发版就能把信任根换成攻击者密钥。
      const rel = name.replace(/^[^/]+\//, '');
      if (/^data\//i.test(rel)) throw new Error('升级包包含 data/ 目录内容，已拒绝：' + name.slice(0, 200));
      names.push(name);
    }
    const has = (s) => names.some((n) => /(^|\/)house-view-tracker\//.test(n) && n.endsWith(s));
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

  // 重启：延时 2 秒让 HTTP 响应先发出去；systemd 优先，否则走部署包自带的 restart.sh。
  // 不再用 sh -c 拼字符串：serviceName / appDir 只要含 shell 元字符就可能命令注入。
  function scheduleRestart() {
    const safeService = /^[A-Za-z0-9_.-]+$/.test(serviceName) ? serviceName : 'house-view-tracker';
    const script = path.join(appDir, 'restart.sh');
    // 参数作为独立 argv 传入，不拼进 shell 字符串；脚本内部做 2 秒延时与启动方式判断。
    const child = cp.spawn('sh', [script, safeService],
      { detached: true, stdio: 'ignore', cwd: appDir });
    child.on('error', (e) => log('[upgrade] 重启脚本启动失败：' + e.message));
    try { child.unref(); } catch (_) {}
    log('[upgrade] 已安排重启服务（' + script + '）');
  }

  // 升级主流程（异步，不阻塞请求；状态全部落盘）。
  async function start(info, fromVersion) {
    if (running) throw new Error('已有升级任务正在进行');
    const st = readState();
    if (!isTerminal(st.phase) && now() - (st.ts || 0) < STALE_MS) throw new Error('上一次升级仍在进行中，请稍候');
    if (process.platform !== 'linux' && !o.allowNonLinux) throw new Error('一键升级仅支持 Linux 服务器；本机开发环境不会执行升级');

    // === 第一道门：验签。任何升级动作都必须先过，和 check 是否验过无关（防绕过）。===
    const trust = initTrust();
    if (!trust.ok) throw new Error('信任根不可用：' + trust.note + '，拒绝升级');
    const vr = verifySignature(info);
    if (!vr.ok) throw new Error(vr.why);

    const list = sources(info);
    if (!list.length) throw new Error('版本文件没有配置升级包地址（downloadUrls / downloadUrl）');
    // === 第二道门：下载源白名单。只认 HTTPS + 已知发布域名，版本文件自带什么就用什么的时代结束。===
    const bad = list.filter((u) => !isAllowedSource(u));
    if (bad.length) throw new Error('升级包含非法下载源（只允许 HTTPS + 已知发布域名）：' + bad[0].slice(0, 160));

    // === 第三道门：sha256 必须有，缺了不再"跳过"。===
    const wantSha = String((info && info.packageSha256) || '').trim();
    if (!/^[0-9a-f]{64}$/i.test(wantSha)) throw new Error('版本文件未提供合法的 packageSha256，拒绝升级');

    running = true;
    const target = String(info.version || '').trim();
    let tmp = '';
    try {
      writeState({ phase: 'downloading', ok: false, progress: 2, target, from: fromVersion, error: '', message: '准备下载升级包', backup: '', op: 'upgrade' });
      tmp = path.join(dataDir, '.hvt-upgrade-' + target.replace(/[^0-9A-Za-z.-]/g, '_') + '.tar.gz');
      let lastErr = null, size = 0;
      // 完整性校验放在「每个下载源之后」而不是全部下完再统一做：主源镜像同步到一半时是坏包，
      // 这时应该直接切备用源，而不是整轮失败。wantSha 已在入口处校验过存在性。
      for (const url of list) {
        try {
          const got = await downloadOne(url, tmp);
          checkSha256(got.sha256, wantSha); // 不符会抛错，走 catch 切下一个源
          size = got.size; lastErr = null; break;
        } catch (e) {
          lastErr = e; log('[upgrade] 下载源失败 ' + url + '：' + e.message); writeState({ message: '一个下载源失败，正在切换备用源…' });
        }
      }
      if (lastErr) throw new Error('全部下载源均失败：' + lastErr.message);
      writeState({ phase: 'verifying', progress: 96, message: '正在校验升级包（' + Math.round(size / 1048576) + 'MB）' });
      await verifyPkg(tmp);
      writeState({ phase: 'backingup', progress: 97, message: '正在备份当前程序文件' });
      const backupFile = await backup();
      try {
        writeState({ phase: 'extracting', progress: 98, message: '正在覆盖程序文件', backup: backupFile });
        await run('tar', ['-xzf', tmp, '--strip-components=1', '--no-same-owner', '-C', appDir]);
        writeState({ phase: 'restarting', progress: 100, ok: true, op: 'upgrade', message: '升级完成，服务正在重启，请稍后刷新页面' });
        scheduleRestart();
      } catch (e) {
        // 覆盖失败 → 立刻用备份还原
        try { await restore(backupFile); } catch (e2) { log('[upgrade] 自动回滚失败：' + e2.message); }
        throw new Error('覆盖失败已回滚：' + e.message);
      }
      return { ok: true, target, size };
    } catch (e) {
      writeState({ phase: 'failed', ok: false, error: String(e.message || e), message: '升级失败：' + String(e.message || e) });
      throw e;
    } finally {
      // 统一清理临时包：校验失败、备份失败、全部源失败等路径都不能把 .hvt-upgrade-*.tar.gz 留在 data/
      if (tmp) { try { fs.unlinkSync(tmp); } catch (_) {} }
      running = false;
    }
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
      writeState({ phase: 'restarting', ok: true, op: 'rollback', message: '回滚完成，服务正在重启' });
      scheduleRestart();
      return { ok: true };
    } catch (e) {
      writeState({ phase: 'failed', ok: false, error: String(e.message || e), message: '回滚失败：' + String(e.message || e) });
      throw e;
    }
  }

  // 服务重启后调用：若上次停在 restarting，说明进程已起来，补写 done。
  // 必须按 op 区分 upgrade / rollback，否则回滚也会被前端当成「升级成功」。
  function onBoot() {
    const st = readState();
    if (st.phase === 'restarting') {
      const message = st.op === 'rollback'
        ? '回滚完成（已恢复到升级前版本）'
        : '升级完成（' + (st.target || '') + '）';
      writeState({ phase: 'done', ok: true, progress: 100, op: '', message });
    }
  }

  return { readState, writeState, sources, cmpVersion, start, rollback, onBoot, statePath, backupRoot,
    fetchVersion, versionSources, versionCachePath,
    _internal: { downloadOne, verifyPkg, checkSha256, backup, restore, scheduleRestart,
      initTrust, verifySignature, isAllowedSource, signedPayload, trustDir, pubkeyPath } };
}

module.exports = { createUpgrader, cmpVersion, STATE_FILE, BACKUP_DIR,
  mirrorUrls, versionSources, fetchVersionRace, VERSION_TIMEOUT };

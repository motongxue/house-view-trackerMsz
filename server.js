// ============================================================
// 看房记录工具 —— 本地后端服务
// 职责：
//   1) 托管 public/ 下的前端静态文件
//   2) 提供 REST 接口（认证 + 房源 CRUD），数据库用本地 PostgreSQL
//   3) 启动时自动建表（CREATE TABLE IF NOT EXISTS），无需手动初始化
// 数据存储：PostgreSQL（house_view 库），全部落在本地，不联网、不上传。
// 设计要点：数据按 owner_id 隔离（每个登录用户只看自己的数据）。
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const tls = require('tls');
const { Pool } = require('pg');
const dbConfig = require('./config/db');

// [诊断] 全局崩溃兜底：任意未捕获异常/拒绝都先打印，避免进程直接退出导致所有连接被重置（ERR_CONNECTION_RESET）
process.on('uncaughtException', (e) => { console.error('[FATAL uncaughtException]', e && e.stack || e); });
process.on('unhandledRejection', (e) => { console.error('[FATAL unhandledRejection]', e && e.stack || e); });

const PORT = process.env.PORT || 8787;
const ROOT = path.join(__dirname, 'public');

const pool = new Pool(dbConfig);

// ---------- 安全响应头 ----------
// 统一在 API / 静态资源 / 上传响应上附加；媒体文件再叠加更严格的独立 CSP。
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  // 说明：仅放行高德官方域（amap.com / autonavi.com，同一家），不放通配 *；
  // worker-src blob: 是高德 JS API 2.0 矢量渲染必需的 Web Worker 来源，缺了地图会白屏。
  // 'unsafe-eval' 是高德 JS API 2.0 的硬性要求：它内部用 eval / new Function 动态注册
  // WebGLRender 等模块，缺了会抛 EvalError 并导致 "U.Module.WebGLRender is not a constructor"、
  // 地图彻底无法渲染。这是已知权衡，补偿措施：脚本来源仍严格限定 self + 高德官方域，
  // connect-src / object-src / frame-src / base-uri 保持收紧，用户可控文本一律 escHtml 转义。
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://webapi.amap.com https://*.amap.com https://*.autonavi.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    // http: 仅兜底本地 http 开发时高德个别图标/瓦片走明文；HTTPS 部署下浏览器会自行拦截混合内容
    "img-src 'self' data: blob: https: http:; media-src 'self' https:; font-src 'self' data: https:; " +
    "connect-src 'self' https://webapi.amap.com https://restapi.amap.com https://*.amap.com https://*.autonavi.com; " +
    "worker-src 'self' blob:; " +
    "frame-src 'none'; object-src 'none'; base-uri 'self'"
};
function head(res, code, extra, isMedia) {
  const h = Object.assign({}, SECURITY_HEADERS, extra || {});
  if (isMedia) {
    // 媒体文件：禁止任何脚本/子资源执行，防止上传 SVG/HTML 造成存储型 XSS
    h['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'self'";
  }
  res.writeHead(code, h);
}

// ---------- 登录限流（按客户端 IP，内存计数）----------
const loginFails = new Map(); // ip -> { count, first }
const LOGIN_MAX = 10;
const LOGIN_WINDOW = 15 * 60 * 1000;
function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function loginLimited(ip) {
  const e = loginFails.get(ip);
  if (!e) return false;
  if (Date.now() - e.first > LOGIN_WINDOW) { loginFails.delete(ip); return false; }
  return e.count >= LOGIN_MAX;
}
function loginFail(ip) {
  const e = loginFails.get(ip) || { count: 0, first: Date.now() };
  e.count++; e.first = e.first || Date.now();
  loginFails.set(ip, e);
}
function loginFailCount(ip) {
  const e = loginFails.get(ip);
  if (!e || Date.now() - e.first > LOGIN_WINDOW) return 0;
  return e.count;
}
function loginOk(ip) { loginFails.delete(ip); }
// 密码登录默认不打扰用户；同一 IP 连续失败达到该次数后才要求图形验证（渐进式防刷）
const CAPTCHA_AFTER_FAILS = 2;

// ---------- 登录 / 注册验证码：表单内联「点选数字」（图形算式 + 服务端一次性校验）----------
// 选型说明：纯 Node 内置模块即可实现，不需要 canvas / 图片库 / 第三方服务；
// 挑战由服务端签发，答案只留在服务端内存，前端拿到的 6 个选项不带任何「正确答案」标记。
const captchaStore = new Map(); // id -> { answer, exp, used }
const CAPTCHA_TTL = 5 * 60 * 1000;
function cleanCaptchas() {
  const now = Date.now();
  for (const [k, v] of captchaStore) if (v.used || v.exp < now) captchaStore.delete(k);
  if (captchaStore.size > 500) { // 兜底：防止被恶意刷挑战撑爆内存
    const it = captchaStore.keys();
    while (captchaStore.size > 500) { const k = it.next().value; if (!k) break; captchaStore.delete(k); }
  }
}
function newCaptcha() {
  cleanCaptchas();
  const op = Math.random() < 0.6 ? '+' : '-';
  let a = 2 + Math.floor(Math.random() * 9);   // 2..10
  let b = 1 + Math.floor(Math.random() * 9);   // 1..9
  if (op === '-' && b > a) { const t = a; a = b; b = t; } // 保证结果非负
  const answer = op === '+' ? a + b : a - b;
  const opts = new Set([answer]);
  while (opts.size < 6) {
    const v = answer + Math.floor(Math.random() * 13) - 6;
    if (v >= 0) opts.add(v);
  }
  const options = Array.from(opts).sort(() => Math.random() - 0.5);
  const id = crypto.randomBytes(16).toString('hex');
  captchaStore.set(id, { answer, exp: Date.now() + CAPTCHA_TTL, used: false });
  return { id, a, b, op, options };
}
function verifyCaptcha(id, answer) {
  const e = captchaStore.get(String(id || ''));
  if (!e || e.used || e.exp < Date.now()) return false;
  e.used = true; // 一次性：答错也作废，防止对同一挑战枚举 6 个选项
  return String(answer) === String(e.answer);
}

// ---------- SSRF 防护（extract 抓链家等外部链接时）----------
function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true; // 解析失败按危险处理
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;            // 链路本地（云元数据 169.254.169.254）
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 0) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  const l = ip.toLowerCase();
  // IPv4-mapped IPv6（如 ::ffff:127.0.0.1）必须拆出 IPv4 再判断，否则会被当成公网 IPv6 放行
  if (l.startsWith('::ffff:')) {
    const v4 = l.slice(7);
    return net.isIPv4(v4) ? isPrivateIp(v4) : true;
  }
  if (l === '::1' || l === '::' || l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd')) return true;
  return false;
}
async function assertSafeUrl(target) {
  let u;
  try { u = new URL(target); } catch { throw new Error('链接格式不正确'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https 链接');
  // 注意：必须用 dns.promises.lookup（回调版漏 callback 会对所有链接抛错，导致整条抓取链路失效）
  const addrs = await dns.promises.lookup(u.hostname, { all: true });
  for (const a of addrs) { if (isPrivateIp(a.address)) throw new Error('该链接指向内网/受限地址，已拒绝'); }
  return u;
}

// ---------- 表结构（与云端 Postgres 一致，便于以后切换）----------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  title text,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  media jsonb NOT NULL DEFAULT '{}'::jsonb,
  transaction jsonb NOT NULL DEFAULT '{}'::jsonb,
  facilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  geo jsonb,
  notes text
);
CREATE INDEX IF NOT EXISTS properties_owner_idx ON properties(owner_id);
CREATE INDEX IF NOT EXISTS properties_created_idx ON properties(created_at DESC);
`;

// ---------- 示例数据（一键导入测试用，写入当前登录用户名下）----------
const SEED_SAMPLE_DATA = [
  {
    title: '滨江和城',
    location: { city: '成都', district: '天府新区', community: '滨江和城', address: '华阳街道滨河路一段' },
    attributes: { layout: '3室2厅2卫', area: 89, orientation: '南', floor: '中楼层 / 总33层' },
    media: { images: [], videos: [] },
    transaction: { totalPrice: 168, unitPrice: 18876, agentName: '链家·王经理', agentPhone: '13800001111' },
    facilities: { transport: true, supermarket: true, school: true, hospital: false, water: true, electricity: true, gas: true, notes: '近地铁1号线华阳站约800米' },
    geo: { lng: 104.0653, lat: 30.4245, source: 'sample' },
    notes: '看房感受：户型方正、采光好，小区环境不错；缺点是离主城较远、通勤偏长。'
  },
  {
    title: '中海天府里',
    location: { city: '成都', district: '高新区', community: '中海天府里', address: '天府三街益州大道' },
    attributes: { layout: '4室2厅2卫', area: 128, orientation: '东南', floor: '高楼层 / 总40层' },
    media: { images: [], videos: [] },
    transaction: { totalPrice: 320, unitPrice: 25000, agentName: '贝壳·李经理', agentPhone: '13800002222' },
    facilities: { transport: true, supermarket: true, school: true, hospital: true, water: true, electricity: true, gas: true, notes: '近地铁1号线天府三街站' },
    geo: { lng: 104.0612, lat: 30.5412, source: 'sample' },
    notes: '看房感受：楼龄新、物业好，周边写字楼多；总价偏高。'
  },
  {
    title: '桐梓林壹号',
    location: { city: '成都', district: '武侯区', community: '桐梓林壹号', address: '人民南路四段' },
    attributes: { layout: '2室2厅1卫', area: 78, orientation: '南', floor: '低楼层 / 总18层' },
    media: { images: [], videos: [] },
    transaction: { totalPrice: 145, unitPrice: 18590, agentName: '我爱我家·陈经理', agentPhone: '13800003333' },
    facilities: { transport: true, supermarket: true, school: false, hospital: true, water: true, electricity: true, gas: true, notes: '近地铁1号线桐梓林站' },
    geo: { lng: 104.0832, lat: 30.6205, source: 'sample' },
    notes: '看房感受：地段成熟、生活便利，但房龄偏老、户型偏小。'
  },
  {
    title: 'ICC天曜',
    location: { city: '成都', district: '锦江区', community: 'ICC天曜', address: '东大街芷泉街' },
    attributes: { layout: '3室2厅2卫', area: 110, orientation: '南北', floor: '中楼层 / 总32层' },
    media: { images: [], videos: [] },
    transaction: { totalPrice: 360, unitPrice: 32727, agentName: '中原·张经理', agentPhone: '13800004444' },
    facilities: { transport: true, supermarket: true, school: true, hospital: true, water: true, electricity: true, gas: true, notes: '近地铁2/8号线东门大桥站' },
    geo: { lng: 104.0815, lat: 30.6568, source: 'sample' },
    notes: '看房感受：核心区、配套顶级，单价高；适合预算充足的改善需求。'
  },
  {
    title: '招商雍璟府',
    location: { city: '成都', district: '成华区', community: '招商雍璟府', address: '建设路SM广场旁' },
    attributes: { layout: '4室2厅2卫', area: 143, orientation: '南', floor: '中楼层 / 总26层' },
    media: { images: [], videos: [] },
    transaction: { totalPrice: 280, unitPrice: 19580, agentName: '链家·刘经理', agentPhone: '13800005555' },
    facilities: { transport: true, supermarket: true, school: true, hospital: false, water: true, electricity: true, gas: true, notes: '近地铁8号线杉板桥站' },
    geo: { lng: 104.1012, lat: 30.6705, source: 'sample' },
    notes: '看房感受：性价比不错、空间大，周边商业齐全；医院配套稍弱。'
  }
];

async function ensureSchema() {
  await pool.query(SCHEMA);
  // 软删除标记列（最近删除可恢复）
  await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_at timestamptz;`);
  // 用户资料：昵称 + 头像
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text;`);
  // 用户资料：购房需求 + 最晚购房提醒（JSONB 结构化存储）
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS demand jsonb;`);
  // 令牌版本：登出 / 改密时自增，使旧令牌立即失效（支持吊销）
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;`);
  // 高德 Key 每用户自配（JS API Key + 安全密钥 给前端加载地图；Web 服务 Key 仅服务端使用）
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS amap_js_key text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS amap_security_code text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS amap_web_key text;`);
  // 地图功能开关：默认关闭，用户在「设置 → 高德地图 Key」点「启用」后才加载高德脚本、才显示地图分布菜单
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_enabled boolean NOT NULL DEFAULT false;`);
  // 收藏标记（软删除之外的正向标记，跟账号走）
  await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS favorite boolean NOT NULL DEFAULT false;`);
  // 邮箱验证码（注册 / 登录 / 找回密码）。服务于未登录的公开流程，故不带 owner_id；
  // 只存验证码的 HMAC，不存明文，也不含任何房源数据。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_codes (
      id bigserial PRIMARY KEY,
      email text NOT NULL,
      purpose text NOT NULL,
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      used boolean NOT NULL DEFAULT false,
      attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS email_codes_lookup_idx ON email_codes(email, purpose, used, expires_at);`);
  // 房源跟进日志表（按房源、按账号隔离，随房源删除而删除）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS property_followups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type text NOT NULL DEFAULT '其他',
      happened_date date,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS property_followups_pid_idx ON property_followups(property_id);`);
  // 购房知识：用户上传的资料（按账号隔离，系统内置知识走前端静态数据、全账号共享）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_files (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      filename text NOT NULL,
      stored_path text NOT NULL,
      mime text,
      size integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_files_owner_idx ON knowledge_files(owner_id);`);
  // 知识资料支持「笔记」类型（纯文字，不落地文件）
  await pool.query(`ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS kind varchar(8) NOT NULL DEFAULT 'file';`);
  await pool.query(`ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS content text;`);
  // 更新时自动维护 updated_at
  await pool.query(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN new.updated_at = now(); RETURN new; END; $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    DROP TRIGGER IF EXISTS properties_set_updated_at ON properties;
    CREATE TRIGGER properties_set_updated_at BEFORE UPDATE ON properties
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}

// ---------- 密码哈希（内置 scrypt，无需第三方库）----------
// OWASP 2025 建议 scrypt N=2^17, r=8, p=1（约 128 MiB，单次约 0.4s），抗离线爆破比
// Node 默认参数（N=2^14）强约 8 倍。坑：maxmem 必须 >= 256 MiB，否则 Node 直接抛
// "memory limit exceeded"，加了参数反而让注册/登录全挂。
const SCRYPT_N = 1 << 17;   // 131072
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const SCRYPT_TAG = 'scrypt';
const PASSWORD_MIN = 8;     // NIST 800-63B 最低 8 位（原为 6 位）
const PASSWORD_MAX = 128;

function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }, (err, derived) => {
      if (err) return reject(err);
      // 带版本前缀 scrypt$N$r$p$salt$hash：以后调强度可按参数验旧密码，平滑升级
      resolve(`${SCRYPT_TAG}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`);
    });
  });
}
// 兼容两代格式：新格式带参数；旧格式是 salt:hash（用 Node scrypt 默认参数算的）。
function parsePasswordHash(stored) {
  const s = String(stored || '');
  if (s.startsWith(SCRYPT_TAG + '$')) {
    const p = s.split('$');
    if (p.length !== 6) return null;
    const N = Number(p[1]), r = Number(p[2]), pp = Number(p[3]);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(pp)) return null;
    return { saltHex: p[4], hashHex: p[5], legacy: false, opts: { N, r, p: pp, maxmem: SCRYPT_MAXMEM } };
  }
  const [saltHex, hashHex] = s.split(':');
  if (!saltHex || !hashHex) return null;
  return { saltHex, hashHex, legacy: true, opts: null }; // opts=null → 用默认参数复现旧哈希
}
function derivePassword(pw, parsed) {
  return new Promise((resolve, reject) => {
    const salt = Buffer.from(parsed.saltHex, 'hex');
    const cb = (err, d) => err ? reject(err) : resolve(d);
    if (parsed.opts) crypto.scrypt(pw, salt, 64, parsed.opts, cb);
    else crypto.scrypt(pw, salt, 64, cb);
  });
}
// 返回 { ok, needsUpgrade }：旧格式且密码正确时，登录成功后自动重算升级，用户无感
async function verifyPassword(pw, stored) {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return { ok: false, needsUpgrade: false };
  let derived;
  try { derived = await derivePassword(pw, parsed); }
  catch { return { ok: false, needsUpgrade: false }; }
  const expected = Buffer.from(parsed.hashHex, 'hex');
  if (expected.length !== derived.length) return { ok: false, needsUpgrade: false };
  const ok = crypto.timingSafeEqual(expected, derived);
  return { ok, needsUpgrade: ok && parsed.legacy };
}

// ---------- 邮件发送（Node 内置 tls/net 实现 SMTP，不引入第三方依赖）----------
// 配置只从环境变量 / 项目根 .env 读取，发件密钥永远不进前端。
// 配置统一在 config/db.js 读取（含 .env），改配置只动那一处，业务代码零改动
const smtpConfig = dbConfig.smtp;
// 仅本地开发可显式开启：不连 SMTP，把验证码打印到服务端控制台，便于跑通全流程。
// 生产严禁开启；未配置 SMTP 且未开此开关时，所有需要邮件验证的操作明确报错、不静默放行。
const EMAIL_DEV_LOG = dbConfig.emailDevLog;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function smtpConfigured() { return !!(smtpConfig.host && smtpConfig.user && smtpConfig.pass && smtpConfig.from); }
function safeAddr(s) { return String(s || '').replace(/[\r\n<>]/g, '').trim(); }

function readSmtpReply(sock, state) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { sock.off('data', onData); reject(new Error('SMTP 响应超时')); }, 15000);
    function onData(chunk) {
      state.buf += chunk;
      let idx;
      while ((idx = state.buf.indexOf('\r\n')) >= 0) {
        const line = state.buf.slice(0, idx);
        state.buf = state.buf.slice(idx + 2);
        state.lines.push(line);
        // 三位状态码 + 空格表示本次（可能多行）响应结束；250-xxx 是续行
        if (/^\d{3} /.test(line)) {
          clearTimeout(timer);
          sock.off('data', onData);
          const code = parseInt(line.slice(0, 3), 10);
          const text = state.lines.slice();
          state.lines = [];
          resolve({ code, text });
          return;
        }
      }
    }
    sock.on('data', onData);
  });
}
async function smtpCmd(sock, state, cmd, expect) {
  if (cmd != null) sock.write(cmd + '\r\n');
  const r = await readSmtpReply(sock, state);
  const codes = String(expect || '').split('|').filter(Boolean).map(Number);
  if (codes.length && !codes.includes(r.code)) {
    throw new Error(`SMTP ${cmd || '<greeting>'} 返回 ${r.code}：${r.text.join(' | ')}`);
  }
  return r;
}
function waitSmtpConnect(sock, secure) {
  return new Promise((resolve, reject) => {
    const onOk = () => { cleanup(); resolve(); };
    const onErr = (e) => { cleanup(); reject(e); };
    function cleanup() {
      sock.off('error', onErr);
      sock.off('connect', onOk);
      sock.off('secureConnect', onOk);
    }
    sock.on('error', onErr);
    sock.on(secure ? 'secureConnect' : 'connect', onOk);
  });
}
async function smtpDeliver(to, data) {
  const state = { buf: '', lines: [] };
  let sock = smtpConfig.secure
    ? tls.connect({ host: smtpConfig.host, port: smtpConfig.port, servername: smtpConfig.host })
    : net.connect({ host: smtpConfig.host, port: smtpConfig.port });
  sock.setEncoding('utf8');
  sock.on('error', (e) => console.error('[MAIL] SMTP 连接错误：', e.message));
  try {
    await waitSmtpConnect(sock, smtpConfig.secure);
    await smtpCmd(sock, state, null, 220);                     // 服务器欢迎语
    let ehlo = await smtpCmd(sock, state, 'EHLO localhost', 250);
    if (!smtpConfig.secure && /STARTTLS/i.test(ehlo.text.join('\n'))) {
      await smtpCmd(sock, state, 'STARTTLS', 220);
      sock = tls.connect({ socket: sock, servername: smtpConfig.host });
      sock.setEncoding('utf8');
      sock.on('error', (e) => console.error('[MAIL] SMTP(TLS) 连接错误：', e.message));
      await waitSmtpConnect(sock, true);
      ehlo = await smtpCmd(sock, state, 'EHLO localhost', 250);
    }
    await smtpCmd(sock, state, 'AUTH LOGIN', 334);
    await smtpCmd(sock, state, Buffer.from(smtpConfig.user, 'utf8').toString('base64'), 334);
    await smtpCmd(sock, state, Buffer.from(smtpConfig.pass, 'utf8').toString('base64'), 235);
    await smtpCmd(sock, state, 'MAIL FROM:<' + safeAddr(smtpConfig.from) + '>', 250);
    await smtpCmd(sock, state, 'RCPT TO:<' + safeAddr(to) + '>', 250);
    await smtpCmd(sock, state, 'DATA', 354);
    sock.write(data + '\r\n.\r\n');
    await smtpCmd(sock, state, null, 250);
    try { await smtpCmd(sock, state, 'QUIT', 221); } catch { /* 关掉连接即可 */ }
  } finally {
    try { sock.destroy(); } catch { /* ignore */ }
  }
}
function buildMime(to, subject, html) {
  const subj = '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';
  const fromName = '=?UTF-8?B?' + Buffer.from(smtpConfig.fromName, 'utf8').toString('base64') + '?=';
  const body = Buffer.from(html, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const raw = [
    'From: ' + fromName + ' <' + safeAddr(smtpConfig.from) + '>',
    'To: ' + safeAddr(to),
    'Subject: ' + subj,
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@house-view-tracker>',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '', body, ''
  ].join('\r\n');
  return raw.replace(/\r\n\./g, '\r\n..'); // SMTP 点填充
}
async function sendMail(to, subject, html) {
  if (!smtpConfigured()) {
    if (EMAIL_DEV_LOG) {
      console.log('[MAIL][DEV] 未配置 SMTP，仅打印邮件内容：', { to, subject, html });
      return { dev: true };
    }
    throw new Error('系统尚未配置邮件服务（SMTP），请联系管理员在 .env 中设置 SMTP_HOST / SMTP_USER / SMTP_PASS');
  }
  await smtpDeliver(to, buildMime(to, subject, html));
}

// ---------- 邮箱验证码：注册 / 登录 / 找回密码 共用 ----------
// 库里只存 HMAC(密钥, email+purpose+code)，不存明文码；一次性 + 10 分钟有效 + 5 次尝试上限。
// 这张表服务于「未登录」的公开流程，因此不带 owner_id，记录也不含任何房源数据。
const EMAIL_CODE_TTL = 10 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
// 密码登录已不再消耗邮箱码，故不再签发 purpose=login 的死码；验证码登录用 code-login
const EMAIL_PURPOSE_LABEL = { register: '注册账号', 'code-login': '验证码登录', reset: '找回密码' };
const emailRate = new Map(); // key -> { count, first }
function emailRateLimited(key, max, windowMs) {
  const now = Date.now();
  const e = emailRate.get(key);
  if (!e || now - e.first > windowMs) { emailRate.set(key, { count: 1, first: now }); return false; }
  if (e.count >= max) return true;
  e.count++;
  return false;
}
function emailCodeHash(email, purpose, code) {
  return crypto.createHmac('sha256', dbConfig.tokenSecret)
    .update(`emailcode:${email}:${purpose}:${code}`).digest('hex');
}
async function issueEmailCode(email, purpose) {
  await pool.query("DELETE FROM email_codes WHERE expires_at < now() - interval '1 day'");
  // 同邮箱同用途只保留最新一个有效码，避免多封邮件里的多个码同时有效
  await pool.query('UPDATE email_codes SET used = true WHERE email=$1 AND purpose=$2 AND used=false', [email, purpose]);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await pool.query(
    'INSERT INTO email_codes (email, purpose, code_hash, expires_at) VALUES ($1,$2,$3, to_timestamp($4))',
    [email, purpose, emailCodeHash(email, purpose, code), (Date.now() + EMAIL_CODE_TTL) / 1000]
  );
  return code;
}
async function consumeEmailCode(email, purpose, code) {
  const r = await pool.query(
    `SELECT id, code_hash, attempts FROM email_codes
     WHERE email=$1 AND purpose=$2 AND used=false AND expires_at > now()
     ORDER BY id DESC LIMIT 1`, [email, purpose]);
  if (!r.rows.length) return false;
  const row = r.rows[0];
  let ok = false;
  try {
    ok = crypto.timingSafeEqual(
      Buffer.from(row.code_hash, 'hex'),
      Buffer.from(emailCodeHash(email, purpose, String(code == null ? '' : code)), 'hex')
    );
  } catch { ok = false; }
  if (ok) {
    await pool.query('UPDATE email_codes SET used=true WHERE id=$1', [row.id]);
    return true;
  }
  if (Number(row.attempts) + 1 >= EMAIL_CODE_MAX_ATTEMPTS) {
    await pool.query('UPDATE email_codes SET used=true, attempts=attempts+1 WHERE id=$1', [row.id]);
  } else {
    await pool.query('UPDATE email_codes SET attempts=attempts+1 WHERE id=$1', [row.id]);
  }
  return false;
}
function emailCodeMailHtml(label, code) {
  return `<div style="font-family:Microsoft YaHei,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#243044">
    <h2 style="margin:0 0 16px;font-size:20px">看房记录工具 · 邮箱验证码</h2>
    <p style="font-size:14px;line-height:1.8">你正在进行「${label}」操作，本次验证码是：</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#1d4ed8;background:#eef4ff;padding:16px 20px;border-radius:10px;text-align:center;margin:18px 0">${code}</div>
    <p style="font-size:13px;color:#667085;line-height:1.8">验证码 10 分钟内有效，且只能使用一次。<br/>若不是你本人操作，请忽略本邮件，并建议尽快修改账号密码。</p>
  </div>`;
}

// ---------- 令牌（HMAC 自签，无状态；带 token_version 以支持吊销/登出）----------
function signToken(userId, tv) {
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    tv: tv || 0,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30 // 30 天
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', dbConfig.tokenSecret).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', dbConfig.tokenSecret).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp && Date.now() > data.exp) return null;
    return { uid: data.uid, tv: data.tv || 0 };
  } catch { return null; }
}

// ---------- 工具 ----------
function sendJSON(res, code, obj, extra) {
  head(res, code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, extra || {}));
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}
async function authUid(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const v = verifyToken(m[1]);
  if (!v) return null;
  // 校验令牌版本：登出/改密会自增 token_version，使旧令牌立即失效（支持吊销）
  try {
    const r = await pool.query('SELECT token_version FROM users WHERE id=$1', [v.uid]);
    if (!r.rows.length) return null;
    if (Number(r.rows[0].token_version) !== v.tv) return null;
    return v.uid;
  } catch { return null; }
}

// 文件上传（房源图片/视频）：支持流式二进制上传，避免把视频读成 base64 撑爆浏览器内存
const UPLOAD_MAX = 300 * 1024 * 1024; // 300MB 上限
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'mkv']);
const CT_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv',
  'video/quicktime': 'mov', 'video/x-msvideo': 'avi', 'video/x-matroska': 'mkv'
};
async function handleUpload(req, res) {
  const uid = await authUid(req);
  if (!uid) return sendJSON(res, 401, { error: '未登录或登录已过期' });
  const ctype = (req.headers['content-type'] || '').split(';')[0].trim();
  const mediaDir = path.join(ROOT, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const newName = () => (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).slice(2)));

  // [诊断] 上传入口日志：确认走的是新版本 server.js，并打印关键请求头，便于排查 ERR_CONNECTION_RESET
  console.log('[upload] === entry ===', {
    method: req.method,
    url: (req.url || '').split('?')[0],
    ctype,
    xFilename: req.headers['x-filename'] || '',
    contentLength: req.headers['content-length'] || '',
    hasAuth: !!req.headers['authorization']
  });

  // 路径 A：旧方式（头像）传 JSON { dataUrl }，内含 base64 图片
  if (ctype === 'application/json') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const dataUrl = String((body && body.dataUrl) || '');
    const mm = dataUrl.match(/^data:([a-zA-Z0-9/+.+-]+);base64,(.+)$/s);
    if (!mm) return sendJSON(res, 400, { error: '上传内容必须是图片 dataUrl' });
    const mime = mm[1], b64 = mm[2];
    if (mime === 'image/svg+xml') return sendJSON(res, 400, { error: '不支持 SVG 格式（存在 XSS 安全风险）' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 8 * 1024 * 1024) return sendJSON(res, 400, { error: '图片不能超过 8MB' });
    const ext = CT_EXT[mime] || 'png';
    const fname = newName() + '.' + ext;
    fs.writeFileSync(path.join(mediaDir, fname), buf);
    return sendJSON(res, 200, { data: { url: '/media/' + fname } });
  }

  // 路径 B：新方式（房源图片/视频）直接传二进制文件，流式落盘，不占内存
  const rawName = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : 'file';
  let ext = (path.extname(rawName) || '').replace(/^\./, '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    const e2 = CT_EXT[ctype];
    if (!e2) return sendJSON(res, 400, { error: '不支持的文件类型：' + (ctype || '未知') });
    ext = e2;
  }
  const fname = newName() + '.' + ext;
  const dest = path.join(mediaDir, fname);
  if (!path.normalize(dest).startsWith(mediaDir)) return sendJSON(res, 400, { error: '非法文件名' });

  // 一次性结算守卫：无论成功/失败只响应一次，且响应前检查 socket 是否已断开，
  // 避免「已结束/已销毁的 socket 还去写 → 抛异常 → 进程崩溃 → 连接被重置（ERR_CONNECTION_RESET）」
  let settled = false;
  const reply = (code, obj) => {
    if (settled) return;
    settled = true;
    console.log('[upload] <<< reply', code, (obj && obj.error) || '(ok)');
    if (res.headersSent || res.writableEnded || res.destroyed) {
      console.log('[upload] !! socket 已关闭，跳过响应（客户端已断开 / 响应已发）');
      return;
    }
    sendJSON(res, code, obj);
  };
  const fail = (err) => reply(500, { error: '上传失败：' + (err && err.message ? err.message : err) });

  let received = 0, aborted = false, chunks = 0;
  const ws = fs.createWriteStream(dest);
  const cleanup = () => { try { ws.destroy(); } catch (_) {} try { fs.unlink(dest, () => {}); } catch (_) {} };

  req.on('data', (c) => {
    if (aborted) return;
    received += c.length; chunks++;
    if (received > UPLOAD_MAX) {
      aborted = true; cleanup();
      console.log('[upload] !! 超过 300MB，中止', { received });
      reply(400, { error: '文件过大（上限 300MB）' });
      try { req.destroy(); } catch (_) {}
      return;
    }
    if (!ws.write(c)) req.pause(); // 背压：写缓冲区满时暂停读取，防止内存暴涨
  });
  ws.on('drain', () => { if (!aborted) req.resume(); });
  req.on('aborted', () => { if (!aborted) { aborted = true; cleanup(); console.log('[upload] !! 客户端中断连接（aborted）', { received, chunks }); } }); // 客户端中断：只清理，不回复（对方已断开）
  req.on('error', (e) => { if (!aborted) { aborted = true; cleanup(); console.log('[upload] !! req 错误', e && e.message); fail(e); } });
  ws.on('error', (e) => { if (!aborted) { aborted = true; cleanup(); console.log('[upload] !! 写文件错误', e && e.message); fail(e); } });
  ws.on('finish', () => { if (!aborted) { console.log('[upload] <<< 文件写入完成', { received, chunks, dest }); reply(200, { data: { url: '/media/' + fname } }); } });
  req.on('end', () => { if (!aborted) { console.log('[upload] <<< 请求体接收完毕', { received, chunks }); ws.end(); } });
  return;
}

// 把房源行里的 JSON 字段统一 stringify，配合 ::jsonb 绑定
function jsonb(v) { return v == null ? null : JSON.stringify(v); }

// 通用：插入一条房源（归属当前登录用户），返回完整行
async function insertProperty(uid, s) {
  s = s || {};
  const r = await pool.query(
    `INSERT INTO properties
      (owner_id, title, location, attributes, media, transaction, facilities, geo, notes)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9)
     RETURNING *`,
    [uid, s.title ?? null, jsonb(s.location || {}), jsonb(s.attributes || {}),
     jsonb(s.media || {}), jsonb(s.transaction || {}), jsonb(s.facilities || {}),
     jsonb(s.geo), s.notes ?? null]
  );
  return r.rows[0];
}

// ---------- freellmapi 调用封装（本地免费 LLM 网关；仅后端调用，token 不暴露前端） ----------
// 把请求转发到 freellmapi 的 OpenAI 兼容端点；返回 fetch 的 Response，由调用方决定流式/非流式处理。
async function callFreellm(opts) {
  const { messages, model = 'auto', temperature = 0.7, maxTokens = 1024, stream = false, images = null } = opts || {};
  if (!Array.isArray(messages) || !messages.length) throw new Error('messages 不能为空');
  const base = String(dbConfig.freellmBaseUrl || '').replace(/\/+$/, '');
  const key = dbConfig.freellmApiKey;
  if (!base) throw new Error('未配置 freellmapi 地址（FREELLM_BASE_URL）');
  if (!key) throw new Error('未配置 freellmapi 统一令牌（FREELLM_API_KEY）');
  if (typeof fetch === 'undefined') throw new Error('当前 Node 版本过低，需 18+ 才能调用 LLM（请升级 Node）');
  // 多模态：若有图片，将第一条 user 消息的 content 转为 [text, image_url...] 数组格式
  let finalMessages = messages;
  if (images && Array.isArray(images) && images.length) {
    let firstUserIdx = -1;
    for (let i = 0; i < messages.length; i++) { if (messages[i] && messages[i].role === 'user') { firstUserIdx = i; break; } }
    if (firstUserIdx >= 0) {
      const um = messages[firstUserIdx];
      const text = typeof um.content === 'string' ? um.content
        : (Array.isArray(um.content) ? ((um.content.find(x => x && x.type === 'text') || {}).text || '') : '');
      const visionContent = [{ type: 'text', text }];
      for (const d of images) {
        if (typeof d === 'string' && d.length) visionContent.push({ type: 'image_url', image_url: { url: d } });
      }
      finalMessages = messages.map((m, i) => (i === firstUserIdx ? { role: 'user', content: visionContent } : m));
    }
  }
  const resp = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model, messages: finalMessages, temperature, max_tokens: maxTokens, stream })
  });
  return resp;
}

// ---------- AI 录入：结构化字段提取（best-effort，含链接抓取 + 平台识别） ----------
const AI_EXTRACT_SCHEMA = `你是一个房产信息提取助手。用户会提供房源描述、截图或网页内容（可能来自链家/贝壳/安居客等平台）。请从中提取结构化字段，严格只返回 JSON（不要任何解释、不要 markdown 代码块标记）。字段结构：
{
  "title": "房源标题（可选，可用小区名）",
  "location": { "city":"城市","district":"区域/区","community":"小区名称","address":"详细地址" },
  "attributes": { "layout":"户型如 3室2厅2卫","area":数值_面积平米,"orientation":"朝向","floor":"楼层描述如 中楼层/总33层" },
  "transaction": { "totalPrice":数值_总价_万,"unitPrice":数值_单价_元每平,"agentName":"中介姓名","agentPhone":"中介电话","wechat":"微信","sourcePlatform":"来源平台","houseNumber":"房源编号" },
  "notes": "其它补充说明"
}
没有的信息填 null 或空字符串。数值类型不要带单位字符串（如 168 而非 "168万"）。`;

function detectPlatform(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('lianjia.com')) return '链家';
  if (u.includes('anjuke.com')) return '安居客';
  if (u.includes('ke.com') || u.includes('beike.com')) return '贝壳';
  if (u.includes('fang.com')) return '房天下';
  if (u.includes('xiaohongshu.com') || u.includes('xhslink.com')) return '小红书';
  if (u.includes('weixin.qq.com') || u.includes('mp.weixin')) return '微信公众号';
  if (u.includes('58.com') || u.includes('ganji')) return '58同城/赶集';
  return null;
}

async function fetchUrlText(url, _depth) {
  const depth = _depth || 0;
  let target;
  try { target = await assertSafeUrl(url); } catch (e) { return { ok: false, error: e.message }; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      redirect: 'manual',
      signal: ctrl.signal
    });
    // 手动处理重定向：逐级重新做 SSRF 校验，避免被 302 引到内网
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location') && depth < 3) {
      const loc = new URL(resp.headers.get('location'), target).toString();
      return await fetchUrlText(loc, depth + 1);
    }
    if (!resp.ok) return { ok: false, status: resp.status };
    const html = await resp.text();
    return { ok: true, html };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '超时' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function extractPageContent(html) {
  if (!html) return '';
  // 优先提取内嵌 JSON（链家/贝壳等 SSR 常把数据挂到全局变量）
  const jsonMatch = html.match(/(?:window\.__INITIAL_STATE__|window\.__NUXT__|window\.__INITIAL_STATE)\s*=\s*(\{[\s\S]*?\})\s*;?/);
  let seed = '';
  if (jsonMatch) {
    try { seed = JSON.stringify(JSON.parse(jsonMatch[1])); } catch (_) { seed = jsonMatch[1]; }
  }
  // 去除 script/style 后取纯文本
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  text = text.replace(/\s+/g, ' ').trim();
  const combined = (seed ? seed + '\n' : '') + text;
  return combined.slice(0, 6000);
}

function parseLlmJson(content) {
  let t = String(content || '').trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) t = m[1].trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

// 统一构造返回给前端的安全用户信息（含高德 Key；web key 仅服务端，不返回）
function userPublic(r0) {
  return {
    id: r0.id, email: r0.email, name: r0.name, avatar: r0.avatar, demand: r0.demand || null,
    amapJsKey: r0.amap_js_key || '', amapSecurityCode: r0.amap_security_code || '',
    mapEnabled: !!r0.map_enabled
  };
}

// ---------- 路由 ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  // 公开：验证码挑战（不缓存，答案只留在服务端）
  if (pathname === '/api/auth/captcha' && method === 'GET') {
    return sendJSON(res, 200, { data: newCaptcha() }, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  }

  // 公开：图形验证码正确后才发送邮箱验证码（注册 / 验证码登录 / 找回密码共用）
  if (pathname === '/api/auth/email-code' && method === 'POST') {
    const ip = clientIp(req);
    if (emailRateLimited('ip:' + ip, 8, 60 * 1000)) return sendJSON(res, 429, { error: '请求过于频繁，请 1 分钟后再试' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const purpose = String(body.purpose || '');
    if (!Object.prototype.hasOwnProperty.call(EMAIL_PURPOSE_LABEL, purpose)) {
      return sendJSON(res, 400, { error: '验证码用途不正确' });
    }
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return sendJSON(res, 400, { error: '请输入有效的邮箱地址' });
    // 用户要求：先过图形验证码，正确了才发邮件
    if (!verifyCaptcha(body.captchaId, body.captchaAnswer)) {
      return sendJSON(res, 400, { error: '验证未通过，请重新完成验证' });
    }
    if (emailRateLimited('email:' + email, 5, 60 * 60 * 1000)) {
      return sendJSON(res, 429, { error: '该邮箱获取验证码过于频繁，请 1 小时后再试' });
    }
    const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (purpose === 'register' && exists.rows.length) {
      return sendJSON(res, 409, { error: '该邮箱已注册，请直接登录' });
    }
    // 登录 / 找回密码：账号不存在时不发信、也不报错（防账号枚举，也不浪费邮件）
    if (purpose !== 'register' && !exists.rows.length) {
      return sendJSON(res, 200, { data: { sent: true, expiresIn: 600 } });
    }
    if (!smtpConfigured() && !EMAIL_DEV_LOG) {
      return sendJSON(res, 503, { error: '系统尚未配置邮件服务（SMTP），请联系管理员' });
    }
    let code;
    try { code = await issueEmailCode(email, purpose); }
    catch (e) { console.error('[MAIL] 签发验证码失败', e); return sendJSON(res, 500, { error: '验证码生成失败，请稍后重试' }); }
    try {
      await sendMail(email, `【看房记录】${EMAIL_PURPOSE_LABEL[purpose]}验证码`, emailCodeMailHtml(EMAIL_PURPOSE_LABEL[purpose], code));
      if (EMAIL_DEV_LOG && !smtpConfigured()) {
        console.log(`[MAIL][DEV] ${EMAIL_PURPOSE_LABEL[purpose]}验证码 ${code} → ${email}（仅开发模式，生产严禁开启 EMAIL_DEV_LOG）`);
      }
    } catch (e) {
      console.error('[MAIL] 发送失败', e.message);
      // 发信失败不能留下一个「有效但用户永远收不到」的码
      await pool.query('UPDATE email_codes SET used=true WHERE email=$1 AND purpose=$2 AND used=false', [email, purpose]);
      return sendJSON(res, 502, { error: '验证码邮件发送失败，请稍后重试或联系管理员检查 SMTP 配置' });
    }
    return sendJSON(res, 200, { data: { sent: true, expiresIn: 600, devMode: EMAIL_DEV_LOG && !smtpConfigured() } });
  }

  // 公开：注册 / 重置密码（图形验证码已在 email-code 阶段消耗，这里校验一次性邮箱验证码）
  if (pathname === '/api/auth/register' && method === 'POST') {
    const ip = clientIp(req);
    if (loginLimited(ip)) return sendJSON(res, 429, { error: '操作过于频繁，请 15 分钟后再试' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!EMAIL_RE.test(email)) return sendJSON(res, 400, { error: '请输入有效的邮箱地址' });
    if (password.length < PASSWORD_MIN) return sendJSON(res, 400, { error: `密码至少 ${PASSWORD_MIN} 位` });
    if (password.length > PASSWORD_MAX) return sendJSON(res, 400, { error: '密码过长' });
    // 图形验证码已在 email-code 阶段一次性消耗，这里只认邮箱验证码，防止绕过发码直接注册
    const codeOk = await consumeEmailCode(email, 'register', body.emailCode);
    if (!codeOk) {
      loginFail(ip);
      return sendJSON(res, 400, { error: '邮箱验证码不正确或已过期，请重新获取' });
    }
    const hash = await hashPassword(password);
    try {
      const name = body.name ? String(body.name).trim().slice(0, 40) : null;
      const r = await pool.query(
        'INSERT INTO users (email, password_hash, name, avatar) VALUES ($1,$2,$3,$4) RETURNING id, email, name, avatar, demand, amap_js_key, amap_security_code, map_enabled',
        [email, hash, name, null]
      );
      const r0 = r.rows[0];
      loginOk(ip);
      return sendJSON(res, 201, { data: { token: signToken(r0.id, r0.token_version || 0), user: userPublic(r0) } });
    } catch (e) {
      loginFail(ip);
      // 邮箱已被占用（唯一约束冲突）→ 明确告知，别把原因错误归到「邮箱格式」上。
      // 注意：注册接口本身即可用于探测邮箱是否注册，模糊化在这里几乎不产生额外防护，
      // 反而会误导用户；防账号枚举真正的关键在登录路径（不区分「邮箱不存在/密码错误」）。
      if (String(e.code) === '23505') return sendJSON(res, 409, { error: '该邮箱已注册，请直接登录' });
      console.error('register error', e);
      return sendJSON(res, 500, { error: '注册失败，请稍后重试' });
    }
  }

  // 密码登录：默认只要邮箱 + 密码（与常见登录页一致）。
  // 同一 IP 连续失败达到阈值后，才要求一次性图形验证码（前端内联展开，不弹窗）。
  if (pathname === '/api/auth/login' && method === 'POST') {
    const ip = clientIp(req);
    if (loginLimited(ip)) return sendJSON(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    if (loginFailCount(ip) >= CAPTCHA_AFTER_FAILS) {
      if (!verifyCaptcha(body.captchaId, body.captchaAnswer)) {
        return sendJSON(res, 428, { error: 'NEED_CAPTCHA' });
      }
    }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const r = await pool.query('SELECT id, email, password_hash, name, avatar, demand, token_version, amap_js_key, amap_security_code, map_enabled FROM users WHERE email=$1', [email]);
    const vr = r.rows.length
      ? await verifyPassword(password, r.rows[0].password_hash)
      : { ok: false, needsUpgrade: false };
    if (!vr.ok) { loginFail(ip); return sendJSON(res, 401, { error: '邮箱或密码不正确' }); }
    loginOk(ip);
    const r0 = r.rows[0];
    // 旧格式哈希在登录成功后自动升级成 OWASP 参数，用户无感、无需批量迁移
    if (vr.needsUpgrade) {
      try {
        const upgraded = await hashPassword(password);
        await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [upgraded, r0.id]);
        console.log('[PWD] 已自动升级旧格式密码哈希，uid=' + r0.id);
      } catch (e) { console.error('[PWD] 自动升级哈希失败（不影响本次登录）', e.message); }
    }
    return sendJSON(res, 200, { data: { token: signToken(r0.id, r0.token_version || 0), user: userPublic(r0) } });
  }

  // 验证码登录（免密）：邮箱 + 一次性邮箱验证码；发码时已过图形验证，这里只认邮箱码。
  // 账号不存在时复用同一句错误文案，避免被拿来枚举注册邮箱。
  if (pathname === '/api/auth/login-code' && method === 'POST') {
    const ip = clientIp(req);
    if (loginLimited(ip)) return sendJSON(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return sendJSON(res, 400, { error: '请输入有效的邮箱地址' });
    const codeOk = await consumeEmailCode(email, 'code-login', body.emailCode);
    if (!codeOk) { loginFail(ip); return sendJSON(res, 400, { error: '验证码不正确或已过期，请重新获取' }); }
    const r = await pool.query('SELECT id, email, name, avatar, demand, token_version, amap_js_key, amap_security_code, map_enabled FROM users WHERE email=$1', [email]);
    if (!r.rows.length) { loginFail(ip); return sendJSON(res, 400, { error: '验证码不正确或已过期，请重新获取' }); }
    loginOk(ip);
    const r0 = r.rows[0];
    return sendJSON(res, 200, { data: { token: signToken(r0.id, r0.token_version || 0), user: userPublic(r0) } });
  }

  // 公开：找回密码（P2）—— 邮箱验证码 + 新密码，成功后自增 token_version 踢掉所有旧设备
  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    const ip = clientIp(req);
    if (loginLimited(ip)) return sendJSON(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const email = String(body.email || '').trim().toLowerCase();
    const newPassword = String(body.newPassword || '');
    if (!EMAIL_RE.test(email)) return sendJSON(res, 400, { error: '请输入有效的邮箱地址' });
    if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
      return sendJSON(res, 400, { error: `新密码需 ${PASSWORD_MIN}–${PASSWORD_MAX} 位` });
    }
    const codeOk = await consumeEmailCode(email, 'reset', body.emailCode);
    if (!codeOk) {
      loginFail(ip);
      return sendJSON(res, 400, { error: '邮箱验证码不正确或已过期，请重新获取' });
    }
    const hash = await hashPassword(newPassword);
    const r = await pool.query(
      'UPDATE users SET password_hash=$1, token_version = token_version + 1 WHERE email=$2 RETURNING id',
      [hash, email]
    );
    if (!r.rows.length) return sendJSON(res, 404, { error: '该邮箱尚未注册' });
    loginOk(ip);
    return sendJSON(res, 200, { data: { ok: true } });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录或登录已过期' });
    const r = await pool.query('SELECT id, email, name, avatar, demand, amap_js_key, amap_security_code, map_enabled FROM users WHERE id=$1', [uid]);
    if (!r.rows.length) return sendJSON(res, 401, { error: '用户不存在' });
    return sendJSON(res, 200, { data: { user: userPublic(r.rows[0]) } });
  }

  if (pathname === '/api/auth/me' && method === 'PATCH') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录或登录已过期' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const name = body.name != null ? String(body.name).trim().slice(0, 40) : null;
    const avatar = body.avatar != null ? String(body.avatar).slice(0, 2000) : null;
    // 购房需求（JSONB）：传入则整体覆盖，未传保持不变
    const demandRaw = (body.demand != null && typeof body.demand === 'object') ? JSON.stringify(body.demand) : null;
    // 高德 Key：仅当前用户自己可改；web key 仅服务端使用，不返回前端
    const amapJsKey = body.amapJsKey != null ? String(body.amapJsKey).trim().slice(0, 200) : null;
    const amapSecurityCode = body.amapSecurityCode != null ? String(body.amapSecurityCode).trim().slice(0, 200) : null;
    const amapWebKey = body.amapWebKey != null ? String(body.amapWebKey).trim().slice(0, 200) : null;
    // 地图功能开关：只接受布尔值，未传则保持不变
    const mapEnabled = (body.mapEnabled === true || body.mapEnabled === 'true') ? true
      : (body.mapEnabled === false || body.mapEnabled === 'false') ? false : null;
    const r = await pool.query(
      'UPDATE users SET name = COALESCE($1, name), avatar = COALESCE($2, avatar), demand = COALESCE($3::jsonb, demand), amap_js_key = COALESCE($4, amap_js_key), amap_security_code = COALESCE($5, amap_security_code), amap_web_key = COALESCE($6, amap_web_key), map_enabled = COALESCE($7, map_enabled) WHERE id=$8 RETURNING id, email, name, avatar, demand, amap_js_key, amap_security_code, map_enabled',
      [name, avatar, demandRaw, amapJsKey, amapSecurityCode, amapWebKey, mapEnabled, uid]
    );
    const u = r.rows[0];
    return sendJSON(res, 200, { data: { user: userPublic(u) } });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录或登录已过期' });
    // 自增令牌版本：使该用户所有已签发令牌立即失效（支持吊销 / 一键登出）
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [uid]);
    return sendJSON(res, 200, { data: { ok: true } });
  }

  // 以下接口需要登录
  const uid = await authUid(req);
  if (!uid) return sendJSON(res, 401, { error: '未登录或登录已过期' });

  // 修改密码（P0）：校验原密码 → 换新哈希 → 自增 token_version 踢掉其它设备
  if (pathname === '/api/auth/change-password' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const oldPw = String(body.oldPassword || ''), newPw = String(body.newPassword || '');
    if (newPw.length < PASSWORD_MIN || newPw.length > PASSWORD_MAX) {
      return sendJSON(res, 400, { error: `新密码需 ${PASSWORD_MIN}–${PASSWORD_MAX} 位` });
    }
    const r = await pool.query('SELECT password_hash FROM users WHERE id=$1', [uid]);
    if (!r.rows.length) return sendJSON(res, 401, { error: '用户不存在' });
    const vr = await verifyPassword(oldPw, r.rows[0].password_hash);
    if (!vr.ok) return sendJSON(res, 400, { error: '原密码不正确' });
    const hash = await hashPassword(newPw);
    // 当前设备的旧 token 也会失效，前端收到成功后引导重新登录
    await pool.query('UPDATE users SET password_hash=$1, token_version = token_version + 1 WHERE id=$2', [hash, uid]);
    return sendJSON(res, 200, { data: { ok: true } });
  }

  // 列表
  if (pathname === '/api/properties' && method === 'GET') {
    const r = await pool.query(
      'SELECT * FROM properties WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC', [uid]
    );
    return sendJSON(res, 200, { data: r.rows });
  }

  // 新建
  if (pathname === '/api/properties' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const row = body || {};
    const inserted = await insertProperty(uid, row);
    return sendJSON(res, 201, { data: inserted });
  }

  // 一键导入示例数据（写入当前登录用户名下，5 条成都房源）
  if (pathname === '/api/properties/seed' && method === 'POST') {
    const inserted = [];
    for (const s of SEED_SAMPLE_DATA) inserted.push(await insertProperty(uid, s));
      return sendJSON(res, 201, { data: inserted });
  }

  // 批量导入（CSV 导入等，接收房源对象数组）
  if (pathname === '/api/properties/batch' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const rows = Array.isArray(body) ? body : (body && body.rows) || [];
    const inserted = [];
    for (const s of rows) inserted.push(await insertProperty(uid, s || {}));
    return sendJSON(res, 201, { data: inserted });
  }

  // 最近删除列表
  if (pathname === '/api/trash' && method === 'GET') {
    const r = await pool.query(
      'SELECT * FROM properties WHERE owner_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC', [uid]
    );
    return sendJSON(res, 200, { data: r.rows });
  }

  // 恢复已删除（最近删除可恢复）
  const rm = pathname.match(/^\/api\/properties\/([^/]+)\/restore$/);
  if (rm && method === 'POST') {
    const r = await pool.query('UPDATE properties SET deleted_at=NULL WHERE id=$1 AND owner_id=$2 RETURNING *', [rm[1], uid]);
    if (!r.rowCount) return sendJSON(res, 404, { error: '未找到该房源或无权限' });
    return sendJSON(res, 200, { data: r.rows[0] });
  }

  // 文件上传已移至顶层 createServer 中由 handleUpload 处理（支持流式二进制，避免视频 base64 撑爆内存）

  // 彻底删除（回收站）
  const pm = pathname.match(/^\/api\/properties\/([^/]+)\/purge$/);
  if (pm && method === 'POST') {
    const r = await pool.query('DELETE FROM properties WHERE id=$1 AND owner_id=$2', [pm[1], uid]);
    if (!r.rowCount) return sendJSON(res, 404, { error: '未找到该房源或无权限' });
    return sendJSON(res, 200, { data: { ok: true } });
  }

  // 收藏 / 取消收藏（body.favorite 缺省时按当前状态取反）
  const fm = pathname.match(/^\/api\/properties\/([^/]+)\/favorite$/);
  if (fm && method === 'POST') {
    let body = {};
    try { body = await readBody(req); } catch (e) {}
    let target;
    if (typeof body.favorite === 'boolean') {
      target = body.favorite;
    } else {
      const cur = await pool.query('SELECT favorite FROM properties WHERE id=$1 AND owner_id=$2', [fm[1], uid]);
      if (!cur.rowCount) return sendJSON(res, 404, { error: '未找到该房源或无权限' });
      target = !cur.rows[0].favorite;
    }
    const r = await pool.query(
      'UPDATE properties SET favorite=$3 WHERE id=$1 AND owner_id=$2 RETURNING *', [fm[1], uid, target]
    );
    if (!r.rowCount) return sendJSON(res, 404, { error: '未找到该房源或无权限' });
    return sendJSON(res, 200, { data: r.rows[0] });
  }

  // 房源跟进日志：列表 / 新增 / 删除单条
  const fup = pathname.match(/^\/api\/properties\/([^/]+)\/followups$/);
  if (fup && (method === 'GET' || method === 'POST')) {
    const pid = fup[1];
    if (method === 'GET') {
      const r = await pool.query(
        'SELECT * FROM property_followups WHERE property_id=$1 AND owner_id=$2 ORDER BY COALESCE(happened_date, created_at::date) DESC, created_at DESC',
        [pid, uid]
      );
      return sendJSON(res, 200, { data: r.rows });
    }
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const content = String(body.content || '').trim();
    if (!content) return sendJSON(res, 400, { error: '跟进内容不能为空' });
    const r = await pool.query(
      `INSERT INTO property_followups (property_id, owner_id, type, happened_date, content)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pid, uid, String(body.type || '其他').slice(0, 20), body.happenedDate || null, content]
    );
    return sendJSON(res, 201, { data: r.rows[0] });
  }
  const fupd = pathname.match(/^\/api\/properties\/([^/]+)\/followups\/([^/]+)$/);
  if (fupd && method === 'DELETE') {
    const r = await pool.query('DELETE FROM property_followups WHERE id=$1 AND property_id=$2 AND owner_id=$3', [fupd[2], fupd[1], uid]);
    if (!r.rowCount) return sendJSON(res, 404, { error: '未找到该记录或无权限' });
    return sendJSON(res, 200, { data: { ok: true } });
  }

  // ---------- 购房知识：用户上传资料（按账号隔离） ----------
  if (pathname === '/api/knowledge' && method === 'GET') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录' });
    const r = await pool.query(
      'SELECT id, title, filename, mime, size, kind, content, created_at FROM knowledge_files WHERE owner_id=$1 ORDER BY created_at DESC',
      [uid]
    );
    return sendJSON(res, 200, { data: r.rows });
  }
  if (pathname === '/api/knowledge' && method === 'POST') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const kind = String((body && body.kind) || 'file');
    // 新建笔记（纯文字，不落地文件）
    if (kind === 'note') {
      const title = String(body.title || '').trim();
      const content = String(body.content || '');
      if (!title) return sendJSON(res, 400, { error: '请填写笔记标题' });
      if (!content) return sendJSON(res, 400, { error: '请填写笔记内容' });
      try {
        const r = await pool.query(
          "INSERT INTO knowledge_files (owner_id, title, filename, stored_path, mime, size, kind, content) VALUES ($1,$2,'', '', NULL, 0, 'note', $3) RETURNING id, title, kind, content, created_at",
          [uid, title, content]
        );
        return sendJSON(res, 201, { data: r.rows[0] });
      } catch (e) { console.error('knowledge note insert error', e); return sendJSON(res, 500, { error: '保存笔记失败' }); }
    }
    // 文件上传
    const dataUrl = String((body && body.dataUrl) || '');
    const mm = dataUrl.match(/^data:([a-zA-Z0-9/+\-.]+);base64,(.+)$/s);
    if (!mm) return sendJSON(res, 400, { error: '上传内容必须是 dataUrl（文件读取为 base64）' });
    const mime = mm[1];
    // 安全：禁止上传 SVG（可在同源内联执行 JS，造成存储型 XSS），与房源图片上传口径一致
    if (mime === 'image/svg+xml') return sendJSON(res, 400, { error: '不支持 SVG 格式（存在 XSS 安全风险）' });
    const buf = Buffer.from(mm[2], 'base64');
    if (buf.length > 30 * 1024 * 1024) return sendJSON(res, 400, { error: '单个文件不能超过 30MB' });
    const title = String(body.title || '').trim() || (body.filename ? String(body.filename) : '未命名资料');
    const origName = String(body.filename || 'file').replace(/[^\w.\-一-龥]/g, '_').slice(0, 120);
    const ext = (path.extname(origName) || '').toLowerCase() || ('.' + (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, ''));
    const fname = (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).slice(2))) + ext;
    const dir = path.join(__dirname, 'uploads', 'knowledge', uid);
    fs.mkdirSync(dir, { recursive: true });
    const stored = path.join(dir, fname);
    fs.writeFileSync(stored, buf);
    try {
      const r = await pool.query(
        "INSERT INTO knowledge_files (owner_id, title, filename, stored_path, mime, size, kind) VALUES ($1,$2,$3,$4,$5,$6, 'file') RETURNING id, title, filename, mime, size, kind, created_at",
        [uid, title, origName, stored, mime, buf.length]
      );
      return sendJSON(res, 201, { data: r.rows[0] });
    } catch (e) {
      try { fs.unlinkSync(stored); } catch (_) {}
      console.error('knowledge insert error', e);
      return sendJSON(res, 500, { error: '保存资料失败' });
    }
  }
  const km = pathname.match(/^\/api\/knowledge\/([^/]+)\/file$/);
  if (km && method === 'GET') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录' });
    const r = await pool.query('SELECT * FROM knowledge_files WHERE id=$1 AND owner_id=$2', [km[1], uid]);
    if (!r.rows.length) return sendJSON(res, 404, { error: '未找到该资料或无权限' });
    const row = r.rows[0];
    if (!fs.existsSync(row.stored_path)) return sendJSON(res, 404, { error: '文件已丢失' });
    const ext = path.extname(row.filename).toLowerCase();
    let ctype = MIME[ext] || row.mime || 'application/octet-stream';
    // 安全：即便库内残留 SVG，也强制以附件下载 + 非脚本 MIME，杜绝同源内联执行造成存储型 XSS
    if (ctype === 'image/svg+xml') ctype = 'application/octet-stream';
    const fileHeaders = Object.assign({}, SECURITY_HEADERS, {
      'Content-Type': ctype,
      'Content-Length': row.size,
      'Content-Disposition': 'attachment; filename="' + encodeURIComponent(row.filename) + '"'
    });
    res.writeHead(200, fileHeaders);
    fs.createReadStream(row.stored_path).pipe(res);
    return;
  }
  const kd = pathname.match(/^\/api\/knowledge\/([^/]+)$/);
  if (kd && method === 'DELETE') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录' });
    const r = await pool.query('SELECT * FROM knowledge_files WHERE id=$1 AND owner_id=$2', [kd[1], uid]);
    if (!r.rows.length) return sendJSON(res, 404, { error: '未找到该资料或无权限' });
    try { fs.unlinkSync(r.rows[0].stored_path); } catch (_) {}
    await pool.query('DELETE FROM knowledge_files WHERE id=$1 AND owner_id=$2', [kd[1], uid]);
    return sendJSON(res, 200, { data: { ok: true } });
  }

  // 单条：获取 / 更新 / 删除
  const m = pathname.match(/^\/api\/properties\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (method === 'GET') {
      const r = await pool.query('SELECT * FROM properties WHERE id=$1 AND owner_id=$2', [id, uid]);
      if (!r.rows.length) return sendJSON(res, 404, { error: '未找到该房源或无权限' });
      return sendJSON(res, 200, { data: r.rows[0] });
    }
    if (method === 'PUT') {
      let body;
      try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      const row = body || {};
      const r = await pool.query(
        `UPDATE properties SET
           title=COALESCE($2, title), location=COALESCE($3::jsonb, location),
           attributes=COALESCE($4::jsonb, attributes), media=COALESCE($5::jsonb, media),
           transaction=COALESCE($6::jsonb, transaction), facilities=COALESCE($7::jsonb, facilities),
           geo=COALESCE($8::jsonb, geo), notes=COALESCE($9, notes)
         WHERE id=$1 AND owner_id=$10 RETURNING *`,
        [id, row.title ?? null, jsonb(row.location), jsonb(row.attributes),
         jsonb(row.media), jsonb(row.transaction), jsonb(row.facilities),
         jsonb(row.geo), row.notes ?? null, uid]
      );
      if (!r.rows.length) return sendJSON(res, 404, { error: '未找到该房源或无权限' });
      return sendJSON(res, 200, { data: r.rows[0] });
    }
    if (method === 'DELETE') {
      const r = await pool.query('UPDATE properties SET deleted_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id', [id, uid]);
      if (!r.rowCount) return sendJSON(res, 404, { error: '未找到该房源或无权限' });
      return sendJSON(res, 200, { data: { ok: true } });
    }
  }

  // ---------- AI 通用调用封装：服务端代理 freellmapi（token 不落前端） ----------
  if (pathname === '/api/ai/status' && method === 'GET') {
    const configured = !!dbConfig.freellmApiKey;
    return sendJSON(res, 200, {
      data: {
        configured,
        baseUrl: String(dbConfig.freellmBaseUrl || ''),
        model: 'auto（由 freellmapi 路由器按你已配置的兜底链挑选模型）',
        note: configured ? '' : '请在环境变量或 .env 配置 FREELLM_API_KEY（freellmapi 统一令牌）'
      }
    });
  }

  if (pathname === '/api/ai/chat' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const messages = body.messages;
    const model = String(body.model || 'auto');
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
    const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : 1024;
    const stream = !!body.stream;

    let resp;
    try {
      resp = await callFreellm({ messages, model, temperature, maxTokens, stream });
    } catch (e) {
      return sendJSON(res, 502, { error: '调用 freellmapi 失败：' + e.message });
    }

    // 流式：直接转发上游 SSE（前端可用 fetch 流式读取 / 后续接 EventSource）
    if (stream) {
      if (!resp.ok) {
        let msg = 'freellmapi 返回 ' + resp.status;
        try { const t = await resp.text(); if (t) msg += '：' + t.slice(0, 200); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.end('data: ' + JSON.stringify({ error: msg }) + '\n\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      try {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
        res.end();
      } catch (e) {
        try { res.end('data: ' + JSON.stringify({ error: '流式转发失败：' + e.message }) + '\n\n'); } catch (_) {}
      }
      return;
    }

    // 非流式：解析 JSON，返回纯文本
    let j;
    try { j = await resp.json(); } catch (e) {
      return sendJSON(res, 502, { error: 'freellmapi 返回非 JSON（可能地址/端口不对或未启动）' });
    }
    if (!resp.ok) return sendJSON(res, resp.status === 401 ? 401 : 502, { error: 'freellmapi 错误：' + JSON.stringify(j.error || j) });
    const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return sendJSON(res, 200, {
      data: {
        content,
        model: j.model || model,
        routedVia: resp.headers.get('x-routed-via') || (j.model || model), // 实际由哪家/哪个模型服务
        usage: j.usage || null
      }
    });
  }
  if (pathname === '/api/ai/extract' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const text = body.text != null ? String(body.text) : '';
    const url = body.url != null ? String(body.url).trim() : '';
    const images = Array.isArray(body.images) ? body.images.filter(x => typeof x === 'string' && x.length) : [];
    if (!text && !url && !images.length) return sendJSON(res, 400, { error: '请提供文本、链接或截图' });
    try {
      let pageText = '';
      let platform = null;
      const warnings = [];
      console.log('[AI-EXTRACT] 收到请求 url=', url, ' textLen=', text.length, ' images=', images.length);
      if (url) {
        platform = detectPlatform(url);
        console.log('[AI-EXTRACT] 识别平台=', platform, ' 原始url=', url);
        const fetched = await fetchUrlText(url);
        console.log('[AI-EXTRACT] 抓取结果 ok=', fetched.ok, ' status=', fetched.status || '', ' err=', fetched.error || '', ' htmlLen=', fetched.html ? fetched.html.length : 0);
        if (!fetched.ok) {
          warnings.push('链接抓取失败（' + (fetched.status || fetched.error || '网络错误') + '），可改用手动粘贴文本或截图。');
        } else {
          pageText = extractPageContent(fetched.html);
          console.log('[AI-EXTRACT] 提取正文长度=', pageText.length);
          if (!pageText || pageText.length < 50) warnings.push('该链接未抓到有效正文（可能是 JS 动态渲染或需要登录），可改用手动粘贴文本或截图。');
        }
      }
      const useImages = images.length > 0;
      let userContent;
      if (useImages) {
        userContent = '请根据下方房源信息（含图片、文字、网页正文）提取结构化字段。' +
          (text ? '\n\n【用户文字】\n' + text : '') +
          (pageText ? '\n\n【网页正文】\n' + pageText : '') +
          (platform ? '\n\n【来源平台】' + platform : '') + '\n\n只返回 JSON。';
      } else {
        userContent = (text ? '【用户文字】\n' + text + '\n\n' : '') +
          (pageText ? '【网页正文】\n' + pageText + '\n\n' : '') +
          (platform ? '【来源平台】' + platform + '\n\n' : '') +
          '请从以上内容提取房源结构化字段，只返回 JSON。';
      }
      const model = useImages ? (dbConfig.freellmVisionModel || 'auto') : 'auto';
      const llmResp = await callFreellm({
        model,
        temperature: 0.2,
        maxTokens: 1500,
        messages: [
          { role: 'system', content: AI_EXTRACT_SCHEMA },
          { role: 'user', content: userContent }
        ],
        images: useImages ? images : null
      });
      if (!llmResp.ok) {
        const errTxt = await llmResp.text().catch(() => '');
        return sendJSON(res, 502, { error: 'freellmapi 返回错误（' + llmResp.status + (errTxt ? '）：' + errTxt.slice(0, 200) : '）') });
      }
      const data = await llmResp.json().catch(() => null);
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) return sendJSON(res, 502, { error: 'freellmapi 返回内容为空' });
      let fields;
      try { fields = parseLlmJson(content); }
      catch (e) { return sendJSON(res, 502, { error: 'AI 返回的不是有效 JSON，请重试或换模型' }); }
      if (platform && fields && fields.transaction) {
        fields.transaction.sourcePlatform = fields.transaction.sourcePlatform || platform;
      }
      console.log('[AI-EXTRACT] 完成 platform=', platform, ' warnings=', JSON.stringify(warnings), ' fieldsKeys=', fields ? Object.keys(fields) : []);
      return sendJSON(res, 200, {
        data: {
          fields: fields || {},
          platform: platform || (fields && fields.transaction && fields.transaction.sourcePlatform) || null,
          warnings
        }
      });
    } catch (e) {
      console.error('ai extract error', e);
      return sendJSON(res, 500, { error: 'AI 识别失败：' + e.message });
    }
  }

  return sendJSON(res, 404, { error: '接口不存在' });
}

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska'
};

function serveStatic(req, res, url) {
  let urlPath = decodeURIComponent(url.pathname.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { head(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { head(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const isMedia = filePath.startsWith(path.join(ROOT, 'media'));
    // 禁用启发式缓存：本地开发频繁改版，必须每次拿到最新文件（no-cache 仍允许 304 协商）
    head(res, 200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, isMedia);
    res.end(data);
  });
}

// ---------- 启动 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      console.log('[upload] >>> 路由命中 /api/upload (POST)');
      try { await handleUpload(req, res); } catch (e) {
        console.error('upload error', e);
        if (!res.headersSent) sendJSON(res, 500, { error: '上传失败：' + e.message });
      }
      return;
    }
    try {
      await handleApi(req, res, url);
    } catch (e) {
      console.error('API error', e);
      if (!res.headersSent) sendJSON(res, 500, { error: '服务器内部错误' });
    }
    return;
  }
  serveStatic(req, res, url);
});

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ 已连接到本地 PostgreSQL（house_view）');
  } catch (e) {
    console.error('⚠️ 无法连接本地 PostgreSQL：', e.message);
    console.error('   请确认 PostgreSQL 服务已启动，且 config/db.js 中的账号密码正确。');
  }
  try {
    await ensureSchema();
    console.log('✅ 数据表已就绪（users / properties）');
  } catch (e) {
    console.error('⚠️ 建表失败：', e.message);
  }
  server.listen(PORT, () => {
    console.log(`看房记录工具已启动： http://127.0.0.1:${PORT}/`);
    console.log(`（数据保存在本地 PostgreSQL：house_view 库，不联网、不上传）`);
  });
}

start();

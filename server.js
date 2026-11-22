// ============================================================
// 择隅 —— 本地后端服务
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
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const dns = require('dns');
const net = require('net');
const tls = require('tls');
const { Pool } = require('pg');
const dbConfig = require('./config/db');
// 每账号多模型清单：脱敏 / 合并 / 校验 / 选当前（唯一实现，纯函数）
const aiProviders = require('./ai-providers');

// [诊断] 全局崩溃兜底：任意未捕获异常/拒绝都先打印，避免进程直接退出导致所有连接被重置（ERR_CONNECTION_RESET）
process.on('uncaughtException', (e) => { console.error('[FATAL uncaughtException]', e && e.stack || e); });
process.on('unhandledRejection', (e) => { console.error('[FATAL unhandledRejection]', e && e.stack || e); });

const PORT = process.env.PORT || 8787;
const ROOT = path.join(__dirname, 'public');

// 数据库可切换：默认仍是原来的 PostgreSQL（本地开发 / 已有数据库服务）；
// HVT_DB=embedded 时改用内嵌 PostgreSQL（PGlite/WASM），服务器上无需安装任何数据库。
// 两者的 query(sql, params) → { rows, rowCount } 语义一致，业务 SQL 零改动。
const EMBEDDED_DB = process.env.HVT_DB === 'embedded';
const pool = EMBEDDED_DB
  ? require('./config/db-embedded')
  : new Pool(dbConfig);

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
  // frame-src 仅放行同源（装修设计页用同源 iframe 承载 3D 户型编辑器），不放开外部站点；
  // object-src / base-uri 保持收紧，用户可控文本一律 escHtml 转义。
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://webapi.amap.com https://*.amap.com https://*.autonavi.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    // http: 仅兜底本地 http 开发时高德个别图标/瓦片走明文；HTTPS 部署下浏览器会自行拦截混合内容
    "img-src 'self' data: blob: https: http:; media-src 'self' https:; font-src 'self' data: https:; " +
    // 放行版本文件托管域名：关于页「检查更新 / 版本记录」要 fetch UPDATE_URL（GitHub raw / Gitee / jsDelivr 镜像）
    "connect-src 'self' https://webapi.amap.com https://restapi.amap.com https://*.amap.com https://*.autonavi.com https://raw.githubusercontent.com https://gitee.com https://raw.giteeusercontent.com https://fastly.jsdelivr.net https://cdn.jsdelivr.net; " +
    "worker-src 'self' blob:; " +
    "frame-src 'self'; object-src 'none'; base-uri 'self'"
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
function loginOk(ip) { loginFails.delete(ip); }

// ---------- 运行监控：登录日志 / 模型流量 ----------
// 铁律：日志一律异步 best-effort，写失败/库短暂不可用绝不影响登录与 AI 调用。
// 管理员只认 .env 里显式列出的 ADMIN_EMAILS（逗号分隔），不猜「第一个注册的用户」，
// 避免测试账号意外拿到全局可见权限。日志不记密码、验证码、令牌、提问正文、图片。
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
);
const MONITOR_RETENTION_DAYS = 90;
function monText(v, n) { return String(v == null ? '' : v).slice(0, n); }
function monInt(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; }
function monHost(base) {
  try { return monText(new URL(base).hostname, 120) || monText(base, 120); }
  catch (_) { return monText(base, 120); }
}
async function isAdmin(uid) {
  if (!uid || !ADMIN_EMAILS.size) return false;
  try {
    const r = await pool.query('SELECT email FROM users WHERE id=$1', [uid]);
    return !!(r.rows[0] && ADMIN_EMAILS.has(String(r.rows[0].email).toLowerCase()));
  } catch (_) { return false; }
}
function logWrite(sql, args, tag) {
  try { pool.query(sql, args).catch(e => console.warn('[monitor] ' + tag + ' 写入失败：', e.message)); }
  catch (e) { console.warn('[monitor] ' + tag + ' 异常：', e.message); }
}
function writeAuthLog(req, o) {
  logWrite(
    'INSERT INTO auth_logs (owner_id,email,action,ok,reason,ip,ua) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [o.uid || null, monText(o.email, 200) || null, monText(o.action, 32), !!o.ok,
      o.reason ? monText(o.reason, 160) : null, monText(clientIp(req), 64),
      monText(req && req.headers && req.headers['user-agent'], 200)],
    '登录日志'
  );
}
// 上游 usage 字段名各家不一（OpenAI / Anthropic / 国产网关），统一成三个数字
function usageOf(j) {
  const u = j && j.usage;
  if (!u || typeof u !== 'object') return null;
  const p = monInt(u.prompt_tokens != null ? u.prompt_tokens : u.input_tokens);
  const c = monInt(u.completion_tokens != null ? u.completion_tokens : u.output_tokens);
  const t = monInt(u.total_tokens != null ? u.total_tokens : (p + c));
  if (!p && !c && !t) return null;
  return { prompt_tokens: p, completion_tokens: c, total_tokens: t || (p + c) };
}
// 上游没回 usage 时按字符粗估输入 token，并打 estimated 标记，绝不冒充精确值
function estimatePromptTokens(messages) {
  let chars = 0;
  for (const m of (messages || [])) {
    const c = m && m.content;
    chars += typeof c === 'string' ? c.length : (c ? JSON.stringify(c).length : 0);
  }
  return Math.max(1, Math.round(chars / 2.2));
}
function writeAiLog(seed, extra) {
  const u = extra && extra.usage;
  const est = !u && !!(extra && extra.promptEstimate);
  const p = u ? u.prompt_tokens : ((extra && extra.promptEstimate) || 0);
  const c = u ? u.completion_tokens : 0;
  const t = u ? u.total_tokens : p;
  logWrite(
    `INSERT INTO ai_usage_logs
       (owner_id,entry,channel,provider,model,stream,prompt_tokens,completion_tokens,total_tokens,estimated,latency_ms,ok,status_code,error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [seed.owner_id || null, monText(seed.entry, 32), monText(seed.channel, 16),
      monText(seed.provider, 120), monText(seed.model, 120), !!seed.stream,
      monInt(p), monInt(c), monInt(t), est, monInt(extra && extra.latencyMs),
      !!(extra && extra.ok), (extra && extra.statusCode) || null,
      (extra && extra.error) ? monText(extra.error, 300) : null],
    '模型流量'
  );
}
// 图形验证码由 /api/auth/captcha 签发、一次性校验；密码登录每次都要过，不再按失败次数渐进触发。

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
  // AI 直连通道（旧版单模型）：四个列保留不动，随时可一键回退。
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_direct_enabled boolean NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_direct_base_url text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_direct_api_key text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_direct_model text;`);
  // 多模型清单：一张服务商卡共享地址 + Key，下面挂多个具体模型（含类型标注）。
  // ai_active_provider 存 '服务商ID::模型ID'；旧值只有服务商ID时由 pickActive() 取第一行，
  // 因此无需数据库迁移。密钥只存服务端（jsonb 内），userPublic() 只下发 keySet 布尔。
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_providers jsonb NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_active_provider text NOT NULL DEFAULT '';`);
  // 一次性迁移：把旧的单模型配置转成清单里的一条，避免升级后用户原来的配置消失。
  // 旧四列不清空，回退时仍可读。
  await pool.query(`
    UPDATE users
       SET ai_providers = jsonb_build_array(jsonb_build_object(
             'id', 'legacy', 'preset', 'custom', 'name', '原有自定义模型',
             'baseUrl', ai_direct_base_url,
             'model', ai_direct_model,
             'apiKey', COALESCE(ai_direct_api_key, '')
           )),
           ai_active_provider = 'legacy'
     WHERE ai_providers = '[]'::jsonb
       AND ai_direct_base_url IS NOT NULL AND btrim(ai_direct_base_url) <> ''
  `);
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
  // 历史成交价：按小区聚合的成交记录（按账号隔离，插件/手动录入共用一条一条存）
  // 一条 = 一次成交；按 (owner, city, district, community) 聚合查询，方便同小区多套房源共享比价数据。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_deals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      city text NOT NULL DEFAULT '',
      district text NOT NULL DEFAULT '',
      community text NOT NULL,
      layout text NOT NULL DEFAULT '',
      area numeric,
      floor text NOT NULL DEFAULT '',
      total_price numeric,
      unit_price numeric,
      list_price numeric,
      deal_date date,
      deal_cycle text NOT NULL DEFAULT '',
      agent text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS community_deals_lookup_idx ON community_deals(owner_id, city, district, community);`);
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
  // ---------- 运行监控：登录日志 + 模型流量 ----------
  // owner_id 可空：登录失败时可能还没有对应的用户（例如邮箱不存在、验证码错误）。
  // 查询时普通用户按 owner_id 过滤，再补上「同邮箱且 owner_id 为空」的失败记录。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_logs (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
      email text,
      action text NOT NULL,
      ok boolean NOT NULL,
      reason text,
      ip text,
      ua text
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS auth_logs_created_idx ON auth_logs(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS auth_logs_owner_idx ON auth_logs(owner_id, created_at DESC);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
      entry text NOT NULL,
      channel text,
      provider text,
      model text,
      stream boolean NOT NULL DEFAULT false,
      prompt_tokens integer NOT NULL DEFAULT 0,
      completion_tokens integer NOT NULL DEFAULT 0,
      total_tokens integer NOT NULL DEFAULT 0,
      estimated boolean NOT NULL DEFAULT false,
      latency_ms integer,
      ok boolean NOT NULL,
      status_code integer,
      error text
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage_logs(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ai_usage_owner_idx ON ai_usage_logs(owner_id, created_at DESC);`);
  // 保留 90 天：只在启动时清一次，不在长驻进程里挂定时器（少一个出错点）
  const monClean = (t) => pool.query(
    `DELETE FROM ${t} WHERE created_at < now() - ($1::int * interval '1 day')`, [MONITOR_RETENTION_DAYS]
  ).catch(e => console.warn('[monitor] 清理 ' + t + ' 失败：', e.message));
  await monClean('auth_logs');
  await monClean('ai_usage_logs');
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
// 邮箱验证码总开关（.env 的 EMAIL_VERIFICATION，默认 false）。
// false：注册只过图形验证码；邮件相关的「验证码登录/找回密码」在前后端都禁用。
// true ：完整邮件验证，必须配齐 SMTP（未配置时明确报错，不静默放行）。
const EMAIL_VERIFICATION = dbConfig.emailVerification;
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
    <h2 style="margin:0 0 16px;font-size:20px">择隅 · 邮箱验证码</h2>
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
    exp: Date.now() + 1000 * 60 * 60 * 2 // 2 小时：几天不访问后令牌必然过期，需重新登录
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

// ---------- 一键自升级（管理员专用，异步 + 状态轮询）----------
const { createUpgrader } = require('./upgrade');
const upgrader = createUpgrader({
  appDir: __dirname,
  dataDir: (typeof EMBEDDED_DB !== 'undefined' && EMBEDDED_DB && require('./config/db-embedded').embeddedDataDir()) || path.join(__dirname, 'data'),
  serviceName: 'house-view-tracker',
  assertSafeUrl,
  log: console.log
});
// 版本文件地址沿用前端 config.js 的 UPDATE_URL（单一数据源，不另开配置）。
function updateUrl() {
  try {
    const s = fs.readFileSync(path.join(__dirname, 'public', 'config.js'), 'utf8');
    const m = s.match(/UPDATE_URL\s*:\s*['"]([^'"]+)['"]/);
    return (m && m[1] || '').trim();
  } catch (_) { return ''; }
}
// 读服务器本地 version.json 的完整内容（版本号 / 发布日 / 本版说明 / 更新记录）。
// v1.8.7：关于页的时间轴只认这份——远程仓库那份可能被 CDN 缓存成旧提交，
// 拿它渲染会出现「页头写 v1.8.6、时间轴却把 v1.8.5 标成当前版本」的自相矛盾。
function readLocalVersion() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')) || {};
    return {
      version: String(j.version || '').trim(),
      date: String(j.date || '').trim(),
      notes: String(j.notes || ''),
      changelog: Array.isArray(j.changelog) ? j.changelog : []
    };
  } catch (_) { return { version: '', date: '', notes: '', changelog: [] }; }
}
function localVersion() { return readLocalVersion().version; }
// 版本文件备用镜像：读 config.js 的 UPDATE_MIRRORS 数组（与前端同一份配置，不另开开关）。
function updateMirrors() {
  try {
    const s = fs.readFileSync(path.join(__dirname, 'public', 'config.js'), 'utf8');
    const m = s.match(/UPDATE_MIRRORS\s*:\s*\[([\s\S]*?)\]/);
    if (!m) return [];
    return (m[1].match(/['"]([^'"]+)['"]/g) || []).map((x) => x.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
  } catch (_) { return []; }
}
// 服务端拉取远端版本信息（走与前端同一批地址，但由服务端请求，绕开浏览器 CSP）。
// v1.8.3：多源并发竞速 + 单源 8 秒超时 + 全挂回落 data/version-cache.json，
// 避免 raw.githubusercontent.com 一次 ETIMEDOUT 就让「检查更新 / 一键升级」整条不可用。
async function fetchRemoteVersion() {
  const url = updateUrl();
  if (!url) throw new Error('未配置 UPDATE_URL（public/config.js）');
  const list = upgrader.versionSources(url, updateMirrors());
  const usable = [];
  for (const u of list) {
    try { await assertSafeUrl(u); usable.push(u); }
    catch (e) { console.warn('[upgrade] 跳过不安全的版本源 ' + u + '：' + e.message); }
  }
  if (!usable.length) throw new Error('没有可用的版本文件地址');
  const r = await upgrader.fetchVersion(usable);
  const data = Object.assign({}, r.data);
  // 用 __ 前缀元信息，避免和 version.json 自己的字段撞名；调用方只读 version/notes 等
  data.__source = r.source || '';
  data.__cached = !!r.cached;
  data.__cachedAt = Number(r.cachedAt) || 0;
  data.__tried = usable.length;
  return data;
}

// ---------- 流式进度（SSE）----------
// 识别一次可能几十秒到几分钟（思考型模型更慢），不能让用户只盯着转圈、也不知道走到哪一步。
// 这里不设总时长上限——用户可能只配了一个慢模型，掐断就等于不可用；
// 进度靠流实时回传，用户想不等了随时可以点「停止等待」。
function openSSE(res) {
  head(res, 200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  let closed = false;
  res.on('close', () => { closed = true; });
  return {
    get closed() { return closed; },
    send(type, data) {
      if (closed) return;
      try { res.write('data: ' + JSON.stringify(Object.assign({ type }, data || {})) + '\n\n'); }
      catch (_) { closed = true; }
    },
    end() { if (!closed) { try { res.end(); } catch (_) {} } }
  };
}

// 读上游 chat/completions 的流：边读边回调（进度就是这么来的），最后拼出完整内容。
// 有的服务商会忽略 stream:true 直接回整段 JSON，这里按 content-type 分流兜底。
async function pumpChatStream(resp, onDelta) {
  const ct = String(resp.headers.get('content-type') || '');
  if (!/text\/event-stream/i.test(ct)) {
    const j = await resp.json().catch(() => null);
    const ch = j && j.choices && j.choices[0];
    const txt = (ch && ch.message && ch.message.content) || '';
    if (txt && onDelta) onDelta(txt, 'content');
    return { content: txt, reasoning: '', finish: (ch && ch.finish_reason) || null, usage: (j && j.usage) || null, json: j };
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '', content = '', reasoning = '', finish = null, usage = null;
  const eat = (block) => {
    for (const raw of block.split('\n')) {
      const s = raw.trim();
      if (!s || s[0] === ':' || !s.startsWith('data:')) continue;
      const p = s.slice(5).trim();
      if (!p || p === '[DONE]') continue;
      let j; try { j = JSON.parse(p); } catch (_) { continue; }
      if (j.usage) usage = j.usage;
      const ch = j.choices && j.choices[0];
      if (!ch) continue;
      if (ch.finish_reason) finish = ch.finish_reason;
      const d = ch.delta || ch.message || {};
      if (d.reasoning_content) { reasoning += d.reasoning_content; if (onDelta) onDelta(d.reasoning_content, 'reasoning'); }
      if (d.content) { content += d.content; if (onDelta) onDelta(d.content, 'content'); }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { eat(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (buf.trim()) eat(buf);
  return { content, reasoning, finish, usage };
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
// 技能接口专用：允许更大的请求体，且超限时**正常回 413**而不是断开连接。
// readBody 的上限是全局 1M 字符、超了直接 destroy（客户端看到 ECONNRESET），
// 那是给普通接口防炸用的，这里不能改它（会影响所有接口），单独给一个。
function readBodyLimit(req, softMax, hardMax) {
  return new Promise((resolve, reject) => {
    let data = '', size = 0, tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > hardMax) { try { req.destroy(); } catch (_) {} return; }
      if (size > softMax) { tooLarge = true; data = ''; return; } // 继续 drain，避免 RST
      data += c;
    });
    req.on('end', () => {
      if (tooLarge) {
        const e = new Error('请求体过大（上限 ' + Math.round(softMax / 1048576) + 'MB）');
        e.code = 'TOO_LARGE';
        return reject(e);
      }
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
  const { messages, model = 'auto', temperature = 0.7, maxTokens = 1024, stream = false, images = null, endpoint = null, signal = null, meta = null } = opts || {};
  if (!Array.isArray(messages) || !messages.length) throw new Error('messages 不能为空');
  // endpoint = 该用户在设置页自配的直连通道；没传就用系统级 freellmapi 网关（自动选模型）
  const base = String((endpoint && endpoint.base) || dbConfig.freellmBaseUrl || '').replace(/\/+$/, '');
  const key = (endpoint && endpoint.key) || dbConfig.freellmApiKey;
  if (!base) throw new Error('未配置 AI 接口地址');
  if (!key) throw new Error('未配置 AI 接口密钥');
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
  // ---------- 模型流量埋点 ----------
  // meta 由调用方传入（uid + 业务入口）；只记元数据与 token 数，绝不记提问正文 / 图片 / Key。
  const seed = {
    owner_id: (meta && meta.uid) || null,
    entry: (meta && meta.entry) || 'chat',
    channel: (endpoint && endpoint.channel) || 'gateway',
    provider: monHost(base),
    model: String(model || ''),
    stream: !!stream,
    promptEstimate: estimatePromptTokens(finalMessages)
  };
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  let resp;
  try {
    resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model, messages: finalMessages, temperature, max_tokens: maxTokens, stream }),
      signal: signal || undefined
    });
  } catch (e) {
    writeAiLog(seed, { ok: false, latencyMs: ms(), error: e && e.message });
    throw e;
  }
  if (!resp.ok) {
    // 只读 clone，主响应体仍留给调用方处理
    resp.clone().text()
      .then(txt => writeAiLog(seed, { ok: false, statusCode: resp.status, latencyMs: ms(), error: (txt || '').slice(0, 300) || ('HTTP ' + resp.status) }))
      .catch(() => writeAiLog(seed, { ok: false, statusCode: resp.status, latencyMs: ms() }));
    return resp;
  }
  if (stream && resp.body && typeof resp.body.tee === 'function') {
    // 流式：tee 一路只用来嗅探 usage，主路原样交给调用方转发，实时性不变
    try {
      const [main, probe] = resp.body.tee();
      resp = new Response(main, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
      (async () => {
        const reader = probe.getReader(), dec = new TextDecoder('utf-8');
        let buf = '', last = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            for (const raw of block.split('\n')) {
              const s = raw.trim();
              if (!s.startsWith('data:')) continue;
              const p = s.slice(5).trim();
              if (!p || p === '[DONE]') continue;
              try { const j = JSON.parse(p); if (j.usage) last = usageOf(j); } catch (_) {}
            }
          }
        }
        writeAiLog(seed, { ok: true, statusCode: 200, usage: last, latencyMs: ms() });
      })().catch(() => writeAiLog(seed, { ok: true, statusCode: 200, latencyMs: ms() }));
    } catch (_) {
      writeAiLog(seed, { ok: true, statusCode: resp.status, latencyMs: ms() });
    }
  } else {
    resp.clone().json()
      .then(j => writeAiLog(seed, { ok: true, statusCode: resp.status, usage: usageOf(j), latencyMs: ms() }))
      .catch(() => writeAiLog(seed, { ok: true, statusCode: resp.status, latencyMs: ms() }));
  }
  return resp;
}

// 每账号可在「模型清单」里配多个服务商、每个服务商下多个模型；
// ai_active_provider（'服务商ID::模型ID'）指定当前生效的那一个具体模型。
// 类型标注只用于展示/筛选，不参与这里的选路；三个 AI 接口拿到的仍是同一个 model 名。
// 未启用走默认网关；启用却没选 / 没填齐一律明确报错，绝不静默回落网关。
// 密钥只在这里从库里读出，绝不经过前端；出站地址再过一次 SSRF 校验。
async function resolveAiEndpoint(uid, requestedModel) {
  const fallback = {
    base: String(dbConfig.freellmBaseUrl || '').replace(/\/+$/, ''),
    key: dbConfig.freellmApiKey,
    model: requestedModel || 'auto',
    channel: 'gateway'
  };
  if (!uid) return fallback;
  const r = await pool.query(
    'SELECT ai_direct_enabled, ai_direct_base_url, ai_direct_api_key, ai_direct_model, ai_providers, ai_active_provider FROM users WHERE id=$1', [uid]
  );
  const u = r.rows[0];
  if (!u) return fallback;
  const picked = aiProviders.pickActive(u.ai_providers, u.ai_active_provider, !!u.ai_direct_enabled, u);
  if (!picked.ok) {
    throw new Error('AI 直连已启用但配置不完整：请在「设置 → AI 功能」补齐 ' +
      picked.missing.join('、') + '，或关闭直连');
  }
  if (!picked.provider) return fallback;
  const base = picked.provider.baseUrl.replace(/\/+$/, '');
  try { await assertSafeUrl(base); }
  catch (e) { throw new Error('AI 直连接口地址不安全：' + e.message); }
  return {
    base, key: picked.provider.apiKey,
    model: (requestedModel && requestedModel !== 'auto') ? requestedModel : picked.provider.model,
    channel: 'direct'
  };
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
    mapEnabled: !!r0.map_enabled,
    // AI 直连：密钥明文绝不下发，只告诉前端「有没有配」
    aiDirectEnabled: !!r0.ai_direct_enabled,
    aiDirectBaseUrl: r0.ai_direct_base_url || '',
    aiDirectModel: r0.ai_direct_model || '',
    aiDirectKeySet: !!(r0.ai_direct_api_key && String(r0.ai_direct_api_key).trim()),
    // 多模型清单：只下发脱敏视图（keySet 布尔），apiKey 明文绝不下发
    aiProviders: aiProviders.sanitizeProviders(r0.ai_providers),
    aiActiveProvider: r0.ai_active_provider || ''
  };
}

// ---------- 路由 ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  // 公开：登录页需要知道的非敏感开关（邮箱验证码是否启用）。只回布尔值，不下发任何密钥/SMTP 配置。
  if (pathname === '/api/auth/config' && method === 'GET') {
    return sendJSON(res, 200, { data: { emailVerification: EMAIL_VERIFICATION } },
      { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  }

  // 公开：本机（服务器）实际运行版本的说明 + 更新记录，读程序目录的 version.json。
  // 只含版本号/日期/说明/更新记录这类公开信息，不含任何密钥，因此不需要登录。
  // 关于页时间轴以它为准，远程 UPDATE_URL 只在旧服务端（没有本接口）时作兜底。
  if (pathname === '/api/version' && method === 'GET') {
    return sendJSON(res, 200, { data: readLocalVersion() }, { 'Cache-Control': 'no-store' });
  }

  // 公开：验证码挑战（不缓存，答案只留在服务端）
  if (pathname === '/api/auth/captcha' && method === 'GET') {
    return sendJSON(res, 200, { data: newCaptcha() }, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  }

  // 公开：图形验证码正确后才发送邮箱验证码（注册 / 验证码登录 / 找回密码共用）
  if (pathname === '/api/auth/email-code' && method === 'POST') {
    // 邮箱验证码关闭时一律不发码（前端也不显示发码入口），避免绕过开关制造可用验证码。
    if (!EMAIL_VERIFICATION) {
      return sendJSON(res, 403, { error: '系统未启用邮箱验证码' });
    }
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
      await sendMail(email, `【择隅】${EMAIL_PURPOSE_LABEL[purpose]}验证码`, emailCodeMailHtml(EMAIL_PURPOSE_LABEL[purpose], code));
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
    if (EMAIL_VERIFICATION) {
      // 开启：图形验证码已在 email-code 阶段一次性消耗，这里只认邮箱验证码，防止绕过发码直接注册
      const codeOk = await consumeEmailCode(email, 'register', body.emailCode);
      if (!codeOk) {
        loginFail(ip);
        writeAuthLog(req, { email, action: 'register', ok: false, reason: 'email_code_invalid' });
        return sendJSON(res, 400, { error: '邮箱验证码不正确或已过期，请重新获取' });
      }
    } else {
      // 关闭：不校验邮箱（开箱即用），但必须过一次性图形验证码，防止机器人批量刷号
      if (!verifyCaptcha(body.captchaId, body.captchaAnswer)) {
        loginFail(ip);
        writeAuthLog(req, { email, action: 'register', ok: false, reason: 'captcha_invalid' });
        return sendJSON(res, 400, { error: '验证未通过，请重新完成验证' });
      }
    }
    const hash = await hashPassword(password);
    try {
      const name = body.name ? String(body.name).trim().slice(0, 40) : null;
      const r = await pool.query(
        'INSERT INTO users (email, password_hash, name, avatar) VALUES ($1,$2,$3,$4) RETURNING id, email, name, avatar, demand, amap_js_key, amap_security_code, map_enabled, ai_direct_enabled, ai_direct_base_url, ai_direct_api_key, ai_direct_model, ai_providers, ai_active_provider',
        [email, hash, name, null]
      );
      const r0 = r.rows[0];
      loginOk(ip);
      writeAuthLog(req, { uid: r0.id, email, action: 'register', ok: true });
      return sendJSON(res, 201, { data: { token: signToken(r0.id, r0.token_version || 0), user: userPublic(r0) } });
    } catch (e) {
      loginFail(ip);
      writeAuthLog(req, { email, action: 'register', ok: false, reason: 'register_failed' });
      // 邮箱已被占用（唯一约束冲突）→ 明确告知，别把原因错误归到「邮箱格式」上。
      // 注意：注册接口本身即可用于探测邮箱是否注册，模糊化在这里几乎不产生额外防护，
      // 反而会误导用户；防账号枚举真正的关键在登录路径（不区分「邮箱不存在/密码错误」）。
      if (String(e.code) === '23505') return sendJSON(res, 409, { error: '该邮箱已注册，请直接登录' });
      console.error('register error', e);
      return sendJSON(res, 500, { error: '注册失败，请稍后重试' });
    }
  }

  // 密码登录：每次都必须先过一次性图形验证码（前端点「登录」先弹窗，答对后才提交）。
  // 后端强制校验：不带/过期/答错一律拒绝，且不计入密码失败限流（避免用无效挑战把 IP 锁死）。
  if (pathname === '/api/auth/login' && method === 'POST') {
    const ip = clientIp(req);
    if (loginLimited(ip)) return sendJSON(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    if (!verifyCaptcha(body.captchaId, body.captchaAnswer)) {
      writeAuthLog(req, { email: String(body.email || '').trim().toLowerCase(), action: 'login_pwd', ok: false, reason: 'captcha_invalid' });
      return sendJSON(res, 400, { error: '验证未通过，请重新完成验证' });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const r = await pool.query('SELECT id, email, password_hash, name, avatar, demand, token_version, amap_js_key, amap_security_code, map_enabled, ai_direct_enabled, ai_direct_base_url, ai_direct_api_key, ai_direct_model, ai_providers, ai_active_provider FROM users WHERE email=$1', [email]);
    const vr = r.rows.length
      ? await verifyPassword(password, r.rows[0].password_hash)
      : { ok: false, needsUpgrade: false };
    if (!vr.ok) {
      loginFail(ip);
      writeAuthLog(req, { uid: r.rows[0] && r.rows[0].id, email, action: 'login_pwd', ok: false, reason: 'bad_credentials' });
      return sendJSON(res, 401, { error: '邮箱或密码不正确' });
    }
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
    writeAuthLog(req, { uid: r0.id, email, action: 'login_pwd', ok: true });
    return sendJSON(res, 200, { data: { token: signToken(r0.id, r0.token_version || 0), user: userPublic(r0) } });
  }

  // 验证码登录（免密）：邮箱 + 一次性邮箱验证码；发码时已过图形验证，这里只认邮箱码。
  // 账号不存在时复用同一句错误文案，避免被拿来枚举注册邮箱。
  if (pathname === '/api/auth/login-code' && method === 'POST') {
    if (!EMAIL_VERIFICATION) {
      return sendJSON(res, 403, { error: '系统未启用验证码登录，请使用密码登录' });
    }
    const ip = clientIp(req);
    if (loginLimited(ip)) return sendJSON(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return sendJSON(res, 400, { error: '请输入有效的邮箱地址' });
    const codeOk = await consumeEmailCode(email, 'code-login', body.emailCode);
    if (!codeOk) {
      loginFail(ip);
      writeAuthLog(req, { email, action: 'login_code', ok: false, reason: 'email_code_invalid' });
      return sendJSON(res, 400, { error: '验证码不正确或已过期，请重新获取' });
    }
    const r = await pool.query('SELECT id, email, name, avatar, demand, token_version, amap_js_key, amap_security_code, map_enabled, ai_direct_enabled, ai_direct_base_url, ai_direct_api_key, ai_direct_model, ai_providers, ai_active_provider FROM users WHERE email=$1', [email]);
    if (!r.rows.length) {
      loginFail(ip);
      writeAuthLog(req, { email, action: 'login_code', ok: false, reason: 'account_not_found' });
      return sendJSON(res, 400, { error: '验证码不正确或已过期，请重新获取' });
    }
    loginOk(ip);
    const r0 = r.rows[0];
    writeAuthLog(req, { uid: r0.id, email, action: 'login_code', ok: true });
    return sendJSON(res, 200, { data: { token: signToken(r0.id, r0.token_version || 0), user: userPublic(r0) } });
  }

  // 公开：找回密码（P2）—— 邮箱验证码 + 新密码，成功后自增 token_version 踢掉所有旧设备
  // 邮箱验证关闭时禁用：没有邮件核验身份，绝不能让人填个邮箱就改别人密码。
  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    if (!EMAIL_VERIFICATION) {
      return sendJSON(res, 403, { error: '系统未启用邮箱验证，无法通过邮件找回密码，请联系管理员' });
    }
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
    writeAuthLog(req, { uid: r.rows[0].id, email, action: 'reset_password', ok: true });
    return sendJSON(res, 200, { data: { ok: true } });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录或登录已过期' });
    const r = await pool.query('SELECT id, email, name, avatar, demand, amap_js_key, amap_security_code, map_enabled, ai_direct_enabled, ai_direct_base_url, ai_direct_api_key, ai_direct_model, ai_providers, ai_active_provider FROM users WHERE id=$1', [uid]);
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
    // AI 直连配置（旧版单模型四列保留，供一键回退）：密钥只写库，不回显
    const aiDirectEnabled = (body.aiDirectEnabled === true || body.aiDirectEnabled === 'true') ? true
      : (body.aiDirectEnabled === false || body.aiDirectEnabled === 'false') ? false : null;
    const aiDirectBaseUrl = body.aiDirectBaseUrl != null ? String(body.aiDirectBaseUrl).trim().slice(0, 300) : null;
    const aiDirectApiKey = body.aiDirectApiKey != null ? String(body.aiDirectApiKey).trim().slice(0, 300) : null;
    const aiDirectModel = body.aiDirectModel != null ? String(body.aiDirectModel).trim().slice(0, 120) : null;
    if (aiDirectBaseUrl) {
      try { await assertSafeUrl(aiDirectBaseUrl); }
      catch (e) { return sendJSON(res, 400, { error: 'AI 接口地址不合法：' + e.message }); }
    }
    // 多模型清单：前端提交「脱敏视图 + 新填的 Key」。Key 留空 = 保留库里旧值，
    // 传 '__clear__' = 清除；合并/白名单/去重在 ai-providers.js（唯一实现）。
    const aiProvidersIn = (body.aiProviders !== undefined && body.aiProviders !== null) ? body.aiProviders : null;
    // v5：值可能是 '服务商ID::模型ID'，放宽到 160；旧的单段值仍然接受。
    const aiActiveProvider = body.aiActiveProvider != null ? String(body.aiActiveProvider).trim().slice(0, 160) : null;
    let aiProvidersJson = null;
    if (aiProvidersIn !== null) {
      if (!Array.isArray(aiProvidersIn)) return sendJSON(res, 400, { error: '模型清单格式不对' });
      try {
        // 保存时逐个过 SSRF 校验；出站时 resolveAiEndpoint() 还会再过一次
        for (const p of aiProvidersIn) {
          const bu = p && p.baseUrl != null ? String(p.baseUrl).trim() : '';
          if (bu) await assertSafeUrl(bu);
        }
        const oldRow = await pool.query('SELECT ai_providers FROM users WHERE id=$1', [uid]);
        const merged = aiProviders.mergeProviders(oldRow.rows[0] && oldRow.rows[0].ai_providers, aiProvidersIn);
        aiProvidersJson = JSON.stringify(merged);
      } catch (e) {
        return sendJSON(res, 400, { error: '模型配置不合法：' + e.message });
      }
    }
    const r = await pool.query(
      'UPDATE users SET name = COALESCE($1, name), avatar = COALESCE($2, avatar), demand = COALESCE($3::jsonb, demand), amap_js_key = COALESCE($4, amap_js_key), amap_security_code = COALESCE($5, amap_security_code), amap_web_key = COALESCE($6, amap_web_key), map_enabled = COALESCE($7, map_enabled), ai_direct_enabled = COALESCE($8, ai_direct_enabled), ai_direct_base_url = COALESCE($9, ai_direct_base_url), ai_direct_api_key = COALESCE($10, ai_direct_api_key), ai_direct_model = COALESCE($11, ai_direct_model), ai_providers = COALESCE($13::jsonb, ai_providers), ai_active_provider = COALESCE($14, ai_active_provider) WHERE id=$12 RETURNING id, email, name, avatar, demand, amap_js_key, amap_security_code, map_enabled, ai_direct_enabled, ai_direct_base_url, ai_direct_api_key, ai_direct_model, ai_providers, ai_active_provider',
      [name, avatar, demandRaw, amapJsKey, amapSecurityCode, amapWebKey, mapEnabled, aiDirectEnabled, aiDirectBaseUrl, aiDirectApiKey, aiDirectModel, uid, aiProvidersJson, aiActiveProvider]
    );
    const u = r.rows[0];
    return sendJSON(res, 200, { data: { user: userPublic(u) } });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const uid = await authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '未登录或登录已过期' });
    // 自增令牌版本：使该用户所有已签发令牌立即失效（支持吊销 / 一键登出）
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [uid]);
    writeAuthLog(req, { uid, action: 'logout', ok: true });
    return sendJSON(res, 200, { data: { ok: true } });
  }

  // 以下接口需要登录
  const uid = await authUid(req);
  if (!uid) return sendJSON(res, 401, { error: '未登录或登录已过期' });

  // ---------- 一键自升级：仅管理员（.env 的 ADMIN_EMAILS）----------
  // GET  status  → 读状态给前端轮询；POST start → 触发升级（需 confirm）；POST rollback → 回滚。
  // 非管理员一律 403；升级是高危操作，误触代价大，因此 command 必须显式确认。
  if (pathname.startsWith('/api/upgrade/')) {
    const admin = await isAdmin(uid);
    if (!admin) return sendJSON(res, 403, { error: '仅管理员可执行升级操作' });

    if (pathname === '/api/upgrade/status' && method === 'GET') {
      const st = upgrader.readState();
      return sendJSON(res, 200, { data: {
        phase: st.phase || 'idle', ok: !!st.ok, progress: Number(st.progress) || 0,
        message: st.message || '', error: st.error || '', target: st.target || '',
        from: st.from || '', ts: st.ts || 0,
        current: localVersion(), platform: process.platform,
        adminConfigured: ADMIN_EMAILS.size > 0
      } }, { 'Cache-Control': 'no-store' });
    }

    if (pathname === '/api/upgrade/check' && method === 'GET') {
      try {
        const remote = await fetchRemoteVersion();
        const cur = localVersion();
        return sendJSON(res, 200, { data: {
          current: cur, latest: remote.version, hasNew: upgrader.cmpVersion(remote.version, cur) > 0,
          notes: remote.notes || '', date: remote.date || '', package: remote.package || '',
          // v1.8.3：标记这份信息是「实时取到的」还是「本地缓存兜底」，前端据此提示可能不是最新
          cached: !!remote.__cached, cachedAt: Number(remote.__cachedAt) || 0,
          source: remote.__source || '', tried: Number(remote.__tried) || 1,
          admin: true, platform: process.platform
        } }, { 'Cache-Control': 'no-store' });
      } catch (e) {
        // 把底层原因（超时 / ENETUNREACH / 证书等）显式带出来：否则前端只能显示笼统的 502，
        // 排查「服务器明明能上 GitHub，一键升级却报错」时完全没线索。
        const why = e.name === 'AbortError'
          ? '请求超时（20 秒无响应）'
          : ((e.cause && (e.cause.code || e.cause.message)) || e.message || String(e));
        console.warn('[upgrade] 检查更新失败：' + why + ' | URL: ' + updateUrl());
        return sendJSON(res, 502, { error: '读取版本文件失败：' + why });
      }
    }

    if (pathname === '/api/upgrade/start' && method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      if (body.confirm !== 'UPGRADE') return sendJSON(res, 400, { error: '缺少升级确认，操作已取消' });
      try {
        const remote = await fetchRemoteVersion();
        const cur = localVersion();
        if (upgrader.cmpVersion(remote.version, cur) <= 0) return sendJSON(res, 400, { error: '当前已是最新版本，无需升级' });
        // 立即返回，升级在后台跑；前端轮询 status 看进度。
        upgrader.start(remote, cur).catch((e) => console.warn('[upgrade] 升级失败：', e.message));
        return sendJSON(res, 200, { data: { started: true, target: remote.version, from: cur } });
      } catch (e) { return sendJSON(res, 502, { error: '启动升级失败：' + e.message }); }
    }

    if (pathname === '/api/upgrade/rollback' && method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      if (body.confirm !== 'ROLLBACK') return sendJSON(res, 400, { error: '缺少回滚确认，操作已取消' });
      try { await upgrader.rollback(); return sendJSON(res, 200, { data: { ok: true } }); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    return sendJSON(res, 404, { error: '未知的升级接口' });
  }

  // ---------- 运行监控：只读接口 ----------
  // 普通用户强制只看自己；仅 .env 的 ADMIN_EMAILS 列出的管理员可带 scope=all 看全局。
  // 所有用户输入都走参数占位符（ph），SQL 里不拼任何用户字符串。
  if (pathname.startsWith('/api/monitor/') && method === 'GET') {
    const admin = await isAdmin(uid);
    const all = admin && url.searchParams.get('scope') === 'all';
    const sp = url.searchParams;
    const mk = () => { const a = []; return { a, ph: (v) => { a.push(v); return '$' + a.length; } }; };
    const monRange = (v) => ({ '7d': 7, '30d': 30, '90d': 90 }[String(v || '')] || 30);
    const clampInt = (v, d, lo, hi) => {
      // 坑：Number(null) === 0 是「有限数」，不特判会把没传 limit 的请求压成 1 条
      if (v == null || v === '') return d;
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
    };
    // 「今日 / 本月」按北京时间算，避免库在 UTC 时把早上 8 点前的记录算到昨天
    const DAY0 = `date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`;
    const MON0 = `date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`;
    const q = monText(sp.get('q'), 60).trim().toLowerCase();
    const okF = sp.get('ok');
    const days = monRange(sp.get('range'));
    let myEmail = '';
    if (!all) {
      const ur = await pool.query('SELECT email FROM users WHERE id=$1', [uid]);
      myEmail = (ur.rows[0] && ur.rows[0].email) || '';
    }
    // 登录失败时可能没有 owner_id，用「同邮箱且 owner_id 为空」补回本人记录
    const authScope = (m) => all ? 'TRUE'
      : `(owner_id = ${m.ph(uid)}::uuid OR (owner_id IS NULL AND lower(coalesce(email,'')) = lower(${m.ph(myEmail)}::text)))`;
    const aiScope = (m) => all ? 'TRUE' : `owner_id = ${m.ph(uid)}::uuid`;

    if (pathname === '/api/monitor/overview') {
      const m1 = mk(), m2 = mk(), m3 = mk();
      const [la, aa, bm, bu] = await Promise.all([
        pool.query(`SELECT count(*) FILTER (WHERE created_at >= ${DAY0})::int AS today,
                           count(*) FILTER (WHERE created_at >= ${MON0})::int AS month,
                           count(*) FILTER (WHERE created_at >= ${DAY0} AND NOT ok)::int AS failed_today
                    FROM auth_logs WHERE ${authScope(m1)}`, m1.a),
        pool.query(`SELECT count(*) FILTER (WHERE created_at >= ${DAY0})::int AS today,
                           count(*) FILTER (WHERE created_at >= ${MON0})::int AS month,
                           count(*) FILTER (WHERE created_at >= ${DAY0} AND NOT ok)::int AS failed_today,
                           coalesce(sum(total_tokens) FILTER (WHERE created_at >= ${DAY0}), 0)::int AS tokens_today,
                           coalesce(sum(total_tokens) FILTER (WHERE created_at >= ${MON0}), 0)::int AS tokens_month,
                           count(*) FILTER (WHERE estimated)::int AS estimated,
                           coalesce(avg(latency_ms) FILTER (WHERE created_at >= ${DAY0}), 0)::int AS avg_ms
                    FROM ai_usage_logs WHERE ${aiScope(m2)}`, m2.a),
        pool.query(`SELECT coalesce(nullif(model,''),'(未填写)') AS model, count(*)::int AS calls,
                           coalesce(sum(total_tokens),0)::int AS tokens,
                           count(*) FILTER (WHERE NOT ok)::int AS failed
                    FROM ai_usage_logs WHERE ${aiScope(m3)} AND created_at >= ${MON0}
                    GROUP BY 1 ORDER BY calls DESC LIMIT 10`, m3.a),
        all ? pool.query(`SELECT coalesce(u.email,'(已删除用户)') AS email, count(*)::int AS calls,
                                 coalesce(sum(l.total_tokens),0)::int AS tokens
                          FROM ai_usage_logs l LEFT JOIN users u ON u.id = l.owner_id
                          WHERE l.created_at >= ${MON0}
                          GROUP BY 1 ORDER BY calls DESC LIMIT 10`, []) : Promise.resolve({ rows: [] })
      ]);
      return sendJSON(res, 200, { data: {
        admin, scope: all ? 'all' : 'self', retentionDays: MONITOR_RETENTION_DAYS,
        adminConfigured: ADMIN_EMAILS.size > 0,
        login: la.rows[0], ai: aa.rows[0], byModel: bm.rows, byUser: bu.rows
      } });
    }

    if (pathname === '/api/monitor/auth-logs') {
      const m = mk();
      let w = authScope(m) + ` AND created_at >= now() - (${m.ph(days)}::int * interval '1 day')`;
      if (okF === '1' || okF === '0') w += ` AND ok = ${m.ph(okF === '1')}::boolean`;
      const act = monText(sp.get('action'), 32);
      if (act && /^[a-z_]{1,32}$/.test(act)) w += ` AND action = ${m.ph(act)}::text`;
      if (q) w += ` AND (lower(coalesce(email,'')) LIKE ${m.ph('%' + q + '%')} OR lower(coalesce(ip,'')) LIKE ${m.ph('%' + q + '%')})`;
      const limit = clampInt(sp.get('limit'), 50, 1, 200);
      const offset = clampInt(sp.get('offset'), 0, 0, 100000);
      const total = await pool.query(`SELECT count(*)::int AS total FROM auth_logs WHERE ${w}`, m.a.slice());
      const rows = await pool.query(`SELECT id, created_at, email, action, ok, reason, ip, ua FROM auth_logs
        WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT ${m.ph(limit)}::int OFFSET ${m.ph(offset)}::int`, m.a);
      return sendJSON(res, 200, { data: { rows: rows.rows, total: total.rows[0].total, limit, offset } });
    }

    if (pathname === '/api/monitor/ai-logs') {
      const m = mk();
      let w = aiScope(m) + ` AND created_at >= now() - (${m.ph(days)}::int * interval '1 day')`;
      if (okF === '1' || okF === '0') w += ` AND ok = ${m.ph(okF === '1')}::boolean`;
      const ent = monText(sp.get('entry'), 32);
      if (ent && /^[a-z_-]{1,32}$/.test(ent)) w += ` AND entry = ${m.ph(ent)}::text`;
      if (q) w += ` AND (lower(coalesce(model,'')) LIKE ${m.ph('%' + q + '%')} OR lower(coalesce(provider,'')) LIKE ${m.ph('%' + q + '%')} OR lower(coalesce(error,'')) LIKE ${m.ph('%' + q + '%')})`;
      const limit = clampInt(sp.get('limit'), 50, 1, 200);
      const offset = clampInt(sp.get('offset'), 0, 0, 100000);
      const total = await pool.query(`SELECT count(*)::int AS total FROM ai_usage_logs WHERE ${w}`, m.a.slice());
      const rows = await pool.query(`SELECT id, created_at, entry, channel, provider, model, stream,
        prompt_tokens, completion_tokens, total_tokens, estimated, latency_ms, ok, status_code, error
        FROM ai_usage_logs WHERE ${w} ORDER BY created_at DESC, id DESC
        LIMIT ${m.ph(limit)}::int OFFSET ${m.ph(offset)}::int`, m.a);
      return sendJSON(res, 200, { data: { rows: rows.rows, total: total.rows[0].total, limit, offset } });
    }
    return sendJSON(res, 404, { error: '未知监控接口' });
  }

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
    if (!vr.ok) {
      writeAuthLog(req, { uid, action: 'change_password', ok: false, reason: 'bad_old_password' });
      return sendJSON(res, 400, { error: '原密码不正确' });
    }
    const hash = await hashPassword(newPw);
    // 当前设备的旧 token 也会失效，前端收到成功后引导重新登录
    await pool.query('UPDATE users SET password_hash=$1, token_version = token_version + 1 WHERE id=$2', [hash, uid]);
    writeAuthLog(req, { uid, action: 'change_password', ok: true });
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

  // ---------- 历史成交价：按小区聚合的成交记录（按账号隔离） ----------
  // date 列用 to_char 转成纯 YYYY-MM-DD 字符串返回：node-pg 默认把 date 解析成本地时区 Date，
  // 东八区会出现 2026-11-05 → 2026-11-04T16:00Z，前端 slice(0,10) 显示错一天。
  const DEAL_COLS = `id, owner_id, city, district, community, layout, area, floor,
    total_price, unit_price, list_price, to_char(deal_date,'YYYY-MM-DD') AS deal_date,
    deal_cycle, agent, created_at`;
  if (pathname === '/api/community-deals' && method === 'GET') {
    const community = String(url.searchParams.get('community') || '').trim();
    const city = String(url.searchParams.get('city') || '').trim();
    const district = String(url.searchParams.get('district') || '').trim();
    if (community) {
      const r = await pool.query(
        `SELECT ${DEAL_COLS} FROM community_deals
          WHERE owner_id=$1 AND community=$2 AND city=$3 AND district=$4
          ORDER BY COALESCE(deal_date, created_at::date) DESC, created_at DESC`,
        [uid, community, city, district]
      );
      return sendJSON(res, 200, { data: r.rows });
    }
    // 不带 community：返回全部（用于小区下拉 / 统计）
    const r = await pool.query(
      `SELECT ${DEAL_COLS} FROM community_deals WHERE owner_id=$1 ORDER BY COALESCE(deal_date, created_at::date) DESC, created_at DESC LIMIT 2000`,
      [uid]
    );
    return sendJSON(res, 200, { data: r.rows });
  }
  // 数值字段：空串/非数字 → null；日期：空串 → null
  const dealNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/,/g, '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };
  const dealDate = (v) => { const s = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
  const dealFields = (b) => ({
    city: String(b.city || '').trim().slice(0, 40),
    district: String(b.district || '').trim().slice(0, 40),
    community: String(b.community || '').trim().slice(0, 120),
    layout: String(b.layout || '').trim().slice(0, 40),
    area: dealNum(b.area), floor: String(b.floor || '').trim().slice(0, 40),
    total_price: dealNum(b.totalPrice), unit_price: dealNum(b.unitPrice), list_price: dealNum(b.listPrice),
    deal_date: dealDate(b.dealDate), deal_cycle: String(b.dealCycle || '').trim().slice(0, 40),
    agent: String(b.agent || '').trim().slice(0, 40)
  });
  if (pathname === '/api/community-deals' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const f = dealFields(body);
    if (!f.community) return sendJSON(res, 400, { error: '小区名称不能为空' });
    const r = await pool.query(
      `INSERT INTO community_deals
        (owner_id, city, district, community, layout, area, floor, total_price, unit_price, list_price, deal_date, deal_cycle, agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, owner_id, city, district, community, layout, area, floor,
         total_price, unit_price, list_price, to_char(deal_date,'YYYY-MM-DD') AS deal_date,
         deal_cycle, agent, created_at`,
      [uid, f.city, f.district, f.community, f.layout, f.area, f.floor, f.total_price, f.unit_price, f.list_price, f.deal_date, f.deal_cycle, f.agent]
    );
    return sendJSON(res, 201, { data: r.rows[0] });
  }
  // 插件批量推送（去重：同小区 + 同户型 + 同面积 + 同成交日期视为同一条）
  if (pathname === '/api/community-deals/batch' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const rows = Array.isArray(body) ? body : (Array.isArray(body.rows) ? body.rows : []);
    let added = 0, skipped = 0;
    for (const item of rows) {
      const f = dealFields(item);
      if (!f.community) { skipped++; continue; }
      const dup = await pool.query(
        `SELECT 1 FROM community_deals WHERE owner_id=$1 AND community=$2 AND city=$3 AND district=$4
          AND layout=$5 AND area IS NOT DISTINCT FROM $6 AND deal_date IS NOT DISTINCT FROM $7 LIMIT 1`,
        [uid, f.community, f.city, f.district, f.layout, f.area, f.deal_date]
      );
      if (dup.rowCount) { skipped++; continue; }
      await pool.query(
        `INSERT INTO community_deals
          (owner_id, city, district, community, layout, area, floor, total_price, unit_price, list_price, deal_date, deal_cycle, agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [uid, f.city, f.district, f.community, f.layout, f.area, f.floor, f.total_price, f.unit_price, f.list_price, f.deal_date, f.deal_cycle, f.agent]
      );
      added++;
    }
    return sendJSON(res, 200, { data: { added, skipped } });
  }
  const dealEdit = pathname.match(/^\/api\/community-deals\/([^/]+)$/);
  if (dealEdit && (method === 'PUT' || method === 'DELETE')) {
    if (method === 'DELETE') {
      const r = await pool.query('DELETE FROM community_deals WHERE id=$1 AND owner_id=$2', [dealEdit[1], uid]);
      if (!r.rowCount) return sendJSON(res, 404, { error: '未找到该记录或无权限' });
      return sendJSON(res, 200, { data: { ok: true } });
    }
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const f = dealFields(body);
    if (!f.community) return sendJSON(res, 400, { error: '小区名称不能为空' });
    const r = await pool.query(
      `UPDATE community_deals SET city=$3, district=$4, community=$5, layout=$6, area=$7, floor=$8,
        total_price=$9, unit_price=$10, list_price=$11, deal_date=$12, deal_cycle=$13, agent=$14
       WHERE id=$1 AND owner_id=$2
       RETURNING id, owner_id, city, district, community, layout, area, floor,
         total_price, unit_price, list_price, to_char(deal_date,'YYYY-MM-DD') AS deal_date,
         deal_cycle, agent, created_at`,
      [dealEdit[1], uid, f.city, f.district, f.community, f.layout, f.area, f.floor, f.total_price, f.unit_price, f.list_price, f.deal_date, f.deal_cycle, f.agent]
    );
    if (!r.rowCount) return sendJSON(res, 404, { error: '未找到该记录或无权限' });
    return sendJSON(res, 200, { data: r.rows[0] });
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
    const r = await pool.query(
      'SELECT ai_direct_enabled, ai_direct_base_url, ai_direct_api_key, ai_direct_model, ai_providers, ai_active_provider FROM users WHERE id=$1', [uid]
    );
    const u = r.rows[0] || {};
    const directOn = !!u.ai_direct_enabled;
    const picked = aiProviders.pickActive(u.ai_providers, u.ai_active_provider, directOn, u);
    const usingDirect = directOn && picked.ok && !!picked.provider;
    const p = picked.provider || {};
    return sendJSON(res, 200, {
      data: {
        channel: usingDirect ? 'direct' : 'gateway',
        configured: !!dbConfig.freellmApiKey || usingDirect,
        baseUrl: usingDirect ? p.baseUrl : String(dbConfig.freellmBaseUrl || ''),
        model: usingDirect ? p.model : 'auto（由 freellmapi 路由器自动挑选模型）',
        providerName: usingDirect ? (p.name || '') : '',
        // v5：当前生效模型的可读名、类型标注与复合 key（类型只做展示，不参与选路）
        modelName: usingDirect ? (p.modelName || p.model) : '',
        modelType: usingDirect ? (p.modelType || 'llm') : '',
        activeKey: usingDirect ? (p.activeKey || '') : '',
        visionModel: String(dbConfig.freellmVisionModel || 'auto'),
        aiDirectEnabled: directOn,
        aiDirectKeySet: usingDirect,
        aiDirectComplete: picked.ok,
        aiProviders: aiProviders.sanitizeProviders(u.ai_providers),
        aiActiveProvider: u.ai_active_provider || '',
        providerCount: aiProviders.sanitizeProviders(u.ai_providers).length,
        note: (directOn && !picked.ok)
          ? 'AI 直连已启用但配置不完整：请在设置页补齐 ' + picked.missing.join('、') + '，或关闭直连'
          : (usingDirect ? '' : '当前走本机网关自动选模型；如需直连请在设置页选一个模型并设为当前')
      }
    });
  }

  // ---- 模型检测：拿「弹窗里正在编辑的」地址/Key/模型名真发一次请求，回答「通不通、能不能用」 ----
  // 分两步：① 纯文本（判断接口通、模型存在、Key 有效）② 带一张内置小图（判断支不支持看图）。
  // Key 只在本次请求内存里用完即弃，不落日志、不回显；地址照旧过 assertSafeUrl 防内网探测。
  // 没传 Key 且给了 pid 时，复用库里已保存的那把（弹窗里改地址不必重填 Key）。
  if (pathname === '/api/ai/test-provider' && method === 'POST') {
    let body;
    try { body = await readBodyLimit(req, 64 * 1024, 256 * 1024); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const baseUrl = String(body.baseUrl || '').trim().replace(/\/+$/, '');
    const model = String(body.model || '').trim().slice(0, 120);
    const pid = String(body.pid || '').trim().slice(0, 60);
    let apiKey = String(body.apiKey || '').trim();
    if (!model) return sendJSON(res, 400, { error: '先在「模型 ID」里填模型名，再点检测' });
    if (!/^https?:\/\//i.test(baseUrl)) return sendJSON(res, 400, { error: '接口地址要以 http:// 或 https:// 开头' });
    if (!apiKey && pid) {
      const rr = await pool.query('SELECT ai_providers FROM users WHERE id=$1', [uid]);
      const saved = aiProviders.asList((rr.rows[0] || {}).ai_providers).find((x) => x && x.id === pid);
      if (saved && typeof saved.apiKey === 'string') apiKey = saved.apiKey.trim();
    }
    if (!apiKey) return sendJSON(res, 400, { error: '还没填 API Key（已保存过的 Key 会自动复用）' });
    try { await assertSafeUrl(baseUrl); }
    catch (e) { return sendJSON(res, 400, { error: '接口地址不可用：' + e.message }); }

    // 64×64 白底 + 3 个黑方块，158 字节；问题固定，答案应为 3
    const TEST_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAZUlEQVR42u3XMQrAMAwDwCjk/19292Tx1BJ6Gg0aDozBqapxc+a4PAAAfwesc5Sk39+O2PtdKwQAAAAAAAAAAPBd4qkHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6OcBxocPe7PbmGwAAAAASUVORK5CYII=';
    const probe = async (content, stage) => {
      const t0 = Date.now();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25000);
      // 「检测」也是真实模型请求，两次探测各记一条；不记 API Key、不记图片内容
      const seed = {
        owner_id: uid, entry: stage === 'vision' ? 'test-vision' : 'test-text',
        channel: 'direct', provider: monHost(baseUrl), model, stream: false, promptEstimate: 8
      };
      try {
        const r = await fetch(baseUrl + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 32, temperature: 0, stream: false }),
          signal: ctl.signal
        });
        const txt = await r.text();
        let j = null; try { j = JSON.parse(txt); } catch (_) {}
        const ms = Date.now() - t0;
        writeAiLog(seed, {
          ok: !!r.ok, statusCode: r.status, latencyMs: ms, usage: usageOf(j),
          error: r.ok ? null : (txt || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
        });
        return { ok: r.ok, status: r.status, json: j, text: txt, ms };
      } catch (e) {
        writeAiLog(seed, { ok: false, latencyMs: Date.now() - t0, error: String(e && e.message || e).slice(0, 200) });
        throw e;
      } finally { clearTimeout(timer); }
    };
    // 上游的错误文案五花八门（error.message / error.msg / 纯文本 / 整页 HTML），统一抠一句人话
    const errOf = (r) => {
      const e = r.json && r.json.error;
      let raw = (e && (e.message || e.msg || e.code || e.type)) || (r.json && (r.json.message || r.json.detail));
      if (!raw && !r.json && r.text) {
        // 返回的是网页：多半是地址写错了（少了 /v1、或填成了控制台首页），别把整页 HTML 丢给用户
        const t = String(r.text);
        const title = (t.match(/<title>([^<]{1,80})<\/title>/i) || [])[1];
        raw = title
          ? '接口地址不对：返回的是网页「' + title.trim() + '」而不是 API 响应，检查地址是否以 /v1 结尾（如 https://api.xxx.com/v1）'
          : '接口返回的不是 JSON（HTTP ' + r.status + '）：' + t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      }
      if (!raw) raw = 'HTTP ' + r.status + (r.status === 404 ? '：接口或模型不存在' : '');
      return String(raw).slice(0, 300);
    };

    let t1;
    try { t1 = await probe('回复两个字：可用', 'text'); }
    catch (e) {
      const msg = (e && e.name === 'AbortError') ? '请求超时：25 秒没有响应'
        : /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|ETIMEDOUT/i.test(String(e && e.message || e))
          ? '接口地址连不上（地址写错／服务没开／网络不通）'
          : String(e && e.message || e);
      return sendJSON(res, 200, { data: { ok: false, stage: 'text', error: msg } });
    }
    if (!t1.ok) {
      return sendJSON(res, 200, { data: { ok: false, stage: 'text', status: t1.status, error: errOf(t1) } });
    }
    const upstreamModel = (t1.json && t1.json.model) || '';
    const c1 = t1.json && t1.json.choices && t1.json.choices[0];
    if (!c1 || !c1.message) {
      return sendJSON(res, 200, { data: { ok: false, stage: 'text', status: t1.status, error: '接口有响应但不是标准 chat/completions 格式：' + String(t1.text || '').slice(0, 160) } });
    }
    const reply = String(c1.message.content == null ? '' : c1.message.content).trim().slice(0, 40);

    // ② 带图：能不能看图
    let vision = { supported: false, ok: false, note: '' };
    try {
      const t2 = await probe([
        { type: 'text', text: '这张图里有几个黑色方块？只回一个阿拉伯数字。' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + TEST_PNG } }
      ], 'vision');
      if (!t2.ok) {
        vision = { supported: false, ok: false, note: errOf(t2).slice(0, 160) };
      } else {
        const c2 = t2.json && t2.json.choices && t2.json.choices[0];
        const ans = String((c2 && c2.message && c2.message.content) || '').trim();
        vision = { supported: true, ok: /(^|\D)3(\D|$)|三/.test(ans), note: ans.slice(0, 40) || '（模型没回内容）', ms: t2.ms };
      }
    } catch (e) {
      vision = { supported: false, ok: false, note: (e && e.name === 'AbortError') ? '看图请求超时' : String(e && e.message || e).slice(0, 160) };
    }

    return sendJSON(res, 200, {
      data: {
        ok: true, stage: 'ok', model, upstreamModel,
        latencyMs: t1.ms, reply, vision,
        note: (upstreamModel && upstreamModel !== model) ? ('上游实际用的是 ' + upstreamModel) : ''
      }
    });
  }

  if (pathname === '/api/ai/chat' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const messages = body.messages;
    let model = String(body.model || 'auto');
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
    const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : 1024;
    const stream = !!body.stream;

    let resp;
    try {
      const ep = await resolveAiEndpoint(uid, model);
      model = ep.model;
      resp = await callFreellm({ messages, model, temperature, maxTokens, stream, endpoint: ep, meta: { uid, entry: 'chat' } });
    } catch (e) {
      return sendJSON(res, 502, { error: '调用 AI 接口失败：' + e.message });
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
      const requestedModel = useImages ? (dbConfig.freellmVisionModel || 'auto') : 'auto';
      const ep = await resolveAiEndpoint(uid, requestedModel);
      const llmResp = await callFreellm({
        model: ep.model,
        temperature: 0.2,
        maxTokens: 1500,
        messages: [
          { role: 'system', content: AI_EXTRACT_SCHEMA },
          { role: 'user', content: userContent }
        ],
        images: useImages ? images : null,
        endpoint: ep,
        meta: { uid, entry: 'extract' }
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
    const staticHeaders = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    // 装修设计：该页由主界面用同源 iframe 承载，需单独放宽 X-Frame-Options（其它页面仍 DENY）
    if (urlPath === '/floorplan.html') staticHeaders['X-Frame-Options'] = 'SAMEORIGIN';
    head(res, 200, staticHeaders, isMedia);
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
    console.log(EMBEDDED_DB ? '✅ 内嵌 PostgreSQL 已连接' : '✅ 已连接到本地 PostgreSQL（house_view）');
  } catch (e) {
    console.error(EMBEDDED_DB ? '❌ 内嵌数据库启动失败：' : '⚠️ 无法连接本地 PostgreSQL：', e.message);
    if (EMBEDDED_DB) {
      console.error('   请检查：数据目录是否可写、磁盘空间是否充足、包内 node_modules/@electric-sql/pglite 是否完整。');
      process.exit(1);
    }
    console.error('   请确认 PostgreSQL 服务已启动，且 config/db.js 中的账号密码正确。');
  }
  try {
    await ensureSchema();
    console.log('✅ 数据表已就绪（users / properties）');
  } catch (e) {
    console.error('⚠️ 建表失败：', e.message);
    if (EMBEDDED_DB) process.exit(1);
  }
  // 一键升级：若上次状态停在 restarting，说明服务已成功拉起，补写 done 供前端轮询读取。
  try { upgrader.onBoot(); } catch (e) { console.warn('[upgrade] 启动状态收尾失败：', e.message); }

  server.listen(PORT, () => {
    console.log(`择隅已启动： http://127.0.0.1:${PORT}/  （浏览器打开 http://服务器IP:${PORT}/）`);
    console.log(EMBEDDED_DB
      ? `（数据保存在目录 ${require('./config/db-embedded').embeddedDataDir()}，备份时整个目录拷走即可）`
      : `（数据保存在本地 PostgreSQL：house_view 库，不联网、不上传）`);
  });
}

start();

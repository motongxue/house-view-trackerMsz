// ============================================================
// 服务端数据库配置（仅后端使用，不暴露给浏览器）
// 连接你本机已装好的 PostgreSQL 15，专用库 house_view / 角色 hvt（低权限）。
// 这些凭据仅用于本地开发，请勿提交到公开仓库。
// 若需改连接，可用环境变量覆盖：PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
//
// 附：freellmapi（本地免费 LLM 聚合网关）配置
//   FREELLM_BASE_URL —— freellmapi 的 OpenAI 兼容端点；桌面版默认 31415 端口，源码/Docker 版默认 3001
//   FREELLM_API_KEY  —— freellmapi 的「统一令牌」（freellmapi-... 开头），仅后端使用，切勿放前端
//   这两个值也可放在项目根目录 .env 文件里（本文件会自动读取，且不会覆盖已设置的环境变量）。
// ============================================================
// 读取项目根目录 .env（若存在），仅填充尚未设置的环境变量，便于本地开发不把密钥写进代码
(function loadEnvFile() {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const k = m[1];
      let v = m[2];
      const q = v.charAt(0);
      if (q === '"' || q === "'") {
        const end = v.indexOf(q, 1);
        if (end >= 0) {
          let inner = v.slice(1, end);
          // 双引号内解码常见转义（\n \r \t \" \\），单引号保持字面量；逐个处理避免 \\n 被误判
          if (q === '"') inner = inner.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }[c]));
          v = inner;
        } else {
          v = v.replace(/\s+#.*$/, '').trim(); // 未闭合引号：仍剥掉行内注释
        }
      } else {
        // 未加引号时，仅把「空白 + #」之后的内容当作行内注释；p@ss#word 中的 # 原样保留
        v = v.replace(/\s+#.*$/, '').trim();
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch (_) {}
})();

// 布尔/端口环境变量归一化：避免 'FALSE'/'0'/'no' 被误判为 true，以及畸形端口静默变成 NaN。
function envBool(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const s = String(raw).trim().toLowerCase();
  if (/^(1|true|yes|on)$/.test(s)) return true;
  if (/^(0|false|no|off)$/.test(s)) return false;
  return def;
}
function envPort(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const s = String(raw).trim();
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error('配置项 ' + name + ' 不是有效端口（1-65535）：' + JSON.stringify(raw));
  }
  return n;
}

// 令牌签名密钥：优先环境变量 TOKEN_SECRET（部署时务必设置）；缺失时随机生成并持久化到
// 项目根目录 .token-secret 文件（权限 0600），重启后不丢失。彻底去掉写死的共享默认值，
// 避免别人拿到默认密钥伪造任意用户令牌。
function resolveTokenSecret() {
  if (process.env.TOKEN_SECRET && String(process.env.TOKEN_SECRET).length >= 16) {
    return process.env.TOKEN_SECRET;
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const secretFile = path.join(__dirname, '..', '.token-secret');
    if (fs.existsSync(secretFile)) {
      const s = fs.readFileSync(secretFile, 'utf8').trim();
      if (s && s.length >= 16) return s;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    let saveErr = null;
    try { fs.writeFileSync(secretFile, generated, { mode: 0o600 }); } catch (e) { saveErr = e; }
    if (!saveErr) {
      console.warn('[SECURITY] 未设置 TOKEN_SECRET，已生成随机签名密钥并保存到 .token-secret（请备份该文件；删除它会令所有用户重新登录）。');
    } else {
      console.error('[SECURITY] 未设置 TOKEN_SECRET 且无法写入 .token-secret（' + saveErr.message +
        '）：本次生成的密钥仅存于内存，重启后所有用户将被登出。请显式设置环境变量 TOKEN_SECRET 以保证稳定。');
    }
    return generated;
  } catch (e) {
    console.error('[SECURITY] 无法解析/生成令牌密钥，回退临时随机值（重启将失效）：', e.message);
    return require('crypto').randomBytes(32).toString('hex');
  }
}

module.exports = {
  host: process.env.PGHOST || '127.0.0.1',
  port: envPort('PGPORT', 5432),
  user: process.env.PGUSER || 'hvt',
  // 口令一律由环境变量提供，代码里不留任何默认口令：
  // 生产部署时由部署脚本随机生成并写入 .env 的 PGPASSWORD；
  // 本地开发同样在 .env 里填自己那台 PostgreSQL 的口令。
  // 这样一旦 .env 漏配，会以「空口令」连接并明确报认证失败，
  // 而不是静默用一个人人皆知的弱口令去连库。
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'house_view',
  // 令牌签名密钥（部署时务必通过环境变量 TOKEN_SECRET 设置，或由 .token-secret 文件持久化）
  tokenSecret: resolveTokenSecret(),

  // freellmapi（本地/局域网内的免费 LLM 聚合网关，仅后端调用，token 不落前端）
  freellmBaseUrl: process.env.FREELLM_BASE_URL || 'http://127.0.0.1:31415/v1',
  freellmApiKey: process.env.FREELLM_API_KEY || '',
  // 视觉模型：截图识别时指定能看图的多模态模型；留 auto 会让 freellmapi 按兜底链挑，可能误选纯文本模型
  freellmVisionModel: process.env.FREELLM_VISION_MODEL || 'auto',

  // 邮件服务（SMTP）：注册 / 登录 / 找回密码的邮箱验证码，仅后端使用，切勿下放前端。
  // 常见取值：QQ 邮箱 smtp.qq.com:465（SMTP_SECURE=true）+ 16 位授权码；
  //          163 邮箱 smtp.163.com:465；企业邮箱若走 587，设 SMTP_SECURE=false 自动 STARTTLS。
  // 四样都填齐才算配置完成；未配置时相关操作明确报错，不会静默跳过验证。
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: envPort('SMTP_PORT', 465),
    secure: envBool('SMTP_SECURE', true),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    fromName: process.env.SMTP_FROM_NAME || '择隅'
  },
  // 仅本地开发用：不连 SMTP，把验证码打印到服务端控制台以便跑通全流程。生产严禁开启。
  emailDevLog: String(process.env.EMAIL_DEV_LOG || '') === 'true',
  // 邮箱验证码总开关：默认 false（开箱即用，不配 SMTP 也能注册/登录）。
  // false：注册只过图形验证码，不校验邮箱；无邮箱验证的「验证码登录/找回密码」在前后端都禁用。
  // true ：走完整邮件验证，且必须配齐 SMTP；未配置时相关操作明确报错，不静默放行。
  // 主流自托管项目（Supabase 自托管 / Penpot / tanchi）均采用「自托管默认关、公网默认开」。
  emailVerification: String(process.env.EMAIL_VERIFICATION || '') === 'true'
};

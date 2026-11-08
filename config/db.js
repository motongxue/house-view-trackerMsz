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
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const k = m[1];
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch (_) {}
})();

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
    try { fs.writeFileSync(secretFile, generated, { mode: 0o600 }); } catch (_) {}
    console.warn('[SECURITY] 未设置 TOKEN_SECRET，已生成随机签名密钥并保存到 .token-secret（请备份该文件；删除它会令所有用户重新登录）。');
    return generated;
  } catch (e) {
    console.error('[SECURITY] 无法解析/生成令牌密钥，回退临时随机值（重启将失效）：', e.message);
    return require('crypto').randomBytes(32).toString('hex');
  }
}

module.exports = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'hvt',
  password: process.env.PGPASSWORD || 'HvtApp2026',
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
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    fromName: process.env.SMTP_FROM_NAME || '看房记录工具'
  },
  // 仅本地开发用：不连 SMTP，把验证码打印到服务端控制台以便跑通全流程。生产严禁开启。
  emailDevLog: String(process.env.EMAIL_DEV_LOG || '') === 'true'
};

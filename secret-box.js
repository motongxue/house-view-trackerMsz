'use strict';
// ==================================================================
// 敏感字段落库加密（AES-256-GCM）
// 用途：用户自己填的第三方 API Key（ai_direct_api_key 与 ai_providers[*].apiKey）
// 不要再以明文躺在数据库里。
//
// 边界要说清楚，避免误以为它是万能的：
//   · 它防的是「数据库被单独带走」——备份文件、pg_dump、只读账号、误传到别处的库；
//     这些场景里明文 Key 就是直接可用的资产。
//   · 它不防「拿到整台机器」的人：主密钥必须能被服务进程读到，否则无法解密。
//   · 主密钥优先取环境变量 HVT_SECRET；没有则在 data/ 下生成 .secret.key（0600）。
//     备份 data 目录时请一并备份这个文件，丢了已保存的 Key 就解不开了（可在设置页重填）。
//
// 兼容：密文统一带 'enc:v1:' 前缀；没有前缀的值按明文处理。
//       所以老数据不用迁移，读写两条路都能走通。
// ==================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREFIX = 'enc:v1:';
const KEY_FILE = '.secret.key';
let cachedKey = null;
let keySource = '';

function derive(raw) {
  // 环境变量可能是任意口令，统一 sha256 成 32 字节，不做 KDF 迭代：
  // 这里的威胁模型是「顺手拿到库文件」，不是「离线爆破口令」。
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function init(opts) {
  if (cachedKey) return;
  const dataDir = (opts && opts.dataDir) || path.join(__dirname, 'data');
  if (process.env.HVT_SECRET) {
    cachedKey = derive(process.env.HVT_SECRET);
    keySource = 'env:HVT_SECRET';
    return;
  }
  const file = path.join(dataDir, KEY_FILE);
  try {
    if (fs.existsSync(file)) {
      const txt = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(txt)) {
        cachedKey = Buffer.from(txt, 'hex');
        keySource = 'file:' + file;
        return;
      }
      console.warn('[secret] 密钥文件格式不对，将重新生成：' + file);
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const k = crypto.randomBytes(32);
    fs.writeFileSync(file, k.toString('hex'), { mode: 0o600 });
    cachedKey = k;
    keySource = 'file:' + file;
    console.log('[secret] 已生成数据加密密钥：' + file + '（备份 data 目录时请一并备份；丢失后需重新填写各家 API Key）');
  } catch (e) {
    console.error('[secret] 无法准备加密密钥，敏感字段将按明文存储：' + e.message);
    cachedKey = null;
    keySource = 'none';
  }
}

function isSealed(v) { return typeof v === 'string' && v.startsWith(PREFIX); }

function seal(plain) {
  const s = plain == null ? '' : String(plain);
  if (!s) return '';
  if (isSealed(s)) return s;          // 已经是密文，别套娃（重复保存同一条时会出现）
  // v2.0.0：fail-closed。密钥不可用时拒绝返回明文——静默落明文会让 API Key
  // 以可读形式写进数据库，备份/导出/截图时直接泄露。宁可这张保存失败。
  if (!cachedKey) throw new Error('数据加密密钥不可用，已拒绝保存 API Key（请检查 data/.secret.key 权限或 HVT_SECRET 配置）');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cachedKey, iv);
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + iv.toString('base64') + ':' + c.getAuthTag().toString('base64') + ':' + ct.toString('base64');
}

function open(v) {
  const s = v == null ? '' : String(v);
  if (!s) return '';
  if (!isSealed(s)) return s;         // 历史明文，原样返回
  if (!cachedKey) return '';
  try {
    const parts = s.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return '';
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const ct = Buffer.from(parts[2], 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', cachedKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch (e) {
    // 解不开基本只有一种原因：主密钥换了（换了 HVT_SECRET 或丢了 .secret.key）
    console.warn('[secret] 解密失败（主密钥不匹配），请到设置页重新填写该账号的 API Key');
    return '';
  }
}

function asList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
  return [];
}

// 保存前加密：只处理 apiKey，其余字段原样带过（含未知字段，避免洗掉前端新加的配置）
function sealProviders(v) {
  return asList(v).map((p) => {
    if (!p || typeof p !== 'object') return p;
    const out = Object.assign({}, p);
    if (out.apiKey) out.apiKey = seal(out.apiKey);
    return out;
  });
}

// 读出后解密：统一给成数组
function openProviders(v) {
  return asList(v).map((p) => {
    if (!p || typeof p !== 'object') return p;
    const out = Object.assign({}, p);
    if (typeof out.apiKey === 'string' && out.apiKey) out.apiKey = open(out.apiKey);
    return out;
  });
}

module.exports = { init, seal, open, isSealed, sealProviders, openProviders, keySourceRef: () => keySource };

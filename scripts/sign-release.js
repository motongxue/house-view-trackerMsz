#!/usr/bin/env node
/**
 * 择隅 · 发版签名工具（v2.0.0）
 *
 * 私钥只存在发布者本机，绝不进 git、绝不进升级包。
 * 公钥放 trust/pubkey.pem（随包发布），服务端首次启动时复制到 data/trust/pubkey.pem，
 * 之后任何升级都不会覆盖 data/trust/ 下的信任根。
 *
 * 用法：
 *   node scripts/sign-release.js --gen-key <私钥输出路径>
 *       → 生成 Ed25519 密钥对；私钥写到指定路径（权限 600），公钥写到 trust/pubkey.pem
 *   node scripts/sign-release.js <私钥路径>
 *       → 对 version.json 的安全相关字段签名，结果写入 version.json.signature
 *   node scripts/sign-release.js --verify <私钥路径>
 *       → 用对应公钥验一遍当前 version.json（自检）
 *
 * 签名覆盖：version / package / packageSha256 / downloadUrls / title / items / notes / date。
 * 不覆盖 changelog（历史记录，不影响本次升级决策）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'version.json');
const PUBKEY_FILE = path.join(ROOT, 'trust', 'pubkey.pem');

function signedPayload(info) {
  return JSON.stringify({
    version: String(info.version || ''),
    package: String(info.package || ''),
    packageSha256: String(info.packageSha256 || ''),
    downloadUrls: Array.isArray(info.downloadUrls) ? info.downloadUrls.map((x) => String(x)) : [],
    title: String(info.title || ''),
    items: Array.isArray(info.items) ? info.items.map((x) => String(x)) : [],
    notes: String(info.notes || ''),
    date: String(info.date || '')
  });
}

function readVersion() {
  if (!fs.existsSync(VERSION_FILE)) throw new Error('找不到 version.json');
  return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
}

function genKey(file) {
  if (!file) throw new Error('请指定私钥输出路径');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs)) throw new Error('私钥文件已存在，拒绝覆盖：' + abs);
  fs.writeFileSync(abs, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.mkdirSync(path.dirname(PUBKEY_FILE), { recursive: true });
  if (fs.existsSync(PUBKEY_FILE)) {
    console.warn('⚠️ 公钥文件已存在，将被覆盖：' + PUBKEY_FILE);
    console.warn('   若服务器上 data/trust/pubkey.pem 已随旧包部署，请确认是否要轮换密钥。');
  }
  fs.writeFileSync(PUBKEY_FILE, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('私钥: ' + abs + '  ← 只留在本机，别提交、别进包');
  console.log('公钥: ' + PUBKEY_FILE + '  ← 这个文件随升级包发布');
}

function sign(file) {
  if (!file) throw new Error('请指定私钥路径');
  const priv = fs.readFileSync(path.resolve(file), 'utf8');
  const ver = readVersion();
  delete ver.signature;
  const sig = crypto.sign(null, Buffer.from(signedPayload(ver), 'utf8'), priv);
  ver.signature = sig.toString('base64');
  fs.writeFileSync(VERSION_FILE, JSON.stringify(ver, null, 2) + '\n');
  console.log('已签名 version.json（版本 ' + ver.version + '）');
  console.log('signature: ' + ver.signature.slice(0, 32) + '…');
  console.log('记得：先打升级包算 sha256 → 回填 packageSha256 → 再跑一次本命令签名 → 最后 tag + 推送。');
}

function verify(file) {
  if (!file) throw new Error('请指定私钥路径（用其对应公钥自检）');
  const priv = fs.readFileSync(path.resolve(file), 'utf8');
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  const ver = readVersion();
  const sig = ver.signature;
  if (!sig) throw new Error('version.json 没有 signature 字段');
  delete ver.signature;
  const ok = crypto.verify(null, Buffer.from(signedPayload(ver), 'utf8'), pub, Buffer.from(sig, 'base64'));
  console.log(ok ? '✅ 签名有效' : '❌ 签名无效');
  process.exitCode = ok ? 0 : 1;
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--gen-key') genKey(args[1]);
  else if (args[0] === '--verify') verify(args[1]);
  else sign(args[0]);
} catch (e) {
  console.error('错误：' + e.message);
  process.exit(1);
}

module.exports = { signedPayload };

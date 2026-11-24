#!/usr/bin/env node
/**
 * 打包后跑一次：把升级包的 sha256 写进 version.json 的 packageSha256。
 *
 *   node scripts/pack-sha256.js ./release_upload/house-view-tracker-linux-x64_v1.12.0.tar.gz
 *
 * 为什么要有这一步：upgrade.js 下载完会拿 version.json 里的 packageSha256 比对，
 * 值对不上就不装。version.json 里留空 = 跳过校验（只兼容旧版本），
 * 所以每次发版必须真的跑一遍，否则这道防线等于没有。
 *
 * 注意：sha256 是在包已经打好之后才算的，所以包里那份 version.json 的该字段是空的——
 * 这没问题，客户端「检查更新」读的是远端仓库那份（raw/main/version.json）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/pack-sha256.js <升级包.tar.gz>');
  process.exit(1);
}
const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error('找不到文件：' + abs);
  process.exit(1);
}

const hash = crypto.createHash('sha256');
const fd = fs.openSync(abs, 'r');
const buf = Buffer.alloc(1024 * 1024);
try {
  for (;;) {
    const n = fs.readSync(fd, buf, 0, buf.length, null);
    if (!n) break;
    hash.update(buf.subarray(0, n));
  }
} finally {
  fs.closeSync(fd);
}
const sha = hash.digest('hex');
const size = fs.statSync(abs).size;

const verPath = path.resolve(__dirname, '..', 'version.json');
const ver = JSON.parse(fs.readFileSync(verPath, 'utf8'));
ver.packageSha256 = sha;
fs.writeFileSync(verPath, JSON.stringify(ver, null, 2) + '\n');

console.log('文件  : ' + path.basename(abs));
console.log('大小  : ' + size + ' 字节（' + (size / 1048576).toFixed(2) + 'MB）');
console.log('sha256: ' + sha);
console.log('已写入 version.json（版本 ' + ver.version + '）');
console.log('⚠️ v2.0.0 起 hash 变了，原签名已失效：必须紧接着跑 node scripts/sign-release.js <私钥路径> 重新签名，再提交推送。');

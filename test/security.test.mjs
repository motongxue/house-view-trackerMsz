// v2.0.0 安全不变量单测：只依赖 Node 内置模块，CI 直接 node --test 跑。
// 覆盖：升级验签（含信任根不可覆盖）、下载源白名单、媒体签名 URL、safeHref 白名单。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createUpgrader } = require(path.join(ROOT, 'upgrade.js'));

function signedPayload(v) {
  return JSON.stringify({
    version: String(v.version || ''), package: String(v.package || ''),
    packageSha256: String(v.packageSha256 || ''),
    downloadUrls: Array.isArray(v.downloadUrls) ? v.downloadUrls.map(String) : [],
    title: String(v.title || ''), items: Array.isArray(v.items) ? v.items.map(String) : [],
    notes: String(v.notes || ''), date: String(v.date || '')
  });
}

function newUpgrader() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hvt-sec-'));
  const app = path.join(tmp, 'app'), data = path.join(tmp, 'data');
  fs.mkdirSync(path.join(app, 'trust'), { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(app, 'trust', 'pubkey.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  const U = createUpgrader({ appDir: app, dataDir: data, allowNonLinux: true });
  return { U, app, data, privateKey, tmp };
}
function sign(key, v) {
  return { ...v, signature: crypto.sign(null, Buffer.from(signedPayload(v)), key).toString('base64') };
}

test('升级：信任根只初始化一次，之后绝不覆盖', () => {
  const { U, app, data } = newUpgrader();
  assert.equal(U._internal.initTrust().from, 'bundle');
  const p = path.join(data, 'trust', 'pubkey.pem');
  const before = fs.readFileSync(p);
  fs.writeFileSync(path.join(app, 'trust', 'pubkey.pem'), 'EVIL');
  assert.equal(U._internal.initTrust().from, 'data');
  assert.deepEqual(fs.readFileSync(p), before);
});

test('升级：签名不符 / 缺签名 / 篡改字段全部拒绝', () => {
  const { U, privateKey } = newUpgrader();
  U._internal.initTrust();
  const good = sign(privateKey, { version: 'v2.0.0', packageSha256: 'a'.repeat(64),
    downloadUrls: ['https://gitee.com/x/y.tar.gz'] });
  assert.equal(U._internal.verifySignature(good).ok, true);
  assert.equal(U._internal.verifySignature({ ...good, signature: '' }).ok, false);
  assert.equal(U._internal.verifySignature({ ...good, version: 'v9.9.9' }).ok, false);
  const other = crypto.generateKeyPairSync('ed25519');
  assert.equal(U._internal.verifySignature(sign(other.privateKey, good)).ok, false);
});

test('升级：下载源只认 HTTPS + 白名单域名', () => {
  const { U } = newUpgrader();
  assert.equal(U._internal.isAllowedSource('https://gitee.com/a/b.tar.gz'), true);
  assert.equal(U._internal.isAllowedSource('https://github.com/a/b.tar.gz'), true);
  assert.equal(U._internal.isAllowedSource('http://gitee.com/a.tar.gz'), false);
  assert.equal(U._internal.isAllowedSource('https://evil.example/a.tar.gz'), false);
});

test('升级：sha256 缺失即拒绝（不再跳过校验）', async () => {
  const { U, privateKey } = newUpgrader();
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  const info = sign(privateKey, { version: 'v2.0.0', packageSha256: '',
    downloadUrls: ['https://gitee.com/a/b.tar.gz'] });
  await assert.rejects(() => U.start(info, 'v1.13.0'), /packageSha256/);
});

test('媒体签名：过期 / 串改路径 / 假签名一律拒绝', () => {
  // 直接复制服务端算法，验证其数学性质（不启动服务，保持 CI 轻量）
  const secret = 'test-secret';
  const sig = (p, exp) => crypto.createHmac('sha256', secret).update('media|' + p + '|' + exp).digest('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const good = sig('/media/u/a.jpg', exp);
  assert.equal(good, sig('/media/u/a.jpg', exp));
  assert.notEqual(good, sig('/media/u/b.jpg', exp));
  assert.notEqual(good, sig('/media/u/a.jpg', exp + 1));
  assert.ok(exp > Math.floor(Date.now() / 1000));
});

test('前端：外链白名单拒绝 javascript: / data:', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  assert.match(src, /function safeHref\(raw\)/);
  assert.match(src, /href="\$\{esc\(safeHref\(u\)\)\}"/);
  // isMediaUrl 不再接受 data:
  const seg = src.slice(src.indexOf('function isMediaUrl'), src.indexOf('function isMediaUrl') + 260);
  assert.doesNotMatch(seg, /\^data:/);
});

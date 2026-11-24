#!/usr/bin/env node
/**
 * 一个不做任何业务判断的「体检」脚本，专门盯那些手改容易漏、漏了又很难发现的东西。
 * 用法：npm run check（CI 里也跑它）
 *
 * 检查项：
 *   1) 全部 JS 语法（CJS 直接 --check；ESM 先复制成 .mjs 再 --check）
 *   2) 全部 JSON 能解析
 *   3) 版本号三处一致：version.json / package.json / 前端资源戳 ?v=
 *
 * 为什么需要 3)：资源戳散在 html 和 app.js 里的 20 多处，靠手改，
 * 忘了升就会出现「页面是新的、js 还是旧的」；以前靠 Cache-Control: no-cache 兜着，
 * 一旦开长缓存就会立刻暴露。这里把它变成一条命令能查出来的事实。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
const notes = [];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.git' || name.name === 'data') continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---------- 1) JS 语法 ----------
const allFiles = walk(ROOT, []);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvt-check-'));
let jsCount = 0;
for (const f of allFiles.filter((x) => /\.(js|mjs)$/.test(x))) {
  const src = fs.readFileSync(f, 'utf8');
  // 顶层 import/export 就是 ESM；.js 在 CJS 包里用 --check 会误报，换个 .mjs 后缀再查
  const isEsm = /(^|\n)\s*(import\s+[\w{*'"]|export\s+(default|const|let|var|function|class|\{))/.test(src);
  let target = f;
  if (isEsm && !f.endsWith('.mjs')) {
    target = path.join(tmpDir, 'm' + jsCount + '.mjs');
    fs.writeFileSync(target, src);
  }
  const r = cp.spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  jsCount++;
  if (r.status !== 0) {
    const msg = String(r.stderr || '').split('\n').filter(Boolean).slice(0, 3).join(' | ');
    problems.push('语法错误 ' + path.relative(ROOT, f) + '：' + msg);
  }
}
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

// ---------- 2) JSON 可解析 ----------
let jsonCount = 0;
for (const f of allFiles.filter((x) => /\.json$/.test(x))) {
  jsonCount++;
  try { JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { problems.push('JSON 解析失败 ' + path.relative(ROOT, f) + '：' + e.message); }
}

// ---------- 3) 版本号一致 ----------
const verRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
const ver = String(verRaw || '').trim().replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+$/.test(ver)) problems.push('version.json 的版本号格式不对（应为 vX.Y.Z）：' + verRaw);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (String(pkg.version) !== ver) {
  problems.push('package.json 的 version 是 ' + pkg.version + '，version.json 是 ' + ver + '（应一致）');
}

// 资源戳：public 下 html/js 里的 ?v= / &v=
const stampFiles = allFiles.filter((x) => x.startsWith(path.join(ROOT, 'public')) && /\.(html|js)$/.test(x));
const badStamps = [];
let stampCount = 0;
for (const f of stampFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /[?&]v=(v[0-9][^"'&\s>]*)/g;
  let m;
  while ((m = re.exec(src))) {
    stampCount++;
    if (m[1] !== 'v' + ver) {
      const line = src.slice(0, m.index).split('\n').length;
      badStamps.push(path.relative(ROOT, f) + ':' + line + ' → ' + m[1]);
    }
  }
}
if (badStamps.length) {
  problems.push('有 ' + badStamps.length + ' 处资源戳不是 v' + ver + '：\n    ' + badStamps.slice(0, 12).join('\n    ')
    + (badStamps.length > 12 ? '\n    …共 ' + badStamps.length + ' 处' : ''));
}
notes.push('JS ' + jsCount + ' 个、JSON ' + jsonCount + ' 个、资源戳 ' + stampCount + ' 处，当前版本 v' + ver);

// ---------- 输出 ----------
if (problems.length) {
  console.error('✗ 体检未通过（' + problems.length + ' 项）：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('✓ 体检通过：' + notes.join('；'));

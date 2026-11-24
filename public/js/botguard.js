// botguard.js —— 登录/注册的无感风控前置：PoW 算力证明 + 行为信号采集
//
// 为什么要它（v1.13.0）：
//   之前的图形验证码在 SVG 源码里是 <text> 文本，base64 解一下就能读出题面，机器人连视觉都不需要。
//   把字改成点阵只能挡住「零成本读取」；真正能挡住算力型机器人的是 PoW ——
//   它想在提交前拿到证明，就必须在本地真算出 6 万多次 sha256，批量刷的代价立刻抬起来。
//
// 职责边界（很重要，别搞反）：
//   · PoW 是唯一不可伪造的门槛，服务端会校验；
//   · sig（行为信号）是浏览器自报的，可以伪造，只用来让服务端判断「要不要打扰真人」，
//     不是安全边界；真正的兜底在服务端（IP 限流 + 同一邮箱失败计数强制验证码）。
//   · 采集原则：只统计聚合数字（鼠标移动次数、方向变化、按键次数、字段切换、耗时、
//     是否自动填充、是否无头浏览器）。绝不采集输入内容，绝不上报任何可识别个人的字段。
const BotGuard = (function () {
  'use strict';

  // ---------- 同步 SHA-256（单块专用）----------
  // 这里输入永远是 salt(24 位 hex) + ':' + nonce(≤12 位数字)，长度 ≤ 37，填充后不超 64 字节，
  // 永远只需要处理一个块。为此省掉通用实现里的分块循环和字符串编码，比通用版快一个量级 ——
  // PoW 每次要调用几万遍，全靠这点提速。
  var K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  var H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var BUF = new Uint8Array(64);
  var DV = new DataView(BUF.buffer);
  var W = new Int32Array(64);
  var H = new Int32Array(8);
  var HEAD = new Int32Array(8);

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  // 结果只写进 HEAD（8 个 32 位字），不拼 hex 字符串 —— 判前导零只要看 HEAD[0]
  function digestHead(str) {
    var len = str.length;
    if (len > 55) return false;          // 超长直接失败，调用方按不通过处理（正常不会发生）
    BUF.fill(0);
    for (var i = 0; i < len; i++) BUF[i] = str.charCodeAt(i) & 0xff;
    BUF[len] = 0x80;
    DV.setUint32(60, len * 8, false);
    for (i = 0; i < 16; i++) W[i] = DV.getInt32(i * 4, false);
    for (i = 16; i < 64; i++) {
      var x = W[i - 15], y = W[i - 2];
      var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    for (i = 0; i < 8; i++) H[i] = H0[i];
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var mj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    HEAD[0] = (H[0] + a) | 0; HEAD[1] = (H[1] + b) | 0;
    HEAD[2] = (H[2] + c) | 0; HEAD[3] = (H[3] + d) | 0;
    HEAD[4] = (H[4] + e) | 0; HEAD[5] = (H[5] + f) | 0;
    HEAD[6] = (H[6] + g) | 0; HEAD[7] = (H[7] + h) | 0;
    return true;
  }

  // ---------- 行为信号采集（只统计聚合数字）----------
  var sig = { mm: 0, mc: 0, kd: 0, ff: 0, ac: 0, touch: 0, webdriver: 0, gl: '', t: 0 };
  var t0 = Date.now();
  var lastMoveAt = 0, lastX = null, lastDxSign = 0, lastKeyAt = 0;
  var bound = false;

  function snapshot() {
    sig.t = Date.now() - t0;
    return {
      mm: sig.mm, mc: sig.mc, kd: sig.kd, ff: sig.ff,
      ac: sig.ac, touch: sig.touch, webdriver: sig.webdriver, gl: sig.gl, t: sig.t
    };
  }

  // WebGL 渲染器名：无头浏览器常是 SwiftShader / llvmpipe，服务端据此减分
  function glName() {
    try {
      var cv = document.createElement('canvas');
      var g = cv.getContext('webgl') || cv.getContext('experimental-webgl');
      if (!g) return 'none';
      var ext = g.getExtension('WEBGL_debug_renderer_info');
      var v = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
      return String(v || '');
    } catch (e) { return ''; }
  }

  function bind() {
    if (bound) return;
    bound = true;
    try { sig.webdriver = navigator.webdriver === true ? 1 : 0; } catch (e) { /* 老浏览器忽略 */ }
    sig.gl = glName();

    // 鼠标：40ms 节流；同时统计横向方向的翻转次数 —— 机器人多是直线或瞬移，真人会有来回
    window.addEventListener('mousemove', function (e) {
      var now = Date.now();
      if (now - lastMoveAt < 40) return;
      lastMoveAt = now;
      sig.mm++;
      if (lastX !== null) {
        var dx = e.clientX - lastX;
        var sgn = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
        if (sgn && lastDxSign && sgn !== lastDxSign) sig.mc++;
        if (sgn) lastDxSign = sgn;
      }
      lastX = e.clientX;
    }, { passive: true });

    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') sig.touch = 1;
    }, { passive: true });

    window.addEventListener('keydown', function () {
      lastKeyAt = Date.now();
      sig.kd++;
    }, true);

    document.addEventListener('focusin', function () { sig.ff++; }, true);

    // 自动填充：没有按键节奏却突然出现一整段内容（密码管理器整段写入的特征），必须加分，
    // 否则「不碰鼠标、勾了记住密码直接回车」的真人会被误判成机器人
    window.addEventListener('input', function (e) {
      var v = e.target && e.target.value;
      if (typeof v !== 'string' || v.length < 6) return;
      if (!lastKeyAt || Date.now() - lastKeyAt > 400) sig.ac = 1;
    }, true);
  }

  // ---------- PoW 求解 ----------
  var POW_FRESH_MS = 120000;  // 服务端 TTL 3 分钟，本地按 2 分钟就换新，避免临界过期
  var cur = null;             // { id, nonce, at }
  var pending = null;
  var chain = Promise.resolve();

  function zeroBitsOk(word, bits) {
    if (bits >= 32) return word === 0;
    return (word >>> (32 - bits)) === 0;
  }

  function solve(p) {
    var prefix = p.salt + ':';
    var bits = Math.min(30, Math.max(8, Number(p.bits) || 16));
    var nonce = 0;
    var MAX = 3000000;        // 兜底：再算不出来就放弃，绝不让页面一直烧 CPU
    return new Promise(function (resolve) {
      function step() {
        var stop = nonce + 6000;   // 每轮约 10~30ms，避免长时间占住主线程
        for (; nonce < stop; nonce++) {
          if (!digestHead(prefix + nonce)) { resolve(null); return; }
          if (zeroBitsOk(HEAD[0], bits)) { resolve(String(nonce)); return; }
        }
        if (nonce >= MAX) { resolve(null); return; }
        setTimeout(step, 0);
      }
      step();
    });
  }

  function refresh() {
    if (pending) return pending;
    var pr;
    try {
      pr = Api.pow().then(function (r) {
        var p = r && r.data;
        if (!p || !p.id) return null;
        return solve(p).then(function (n) {
          if (n === null) return null;
          cur = { id: p.id, nonce: n, at: Date.now() };
          return cur;
        });
      }).catch(function () { return null; });
    } catch (e) {
      pr = Promise.resolve(null);
    }
    pending = pr;
    pr.then(function () { if (pending === pr) pending = null; });
    return pr;
  }

  function doAttach() {
    var use = (cur && Date.now() - cur.at < POW_FRESH_MS) ? Promise.resolve(cur) : refresh();
    return use.then(function (c) {
      var out = { pow: c ? { id: c.id, nonce: c.nonce } : null, sig: snapshot() };
      if (c && cur && c.id === cur.id) cur = null;      // 一次性：用掉就作废
      setTimeout(function () { refresh(); }, 80);       // 立刻预领下一个，供后续提交
      return out;
    });
  }

  // 串行化：同一时刻只发一个 attach，避免两次快速提交拿到同一个 nonce
  function attach() {
    var run = chain.then(doAttach);
    chain = run.catch(function () { /* 保持链不断 */ });
    return run;
  }

  // 服务端回 POW_INVALID（挑战过期/已被用）时调用：清空并重新领
  function reset() {
    cur = null;
    pending = null;
    return refresh();
  }

  function start() {
    bind();
    var go = function () { refresh(); };
    // 空闲时才算：页面刚加载正忙着渲染，别跟首屏抢主线程
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 400);
  }

  return { start: start, attach: attach, reset: reset, snapshot: snapshot };
})();
// 必须显式挂到 window：脚本顶层的 const 只创建全局词法绑定，不是 window 属性，
// auth.js 里用 window.BotGuard 判断会永远拿不到（踩过一次，症状是「行为信号全 0、必弹验证码」）。
window.BotGuard = BotGuard;

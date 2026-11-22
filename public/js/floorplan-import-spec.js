/* ============================================================
 * 「装修设计」页（floorplan.html）· 户型方案导入
 * 纯前端、零服务端：JSON / 技能 HTML / 技能 ZIP → HouseSpec → 本页几何
 *
 * 与高级设计器页的 designer-import-spec.js 相互独立（不共享 DOM / 存储），
 * 本模块只负责「读取 + 解析 + 校验」，真正的渲染通过页面暴露的钩子完成：
 *   window.__hvtApplyHouseSpec(spec)     HouseSpec / {spec,...} → 生成户型
 *   window.__hvtApplyInternalState(obj)  本页导出的旧格式方案 JSON
 * ============================================================ */
(function () {
  'use strict';

  var VER = 'v1.8.4';
  var CSS_PREFIX = 'fpi';

  var THEME = {
    light: {
      panel: '#fffdf9', panel2: '#f4efe6', text: '#2b2824', sub: '#8a8174',
      line: '#e3dccf', accent: '#b5653a', err: '#b3372a', ok: '#2f5d62'
    },
    dark: {
      panel: '#1e2430', panel2: '#252c3a', text: '#e8ecf3', sub: '#9aa6b8',
      line: '#333c4d', accent: '#5d9cec', err: '#ff6b6b', ok: '#64c8a0'
    }
  };

  function pickTheme() {
    try {
      var m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
      if (!m) return 'light';
      return (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114) > 150 ? 'light' : 'dark';
    } catch (e) { return 'light'; }
  }
  function applyVars(t) {
    var r = document.documentElement;
    ['panel', 'panel2', 'text', 'sub', 'line', 'accent', 'err', 'ok'].forEach(function (k) {
      r.style.setProperty('--fpi-' + k, t[k]);
    });
  }
  function injectCSS() {
    if (document.getElementById('fpi-style')) return;
    var st = document.createElement('style');
    st.id = 'fpi-style';
    st.textContent = [
      '#fpi-panel{position:fixed;right:316px;bottom:14px;z-index:9998;width:360px;max-height:min(74vh,620px);',
      'display:none;flex-direction:column;border-radius:12px;overflow:hidden;',
      'box-shadow:0 16px 44px rgba(0,0,0,.32);border:1px solid var(--fpi-line);',
      'background:var(--fpi-panel);color:var(--fpi-text);',
      'font:13px/1.55 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}',
      '#fpi-panel.open{display:flex}',
      '.fpi-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--fpi-line);flex:0 0 auto}',
      '.fpi-title{font-weight:600;font-size:13px;flex:1}',
      '.fpi-x{width:24px;height:24px;border:0;border-radius:6px;cursor:pointer;background:transparent;color:var(--fpi-sub);font-size:17px;line-height:1}',
      '.fpi-x:hover{background:var(--fpi-panel2);color:var(--fpi-text)}',
      '.fpi-body{padding:11px 12px 13px;overflow-y:auto;flex:1 1 auto;scrollbar-width:thin}',
      '.fpi-note{margin:0 0 9px;color:var(--fpi-sub);font-size:11.6px;line-height:1.55}',
      '.fpi-ta{width:100%;box-sizing:border-box;min-height:160px;resize:vertical;border-radius:8px;',
      'border:1px solid var(--fpi-line);background:var(--fpi-panel2);color:var(--fpi-text);',
      'font:11.4px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:8px 9px}',
      '.fpi-row{display:flex;gap:8px;align-items:center;margin-top:9px;flex-wrap:wrap}',
      '.fpi-btn{flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--fpi-line);',
      'cursor:pointer;background:var(--fpi-panel2);color:var(--fpi-text);font-family:inherit;font-size:12.5px;font-weight:600;white-space:nowrap}',
      '.fpi-btn:hover{border-color:var(--fpi-accent)}',
      '.fpi-btn.primary{background:var(--fpi-accent);border-color:var(--fpi-accent);color:#fff}',
      '.fpi-file{color:var(--fpi-accent);cursor:pointer;font-size:11.6px;text-decoration:underline}',
      '.fpi-msg{margin-top:9px;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.5}',
      '.fpi-msg.err{background:rgba(179,55,42,.1);color:var(--fpi-err)}',
      '.fpi-msg.ok{background:rgba(47,93,98,.1);color:var(--fpi-ok)}',
      '@media (max-width:1100px){#fpi-panel{right:14px;width:min(360px,calc(100vw - 28px))}}'
    ].join('');
    document.head.appendChild(st);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var panel = null, body = null;
  function msg(text, kind) {
    if (!body) return;
    var old = body.querySelector('.fpi-msg'); if (old) old.remove();
    var d = document.createElement('div');
    d.className = 'fpi-msg ' + (kind || 'err');
    d.textContent = text;
    body.appendChild(d);
  }

  // ---------------------------------------------------------------- 解析
  // 技能 HTML：<script id="__preset">window.__PRESET__={...}</script>
  function extractPreset(html) {
    var m = html.match(/<script[^>]*\bid="__preset"[^>]*>\s*window\.__PRESET__\s*=\s*([\s\S]*?)<\/script>/i);
    if (!m) m = html.match(/window\.__PRESET__\s*=\s*([\s\S]*?)<\/script>/i);
    if (!m) m = html.match(/window\.__PRESET__\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:<\/script>|$)/i);
    if (!m) return null;
    var raw = m[1];
    try { return JSON.parse(raw); }
    catch (e) {
      var last = raw.lastIndexOf('}');
      if (last > 0) { try { return JSON.parse(raw.slice(0, last + 1)); } catch (e2) {} }
      return null;
    }
  }
  function parseInput(text) {
    try {
      var j = JSON.parse(text);
      if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    } catch (e) { /* 可能是 HTML */ }
    var p = extractPreset(text);
    if (p) return p;
    return null;
  }

  // 是否 HouseSpec：认技能的小写 walls/rooms；本页旧格式用大写 WALLS/ROOMS
  // 注意：技能 spec.json 自带 furniture:[{at,key,rot}]，不能拿 furniture 当旧格式判据
  function isHouseSpec(o) {
    return !!(o && typeof o === 'object' && !Array.isArray(o) &&
      (Array.isArray(o.walls) || Array.isArray(o.rooms)) &&
      !Array.isArray(o.WALLS) && !Array.isArray(o.ROOMS));
  }

  // 校验并应用
  function applyObject(obj) {
    // 优先认 HouseSpec（可能是裸 spec，或技能 HTML/preset 的 {spec,...} 包裹）
    var spec = isHouseSpec(obj.spec) ? obj.spec : (isHouseSpec(obj) ? obj : null);

    if (!spec) {
      // 旧格式：本页「导出方案 JSON」产出的 state（WALLS/ROOMS/furniture）
      if (Array.isArray(obj.WALLS) || Array.isArray(obj.ROOMS) || Array.isArray(obj.furniture)) {
        if (typeof window.__hvtApplyInternalState !== 'function') { msg('页面尚未就绪，请刷新后重试', 'err'); return false; }
        window.__hvtApplyInternalState(obj);
        return true;
      }
      msg('没找到 walls 或 rooms 数组，这不像一份户型方案（HouseSpec）', 'err');
      return false;
    }
    if (!Array.isArray(spec.walls) && !Array.isArray(spec.rooms)) {
      msg('没找到 walls 或 rooms 数组，这不像一份户型方案（HouseSpec）', 'err'); return false;
    }
    if (Array.isArray(spec.walls)) {
      for (var i = 0; i < spec.walls.length; i++) {
        var w = spec.walls[i];
        if (!w || !Array.isArray(w.a) || !Array.isArray(w.b) || w.a.length < 2 || w.b.length < 2) {
          msg('第 ' + (i + 1) + ' 面墙的 a / b 必须是 [x, y] 坐标', 'err'); return false;
        }
      }
    }
    if (typeof window.hsToFloorplan !== 'function') { msg('转换模块未加载，请强制刷新页面（Ctrl+F5）', 'err'); return false; }
    if (typeof window.__hvtApplyHouseSpec !== 'function') { msg('页面尚未就绪，请刷新后重试', 'err'); return false; }
    var res = window.__hvtApplyHouseSpec(spec);
    return !!res;
  }

  function doImportText(text) {
    if (!text || !text.trim()) { msg('请先粘贴 JSON / HTML 内容，或点下方选择文件', 'err'); return false; }
    var obj = parseInput(text);
    if (!obj) { msg('无法识别：既不是合法 JSON，也没在 HTML 里找到 window.__PRESET__', 'err'); return false; }
    return applyObject(obj);
  }

  // ZIP：只在浏览器内存里解压，取 spec.json（无则取第一个 .json），其余文件不落盘
  function readZipFile(file, onText) {
    if (typeof JSZip === 'undefined') { msg('解压库未加载，请改用 .json / .html 文件，或强制刷新页面', 'err'); return; }
    msg('正在解压 ' + file.name + ' …', 'ok');
    var rd = new FileReader();
    rd.onload = function () {
      JSZip.loadAsync(rd.result).then(function (zip) {
        var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir && /\.json$/i.test(n); });
        if (!names.length) { msg('压缩包里没找到 .json 方案文件', 'err'); return; }
        var target = names.filter(function (n) { return n.toLowerCase().split('/').pop() === 'spec.json'; })[0] || names[0];
        zip.files[target].async('string').then(function (txt) {
          msg('已从压缩包取出 ' + target + '（其余文件未保存），正在生成…', 'ok');
          onText(txt);
        }).catch(function (e) { msg('读取 ' + target + ' 失败：' + e.message, 'err'); });
      }).catch(function (e) { msg('解压失败：' + e.message, 'err'); });
    };
    rd.onerror = function () { msg('读取文件失败', 'err'); };
    rd.readAsArrayBuffer(file);
  }

  // 对外：供菜单「导入方案」直接调用（文件 / 文本）
  function importFile(file) {
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      readZipFile(file, function (txt) {
        if (doImportText(txt)) showOk();
      });
      return;
    }
    var rd = new FileReader();
    rd.onload = function () { if (doImportText(rd.result)) showOk(); };
    rd.onerror = function () { msg('读取文件失败', 'err'); };
    rd.readAsText(file);
  }
  function importText(text) { return doImportText(text); }

  function showOk() {
    msg('已导入并生成户型，可直接编辑 / 切换 3D 查看', 'ok');
  }

  // ---------------------------------------------------------------- UI
  function importView() {
    body.innerHTML =
      '<p class="fpi-note">支持三种来源：户型 <b>JSON</b>；house-plan-designer 技能导出的 <b>HTML</b>（自动提取 window.__PRESET__）；技能打包的 <b>.zip</b>（只取里面的 spec.json，其余文件用完即弃、不保存）。导入后立即在本页生成墙体、门窗与房间，不刷新页面。</p>' +
      '<textarea class="fpi-ta" id="fpi-ta" placeholder=\'粘贴 HouseSpec JSON，或整段粘贴技能导出的 HTML…\'></textarea>' +
      '<div class="fpi-row">' +
      '  <button class="fpi-btn primary" data-act="fpi-do" type="button">导入并生成</button>' +
      '  <span class="fpi-file" data-act="fpi-file">选择 .json / .html / .zip 文件</span>' +
      '</div>';
    var fileTag = body.querySelector('[data-act="fpi-file"]');
    fileTag.addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,.html,.zip,application/json,text/html,application/zip';
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        try { document.body.removeChild(inp); } catch (e) {}
        if (!f) return;
        importFile(f);
      };
      inp.click();
    });
  }

  function build() {
    injectCSS();
    applyVars(THEME[pickTheme()]);

    panel = document.createElement('div');
    panel.id = 'fpi-panel';
    panel.innerHTML = '<div class="fpi-head"><div class="fpi-title">导入户型方案</div><button class="fpi-x" type="button" title="关闭">×</button></div><div class="fpi-body"></div>';
    document.body.appendChild(panel);
    body = panel.querySelector('.fpi-body');

    panel.querySelector('.fpi-x').addEventListener('click', function () { panel.classList.remove('open'); });
    body.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b || b.getAttribute('data-act') !== 'fpi-do') return;
      var ta = document.getElementById('fpi-ta');
      if (ta && doImportText(ta.value)) showOk();
    });
  }

  // 导出钩子（供页面内的「导入方案」菜单复用）
  // 底部浮动按钮取消后，菜单项同时承担「打开 / 收起」；面板内 × 仍可关闭
  window.__hvtOpenImportPanel = function () {
    if (!panel) build();
    if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
    panel.classList.add('open');
    importView();
  };
  window.__hvtImportFile = importFile;
  window.__hvtImportText = importText;

  function init() { if (!document.getElementById('fpi-panel')) build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

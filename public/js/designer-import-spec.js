/* ============================================================
 * 高级设计器 · 方案导入（无 AI / 无 LightAgent）
 * 只保留「从外部导入户型方案」这一条能力，支持两类来源：
 *   1) 纯 JSON：在 WorkBuddy / 其他工具里生成的 HouseSpec（纯 spec 或 {spec,...}）
 *   2) house-plan-designer 技能导出的 HTML：自动提取 <script id="__preset">window.__PRESET__={...}</script>
 * 流程：粘贴 / 选择文件 → 解析 → 基本结构校验 → 写 localStorage['hvt-design-spec'] → 重载设计器。
 * 不调用任何 /api/agent/* 或 /api/ai/*，纯前端，渲染交给设计器本身。
 * ============================================================ */
(function () {
  'use strict';

  var VER = 'v1.8.1';

  var THEME = {
    dark: {
      panel: '#1e2430', panel2: '#252c3a', text: '#e8ecf3', sub: '#9aa6b8',
      line: '#333c4d', accent: '#5d9cec', err: '#ff6b6b', warn: '#f0b429', info: '#7fa8d8',
      btnText: '#fff'
    },
    light: {
      panel: '#ffffff', panel2: '#f5f7fa', text: '#1f2733', sub: '#6b7688',
      line: '#e2e6ee', accent: '#3b82f6', err: '#d93025', warn: '#b7791f', info: '#4a6fa5',
      btnText: '#fff'
    }
  };

  function pickTheme() {
    try {
      var m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
      if (!m) return 'dark';
      var r = +m[0], g = +m[1], b = +m[2];
      return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function injectCSS() {
    if (document.getElementById('dai-style')) return;
    var st = document.createElement('style');
    st.id = 'dai-style';
    st.textContent = [
      '#dai-fab{position:fixed;right:18px;bottom:52px;z-index:9997;display:flex;align-items:center;gap:6px;',
      'padding:9px 15px;border-radius:22px;border:1px solid rgba(255,255,255,.16);cursor:pointer;',
      'font:600 13px/1 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;',
      'box-shadow:0 6px 20px rgba(0,0,0,.28);transition:transform .15s,box-shadow .15s;',
      'background:linear-gradient(135deg,#5d9cec,#3b6fd4);color:#fff}',
      '#dai-fab:hover{transform:translateY(-1px);box-shadow:0 9px 26px rgba(0,0,0,.34)}',
      '#dai-fab svg{width:15px;height:15px;flex:0 0 15px}',
      '#dai-panel{position:fixed;right:18px;bottom:100px;z-index:9998;width:372px;max-height:min(74vh,660px);',
      'display:none;flex-direction:column;border-radius:14px;overflow:hidden;',
      'box-shadow:0 18px 48px rgba(0,0,0,.4);border:1px solid var(--dai-line);',
      'background:var(--dai-panel);color:var(--dai-text);',
      'font:13px/1.55 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}',
      '#dai-panel.open{display:flex}',
      '.dai-head{display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid var(--dai-line);flex:0 0 auto}',
      '.dai-title{font-weight:600;font-size:13.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dai-x{width:24px;height:24px;border:0;border-radius:7px;cursor:pointer;background:transparent;color:var(--dai-sub);font-size:17px;line-height:1}',
      '.dai-x:hover{background:var(--dai-panel2);color:var(--dai-text)}',
      '.dai-body{padding:12px 13px 14px;overflow-y:auto;flex:1 1 auto;scrollbar-width:thin}',
      '.dai-btn{flex:1;min-width:0;padding:8px 10px;border-radius:9px;border:1px solid var(--dai-line);cursor:pointer;',
      'background:var(--dai-panel2);color:var(--dai-text);font-family:inherit;font-size:12.5px;font-weight:600;line-height:1.2;white-space:nowrap}',
      '.dai-btn:hover{border-color:var(--dai-accent)}',
      '.dai-btn.primary{background:var(--dai-accent);border-color:var(--dai-accent);color:#fff}',
      '.dai-btn:disabled{opacity:.55;cursor:default}',
      '.dai-link{border:0;background:none;padding:0;margin-top:3px;color:var(--dai-accent);',
      'font:inherit;font-size:11.5px;cursor:pointer;text-decoration:underline}',
      '.dai-err-bar{padding:9px 11px;border-radius:9px;background:rgba(217,48,37,.12);color:var(--dai-err);font-size:12.4px;margin-bottom:9px}',
      '.dai-loading{display:flex;align-items:center;gap:8px;color:var(--dai-sub);font-size:12.4px;padding:8px 0}',
      '.dai-imp{padding:11px 11px 13px;border-radius:10px;background:var(--dai-panel2);border:1px solid var(--dai-line);margin-bottom:10px}',
      '.dai-imp h4{margin:0 0 7px;font-size:12.6px;font-weight:600}',
      '.dai-imp p{margin:0 0 8px;color:var(--dai-sub);font-size:11.4px;line-height:1.5}',
      '.dai-ta{width:100%;box-sizing:border-box;min-height:172px;resize:vertical;border-radius:9px;border:1px solid var(--dai-line);',
      'background:var(--dai-panel);color:var(--dai-text);font:11.6px/1.55 ui-monospace,Menlo,Consolas,monospace;padding:9px 10px}',
      '.dai-imp-row{display:flex;gap:8px;align-items:center;margin:9px 0 0;flex-wrap:wrap}',
      '.dai-file{font-size:11.6px;color:var(--dai-accent);cursor:pointer;text-decoration:underline}',
      '.dai-imp .dai-btn{flex:0 0 auto}'
    ].join('');
    document.head.appendChild(st);
  }

  function applyVars(t) {
    var root = document.documentElement;
    root.style.setProperty('--dai-panel', t.panel);
    root.style.setProperty('--dai-panel2', t.panel2);
    root.style.setProperty('--dai-text', t.text);
    root.style.setProperty('--dai-sub', t.sub);
    root.style.setProperty('--dai-line', t.line);
    root.style.setProperty('--dai-accent', t.accent);
    root.style.setProperty('--dai-err', t.err);
    root.style.setProperty('--dai-warn', t.warn);
    root.style.setProperty('--dai-info', t.info);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var panel, body, btnFab;

  function fail(msg) {
    if (body) body.innerHTML = '<div class="dai-err-bar">' + esc(msg) + '</div>';
  }

  // ---------------------------------------------------------------- 导入外部方案（JSON / HTML / ZIP）
  function importSpecView() {
    body.dataset.ready = '1';
    body.innerHTML =
      '<div class="dai-imp">' +
      '<h4>导入外部生成的方案（JSON / HTML / ZIP）</h4>' +
      '<p>三种来源都支持：① 户型 <code>JSON</code>；② house-plan-designer 技能导出的 <code>HTML</code>（自动提取 <code>window.__PRESET__</code>）；③ 技能打包的 <code>.zip</code>（自动解压取里面的 <code>spec.json</code>，其余文件不保存、用完即弃）。只做基本结构校验，渲染交给设计器。</p>' +
      '<textarea class="dai-ta" id="dai-imp-ta" placeholder=\'粘贴 JSON，或整段粘贴技能导出的 HTML…\'></textarea>' +
      '<div class="dai-imp-row">' +
      '  <button class="dai-btn primary" data-act="import-do" type="button">导入并载入</button>' +
      '  <span class="dai-file" data-act="import-file">选择 .json / .html / .zip 文件</span>' +
      '</div></div>';
    var ta = body.querySelector('#dai-imp-ta');
    var fileTag = body.querySelector('[data-act="import-file"]');
    fileTag.addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,.html,.zip,application/json,text/html,application/zip';
      inp.style.display = 'none'; document.body.appendChild(inp);
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        try { document.body.removeChild(inp); } catch (e) {}
        if (!f) return;
        var lower = f.name.toLowerCase();
        if (lower.endsWith('.zip')) { readZipFile(f, ta); return; }
        var rd = new FileReader();
        rd.onload = function () { try { ta.value = rd.result; } catch (e) {} };
        rd.readAsText(f);
      };
      inp.click();
    });
  }

  // 前端解压 zip：只在浏览器内存里读，提取 spec.json（无则取第一个 *.json），其余文件不落盘。
  function readZipFile(file, ta) {
    if (typeof JSZip === 'undefined') { fail('解压库未加载，无法处理 zip，请改用 JSON / HTML 文件'); return; }
    var note = body.querySelector('.dai-imp-note');
    if (note) note.remove();
    var loading = document.createElement('div');
    loading.className = 'dai-imp-note';
    loading.style.cssText = 'margin-top:8px;color:var(--dai-sub);font-size:11px';
    loading.textContent = '正在解压 ' + file.name + ' …';
    body.querySelector('.dai-imp').appendChild(loading);
    var rd = new FileReader();
    rd.onload = function () {
      JSZip.loadAsync(rd.result).then(function (zip) {
        var names = Object.keys(zip.files).filter(function (n) {
          return !zip.files[n].dir && n.toLowerCase().endsWith('.json');
        });
        if (!names.length) { fail('压缩包里没找到 .json 方案文件'); return; }
        // 优先 spec.json，其次任何顶层/子目录里的 *.json
        var target = names.filter(function (n) { return n.toLowerCase().split('/').pop() === 'spec.json'; })[0] || names[0];
        zip.files[target].async('string').then(function (txt) {
          ta.value = txt;
          loading.textContent = '已从压缩包提取 ' + target + '（' + names.length + ' 个 json 中选用），点击「导入并载入」继续。其余文件未保存。';
        }).catch(function (e) { fail('读取 ' + target + ' 失败：' + e.message); });
      }).catch(function (e) { fail('解压失败：' + e.message); });
    };
    rd.onerror = function () { fail('读取文件失败'); };
    rd.readAsArrayBuffer(file);
  }

  // 把输入文本解析成 preset/spec 对象。支持：
  //   a) 纯 JSON（对象，可能含 spec 字段，也可能是纯 spec）
  //   b) house-plan-designer 技能导出的 HTML：<script id="__preset">window.__PRESET__={...}</script>
  function parseInput(text) {
    // 1) 先试纯 JSON
    try {
      var j = JSON.parse(text);
      if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    } catch (e) { /* 不是纯 JSON，往下试 HTML */ }

    // 2) 从 HTML 里抠 window.__PRESET__ 的数据对象
    var preset = extractPreset(text);
    if (preset) return preset;

    fail('无法识别：既不是合法 JSON，也没在 HTML 里找到 window.__PRESET__（house-plan-designer 技能导出的 HTML 应含此标记）。请确认粘贴的是完整内容或正确文件。');
    return null;
  }

  // 提取技能 HTML 内联的方案数据；优先带 id="__preset" 的 script 块（build.py 注入位置），兜底任意写法。
  function extractPreset(html) {
    var m = html.match(/<script[^>]*\bid="__preset"[^>]*>\s*window\.__PRESET__\s*=\s*([\s\S]*?)<\/script>/i);
    if (!m) m = html.match(/window\.__PRESET__\s*=\s*([\s\S]*?)<\/script>/i);
    if (!m) m = html.match(/window\.__PRESET__\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:<\/script>|$)/i);
    if (!m) return null;
    var raw = m[1];
    try { return JSON.parse(raw); }
    catch (e) {
      // 兜底截断到最后一个 }（应对非贪婪截到内嵌 } 的情况）
      var last = raw.lastIndexOf('}');
      if (last > 0) { try { return JSON.parse(raw.slice(0, last + 1)); } catch (e2) {} }
      return null;
    }
  }

  function doImport() {
    var ta = document.getElementById('dai-imp-ta');
    var text = ta ? ta.value : '';
    if (!text || !text.trim()) { fail('请先粘贴或选择 JSON / HTML 文件内容'); return; }
    var obj = parseInput(text);
    if (!obj) return; // parseInput 已 fail
    var spec = (obj.spec && typeof obj.spec === 'object') ? obj.spec : obj;
    if (!Array.isArray(spec.walls) && !Array.isArray(spec.rooms)) {
      fail('方案里没找到 walls 或 rooms 数组，无法导入（标准 HouseSpec 至少要有一个）'); return;
    }
    if (Array.isArray(spec.walls)) {
      for (var i = 0; i < spec.walls.length; i++) {
        var w = spec.walls[i];
        if (!w || !Array.isArray(w.a) || !Array.isArray(w.b) || w.a.length < 2 || w.b.length < 2) {
          fail('第 ' + (i + 1) + ' 面墙的 a / b 必须是 [x, y] 坐标'); return;
        }
      }
    }
    // 优先保留技能算出的 id / underlay（防止浏览器用旧存档盖住新户型；带底图叠原图）
    var preset = { spec: spec, id: obj.id || ('import-' + Date.now().toString(36)) };
    if (obj.underlay && typeof obj.underlay === 'object') preset.underlay = obj.underlay;
    if (obj.underlays && Array.isArray(obj.underlays)) preset.underlays = obj.underlays;
    try {
      // 清掉旧存档：设计器优先读 house-designer-v2-*，留着会盖住新方案
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('house-designer-v2') === 0) localStorage.removeItem(k);
      });
      localStorage.setItem('hvt-design-spec', JSON.stringify(preset));
    } catch (e) { fail('存不进浏览器存储：' + e.message); return; }
    body.innerHTML = '<div class="dai-loading">已导入，正在载入设计器…</div>';
    setTimeout(function () { location.reload(); }, 400);
  }

  function bind() {
    body.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'import-do') doImport();
    });
  }

  function build() {
    injectCSS();
    var t = THEME[pickTheme()];
    applyVars(t);

    btnFab = document.createElement('button');
    btnFab.id = 'dai-fab';
    btnFab.type = 'button';
    btnFab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg><span>导入方案</span>';
    btnFab.title = '从外部 JSON / HTML 载入户型方案';
    document.body.appendChild(btnFab);

    panel = document.createElement('div');
    panel.id = 'dai-panel';
    panel.innerHTML = [
      '<div class="dai-head">',
      '  <div class="dai-title">导入方案</div>',
      '  <button class="dai-x" type="button" title="关闭">×</button>',
      '</div>',
      '<div class="dai-body"></div>'
    ].join('');
    document.body.appendChild(panel);
    body = panel.querySelector('.dai-body');

    btnFab.addEventListener('click', function () {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) importSpecView();
    });
    panel.querySelector('.dai-x').addEventListener('click', function () {
      panel.classList.remove('open');
    });
    bind();
  }

  function init() {
    if (document.getElementById('dai-fab')) return;
    build();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

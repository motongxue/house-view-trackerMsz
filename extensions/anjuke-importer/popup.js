/* popup.js —— 展示采集结果、导出 CSV / 复制 JSON / 一键导入 / 系统地址配置。
 * 不区分站点：面板读的是 background 统一产出的 payload。
 * 顶部明确标出「当前标签页是什么」和「下面这份数据是哪次采集留下的」，
 * 避免扩展重载后把上一个楼盘的旧数据误当成当前页刚采到的。
 */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  let state = null;
  let cfgState = null;     // 后台回传的 cfg（base / hasToken / connOk）
  let autoFixed = false;   // 每次打开弹窗最多自动补加载一次，避免反复注入
  let autoFixState = '';   // F152：'' / 'doing' / 'failed'，纳入 renderDiag 统一渲染
  let autoFixErr = '';

  function say(s) { $('msg').textContent = s || ''; if (s) setTimeout(function () { if ($('msg').textContent === s) $('msg').textContent = ''; }, 5000); }
  // F255：捕获 lastError，扩展重载后给出可读错误而不是空提示
  function send(m, cb) {
    chrome.runtime.sendMessage(m, function (r) {
      const err = chrome.runtime.lastError;
      if (err) { if (cb) cb({ ok: false, error: err.message || String(err) }); return; }
      if (cb) cb(r || {});
    });
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function line(cls, text) { return '<div class="' + cls + '">' + esc(text) + '</div>'; }
  function ago(ts) {
    if (!ts) return '时间未知';
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }
  function shortUrl(u) {
    const s = String(u || '');
    try { const x = new URL(s); return x.host + x.pathname; } catch (e) { return s.slice(0, 70); }
  }

  function renderDiag(d) {
    if (!d || !d.ok) { $('diag').innerHTML = line('warn', '页面状态读取失败：' + ((d && d.error) || '')); return; }
    const x = d.data || {};
    // 扩展刚「重新加载」时，已打开的房源页不会自动注入脚本：点开弹窗就自动补加载一次。
    const shouldFix = !autoFixed && x.siteSupported && !x.scriptAlive && !x.blockedHint;
    if (shouldFix) { autoFixed = true; autoFixState = 'doing'; }

    const h = [];
    if (x.blockedHint) h.push(line('bad', x.blockedHint));
    if (x.siteSupported) {
      h.push(line('ok', '当前页：' + x.siteName + '房源详情页 · ' + shortUrl(x.tabUrl)));
      h.push(line(x.scriptAlive ? 'ok' : 'bad', x.scriptAlive
        ? (x.scriptPanel ? '✓ 采集浮层已加载' : '✓ 采集脚本已加载（浮层被关掉了，仍可重采）')
        : '✗ 本页没有采集脚本（常见于刚重新加载扩展），点开本面板会自动补加载'));
    } else if (!x.blockedHint) {
      h.push(line('warn', '当前页不是可采集的房源页：' + (shortUrl(x.tabUrl) || '未知页面')));
    }
    if (x.stateHasData) {
      h.push(line('src', '面板显示的是：' + (x.stateName || x.stateSite) + ' · ' + esc(x.stateId || '') +
        ' · ' + ago(x.stateAt) + ' 采集 · ' + shortUrl(x.stateUrl)));
      if (x.siteSupported && x.stateSite !== x.site) {
        h.push(line('bad', '⚠ 站点不一致：这份是上一次的' + (x.stateName || x.stateSite) +
          '数据，不是当前' + x.siteName + '页的。请点「清空重采」。'));
      } else if (x.siteSupported && x.stateUrl && x.tabUrl &&
                 x.stateUrl.split('?')[0] !== x.tabUrl.split('?')[0]) {
        h.push(line('warn', '⚠ 这份数据来自另一个房源页，请点「清空重采」。'));
      }
    } else {
      h.push(line('warn', '还没有采到任何房源数据'));
    }
    // F152：补加载状态作为 state 的一部分统一渲染，避免被后续 innerHTML 重设抹掉
    if (autoFixState === 'doing') h.push(line('warn', '正在自动补加载采集脚本…'));
    else if (autoFixState === 'failed') h.push(line('bad', '自动补加载失败：' + (autoFixErr || '请刷新房源页')));
    $('diag').innerHTML = h.join('');

    if (shouldFix) {
      tabUrl(function (u) {
        send({ type: 'HVT_ENSURE', tabUrl: u }, function (r) {
          if (!r || !r.ok) {
            autoFixState = 'failed';
            autoFixErr = (r && r.error) || '请刷新房源页';
            renderDiag(d); // 重新渲染显示失败行（autoFixed 已置位，不会再次触发）
            return;
          }
          // F029：依据真实 scriptAlive 信号确认注入，有限重试而非固定 1800ms 盲等
          waitScriptAlive(u, function (alive) {
            autoFixState = '';
            load();
            if (!alive) say('脚本已补加载，若仍未采集到请刷新房源页');
          }, 3);
        });
      });
    }
  }

  // F029：轮询 HVT_DIAG 直到脚本真的响应，最多 left 次，避免停在过期状态
  function waitScriptAlive(u, cb, left) {
    send({ type: 'HVT_DIAG', tabUrl: u }, function (chk) {
      if (chk && chk.ok && chk.data && chk.data.scriptAlive) { cb(true); return; }
      if (left <= 0) { cb(false); return; }
      setTimeout(function () { waitScriptAlive(u, cb, left - 1); }, 600);
    });
  }

  // 5 步向导：已完成的打勾，第一个未完成的高亮；第 5 步永远可直接点
  function renderSteps() {
    const input = String($('base').value || '').trim().replace(/\/+$/, '');
    const cfg = cfgState || {};
    const saved = String(cfg.base || '').replace(/\/+$/, '');
    const inputOk = /^https?:\/\//.test(input);
    const savedOk = !!saved && saved === input;
    const done = [inputOk, savedOk, !!(cfg.connOk && savedOk), !!cfg.hasToken, false];
    let cur = -1;
    for (let i = 0; i < 4; i++) { if (!done[i]) { cur = i; break; } }
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    const flags = ['f1', 'f2', 'f3', 'f4', 'f5'];
    for (let j = 0; j < 5; j++) {
      $(ids[j]).className = 'step' + (done[j] ? ' done' : (j === cur ? ' cur' : ''));
      $(flags[j]).textContent = done[j] ? '✓' : '';
    }
    $('d2').textContent = savedOk ? ('已保存：' + saved) : '点右边按钮，浏览器询问权限时点允许';
    $('d3').textContent = done[2] ? '连接正常' : (savedOk ? '确认服务器能访问' : '先完成第 1、2 步');
    $('d4').textContent = done[3] ? '已取得登录态，可直接导入' : '首次使用需注册账号，登录后自动取得';
    $('d5').textContent = (cur === -1)
      ? '前 4 步已完成，可直接导入'
      : '前 4 步还有未完成的（第 ' + (cur + 1) + ' 步），也可直接尝试';
  }

  function render(r) {
    if (!r || !r.ok) { say('读取失败：' + ((r && r.error) || '')); return; }
    if (!r.data) { say('读取失败：数据为空'); return; } // F156
    state = r.data;
    const s = state.stats || {};
    const single = !!state.singlePage;
    $('name').textContent = state.name || '尚未采集到房源';
    $('phase').textContent = !state.hasMain ? '尚未采集到房源' : (single
      ? (state.siteName || '当前站点') + ' · ✓ 单页采集完成（一次采全，无需跳第二页）'
      : (state.hasMain ? '✓ 基础信息' : '○ 基础信息') + ' / ' +
        (state.hasParams ? '✓ 详细信息' : '○ 详细信息（点页面里的「更多信息 >」）'));
    $('stats').textContent = 'CSV ' + (s.csvTotal || 0) + ' 列已填 ' + (s.csvFilled || 0) + ' 列 · 房源图 ' +
      ((s.media || {}).images || 0) + ' / 户型图 ' + ((s.media || {}).floorPlans || 0) +
      ' / 区位沙盘 ' + ((s.media || {}).environment || 0) + ' / VR ' + ((s.media || {}).vr || 0) +
      (s.detailGroups ? ' · 详情 ' + s.detailGroups + ' 组 · 预售证 ' + (s.permits || 0) + ' 条' : '') +
      (s.coordSource ? ' · 坐标 ' + s.coordSource : '');
    $('fieldsHead').textContent = '字段明细（系统 CSV ' + (s.csvTotal || 0) + ' 列）';
    $('fields').innerHTML = (state.fields || []).map(function (f) {
      const empty = (f.value === '' || f.value === null || f.value === undefined);
      return '<div class="f' + (empty ? ' empty' : '') + '"><span class="k">' + esc(f.label) +
        '</span><span class="v">' + (empty ? '—' : esc(String(f.value).slice(0, 120))) + '</span></div>';
    }).join('');
    cfgState = r.cfg || {};
    $('base').value = cfgState.base || '';
    const disabled = !state.hasMain;
    ['csv', 'push', 'copy'].forEach(function (id) { $(id).disabled = disabled; });
    renderSteps();
  }

  // 当前标签页 URL 由弹窗侧读取后传给后台做兜底（MV3 未申请 tabs 权限时后台可能读不到 url）
  function tabUrl(cb) {
    if (!chrome.tabs || !chrome.tabs.query) return cb('');
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (t) {
        cb((t && t[0] && t[0].url) || '');
      });
    } catch (e) { cb(''); }
  }

  function load() {
    tabUrl(function (u) { send({ type: 'HVT_DIAG', tabUrl: u }, renderDiag); });
    send({ type: 'HVT_STATE' }, render);
  }

  // 地址一改就重新判定前几步的完成状态，不用等重新打开弹窗
  $('base').addEventListener('input', renderSteps);

  $('csv').addEventListener('click', function () {
    send({ type: 'HVT_DATA' }, function (r) {
      if (!r.ok) return say(r.error || '生成失败');
      if (!r.data) return say('生成失败：数据为空');
      const prefix = (r.data.site || 'house') + '-' + (r.data.id || r.data.loupanId || 'house');
      send({ type: 'HVT_DOWNLOAD', csv: r.data.csv, filename: prefix + '-import.csv' },
        function (d) { say(d.ok ? '已下载 CSV，去系统点「导入 CSV」' : ('下载失败：' + (d.error || ''))); });
    });
  });

  $('push').addEventListener('click', function () {
    send({ type: 'HVT_PUSH' }, function (r) { say(r.ok ? ('已导入系统：' + r.name) : ('导入失败：' + (r.error || ''))); });
  });

  $('copy').addEventListener('click', function () {
    send({ type: 'HVT_DATA' }, function (r) {
      if (!r.ok) return say(r.error || '读取失败');
      const text = (r.data && r.data.jsonText) || '';
      if (!text) return say('没有可复制的数据');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { say('JSON 已复制'); },
          function () { fallbackCopy(text); }
        );
      } else fallbackCopy(text);
    });
  });

  // F028：clipboard API 在弹窗失焦/非安全上下文会 reject，回退到 execCommand
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      say(ok ? 'JSON 已复制' : '复制失败，请从插件面板查看');
    } catch (e) { say('复制失败，请从插件面板查看'); }
  }

  // 清空并重采：真的触发当前页采集（必要时补注入 content script），然后轮询结果
  $('clear').addEventListener('click', function () {
    const btn = $('clear');
    btn.disabled = true; say('正在清空并重新采集当前页…');
    tabUrl(function (u) { send({ type: 'HVT_RECOLLECT', tabUrl: u }, onResult); });
    function onResult(r) {
      if (!r.ok) {
        btn.disabled = false;
        say('重采失败：' + (r.error || '未知错误'));
        load();
        return;
      }
      say(r.injected ? '已补加载采集脚本，正在读取页面…' : '正在读取页面…');
      let n = 0, fails = 0;
      const t = setInterval(function () {
        n++;
        send({ type: 'HVT_STATE' }, function (st) {
          // F153：send() 已把 lastError 映射为 st.error；连续失败时提前终止，避免 interval 空转
          if (!st || !st.ok) {
            fails++;
            if (fails >= 3 || (st && st.error && /context|invalidated|扩展/i.test(st.error))) {
              clearInterval(t);
              btn.disabled = false;
              say('读取状态失败：' + ((st && st.error) || '扩展可能已更新，请刷新页面'));
              return;
            }
            if (n >= 14) {
              clearInterval(t);
              btn.disabled = false;
              say('已触发重采，但还没读到数据；若页面弹出网站验证，请先完成验证再刷新页面');
              load();
            }
            return;
          }
          const got = !!(st.data && st.data.hasMain);
          if (got || n >= 14) {
            clearInterval(t);
            btn.disabled = false;
            if (got) { render(st); say('采集完成'); }
            else say('已触发重采，但还没读到数据；若页面弹出网站验证，请先完成验证再刷新页面');
            load();
          }
        });
      }, 700);
    }
  });

  $('saveCfg').addEventListener('click', function () {
    const base = String($('base').value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) return say('请填完整地址，如 http://your-host:8787');
    // L-9 补充：非本机/内网地址要显式二次确认，避免被社工诱导把 Bearer 令牌交给攻击者主机。
    let host = '';
    try { host = new URL(base).hostname.toLowerCase(); } catch (_) {}
    const localLike = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])$/i.test(host);
    if (!localLike && !window.confirm('你填的是外部地址：' + host + '\n插件会把登录令牌发往该地址。确认这是你自己的择隅服务器吗？')) return;
    const origin = base + '/*';
    // 自定义域名需要先申请该 origin 的访问权限（MV3 动态权限）
    chrome.permissions.contains({ origins: [origin] }, function (has) {
      // F154：回调里必须检查 lastError，否则失败会静默 no-op
      if (chrome.runtime.lastError) return say('检查权限失败：' + chrome.runtime.lastError.message);
      if (has) return saveBase(base);
      chrome.permissions.request({ origins: [origin] }, function (ok) {
        if (chrome.runtime.lastError) return say('授权失败：' + chrome.runtime.lastError.message);
        if (!ok) return say('未授权该地址，一键导入可能连不上系统');
        saveBase(base);
      });
    });
    function saveBase(b) {
      send({ type: 'HVT_CONFIG', base: b }, function (r) { say(r.ok ? '地址已保存' : ('保存失败：' + (r.error || ''))); load(); });
    }
  });

  // 测试连接：用当前输入框里的地址（不必先保存），直接探后端接口是否可达
  $('testConn').addEventListener('click', function () {
    const base = String($('base').value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) return say('请填完整地址，如 http://your-host:8787');
    const btn = $('testConn');
    btn.disabled = true; say('正在测试连接…');
    send({ type: 'HVT_TEST', base: base }, function (r) {
      btn.disabled = false;
      say(r && r.ok ? ('✓ ' + (r.msg || '连接成功')) : ('✗ ' + ((r && r.error) || '测试失败')));
    });
  });

  $('openSys').addEventListener('click', function () {
    const base = String($('base').value || '').trim().replace(/\/+$/, '');
    send({ type: 'HVT_OPEN_SYSTEM', base: base || undefined }, function () { say('已打开系统页，登录后插件会自动取得登录态'); });
  });

  load();
})();

/* content.js —— 通用采集浮层：按当前网址识别站点，读回主世界数据并显示同一套操作面板。
 * 站点专属逻辑只有这张识别表 + 提示文案；数据采集在 sites/*.js，字段组装在 core.js。
 *
 * 可靠性约定（扩展「重新加载」后已打开的标签页不会自动重新注入 content script）：
 *   · 用 window.__HVT_BOOT_TOKEN__ 做实例令牌，重复注入时只保留最后一个实例，
 *     旧实例的定时器 / 消息监听自动退出，避免重复采集与重复写入。
 *   · 后台/弹窗可发 HVT_PING（诊断）与 HVT_RECOLLECT（重新采集），
 *     即使浮层被用户关掉也能补加载、重新采。
 */
(function () {
  'use strict';

  // 站点识别表（新增平台时在这里加一条，并在 sites/ 下加一个适配器）
  var RULES = [
    {
      id: 'anjuke', name: '安居客', twoPages: true,
      re: /^https:\/\/m\.anjuke\.com\/[^/]+\/loupan\/(\d+)/,
      pageType: function (path) {
        var rest = path.replace(/^\/[^/]+\/loupan\/\d+\/?/, '').replace(/\/$/, '');
        return rest === 'params' ? 'params' : (rest === '' ? 'main' : '');
      },
      emptyTip: '未读到楼盘数据，可能触发了安居客访问验证；验证后刷新页面即可。'
    },
    {
      id: 'beike', name: '贝壳', twoPages: false,
      re: /^https:\/\/[a-z0-9-]+\.ke\.com\/ershoufang\/(\d+)\.html/,
      pageType: function () { return 'page'; },
      emptyTip: '未读到房源数据，可能触发了贝壳人机验证；验证后刷新页面即可。'
    }
  ];

  var rule = null, houseId = '', pageType = '';
  for (var i = 0; i < RULES.length; i++) {
    var m = location.href.match(RULES[i].re);
    if (!m) continue;
    var pt = RULES[i].pageType(location.pathname);
    if (!pt) return; // 相册、房源库等非采集子页
    rule = RULES[i]; houseId = m[1]; pageType = pt;
    break;
  }
  if (!rule) return;

  // 后注入的实例顶掉旧实例（旧实例的异步回调会在下一次 tick 自行停止）
  var token = 'hvt-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  window.__HVT_BOOT_TOKEN__ = token;
  function alive() { return window.__HVT_BOOT_TOKEN__ === token; }

  var stale = document.getElementById('hvt-ajk-panel');
  if (stale) stale.remove();

  var tries = 0, done = false, timer = null, panel = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(label, cls, fn) {
    var b = el('button', 'hvt-btn' + (cls ? ' ' + cls : ''));
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function buildPanel() {
    var p = el('div');
    p.id = 'hvt-ajk-panel';
    var closeBtn = btn('×', '', function () { p.remove(); });
    closeBtn.classList.add('hvt-close');
    p.appendChild(closeBtn);
    p.appendChild(el('div', 'hvt-title', '看房记录 · 房源采集'));
    var sub = el('div', 'hvt-sub', rule.name + ' · ' + (rule.twoPages && pageType === 'params' ? '详细信息页' : '房源详情页') + ' · 正在读取…');
    var stat = el('div', 'hvt-stat', '');
    var tip = el('div', 'hvt-tip', '');
    var msg = el('div', 'hvt-msg', '');
    var row1 = el('div', 'hvt-row');
    var row2 = el('div', 'hvt-row');
    p.appendChild(sub); p.appendChild(stat); p.appendChild(tip);
    p.appendChild(row1); p.appendChild(row2); p.appendChild(msg);

    row1.appendChild(btn('下载 CSV', 'primary', function () {
      chrome.runtime.sendMessage({ type: 'HVT_DATA' }, function (r) {
        if (!r || !r.ok) return say('生成失败：' + ((r && r.error) || '未知错误'));
        chrome.runtime.sendMessage({ type: 'HVT_DOWNLOAD', csv: r.data.csv, filename: fileName() },
          function (d) { say(d && d.ok ? '已下载 CSV，去系统点「导入 CSV」' : ('下载失败：' + ((d && d.error) || ''))); });
      });
    }));
    row1.appendChild(btn('一键导入', '', function () {
      chrome.runtime.sendMessage({ type: 'HVT_PUSH' }, function (r) {
        say(r && r.ok ? ('已导入系统：' + r.name) : ('导入失败：' + ((r && r.error) || '')));
      });
    }));
    row1.appendChild(btn('复制 JSON', '', function () {
      chrome.runtime.sendMessage({ type: 'HVT_DATA' }, function (r) {
        if (!r || !r.ok) return say('读取失败');
        var text = r.data.jsonText;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { say('JSON 已复制'); }, function () { say('复制失败，请从插件面板查看'); });
        } else say('当前页面不支持复制，请点浏览器工具栏图标打开面板');
      });
    }));

    var goMore = btn('前往更多信息', '', function () {
      var more = document.querySelector('.loupan-more');
      if (more) more.click();
      else say('没找到「更多信息」入口，请手动点页面右侧的「更多信息 >」');
    });
    if (!rule.twoPages || pageType === 'params') goMore.style.display = 'none';
    row2.appendChild(goMore);
    row2.appendChild(btn('清空重采', '', function () {
      chrome.runtime.sendMessage({ type: 'HVT_CLEAR' }, function () {
        resetAndProbe(); say('已清空，重新采集中…');
      });
    }));
    (document.body || document.documentElement).appendChild(p);
    return p;
  }
  panel = buildPanel();

  function setMsg(s) { var n = panel && panel.querySelector('.hvt-msg'); if (n) n.textContent = s || ''; }
  function say(s) { setMsg(s); setTimeout(function () { var n = panel && panel.querySelector('.hvt-msg'); if (n && n.textContent === s) setMsg(''); }, 5000); }
  function fileName() { return rule.id + '-' + houseId + '-import.csv'; }

  function updatePanel(r) {
    if (!alive()) return;
    var sub = panel && panel.querySelector('.hvt-sub');
    var stat = panel && panel.querySelector('.hvt-stat');
    var tip = panel && panel.querySelector('.hvt-tip');
    if (!sub || !stat || !tip) return;
    if (!r || !r.ok) { sub.textContent = '读取失败：' + ((r && r.error) || '未知错误'); return; }
    var s = r.stats || {};
    var single = s.singlePage;
    sub.textContent = (r.name || (rule.name + ' ' + houseId)) +
      (single ? ' · 单页采集完成' : (pageType === 'params' ? ' · 详细信息已补全' : ' · 基础信息已采集'));
    stat.textContent = 'CSV ' + (s.csvTotal || 0) + ' 列已填 ' + (s.csvFilled || 0) + ' 列 · 房源图 ' +
      ((s.media || {}).images || 0) + ' / 户型图 ' + ((s.media || {}).floorPlans || 0) +
      ' / 区位沙盘 ' + ((s.media || {}).environment || 0) + ' / VR ' + ((s.media || {}).vr || 0) +
      (s.detailGroups ? ' · 详情 ' + s.detailGroups + ' 组 / 预售证 ' + (s.permits || 0) + ' 条' : '') +
      (s.coordSource ? ' · 坐标 ' + s.coordSource : '');
    if (!single && pageType !== 'params' && !r.hasParams) {
      tip.style.display = '';
      tip.textContent = '下一步：点页面里的「更多信息 >」，插件会自动补全开发商、容积率、物业费、预售证等。';
    } else {
      tip.style.display = 'none';
    }
  }

  function resetAndProbe() {
    if (!alive()) return;
    done = false; tries = 0;
    if (!document.getElementById('hvt-ajk-panel')) {
      if (panel && panel.isConnected) panel.remove();
      panel = buildPanel();
    }
    startProbe();
  }

  function startProbe() {
    if (!alive()) return;
    if (timer) clearInterval(timer);
    function ask() {
      if (!alive()) return;
      chrome.runtime.sendMessage({ type: 'HVT_PROBE', site: rule.id }, function (r) {
        if (!alive()) return;
        if (!r || !r.ok) setMsg('读取页面数据失败：' + ((r && r.error) || '请刷新页面重试'));
      });
    }
    ask();
    timer = setInterval(function () {
      if (!alive()) { clearInterval(timer); timer = null; return; }
      tries++;
      if (done || tries > 12) {
        clearInterval(timer); timer = null;
        if (!done) setMsg(rule.emptyTip);
        return;
      }
      ask();
    }, 800);
  }

  window.addEventListener('message', function (e) {
    if (!alive() || e.source !== window) return;
    var d = e.data;
    if (!d || !d.__HVT__ || done) return;
    if (d.site !== rule.id) return;
    if (!d.ok || !d.data) return; // 数据还没就绪，等下一次重试
    done = true;
    if (timer) { clearInterval(timer); timer = null; }
    var data;
    try { data = JSON.parse(d.data); } catch (err) { say('页面数据解析失败'); return; }
    chrome.runtime.sendMessage({
      type: 'HVT_SAVE', site: rule.id, id: d.id || houseId,
      pageType: pageType, data: data, sourceUrl: location.href
    }, updatePanel);
  }, false);

  // 后台/弹窗的诊断与重采指令；不依赖浮层是否还在 DOM 中
  chrome.runtime.onMessage.addListener(function (m, sender, reply) {
    if (!alive() || !m) return;
    if (m.type === 'HVT_PING') {
      reply({ ok: true, site: rule.id, siteName: rule.name, id: houseId, pageType: pageType,
              url: location.href, panel: !!document.getElementById('hvt-ajk-panel') });
      return;
    }
    if (m.type === 'HVT_RECOLLECT') {
      resetAndProbe();
      reply({ ok: true, site: rule.id, url: location.href });
    }
  });

  startProbe();
})();

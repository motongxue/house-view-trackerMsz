/* ============================================================
 * 运行监控（设置 → 运行监控）：登录日志 + 模型流量
 * 纯前端、只读；数据来自 /api/monitor/*，普通用户强制只看自己，
 * 管理员（.env 的 ADMIN_EMAILS）可切「我的 / 全部」。
 * 不引第三方库、不写 localStorage、不改任何业务数据。
 * ============================================================ */
(function () {
  'use strict';

  var VER = 'v1.8.1';
  var LIMIT = 20;
  var ACTION = {
    register: '注册', login_pwd: '密码登录', login_code: '验证码登录',
    reset_password: '找回密码', logout: '退出登录', change_password: '修改密码'
  };
  var REASON = {
    captcha_invalid: '图形验证未通过', bad_credentials: '邮箱或密码错误',
    email_code_invalid: '邮箱验证码错误', account_not_found: '账号不存在',
    bad_old_password: '原密码错误', register_failed: '注册失败'
  };
  var ENTRY = {
    chat: 'AI 对话', extract: 'AI 录入',
    'test-text': '模型检测·文本', 'test-vision': '模型检测·看图'
  };
  var st = { scope: 'self', tab: 'login', range: '30d', ok: '', q: '', page: 0, admin: false, busy: false };
  var root = null;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) {
    var n = Number(v || 0);
    return isFinite(n) ? n.toLocaleString('zh-CN') : '0';
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function time(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '-';
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function $(id) { return root ? root.querySelector('#' + id) : null; }
  function api(path) {
    if (typeof window.Api === 'undefined' || !window.Api.get) return Promise.reject(new Error('Api 未加载'));
    return window.Api.get(path).then(function (r) { return r && r.data; });
  }
  function qs(extra) {
    var p = new URLSearchParams();
    p.set('scope', st.scope); p.set('range', st.range);
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k] !== '' && extra[k] != null) p.set(k, extra[k]);
    });
    return p.toString();
  }

  function shell() {
    return '' +
      '<div class="mon-wrap">' +
        '<div class="mon-toolbar">' +
          '<div class="mon-toolbar-row">' +
            '<div class="mon-seg" data-role="tabs">' +
              '<button type="button" data-tab="login" class="active">登录日志</button>' +
              '<button type="button" data-tab="ai">模型流量</button>' +
            '</div>' +
            '<span class="mon-spacer"></span>' +
            '<div class="mon-seg mon-scope" id="mon-scope" data-role="scope" hidden>' +
              '<button type="button" data-scope="self" class="active">我的</button>' +
              '<button type="button" data-scope="all">全部</button>' +
            '</div>' +
          '</div>' +
          '<div class="mon-toolbar-row">' +
            '<select id="mon-range" class="mon-sel" title="时间范围">' +
              '<option value="7d">近 7 天</option><option value="30d">近 30 天</option><option value="90d">近 90 天</option>' +
            '</select>' +
            '<select id="mon-ok" class="mon-sel" title="结果">' +
              '<option value="">全部结果</option><option value="1">仅成功</option><option value="0">仅失败</option>' +
            '</select>' +
            '<input id="mon-q" class="mon-input" type="search" placeholder="搜索邮箱 / IP / 模型" />' +
            '<span class="mon-spacer"></span>' +
            '<button type="button" class="btn" id="mon-refresh" title="刷新">↻ 刷新</button>' +
          '</div>' +
        '</div>' +
        '<div class="mon-cards" id="mon-cards"></div>' +
        '<div class="mon-extra" id="mon-extra"></div>' +
        '<div class="mon-table" id="mon-table"><div class="mon-empty">加载中…</div></div>' +
        '<div class="mon-pager" id="mon-pager"></div>' +
        '<div class="mon-note" id="mon-note"></div>' +
      '</div>';
  }

  function card(label, value, sub, tone) {
    return '<div class="mon-card' + (tone ? ' ' + tone : '') + '">' +
      '<div class="mon-card-label">' + esc(label) + '</div>' +
      '<div class="mon-card-value">' + esc(value) + '</div>' +
      '<div class="mon-card-sub">' + esc(sub || '') + '</div>' +
    '</div>';
  }
  function renderCards(ov) {
    var l = ov.login || {}, a = ov.ai || {};
    var failed = (l.failed_today || 0) + (a.failed_today || 0);
    $('mon-cards').innerHTML =
      card('今日登录', num(l.today), '本月 ' + num(l.month) + ' 次') +
      card('今日模型调用', num(a.today), '本月 ' + num(a.month) + ' 次') +
      card('本月 token', num(a.tokens_month), '今日 ' + num(a.tokens_today)) +
      card('平均耗时', num(a.avg_ms) + ' ms', '今日模型请求') +
      card('今日失败', num(failed), '登录 + 模型请求', failed ? 'is-warn' : '') +
      card('估算用量', num(a.estimated), '上游未回 token 数', 'is-sub');
  }
  function renderExtra(ov) {
    var byModel = ov.byModel || [], byUser = ov.byUser || [];
    var h = '<div class="mon-sum"><h4>本月按模型</h4>';
    if (!byModel.length) h += '<div class="mon-muted">本月还没有模型调用</div>';
    else {
      h += '<div class="mon-sum-rows">' + byModel.map(function (m) {
        return '<div class="mon-sum-row"><span>' + esc(m.model) + '</span>' +
          '<b>' + num(m.calls) + ' 次</b><span>' + num(m.tokens) + ' token</span>' +
          (m.failed ? '<em>' + num(m.failed) + ' 失败</em>' : '') + '</div>';
      }).join('') + '</div>';
    }
    h += '</div>';
    if (st.scope === 'all' && ov.admin) {
      h += '<div class="mon-sum"><h4>本月按用户</h4>';
      if (!byUser.length) h += '<div class="mon-muted">暂无数据</div>';
      else h += '<div class="mon-sum-rows">' + byUser.map(function (u) {
        return '<div class="mon-sum-row"><span>' + esc(u.email) + '</span>' +
          '<b>' + num(u.calls) + ' 次</b><span>' + num(u.tokens) + ' token</span></div>';
      }).join('') + '</div>';
      h += '</div>';
    }
    $('mon-extra').innerHTML = h;
  }
  function badge(ok) {
    return ok ? '<span class="mon-tag ok">成功</span>' : '<span class="mon-tag bad">失败</span>';
  }
  function tableLogin(rows, all) {
    var h = '<table><thead><tr><th>时间</th><th>方式</th><th>结果</th>' +
      (all ? '<th>邮箱</th>' : '') + '<th>IP</th><th>说明</th><th>浏览器</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var detail = r.reason ? (REASON[r.reason] || r.reason) : '—';
      h += '<tr><td class="mon-nowrap">' + esc(time(r.created_at)) + '</td>' +
        '<td>' + esc(ACTION[r.action] || r.action) + '</td>' +
        '<td>' + badge(r.ok) + '</td>' +
        (all ? '<td class="mon-ellip" title="' + esc(r.email) + '">' + esc(r.email || '—') + '</td>' : '') +
        '<td class="mon-nowrap">' + esc(r.ip || '—') + '</td>' +
        '<td>' + esc(detail) + '</td>' +
        '<td class="mon-ellip" title="' + esc(r.ua) + '">' + esc(r.ua || '—') + '</td></tr>';
    });
    return h + '</tbody></table>';
  }
  function tableAi(rows) {
    var h = '<table><thead><tr><th>时间</th><th>入口</th><th>模型</th><th>通道</th>' +
      '<th>输入</th><th>输出</th><th>合计</th><th>耗时</th><th>结果</th><th>错误</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td class="mon-nowrap">' + esc(time(r.created_at)) + '</td>' +
        '<td>' + esc(ENTRY[r.entry] || r.entry) + '</td>' +
        '<td class="mon-ellip" title="' + esc(r.model) + '">' + esc(r.model || '—') + '</td>' +
        '<td>' + (r.channel === 'direct' ? '直连' : '网关') + '</td>' +
        '<td>' + num(r.prompt_tokens) + '</td><td>' + num(r.completion_tokens) + '</td>' +
        '<td><b>' + num(r.total_tokens) + (r.estimated ? '<sup title="上游未返回用量，按字符估算">≈</sup>' : '') + '</b></td>' +
        '<td>' + (r.latency_ms == null ? '—' : num(r.latency_ms) + ' ms') + '</td>' +
        '<td>' + badge(r.ok) + '</td>' +
        '<td class="mon-ellip" title="' + esc(r.error) + '">' + esc(r.error || '—') + '</td></tr>';
    });
    return h + '</tbody></table>';
  }
  function renderPager(total) {
    var pages = Math.max(1, Math.ceil(total / LIMIT));
    var cur = Math.min(st.page + 1, pages);
    $('mon-pager').innerHTML =
      '<span>共 ' + num(total) + ' 条 · 第 ' + cur + '/' + pages + ' 页</span>' +
      '<span class="mon-spacer"></span>' +
      '<button type="button" class="btn" data-page="prev"' + (st.page <= 0 ? ' disabled' : '') + '>上一页</button>' +
      '<button type="button" class="btn" data-page="next"' + (cur >= pages ? ' disabled' : '') + '>下一页</button>';
  }

  function loadTable() {
    var isLogin = st.tab === 'login';
    var extra = { ok: st.ok, q: st.q, limit: LIMIT, offset: st.page * LIMIT };
    var path = '/api/monitor/' + (isLogin ? 'auth-logs' : 'ai-logs') + '?' + qs(extra);
    return api(path).then(function (d) {
      var rows = (d && d.rows) || [], total = (d && d.total) || 0;
      $('mon-table').innerHTML = rows.length
        ? (isLogin ? tableLogin(rows, st.scope === 'all' && st.admin) : tableAi(rows))
        : '<div class="mon-empty">这个条件下还没有记录</div>';
      renderPager(total);
    });
  }

  function refresh() {
    if (!root || st.busy) return Promise.resolve();
    st.busy = true;
    var note = $('mon-note');
    if (note) note.textContent = '';
    return api('/api/monitor/overview?' + qs())
      .then(function (ov) {
        st.admin = !!ov.admin;
        if (!st.admin && st.scope !== 'self') st.scope = 'self';
        var scopeEl = $('mon-scope');
        if (scopeEl) {
          scopeEl.hidden = !st.admin;
          Array.prototype.forEach.call(scopeEl.querySelectorAll('button'), function (b) {
            b.classList.toggle('active', b.dataset.scope === st.scope);
          });
        }
        Array.prototype.forEach.call(root.querySelectorAll('[data-tab]'), function (b) {
          b.classList.toggle('active', b.dataset.tab === st.tab);
        });
        renderCards(ov);
        renderExtra(ov);
        var n = $('mon-note');
        if (n) {
          n.textContent = '日志保留 ' + num(ov.retentionDays) + ' 天，只记元数据（不记密码、验证码、令牌、提问内容与图片）。' +
            (st.admin ? '' : (ov.adminConfigured ? ' 当前为个人视图。' : ' 尚未配置管理员（.env 的 ADMIN_EMAILS）。'));
        }
        return loadTable();
      })
      .catch(function (e) {
        var msg = String(e && e.message || e);
        $('mon-table').innerHTML = '<div class="mon-empty err">读取监控数据失败：' + esc(msg) +
          '<br/>若接口返回 404，请先重启后端（node server.js）再刷新页面。</div>';
        $('mon-cards').innerHTML = '';
        $('mon-extra').innerHTML = '';
        $('mon-pager').innerHTML = '';
      })
      .then(function () { st.busy = false; });
  }

  function bind(el) {
    el.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.id === 'mon-refresh') { st.page = 0; refresh(); return; }
      if (t.dataset.tab) { st.tab = t.dataset.tab; st.page = 0; refresh(); return; }
      if (t.dataset.scope) {
        st.scope = t.dataset.scope; st.page = 0; refresh(); return;
      }
      if (t.dataset.page) {
        st.page += (t.dataset.page === 'next' ? 1 : -1);
        if (st.page < 0) st.page = 0;
        loadTable(); return;
      }
    });
    el.addEventListener('change', function (e) {
      if (e.target.id === 'mon-range') { st.range = e.target.value; st.page = 0; refresh(); }
      if (e.target.id === 'mon-ok') { st.ok = e.target.value; st.page = 0; refresh(); }
    });
    var timer = null;
    el.addEventListener('input', function (e) {
      if (e.target.id !== 'mon-q') return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        st.q = e.target.value.trim(); st.page = 0; refresh();
      }, 350);
    });
  }

  function mount(el) {
    if (!el) return;
    var changed = root !== el || !el.getAttribute('data-mon-ready');
    root = el;
    if (changed) {
      el.innerHTML = shell();
      el.setAttribute('data-mon-ready', VER);
      bind(el);
      var r = $('mon-range'), o = $('mon-ok'), q = $('mon-q');
      if (r) r.value = st.range;
      if (o) o.value = st.ok;
      if (q) q.value = st.q;
    }
    refresh();
  }

  window.HvtMonitor = { mount: mount, refresh: refresh, version: VER };
})();

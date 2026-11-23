/* ============================================================
 * 运行监控（设置 → 运行监控）：登录日志 + 模型流量
 * 纯前端、只读；数据来自 /api/monitor/*，普通用户强制只看自己，
 * 管理员（.env 的 ADMIN_EMAILS）可切「我的 / 全部」。
 * 不引第三方库、不写 localStorage、不改任何业务数据。
 * ============================================================ */
(function () {
  'use strict';

  const VER = 'v1.8.6';
  const LIMIT = 20;
  const ACTION = {
    register: '注册', login_pwd: '密码登录', login_code: '验证码登录',
    reset_password: '找回密码', logout: '退出登录', change_password: '修改密码'
  };
  const REASON = {
    captcha_invalid: '图形验证未通过', bad_credentials: '邮箱或密码错误',
    email_code_invalid: '邮箱验证码错误', account_not_found: '账号不存在',
    bad_old_password: '原密码错误', register_failed: '注册失败'
  };
  const ENTRY = {
    chat: 'AI 对话', extract: 'AI 录入',
    'test-text': '模型检测·文本', 'test-vision': '模型检测·看图'
  };
  const st = { scope: 'self', tab: 'login', range: '30d', ok: '', q: '', page: 0, admin: false, busy: false };
  let root = null;
  let debounceTimer = null;   // 搜索框防抖定时器：提到模块级，重渲染/卸载时可清除（F216）
  let boundEl = null;         // 当前已绑定监听器的容器（F215）
  let boundHandlers = null;   // 对应监听器引用，供 unmount 移除（F215）

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) {
    const n = Number(v || 0);
    return isFinite(n) ? n.toLocaleString('zh-CN') : '0';
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function time(v) {
    const d = new Date(v);
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
    const p = new URLSearchParams();
    p.set('scope', st.scope); p.set('range', st.range);
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k] !== '' && extra[k] !== null && extra[k] !== undefined) p.set(k, extra[k]); // F080
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
    const l = ov.login || {}, a = ov.ai || {};
    const failed = (l.failed_today || 0) + (a.failed_today || 0);
    const box = $('mon-cards');
    if (!box) return;
    box.innerHTML =
      card('今日登录', num(l.today), '本月 ' + num(l.month) + ' 次') +
      card('今日模型调用', num(a.today), '本月 ' + num(a.month) + ' 次') +
      card('本月 token', num(a.tokens_month), '今日 ' + num(a.tokens_today)) +
      card('平均耗时', num(a.avg_ms) + ' ms', '今日模型请求') +
      card('今日失败', num(failed), '登录 + 模型请求', failed ? 'is-warn' : '') +
      card('估算用量', num(a.estimated), '上游未回 token 数', 'is-sub');
  }
  function renderExtra(ov) {
    const byModel = ov.byModel || [], byUser = ov.byUser || [];
    let h = '<div class="mon-sum"><h4>本月按模型</h4>';
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
    const box = $('mon-extra');
    if (box) box.innerHTML = h;
  }
  function badge(ok) {
    return ok ? '<span class="mon-tag ok">成功</span>' : '<span class="mon-tag bad">失败</span>';
  }
  function tableLogin(rows, all) {
    let h = '<table><thead><tr><th>时间</th><th>方式</th><th>结果</th>' +
      (all ? '<th>邮箱</th>' : '') + '<th>IP</th><th>说明</th><th>浏览器</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      const detail = r.reason ? (REASON[r.reason] || r.reason) : '—';
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
    let h = '<table><thead><tr><th>时间</th><th>入口</th><th>模型</th><th>通道</th>' +
      '<th>输入</th><th>输出</th><th>合计</th><th>耗时</th><th>结果</th><th>错误</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td class="mon-nowrap">' + esc(time(r.created_at)) + '</td>' +
        '<td>' + esc(ENTRY[r.entry] || r.entry) + '</td>' +
        '<td class="mon-ellip" title="' + esc(r.model) + '">' + esc(r.model || '—') + '</td>' +
        '<td>' + (r.channel === 'direct' ? '直连' : '网关') + '</td>' +
        '<td>' + num(r.prompt_tokens) + '</td><td>' + num(r.completion_tokens) + '</td>' +
        '<td><b>' + num(r.total_tokens) + (r.estimated ? '<sup title="上游未返回用量，按字符估算">≈</sup>' : '') + '</b></td>' +
        '<td>' + (r.latency_ms === null || r.latency_ms === undefined ? '—' : num(r.latency_ms) + ' ms') + '</td>' + // F080
        '<td>' + badge(r.ok) + '</td>' +
        '<td class="mon-ellip" title="' + esc(r.error) + '">' + esc(r.error || '—') + '</td></tr>';
    });
    return h + '</tbody></table>';
  }
  function renderPager(total) {
    const pages = Math.max(1, Math.ceil(total / LIMIT));
    const cur = Math.min(st.page + 1, pages);
    const box = $('mon-pager');
    if (!box) return;
    box.innerHTML =
      '<span>共 ' + num(total) + ' 条 · 第 ' + cur + '/' + pages + ' 页</span>' +
      '<span class="mon-spacer"></span>' +
      '<button type="button" class="btn" data-page="prev"' + (st.page <= 0 ? ' disabled' : '') + '>上一页</button>' +
      '<button type="button" class="btn" data-page="next"' + (cur >= pages ? ' disabled' : '') + '>下一页</button>';
  }

  function loadTable() {
    const isLogin = st.tab === 'login';
    const extra = { ok: st.ok, q: st.q, limit: LIMIT, offset: st.page * LIMIT };
    const path = '/api/monitor/' + (isLogin ? 'auth-logs' : 'ai-logs') + '?' + qs(extra);
    return api(path).then(function (d) {
      const rows = (d && d.rows) || [], total = (d && d.total) || 0;
      const pages = Math.max(1, Math.ceil(total / LIMIT));
      if (st.page > pages - 1) { // F217: 筛选后总数变小，回夹到末页并重新请求，避免越界空页
        st.page = pages - 1;
        return loadTable();
      }
      const table = $('mon-table');
      if (table) table.innerHTML = rows.length
        ? (isLogin ? tableLogin(rows, st.scope === 'all' && st.admin) : tableAi(rows))
        : '<div class="mon-empty">这个条件下还没有记录</div>';
      renderPager(total);
    });
  }

  async function refresh() {
    if (!root || st.busy) return;
    st.busy = true;
    try {
      const note = $('mon-note');
      if (note) note.textContent = '';
      const ov = await api('/api/monitor/overview?' + qs()) || {};
      if (!root) return; // 等待期间已被 unmount（F215）
      st.admin = !!ov.admin;
      if (!st.admin && st.scope !== 'self') st.scope = 'self';
      const scopeEl = $('mon-scope');
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
      const n = $('mon-note');
      if (n) {
        n.textContent = '日志保留 ' + num(ov.retentionDays) + ' 天，只记元数据（不记密码、验证码、令牌、提问内容与图片）。' +
          (st.admin ? '' : (ov.adminConfigured ? ' 当前为个人视图。' : ' 尚未配置管理员（.env 的 ADMIN_EMAILS）。'));
      }
      await loadTable();
    } catch (e) {
      // F081: 原始 e.message 可能含请求 URL / 响应体等内部细节，只写控制台，界面显示通用文案 + 状态码。
      console.error('[monitor] 读取监控数据失败：', e);
      const status = e && e.status;
      const title = '读取监控数据失败' + (status ? '（HTTP ' + status + '）' : '');
      const hint = status === 404
        ? '若接口返回 404，请先重启后端（node server.js）再刷新页面。'
        : '请稍后重试，详情见浏览器控制台。';
      const table = $('mon-table'); // F272: catch 内 DOM 写入加 null guard
      if (table) table.innerHTML = '<div class="mon-empty err">' + esc(title) +
        '<br/>' + esc(hint) + '</div>';
      ['mon-cards', 'mon-extra', 'mon-pager'].forEach(function (id) {
        const node = $(id);
        if (node) node.innerHTML = '';
      });
    } finally {
      st.busy = false; // F272: 同步抛错或 catch 内再抛错也保证复位，refresh 不会永久失效
    }
  }

  function bind(el) {
    const onClick = function (e) {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.id === 'mon-refresh') { st.page = 0; refresh(); return; }
      if (t.dataset.tab) { st.tab = t.dataset.tab; st.page = 0; refresh(); return; }
      if (t.dataset.scope) {
        st.scope = t.dataset.scope; st.page = 0;
        // F218: 切 scope 后先清掉旧数据，避免 refresh 完成前闪现另一视角的内容。
        const table = $('mon-table');
        if (table) table.innerHTML = '<div class="mon-empty">加载中…</div>';
        refresh(); return;
      }
      if (t.dataset.page) {
        st.page += (t.dataset.page === 'next' ? 1 : -1);
        if (st.page < 0) st.page = 0;
        loadTable(); return;
      }
    };
    const onChange = function (e) {
      if (e.target.id === 'mon-range') { st.range = e.target.value; st.page = 0; refresh(); }
      if (e.target.id === 'mon-ok') { st.ok = e.target.value; st.page = 0; refresh(); }
    };
    const onInput = function (e) {
      if (e.target.id !== 'mon-q') return;
      clearTimeout(debounceTimer); // F216: 使用模块级定时器，重渲染/卸载可清除
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        st.q = e.target.value.trim(); st.page = 0; refresh();
      }, 350);
    };
    // 同一容器重复绑定（如 VER 升级重建）前先移除旧监听器，避免叠加触发（F215）
    if (boundEl && boundHandlers) {
      boundEl.removeEventListener('click', boundHandlers.click);
      boundEl.removeEventListener('change', boundHandlers.change);
      boundEl.removeEventListener('input', boundHandlers.input);
    }
    clearTimeout(debounceTimer); debounceTimer = null;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    boundEl = el;
    boundHandlers = { click: onClick, change: onChange, input: onInput };
  }

  function mount(el) {
    if (!el) return;
    const changed = root !== el || el.getAttribute('data-mon-ready') !== VER; // F214
    root = el;
    if (changed) {
      clearTimeout(debounceTimer); debounceTimer = null; // F216
      el.innerHTML = shell();
      el.setAttribute('data-mon-ready', VER);
      bind(el);
      const r = $('mon-range'), o = $('mon-ok'), q = $('mon-q');
      if (r) r.value = st.range;
      if (o) o.value = st.ok;
      if (q) q.value = st.q;
    }
    refresh();
  }

  function unmount(el) { // F215
    if (el && root && el !== root) return;
    if (boundEl && boundHandlers) {
      boundEl.removeEventListener('click', boundHandlers.click);
      boundEl.removeEventListener('change', boundHandlers.change);
      boundEl.removeEventListener('input', boundHandlers.input);
    }
    boundEl = null;
    boundHandlers = null;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    st.busy = false;
    root = null;
  }

  window.HvtMonitor = { mount: mount, unmount: unmount, refresh: refresh, version: VER };
})();

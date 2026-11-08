// app.js —— 主应用：登录路由 + 列表 / 地图 / 对比 / 录入 / 详情
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // 面包屑已按需求整体移除（页面标题与返回按钮不受影响），保留空函数兼容旧调用点
  function crumb() { return ''; }
  // 预制封面：未上传图片时使用的建筑剪影占位图（8 种配色轮换）
  function presetCover(seed) {
    const PALS = [
      ['#dcefdc', '#bfe0c6', '#9bc0a4', '#86ad92'], // 浅绿
      ['#dbe7f2', '#c3d6ea', '#9bb4cf', '#87a2bf'], // 灰蓝
      ['#f3ecd9', '#ece0c0', '#d8c79a', '#c6b07c'], // 米黄
      ['#f7e3e8', '#efcfd9', '#e0aab8', '#d291a1'], // 淡粉
      ['#eae2f4', '#d8caec', '#bca7dd', '#a892cb'], // 淡紫
      ['#f9e6d3', '#f2d3b8', '#e3b48e', '#d39d75'], // 淡橙
      ['#d8eeed', '#bfe4e2', '#8fcac7', '#79b6b1'], // 淡青
      ['#d7e3da', '#bbd2c3', '#95b4a2', '#81a48d']  // 灰绿
    ];
    let h = 0; const s = String(seed == null ? '' : seed);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const [bg1, bg2, bldg, ground] = PALS[h % PALS.length];
    let win = '';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
      win += '<rect x="' + (124 + c * 16) + '" y="' + (98 + r * 20) + '" width="9" height="11" rx="2" fill="#ffffff" opacity="0.82"/>';
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice">'
      + '<defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + bg1 + '"/><stop offset="1" stop-color="' + bg2 + '"/></linearGradient></defs>'
      + '<rect width="400" height="250" fill="url(#pg)"/>'
      + '<circle cx="332" cy="50" r="25" fill="#ffffff" opacity="0.85"/>'
      + '<rect x="46" y="122" width="54" height="108" fill="' + bldg + '" opacity="0.92"/>'
      + '<rect x="116" y="86" width="58" height="144" fill="' + bldg + '"/>'
      + win
      + '<rect x="190" y="104" width="48" height="126" fill="' + bldg + '" opacity="0.92"/>'
      + '<rect x="254" y="132" width="60" height="98" fill="' + bldg + '" opacity="0.85"/>'
      + '<rect x="0" y="226" width="400" height="24" fill="' + ground + '"/>'
      + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const lines = (v) => (v || '').split('\n').map((s) => s.trim()).filter(Boolean);

  // ---------- 字段路径读写（CSV 导入导出用）----------
  const CSV_COLS = [
    ['title', '标题'], ['location.city', '城市'], ['location.district', '区域'], ['location.community', '小区'],
    ['location.address', '地址'], ['location.subwayStation', '最近地铁站'], ['location.subwayDistance', '地铁距离(米)'],
    ['attributes.layout', '户型'], ['attributes.area', '面积'], ['attributes.orientation', '朝向'], ['attributes.floor', '楼层'],
    ['attributes.builtYear', '建成年代'], ['attributes.decoration', '装修'], ['attributes.elevator', '电梯'], ['attributes.parking', '车位'],
    ['attributes.propertyType', '房屋性质'], ['attributes.communityAge', '小区新旧'], ['attributes.propertyFee', '物业费(元/㎡·月)'],
    ['transaction.totalPrice', '总价(万)'], ['transaction.unitPrice', '单价(元/㎡)'], ['transaction.status', '状态'],
    ['transaction.sourcePlatform', '来源平台'], ['transaction.houseNumber', '房源编号'], ['transaction.viewingDate', '看房日期'],
    ['transaction.tax', '税费(万)'], ['transaction.downPayment', '首付(万)'], ['transaction.monthlyPayment', '月供(元)'],
    ['transaction.ownership', '产权状态'], ['transaction.loanable', '是否可贷款'], ['transaction.loanType', '贷款方式'],
    ['transaction.gfundRatio', '组合贷公积金占比(%)'], ['transaction.loanYears', '贷款年限(年)'], ['transaction.repayment', '还款方式'],
    ['transaction.agentName', '中介'], ['transaction.agentPhone', '电话'], ['transaction.wechat', '微信'],
    ['facilities.schoolInfo', '学区/对口学校'], ['notes', '备注'], ['geo.lng', '经度'], ['geo.lat', '纬度']
  ];
  function getPath(o, path) { let v = o; for (const k of path.split('.')) { if (v == null) return ''; v = v[k]; } return v == null ? '' : v; }
  function setPath(o, path, val) {
    const ks = path.split('.'); let v = o;
    for (let i = 0; i < ks.length - 1; i++) { if (v[ks[i]] == null || typeof v[ks[i]] !== 'object') v[ks[i]] = {}; v = v[ks[i]]; }
    v[ks[ks.length - 1]] = val;
  }
  function toCsv(list) {
    const escCsv = (s) => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = CSV_COLS.map((c) => c[1]).join(',');
    const body = list.map((p) => CSV_COLS.map((c) => escCsv(getPath(p, c[0]))).join(',')).join('\r\n');
    return '﻿' + head + '\r\n' + body;
  }
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const arr = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (arr.length < 2) return [];
    const header = arr[0].split(',').map((s) => s.trim());
    const rows = [];
    for (let r = 1; r < arr.length; r++) {
      const cells = arr[r].split(',');
      const o = { location: {}, attributes: {}, transaction: {}, facilities: {}, media: { images: [], videos: [] } };
      header.forEach((h, i) => {
        const col = CSV_COLS.find((c) => c[1] === h);
        if (col) { const raw = (cells[i] || '').trim(); if (raw !== '') setPath(o, col[0], raw); }
      });
      o.title = o.title || o.location.community || '导入房源';
      rows.push(o);
    }
    return rows;
  }
  function downloadCsv(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- 综合评分（启发式 0-100）----------
  function computeScore(p) {
    const w = state.weights;
    const loc = p.location || {}, attr = p.attributes || {}, tran = p.transaction || {}, fac = p.facilities || {};
    const cur = new Date().getFullYear();
    let sSub = 0; const d = parseFloat(loc.subwayDistance);
    if (!isNaN(d)) sSub = Math.max(0, Math.min(1, (3000 - d) / 3000));
    let sSch = (fac.school || (fac.schoolInfo && String(fac.schoolInfo).trim())) ? 1 : 0;
    let sAge = 0; const y = parseInt(attr.builtYear);
    if (!isNaN(y)) { const age = cur - y; sAge = Math.max(0, Math.min(1, (25 - age) / 25)); }
    let sLay = 0; const o = String(attr.orientation || '');
    if (o.indexOf('南北') >= 0) sLay = 1; else if (o.indexOf('南') >= 0) sLay = 0.7; else if (o) sLay = 0.4;
    let sPrice = 0.5;
    const wsum = (w.subway + w.school + w.age + w.layout + w.price) || 1;
    return Math.round(((sSub * w.subway + sSch * w.school + sAge * w.age + sLay * w.layout + sPrice * w.price) / wsum) * 100);
  }

  // ---------- 离线规则解析：粘贴文字自动提取字段（不依赖大模型）----------
  function parseAiText(text) {
    const out = { location: {}, attributes: {}, transaction: {}, facilities: {}, media: { images: [], videos: [] } };
    const t = text || '';
    const pick = (re) => { const m = t.match(re); return m ? (m[1] || m[2] || '').trim() : ''; };
    out.location.community = pick(/(?:小区|楼盘|小区名|社区)[：: ]*([^\n，。,]+)/) || pick(/([一-龥]{2,10}(?:小区|花园|雅居|公馆|城|苑|府|邸|广场|家园|新村|国际))/);
    out.location.district = pick(/(?:区域|区县|地段)[：: ]*([^\n，。,]+)/) || pick(/(天府新区|高新区|武侯区|锦江区|成华区|青羊区|金牛区|双流区|龙泉驿区|郫都区|温江区|新都区)/);
    out.attributes.layout = pick(/(?:户型|格局)[：: ]*([^\n，。,]+)/) || pick(/(\d+室\d+厅\d*卫*)/);
    const area = pick(/(\d+(?:\.\d+)?)\s*㎡|(\d+(?:\.\d+)?)\s*平米|面积[：: ]*(\d+(?:\.\d+)?)/);
    out.attributes.area = parseFloat(area) || null;
    out.transaction.totalPrice = parseFloat(pick(/总价[：: ]*(\d+(?:\.\d+)?)\s*万|(\d+(?:\.\d+)?)\s*万/)) || null;
    out.transaction.unitPrice = parseFloat(pick(/单价[：: ]*(\d+(?:\.\d+)?)\s*元|(\d+(?:\.\d+)?)\s*元\/㎡/)) || null;
    out.attributes.floor = pick(/(?:楼层|位于)[：: ]*([^\n，。,]+)/) || pick(/(?:低|中|高)楼层|(\d+\/\d+层)/);
    out.attributes.orientation = pick(/(?:朝向)[：: ]*([^\n，。,]+)/) || pick(/(南北|朝南|东南|西南|东北|西北|正南|东|南|西|北)/);
    out.transaction.agentName = pick(/(?:中介|经纪人|联系人|顾问|管家)[：: ]*([^\n，。,]+)/);
    out.transaction.agentPhone = pick(/(?:电话|手机|联系)[：: ]*(\d{11}|\d{3,4}-?\d{7,8})/);
    out.location.address = pick(/(?:地址|位置|坐落|详细地址)[：: ]*([^\n，。,]+)/);
    out.title = out.location.community || '解析房源';
    out.notes = t.trim();
    return out;
  }

  const state = {
    user: null, properties: [], view: 'list', listMode: 'card', selected: new Set(), editing: null, formGeo: null,
    batchSel: new Set(),                                  // 批量选择（删除 / 改状态）
    pickMode: null,                                       // 勾选框显示模式：null | 'compare' | 'batch'
    page: 1, pageSize: 10,                                // 房源列表分页
    pPage: 1, pPageSize: 10, pQ: '', pFiltered: [],       // 已购房源列表：独立分页与搜索，避免和房源列表互相干扰
    renoPropId: null,                                     // 装修信息 / 填写页当前房源（临时页，刷新不记忆）
    renoItemId: null,                                     // 填写页正在编辑的方案 id；null = 新建
    renoFrom: 'renovation',                               // 填写页保存后回到哪个页面：renovation | renoList
    renoTab: 'confirmed',                                 // 装修信息页页签：confirmed | quotes
    renoDetailId: null,                                   // 比价记录里「查看」的那条方案
    detailTab: 'basic',                                   // 已购房详情页顶部页签：basic(基本信息) | renovation(装修信息)
    compareTab: 'property',                               // 房源对比页页签：property(默认) | renovation
    compareTabFromReno: false,                            // 本次进入对比是否由装修列表「对比选中」触发
    renoCompareSel: new Set(),                            // 装修列表勾选去对比的方案 key
    renoListQ: '', renoListPage: 1, renoListPageSize: 10,  // 装修列表：搜索与独立分页
    renoNewName: '',                                      // 新增方案弹窗带过来的初始名称
    lastMenuView: 'list',                                 // 最后一次菜单视图：详情 / 装修页返回时用
    filtered: [],                                         // 当前筛选结果（供“全选”使用）
    headerTheme: 'hd-1',                                  // 顶部栏配色主题
    filters: { q: '', district: '', platform: '', status: '', sort: 'time',
      layout: '', orientation: '', floor: '',
      totalMin: '', totalMax: '', areaMin: '', areaMax: '',
      decoration: '', subwayMax: '', viewingFrom: '', viewingTo: '',
      withTransport: false, withSchool: false, scoreMin: '', favOnly: false },
    advOpen: false,
    demandMatch: false,                                    // 需求匹配模式（按购房需求排序筛选）
    weights: { subway: 30, school: 20, age: 15, layout: 20, price: 15 }, // 评分权重（可调）
    commuteDest: null,                                     // 通勤终点 { lng, lat, name }
    commuteResult: {}                                      // id -> { distance, duration }
  };

  // ---------- 列表展示方式（卡片 / 表格）：列表页与回收站共用，本地记忆 ----------
  const LIST_MODE_KEY = 'hvt_list_mode';
  try { if (localStorage.getItem(LIST_MODE_KEY) === 'table') state.listMode = 'table'; } catch (e) {}
  function saveListMode() {
    try { localStorage.setItem(LIST_MODE_KEY, state.listMode); } catch (e) {}
  }

  // ---------- 对比勾选持久化（按用户存 localStorage，刷新不丢） ----------
  function compareKey() { return 'hvt_compare_' + ((state.user && (state.user.id || state.user.email)) || 'anon'); }
  function saveCompareSel() {
    try { localStorage.setItem(compareKey(), JSON.stringify(Array.from(state.selected))); } catch (e) {}
  }
  function loadCompareSel() {
    try {
      const a = JSON.parse(localStorage.getItem(compareKey()) || '[]');
      state.selected = new Set(Array.isArray(a) ? a : []);
    } catch (e) { state.selected = new Set(); }
  }

  // ---------- 重置列表筛选（点击任意菜单时调用，页面内容回到初始态） ----------
  function resetListFilters() {
    state.filters = { q: '', district: '', platform: '', status: '', sort: 'time',
      layout: '', orientation: '', floor: '',
      totalMin: '', totalMax: '', areaMin: '', areaMax: '',
      decoration: '', subwayMax: '', viewingFrom: '', viewingTo: '',
      withTransport: false, withSchool: false, scoreMin: '' };
    state.advOpen = false; state.demandMatch = false; state.page = 1;
    // 批量操作态也一并重置（批量删除/批量改状态的勾选与选择模式）；
    // 对比勾选（state.selected）按需求持久化，不在此清除
    state.batchSel.clear(); state.pickMode = null;
    const gs = document.getElementById('global-search'); if (gs) gs.value = '';
  }

  // ---------- 购房需求匹配评分（0-100，未设置的条件不扣分） ----------
  function roomCount(s) { const m = String(s || '').match(/(\d+)\s*室/); return m ? parseInt(m[1], 10) : null; }
  function hasDemandConfigured() {
    const d = state.user && state.user.demand; if (!d) return false;
    return !!(d.budgetMax || d.districts || d.layout || d.areaMin || d.areaMax || d.needSubway || d.needSchool);
  }
  function demandMatch(p) {
    const d = (state.user && state.user.demand) || {};
    const loc = p.location || {}, attr = p.attributes || {}, tran = p.transaction || {}, fac = p.facilities || {};
    let score = 0; const reasons = [];
    // 预算 30 分
    const total = parseFloat(tran.totalPrice), budget = parseFloat(d.budgetMax);
    if (isNaN(budget)) score += 30;
    else if (!isNaN(total)) {
      if (total <= budget) { score += 30; reasons.push('预算内'); }
      else if (total <= budget * 1.1) { score += 15; reasons.push('略超预算'); }
    }
    // 意向区域 20 分
    const dls = String(d.districts || '').split(/[,，、\s]+/).filter(Boolean);
    if (!dls.length) score += 20;
    else if (loc.district && dls.some((x) => (loc.district || '').indexOf(x) > -1)) { score += 20; reasons.push('区域匹配'); }
    // 意向户型 15 分
    const dr = roomCount(d.layout), pr = roomCount(attr.layout);
    if (!dr) score += 15;
    else if (pr && pr === dr) { score += 15; reasons.push('户型匹配'); }
    // 面积 15 分
    const a = parseFloat(attr.area), aMin = parseFloat(d.areaMin), aMax = parseFloat(d.areaMax);
    if (isNaN(aMin) && isNaN(aMax)) score += 15;
    else if (!isNaN(a)) {
      const inR = (!isNaN(aMin) ? a >= aMin : true) && (!isNaN(aMax) ? a <= aMax : true);
      const nearR = (!isNaN(aMin) ? a >= aMin * 0.9 : true) && (!isNaN(aMax) ? a <= aMax * 1.1 : true);
      if (inR) { score += 15; reasons.push('面积合适'); }
      else if (nearR) { score += 8; reasons.push('面积接近'); }
    }
    // 近地铁 10 分
    if (d.needSubway) {
      const sd = parseFloat(loc.subwayDistance);
      if (!isNaN(sd) && sd <= 1000) { score += 10; reasons.push('近地铁'); }
    } else score += 10;
    // 学区 10 分
    if (d.needSchool) { if (fac.school) { score += 10; reasons.push('有学区'); } }
    else score += 10;
    return { score, reasons };
  }

  // ---------- 购房最晚提醒：顶部栏正中胶囊（开启且设了日期才显示） ----------
  function deadlineChipHTML() {
    const d = state.user && state.user.demand;
    if (!d || !d.deadlineEnabled || !d.deadlineDate) return '';
    const days = Math.ceil((new Date(d.deadlineDate + 'T00:00:00') - new Date()) / 86400000);
    if (isNaN(days)) return '';
    const date = esc(d.deadlineDate);
    if (days < 0) return '<span class="hv-dl-chip is-over">⏰ <span class="dl-long">已超过最晚购房时间（' + date + '）</span> <b>' + Math.abs(days) + '</b> 天</span>';
    if (days <= 30) return '<span class="hv-dl-chip is-urgent">⏰ <span class="dl-long">距你设置的最晚购房时间（' + date + '）只剩</span> <b>' + days + '</b> 天</span>';
    return '<span class="hv-dl-chip">⏰ <span class="dl-long">距你设置的最晚购房时间（' + date + '）还有</span> <b>' + days + '</b> 天</span>';
  }
  function renderDeadlineChip() {
    const el = $('hv-deadline');
    if (el) el.innerHTML = deadlineChipHTML();
  }

  // 放大地图弹窗：实例引用 + 拖拽调整大小状态
  let bigMap = null;
  const rz = { dragging: false, x: 0, y: 0, w: 0, h: 0 };

  function toast(msg, ok) {
    const t = $('toast');
    t.textContent = msg;
    t.style.background = ok ? 'var(--ok)' : '#1f2329';
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  // ---------- 房贷计算：全应用唯一实现 ----------
  // 【单一数据源】房贷计算页面、标记已购房弹窗、以及以后任何新入口，一律调用本段的
  // loanSchedule()/computeMortgage()，禁止在别处再写一份公式。要改还款公式、利率口径、
  // 组合贷拆分或年供口径，只改这里一次即可，两处结果永远一致。
  // 金额单位统一「元」，利率为「年利率百分数」（3.0 = 3%），months = 年数 × 12。
  function loanSchedule(principal, annualRatePct, months, method) {
    const r = annualRatePct / 100 / 12;
    const n = months;
    const schedule = [];
    let totalInterest = 0;
    if (method === 'bj') {
      const base = principal / n;
      let remain = principal, monthlyFirst = 0, monthlyLast = 0;
      for (let k = 1; k <= n; k++) {
        const interest = remain * r;
        const principalPart = base;
        const monthly = base + interest;
        remain -= principalPart;
        if (k === n) remain = 0;
        totalInterest += interest;
        if (k === 1) monthlyFirst = monthly;
        if (k === n) monthlyLast = monthly;
        schedule.push({ k, monthly, principalPart, interest, remain });
      }
      return { monthlyFirst, monthlyLast, totalInterest, totalPayment: principal + totalInterest, schedule };
    }
    const monthly = r === 0 ? principal / n : principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    let remain = principal;
    for (let k = 1; k <= n; k++) {
      const interest = remain * r;
      let principalPart = monthly - interest;
      remain -= principalPart;
      if (k === n) { principalPart += remain; remain = 0; }
      totalInterest += interest;
      schedule.push({ k, monthly, principalPart, interest, remain });
    }
    return { monthlyFirst: monthly, monthlyLast: monthly, totalInterest, totalPayment: monthly * n, schedule };
  }
  // 统一入口：o = { mode:'price'|'loan', totalPrice(元), loanAmt(元), downRatio(0~1),
  //   years, loanType('comm'|'fund'|'combo'), commRate, fundRate, commAmt(元), fundAmt(元), method('bx'|'bj') }
  // 组合贷沿用房贷计算既有口径：商贷/公积金金额由调用方分别给定，算完按月相加；
  // 「贷款总额」KPI 仍返回 mode 推导出的 loanAmt，口径未改。
  function computeMortgage(o) {
    const years = Math.max(1, Math.min(30, parseInt(o.years, 10) || 30));
    const months = years * 12;
    const method = o.method === 'bj' ? 'bj' : 'bx';
    const type = o.loanType || 'comm';
    const byLoan = o.mode === 'loan';
    const totalPrice = byLoan ? 0 : (parseFloat(o.totalPrice) || 0);
    const downRatio = byLoan ? 0 : (parseFloat(o.downRatio) || 0);
    const downPay = totalPrice * downRatio;
    const loanAmt = byLoan ? (parseFloat(o.loanAmt) || 0) : (totalPrice - downPay);
    const commRate = parseFloat(o.commRate) || 0;
    const fundRate = parseFloat(o.fundRate) || 0;
    const parts = [];
    if (type === 'fund') {
      parts.push(loanSchedule(loanAmt, fundRate, months, method));
    } else if (type === 'combo') {
      parts.push(loanSchedule(parseFloat(o.commAmt) || 0, commRate, months, method));
      parts.push(loanSchedule(parseFloat(o.fundAmt) || 0, fundRate, months, method));
    } else {
      parts.push(loanSchedule(loanAmt, commRate, months, method));
    }
    const sched = [];
    for (let k = 1; k <= months; k++) {
      let monthly = 0, principalPart = 0, interest = 0, remain = 0;
      for (const p of parts) {
        const row = p.schedule[k - 1];
        if (row) { monthly += row.monthly; principalPart += row.principalPart; interest += row.interest; remain += row.remain; }
      }
      sched.push({ k, monthly, principalPart, interest, remain });
    }
    return {
      years, months, method, type, byLoan, totalPrice, downPay, loanAmt, parts, sched,
      totalInterest: parts.reduce((s, p) => s + p.totalInterest, 0),
      totalPayment: parts.reduce((s, p) => s + p.totalPayment, 0),
      monthlyFirst: parts.reduce((s, p) => s + p.monthlyFirst, 0),
      monthlyLast: parts.reduce((s, p) => s + p.monthlyLast, 0),
      annualFirst: sched.slice(0, 12).reduce((s, x) => s + x.monthly, 0) // 首年 12 期实际还款合计
    };
  }
  // 贷款类型下拉沿用录入页的中文取值，这里映射到计算用的枚举（两处共用，别再写第二份映射）
  const LOAN_TYPE_TO_CALC = { '商业贷款（商贷）': 'comm', '公积金贷款': 'fund', '组合贷（公积金+商贷）': 'combo', '全款': 'comm' };
  const REPAY_TO_CALC = { '等额本金': 'bj', '等额本息': 'bx' };
  const round2 = (v) => Math.round(v * 100) / 100;

  // ---------- 已购房 / 装修方案：数据约定 ----------
  // 后端 properties 的 jsonb 字段是整体覆盖，新数据统一挂在现有字段下，不用 ALTER TABLE，
  // 也不用改 server.js（即无需重启 8787）：
  //   transaction → purchased / purchasePrice / monthlyPayment(已有) / loanYears(已有) / annualPayment
  //   attributes  → renovated / renovationCost / renovations[]（一套房多条比价方案）
  // 每条方案 = { id, name, confirmed, createdAt, basic, budget, progress, materials, media, notes }
  const txOf = (p) => (p && p.transaction) || {};
  const atOf = (p) => (p && p.attributes) || {};
  const isPurchased = (p) => txOf(p).purchased === true;
  const renoOf = (p) => atOf(p).renovation || {}; // 仅用于兼容旧的单份档案
  const RENO_PHASES = ['拆改', '水电', '泥瓦', '木工', '油漆', '安装', '软装进场'];
  const RENO_STEPS = ['基本信息', '预算花费', '施工进度', '主材清单', '图片与备注'];
  const RENO_METHODS = ['', '全包', '半包', '清包', '整装'];
  const RENO_STYLES = ['', '现代简约', '北欧', '原木风', '奶油风', '新中式', '轻奢', '法式', '日式', '混搭'];
  const RENO_STATUS = ['', '未开始', '设计中', '施工中', '已完工'];
  const RENO_PHASE_STATUS = ['未开始', '进行中', '已完成'];
  const RENO_MATERIAL_CATS = ['地板', '瓷砖', '橱柜', '卫浴', '门窗', '墙面漆', '吊顶', '灯具', '其他'];
  const RENO_PHASE_DEFAULT = () => ({ name: '', status: '未开始', start: '', end: '', cost: '' });
  const RENO_PAY_DEFAULT = () => ({ name: '', ratio: '', amount: '', date: '', note: '' });
  function emptyRenovation() {
    return {
      // budget 这里不能预置 payments:[] —— 否则 normalizeRenovation 里
      // 「没有 payments 数组才从旧 paymentNodes 文本迁移」的分支永远不会触发，老数据会丢。
      basic: {}, budget: {},
      progress: RENO_PHASES.map((n) => ({ name: n, status: '未开始', start: '', end: '', cost: '' })),
      materials: [], media: { effect: [], construction: [], contract: [], acceptance: [] },
      notes: ''
    };
  }
  // 兼容老数据 / 部分缺失：补齐结构，避免渲染时到处判空
  function normalizeRenovation(r) {
    const e = emptyRenovation();
    if (!r || typeof r !== 'object') return e;
    // 施工进度：兼容三种历史写法（数组 / 以阶段名为键的对象 / 缺失）。
    // 关键：必须原样保留用户自己添加的行 —— 旧实现用 RENO_PHASES.map() 重排，
    // 任何不在 7 个固定阶段里的自定义行保存后都会被悄悄丢掉。
    let progress = [];
    const raw = r.progress;
    if (Array.isArray(raw)) {
      progress = raw.filter((x) => x && typeof x === 'object')
        .map((x) => Object.assign(RENO_PHASE_DEFAULT(), x, { name: String(x.name == null ? '' : x.name) }));
    } else if (raw && typeof raw === 'object') {
      progress = Object.keys(raw).map((n) => Object.assign(RENO_PHASE_DEFAULT(), raw[n] || {}, { name: n }));
    }
    if (!progress.length) progress = e.progress;
    // 标准阶段若被整行删掉，补回空行，保证「7 个标准阶段」始终可见；自定义行位置不变
    RENO_PHASES.forEach((n, i) => {
      if (!progress.some((x) => x.name === n)) progress.splice(Math.min(i, progress.length), 0, e.progress[i]);
    });
    const budget = Object.assign({}, e.budget, r.budget || {});
    // 付款节点：老数据是一整段文字（paymentNodes），按换行 / 箭头 / 分号拆成一行行，数据不丢。
    // 新数据用 budget.payments 数组，每行含 节点 / 比例 / 金额 / 日期 / 备注。
    if (!Array.isArray(budget.payments)) {
      const legacy = String(budget.paymentNodes || '').trim();
      budget.payments = legacy
        ? legacy.split(/\r?\n+|→|；|;/).map((s) => s.trim()).filter(Boolean)
          .map((t) => Object.assign(RENO_PAY_DEFAULT(), { name: t }))
        : [];
    }
    budget.payments = budget.payments.filter((x) => x && typeof x === 'object')
      .map((x) => Object.assign(RENO_PAY_DEFAULT(), x));
    const media = Object.assign({}, e.media, r.media || {});
    Object.keys(media).forEach((k) => { if (!Array.isArray(media[k])) media[k] = []; });
    return {
      basic: Object.assign({}, e.basic, r.basic || {}),
      budget,
      progress, materials: Array.isArray(r.materials) ? r.materials : e.materials,
      media, notes: r.notes || ''
    };
  }
  // ---------- 一房多条装修方案 ----------
  function newRenoId() { return 'rn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function normalizeRenoItem(x, i) {
    const e = normalizeRenovation(x);
    // 没有 id 的老数据用下标生成稳定 id，保证每次读取 id 不变（否则勾选对比会失效）
    return {
      id: (x && x.id) ? String(x.id) : ('rn_legacy_' + i),
      name: (x && x.name) || '', confirmed: !!(x && x.confirmed),
      createdAt: (x && x.createdAt) || '',
      basic: e.basic, budget: e.budget, progress: e.progress,
      materials: e.materials, media: e.media, notes: e.notes
    };
  }
  function renoListOf(p) {
    const a = atOf(p);
    if (Array.isArray(a.renovations)) return a.renovations.map(normalizeRenoItem);
    // 兼容上一版单份档案：自动转成第一条，并视为已确定，数据不丢
    const old = renoOf(p);
    if (old && typeof old === 'object' && Object.keys(old).length) {
      return [Object.assign(normalizeRenoItem(old, 0), { name: '原装修档案', confirmed: true })];
    }
    return [];
  }
  const confirmedReno = (p) => renoListOf(p).find((x) => x.confirmed) || null;
  const renoTitle = (it) => (it && (it.name || (it.basic && it.basic.company))) || '未命名方案';
  const renoKey = (row) => row.p.id + '::' + row.it.id;
  // 统一保存：只改 attributes.renovations，其余字段（已购标记 / 装修费用 / 旧档案）原样保留
  async function saveRenovations(p, arr) {
    const a = Object.assign({}, atOf(p));
    delete a.renovation; // 旧的单份字段清掉，避免下次读取时被当成另一条方案
    a.renovations = arr;
    return syncPropertyRow(await Store.update(p.id, { attributes: a }));
  }
  async function setConfirmedReno(p, itemId) {
    const arr = renoListOf(p).map((x) => Object.assign({}, x, { confirmed: x.id === itemId }));
    return saveRenovations(p, arr);
  }
  // 装修列表 / 装修对比共用：把全部房源的方案展平成一行一条
  function renoRowsOf() {
    const rows = [];
    (state.properties || []).forEach((p) => renoListOf(p).forEach((it) => rows.push({ p, it })));
    return rows;
  }
  function syncPropertyRow(row) {
    if (!row) return row;
    const i = state.properties.findIndex((x) => x.id === row.id);
    if (i >= 0) state.properties[i] = row;
    else state.properties.push(row);
    return row;
  }
  const selOpts = (arr, cur, blank) => arr.map((s) => `<option value="${esc(s)}" ${String(cur || '') === s ? 'selected' : ''}>${esc(s || blank || '（未选择）')}</option>`).join('');

  // 标记为已购房 / 修改购房信息弹窗：
  // 房贷信息 → 月供/年供自动算，公式一律走文件顶部唯一的 computeMortgage()（与房贷计算页同源）。
  // 自动算出的两个结果仍允许手动覆盖，覆盖后本弹窗不再用公式覆盖该字段。
  function openPurchaseModal(p, onDone) {
    const modal = $('purchase-modal');
    if (!modal) return;
    const t = txOf(p), a = atOf(p), was = isPurchased(p);
    $('pm-title').textContent = was ? '🏡 修改购房信息' : '🏡 标记为已购房';
    $('pm-apply').textContent = was ? '保存修改' : '确定标记';
    $('pm-unmark').classList.toggle('hidden', !was);

    // 初始值：优先读房源上已存的信息，没有则用 2026 年现行默认值
    const savedType = t.loanType || '商业贷款（商贷）';
    $('pm-price').value = t.purchasePrice != null ? t.purchasePrice : (t.totalPrice != null ? t.totalPrice : '');
    $('pm-down').value = t.downPaymentRatio != null ? String(t.downPaymentRatio) : (savedType === '全款' ? '1' : '0.3');
    $('pm-loantype').value = savedType;
    $('pm-years').value = t.loanYears != null ? t.loanYears : 30;
    $('pm-comm-rate').value = t.commRate != null ? t.commRate : 3.0;
    $('pm-fund-rate').value = t.fundRate != null ? t.fundRate : 2.6;
    $('pm-method').value = t.repayment === '等额本金' ? '等额本金' : '等额本息';
    $('pm-fund-amt').value = t.fundAmount != null ? t.fundAmount : '';
    $('pm-monthly').value = t.monthlyPayment != null ? t.monthlyPayment : '';
    $('pm-annual').value = t.annualPayment != null ? t.annualPayment : '';
    $('pm-renovated').value = a.renovated === true ? 'yes' : (a.renovated === false ? 'no' : '');
    $('pm-cost').value = a.renovationCost != null ? a.renovationCost : '';

    let monthlyManual = false, annualManual = false;
    const isCash = () => $('pm-loantype').value === '全款';
    const isFund = () => ['公积金贷款', '组合贷（公积金+商贷）'].indexOf($('pm-loantype').value) >= 0;
    const isCombo = () => $('pm-loantype').value === '组合贷（公积金+商贷）';

    // 只负责收集表单值，计算交给唯一实现；组合贷：用户填公积金金额，其余算商贷
    function calcNow() {
      const priceWan = num($('pm-price').value);
      const ratio = isCash() ? 1 : (parseFloat($('pm-down').value) || 0);
      const totalPrice = (priceWan || 0) * 10000;
      const loanAmt = totalPrice * (1 - ratio);
      const fundAmtWan = Math.max(0, num($('pm-fund-amt').value) || 0);
      const fundAmt = Math.min(fundAmtWan * 10000, loanAmt);
      const commAmt = Math.max(0, loanAmt - fundAmt);
      return computeMortgage({
        mode: 'price', totalPrice, downRatio: ratio,
        years: $('pm-years').value || 30,
        loanType: LOAN_TYPE_TO_CALC[$('pm-loantype').value] || 'comm',
        commRate: $('pm-comm-rate').value, fundRate: $('pm-fund-rate').value,
        commAmt, fundAmt,
        method: REPAY_TO_CALC[$('pm-method').value] || 'bx'
      });
    }
    function syncFields() {
      const cash = isCash();
      $('pm-comm-rate-row').classList.toggle('hidden', cash || $('pm-loantype').value === '公积金贷款');
      $('pm-fund-rate-row').classList.toggle('hidden', cash || !isFund());
      $('pm-fund-amt-row').classList.toggle('hidden', cash || !isCombo());
      ['pm-down', 'pm-years', 'pm-comm-rate', 'pm-method', 'pm-fund-rate', 'pm-fund-amt'].forEach((id) => {
        const el = $(id); el.disabled = cash; el.style.opacity = cash ? '0.5' : '';
      });
    }
    function paintTip() {
      $('pm-annual-tip').textContent = annualManual ? '（已手动调整）' : '（自动计算）';
      $('pm-monthly').title = monthlyManual ? '已手动调整' : '自动计算，可修改';
      $('pm-calc-state').textContent = (monthlyManual || annualManual) ? '✍️ 部分字段已手动调整' : '✅ 自动计算';
    }
    function paintCalc() {
      syncFields();
      const ready = num($('pm-price').value) != null;
      const R = ready ? calcNow() : null;
      if (R) {
        const autoM = round2(R.monthlyFirst), autoA = round2(R.annualFirst);
        if (!monthlyManual) $('pm-monthly').value = autoM;
        if (!annualManual) $('pm-annual').value = autoA;
      }
      paintTip();
      if (!R) { $('pm-note').textContent = '请先填写购房价 / 实际成交价。'; return; }
      const bits = [];
      if (isCash()) bits.push('全款无需贷款，月供与年供为 0。');
      else {
        bits.push('首付 ' + round2(R.downPay / 10000) + ' 万 · 贷款 ' + round2(R.loanAmt / 10000) + ' 万 · ' + R.years + ' 年（' + R.months + ' 期）。');
        if (R.method === 'bj') bits.push('等额本金：月供取首月金额、逐月递减；年供取首年 12 期实际还款合计。');
        else bits.push('等额本息：每月月供固定，年供 = 月供 × 12。');
        if (isCombo()) bits.push('组合贷：公积金 ' + round2((num($('pm-fund-amt').value) || 0)) + ' 万，其余按商贷，分别计息后按月相加。');
      }
      $('pm-note').textContent = bits.join(' ');
    }

    // 首次打开：若已存的值和公式算出来的不一致，说明是用户以前手动填的，保留不被覆盖
    const first = num($('pm-price').value) != null ? calcNow() : null;
    if (first) {
      const autoM = round2(first.monthlyFirst), autoA = round2(first.annualFirst);
      const savedM = num($('pm-monthly').value), savedA = num($('pm-annual').value);
      monthlyManual = savedM != null && Math.abs(savedM - autoM) > 0.01;
      annualManual = savedA != null && Math.abs(savedA - autoA) > 0.01;
      if (!monthlyManual) $('pm-monthly').value = autoM;
      if (!annualManual) $('pm-annual').value = autoA;
    }
    paintCalc();

    ['pm-price', 'pm-down', 'pm-loantype', 'pm-years', 'pm-comm-rate', 'pm-method', 'pm-fund-rate', 'pm-fund-amt'].forEach((id) => {
      const el = $(id);
      el.addEventListener('input', paintCalc);
      el.addEventListener('change', paintCalc);
    });
    $('pm-monthly').oninput = () => { monthlyManual = true; paintTip(); };
    $('pm-annual').oninput = () => { annualManual = true; paintTip(); };

    const close = () => modal.classList.add('hidden');
    $('pm-x').onclick = close;
    $('pm-cancel').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    $('pm-apply').onclick = async () => {
      const price = num($('pm-price').value);
      if (price == null) { toast('请先填写购房价 / 实际成交价'); return; }
      const rv = $('pm-renovated').value;
      const renovated = rv === 'yes' ? true : (rv === 'no' ? false : undefined);
      const ratio = parseFloat($('pm-down').value) || 0;
      const loanWan = price * (1 - ratio);
      const fundWan = Math.max(0, num($('pm-fund-amt').value) || 0);
      const transaction = Object.assign({}, t, {
        purchased: true, purchasePrice: price,
        downPaymentRatio: ratio, downPayment: round2(price * ratio), // 兼容录入页「首付(万)」
        loanType: $('pm-loantype').value,
        loanYears: num($('pm-years').value),
        commRate: num($('pm-comm-rate').value), fundRate: num($('pm-fund-rate').value),
        fundAmount: num($('pm-fund-amt').value),
        gfundRatio: isCombo() && loanWan > 0 ? round2(Math.min(100, fundWan / loanWan * 100)) : t.gfundRatio,
        repayment: $('pm-method').value,
        monthlyPayment: num($('pm-monthly').value),
        annualPayment: num($('pm-annual').value)
      });
      const attributes = Object.assign({}, a, { renovated, renovationCost: num($('pm-cost').value) });
      try {
        const row = syncPropertyRow(await Store.update(p.id, { transaction, attributes }));
        close();
        toast(was ? '购房信息已保存' : '已标记为已购房', true);
        if (onDone) onDone(row);
      } catch (e) { toast('保存失败：' + e.message); }
    };
    $('pm-unmark').onclick = async () => {
      if (!confirm('取消后该房源会从「已购房源」列表移除（购房信息仍保留）。确定？')) return;
      try {
        const row = syncPropertyRow(await Store.update(p.id, { transaction: Object.assign({}, t, { purchased: false }) }));
        close();
        toast('已取消已购标记', true);
        if (onDone) onDone(row);
      } catch (e) { toast('操作失败：' + e.message); }
    };
    modal.classList.remove('hidden');
    setTimeout(() => $('pm-price').focus(), 60);
  }

  // ---------- 用户展示（头像 + 昵称）----------
  function initialOf(u) {
    const s = (u && (u.name || u.email)) || '我';
    return s.trim().charAt(0).toUpperCase();
  }
  function renderUser() {
    const u = state.user || {};
    const av = $('user-avatar');
    if (av) {
      if (u.avatar) { av.style.backgroundImage = 'url(' + u.avatar + ')'; av.textContent = ''; }
      else { av.style.backgroundImage = 'none'; av.textContent = initialOf(u); }
    }
    const nm = $('user-name'); if (nm) nm.textContent = u.name || u.email || '';
    renderDeadlineChip();
  }

  // ---------- 路由 ----------
  // 记住当前菜单视图：浏览器刷新后仍停留在同一页（与侧栏收起、主题同类本地记忆）
  const VIEW_KEY = 'hvt_view';
  const MENU_VIEWS = ['list', 'map', 'compare', 'knowledge', 'mortgage', 'purchased', 'renoList', 'trash', 'profile'];
  // 顶部栏左侧标题跟随当前菜单（刷新后由 setView 恢复，不会出现标题与菜单不一致）
  const VIEW_TITLES = {
    list: '房源列表', map: '地图分布', compare: '房源对比', knowledge: '购房知识',
    mortgage: '房贷计算', purchased: '已购房源', renoList: '装修列表', trash: '回收站', profile: '设置',
    renovation: '装修信息', renovationForm: '填写装修信息', detail: '房源详情'
  };
  function renderPageName(name) {
    const el = $('hv-page-name');
    if (!el) return;
    if (name === 'form') { el.textContent = state.editing ? '编辑房源' : '录入房源'; return; }
    el.textContent = VIEW_TITLES[name] || '看房记录';
  }
  function loadSavedView() {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      // 只恢复菜单视图；录入/编辑(form)是临时页面，刷新后回到上一次的菜单
      // 地图未启用时不恢复到地图分布页（菜单此时也是隐藏的）
      if (v === 'map') {
        const cached = Api.currentUser();
        if (!cached || !cached.mapEnabled) return;
      }
      if (MENU_VIEWS.indexOf(v) !== -1) state.view = v;
    } catch (e) {}
  }
  function saveView(name) {
    try { if (MENU_VIEWS.indexOf(name) !== -1) localStorage.setItem(VIEW_KEY, name); } catch (e) {}
  }
  // 地图 / 对比 / 房贷都依赖 state.properties，而它原本只在列表页加载；刷新后需先备好数据
  async function ensureProperties() {
    if (state.properties.length) return;
    const list = await Store.list();
    state.properties = list;
    const ids = new Set(list.map((p) => p.id));
    let pruned = false;
    Array.from(state.selected).forEach((id) => { if (!ids.has(id)) { state.selected.delete(id); pruned = true; } });
    if (pruned) saveCompareSel();
  }

  // 登录页一次性提示（例如闲置自动退出）：由 showAuth 消费，避免依赖 setTimeout 与异步登出的竞态
  let authNotice = '';
  function showAuth() {
    $('auth-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
    syncDark(); // 回到登录页时撤掉深色
    if (authNotice) {
      const m = $('auth-msg');
      if (m) { m.textContent = authNotice; m.style.color = 'var(--danger)'; }
      authNotice = '';
    }
  }
  async function showApp() {
    $('auth-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    syncDark(); // 进入主应用时恢复深色（如果用户选的是 hd-6）
    renderUser();
    syncMapMenu(); // 地图功能未启用时隐藏「地图分布」菜单
    if (state.view !== 'list') {
      try { await ensureProperties(); } catch (e) { console.warn('预加载房源失败：', e.message); }
    }
    // 预加载期间若已退出登录，就不要再把应用界面显示回来
    if (!Auth.getSession().session) return;
    // 用 setView 而非 renderView：同步菜单高亮 + 房贷页滚动容器，并写入记忆
    setView(state.view);
  }

  function setView(name) {
    state.view = name;
    if (MENU_VIEWS.indexOf(name) !== -1) state.lastMenuView = name;
    // 「房源对比」菜单默认停在房源对比；只有装修列表点「对比选中」进来才切到装修对比
    if (name === 'compare') {
      state.compareTab = state.compareTabFromReno ? 'renovation' : 'property';
      state.compareTabFromReno = false;
    }
    saveView(name);
    if (name === 'form') state.editing = null; // setView('form') 只会走「新增」入口，编辑是 renderForm 直调
    renderPageName(name);
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    const c = $('content');
    c.classList.remove('m-page-host'); // 离开房贷页时还原，保证列表等视图可正常滚动
    const zc = document.querySelector('.zy-content');
    if (zc) {
      zc.classList.toggle('mortgage-view', name === 'mortgage');
      // 设置页：去掉内容区顶部内边距，让吸顶的「设置」操作条能真正贴住顶部栏（否则会留出 20px 缝隙）
      zc.classList.toggle('profile-view', name === 'profile');
    }
    renderDeadlineChip(); // 切菜单时重算天数（设置页刚改过日期也能立即生效）
    renderView(name);
  }

  function renderView(name) {
    const c = $('content');
    if (name === 'list') return renderList(c);
    if (name === 'purchased') return renderPurchased(c);
    if (name === 'renoList') return renderRenoList(c);
    if (name === 'renovation') return renderRenovation(c, state.renoPropId);
    if (name === 'renovationForm') return renderRenovationForm(c, state.renoPropId);
    if (name === 'map') return renderMap(c);
    if (name === 'compare') return renderCompare(c);
    if (name === 'trash') return renderTrash(c);
    if (name === 'knowledge') return renderKnowledge(c);
    if (name === 'mortgage') return renderMortgage(c);
    if (name === 'profile') return renderProfile(c);
    if (name === 'form') return renderForm(c, null);
  }

  // ---------- 列表 ----------
  async function renderList(c) {
    c.innerHTML = '<div class="empty">加载中…</div>';
    try {
      const list = await Store.list();
      state.properties = list;
      // 清理已不存在（彻底删除）的对比勾选，避免脏数据
      const ids = new Set(list.map((p) => p.id));
      let pruned = false;
      Array.from(state.selected).forEach((id) => { if (!ids.has(id)) { state.selected.delete(id); pruned = true; } });
      if (pruned) saveCompareSel();
    } catch (e) { c.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; return; }
    renderListInner(c, state.properties);
  }

  // 共享卡片模板：列表 / 回收站都调用，改卡片样式只动这一处
  function cardHTML(p, opts) {
    opts = opts || {};
    const mode = opts.mode || null;
    const actions = opts.actions || '';
    const showFav = opts.showFav !== false;
    const showDetail = opts.showDetail !== false;
    const media = p.media || {}, loc = p.location || {}, attr = p.attributes || {}, tran = p.transaction || {};
    const firstImg = (media.images && media.images[0]) || '';
    const status = opts.statusText || tran.status || '在售';
    const statusCls = status === '在售' ? 'st-ok' : (status === '已售' ? 'st-sold' : (status === '已下架' ? 'st-off' : (status === '待看' ? 'st-await' : 'st-bought')));
    const title = p.title || loc.community || '未命名';
    const ph = (title || '房').slice(0, 1);
    const locTxt = [loc.city, loc.district, loc.community].filter(Boolean).join(' / ');
    const tp = parseFloat(tran.totalPrice), ar = parseFloat(attr.area);
    const unit = (tp > 0 && ar > 0) ? Math.round(tp * 10000 / ar) : null;
    const picked = mode === 'compare' ? state.selected.has(p.id) : (mode === 'batch' ? state.batchSel.has(p.id) : false);
    return `<div class="card list-card">
      <div class="card-cover">
        <div class="cover-ph">${esc(ph)}</div>
        ${firstImg ? `<img src="${esc(firstImg)}" alt="" onerror="this.style.display='none'"/>` : `<img src="${esc(presetCover(p.id))}" alt=""/>`}
        ${mode ? `<label class="cover-pick" title="${mode === 'compare' ? '勾选以对比' : '勾选以批量操作'}"><input type="checkbox" data-pick="${p.id}" ${picked ? 'checked' : ''}/></label>` : ''}
        ${showFav ? `<button class="fav-star ${p.favorite ? 'on' : ''}" data-fav="${p.id}" title="收藏">${p.favorite ? '★' : '☆'}</button>` : ''}
      </div>
      <div class="card-body">
        <h3 class="card-title"${showDetail ? ` data-detail="${p.id}" title="点击查看详情"` : ''}>${esc(title)}</h3>
        <div class="card-sub">${esc(locTxt || '未填写地址')}</div>
        <div class="card-metrics">
          <div class="metric"><span class="metric-num metric-price">${tran.totalPrice ? esc(tran.totalPrice) + ' 万' : '—'}</span><span class="metric-label">总价</span></div>
          <div class="metric"><span class="metric-num">${esc(attr.layout || '—')}</span><span class="metric-label">户型</span></div>
          <div class="metric"><span class="metric-num">${attr.area ? esc(attr.area) : '—'}</span><span class="metric-label">面积 ㎡</span></div>
        </div>
        <div class="card-foot">
          <div class="card-tags">${(state.selected && state.selected.has(p.id)) ? `<span class="tag tag-compare">对比中</span>` : ''}${unit != null ? `<span class="card-unit">${unit.toLocaleString('zh-CN')} 元/㎡</span>` : ''}${state.demandMatch ? `<span class="tag" title="${esc((demandMatch(p).reasons || []).join('、'))}">匹配 ${demandMatch(p).score}%</span>` : ''}${tran.sourcePlatform ? `<span class="tag">${esc(tran.sourcePlatform)}</span>` : ''}${tran.viewingDate ? `<span class="tag">看房 ${esc(tran.viewingDate)}</span>` : ''}<span class="tag ${statusCls}">${esc(status)}</span></div>
        </div>
        <div class="card-foot">
          <div class="card-sub">评分 ${computeScore(p)}</div>
          <div class="card-ops">${actions}</div>
        </div>
      </div>
    </div>`;
  }

  // 表格视图：列表页 / 回收站共用的行模板。沿用卡片的 data-* 标记，事件绑定无需改动
  function tableRowHTML(p, opts) {
    opts = opts || {};
    const mode = opts.mode || null;
    const showFav = opts.showFav !== false;
    const showDetail = opts.showDetail !== false;
    const simple = !!opts.simple;
    const picked = !!opts.picked;
    const actions = typeof opts.actions === 'function' ? opts.actions(p) : (opts.actions || '');
    const media = p.media || {}, loc = p.location || {}, attr = p.attributes || {}, tran = p.transaction || {};
    const firstImg = (media.images && media.images[0]) || '';
    const cover = firstImg ? esc(firstImg) : esc(presetCover(p.id));
    const status = opts.statusText || tran.status || '在售';
    const statusCls = status === '在售' ? 'st-ok' : (status === '已售' ? 'st-sold' : (status === '已下架' ? 'st-off' : (status === '待看' ? 'st-await' : 'st-bought')));
    const title = p.title || loc.community || '未命名';
    const locTxt = [loc.city, loc.district, loc.community].filter(Boolean).join(' / ');
    const tp = parseFloat(tran.totalPrice), ar = parseFloat(attr.area);
    const unit = (tp > 0 && ar > 0) ? Math.round(tp * 10000 / ar) : null;
    return `<tr>
      ${mode ? `<td class="pl-pick"><input type="checkbox" data-pick="${p.id}" ${picked ? 'checked' : ''}/></td>` : ''}
      <td class="pl-cover"><img src="${cover}" alt="" onerror="this.style.display='none'"/></td>
      <td class="pl-title">${showDetail ? `<a class="pl-link" data-detail="${p.id}">${esc(title)}</a>` : `<span class="pl-link">${esc(title)}</span>`}<span class="pl-sub">${esc(locTxt || '未填写地址')}</span></td>
      <td class="pl-num pl-price">${tran.totalPrice ? esc(tran.totalPrice) + ' 万' : '—'}</td>
      <td class="pl-num">${unit != null ? unit.toLocaleString('zh-CN') : '—'}</td>
      <td>${esc(attr.layout || '—')}</td>
      <td class="pl-num">${attr.area ? esc(attr.area) : '—'}</td>
      <td class="pl-status">${(state.selected && state.selected.has(p.id)) ? '<span class="tag tag-compare">对比中</span> ' : ''}<span class="tag ${statusCls}">${esc(status)}</span></td>
      ${simple ? '' : `<td class="pl-num">${computeScore(p)}</td>`}
      ${showFav ? `<td class="pl-fav-cell"><button class="pl-fav ${p.favorite ? 'on' : ''}" data-fav="${p.id}" title="收藏">${p.favorite ? '★' : '☆'}</button></td>` : ''}
      <td class="pl-ops">${actions}</td>
    </tr>`;
  }

  function tableHTML(rows, opts) {
    opts = opts || {};
    const mode = opts.mode || null;
    const showFav = opts.showFav !== false;
    const body = rows.map((p) => {
      const picked = mode === 'compare' ? state.selected.has(p.id) : (mode === 'batch' ? state.batchSel.has(p.id) : false);
      return tableRowHTML(p, Object.assign({}, opts, { picked }));
    }).join('');
    return `<div class="plist-wrap"><table class="plist">
      <thead><tr>
        ${mode ? '<th class="pl-pick"></th>' : ''}
        <th>封面</th><th>房源</th><th>总价</th><th>单价(元/㎡)</th><th>户型</th><th>面积(㎡)</th><th>状态</th>
        ${opts.simple ? '' : '<th>评分</th>'}${showFav ? '<th>收藏</th>' : ''}<th>操作</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  function renderListInner(c, all) {
    const f = state.filters;
    const matched = (p) => {
      const loc = p.location || {}, attr = p.attributes || {}, tran = p.transaction || {}, fac = p.facilities || {};
      if (f.q) { const q = f.q.toLowerCase(); const hay = [p.title, loc.community, loc.district, tran.houseNumber, tran.agentName, tran.agentPhone].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
      if (f.district && (loc.district || '') !== f.district) return false;
      if (f.platform && (tran.sourcePlatform || '') !== f.platform) return false;
      if (f.layout && (attr.layout || '') !== f.layout) return false;
      if (f.orientation && (attr.orientation || '') !== f.orientation) return false;
      if (f.floor && (attr.floor || '') !== f.floor) return false;
      if (f.status && (tran.status || '在售') !== f.status) return false;
      if (f.totalMin !== '' && num(tran.totalPrice) < num(f.totalMin)) return false;
      if (f.totalMax !== '' && num(tran.totalPrice) > num(f.totalMax)) return false;
      if (f.areaMin !== '' && num(attr.area) < num(f.areaMin)) return false;
      if (f.areaMax !== '' && num(attr.area) > num(f.areaMax)) return false;
      if (f.decoration && (attr.decoration || '') !== f.decoration) return false;
      if (f.subwayMax !== '' && num(loc.subwayDistance) > num(f.subwayMax)) return false;
      if (f.viewingFrom && (tran.viewingDate || '') < f.viewingFrom) return false;
      if (f.viewingTo && (tran.viewingDate || '') > f.viewingTo) return false;
      if (f.withTransport && !fac.transport) return false;
      if (f.withSchool && !fac.school) return false;
      if (f.scoreMin !== '' && computeScore(p) < num(f.scoreMin)) return false;
      if (f.favOnly && !p.favorite) return false;
      return true;
    };
    let shown = all.filter(matched);
    // 需求匹配模式：按购房需求打分，只留 ≥40 分并按匹配度排序
    if (state.demandMatch && hasDemandConfigured()) {
      shown = shown
        .map((p) => ({ p, m: demandMatch(p) }))
        .filter((x) => x.m.score >= 40)
        .sort((a, b) => b.m.score - a.m.score)
        .map((x) => x.p);
    }
    state.filtered = shown;
    if (f.sort === 'score') shown = shown.slice().sort((a, b) => computeScore(b) - computeScore(a));
    // 分页
    const totalShown = shown.length;
    const pages = Math.max(1, Math.ceil(totalShown / state.pageSize));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;
    const pageStart = (state.page - 1) * state.pageSize;
    const pageItems = shown.slice(pageStart, pageStart + state.pageSize);
    const opt = (arr, allLabel) => ['', ...Array.from(new Set(arr.filter(Boolean)))]
      .map((d) => `<option value="${esc(d)}" ${f[allLabel.k] === d ? 'selected' : ''}>${d || allLabel.t}</option>`).join('');
    const districts = all.map((p) => (p.location && p.location.district) || '');
    const platforms = all.map((p) => (p.transaction && p.transaction.sourcePlatform) || '');
    const layouts = all.map((p) => (p.attributes && p.attributes.layout) || '');
    const orientations = all.map((p) => (p.attributes && p.attributes.orientation) || '');
    const floors = all.map((p) => (p.attributes && p.attributes.floor) || '');
    const pickCount = state.pickMode === 'compare' ? state.selected.size : state.batchSel.size;
    const head = crumb(['看房记录', '房源列表']) + `<div class="section-head"><h2>已记录房源（${all.length}${shown.length !== all.length ? '，筛选后 ' + shown.length : ''}）</h2>
      <div class="spacer"></div>
      <span class="dd">
        <button class="btn primary" id="add-new">+ 录入</button>
        <button class="btn primary dd-caret" id="add-toggle" title="更多导入选项" aria-label="更多导入选项">▾</button>
        <span class="dd-menu hidden" id="add-menu">
          <button class="dd-item" id="seed-demo">导入示例数据</button>
          <button class="dd-item" id="btn-import">导入CSV</button>
        </span>
      </span>
      <button class="btn ${state.demandMatch ? 'on' : ''}" id="btn-demand" title="按「设置-购房需求」自动匹配房源">🎯 需求匹配${hasDemandConfigured() ? '' : '（未设置）'}</button>
      <button class="btn" id="to-compare">对比选中（${state.selected.size}）</button>
      <button class="btn ${f.favOnly ? 'on' : ''}" id="btn-fav-only" title="只显示已收藏的房源">⭐ 只看收藏</button>
      <button class="btn" id="btn-weights">评分权重</button>
      <button class="btn" id="btn-batch-del">批量删除(${state.batchSel.size})</button>
      <button class="btn" id="btn-batch-status">批量改状态</button>
      <button class="btn" id="btn-export">导出CSV</button>
      <input type="file" id="csv-file" accept=".csv" style="display:none"/>
    </div>`;
    const pickBar = state.pickMode ? `<div class="pick-bar">
      <span class="muted">当前${state.pickMode === 'compare' ? '对比' : '批量'}模式 · 已勾选 <b>${pickCount}</b> 套</span>
      <button class="btn" id="btn-pick-all">全选</button>
      <button class="btn" id="btn-pick-none">取消勾选</button>
    </div>` : '';
    const statusOpts = ['', '在售', '已售', '已下架', '待看', '已购'].map((s) => `<option value="${esc(s)}" ${f.status === s ? 'selected' : ''}>${s || '全部状态'}</option>`).join('');
    const sortOpts = [['time', '时间倒序'], ['score', '综合评分']].map(([v, t]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${t}</option>`).join('');
    const toolbar = `<div class="toolbar">
      <select id="f-district" class="tb-in">${opt(districts, { k: 'district', t: '全部区域' })}</select>
      <select id="f-platform" class="tb-in">${opt(platforms, { k: 'platform', t: '全部平台' })}</select>
      <select id="f-layout" class="tb-in">${opt(layouts, { k: 'layout', t: '全部户型' })}</select>
      <select id="f-orientation" class="tb-in">${opt(orientations, { k: 'orientation', t: '全部朝向' })}</select>
      <select id="f-floor" class="tb-in">${opt(floors, { k: 'floor', t: '全部楼层' })}</select>
      <select id="f-status" class="tb-in">${statusOpts}</select>
      <select id="f-sort" class="tb-in">${sortOpts}</select>
      <div class="tb-right">
        <input id="f-q" class="tb-in tb-search" placeholder="搜索小区/编号/中介" value="${esc(f.q)}"/>
        <button class="btn view-mode-btn" id="btn-view-mode" title="${state.listMode === 'table' ? '切换为卡片显示' : '切换为列表显示'}">${state.listMode === 'table' ? '▦ 卡片' : '☰ 列表'}</button>
        <button class="btn" id="btn-adv">高级搜索</button>
      </div>
    </div>`;
    const advPanel = `<div class="adv-panel ${state.advOpen ? '' : 'hidden'}" id="adv-panel">
      <div class="adv-grid">
        <div class="field"><label>关键词</label><input id="a-q" value="${esc(f.q)}" placeholder="小区 / 编号 / 中介"/></div>
        <div class="field"><label>区域</label><select id="a-district">${opt(districts, { k: 'district', t: '全部区域' })}</select></div>
        <div class="field"><label>平台</label><select id="a-platform">${opt(platforms, { k: 'platform', t: '全部平台' })}</select></div>
        <div class="field"><label>户型</label><select id="a-layout">${opt(layouts, { k: 'layout', t: '全部户型' })}</select></div>
        <div class="field"><label>朝向</label><select id="a-orientation">${opt(orientations, { k: 'orientation', t: '全部朝向' })}</select></div>
        <div class="field"><label>楼层</label><select id="a-floor">${opt(floors, { k: 'floor', t: '全部楼层' })}</select></div>
        <div class="field"><label>状态</label><select id="a-status">${statusOpts}</select></div>
        <div class="field"><label>装修</label><select id="a-decoration">${['', '精装', '简装', '毛坯'].map((s) => `<option value="${esc(s)}" ${f.decoration === s ? 'selected' : ''}>${s || '全部装修'}</option>`).join('')}</select></div>
        <div class="field"><label>总价(万) 起</label><input id="a-totalMin" type="number" value="${esc(f.totalMin)}"/></div>
        <div class="field"><label>总价(万) 止</label><input id="a-totalMax" type="number" value="${esc(f.totalMax)}"/></div>
        <div class="field"><label>面积(㎡) 起</label><input id="a-areaMin" type="number" value="${esc(f.areaMin)}"/></div>
        <div class="field"><label>面积(㎡) 止</label><input id="a-areaMax" type="number" value="${esc(f.areaMax)}"/></div>
        <div class="field"><label>地铁距离(米) 内</label><input id="a-subwayMax" type="number" value="${esc(f.subwayMax)}"/></div>
        <div class="field"><label>看房日期 起</label><input id="a-viewingFrom" type="date" value="${esc(f.viewingFrom)}"/></div>
        <div class="field"><label>看房日期 止</label><input id="a-viewingTo" type="date" value="${esc(f.viewingTo)}"/></div>
        <div class="field"><label>综合评分 至少</label><input id="a-scoreMin" type="number" value="${esc(f.scoreMin)}"/></div>
        <div class="field"><label>排序方式</label><select id="a-sort">${sortOpts}</select></div>
        <div class="field"><label>配套要求</label>
          <div class="checks">
            <label><input type="checkbox" id="a-withTransport" ${f.withTransport ? 'checked' : ''}/> 有交通</label>
            <label><input type="checkbox" id="a-withSchool" ${f.withSchool ? 'checked' : ''}/> 有学校</label>
          </div>
        </div>
      </div>
      <div class="adv-actions">
        <button class="btn primary" id="adv-apply">应用筛选</button>
        <button class="btn" id="adv-reset">重置条件</button>
        <button class="btn" id="adv-close">收起</button>
      </div>
    </div>`;
    if (!all.length) {
      c.innerHTML = head + '<div class="toolwrap">' + toolbar + pickBar + advPanel + '</div>' + '<div class="empty">还没有记录。点右上角“+ 录入”添加第一套房源吧。</div>';
      bindListToolbar(c);
      return;
    }
    const listActions = (p) => `<button class="op-btn" data-edit="${p.id}">编辑</button><button class="op-btn" data-copy="${p.id}">复制</button><button class="op-btn op-btn-danger" data-del="${p.id}">删除</button>`;
    const listBody = state.listMode === 'table'
      ? tableHTML(pageItems, { mode: state.pickMode, showFav: true, actions: listActions })
      : '<div class="cards">' + pageItems.map((p) => cardHTML(p, { mode: state.pickMode, actions: listActions(p) })).join('') + '</div>';
    const pager = `<div class="pager">
      <button class="btn" id="pg-first" ${state.page <= 1 ? 'disabled' : ''}>首页</button>
      <button class="btn" id="pg-prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="pg-info">第 ${state.page} / ${pages} 页 · 共 ${totalShown} 套</span>
      <button class="btn" id="pg-next" ${state.page >= pages ? 'disabled' : ''}>下一页</button>
      <button class="btn" id="pg-last" ${state.page >= pages ? 'disabled' : ''}>末页</button>
      <select id="pg-size" class="tb-in">
        ${[5, 10, 20, 50, 100].map((n) => `<option value="${n}" ${state.pageSize === n ? 'selected' : ''}>${n} 条/页</option>`).join('')}
      </select>
    </div>`;
    c.innerHTML = head + '<div class="toolwrap">' + toolbar + pickBar + advPanel + '</div>' + listBody + pager;
    bindListToolbar(c);
  }

  // 卡片区居中策略：至少排满一行才居中；卡片凑不满一行时靠左。
  // 列数按容器实际宽度算（侧栏收起 / 窗口缩放都会变），不用写死「5 个」。
  const CARD_W = 276.67, CARD_GAP = 15;
  let cardsRO = null;
  function syncCardsCenter() {
    document.querySelectorAll('.cards').forEach((g) => {
      const n = g.querySelectorAll('.card').length;
      if (!n) { g.classList.remove('is-centered'); return; }
      const w = g.getBoundingClientRect().width;
      const cols = Math.max(1, Math.floor((w + CARD_GAP) / (CARD_W + CARD_GAP)));
      g.classList.toggle('is-centered', n >= cols);
    });
  }
  function watchCardsCenter() {
    if (typeof ResizeObserver !== 'undefined') {
      if (!cardsRO) cardsRO = new ResizeObserver(() => syncCardsCenter());
      document.querySelectorAll('.cards').forEach((g) => cardsRO.observe(g));
    }
    syncCardsCenter();
  }
  window.addEventListener('resize', syncCardsCenter); // 兜底：容器宽度变化但 RO 未触发时仍重算

  function bindListToolbar(c) {
    watchCardsCenter();
    const safe = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    safe('add-new', () => { state.pickMode = null; setView('form'); });
    // 顶部按钮：第一次点击进入勾选模式，第二次点击才执行动作
    safe('to-compare', () => {
      if (state.pickMode !== 'compare') {
        state.pickMode = 'compare'; renderListInner(c, state.properties);
        toast('请勾选要对比的房源，再点一次「对比选中」查看对比');
        return;
      }
      if (state.selected.size < 2) { toast('请至少勾选 2 套房源再对比'); return; }
      setView('compare');
    });
    safe('btn-batch-del', () => {
      if (state.pickMode !== 'batch') {
        state.pickMode = 'batch'; renderListInner(c, state.properties);
        toast('请勾选要批量删除的房源，再点一次「批量删除」执行');
        return;
      }
      doBatchDelete(c);
    });
    safe('btn-batch-status', () => {
      if (state.pickMode !== 'batch') {
        state.pickMode = 'batch'; renderListInner(c, state.properties);
        toast('请勾选要批量改状态的房源，再点一次「批量改状态」执行');
        return;
      }
      batchSetStatus(c);
    });
    safe('btn-export', () => doExportCsv());
    safe('btn-import', () => document.getElementById('csv-file').click());
    safe('btn-weights', () => { openWeightsModal(); });
    safe('btn-view-mode', () => {
      state.listMode = state.listMode === 'table' ? 'card' : 'table';
      saveListMode();
      renderListInner(c, state.properties);
    });
    // 需求匹配：点击直接弹窗填写需求，保存后自动开启匹配；已开启时弹窗内可退出
    safe('btn-demand', () => { openDemandModal(); });
    // “+ 录入”右侧箭头：导入下拉菜单
    safe('add-toggle', () => {
      const m = document.getElementById('add-menu');
      if (m) m.classList.toggle('hidden');
    });
    const impMenu = document.getElementById('add-menu');
    if (impMenu) impMenu.addEventListener('click', () => impMenu.classList.add('hidden'));
    // 全选 / 取消勾选
    safe('btn-pick-all', () => {
      const set = state.pickMode === 'compare' ? state.selected : state.batchSel;
      (state.filtered || []).forEach((p) => set.add(p.id));
      if (state.pickMode === 'compare') saveCompareSel();
      renderListInner(c, state.properties);
      toast('已勾选当前筛选结果中的 ' + set.size + ' 套房源', true);
    });
    safe('btn-pick-none', () => {
      state.selected.clear(); state.batchSel.clear(); state.pickMode = null;
      saveCompareSel();
      renderListInner(c, state.properties);
      toast('已取消全部勾选', true);
    });
    // 分页
    safe('pg-first', () => { state.page = 1; renderListInner(c, state.properties); });
    safe('pg-last', () => { state.page = Math.max(1, Math.ceil((state.filtered || []).length / state.pageSize)); renderListInner(c, state.properties); });
    safe('pg-prev', () => { state.page = Math.max(1, state.page - 1); renderListInner(c, state.properties); });
    safe('pg-next', () => { state.page = Math.min(Math.max(1, Math.ceil((state.filtered || []).length / state.pageSize)), state.page + 1); renderListInner(c, state.properties); });
    const pgs = document.getElementById('pg-size');
    if (pgs) pgs.onchange = (e) => { state.pageSize = parseInt(e.target.value, 10) || 10; state.page = 1; renderListInner(c, state.properties); };
    const refresh = () => renderListInner(c, state.properties);
    const bindSel = (id, key) => { const el = document.getElementById(id); if (el) el.onchange = (e) => { state.filters[key] = e.target.value; state.page = 1; refresh(); }; };
    const q = document.getElementById('f-q'); if (q) q.oninput = (e) => {
      state.filters.q = e.target.value;
      state.page = 1;
      refresh();
      // 列表会整体重绘，需把焦点与光标还给搜索框，保证可连续输入
      const nq = document.getElementById('f-q');
      if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
      const gs2 = document.getElementById('global-search'); if (gs2) gs2.value = e.target.value;
    };
    bindSel('f-district', 'district'); bindSel('f-platform', 'platform');
    bindSel('f-layout', 'layout'); bindSel('f-orientation', 'orientation'); bindSel('f-floor', 'floor');
    bindSel('f-status', 'status'); bindSel('f-sort', 'sort');
    const cf = document.getElementById('csv-file'); if (cf) cf.onchange = (e) => doImportCsv(e, c);
    // 只看收藏：开关式筛选
    safe('btn-fav-only', () => {
      state.filters.favOnly = !state.filters.favOnly;
      state.page = 1;
      refresh();
      if (state.filters.favOnly && !(state.filtered || []).length) toast('还没有收藏的房源，点卡片上的「☆ 收藏」试试', true);
    });
    // 高级搜索：展开 / 收起 / 应用 / 重置
    safe('btn-adv', () => {
      state.advOpen = !state.advOpen;
      const panel = document.getElementById('adv-panel');
      if (panel) panel.classList.toggle('hidden', !state.advOpen);
    });
    safe('adv-close', () => {
      state.advOpen = false;
      const panel = document.getElementById('adv-panel');
      if (panel) panel.classList.add('hidden');
    });
    safe('adv-apply', () => {
      const gv = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
      const gc = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
      Object.assign(state.filters, {
        q: gv('a-q'), district: gv('a-district'), platform: gv('a-platform'),
        layout: gv('a-layout'), orientation: gv('a-orientation'), floor: gv('a-floor'),
        status: gv('a-status'), decoration: gv('a-decoration'), sort: gv('a-sort') || 'time',
        totalMin: gv('a-totalMin'), totalMax: gv('a-totalMax'),
        areaMin: gv('a-areaMin'), areaMax: gv('a-areaMax'),
        subwayMax: gv('a-subwayMax'), viewingFrom: gv('a-viewingFrom'), viewingTo: gv('a-viewingTo'),
        scoreMin: gv('a-scoreMin'),
        withTransport: gc('a-withTransport'), withSchool: gc('a-withSchool')
      });
      const gs2 = document.getElementById('global-search'); if (gs2) gs2.value = state.filters.q;
      state.advOpen = false; // 应用筛选后收起高级搜索面板
      refresh();
      toast('已应用筛选条件', true);
    });
    safe('adv-reset', () => {
      state.filters = { q: '', district: '', platform: '', status: '', sort: 'time',
        layout: '', orientation: '', floor: '',
        totalMin: '', totalMax: '', areaMin: '', areaMax: '',
        decoration: '', subwayMax: '', viewingFrom: '', viewingTo: '',
        withTransport: false, withSchool: false, scoreMin: '', favOnly: false };
      const gs2 = document.getElementById('global-search'); if (gs2) gs2.value = '';
      refresh();
      toast('筛选条件已重置', true);
    });
    c.querySelectorAll('[data-detail]').forEach((b) => b.onclick = () => renderDetail(c, b.dataset.detail));
    c.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => renderForm(c, b.dataset.edit));
    c.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => doCopy(b.dataset.copy, c));
    c.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => doDelete(b.dataset.del));
    // 卡片「更多」下拉：展开当前、收起其他；点空白处自动收起（document 监听只绑一次）
    c.querySelectorAll('[data-more]').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const menu = b.parentElement.querySelector('.dd-menu');
      if (!menu) return;
      const wasHidden = menu.classList.contains('hidden');
      c.querySelectorAll('.card .dd-menu').forEach((m) => m.classList.add('hidden'));
      if (wasHidden) menu.classList.remove('hidden');
    });
    if (!renderListInner._cardDdDoc) {
      renderListInner._cardDdDoc = true;
      document.addEventListener('click', () => {
        document.querySelectorAll('.card .dd-menu:not(.hidden)').forEach((m) => m.classList.add('hidden'));
      });
    }
    c.querySelectorAll('[data-fav]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.fav;
      try {
        const row = await Store.toggleFavorite(id);
        const idx = state.properties.findIndex((x) => x.id === id);
        if (idx >= 0) state.properties[idx] = row;
        toast(row.favorite ? '★ 已收藏' : '已取消收藏', true);
        renderListInner(c, state.properties);
      } catch (e) { toast('收藏操作失败：' + e.message); }
    });
    c.querySelectorAll('[data-pick]').forEach((b) => b.onclick = (e) => {
      const id = e.target.dataset.pick;
      const set = state.pickMode === 'compare' ? state.selected : state.batchSel;
      if (e.target.checked) set.add(id); else set.delete(id);
      if (state.pickMode === 'compare') saveCompareSel();
      const tb = document.getElementById('to-compare'); if (tb) tb.textContent = '对比选中（' + state.selected.size + '）';
      const bd = document.getElementById('btn-batch-del'); if (bd) bd.textContent = '批量删除(' + state.batchSel.size + ')';
    });
  }

  async function doDelete(id) {
    if (!confirm('确定将这套房源移入回收站？可在“回收站”里恢复')) return;
    try {
      await Store.remove(id); state.selected.delete(id); saveCompareSel();
      const c = $('content'); const fresh = await Store.list(); state.properties = fresh;
      toast('已移入回收站', true); renderListInner(c, fresh);
    } catch (e) { toast('删除失败：' + e.message); }
  }

  // 批量删除（移入回收站）
  async function doBatchDelete(c) {
    if (!state.batchSel.size) { toast('请先在卡片底部勾选“批量”'); return; }
    if (!confirm('确定将选中的 ' + state.batchSel.size + ' 套房源移入回收站？')) return;
    try {
      for (const id of Array.from(state.batchSel)) await Store.remove(id);
      state.batchSel.clear();
      const fresh = await Store.list(); state.properties = fresh;
      toast('已移入回收站', true); renderListInner(c, fresh);
    } catch (e) { toast('删除失败：' + e.message); }
  }

  // 批量修改状态
  const STATUS_OPTS = ['在售', '已售', '已下架', '待看', '已购'];
  async function batchSetStatus(c) {
    if (!state.batchSel.size) { toast('请先在卡片底部勾选“批量”'); return; }
    const s = prompt('将选中房源状态改为（' + STATUS_OPTS.join(' / ') + '）：', '已售');
    if (!s) return;
    const status = s.trim();
    if (!STATUS_OPTS.includes(status)) { toast('状态只能是 ' + STATUS_OPTS.join('/')); return; }
    try {
      for (const id of Array.from(state.batchSel)) {
        const p = state.properties.find((x) => x.id === id); if (!p) continue;
        const row = Object.assign({}, p);
        row.transaction = Object.assign({}, p.transaction, { status });
        await Store.update(id, row);
      }
      state.batchSel.clear();
      const fresh = await Store.list(); state.properties = fresh;
      toast('已更新 ' + state.batchSel.size + ' 套状态为 ' + status, true); renderListInner(c, fresh);
    } catch (e) { toast('更新失败：' + e.message); }
  }

  // 复制为副本
  async function doCopy(id, c) {
    const p = state.properties.find((x) => x.id === id); if (!p) return;
    const copy = {
      title: (p.title || '') + '（副本）',
      location: p.location || {}, attributes: p.attributes || {}, media: p.media || {},
      transaction: p.transaction || {}, facilities: p.facilities || {}, geo: p.geo || null, notes: p.notes || ''
    };
    try { await Store.create(copy); const fresh = await Store.list(); state.properties = fresh; toast('已复制为副本', true); renderListInner(c, fresh); }
    catch (e) { toast('复制失败：' + e.message); }
  }

  // 回收站（已软删除的房源）
  // 打开某套房源的装修档案（临时页，刷新后回到上一次菜单）
  function openRenovation(id, tab, itemId) {
    state.renoPropId = id; state.renoTab = tab || 'confirmed'; state.renoDetailId = itemId || null;
    setView('renovation');
  }
  function openRenoForm(propId, itemId, from, initialName) {
    state.renoPropId = propId; state.renoItemId = itemId || null;
    state.renoFrom = from || 'renovation'; state.renoNewName = initialName || '';
    setView('renovationForm');
  }
  // 装修列表「+ 新增方案」：先选房源和方案名，再进 5 步填写页
  function openRenoNewModal() {
    const modal = $('reno-new-modal'); if (!modal) return;
    const ps = state.properties || [];
    if (!ps.length) { toast('还没有房源，请先在「房源列表」录入一套房源'); return; }
    const sel = $('rnm-prop');
    sel.innerHTML = ps.map((p) => {
      const t = p.title || (p.location && p.location.community) || '未命名房源';
      return `<option value="${esc(p.id)}">${esc(t)}${isPurchased(p) ? '（已购房）' : ''}</option>`;
    }).join('');
    $('rnm-name').value = '';
    const close = () => modal.classList.add('hidden');
    $('rnm-x').onclick = close; $('rnm-cancel').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    $('rnm-apply').onclick = () => {
      if (!sel.value) { toast('请选择房源'); return; }
      const nm = $('rnm-name').value.trim();
      close();
      openRenoForm(sel.value, null, 'renoList', nm);
    };
    modal.classList.remove('hidden');
    setTimeout(() => $('rnm-name').focus(), 60);
  }

  // ---------- 装修档案：字段定义（查看页与填写页共用） ----------
  const RENO_BASIC_FIELDS = [
    { k: 'method', label: '装修方式', type: 'select', opts: RENO_METHODS },
    { k: 'style', label: '装修风格', type: 'select', opts: RENO_STYLES },
    { k: 'status', label: '装修状态', type: 'select', opts: RENO_STATUS },
    { k: 'startDate', label: '开工日期', type: 'date' },
    { k: 'endDate', label: '完工日期', type: 'date' },
    { k: 'area', label: '装修面积(㎡)', type: 'number' },
    { k: 'company', label: '装修公司' }, { k: 'designer', label: '设计师' },
    { k: 'foreman', label: '工长' }, { k: 'phone', label: '联系电话' },
    { k: 'contractNo', label: '合同编号' }, { k: 'layoutChange', label: '户型改动说明', type: 'textarea' }
  ];
  const RENO_BUDGET_FIELDS = [
    { k: 'total', label: '总预算(万)', type: 'number' }, { k: 'spent', label: '已花费(万)', type: 'number' },
    { k: 'hard', label: '硬装(万)', type: 'number' }, { k: 'soft', label: '软装(万)', type: 'number' },
    { k: 'appliance', label: '家电(万)', type: 'number' }, { k: 'design', label: '设计费(万)', type: 'number' },
    { k: 'manage', label: '管理费(万)', type: 'number' }
  ];
  // 付款节点不再是一个大 textarea：改由 budget.payments 数组按行录入 / 展示，见下方表格
  const RENO_MEDIA_META = [
    { k: 'effect', label: '效果图' }, { k: 'construction', label: '施工图' },
    { k: 'contract', label: '报价单 / 合同' }, { k: 'acceptance', label: '验收照片' }
  ];
  const renoFieldLabel = (k) => (RENO_BASIC_FIELDS.concat(RENO_BUDGET_FIELDS).find((f) => f.k === k) || {}).label || k;
  function renoFieldHTML(f, v) {
    const val = v == null ? '' : v, id = 'rf-' + f.k;
    if (f.type === 'select') return `<div class="field"><label>${esc(f.label)}</label><select id="${id}" data-k="${f.k}">${selOpts(f.opts, val)}</select></div>`;
    if (f.type === 'textarea') return `<div class="field full"><label>${esc(f.label)}</label><textarea id="${id}" data-k="${f.k}" style="min-height:64px">${esc(val)}</textarea></div>`;
    return `<div class="field"><label>${esc(f.label)}</label><input id="${id}" data-k="${f.k}" type="${f.type || 'text'}" ${f.type === 'number' ? 'step="0.01"' : ''} value="${esc(val)}" placeholder="${esc(f.ph || '')}"/></div>`;
  }

  // ---------- 装修档案：某条方案的完整 5 步只读视图（已确定页 / 比价记录「查看」共用） ----------
  function renoHasAny(r) {
    const b = r.basic, g = r.budget, m = r.media;
    return RENO_BASIC_FIELDS.concat(RENO_BUDGET_FIELDS).some((f) => b[f.k] != null && b[f.k] !== '' || g[f.k] != null && g[f.k] !== '')
      || (g.payments || []).length || r.materials.length || r.notes || RENO_MEDIA_META.some((mm) => (m[mm.k] || []).length)
      || r.progress.some((x) => x.status !== '未开始' || x.start || x.end || x.cost);
  }
  function renoArchiveHTML(r) {
    const b = r.basic, g = r.budget, m = r.media;
    const kv = (k, v, suffix) => `<div class="kv"><span class="k">${esc(k)}</span><span>${v == null || v === '' ? '—' : esc(v) + (suffix || '')}</span></div>`;
    const fieldRows = (defs, obj) => defs.map((f) => kv(f.label, obj[f.k], f.type === 'number' ? (f.k === 'area' ? ' ㎡' : ' 万') : '')).join('');
    const over = (num(g.spent) != null && num(g.total) != null) ? Math.round((num(g.spent) - num(g.total)) * 100) / 100 : null;
    const phaseRows = r.progress.map((x) => `<tr><td>${esc(x.name || '未命名阶段')}</td><td><span class="rp-st ${x.status === '已完成' ? 'done' : (x.status === '进行中' ? 'doing' : '')}">${esc(x.status || '未开始')}</span></td><td>${esc(x.start || '—')}</td><td>${esc(x.end || '—')}</td><td>${x.cost === '' || x.cost == null ? '—' : esc(x.cost) + ' 万'}</td></tr>`).join('');
    // 付款节点按行展示：一行一个节点，不再挤成一大段文字
    const payRows = (g.payments || []).length
      ? g.payments.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name || '—')}</td><td>${x.ratio === '' || x.ratio == null ? '—' : esc(x.ratio) + ' %'}</td><td>${x.amount === '' || x.amount == null ? '—' : esc(x.amount) + ' 万'}</td><td>${esc(x.date || '—')}</td><td>${esc(x.note || '—')}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted" style="text-align:center;padding:12px">还没有付款节点</td></tr>';
    const payTable = `<div style="margin-top:12px"><div class="muted" style="font-size:12px;margin:0 0 6px">付款节点（按行）</div>
      <div class="reno-table-wrap"><table class="reno-table"><thead><tr><th>#</th><th>节点</th><th>比例</th><th>金额</th><th>计划日期</th><th>备注</th></tr></thead><tbody>${payRows}</tbody></table></div></div>`;
    const matRows = r.materials.length ? r.materials.map((x) => `<tr><td>${esc(x.category || '—')}</td><td>${esc(x.brand || '—')}</td><td>${esc(x.model || '—')}</td><td>${esc(x.qty || '—')}</td><td>${x.unitPrice === '' || x.unitPrice == null ? '—' : esc(x.unitPrice)}</td><td>${x.amount === '' || x.amount == null ? '—' : esc(x.amount)}</td><td>${esc(x.channel || '—')}</td><td>${x.arrived ? '✓ 已到货' : '—'}</td></tr>`).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;padding:14px">还没有主材记录</td></tr>';
    const mediaHtml = RENO_MEDIA_META.map((mm) => `<div class="reno-media"><h4>${esc(mm.label)}</h4>${(m[mm.k] && m[mm.k].length) ? '<div class="media-list lg">' + m[mm.k].map((u) => `<img src="${esc(u)}" alt=""/>`).join('') + '</div>' : '<div class="muted">无</div>'}</div>`).join('');
    return `<div class="detail-grid">
        <div>
          <div class="detail-box" style="margin-bottom:16px"><h3 style="margin-top:0">① 基本信息</h3>${fieldRows(RENO_BASIC_FIELDS, b)}</div>
          <div class="detail-box" style="margin-bottom:16px"><h3 style="margin-top:0">② 预算花费</h3>
            ${fieldRows(RENO_BUDGET_FIELDS, g)}
            ${kv('超支 / 结余(万)', over == null ? '' : over, over != null && over > 0 ? '（已超支）' : '（未超支）')}
            ${payTable}
          </div>
        </div>
        <div>
          <div class="detail-box" style="margin-bottom:16px"><h3 style="margin-top:0">③ 施工进度</h3>
            <div class="reno-table-wrap"><table class="reno-table"><thead><tr><th>阶段</th><th>状态</th><th>开始</th><th>完成</th><th>费用</th></tr></thead><tbody>${phaseRows}</tbody></table></div></div>
          <div class="detail-box" style="margin-bottom:16px"><h3 style="margin-top:0">④ 主材清单</h3>
            <div class="reno-table-wrap"><table class="reno-table"><thead><tr><th>品类</th><th>品牌</th><th>型号</th><th>数量</th><th>单价</th><th>金额</th><th>渠道</th><th>到货</th></tr></thead><tbody>${matRows}</tbody></table></div></div>
          <div class="detail-box" style="margin-bottom:16px"><h3 style="margin-top:0">图片与附件</h3>${mediaHtml}</div>
          <div class="detail-box"><h3 style="margin-top:0">⑤ 踩坑备忘</h3>
            <div class="muted" style="white-space:pre-wrap;font-size:13px;line-height:1.8">${r.notes ? esc(r.notes) : '暂无备注'}</div></div>
        </div>
      </div>`;
  }

  // ---------- 装修信息页：默认只显示「已确定」那条，另有「比价记录」页签 ----------
  async function renderRenovation(c, id) {
    if (!id) { c.innerHTML = '<div class="empty">未指定房源。</div>'; return; }
    c.innerHTML = '<div class="empty">加载中…</div>';
    let p;
    try { p = await Store.get(id); } catch (e) { c.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; return; }
    const list = renoListOf(p);
    const confirmed = list.find((x) => x.confirmed) || null;
    const title = p.title || (p.location && p.location.community) || '房源';
    const fromRenoList = state.lastMenuView === 'renoList';
    const tabs = `<div class="utabs" id="rn-tabs">
      <button class="tab ${state.renoTab === 'confirmed' ? 'active' : ''}" data-rtab="confirmed">已确定方案</button>
      <button class="tab ${state.renoTab === 'quotes' ? 'active' : ''}" data-rtab="quotes">比价记录（${list.length}）</button>
    </div>`;
    const backBtn = `<button class="btn" id="rn-back">${fromRenoList ? '返回装修列表' : '返回详情'}</button>`;
    const viewing = (state.renoTab === 'quotes' && state.renoDetailId) ? list.find((x) => x.id === state.renoDetailId) : null;
    const shownItem = viewing || (state.renoTab === 'confirmed' ? confirmed : null);
    let headHtml, bodyHtml;

    if (state.renoTab === 'quotes' && !viewing) {
      headHtml = `<div class="section-head"><h2>📋 比价记录 · ${esc(title)}</h2>
        <div class="spacer"></div><button class="btn primary" id="rn-add">＋ 加一家报价</button>${backBtn}</div>`;
      if (!list.length) {
        bodyHtml = `<div class="cmp-empty"><div class="cmp-empty-ico">📋</div>
          <h3>还没有比价方案</h3><p>点右上角「加一家报价」，把几家装修公司的报价都记下来，方便横向比较。</p>
          <button class="btn primary" id="rn-add-empty">＋ 加一家报价</button></div>`;
      } else {
        const rows = list.map((it) => {
          const g = it.budget || {}, b = it.basic || {};
          return `<tr>
            <td class="pl-title"><span class="pl-link" data-rq-view="${esc(it.id)}">${esc(renoTitle(it))}</span>
              <span class="pl-sub">${esc(b.company || '未填公司')}</span></td>
            <td>${esc(b.method || '—')} / ${esc(b.style || '—')}</td>
            <td class="pl-num">${g.total != null && g.total !== '' ? esc(g.total) : '—'}</td>
            <td class="pl-num">${g.spent != null && g.spent !== '' ? esc(g.spent) : '—'}</td>
            <td>${esc(b.status || '—')}</td>
            <td>${it.confirmed ? '<span class="tag rf-ok">✅ 已确定</span>' : '<span class="tag st-off">比价中</span>'}</td>
            <td class="pl-ops">
              <button class="op-btn" data-rq-view="${esc(it.id)}">查看</button>
              ${it.confirmed ? '' : `<button class="op-btn" data-rq-confirm="${esc(it.id)}">设为已确定</button>`}
              <button class="op-btn" data-rq-edit="${esc(it.id)}">编辑</button>
              <button class="op-btn op-btn-danger" data-rq-del="${esc(it.id)}">删除</button>
            </td></tr>`;
        }).join('');
        bodyHtml = `<div class="plist-wrap"><table class="plist"><thead><tr>
          <th>方案</th><th>方式 / 风格</th><th>总预算(万)</th><th>已花费(万)</th><th>装修状态</th><th>选定</th><th>操作</th>
          </tr></thead><tbody>${rows}</tbody></table></div>`;
      }
    } else if (!shownItem) {
      headHtml = `<div class="section-head"><h2>✅ 已确定方案 · ${esc(title)}</h2>
        <div class="spacer"></div>${backBtn}</div>`;
      bodyHtml = `<div class="cmp-empty"><div class="cmp-empty-ico">🔨</div>
        <h3>还没有确定用哪家装修</h3>
        <p>这套房目前有 ${list.length} 条比价方案。到「装修列表」或「比价记录」里把选定的那条设为「已确定」，这里就只显示它。</p>
        <button class="btn primary" id="rn-go-list">去装修列表</button>
        <button class="btn" id="rn-go-quotes">查看比价记录</button></div>`;
    } else {
      const r = normalizeRenovation(shownItem);
      headHtml = `<div class="section-head"><h2>${viewing ? '📋 方案详情' : '✅ 已确定方案'} · ${esc(renoTitle(shownItem))}</h2>
        <div class="spacer"></div>
        ${viewing ? '<button class="btn" id="rn-to-quotes">返回比价记录</button>' : ''}
        ${viewing && !viewing.confirmed ? `<button class="btn" id="rn-confirm">设为已确定</button>` : ''}
        <button class="btn primary" id="rn-edit">✏️ 编辑这条方案</button>${backBtn}</div>`;
      bodyHtml = (renoHasAny(r) ? '' : '<div class="notice">这条方案还没填内容，点右上角「编辑这条方案」，按 5 个步骤补充方式、预算、进度、主材和图片。</div>') + renoArchiveHTML(r);
    }
    c.innerHTML = tabs + headHtml + bodyHtml;

    c.querySelectorAll('[data-rtab]').forEach((b) => b.onclick = () => {
      state.renoTab = b.dataset.rtab; state.renoDetailId = null; renderRenovation(c, id);
    });
    const back = $('rn-back');
    if (back) back.onclick = () => {
      if (fromRenoList) { setView('renoList'); return; }
      state.view = state.lastMenuView; renderDetail(c, id);
    };
    const add = () => { state.renoTab = 'quotes'; openRenoForm(id, null, 'renovation'); };
    if ($('rn-add')) $('rn-add').onclick = add;
    if ($('rn-add-empty')) $('rn-add-empty').onclick = add;
    if ($('rn-go-list')) $('rn-go-list').onclick = () => setView('renoList');
    if ($('rn-go-quotes')) $('rn-go-quotes').onclick = () => { state.renoTab = 'quotes'; renderRenovation(c, id); };
    if ($('rn-to-quotes')) $('rn-to-quotes').onclick = () => { state.renoDetailId = null; renderRenovation(c, id); };
    const edit = $('rn-edit');
    if (edit) edit.onclick = () => openRenoForm(id, shownItem.id, 'renovation');
    const cf = $('rn-confirm');
    if (cf) cf.onclick = async () => {
      try { await setConfirmedReno(p, viewing.id); toast('已设为确定的装修方案', true); renderRenovation(c, id); }
      catch (e) { toast('操作失败：' + e.message); }
    };
    c.querySelectorAll('[data-rq-view]').forEach((b) => b.onclick = () => {
      state.renoDetailId = b.dataset.rqView; renderRenovation(c, id);
    });
    c.querySelectorAll('[data-rq-confirm]').forEach((b) => b.onclick = async () => {
      try { await setConfirmedReno(p, b.dataset.rqConfirm); toast('已设为确定的装修方案', true); renderRenovation(c, id); }
      catch (e) { toast('操作失败：' + e.message); }
    });
    c.querySelectorAll('[data-rq-edit]').forEach((b) => b.onclick = () => openRenoForm(id, b.dataset.rqEdit, 'renovation'));
    c.querySelectorAll('[data-rq-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('确定删除这条比价方案？删除后不可恢复。')) return;
      try {
        await saveRenovations(p, renoListOf(p).filter((x) => x.id !== b.dataset.rqDel));
        toast('方案已删除', true); renderRenovation(c, id);
      } catch (e) { toast('删除失败：' + e.message); }
    });
  }

  // ---------- 装修档案：5 步填写页（布局沿用房源录入页：步骤条 + 分步卡片 + 右侧概览） ----------
  async function renderRenovationForm(c, id) {
    if (!id) { c.innerHTML = '<div class="empty">未指定房源。</div>'; return; }
    c.innerHTML = '<div class="empty">加载中…</div>';
    let p;
    try { p = await Store.get(id); } catch (e) { c.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; return; }
    const itemId = state.renoItemId;
    const curItem = itemId ? renoListOf(p).find((x) => x.id === itemId) : null;
    const isNew = !curItem;
    const draft = normalizeRenovation(curItem || emptyRenovation());
    const defaultName = state.renoNewName || (curItem ? curItem.name : '') || '';
    state.renoNewName = '';
    const title = p.title || (p.location && p.location.community) || '房源';
    const backLabel = state.renoFrom === 'renoList' ? '返回装修列表' : '返回装修信息';
    c.innerHTML = `
      <div class="section-head"><h2>${isNew ? '＋ 新增装修方案' : '✏️ 编辑装修方案'} · ${esc(title)}</h2>
        <div class="spacer"></div><button class="btn" id="rf-back">${backLabel}</button></div>
      <div class="form-layout">
        <div class="form-main">
          <div class="step-bar" id="step-bar"></div>
          <div class="card-block" data-step="0"><h3>① 基本信息</h3>
            <div class="form-grid"><div class="field full"><label>方案名称（用于比价区分）</label><input id="rf-name" value="${esc(defaultName)}" placeholder="如：XX装饰 · 全包报价"/></div>${RENO_BASIC_FIELDS.map((f) => renoFieldHTML(f, draft.basic[f.k])).join('')}</div></div>
          <div class="card-block" data-step="1"><h3>② 预算花费</h3>
            <div class="form-grid">${RENO_BUDGET_FIELDS.map((f) => renoFieldHTML(f, draft.budget[f.k])).join('')}</div>
            <p class="muted" style="font-size:12px;margin:10px 0 0">金额单位统一为万元；「超支 / 结余」由已花费减总预算自动计算，不用手填。</p>
            <div style="margin-top:14px"><div class="muted" style="font-size:12px;margin:0 0 6px">付款节点（一行一个节点，可增删）</div>
              <div class="reno-table-wrap"><table class="reno-table"><thead><tr><th>节点名称</th><th>比例(%)</th><th>金额(万)</th><th>计划日期</th><th>备注</th><th></th></tr></thead><tbody id="rf-pay-body"></tbody></table></div>
              <button class="btn" id="rf-pay-add" type="button" style="margin-top:10px">＋ 添加一行</button></div></div>
          <div class="card-block" data-step="2"><h3>③ 施工进度</h3>
            <p class="muted" style="font-size:12px;margin:0 0 10px">按阶段记录状态、起止日期和该项费用；阶段名可以改，也能自己加行 / 删行，右侧概览会自动统计已完成阶段。</p>
            <div class="reno-table-wrap"><table class="reno-table"><thead><tr><th>阶段</th><th>状态</th><th>开始日期</th><th>完成日期</th><th>费用(万)</th><th></th></tr></thead>
              <tbody id="rf-progress"></tbody></table></div>
            <button class="btn" id="rf-progress-add" type="button" style="margin-top:10px">＋ 添加一行</button></div>
          <div class="card-block" data-step="3"><h3>④ 主材清单</h3>
            <div class="reno-table-wrap"><table class="reno-table"><thead><tr><th>品类</th><th>品牌</th><th>型号</th><th>数量</th><th>单价(元)</th><th>金额(元)</th><th>渠道</th><th>到货</th><th></th></tr></thead>
              <tbody id="rf-mat-body"></tbody></table></div>
            <button class="btn" id="rf-mat-add" type="button" style="margin-top:10px">＋ 添加一行</button></div>
          <div class="card-block" data-step="4"><h3>⑤ 图片与备注</h3>
            ${RENO_MEDIA_META.map((mm) => `<div class="reno-upload">
              <label>${esc(mm.label)}</label>
              <div class="dropzone" data-rk="${mm.k}"><input type="file" multiple accept="image/*" hidden/>
                <div class="dz-inner"><div class="dz-t1">点击或拖拽上传${esc(mm.label)}</div><div class="dz-t2">支持多张图片，与房源图片同一条上传通道</div></div></div>
              <div class="rf-thumbs" id="rf-prev-${mm.k}"></div></div>`).join('')}
            <div class="field full" style="margin-top:14px"><label>踩坑备忘 / 经验记录</label>
              <textarea id="rf-notes" style="min-height:110px" placeholder="记录踩过的坑、增项、和工长的沟通结论…">${esc(draft.notes)}</textarea></div>
          </div>
          <div class="form-actions">
            <button class="btn" id="step-prev" type="button">← 上一步</button>
            <button class="btn primary" id="step-next" type="button">下一步 →</button>
            <div style="flex:1"></div>
            <button class="btn" id="cancel-btn" type="button">取消</button>
            <button class="btn primary" id="save-btn" type="button">保存装修信息</button>
          </div>
        </div>
        <aside class="form-aside">
          <div class="info-panel"><div class="ip-head">装修档案概览</div>
            <div class="ip-body"><div id="rf-summary"></div></div></div>
          <div class="info-panel" style="margin-top:16px"><div class="ip-head">填写提示</div>
            <div class="ip-body muted" style="font-size:13px;line-height:1.9">
              · 五个步骤可以点顶部步骤条随时跳，不必一次填完；<br/>
              · 不填的字段留空即可，查看页会显示「—」；<br/>
              · 施工进度、付款节点、主材清单都可增删行；<br/>
              · 图片支持一次选多张，点缩略图右上角 × 可删除；<br/>
              · 保存后回到「装修信息」页查看，随时可以再编辑。
            </div></div>
        </aside>
      </div>`;

    // 步骤条（与房源录入页同一套交互）
    const blocks = Array.from(c.querySelectorAll('.form-main > .card-block[data-step]'));
    const labels = blocks.map((b) => (b.querySelector('h3') ? b.querySelector('h3').textContent : ''));
    let cur = 0;
    const bar = $('step-bar');
    labels.forEach((label, i) => {
      const it = document.createElement('div');
      it.className = 'step-item'; it.dataset.i = i;
      it.innerHTML = `<span class="num">${i + 1}</span><span class="lbl">${esc(label)}</span>`;
      it.onclick = () => goStep(i);
      bar.appendChild(it);
      if (i < labels.length - 1) { const sep = document.createElement('div'); sep.className = 'step-sep'; bar.appendChild(sep); }
    });
    function goStep(n) {
      cur = Math.max(0, Math.min(blocks.length - 1, n));
      blocks.forEach((b, i) => { b.style.display = i === cur ? '' : 'none'; });
      Array.from(bar.children).forEach((el) => {
        if (!el.classList.contains('step-item')) return;
        const i = parseInt(el.dataset.i, 10);
        el.classList.toggle('active', i === cur); el.classList.toggle('done', i < cur);
      });
      $('step-prev').disabled = cur === 0;
      $('step-next').style.display = cur === blocks.length - 1 ? 'none' : '';
    }
    goStep(0);
    $('step-prev').onclick = () => goStep(cur - 1);
    $('step-next').onclick = () => goStep(cur + 1);

    // 施工进度：默认 7 个标准阶段，阶段名可改，且和主材清单一样能增删行
    const paintProgress = () => {
      $('rf-progress').innerHTML = draft.progress.length ? draft.progress.map((x, i) => `<tr>
        <td><input data-pg="${i}" data-f="name" value="${esc(x.name || '')}" placeholder="阶段名称"/></td>
        <td><select data-pg="${i}" data-f="status">${selOpts(RENO_PHASE_STATUS, x.status)}</select></td>
        <td><input type="date" data-pg="${i}" data-f="start" value="${esc(x.start || '')}"/></td>
        <td><input type="date" data-pg="${i}" data-f="end" value="${esc(x.end || '')}"/></td>
        <td><input type="number" step="0.01" data-pg="${i}" data-f="cost" value="${esc(x.cost)}" placeholder="如 2.5"/></td>
        <td><button class="btn sm danger" type="button" data-pdel="${i}" title="删除这一行">×</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:12px">还没有阶段，点下面「添加一行」</td></tr>';
    };
    const onProg = (e) => {
      const el = e.target.closest('[data-pg]'); if (!el) return;
      const i = parseInt(el.dataset.pg, 10);
      if (draft.progress[i]) { draft.progress[i][el.dataset.f] = el.value; refreshSummary(); }
    };
    $('rf-progress').addEventListener('input', onProg);
    $('rf-progress').addEventListener('change', onProg);
    $('rf-progress').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pdel]'); if (!b) return;
      draft.progress.splice(parseInt(b.dataset.pdel, 10), 1);
      paintProgress(); refreshSummary();
    });
    $('rf-progress-add').onclick = () => {
      draft.progress.push(RENO_PHASE_DEFAULT());
      paintProgress(); refreshSummary();
      const last = $('rf-progress').querySelector('tr:last-child input[data-f="name"]');
      if (last) last.focus();
    };
    paintProgress();

    // 付款节点：一行一个节点，可增删行（旧的大段文字已在 normalizeRenovation 里自动拆成行）
    const paintPayments = () => {
      $('rf-pay-body').innerHTML = draft.budget.payments.length ? draft.budget.payments.map((x, i) => `<tr>
        <td><input data-pi="${i}" data-f="name" value="${esc(x.name || '')}" placeholder="如 开工首期"/></td>
        <td><input type="number" step="0.01" data-pi="${i}" data-f="ratio" value="${esc(x.ratio)}" placeholder="30"/></td>
        <td><input type="number" step="0.01" data-pi="${i}" data-f="amount" value="${esc(x.amount)}" placeholder="如 2.04"/></td>
        <td><input type="date" data-pi="${i}" data-f="date" value="${esc(x.date || '')}"/></td>
        <td><input data-pi="${i}" data-f="note" value="${esc(x.note || '')}" placeholder="备注"/></td>
        <td><button class="btn sm danger" type="button" data-pidel="${i}" title="删除这一行">×</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:12px">还没有付款节点，点下面「添加一行」</td></tr>';
    };
    const onPay = (e) => {
      const el = e.target.closest('[data-pi]'); if (!el) return;
      const i = parseInt(el.dataset.pi, 10);
      if (draft.budget.payments[i]) { draft.budget.payments[i][el.dataset.f] = el.value; refreshSummary(); }
    };
    $('rf-pay-body').addEventListener('input', onPay);
    $('rf-pay-body').addEventListener('change', onPay);
    $('rf-pay-body').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pidel]'); if (!b) return;
      draft.budget.payments.splice(parseInt(b.dataset.pidel, 10), 1);
      paintPayments(); refreshSummary();
    });
    $('rf-pay-add').onclick = () => {
      draft.budget.payments.push(RENO_PAY_DEFAULT());
      paintPayments(); refreshSummary();
      const last = $('rf-pay-body').querySelector('tr:last-child input[data-f="name"]');
      if (last) last.focus();
    };
    paintPayments();

    // 主材清单：可增删行
    const paintMaterials = () => {
      $('rf-mat-body').innerHTML = draft.materials.length ? draft.materials.map((x, i) => `<tr>
        <td><select data-mi="${i}" data-f="category">${selOpts(RENO_MATERIAL_CATS, x.category)}</select></td>
        <td><input data-mi="${i}" data-f="brand" value="${esc(x.brand || '')}" placeholder="品牌"/></td>
        <td><input data-mi="${i}" data-f="model" value="${esc(x.model || '')}" placeholder="型号"/></td>
        <td><input data-mi="${i}" data-f="qty" value="${esc(x.qty || '')}" placeholder="数量"/></td>
        <td><input type="number" step="0.01" data-mi="${i}" data-f="unitPrice" value="${esc(x.unitPrice)}"/></td>
        <td><input type="number" step="0.01" data-mi="${i}" data-f="amount" value="${esc(x.amount)}"/></td>
        <td><input data-mi="${i}" data-f="channel" value="${esc(x.channel || '')}" placeholder="购买渠道"/></td>
        <td><input type="checkbox" data-mi="${i}" data-f="arrived" ${x.arrived ? 'checked' : ''}/></td>
        <td><button class="btn sm danger" type="button" data-mdel="${i}" title="删除这一行">×</button></td>
      </tr>`).join('') : '<tr><td colspan="9" class="muted" style="text-align:center;padding:12px">还没有主材记录，点下面「添加一行」</td></tr>';
    };
    const onMat = (e) => {
      const el = e.target.closest('[data-mi]'); if (!el) return;
      const i = parseInt(el.dataset.mi, 10), f = el.dataset.f;
      if (draft.materials[i]) { draft.materials[i][f] = f === 'arrived' ? el.checked : el.value; refreshSummary(); }
    };
    $('rf-mat-body').addEventListener('input', onMat);
    $('rf-mat-body').addEventListener('change', onMat);
    $('rf-mat-body').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mdel]'); if (!b) return;
      draft.materials.splice(parseInt(b.dataset.mdel, 10), 1);
      paintMaterials(); refreshSummary();
    });
    $('rf-mat-add').onclick = () => {
      draft.materials.push({ category: '地板', brand: '', model: '', qty: '', unitPrice: '', amount: '', channel: '', arrived: false });
      paintMaterials(); refreshSummary();
    };
    paintMaterials();

    // 图片：4 类附件，复用 uploadFile 二进制上传
    const paintMedia = () => RENO_MEDIA_META.forEach((mm) => {
      const box = $('rf-prev-' + mm.k); if (!box) return;
      box.innerHTML = (draft.media[mm.k] || []).map((u, i) => `<div class="rf-thumb"><img src="${esc(u)}" alt=""/><button type="button" class="rf-thumb-del" data-rk="${mm.k}" data-ri="${i}" title="删除">×</button></div>`).join('');
    });
    const uploadReno = async (files, key) => {
      if (!files || !files.length) return;
      let ok = 0;
      for (const f of files) {
        try {
          const r = await Store.uploadFile(f, 'reno-' + key);
          if (r.url) { draft.media[key].push(r.url); ok++; }
        } catch (e) { toast('「' + (f.name || '图片') + '」上传失败：' + e.message); }
      }
      paintMedia(); refreshSummary();
      if (ok) toast('已上传 ' + ok + ' 张图片', true);
    };
    c.querySelectorAll('.dropzone[data-rk]').forEach((dz) => {
      const input = dz.querySelector('input[type=file]'), key = dz.dataset.rk;
      dz.onclick = () => input.click();
      input.onchange = () => { uploadReno(input.files, key); input.value = ''; };
      dz.addEventListener('dragover', (e) => e.preventDefault());
      dz.addEventListener('drop', (e) => { e.preventDefault(); uploadReno(e.dataTransfer.files, key); });
    });
    c.querySelectorAll('.rf-thumbs').forEach((box) => box.addEventListener('click', (e) => {
      const b = e.target.closest('.rf-thumb-del'); if (!b) return;
      const arr = draft.media[b.dataset.rk];
      if (arr) { arr.splice(parseInt(b.dataset.ri, 10), 1); paintMedia(); refreshSummary(); }
    }));
    paintMedia();

    // 右侧概览：随输入实时更新
    function refreshSummary() {
      const el = $('rf-summary'); if (!el) return;
      const gv = (k) => { const e2 = $('rf-' + k); return e2 ? num(e2.value) : null; };
      const total = gv('total'), spent = gv('spent');
      const status = $('rf-status') ? $('rf-status').value : '';
      const done = draft.progress.filter((x) => x.status === '已完成').length;
      const pics = RENO_MEDIA_META.reduce((s, mm) => s + (draft.media[mm.k] || []).length, 0);
      const L = (k, v) => `<div class="ip-row"><span class="k">${esc(k)}</span><span class="v">${esc(v || '—')}</span></div>`;
      el.innerHTML = L('房源', title) + L('装修状态', status)
        + L('总预算', total != null ? total + ' 万' : '') + L('已花费', spent != null ? spent + ' 万' : '')
        + L('超支 / 结余', (total != null && spent != null) ? Math.round((spent - total) * 100) / 100 + ' 万' : '')
        + L('已完成阶段', done + ' / ' + draft.progress.length) + L('付款节点', draft.budget.payments.length + ' 条')
        + L('主材记录', draft.materials.length + ' 条') + L('图片附件', pics + ' 张');
    }
    c.querySelectorAll('.form-main input, .form-main select, .form-main textarea').forEach((el) => {
      el.addEventListener('input', refreshSummary); el.addEventListener('change', refreshSummary);
    });
    refreshSummary();

    const goBack = () => {
      state.renoItemId = null;
      setView(state.renoFrom === 'renoList' ? 'renoList' : 'renovation');
    };
    $('rf-back').onclick = goBack;
    $('cancel-btn').onclick = goBack;
    $('save-btn').onclick = async () => {
      const collect = (defs, target) => defs.forEach((f) => {
        const el = $('rf-' + f.k); if (!el) return;
        target[f.k] = f.type === 'number' ? num(el.value) : el.value.trim();
      });
      collect(RENO_BASIC_FIELDS, draft.basic);
      collect(RENO_BUDGET_FIELDS, draft.budget);
      draft.notes = $('rf-notes').value.trim();
      const nameEl = $('rf-name');
      const nm = nameEl ? nameEl.value.trim() : '';
      try {
        // 只替换 attributes.renovations 里的这一条；已购标记 / 装修费用等其它字段原样保留
        const arr = renoListOf(p);
        const payload = {
          name: nm || draft.basic.company || '未命名方案',
          basic: draft.basic, budget: draft.budget, progress: draft.progress,
          materials: draft.materials, media: draft.media, notes: draft.notes
        };
        const stamp = new Date().toISOString().slice(0, 10);
        if (curItem) {
          const i = arr.findIndex((x) => x.id === curItem.id);
          if (i >= 0) arr[i] = Object.assign({}, arr[i], payload);
          else arr.push(Object.assign({ id: curItem.id, confirmed: false, createdAt: stamp }, payload));
        } else {
          arr.push(Object.assign({ id: newRenoId(), confirmed: false, createdAt: stamp }, payload));
        }
        await saveRenovations(p, arr);
        toast(isNew ? '装修方案已新增' : '装修方案已保存', true);
        if (isNew && state.renoFrom !== 'renoList') state.renoTab = 'quotes';
        goBack();
      } catch (e) { toast('保存失败：' + e.message); }
    };
  }

  // ---------- 已购房源列表：与房源列表共用卡片 / 表格与居中逻辑，只保留搜索和视图切换 ----------
  async function renderPurchased(c) {
    c.innerHTML = '<div class="empty">加载中…</div>';
    try { state.properties = await Store.list(); }
    catch (e) { c.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; return; }
    renderPurchasedInner(c, state.properties.filter(isPurchased));
  }
  function renderPurchasedInner(c, all) {
    const q = (state.pQ || '').trim().toLowerCase();
    const shown = all.filter((p) => {
      if (!q) return true;
      const loc = p.location || {}, t = txOf(p);
      return [p.title, loc.community, loc.district, t.houseNumber, t.purchasePrice].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    state.pFiltered = shown;
    const pages = Math.max(1, Math.ceil(shown.length / state.pPageSize));
    if (state.pPage > pages) state.pPage = pages;
    if (state.pPage < 1) state.pPage = 1;
    const items = shown.slice((state.pPage - 1) * state.pPageSize, state.pPage * state.pPageSize);
    const head = `<div class="section-head"><h2>已购房源（${all.length}${shown.length !== all.length ? '，搜索后 ' + shown.length : ''}）</h2>
      <span class="help-q" data-tip="只显示已标记为购入的房源 · 点卡片标题看购房与装修信息">?</span>
      <div class="spacer"></div>
      <input id="p-q" class="tb-in tb-search" placeholder="搜索小区 / 编号 / 购房价" value="${esc(state.pQ)}"/>
      <button class="btn view-mode-btn" id="p-view-mode" title="${state.listMode === 'table' ? '切换为卡片显示' : '切换为列表显示'}">${state.listMode === 'table' ? '▦ 卡片' : '☰ 列表'}</button>
      <button class="btn" id="p-back">返回房源列表</button></div>`;
    const actions = (p) => `<button class="op-btn" data-p-detail="${p.id}">详情</button><button class="op-btn" data-p-reno="${p.id}">装修信息</button>`;
    const body = state.listMode === 'table'
      ? tableHTML(items, { simple: true, showFav: false, actions, statusText: '已购' })
      : '<div class="cards">' + items.map((p) => cardHTML(p, { showFav: false, actions: actions(p), statusText: '已购' })).join('') + '</div>';
    const pager = `<div class="pager">
      <button class="btn" id="pp-first" ${state.pPage <= 1 ? 'disabled' : ''}>首页</button>
      <button class="btn" id="pp-prev" ${state.pPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="pg-info">第 ${state.pPage} / ${pages} 页 · 共 ${shown.length} 套</span>
      <button class="btn" id="pp-next" ${state.pPage >= pages ? 'disabled' : ''}>下一页</button>
      <button class="btn" id="pp-last" ${state.pPage >= pages ? 'disabled' : ''}>末页</button>
      <select id="pp-size" class="tb-in">${[5, 10, 20, 50, 100].map((n) => `<option value="${n}" ${state.pPageSize === n ? 'selected' : ''}>${n} 条/页</option>`).join('')}</select>
    </div>`;
    const empty = !all.length
      ? '<div class="empty">还没有已购房源。去「房源列表」打开某套房源的详情页，点「标记为已购房」即可。</div>'
      : (!shown.length ? '<div class="empty">没有匹配的房源，换个关键词试试。</div>' : '');
    c.innerHTML = head + (empty || body + pager);
    watchCardsCenter();
    const safe = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    safe('p-back', () => setView('list'));
    safe('p-view-mode', () => { state.listMode = state.listMode === 'table' ? 'card' : 'table'; saveListMode(); renderPurchasedInner(c, all); });
    safe('pp-first', () => { state.pPage = 1; renderPurchasedInner(c, all); });
    safe('pp-prev', () => { state.pPage = Math.max(1, state.pPage - 1); renderPurchasedInner(c, all); });
    safe('pp-next', () => { state.pPage = Math.min(pages, state.pPage + 1); renderPurchasedInner(c, all); });
    safe('pp-last', () => { state.pPage = pages; renderPurchasedInner(c, all); });
    const sz = document.getElementById('pp-size');
    if (sz) sz.onchange = (e) => { state.pPageSize = parseInt(e.target.value, 10) || 10; state.pPage = 1; renderPurchasedInner(c, all); };
    const qi = document.getElementById('p-q');
    if (qi) qi.oninput = (e) => {
      state.pQ = e.target.value; state.pPage = 1;
      renderPurchasedInner(c, all);
      const nq = document.getElementById('p-q');
      if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
    };
    c.querySelectorAll('[data-detail], [data-p-detail]').forEach((b) => b.onclick = () => renderDetail(c, b.dataset.detail || b.dataset.pDetail));
    c.querySelectorAll('[data-p-reno]').forEach((b) => b.onclick = () => openRenovation(b.dataset.pReno));
  }

  // ---------- 装修列表：全局平铺，一行一条比价方案 ----------
  async function renderRenoList(c) {
    c.innerHTML = '<div class="empty">加载中…</div>';
    try { state.properties = await Store.list(); }
    catch (e) { c.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; return; }
    renderRenoListInner(c);
  }
  // ---------- 示例装修方案：手动载入 / 一键清除，不自动写库 ----------
  // 数据放在 js/reno-demo.js；示例方案 id 统一 demo_rn_ 前缀，与用户自建方案互不干扰
  const DEMO_PREFIX = 'demo_rn_';
  const isDemoReno = (it) => String((it && it.id) || '').indexOf(DEMO_PREFIX) === 0;
  const demoPlanCount = () => renoRowsOf().filter((r) => isDemoReno(r.it)).length;
  function pickDemoProperty(group, used) {
    const all = (state.properties || []).filter((p) => p && p.id);
    const kws = (group.keywords || []).map(String);
    // 优先按小区名挂到对应房源，其次已购房，最后任意未占用的房源
    return all.find((x) => !used.has(x.id) && kws.some((k) =>
      (String(x.title || '') + ' ' + String((x.location || {}).community || '')).indexOf(k) >= 0))
      || all.find((x) => !used.has(x.id) && isPurchased(x))
      || all.find((x) => !used.has(x.id)) || null;
  }
  async function loadDemoRenos(c) {
    const demo = window.RenoDemo;
    if (!demo || !Array.isArray(demo.groups)) { toast('示例数据未加载，请硬刷新页面'); return; }
    const props = (state.properties || []).filter((p) => p && p.id);
    if (!props.length) { toast('请先添加或导入几条房源，示例方案要挂在房源下面'); return; }
    const used = new Set();
    let added = 0, touched = 0;
    try {
      for (const g of demo.groups.slice(0, props.length)) {
        const p = pickDemoProperty(g, used);
        if (!p) break;
        used.add(p.id);
        const cur = renoListOf(p);
        const hasConfirmed = cur.some((x) => x.confirmed);
        const existing = new Set(cur.map((x) => x.id));
        // 按 id 去重，重复点不会写入第二份；用户已定方案时示例一律不抢「已确定」
        const fresh = (g.plans || []).filter((x) => !existing.has(x.id)).map((x) => {
          const copy = JSON.parse(JSON.stringify(x));
          if (hasConfirmed) copy.confirmed = false;
          return copy;
        });
        if (!fresh.length) continue;
        await saveRenovations(p, cur.concat(fresh));
        added += fresh.length; touched++;
      }
      if (added) toast(`已载入 ${added} 条示例方案（${touched} 套房源），可在右上角一键清除`, true);
      else toast('示例方案已经全部载入过了');
    } catch (e) { toast('载入失败：' + e.message); }
    renderRenoListInner(c);
  }
  async function clearDemoRenos(c) {
    const n = demoPlanCount();
    if (!n) { toast('当前没有示例方案'); return; }
    if (!confirm('确定清除这 ' + n + ' 条示例方案吗？你自己录入的方案不会受影响。')) return;
    try {
      const targets = (state.properties || []).filter((p) => renoListOf(p).some(isDemoReno));
      for (const p of targets) await saveRenovations(p, renoListOf(p).filter((x) => !isDemoReno(x)));
      toast('已清除 ' + n + ' 条示例方案', true);
    } catch (e) { toast('清除失败：' + e.message); }
    renderRenoListInner(c);
  }

  function renderRenoListInner(c) {
    let rows = renoRowsOf();
    const q = (state.renoListQ || '').trim().toLowerCase();
    if (q) rows = rows.filter((x) => [
      x.p.title, x.p.location && x.p.location.community, x.it.name,
      x.it.basic && x.it.basic.company, x.it.basic && x.it.basic.method
    ].join(' ').toLowerCase().indexOf(q) !== -1);
    const pages = Math.max(1, Math.ceil(rows.length / state.renoListPageSize));
    if (state.renoListPage > pages) state.renoListPage = pages;
    if (state.renoListPage < 1) state.renoListPage = 1;
    const items = rows.slice((state.renoListPage - 1) * state.renoListPageSize, state.renoListPage * state.renoListPageSize);
    // 清掉已经不存在的勾选（比如方案被删了）
    Array.from(state.renoCompareSel).forEach((k) => { if (!rows.some((r) => renoKey(r) === k)) state.renoCompareSel.delete(k); });
    const demoCount = demoPlanCount();
    const head = `<div class="section-head"><h2>装修列表（${rows.length} 条方案）</h2>
      <span class="help-q" data-tip="一套房可以记多家报价；勾选 2 条以上点「对比选中」，或把选定的那条设为「已确定」。">?</span>
      <div class="spacer"></div>
      <input id="rl-q" class="tb-in tb-search" placeholder="搜索房源 / 公司 / 方案名" value="${esc(state.renoListQ)}"/>
      <button class="btn" id="rl-compare">⚖️ 对比选中（${state.renoCompareSel.size}）</button>
      <button class="btn" id="rl-demo" title="载入 9 条按 2026 成都家装行情编的演示报价">🧪 载入示例方案</button>
      ${demoCount ? `<button class="btn" id="rl-demo-clear" title="只删示例，不动你自己录入的方案">清除示例（${demoCount}）</button>` : ''}
      <button class="btn primary" id="rl-add">＋ 新增方案</button></div>`;
    const rowHTML = ({ p, it }) => {
      const g = it.budget || {}, b = it.basic || {}, k = renoKey({ p, it });
      const pt = p.title || (p.location && p.location.community) || '未命名房源';
      const area = [p.location && p.location.city, p.location && p.location.district].filter(Boolean).join(' / ');
      return `<tr>
        <td class="pl-pick"><input type="checkbox" data-rc="${esc(k)}" ${state.renoCompareSel.has(k) ? 'checked' : ''}/></td>
        <td class="pl-title"><span class="pl-link" data-rl-detail="${esc(p.id)}" title="查看房源详情">${esc(pt)}</span><span class="pl-sub">${esc(area)}</span></td>
        <td class="pl-title"><span class="pl-link" data-rl-view="${esc(k)}">${esc(renoTitle(it))}</span><span class="pl-sub">${esc(b.company || '未填公司')}</span></td>
        <td>${esc(b.method || '—')} / ${esc(b.style || '—')}</td>
        <td class="pl-num">${g.total != null && g.total !== '' ? esc(g.total) : '—'}</td>
        <td class="pl-num">${g.spent != null && g.spent !== '' ? esc(g.spent) : '—'}</td>
        <td>${esc(b.status || '—')}</td>
        <td>${it.confirmed ? '<span class="tag rf-ok">✅ 已确定</span>' : '<span class="tag st-off">比价中</span>'}</td>
        <td class="pl-ops">
          <button class="op-btn" data-rl-view="${esc(k)}">查看</button>
          ${it.confirmed ? '' : `<button class="op-btn" data-rl-confirm="${esc(k)}">设为已确定</button>`}
          <button class="op-btn" data-rl-edit="${esc(k)}">编辑</button>
          <button class="op-btn op-btn-danger" data-rl-del="${esc(k)}">删除</button>
        </td></tr>`;
    };
    const body = !rows.length
      ? `<div class="cmp-empty"><div class="cmp-empty-ico">🔨</div><h3>还没有装修方案</h3>
          <p>点右上角「＋ 新增方案」，先选房源，再按 5 个步骤记下一家装修公司的报价。多记几家就能比价。<br/>
          想先看效果，可以载入 9 条按 2026 成都家装行情编的演示报价（可一键清除）。</p>
          <button class="btn primary" id="rl-add-empty">＋ 新增方案</button>
          <button class="btn" id="rl-demo-empty" style="margin-left:10px">🧪 载入示例方案</button></div>`
      : `<div class="plist-wrap"><table class="plist"><thead><tr>
          <th class="pl-pick"></th><th>房源</th><th>方案 / 装修公司</th><th>方式 / 风格</th>
          <th>总预算(万)</th><th>已花费(万)</th><th>装修状态</th><th>选定</th><th>操作</th>
        </tr></thead><tbody>${items.map(rowHTML).join('')}</tbody></table></div>`;
    const pager = `<div class="pager">
      <button class="btn" id="rp-first" ${state.renoListPage <= 1 ? 'disabled' : ''}>首页</button>
      <button class="btn" id="rp-prev" ${state.renoListPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="pg-info">第 ${state.renoListPage} / ${pages} 页 · 共 ${rows.length} 条</span>
      <button class="btn" id="rp-next" ${state.renoListPage >= pages ? 'disabled' : ''}>下一页</button>
      <button class="btn" id="rp-last" ${state.renoListPage >= pages ? 'disabled' : ''}>末页</button>
      <select id="rp-size" class="tb-in">${[5, 10, 20, 50, 100].map((n) => `<option value="${n}" ${state.renoListPageSize === n ? 'selected' : ''}>${n} 条/页</option>`).join('')}</select>
    </div>`;
    c.innerHTML = head + body + pager;
    const safe = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    const findRow = (k) => renoRowsOf().find((r) => renoKey(r) === k);
    c.querySelectorAll('[data-rc]').forEach((cb) => cb.onchange = () => {
      const k = cb.dataset.rc;
      if (cb.checked) {
        const pid = k.split('::')[0];
        const existing = Array.from(state.renoCompareSel)[0];
        if (existing && existing.split('::')[0] !== pid) {
          cb.checked = false;
          toast('只能勾选同一房源的方案对比，请先取消其它房源的勾选');
          return;
        }
        state.renoCompareSel.add(k);
      } else {
        state.renoCompareSel.delete(k);
      }
      const btn = $('rl-compare'); if (btn) btn.textContent = '⚖️ 对比选中（' + state.renoCompareSel.size + '）';
    });
    safe('rl-compare', () => {
      if (state.renoCompareSel.size < 2) { toast('请至少勾选 2 条装修方案再对比'); return; }
      state.compareTabFromReno = true; setView('compare');
    });
    const add = () => openRenoNewModal();
    safe('rl-add', add); safe('rl-add-empty', add);
    safe('rl-demo', () => loadDemoRenos(c));
    safe('rl-demo-empty', () => loadDemoRenos(c));
    safe('rl-demo-clear', () => clearDemoRenos(c));
    c.querySelectorAll('[data-rl-view]').forEach((b) => b.onclick = () => {
      const r = findRow(b.dataset.rlView);
      if (r) openRenovation(r.p.id, 'quotes', r.it.id);
    });
    c.querySelectorAll('[data-rl-detail]').forEach((b) => b.onclick = () => renderDetail(c, b.dataset.rlDetail));
    c.querySelectorAll('[data-rl-confirm]').forEach((b) => b.onclick = async () => {
      const r = findRow(b.dataset.rlConfirm); if (!r) return;
      try { await setConfirmedReno(r.p, r.it.id); toast('已设为确定的装修方案', true); renderRenoListInner(c); }
      catch (e) { toast('操作失败：' + e.message); }
    });
    c.querySelectorAll('[data-rl-edit]').forEach((b) => b.onclick = () => {
      const r = findRow(b.dataset.rlEdit);
      if (r) openRenoForm(r.p.id, r.it.id, 'renoList');
    });
    c.querySelectorAll('[data-rl-del]').forEach((b) => b.onclick = async () => {
      const k = b.dataset.rlDel, r = findRow(k); if (!r) return;
      if (!confirm('确定删除「' + renoTitle(r.it) + '」这条比价方案？删除后不可恢复。')) return;
      try {
        await saveRenovations(r.p, renoListOf(r.p).filter((x) => x.id !== r.it.id));
        state.renoCompareSel.delete(k);
        toast('方案已删除', true); renderRenoListInner(c);
      } catch (e) { toast('删除失败：' + e.message); }
    });
    safe('rp-first', () => { state.renoListPage = 1; renderRenoListInner(c); });
    safe('rp-prev', () => { state.renoListPage = Math.max(1, state.renoListPage - 1); renderRenoListInner(c); });
    safe('rp-next', () => { state.renoListPage = Math.min(pages, state.renoListPage + 1); renderRenoListInner(c); });
    safe('rp-last', () => { state.renoListPage = pages; renderRenoListInner(c); });
    const sz = document.getElementById('rp-size');
    if (sz) sz.onchange = (e) => { state.renoListPageSize = parseInt(e.target.value, 10) || 10; state.renoListPage = 1; renderRenoListInner(c); };
    const qi = document.getElementById('rl-q');
    if (qi) qi.oninput = (e) => {
      state.renoListQ = e.target.value; state.renoListPage = 1;
      renderRenoListInner(c);
      const nq = document.getElementById('rl-q');
      if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
    };
  }

  async function renderTrash(c) {
    c.innerHTML = '<div class="empty">加载中…</div>';
    let list;
    try { list = await Store.trash(); } catch (e) { c.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; return; }
    const head = crumb(['看房记录', '回收站']) + `<div class="section-head"><h2>回收站</h2><div class="spacer"></div><button class="btn view-mode-btn" id="trash-view-mode" title="${state.listMode === 'table' ? '切换为卡片显示' : '切换为列表显示'}">${state.listMode === 'table' ? '▦ 卡片' : '☰ 列表'}</button><button class="btn" id="trash-back">返回列表</button></div>`;
    const bindCommon = () => {
      watchCardsCenter();
      const t = document.getElementById('trash-back'); if (t) t.onclick = () => setView('list');
      const v = document.getElementById('trash-view-mode');
      if (v) v.onclick = () => { state.listMode = state.listMode === 'table' ? 'card' : 'table'; saveListMode(); renderTrash(c); };
    };
    if (!list.length) { c.innerHTML = head + '<div class="empty">回收站是空的。</div>'; bindCommon(); return; }
    const trashActions = (p) => `<button class="op-btn" data-restore="${p.id}">恢复</button><button class="op-btn op-btn-danger" data-purge="${p.id}">彻底删除</button>`;
    const body = state.listMode === 'table'
      ? tableHTML(list, { mode: null, showFav: false, showDetail: false, actions: trashActions })
      : '<div class="cards">' + list.map((p) => cardHTML(p, { mode: null, showFav: false, showDetail: false, actions: trashActions(p) })).join('') + '</div>';
    c.innerHTML = head + body;
    bindCommon();
    c.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
      try { await Store.restore(b.dataset.restore); toast('已恢复', true); renderTrash(c); } catch (e) { toast('恢复失败：' + e.message); }
    });
    c.querySelectorAll('[data-purge]').forEach((b) => b.onclick = async () => {
      if (!confirm('彻底删除后不可恢复，确定？')) return;
      try { await Store.purge(b.dataset.purge); toast('已彻底删除', true); renderTrash(c); } catch (e) { toast('删除失败：' + e.message); }
    });
  }

  // ---------- 购房知识（内置文章 + 我的资料库） ----------
  async function renderKnowledge(c) {
    c.innerHTML = '<div class="empty">加载中…</div>';
    let files = [];
    try { files = await Store.knowledgeList(); } catch (e) { files = []; }
    const articles = (window.KNOWLEDGE_ARTICLES || []);
    const cats = [];
    articles.forEach((a) => { if (!cats.includes(a.cat)) cats.push(a.cat); });
    const head = `<div class="section-head"><h2>购房知识</h2><div class="spacer"></div><button class="btn primary" id="kb-new">＋ 新建 / 上传资料</button></div>`;

    const kbCats = `<div class="kb-cats" id="kb-cats">
      <button class="kb-cat active" data-cat="">全部</button>
      ${cats.map((ct) => `<button class="kb-cat" data-cat="${esc(ct)}">${esc(ct)}</button>`).join('')}
    </div>`;

    const builtinHtml = `<div class="kb-section">
      ${kbCats}
      <div class="kb-list" id="kb-list">
        ${articles.map((a) => `<div class="kb-card" data-article="${a.id}" data-cat="${esc(a.cat)}">
          <div class="kb-card-cat">${esc(a.cat)}</div>
          <div class="kb-card-title">${esc(a.title)}</div>
          <div class="kb-card-sum">${esc(a.summary)}</div>
          <div class="kb-card-go">阅读 →</div>
        </div>`).join('')}
      </div>
    </div>`;

    const fmtSize = (n) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : (n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : (n || 0) + ' B');
    const fmtDate = (s) => String(s).slice(0, 10);
    const libHtml = `<div class="kb-section">
      <h3 class="kb-h">📁 我的资料库</h3>
      <p class="muted" style="margin:0 0 10px">上传 PDF / Word / 图片 / 文本等资料，随时在线下载学习；仅当前账号可见，换设备登录仍可访问。</p>
      <div class="dropzone" id="kb-drop">
        <input type="file" id="kb-file" multiple hidden />
        <div class="dz-inner"><div class="dz-ico">📥</div><div class="dz-t1">点击或拖拽文件到此处上传</div><div class="dz-t2">支持 PDF / Word / 图片 / 文本，单个 ≤30MB</div></div>
      </div>
      <div class="kb-files" id="kb-files">
        ${files.length ? files.map((f) => {
          if (f.kind === 'note') {
            const preview = (f.content || '').replace(/\s+/g, ' ').slice(0, 60);
            return `<div class="kb-file" data-id="${f.id}" data-kind="note">
              <div class="kb-file-ico">📝</div>
              <div class="kb-file-main">
                <div class="kb-file-name" title="${esc(f.title)}">${esc(f.title)}</div>
                <div class="kb-file-meta">${preview ? esc(preview) + '…' : '空白笔记'} · ${fmtDate(f.created_at)}</div>
              </div>
              <div class="kb-file-acts">
                <button class="btn sm" data-kb-view="${f.id}">查看</button>
                <button class="btn sm danger" data-kb-del="${f.id}">删除</button>
              </div>
            </div>`;
          }
          return `<div class="kb-file" data-id="${f.id}" data-kind="file">
            <div class="kb-file-ico">${fileIcon(f.filename)}</div>
            <div class="kb-file-main">
              <div class="kb-file-name" title="${esc(f.filename)}">${esc(f.title || f.filename)}</div>
              <div class="kb-file-meta">${esc(f.filename)} · ${fmtSize(f.size || 0)} · ${fmtDate(f.created_at)}</div>
            </div>
            <div class="kb-file-acts">
              <button class="btn sm" data-kb-down="${f.id}" data-name="${esc(f.filename)}">下载</button>
              <button class="btn sm danger" data-kb-del="${f.id}">删除</button>
            </div>
          </div>`;
        }).join('') : '<div class="empty">还没有资料，上传第一份吧。</div>'}
      </div>
    </div>`;

    c.innerHTML = head + builtinHtml + libHtml;

    // 文章分类筛选
    const kbList = $('kb-list');
    c.querySelectorAll('#kb-cats .kb-cat').forEach((b) => b.onclick = () => {
      c.querySelectorAll('#kb-cats .kb-cat').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const cat = b.dataset.cat;
      kbList.querySelectorAll('.kb-card').forEach((card) => { card.style.display = (!cat || card.dataset.cat === cat) ? '' : 'none'; });
    });
    // 打开文章阅读器
    c.querySelectorAll('.kb-card').forEach((card) => card.onclick = () => {
      const a = articles.find((x) => x.id === card.dataset.article);
      if (a) openKbReader(a);
    });

    // 上传（点击 + 拖拽）
    const drop = $('kb-drop'); const fileInput = $('kb-file');
    drop.onclick = () => fileInput.click();
    fileInput.onchange = () => { if (fileInput.files) handleKbFiles(fileInput.files, c); fileInput.value = ''; };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'dragend'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('dragover')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files) handleKbFiles(e.dataTransfer.files, c);
    });

    // 下载 / 删除
    c.querySelectorAll('[data-kb-down]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); downloadKnowledge(b.dataset.kbDown, b.dataset.name); });
    c.querySelectorAll('[data-kb-del]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('删除该资料？此操作不可恢复。')) return;
      try { await Store.knowledgeDelete(b.dataset.kbDel); toast('已删除', true); renderKnowledge(c); } catch (err) { toast('删除失败：' + err.message); }
    });
    // 笔记「查看」
    c.querySelectorAll('[data-kb-view]').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const n = files.find((x) => x.id === b.dataset.kbView);
      if (n) openNoteModal('view', n);
    });

    // 顶部「新建 / 上传资料」→ 选择面板
    $('kb-new').onclick = () => $('kb-new-modal').classList.remove('hidden');
    $('kb-new-close').onclick = () => $('kb-new-modal').classList.add('hidden');
    $('kb-new-modal').onclick = (e) => { if (e.target === $('kb-new-modal')) $('kb-new-modal').classList.add('hidden'); };
    $('kb-choose-file').onclick = () => { $('kb-new-modal').classList.add('hidden'); $('kb-file').click(); };
    $('kb-choose-note').onclick = () => { $('kb-new-modal').classList.add('hidden'); openNoteModal('create'); };

    // 笔记弹窗
    $('kb-note-close').onclick = () => closeNoteModal();
    $('kb-note-cancel').onclick = () => closeNoteModal();
    $('kb-note-save').onclick = () => saveNote(c);
    $('kb-note-modal').onclick = (e) => { if (e.target === $('kb-note-modal')) closeNoteModal(); };

    // 阅读器关闭（✕ 或点遮罩）
    $('kb-close').onclick = () => closeKbReader();
    $('kb-modal').onclick = (e) => { if (e.target === $('kb-modal')) closeKbReader(); };
  }

  function closeKbReader() {
    const m = $('kb-modal');
    m.classList.remove('open');
    setTimeout(() => m.classList.add('hidden'), 280);
  }

  function openNoteModal(mode, note) {
    const m = $('kb-note-modal');
    const view = mode === 'view';
    $('kb-note-title-label').textContent = view ? '查看笔记' : '新建笔记';
    $('kb-note-title').value = (view && note) ? (note.title || '') : '';
    $('kb-note-content').value = (view && note) ? (note.content || '') : '';
    $('kb-note-title').readOnly = view;
    $('kb-note-content').readOnly = view;
    $('kb-note-save').style.display = view ? 'none' : '';
    $('kb-note-cancel').textContent = view ? '关闭' : '取消';
    m.classList.remove('hidden');
    if (!view) setTimeout(() => $('kb-note-title').focus(), 50);
  }
  function closeNoteModal() { $('kb-note-modal').classList.add('hidden'); }
  async function saveNote(c) {
    const title = $('kb-note-title').value.trim();
    const content = $('kb-note-content').value.trim();
    if (!title) { toast('请填写标题'); return; }
    if (!content) { toast('请填写内容'); return; }
    try {
      await Store.knowledgeCreateNote(title, content);
      toast('已保存笔记', true);
      closeNoteModal();
      renderKnowledge(c);
    } catch (e) { toast('保存失败：' + e.message); }
  }

  function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return '📕';
    if (ext === 'doc' || ext === 'docx') return '📘';
    if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return '📗';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return '🖼️';
    if (ext === 'txt' || ext === 'md') return '📝';
    return '📄';
  }

  async function handleKbFiles(fileList, c) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const f of files) {
      if (f.size > 30 * 1024 * 1024) { toast('「' + f.name + '」超过 30MB，已跳过'); continue; }
      try {
        const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
        const title = f.name.replace(/\.[^.]+$/, '');
        await Store.knowledgeUpload(dataUrl, f.name, title);
        toast('已上传：' + f.name, true);
      } catch (e) { toast('上传失败：' + f.name + ' ' + e.message); }
    }
    renderKnowledge(c);
  }

  function downloadKnowledge(id, filename) {
    const tk = Api.token();
    fetch('/api/knowledge/' + encodeURIComponent(id) + '/file', { headers: { Authorization: 'Bearer ' + tk } })
      .then((res) => { if (!res.ok) throw new Error('下载失败（HTTP ' + res.status + '）'); return res.blob(); })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename || 'download';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })
      .catch((e) => toast(e.message));
  }

  function openKbReader(article) {
    $('kb-title').textContent = article.title;
    $('kb-body').innerHTML = article.html;
    const m = $('kb-modal');
    m.classList.remove('hidden');
    requestAnimationFrame(() => m.classList.add('open'));
  }

  // 导出 CSV
  function doExportCsv() {
    const list = state.properties;
    if (!list.length) { toast('没有可导出的数据'); return; }
    downloadCsv('看房记录_' + new Date().toISOString().slice(0, 10) + '.csv', toCsv(list));
    toast('已导出 ' + list.length + ' 条', true);
  }

  // 导入 CSV
  async function doImportCsv(e, c) {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) { toast('CSV 无有效数据行'); return; }
    try { const inserted = await Store.batch(rows); toast('已导入 ' + inserted.length + ' 条', true); renderList(c); }
    catch (err) { toast('导入失败：' + err.message); }
  }

  // 评分权重设置（弹窗：5 个滑块 + 数字，实时合计；影响评分与排序）
  const WEIGHT_META = [
    { k: 'subway', label: '地铁' },
    { k: 'school', label: '学区' },
    { k: 'age', label: '楼龄' },
    { k: 'layout', label: '户型朝向' },
    { k: 'price', label: '价格' }
  ];
  const WEIGHT_DEFAULT = { subway: 30, school: 20, age: 15, layout: 20, price: 15 };
  // ---------- 购房需求弹窗（列表页「需求匹配」入口：直接填写并保存） ----------
  function openDemandModal() {
    const modal = $('demand-modal');
    if (!modal) { // 兜底：无弹窗节点时跳设置页
      toast('请先在「设置 → 购房需求」填写你的意向要求');
      setView('profile');
      return;
    }
    const cur = (state.user && state.user.demand) || {};
    const setV = (id, v) => { const el = $(id); if (el) el.value = v; };
    setV('dm-budgetMax', cur.budgetMax != null ? cur.budgetMax : '');
    setV('dm-districts', cur.districts || '');
    setV('dm-layout', cur.layout || '');
    setV('dm-areaMin', cur.areaMin != null ? cur.areaMin : '');
    setV('dm-areaMax', cur.areaMax != null ? cur.areaMax : '');
    const sub = $('dm-subway'); if (sub) sub.checked = !!cur.needSubway;
    const sch = $('dm-school'); if (sch) sch.checked = !!cur.needSchool;
    setV('dm-notes', cur.notes || '');
    const ex = $('dm-exit');
    if (ex) ex.classList.toggle('hidden', !state.demandMatch);
    modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');
    $('dm-x').onclick = close;
    $('dm-cancel').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    if (ex) ex.onclick = () => {
      state.demandMatch = false; state.page = 1; close();
      if (state.view === 'list') renderListInner($('content'), state.properties);
      toast('已退出需求匹配', true);
    };
    $('dm-apply').onclick = async () => {
      // 最晚提醒配置不经过弹窗，原样保留，避免整体覆盖时丢失
      const demand = {
        budgetMax: parseFloat($('dm-budgetMax').value) || '',
        districts: $('dm-districts').value.trim(),
        layout: $('dm-layout').value.trim(),
        areaMin: parseFloat($('dm-areaMin').value) || '',
        areaMax: parseFloat($('dm-areaMax').value) || '',
        needSubway: $('dm-subway').checked,
        needSchool: $('dm-school').checked,
        notes: $('dm-notes').value.trim(),
        deadlineEnabled: !!cur.deadlineEnabled,
        deadlineDate: cur.deadlineDate || ''
      };
      try {
        const r = await Api.updateProfile({ demand });
        state.user = r.data.user;
        Api.setSession(Api.token(), state.user);
        applyAmapKey();
        state.demandMatch = true; state.page = 1;
        close();
        if (state.view === 'list') renderListInner($('content'), state.properties);
        toast('已保存需求并开启匹配（≥40 分）；后续可在「设置 → 购房需求」中查看和修改', true);
      } catch (e) { toast('保存失败：' + e.message); }
    };
  }

  function openWeightsModal() {
    const modal = $('weights-modal');
    const grid = $('wm-grid');
    if (!modal || !grid) { // 兜底：无弹窗节点时用 prompt
      const w = state.weights;
      const input = prompt('设置评分权重（地铁,学区,楼龄,户型朝向,价格），如 30,20,15,20,15：', [w.subway, w.school, w.age, w.layout, w.price].join(','));
      if (!input) return;
      const parts = input.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      if (parts.length !== 5) { toast('需要 5 个权重，用逗号分隔'); return; }
      state.weights = { subway: parts[0], school: parts[1], age: parts[2], layout: parts[3], price: parts[4] };
      if (state.view === 'list') renderListInner($('content'), state.properties);
      return;
    }
    const cur = (k) => (state.weights[k] != null ? state.weights[k] : WEIGHT_DEFAULT[k]);
    grid.innerHTML = WEIGHT_META.map((m) => `
      <div class="wm-row">
        <label>${m.label}</label>
        <input type="range" min="0" max="60" step="1" id="wm-${m.k}" data-k="${m.k}" value="${cur(m.k)}"/>
        <input type="number" min="0" max="100" id="wm-${m.k}-n" data-k="${m.k}" value="${cur(m.k)}"/>
      </div>`).join('');
    const sumEl = $('wm-sum');
    const syncSum = () => {
      let s = 0; WEIGHT_META.forEach((m) => { const v = parseInt($('wm-' + m.k).value, 10) || 0; s += v; });
      sumEl.textContent = s;
    };
    // 同步自定义轨道的已填充比例（--wm-fill），让蓝色段跟随滑块数值
    const syncFill = (r) => {
      const min = parseFloat(r.min) || 0, max = parseFloat(r.max) || 100;
      const pct = Math.max(0, Math.min(100, ((parseFloat(r.value) || 0) - min) / (max - min || 1) * 100));
      r.style.setProperty('--wm-fill', pct + '%');
    };
    grid.querySelectorAll('input[type=range]').forEach((r) => {
      syncFill(r);
      r.oninput = () => { const n = $('wm-' + r.dataset.k + '-n'); if (n) n.value = r.value; syncFill(r); syncSum(); };
    });
    grid.querySelectorAll('input[type=number]').forEach((n) => n.oninput = () => { const r = $('wm-' + n.dataset.k); if (r) { r.value = n.value; syncFill(r); } syncSum(); });
    syncSum();
    modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');
    $('wm-close').onclick = close;
    $('wm-cancel').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    $('wm-reset').onclick = () => { WEIGHT_META.forEach((m) => { const r = $('wm-' + m.k), n = $('wm-' + m.k + '-n'); if (r) { r.value = WEIGHT_DEFAULT[m.k]; syncFill(r); } if (n) n.value = WEIGHT_DEFAULT[m.k]; }); syncSum(); };
    $('wm-apply').onclick = () => {
      const w = {}; WEIGHT_META.forEach((m) => { w[m.k] = parseInt($('wm-' + m.k).value, 10) || 0; });
      state.weights = w;
      close();
      toast('评分权重已更新，可在“综合评分”排序查看', true);
      if (state.view === 'list') renderListInner($('content'), state.properties);
    };
  }

  // ---------- 一键导入示例数据 ----------
  async function doSeed() {
    if (!confirm('将向当前账号写入 5 条成都示例房源，确定继续？')) return;
    const btn = document.getElementById('seed-demo');
    if (btn) { btn.disabled = true; btn.textContent = '导入中…'; }
    try {
      const inserted = await Store.seed();
      toast('已导入 ' + inserted.length + ' 条示例房源', true);
      renderList($('content'));
    } catch (e) {
      toast('导入失败：' + e.message);
    } finally {
      const b = document.getElementById('seed-demo');
      if (b) { b.disabled = false; b.textContent = '导入示例数据'; }
    }
  }

  // ---------- 地图 + 通勤分析 ----------
  function fmtCommuteDur(s) { if (s == null) return '—'; const m = Math.round(s / 60); if (m < 60) return m + ' 分'; const h = Math.floor(m / 60); return h + ' 时' + (m % 60) + ' 分'; }
  function fmtCommuteDist(m) { if (m == null) return '—'; return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m'; }

  async function renderMap(c) {
    // 未启用 / 未配置 Key：不尝试加载在线地图，直接给出引导 + 一键进设置
    if (!mapEnabled() || !Geo.hasKey()) {
      const off = !mapEnabled();
      c.innerHTML = crumb(['看房记录', '地图分布']) +
        '<div class="section-head"><h2>地图分布</h2></div>' +
        '<div class="map-guide">' +
          '<div class="mg-ico">' + (off ? '🗺️' : '🔑') + '</div>' +
          '<h3>' + (off ? '地图功能尚未启用' : '尚未配置高德地图 Key') + '</h3>' +
          '<p>' + (off
            ? '地图分布、房源定位、周边配套和通勤分析默认关闭。请到「设置 → 高德地图 Key」填好自己的 Key，并点击「启用地图功能」后才会显示菜单。'
            : '地图功能已启用，但还没有配置高德 JS API Key 与安全密钥。请到「设置 → 高德地图 Key」完成配置，在线地图才能显示。') +
          '</p>' +
          '<button class="btn primary" id="map-go-settings">前往设置配置</button>' +
        '</div>';
      const gb = $('map-go-settings');
      if (gb) gb.onclick = () => setView('profile');
      return;
    }
    const dest = state.commuteDest;
    c.innerHTML = `
      ${crumb(['看房记录', '地图分布'])}
      <div class="section-head"><h2>地图分布</h2><div class="spacer"></div>
        <span class="muted">共 ${state.properties.length} 套，已定位 ${state.properties.filter((p) => p.geo && p.geo.lng).length} 套</span>
      </div>
      <div class="commute-bar">
        <input id="commute-dest" placeholder="地址，如：天府三街 / 春熙路 / 公司地址（可算通勤或查周边）" value="${dest ? esc(dest.name) : ''}"/>
        <button class="btn primary" id="commute-go">计算通勤</button>
        <button class="btn" id="sr-go">📍 查看周边配套</button>
        <button class="btn" id="commute-clear">清除路线</button>
        ${!Geo.hasKey() ? '<span class="muted">（需配置高德 Key 才能画路线/查周边）</span>' : ''}
      </div>
      <div id="commute-panel" class="commute-panel hidden"></div>
      <div id="map-big"></div>`;
    const pts = state.properties
      .filter((p) => p.geo && p.geo.lng)
      .map((p) => ({
        id: p.id,
        title: p.title || (p.location && p.location.community) || '未命名',
        sub: [p.location && p.location.city, p.location && p.location.district, p.attributes && p.attributes.layout, p.transaction && p.transaction.totalPrice ? p.transaction.totalPrice + '万' : ''].filter(Boolean).join(' · '),
        geo: p.geo
      }));
    // 先绑按钮：地图可能要等高德脚本加载几秒，期间按钮也该能点
    const go = $('commute-go'); if (go) go.onclick = () => runCommute(c);
    const clr = $('commute-clear'); if (clr) clr.onclick = () => { state.commuteDest = null; state.commuteResult = {}; renderMap(c); };
    // 复用同一个地址输入框：按输入地址查看周边配套（不依赖已录入房源的坐标）
    const srGo = $('sr-go'); if (srGo) srGo.onclick = () => openSurroundByAddress();
    state._map = await HVMap.renderMulti($('map-big'), pts, (p) => renderDetail($('content'), p.id));
    if (dest && state._map && Geo.hasKey()) runCommute(c, true);
  }

  // 通勤分析：对每个有坐标的房源，用高德驾车路线算耗时/距离并画彩色路线
  async function runCommute(c, silent) {
    if (!Geo.hasKey()) { toast('未配置高德 Key，无法计算通勤路线'); return; }
    const map = state._map; if (!map) { toast('地图尚未就绪'); return; }
    const input = $('commute-dest');
    const destName = (input && input.value.trim()) || (state.commuteDest && state.commuteDest.name);
    if (!destName) { toast('请先输入通勤终点'); return; }
    const btn = $('commute-go');
    if (btn && !silent) { btn.disabled = true; btn.textContent = '计算中…'; }
    try {
      const AMap = await Geo.ensureAmap();
      const dest = await Geo.geocode(destName, '成都');
      state.commuteDest = { lng: dest.lng, lat: dest.lat, name: destName };
      if (typeof AMap.Driving !== 'function') {
        await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Driving 插件加载超时')), 8000); AMap.plugin('AMap.Driving', () => { clearTimeout(t); res(); }); });
      }
      map.clearMap();
      const driving = new AMap.Driving({});
      const palette = ['#2f6bff', '#18a058', '#e5484d', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];
      const targets = state.properties.filter((p) => p.geo && p.geo.lng);
      const results = [];
      let idx = 0;
      for (const p of targets) {
        const rr = await new Promise((resolve) => {
          driving.search([p.geo.lng, p.geo.lat], [dest.lng, dest.lat], (status, r) => {
            if (status === 'complete' && r.routes && r.routes[0]) {
              const route = r.routes[0];
              const path = []; (route.steps || []).forEach((s) => { (s.path || []).forEach((pt) => path.push([pt.lng, pt.lat])); });
              resolve({ distance: route.distance, duration: route.time, path });
            } else resolve({ distance: null, duration: null, path: [] });
          });
        });
        results.push({ p, distance: rr.distance, duration: rr.duration });
        const color = palette[idx % palette.length];
        if (rr.path && rr.path.length) {
          map.add(new AMap.Polyline({ path: rr.path, strokeColor: color, strokeWeight: 5, strokeOpacity: 0.85, showDir: true }));
          map.add(new AMap.Marker({ position: [p.geo.lng, p.geo.lat], title: (p.title || '') + ' · 驾车 ' + fmtCommuteDur(rr.duration) }));
        } else {
          map.add(new AMap.Marker({ position: [p.geo.lng, p.geo.lat], title: (p.title || '') + '（路线未找到）' }));
        }
        idx++;
      }
      map.add(new AMap.Marker({ position: [dest.lng, dest.lat], content: '<div style="background:#e5484d;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3)">终点 ' + esc(destName) + '</div>', offset: new AMap.Pixel(-30, -14) }));
      map.setFitView();
      state.commuteResult = {}; results.forEach((r) => { state.commuteResult[r.p.id] = { distance: r.distance, duration: r.duration }; });
      renderCommutePanel(results, destName);
      toast('通勤分析完成，已按耗时排序', true);
    } catch (e) {
      toast('通勤计算失败：' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '计算通勤'; }
    }
  }

  function renderCommutePanel(results, destName) {
    const panel = $('commute-panel'); if (!panel) return;
    const sorted = results.slice().sort((a, b) => (a.duration == null ? 1e12 : a.duration) - (b.duration == null ? 1e12 : b.duration));
    let html = '<div class="section-head" style="margin-bottom:8px"><h3 style="margin:0;font-size:15px">通勤结果（终点：' + esc(destName) + '，按驾车耗时排序）</h3></div>';
    html += '<table><thead><tr><th>#</th><th>房源</th><th>区域</th><th>距离</th><th>驾车耗时</th></tr></thead><tbody>';
    sorted.forEach((r, i) => {
      const loc = r.p.location || {};
      html += '<tr><td>' + (i + 1) + '</td><td>' + esc(r.p.title || loc.community || '未命名') + '</td><td>' + esc(loc.district || '') + '</td><td>' + fmtCommuteDist(r.distance) + '</td><td>' + fmtCommuteDur(r.duration) + '</td></tr>';
    });
    html += '</tbody></table>';
    panel.innerHTML = html; panel.classList.remove('hidden');
  }

  // ---------- 对比 ----------
  function renderCompare(c) {
    const tabs = `<div class="hv-tabs flush" id="cmp-tabs">
      <button class="tab ${state.compareTab === 'property' ? 'active' : ''}" data-ctab="property">⚖️ 房源对比</button>
      <button class="tab ${state.compareTab === 'renovation' ? 'active' : ''}" data-ctab="renovation">🔨 装修对比</button>
    </div>`;
    const bindCTabs = () => c.querySelectorAll('[data-ctab]').forEach((b) => b.onclick = () => {
      state.compareTab = b.dataset.ctab; renderCompare(c);
    });
    if (state.compareTab === 'renovation') { renderRenoCompare(c, tabs, bindCTabs); return; }
    const items = state.properties.filter((p) => state.selected.has(p.id));
    if (items.length < 2) {
      c.innerHTML = crumb(['看房记录', '房源对比']) + tabs + `<div class="cmp-empty">
        <div class="cmp-empty-ico">⚖️</div>
        <h3>还没有可对比的房源</h3>
        <p>请在房源列表里勾选至少 2 套房源，再回来查看横向对比。</p>
        <button class="btn primary" id="cmp-pick">去选择对比房源</button>
      </div>`;
      bindCTabs();
      const pick = document.getElementById('cmp-pick');
      if (pick) pick.onclick = () => {
        if (!(state.properties || []).length) { toast('还没有房源，请先点「+ 录入」添加房源'); return; }
        state.pickMode = 'compare'; // 直接把列表切到「勾选对比」模式
        setView('list');
        toast('请勾选至少 2 套房源，再点顶部「对比选中」查看对比');
      };
      return;
    }
    const fac = (p, k) => { const v = p.facilities && p.facilities[k]; return v ? '<span class="yes">✓</span>' : '<span class="no">—</span>'; };
    const rows = [
      ['综合评分', (p) => '<b>' + computeScore(p) + '</b>'],
      ['房源状态', (p) => (p.transaction && p.transaction.status) || '在售'],
      ['来源平台', (p) => (p.transaction && p.transaction.sourcePlatform) || '—'],
      ['最近地铁', (p) => {
        const loc = p.location || {};
        return [loc.subwayStation, loc.subwayDistance != null ? loc.subwayDistance + ' m' : ''].filter(Boolean).join(' · ') || '—';
      }],
      ['看房日期', (p) => (p.transaction && p.transaction.viewingDate) || '—'],
      ['城市/区域', (p) => [p.location && p.location.city, p.location && p.location.district].filter(Boolean).join(' / ') || '—'],
      ['小区', (p) => (p.location && p.location.community) || '—'],
      ['详细地址', (p) => (p.location && p.location.address) || '—'],
      ['户型', (p) => (p.attributes && p.attributes.layout) || '—'],
      ['面积(㎡)', (p) => (p.attributes && p.attributes.area) != null ? p.attributes.area : '—'],
      ['朝向', (p) => (p.attributes && p.attributes.orientation) || '—'],
      ['楼层', (p) => (p.attributes && p.attributes.floor) || '—'],
      ['总价(万)', (p) => (p.transaction && p.transaction.totalPrice) != null ? p.transaction.totalPrice : '—'],
      ['单价(元/㎡)', (p) => (p.transaction && p.transaction.unitPrice) != null ? p.transaction.unitPrice : '—'],
      ['中介', (p) => [p.transaction && p.transaction.agentName, p.transaction && p.transaction.agentPhone].filter(Boolean).join(' ') || '—'],
      ['交通', (p) => fac(p, 'transport')],
      ['商超', (p) => fac(p, 'supermarket')],
      ['学校', (p) => fac(p, 'school')],
      ['医院', (p) => fac(p, 'hospital')],
      ['水/电/燃气', (p) => { const f = p.facilities || {}; return (f.water ? '水' : '') + (f.electricity ? '电' : '') + (f.gas ? '气' : '') || '—'; }],
      ['配套备注', (p) => (p.facilities && p.facilities.notes) || '—'],
      ['备注', (p) => p.notes || '—']
    ];
    let html = crumb(['看房记录', '房源对比']) + tabs + '<div class="section-head"><h2>房源对比（' + items.length + '）</h2><div class="spacer"></div>' +
      '<button class="btn" id="cmp-clear">清空选择</button></div><div style="overflow:auto"><table class="cmp-table"><thead><tr><th>字段</th>';
    items.forEach((p) => { html += '<th>' + esc(p.title || (p.location && p.location.community) || '未命名') + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(([label, fn]) => {
      html += '<tr><td>' + esc(label) + '</td>';
      items.forEach((p) => { html += '<td>' + fn(p) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div><div id="map-big" style="height:360px;margin-top:16px"></div>';
    c.innerHTML = html;
    bindCTabs();
    $('cmp-clear').onclick = () => { state.selected.clear(); setView('list'); };
    const pts = items.filter((p) => p.geo && p.geo.lng).map((p) => ({ id: p.id, title: p.title || (p.location && p.location.community), sub: '', geo: p.geo }));
    HVMap.renderMulti($('map-big'), pts);
  }

  // ---------- 装修对比页签：装修列表勾选的 2+ 条方案横向比 ----------
  function renderRenoCompare(c, tabs, bindCTabs) {
    const rowsAll = renoRowsOf();
    const sel = rowsAll.filter((r) => state.renoCompareSel.has(renoKey(r)));
    if (sel.length < 2) {
      c.innerHTML = crumb(['看房记录', '房源对比']) + tabs + `<div class="cmp-empty">
        <div class="cmp-empty-ico">🔨</div>
        <h3>还没有可对比的装修方案</h3>
        <p>请到「装修列表」勾选至少 2 条报价方案，再点「对比选中」。</p>
        <button class="btn primary" id="rc-pick">去装修列表选择</button>
      </div>`;
      bindCTabs();
      const pick = $('rc-pick');
      if (pick) pick.onclick = () => setView('renoList');
      return;
    }
    const cell = (v, suffix) => (v == null || v === '' ? '—' : esc(v) + (suffix || ''));
    const sumMat = (it) => it.materials.reduce((s, x) => s + (num(x.amount) || 0), 0);
    const doneCnt = (it) => it.progress.filter((x) => x.status === '已完成').length;
    const rows = [
      ['所属房源', (it, p) => esc(p.title || (p.location && p.location.community) || '未命名房源')],
      ['方案名称', (it) => esc(renoTitle(it))],
      ['是否已确定', (it) => it.confirmed ? '<span class="tag rf-ok">✅ 已确定</span>' : '<span class="tag st-off">比价中</span>'],
      ['装修公司', (it) => cell(it.basic && it.basic.company)],
      ['装修方式', (it) => cell(it.basic && it.basic.method)],
      ['装修风格', (it) => cell(it.basic && it.basic.style)],
      ['装修状态', (it) => cell(it.basic && it.basic.status)],
      ['装修面积', (it) => cell(it.basic && it.basic.area, ' ㎡')],
      ['开工日期', (it) => cell(it.basic && it.basic.startDate)],
      ['完工日期', (it) => cell(it.basic && it.basic.endDate)],
      ['设计师 / 工长', (it) => cell([it.basic && it.basic.designer, it.basic && it.basic.foreman].filter(Boolean).join(' / '))],
      ['联系电话', (it) => cell(it.basic && it.basic.phone)],
      ['总预算(万)', (it) => cell(it.budget && it.budget.total)],
      ['已花费(万)', (it) => cell(it.budget && it.budget.spent)],
      ['超支 / 结余(万)', (it) => {
        const t = num(it.budget && it.budget.total), s = num(it.budget && it.budget.spent);
        return (t != null && s != null) ? esc(Math.round((s - t) * 100) / 100) : '—';
      }],
      ['硬装(万)', (it) => cell(it.budget && it.budget.hard)],
      ['软装(万)', (it) => cell(it.budget && it.budget.soft)],
      ['家电(万)', (it) => cell(it.budget && it.budget.appliance)],
      ['设计费(万)', (it) => cell(it.budget && it.budget.design)],
      ['管理费(万)', (it) => cell(it.budget && it.budget.manage)],
      ['付款节点', (it) => {
        const ps = (it.budget && it.budget.payments) || [];
        const line = ps.map((x) => [
          x.name,
          (x.ratio !== '' && x.ratio != null) ? x.ratio + '%' : '',
          (x.amount !== '' && x.amount != null) ? x.amount + '万' : ''
        ].filter(Boolean).join(' · ')).filter(Boolean).join(' / ');
        return cell(line || (it.budget && it.budget.paymentNodes));
      }],
      ['施工完成阶段', (it) => doneCnt(it) + ' / ' + it.progress.length],
      ['主材记录', (it) => it.materials.length + ' 条'],
      ['主材金额合计(元)', (it) => sumMat(it) ? esc(Math.round(sumMat(it) * 100) / 100) : '—'],
      ['图片附件', (it) => RENO_MEDIA_META.reduce((s, mm) => s + ((it.media && it.media[mm.k]) || []).length, 0) + ' 张'],
      ['踩坑备忘', (it) => cell(it.notes)]
    ];
    let html = crumb(['看房记录', '房源对比']) + tabs +
      `<div class="section-head"><h2>装修对比（${sel.length}）</h2><div class="spacer"></div>
        <button class="btn" id="rc-clear">清空选择</button>
        <button class="btn" id="rc-back">返回装修列表</button></div>
      <div style="overflow:auto"><table class="cmp-table"><thead><tr><th>字段</th>`;
    sel.forEach((r) => { html += '<th>' + esc(renoTitle(r.it)) + '<div class="muted" style="font-weight:normal;font-size:12px">' + esc(r.p.title || (r.p.location && r.p.location.community) || '') + '</div></th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(([label, fn]) => {
      html += '<tr><td>' + esc(label) + '</td>';
      sel.forEach((r) => { html += '<td>' + fn(r.it, r.p) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    c.innerHTML = html;
    bindCTabs();
    $('rc-clear').onclick = () => { state.renoCompareSel.clear(); renderCompare(c); };
    $('rc-back').onclick = () => setView('renoList');
  }

  // ---------- 录入 / 编辑 ----------
  async function renderForm(c, id) {
    state.editing = id || null;
    // 从「已购房源」列表的详情页进来编辑时，保存/取消应回到已购房源而不是房源列表
    const formBack = MENU_VIEWS.indexOf(state.lastMenuView) !== -1 ? state.lastMenuView : 'list';
    renderPageName('form');
    state.formGeo = null;
    let p = { location: {}, attributes: {}, media: {}, transaction: {}, facilities: {} };
    if (id) {
      try { p = await Store.get(id); state.formGeo = p.geo || null; }
      catch (e) { toast('读取失败：' + e.message); return; }
    }
    const loc = p.location || {}, attr = p.attributes || {}, media = p.media || {}, tran = p.transaction || {}, fac = p.facilities || {};
    const fm = {
      images: [...(media.images || [])], videos: [...(media.videos || [])],
      floorPlans: [...(media.floorPlans || [])], environment: [...(media.environment || [])]
    };
    const chk = (v) => v ? 'checked' : '';

    c.innerHTML = `
      <div class="section-head">
        ${crumb(['看房记录', id ? '编辑房源' : '录入房源'])}
        <div class="spacer"></div><button class="btn" id="back-list">返回列表</button></div>
      ${!Geo.hasKey() ? '<div class="warn">提示：当前未配置高德 Key，地图与自动定位不可用；你仍可填写其余字段，位置稍后在配置了 Key 后补，或用下方“点击地图补点”（需 Key）。</div>' : ''}
      <div class="form-layout">
        <div class="form-main">
          <div class="step-bar" id="step-bar"></div>
          <div class="card-block" data-step="0">
            <h3>基础信息</h3>
            <div class="ai-bar">
              <label>📋 智能粘贴解析（粘贴房源文字，一键提取字段）</label>
              <textarea id="f-ai" placeholder="例如：天府新区 滨江和城 3室2厅 89㎡ 总价168万 单价1.88万/㎡ 朝南 中楼层 中介王经理13800001111"></textarea>
              <div class="ai-row">
                <button class="btn" id="ai-parse" type="button">⚡ 智能解析并填充</button>
                <button class="btn primary" id="ai-extract-btn" type="button">🤖 AI 智能录入</button>
                <span class="muted">本地规则解析，无需联网；解析后可继续手动微调。</span>
              </div>
            </div>
            <div class="form-grid">
              <div class="field"><label>城市</label><input id="f-city" value="${esc(loc.city || '成都')}"/></div>
              <div class="field"><label>区域</label><input id="f-district" value="${esc(loc.district || '')}"/></div>
              <div class="field"><label>小区名称</label><input id="f-community" value="${esc(loc.community || '')}"/></div>
              <div class="field"><label>详细地址 / 位置描述</label><input id="f-address" value="${esc(loc.address || '')}"/></div>
              <div class="field"><label>最近地铁站</label><input id="f-subway-station" value="${esc(loc.subwayStation || '')}"/></div>
              <div class="field"><label>地铁距离(米)</label><input id="f-subway-dist" type="number" value="${loc.subwayDistance != null ? esc(loc.subwayDistance) : ''}"/></div>
            </div>
          </div>
          <div class="card-block" data-step="1">
            <div class="loc-head">
              <h3>位置标注</h3>
              <div class="spacer"></div>
              <button class="btn primary" id="auto-locate" type="button">🔍 自动在地图标注</button>
              <button class="btn" id="btn-map-zoom" type="button">⛶ 放大地图</button>
              <span class="coord" id="coord-text"></span>
            </div>
            <div id="form-map" class="amap-mini"></div>
            <div class="muted" style="font-size:12px;margin-top:4px">提示：点“自动标注”按小区名定位；定位不准或失败时，可直接在上方地图点击修正位置，或点“放大地图”精细标注。</div>
          </div>
          <div class="card-block" data-step="2">
            <h3>户型与建筑</h3>
            <div class="form-grid">
              <div class="field"><label>户型布局</label><input id="f-layout" value="${esc(attr.layout || '')}" placeholder="如 3室2厅2卫"/></div>
              <div class="field"><label>面积(㎡)</label><input id="f-area" type="number" value="${attr.area != null ? esc(attr.area) : ''}"/></div>
              <div class="field"><label>朝向</label><input id="f-orientation" value="${esc(attr.orientation || '')}"/></div>
              <div class="field"><label>楼层</label><input id="f-floor" value="${esc(attr.floor || '')}"/></div>
              <div class="field"><label>建成年代</label><input id="f-built" type="number" value="${attr.builtYear != null ? esc(attr.builtYear) : ''}" placeholder="如 2018"/></div>
              <div class="field"><label>装修情况</label><input id="f-dec" value="${esc(attr.decoration || '')}" placeholder="精装/简装/毛坯"/></div>
              <div class="field"><label>是否装修</label><select id="f-renovated">
                <option value="" ${attr.renovated == null ? 'selected' : ''}>（未填写）</option>
                <option value="yes" ${attr.renovated === true ? 'selected' : ''}>已装修</option>
                <option value="no" ${attr.renovated === false ? 'selected' : ''}>未装修</option>
              </select></div>
              <div class="field"><label>装修大概费用(万)</label><input id="f-renocost" type="number" step="0.01" value="${attr.renovationCost != null ? esc(attr.renovationCost) : ''}" placeholder="如 18"/></div>
              <div class="field"><label>电梯</label><input id="f-elevator" value="${esc(attr.elevator || '')}" placeholder="有/无"/></div>
              <div class="field"><label>车位</label><input id="f-parking" value="${esc(attr.parking || '')}" placeholder="有/无"/></div>
              <div class="field"><label>房屋性质</label><select id="f-ptype">
                ${['','商品房','安置房','自建房','公寓','法拍房','经济适用房'].map((s)=>`<option value="${s}" ${(attr.propertyType||'')===s?'selected':''}>${s||'（未选择）'}</option>`).join('')}
              </select></div>
              <div class="field"><label>小区新旧</label><select id="f-cage">
                ${['','新小区（≤5年）','次新小区（5-10年）','老小区（>10年）'].map((s)=>`<option value="${s}" ${(attr.communityAge||'')===s?'selected':''}>${s||'（未选择）'}</option>`).join('')}
              </select></div>
              <div class="field"><label>物业费(元/㎡·月)</label><input id="f-propfee" type="number" step="0.01" value="${attr.propertyFee != null ? esc(attr.propertyFee) : ''}" placeholder="如 2.8"/></div>
            </div>
          </div>
          <div class="card-block" data-step="3">
            <h3>交易信息</h3>
            <div class="form-grid">
              <div class="field"><label>总价(万)</label><input id="f-total" type="number" value="${tran.totalPrice != null ? esc(tran.totalPrice) : ''}"/></div>
              <div class="field"><label>单价(元/㎡)</label><input id="f-unit" type="number" value="${tran.unitPrice != null ? esc(tran.unitPrice) : ''}"/></div>
              <div class="field"><label>中介姓名</label><input id="f-agent" value="${esc(tran.agentName || '')}"/></div>
              <div class="field"><label>中介电话</label><input id="f-phone" value="${esc(tran.agentPhone || '')}"/></div>
              <div class="field"><label>微信</label><input id="f-wechat" value="${esc(tran.wechat || '')}"/></div>
              <div class="field"><label>来源平台</label><input id="f-platform" value="${esc(tran.sourcePlatform || '')}" placeholder="链家/贝壳/安居客/个人"/></div>
              <div class="field"><label>房源编号</label><input id="f-houseno" value="${esc(tran.houseNumber || '')}"/></div>
              <div class="field"><label>房源状态</label><select id="f-status">
                ${['在售','已售','已下架'].map((s)=>`<option ${tran.status===s?'selected':''}>${s}</option>`).join('')}
              </select></div>
              <div class="field"><label>看房日期</label><input id="f-viewdate" type="date" value="${esc(tran.viewingDate || '')}"/></div>
              <div class="field"><label>税费(万)</label><input id="f-tax" type="number" value="${tran.tax != null ? esc(tran.tax) : ''}"/></div>
              <div class="field"><label>首付(万)</label><input id="f-down" type="number" value="${tran.downPayment != null ? esc(tran.downPayment) : ''}"/></div>
              <div class="field"><label>月供(元)</label><input id="f-monthly" type="number" value="${tran.monthlyPayment != null ? esc(tran.monthlyPayment) : ''}"/></div>
              <div class="field"><label>产权状态</label><select id="f-ownership">
                ${['','产权清晰','按揭中','抵押中','查封','共有产权','其他'].map((s)=>`<option value="${s}" ${(tran.ownership||'')===s?'selected':''}>${s||'（未选择）'}</option>`).join('')}
              </select></div>
              <div class="field"><label>是否可贷款</label><select id="f-loanable">
                ${['','可贷','不可贷'].map((s)=>`<option value="${s}" ${(tran.loanable||'')===s?'selected':''}>${s||'（未选择）'}</option>`).join('')}
              </select></div>
              <div class="field"><label>贷款方式</label><select id="f-loantype">
                ${['','公积金贷款','商业贷款（商贷）','组合贷（公积金+商贷）','全款'].map((s)=>`<option value="${s}" ${(tran.loanType||'')===s?'selected':''}>${s||'（未选择）'}</option>`).join('')}
              </select></div>
              <div class="field"><label>组合贷公积金占比(%)</label><input id="f-gfund" type="number" min="0" max="100" value="${tran.gfundRatio != null ? esc(tran.gfundRatio) : ''}" placeholder="仅组合贷填写，如 60"/></div>
              <div class="field"><label>贷款年限(年)</label><input id="f-loanyears" type="number" min="1" max="30" value="${tran.loanYears != null ? esc(tran.loanYears) : ''}" placeholder="如 30"/></div>
              <div class="field"><label>还款方式</label><select id="f-repayment">
                ${['','等额本息','等额本金','先息后本','其他'].map((s)=>`<option value="${s}" ${(tran.repayment||'')===s?'selected':''}>${s||'（未选择）'}</option>`).join('')}
              </select></div>
            </div>
          </div>
          <div class="card-block" data-step="4">
            <h3>配套设施</h3>
            <div class="checks">
              <label><input type="checkbox" id="f-transport" ${chk(fac.transport)}/>交通</label>
              <label><input type="checkbox" id="f-supermarket" ${chk(fac.supermarket)}/>商超</label>
              <label><input type="checkbox" id="f-school" ${chk(fac.school)}/>学校</label>
              <label><input type="checkbox" id="f-hospital" ${chk(fac.hospital)}/>医院</label>
              <label><input type="checkbox" id="f-water" ${chk(fac.water)}/>水</label>
              <label><input type="checkbox" id="f-electricity" ${chk(fac.electricity)}/>电</label>
              <label><input type="checkbox" id="f-gas" ${chk(fac.gas)}/>燃气</label>
            </div>
            <div class="form-grid" style="margin-top:10px">
              <div class="field"><label>学区 / 对口学校</label><input id="f-schoolinfo" value="${esc(fac.schoolInfo || '')}" placeholder="如 XX小学（优质）/ 无"/></div>
              <div class="field"><label>配套备注</label><input id="f-facnotes" value="${esc(fac.notes || '')}"/></div>
            </div>
          </div>
          <div class="card-block" data-step="5">
            <h3>附件资料</h3>
            <div class="sub-label">图片 / 视频</div>
            <div class="dropzone" data-key="images" data-accept="image/*">
              <input type="file" accept="image/*" multiple hidden />
              <div class="dz-inner"><div class="dz-ico">🖼️</div><div class="dz-t1">点击或拖拽图片到此处上传</div><div class="dz-t2">支持多选，JPG / PNG 等</div></div>
            </div>
            <div class="mp-grid empty" id="img-preview"></div>
            <div class="dz-gap"></div>
            <div class="dropzone" data-key="videos" data-accept="video/*">
              <input type="file" accept="video/*" multiple hidden />
              <div class="dz-inner"><div class="dz-ico">🎬</div><div class="dz-t1">点击或拖拽视频到此处上传</div><div class="dz-t2">支持多选，MP4 / WebM 等</div></div>
            </div>
            <div class="mp-grid empty" id="video-preview"></div>
            <div class="dz-gap"></div>
            <div class="sub-label">户型图</div>
            <div class="dropzone" data-key="floorPlans" data-accept="image/*">
              <input type="file" accept="image/*" multiple hidden />
              <div class="dz-inner"><div class="dz-ico">📐</div><div class="dz-t1">点击或拖拽户型图到此处上传</div><div class="dz-t2">支持多选，JPG / PNG 等</div></div>
            </div>
            <div class="mp-grid empty" id="floor-preview"></div>
            <div class="dz-gap"></div>
            <div class="sub-label">小区环境图</div>
            <div class="dropzone" data-key="environment" data-accept="image/*">
              <input type="file" accept="image/*" multiple hidden />
              <div class="dz-inner"><div class="dz-ico">🌳</div><div class="dz-t1">点击或拖拽小区环境图到此处上传</div><div class="dz-t2">支持多选，JPG / PNG 等</div></div>
            </div>
            <div class="mp-grid empty" id="env-preview"></div>
          </div>
          <div class="card-block" data-step="6">
            <h3>备注</h3>
            <div class="form-grid one">
              <div class="field full"><textarea id="f-notes">${esc(p.notes || '')}</textarea></div>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn" id="step-prev" type="button">← 上一步</button>
            <button class="btn primary" id="step-next" type="button">下一步 →</button>
            <div style="flex:1"></div>
            <button class="btn" id="cancel-btn" type="button">取消</button>
            <button class="btn primary" id="save-btn" type="button">${id ? '保存修改' : '保存房源'}</button>
          </div>
        </div>
        <aside class="form-aside">
          <div class="info-panel">
            <div class="ip-head">录入信息</div>
            <div class="hv-tabs">
              <div class="tab active" id="tab-overview">概览</div>
              <div class="tab" id="tab-tips">填写提示</div>
            </div>
            <div class="ip-body" id="ip-overview">
              <div class="ip-row"><span class="k">录入人</span><span class="v">${esc((state.user && (state.user.name || state.user.email)) || '—')}</span></div>
              <div class="ip-row"><span class="k">录入时间</span><span class="v">${new Date().toLocaleString('zh-CN')}</span></div>
              <div class="ip-row"><span class="k">状态</span><span class="v" id="ip-status"></span></div>
              <div class="ip-summary" id="ip-summary"></div>
            </div>
            <div class="ip-body hidden" id="ip-tips">
              <div class="muted" style="font-size:13px;line-height:1.9">
                · 填好「小区名称」后点「自动在地图标注」即可真实定位；<br/>
                · 定位不准可直接在地图上点击修正，或点「放大地图」精标；<br/>
                · 可把经纪人房源文字整段粘贴到顶部「智能粘贴解析」一键填充；<br/>
                · 图片 / 户型图 / 环境图请直接上传附件（点击缩略图右上角 × 可删除）；<br/>
                · 信息越完整，综合评分越准确。
              </div>
            </div>
          </div>
        </aside>
      </div>
      <div class="map-modal hidden" id="map-modal">
        <div class="map-modal-box" id="map-modal-box">
          <div class="map-modal-head">
            <span class="t">放大地图 · 点击地图标记准确位置（右下角可拖动调整大小）</span>
            <div class="mm-ops">
              <button class="btn" id="map-modal-max" type="button">⛶ 全屏</button>
              <button class="btn" id="map-modal-close" type="button">关闭</button>
            </div>
          </div>
          <div id="big-map" class="big-map"></div>
          <div class="map-resize" id="map-resize" title="拖动可调整大小"></div>
        </div>
      </div>`;

    $('back-list').onclick = () => setView(formBack);
    $('cancel-btn').onclick = () => setView(formBack);

    function showCoord() {
      const g = state.formGeo;
      $('coord-text').textContent = g && g.lng ? `经度 ${g.lng.toFixed(5)}，纬度 ${g.lat.toFixed(5)}（来源：${g.source || '未知'}）${g.formattedAddress ? ' · ' + g.formattedAddress : ''}` : '尚未定位';
    }
    showCoord();

    // ---------- 横向步骤条（按分组分步，右侧录入信息面板始终可见） ----------
    const stepBlocks = Array.from(document.querySelectorAll('.form-main > .card-block[data-step]'));
    const STEP_LABELS = stepBlocks.map((b) => (b.querySelector('h3') ? b.querySelector('h3').textContent : ''));
    let curStep = 0;
    let formMap = null;
    function markStepBar() {
      Array.from($('step-bar').children).forEach((el) => {
        if (!el.classList || !el.classList.contains('step-item')) return;
        const i = parseInt(el.dataset.i, 10);
        el.classList.toggle('active', i === curStep);
        el.classList.toggle('done', i < curStep);
      });
    }
    function buildStepBar() {
      const bar = $('step-bar'); bar.innerHTML = '';
      STEP_LABELS.forEach((label, i) => {
        const item = document.createElement('div');
        item.className = 'step-item'; item.dataset.i = i;
        item.innerHTML = `<span class="num">${i + 1}</span><span class="lbl">${esc(label)}</span>`;
        item.onclick = () => goStep(i);
        bar.appendChild(item);
        if (i < STEP_LABELS.length - 1) { const sep = document.createElement('div'); sep.className = 'step-sep'; bar.appendChild(sep); }
      });
    }
    async function ensureFormMap() {
      const mc = $('form-map'); if (!mc) return;
      if (!Geo.hasKey()) { mc.innerHTML = '<div class="empty">未配置高德 Key，无法显示在线地图。</div>'; return; }
      const g = state.formGeo;
      formMap = await HVMap.renderSingle(mc, g && g.lng, g && g.lat, {
        onClick: (lo, la) => { state.formGeo = { lng: lo, lat: la, source: 'manual' }; showCoord(); }
      });
      setTimeout(() => { try { if (formMap && formMap.resize) formMap.resize(); } catch (e) {} }, 60);
    }
    function goStep(n) {
      curStep = Math.max(0, Math.min(stepBlocks.length - 1, n));
      stepBlocks.forEach((b, i) => { b.style.display = i === curStep ? '' : 'none'; });
      markStepBar();
      const prev = $('step-prev'), next = $('step-next');
      if (prev) prev.disabled = curStep === 0;
      if (next) next.style.display = curStep === stepBlocks.length - 1 ? 'none' : '';
      if (curStep === 1) ensureFormMap();
      window.dispatchEvent(new Event('resize'));
    }
    buildStepBar();
    goStep(0);
    $('step-prev').onclick = () => goStep(curStep - 1);
    $('step-next').onclick = () => goStep(curStep + 1);

    // 放大地图：弹窗大地图，可拖动右下角调整大小
    const modal = $('map-modal');
    const closeModal = () => { if (modal) modal.classList.add('hidden'); };
    $('btn-map-zoom').onclick = () => {
      if (!modal) return;
      modal.classList.remove('hidden');
      const box = $('map-modal-box');
      box.style.width = ''; box.style.height = '';
      HVMap.renderSingle($('big-map'), state.formGeo && state.formGeo.lng, state.formGeo && state.formGeo.lat, {
        onClick: (lo, la) => {
          state.formGeo = { lng: lo, lat: la, source: 'manual' };
          showCoord();
          toast('已在放大地图上标记位置', true);
        }
      }).then((m) => { bigMap = m; });
    };
    $('map-modal-close').onclick = closeModal;
    if (modal) modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    // 全屏 / 还原
    $('map-modal-max').onclick = () => {
      const box = $('map-modal-box');
      if (!box) return;
      const maximized = box.classList.toggle('max');
      if (maximized) { box.style.width = ''; box.style.height = ''; }
      else { box.style.width = ''; box.style.height = ''; }
      setTimeout(() => { try { if (bigMap && typeof bigMap.resize === 'function') bigMap.resize(); } catch (e) {} window.dispatchEvent(new Event('resize')); }, 60);
    };
    // 右下角拖拽调整大小
    const handle = $('map-resize');
    if (handle) handle.addEventListener('mousedown', (e) => {
      const box = $('map-modal-box');
      if (!box) return;
      const r = box.getBoundingClientRect();
      rz.dragging = true; rz.x = e.clientX; rz.y = e.clientY; rz.w = r.width; rz.h = r.height;
      e.preventDefault(); e.stopPropagation();
    });

    $('auto-locate').onclick = async () => {
      const city = $('f-city').value.trim();
      const text = [$('f-community').value, $('f-district').value, $('f-address').value].filter(Boolean).join(' ');
      if (!text) { toast('请先填写小区名称或地址'); return; }
      const btn = $('auto-locate'); btn.disabled = true; btn.textContent = '定位中…';
      try {
        const r = await Geo.geocode(text, city);
        state.formGeo = { lng: r.lng, lat: r.lat, source: r.source, formattedAddress: r.formattedAddress };
        showCoord();
        formMap = await HVMap.renderSingle($('form-map'), r.lng, r.lat, {
          onClick: (lo, la) => { state.formGeo = { lng: lo, lat: la, source: 'manual' }; showCoord(); }
        });
        toast('已自动定位' + (r.source === 'local' ? '（本地库兜底，坐标为近似）' : ''), true);
      } catch (e) {
        toast('自动定位失败：' + e.message + '，请在地图上点击补点');
        formMap = await HVMap.renderSingle($('form-map'), null, null, {
          onClick: (lo, la) => { state.formGeo = { lng: lo, lat: la, source: 'manual' }; showCoord(); }
        });
      } finally { btn.disabled = false; btn.textContent = '🔍 自动在地图标注'; }
    };

    // 智能解析：粘贴文字 -> 回填表单
    $('ai-parse').onclick = () => {
      const text = $('f-ai').value.trim();
      if (!text) { toast('请先粘贴房源文字'); return; }
      const r = parseAiText(text);
      if (r.location.community) $('f-community').value = r.location.community;
      if (r.location.district) $('f-district').value = r.location.district;
      if (r.location.address) $('f-address').value = r.location.address;
      if (r.attributes.layout) $('f-layout').value = r.attributes.layout;
      if (r.attributes.area != null) $('f-area').value = r.attributes.area;
      if (r.attributes.orientation) $('f-orientation').value = r.attributes.orientation;
      if (r.attributes.floor) $('f-floor').value = r.attributes.floor;
      if (r.transaction.totalPrice != null) $('f-total').value = r.transaction.totalPrice;
      if (r.transaction.unitPrice != null) $('f-unit').value = r.transaction.unitPrice;
      if (r.transaction.agentName) $('f-agent').value = r.transaction.agentName;
      if (r.transaction.agentPhone) $('f-phone').value = r.transaction.agentPhone;
      toast('已解析填充，可继续手动微调', true);
    };

    // ===== AI 智能录入（文本 / 截图 / 链接 → 大模型抽取字段）=====
    (function bindAIExtract() {
      let aieImages = [];
      const aieModal = $('aie-modal');
      window.__aieFields = null;
      $('ai-extract-btn').onclick = () => {
        $('aie-text').value = '';
        $('aie-url').value = '';
        $('aie-files').value = '';
        $('aie-previews').innerHTML = '';
        $('aie-result').classList.add('hidden');
        $('aie-status').textContent = '';
        $('aie-warn').innerHTML = '';
        aieImages = [];
        aieModal.classList.remove('hidden');
      };
      $('aie-x').onclick = () => aieModal.classList.add('hidden');
      $('aie-cancel').onclick = () => aieModal.classList.add('hidden');
      $('aie-files').onchange = (e) => {
        const files = Array.from(e.target.files || []);
        aieImages = [];
        $('aie-previews').innerHTML = '';
        files.forEach((f) => {
          if (!f.type || !f.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = () => {
            aieImages.push(reader.result);
            const img = document.createElement('img');
            img.src = reader.result;
            img.className = 'aie-thumb';
            $('aie-previews').appendChild(img);
          };
          reader.readAsDataURL(f);
        });
      };
      $('aie-run').onclick = async () => {
        const text = $('aie-text').value.trim();
        const url = $('aie-url').value.trim();
        if (!text && !url && !aieImages.length) { toast('请至少提供文字、链接或截图'); return; }
        $('aie-status').textContent = '识别中…';
        $('aie-run').disabled = true;
        try {
          const r = await Api.post('/api/ai/extract', { text, url, images: aieImages });
          const d = r.data || {};
          window.__aieFields = d.fields || {};
          renderAIResult(d.fields || {}, d.warnings || []);
          $('aie-result').classList.remove('hidden');
        } catch (err) {
          toast('识别失败：' + (err.message || err));
        } finally {
          $('aie-status').textContent = '';
          $('aie-run').disabled = false;
        }
      };
      $('aie-fill').onclick = () => {
        fillFormFromExtracted(window.__aieFields || {});
        aieModal.classList.add('hidden');
      };
      function renderAIResult(f, warnings) {
        const loc = f.location || {}, attr = f.attributes || {}, tran = f.transaction || {};
        const rows = [
          ['城市', loc.city], ['区域', loc.district], ['小区', loc.community], ['地址', loc.address],
          ['户型', attr.layout], ['面积(㎡)', attr.area], ['朝向', attr.orientation], ['楼层', attr.floor],
          ['总价(万)', tran.totalPrice], ['单价(元/㎡)', tran.unitPrice],
          ['中介', tran.agentName], ['电话', tran.agentPhone], ['微信', tran.wechat],
          ['来源平台', tran.sourcePlatform], ['房源编号', tran.houseNumber]
        ];
        let h = '<div class="aie-grid">';
        rows.forEach(([k, v]) => {
          if (v == null || v === '') return;
          h += '<div class="aie-kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
        });
        h += '</div>';
        if (f.notes) h += '<div class="aie-notes">备注：' + esc(f.notes) + '</div>';
        $('aie-fields').innerHTML = h;
        $('aie-warn').innerHTML = (warnings && warnings.length)
          ? '<div class="warn">' + warnings.map(esc).join('<br/>') + '</div>' : '';
      }
      function fillFormFromExtracted(f) {
        if (!f) return;
        const ov = $('aie-overwrite') && $('aie-overwrite').checked;
        const set = (id, val) => {
          const el = $(id); if (!el) return;
          if (ov || !el.value.trim()) el.value = (val == null ? '' : String(val));
        };
        const loc = f.location || {}, attr = f.attributes || {}, tran = f.transaction || {};
        set('f-city', loc.city);
        set('f-district', loc.district);
        set('f-community', loc.community);
        set('f-address', loc.address);
        set('f-layout', attr.layout);
        set('f-area', attr.area);
        set('f-orientation', attr.orientation);
        set('f-floor', attr.floor);
        set('f-total', tran.totalPrice);
        set('f-unit', tran.unitPrice);
        set('f-agent', tran.agentName);
        set('f-phone', tran.agentPhone);
        set('f-wechat', tran.wechat);
        set('f-platform', tran.sourcePlatform);
        set('f-houseno', tran.houseNumber);
        if (f.notes) {
          const n = $('f-notes');
          if (n && (ov || !n.value.trim())) n.value = (n.value.trim() ? n.value + '\n' : '') + f.notes;
        }
        if (typeof refreshPreview === 'function') refreshPreview();
        toast('已填入表单，请核对后保存', true);
      }
    })();

    // 附件上传（图片 / 视频 / 户型图 / 小区环境图）：仅上传附件，用内存数组 fm 管理，不再使用 URL/路径文本框
    function refreshMedia() {
      const map = [['img-preview', 'images', false], ['video-preview', 'videos', true], ['floor-preview', 'floorPlans', false], ['env-preview', 'environment', false]];
      map.forEach(([pid, key, isVid]) => {
        const el = $(pid); if (!el) return;
        if (!fm[key].length) { el.classList.add('empty'); el.innerHTML = ''; }
        else {
          el.classList.remove('empty');
          el.innerHTML = fm[key].map((u, i) => {
            const inner = isVid ? `<video src="${esc(u)}"></video>` : `<img src="${esc(u)}" alt=""/>`;
            return `<div class="mp-item">${inner}<button type="button" class="mp-del" data-key="${key}" data-i="${i}">×</button></div>`;
          }).join('');
        }
      });
    }
    // 附件上传（点击 / 拖拽）：直接以二进制流式上传（不转 base64），避免视频等大文件撑爆内存
    async function processFiles(files, key) {
      if (!files || !files.length) return;
      let ok = 0, fail = 0;
      for (const f of files) {
        try {
          const r = await Store.uploadFile(f, key);
          if (r.url) { fm[key].push(r.url); ok++; }
          else fail++;
        } catch (e) { fail++; toast('「' + (f.name || '文件') + '」上传失败：' + e.message, false); }
      }
      refreshMedia();
      if (ok) toast('已上传 ' + ok + ' 个文件', true);
      if (fail) toast(fail + ' 个文件上传失败，请重试', false);
    }
    document.querySelectorAll('.dropzone').forEach((dz) => {
      const input = dz.querySelector('input[type=file]');
      const key = dz.dataset.key;
      dz.addEventListener('click', () => input.click());
      input.addEventListener('change', () => { processFiles(input.files, key); input.value = ''; });
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
      ['dragleave', 'dragend'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('dragover')));
      dz.addEventListener('drop', (e) => {
        e.preventDefault(); dz.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) processFiles(e.dataTransfer.files, key);
      });
    });
    // 预览区点击 × 删除附件
    ['img-preview', 'video-preview', 'floor-preview', 'env-preview'].forEach((pid) => {
      const el = $(pid); if (!el) return;
      el.onclick = (e) => {
        const btn = e.target.closest('.mp-del'); if (!btn) return;
        const key = btn.dataset.key, i = parseInt(btn.dataset.i, 10);
        if (fm[key] && !isNaN(i)) { fm[key].splice(i, 1); refreshMedia(); }
      };
    });
    refreshMedia();

    $('save-btn').onclick = async () => {
      const row = {
        title: $('f-community').value.trim() || [$('f-city').value.trim(), $('f-district').value.trim()].filter(Boolean).join(''),
        location: {
          city: $('f-city').value.trim(), district: $('f-district').value.trim(),
          community: $('f-community').value.trim(), address: $('f-address').value.trim(),
          subwayStation: $('f-subway-station').value.trim(), subwayDistance: num($('f-subway-dist').value)
        },
        // Object.assign 保留旧值：renovations 装修方案数组、已购标记等不在本表单里的字段不能被整体覆盖冲掉
        attributes: Object.assign({}, attr, {
          layout: $('f-layout').value.trim(), area: num($('f-area').value),
          orientation: $('f-orientation').value.trim(), floor: $('f-floor').value.trim(),
          builtYear: num($('f-built').value), decoration: $('f-dec').value.trim(),
          renovated: $('f-renovated').value === 'yes' ? true : ($('f-renovated').value === 'no' ? false : undefined),
          renovationCost: num($('f-renocost').value),
          elevator: $('f-elevator').value.trim(), parking: $('f-parking').value.trim(),
          propertyType: $('f-ptype').value.trim(), communityAge: $('f-cage').value.trim(),
          propertyFee: num($('f-propfee').value)
        }),
        media: {
          images: fm.images.slice(), videos: fm.videos.slice(),
          floorPlans: fm.floorPlans.slice(), environment: fm.environment.slice()
        },
        transaction: Object.assign({}, tran, {
          totalPrice: num($('f-total').value), unitPrice: num($('f-unit').value),
          agentName: $('f-agent').value.trim(), agentPhone: $('f-phone').value.trim(),
          wechat: $('f-wechat').value.trim(), sourcePlatform: $('f-platform').value.trim(),
          houseNumber: $('f-houseno').value.trim(), status: $('f-status').value.trim(),
          viewingDate: $('f-viewdate').value.trim(), tax: num($('f-tax').value),
          downPayment: num($('f-down').value), monthlyPayment: num($('f-monthly').value),
          ownership: $('f-ownership').value.trim(), loanable: $('f-loanable').value.trim(),
          loanType: $('f-loantype').value.trim(), gfundRatio: num($('f-gfund').value),
          loanYears: num($('f-loanyears').value), repayment: $('f-repayment').value.trim()
        }),
        facilities: {
          transport: $('f-transport').checked, supermarket: $('f-supermarket').checked,
          school: $('f-school').checked, hospital: $('f-hospital').checked,
          water: $('f-water').checked, electricity: $('f-electricity').checked, gas: $('f-gas').checked,
          schoolInfo: $('f-schoolinfo').value.trim(), notes: $('f-facnotes').value.trim()
        },
        geo: state.formGeo,
        notes: $('f-notes').value.trim()
      };
      try {
        if (id) await Store.update(id, row); else await Store.create(row);
        toast(id ? '已保存修改' : '已保存房源', true);
        setView(formBack);
      } catch (e) { toast('保存失败：' + e.message); }
    };

    // 右侧信息面板：标签切换（概览 / 填写提示）
    const tOv = $('tab-overview'), tTp = $('tab-tips');
    if (tOv && tTp) {
      tOv.onclick = () => { tOv.classList.add('active'); tTp.classList.remove('active'); $('ip-overview').classList.remove('hidden'); $('ip-tips').classList.add('hidden'); };
      tTp.onclick = () => { tTp.classList.add('active'); tOv.classList.remove('active'); $('ip-tips').classList.remove('hidden'); $('ip-overview').classList.add('hidden'); };
    }
    // 右侧信息面板：实时概要（录入时同步展示）
    function refreshPreview() {
      const st = $('f-status') ? $('f-status').value : '在售';
      const chip = st === '在售' ? '<span class="st-chip ok">在售</span>' : (st === '已售' ? '<span class="st-chip warn">已售</span>' : '<span class="st-chip off">已下架</span>');
      const ipStatus = $('ip-status'); if (ipStatus) ipStatus.innerHTML = chip;
      const sum = $('ip-summary'); if (!sum) return;
      const L = (k, v) => '<div class="line"><span class="k">' + k + '</span><span>' + esc(v || '—') + '</span></div>';
      sum.innerHTML =
        L('小区', $('f-community').value || ($('f-city').value + ($('f-district').value ? '·' + $('f-district').value : '')))
        + L('户型', $('f-layout').value)
        + L('面积', $('f-area').value ? $('f-area').value + ' ㎡' : '')
        + L('总价', $('f-total').value ? $('f-total').value + ' 万' : '')
        + L('综合评分', computeScore({
            location: { community: $('f-community').value, city: $('f-city').value, subwayDistance: $('f-subway-dist').value },
            attributes: { layout: $('f-layout').value, area: $('f-area').value, orientation: $('f-orientation').value, builtYear: $('f-built').value },
            transaction: { totalPrice: $('f-total').value, status: st },
            facilities: { school: $('f-school').checked }
          }));
    }
    refreshPreview();
    c.querySelectorAll('input, select, textarea').forEach((el) => {
      el.addEventListener('input', refreshPreview);
      el.addEventListener('change', refreshPreview);
    });
  }

  // ---------- 详情：基本信息 / 装修信息 两个页签的内容渲染 ----------

  // 基本信息页：原「交易信息」卡片已合并进「购房信息」，这里只保留基础信息 + 配套设施 + 位置/多媒体/户型图/环境
  function detailBasicHTML(p, purchaseBox) {
    const loc = p.location || {}, attr = p.attributes || {}, media = p.media || {}, fac = p.facilities || {};
    const kv = (k, v) => `<div class="kv"><span class="k">${esc(k)}</span><span>${v == null || v === '' ? '—' : esc(v)}</span></div>`;
    const facYes = (k, label) => `<div class="kv"><span class="k">${label}</span><span class="${fac[k] ? 'yes' : 'no'}">${fac[k] ? '✓ 有' : '— 无'}</span></div>`;
    const isUrl = (s) => /^https?:\/\//i.test(s) || /^\/media\//.test(s) || /^data:/i.test(s);
    const mediaListHtml = (arr) => {
      if (!arr || !arr.length) return '<div class="muted">无</div>';
      let h = '<div class="media-list lg">';
      arr.forEach((u) => { h += isUrl(u) ? `<img src="${esc(u)}" alt=""/>` : `<a href="${esc(u)}" target="_blank">📷 ${esc(u)}</a>`; });
      return h + '</div>';
    };
    const imgs = media.images || [], vids = media.videos || [];
    let mediaHtml = '<div class="muted">无</div>';
    if (imgs.length || vids.length) {
      mediaHtml = '<div class="media-list lg">';
      imgs.forEach((u) => { mediaHtml += isUrl(u) ? `<img src="${esc(u)}" alt=""/>` : `<a href="${esc(u)}" target="_blank">📷 ${esc(u)}</a>`; });
      vids.forEach((u) => { mediaHtml += isUrl(u) ? `<video src="${esc(u)}" controls style="max-width:100%"></video>` : `<a href="${esc(u)}" target="_blank">🎬 ${esc(u)}</a>`; });
      mediaHtml += '</div>';
    }
    const floorHtml = mediaListHtml(media.floorPlans);
    const envHtml = mediaListHtml(media.environment);
    const renovatedText = atOf(p).renovated === true ? '是' : (atOf(p).renovated === false ? '否' : '');
    return `<div class="detail-grid">
        <div>
          ${purchaseBox}
          <div class="detail-box" style="margin-bottom:16px">
            <h3 style="margin-top:0">基础信息</h3>
            ${kv('城市/区域', [loc.city, loc.district].filter(Boolean).join(' / '))}
            ${kv('小区', loc.community)}
            <div class="kv"><span class="k">地址</span><span class="kv-addr">${loc.address ? esc(loc.address) : '—'}<button class="btn sm" id="d-surround" type="button">📍 查看周边配套</button></span></div>
            ${kv('户型', attr.layout)}
            ${kv('面积', attr.area != null ? attr.area + ' ㎡' : '')}
            ${kv('朝向', attr.orientation)}
            ${kv('楼层', attr.floor)}
            ${kv('建成年代', attr.builtYear != null ? attr.builtYear : '')}
            ${kv('装修情况', attr.decoration)}
            ${kv('是否装修', renovatedText)}
            ${kv('装修大概费用', atOf(p).renovationCost != null ? atOf(p).renovationCost + ' 万' : '')}
            ${kv('电梯', attr.elevator)}
            ${kv('车位', attr.parking)}
            ${kv('房屋性质', attr.propertyType)}
            ${kv('小区新旧', attr.communityAge)}
            ${kv('物业费', attr.propertyFee != null ? attr.propertyFee + ' 元/㎡·月' : '')}
            ${kv('最近地铁站', loc.subwayStation)}
            ${kv('地铁距离', loc.subwayDistance != null ? loc.subwayDistance + ' m' : '')}
          </div>
          <div class="detail-box">
            <h3 style="margin-top:0">配套设施</h3>
            ${facYes('transport','交通')}${facYes('supermarket','商超')}${facYes('school','学校')}${facYes('hospital','医院')}
            ${facYes('water','水')}${facYes('electricity','电')}${facYes('gas','燃气')}
            ${kv('学区/对口学校', fac.schoolInfo)}
            ${kv('配套备注', fac.notes)}
            ${kv('备注', p.notes)}
          </div>
        </div>
        <div>
          <div class="detail-box" style="margin-bottom:16px">
            <h3 style="margin-top:0">位置</h3>
            ${p.geo && p.geo.lng ? kv('坐标', p.geo.lng.toFixed(5) + ', ' + p.geo.lat.toFixed(5) + '（' + esc(p.geo.source || '') + '）') : '<div class="muted">未定位</div>'}
            <div id="detail-map" class="amap-mini" style="height:260px;margin-top:10px"></div>
          </div>
          <div class="detail-box" style="margin-bottom:16px">
            <h3 style="margin-top:0">多媒体</h3>
            ${mediaHtml}
          </div>
          <div class="detail-box" style="margin-bottom:16px">
            <h3 style="margin-top:0">户型图</h3>
            ${floorHtml}
          </div>
          <div class="detail-box">
            <h3 style="margin-top:0">小区环境图</h3>
            ${envHtml}
          </div>
        </div>
      </div>`;
  }

  // 装修信息页签：内联展示，含「已确定方案 / 比价记录」两个子页签，复用与独立装修信息页相同的逻辑与组件
  function detailRenovationHTML(p) {
    const list = renoListOf(p);
    const confirmed = list.find((x) => x.confirmed) || null;
    const tabs = `<div class="utabs" id="rn-tabs">
      <button class="tab ${state.renoTab === 'confirmed' ? 'active' : ''}" data-rtab="confirmed">已确定方案</button>
      <button class="tab ${state.renoTab === 'quotes' ? 'active' : ''}" data-rtab="quotes">比价记录（${list.length}）</button>
    </div>`;
    const viewing = (state.renoTab === 'quotes' && state.renoDetailId) ? list.find((x) => x.id === state.renoDetailId) : null;
    const shownItem = viewing || (state.renoTab === 'confirmed' ? confirmed : null);
    let bodyHtml;
    if (state.renoTab === 'quotes' && !viewing) {
      if (!list.length) {
        bodyHtml = `<div class="cmp-empty"><div class="cmp-empty-ico">📋</div>
          <h3>还没有比价方案</h3><p>点「加一家报价」，把几家装修公司的报价都记下来，方便横向比较。</p>
          <button class="btn primary" id="rn-add-empty">＋ 加一家报价</button></div>`;
      } else {
        const rows = list.map((it) => {
          const g = it.budget || {}, b = it.basic || {};
          return `<tr>
            <td class="pl-title"><span class="pl-link" data-rq-view="${esc(it.id)}">${esc(renoTitle(it))}</span>
              <span class="pl-sub">${esc(b.company || '未填公司')}</span></td>
            <td>${esc(b.method || '—')} / ${esc(b.style || '—')}</td>
            <td class="pl-num">${g.total != null && g.total !== '' ? esc(g.total) : '—'}</td>
            <td class="pl-num">${g.spent != null && g.spent !== '' ? esc(g.spent) : '—'}</td>
            <td>${esc(b.status || '—')}</td>
            <td>${it.confirmed ? '<span class="tag rf-ok">✅ 已确定</span>' : '<span class="tag st-off">比价中</span>'}</td>
            <td class="pl-ops">
              <button class="op-btn" data-rq-view="${esc(it.id)}">查看</button>
              ${it.confirmed ? '' : `<button class="op-btn" data-rq-confirm="${esc(it.id)}">设为已确定</button>`}
              <button class="op-btn" data-rq-edit="${esc(it.id)}">编辑</button>
              <button class="op-btn op-btn-danger" data-rq-del="${esc(it.id)}">删除</button>
            </td></tr>`;
        }).join('');
        bodyHtml = `<div class="plist-wrap"><table class="plist"><thead><tr>
          <th>方案</th><th>方式 / 风格</th><th>总预算(万)</th><th>已花费(万)</th><th>装修状态</th><th>选定</th><th>操作</th>
          </tr></thead><tbody>${rows}</tbody></table></div>
          <div style="margin-top:12px"><button class="btn primary" id="rn-add">＋ 加一家报价</button></div>`;
      }
    } else if (!shownItem) {
      bodyHtml = `<div class="cmp-empty"><div class="cmp-empty-ico">🔨</div>
        <h3>还没有确定用哪家装修</h3>
        <p>这套房目前有 ${list.length} 条比价方案。到「比价记录」里把选定的那条设为「已确定」，这里就只显示它。</p>
        <button class="btn primary" id="rn-go-quotes">查看比价记录</button></div>`;
    } else {
      const r = normalizeRenovation(shownItem);
      // 编辑统一交给详情页右上角的互斥按钮组（✏️ 编辑装修信息），这里只保留
      // 「返回比价记录 / 设为已确定」这类随查看状态出现的上下文操作；没有就不输出空条。
      const actsArr = [];
      if (viewing) actsArr.push('<button class="btn" id="rn-to-quotes">返回比价记录</button>');
      if (viewing && !viewing.confirmed) actsArr.push('<button class="btn" id="rn-confirm">设为已确定</button>');
      const acts = actsArr.length ? '<div class="reno-inline-actions">' + actsArr.join('') + '</div>' : '';
      bodyHtml = acts + (renoHasAny(r) ? '' : '<div class="notice">这条方案还没填内容，点右上角「✏️ 编辑装修信息」，按 5 个步骤补充方式、预算、进度、主材和图片。</div>') + renoArchiveHTML(r);
    }
    return tabs + bodyHtml;
  }

  function wireDetailRenovation(c, p) {
    const container = $('detail-content');
    if (!container) return;
    const paintReno = () => { container.innerHTML = detailRenovationHTML(p); wireDetailRenovation(c, p); };
    const list = renoListOf(p);
    const viewing = (state.renoTab === 'quotes' && state.renoDetailId) ? list.find((x) => x.id === state.renoDetailId) : null;
    const confirmed = list.find((x) => x.confirmed) || null;
    const shownItem = viewing || (state.renoTab === 'confirmed' ? confirmed : null);
    c.querySelectorAll('[data-rtab]').forEach((b) => b.onclick = () => { state.renoTab = b.dataset.rtab; state.renoDetailId = null; paintReno(); window.scrollTo(0, 0); });
    const add = () => { state.renoTab = 'quotes'; openRenoForm(p.id, null, 'renovation'); };
    if ($('rn-add')) $('rn-add').onclick = add;
    if ($('rn-add-empty')) $('rn-add-empty').onclick = add;
    if ($('rn-go-quotes')) $('rn-go-quotes').onclick = () => { state.renoTab = 'quotes'; paintReno(); };
    if ($('rn-to-quotes')) $('rn-to-quotes').onclick = () => { state.renoDetailId = null; paintReno(); };
    // 「编辑这条方案」已移到详情页右上角互斥按钮组（#d-reno-edit），内容区不再重复渲染 rn-edit。
    if ($('rn-confirm')) $('rn-confirm').onclick = async () => {
      try { await setConfirmedReno(p, viewing.id); toast('已设为确定的装修方案', true); paintReno(); }
      catch (e) { toast('操作失败：' + e.message); }
    };
    c.querySelectorAll('[data-rq-view]').forEach((b) => b.onclick = () => { state.renoDetailId = b.dataset.rqView; paintReno(); });
    c.querySelectorAll('[data-rq-confirm]').forEach((b) => b.onclick = async () => {
      try { await setConfirmedReno(p, b.dataset.rqConfirm); toast('已设为确定的装修方案', true); paintReno(); }
      catch (e) { toast('操作失败：' + e.message); }
    });
    c.querySelectorAll('[data-rq-edit]').forEach((b) => b.onclick = () => openRenoForm(p.id, b.dataset.rqEdit, 'renovation'));
    c.querySelectorAll('[data-rq-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('确定删除这条比价方案？删除后不可恢复。')) return;
      try { await saveRenovations(p, renoListOf(p).filter((x) => x.id !== b.dataset.rqDel)); toast('方案已删除', true); paintReno(); }
      catch (e) { toast('删除失败：' + e.message); }
    });
  }

  // 根据顶部页签把 #detail-content 渲染为基本信息或装修信息
  function paintDetailContent(c, p, purchaseBox) {
    const container = document.getElementById('detail-content');
    if (!container) return;
    if (state.detailTab === 'renovation' && isPurchased(p)) {
      container.innerHTML = detailRenovationHTML(p);
      wireDetailRenovation(c, p);
    } else {
      container.innerHTML = detailBasicHTML(p, purchaseBox);
      const mapEl = container.querySelector('#detail-map');
      if (mapEl) HVMap.renderSingle(mapEl, p.geo && p.geo.lng, p.geo && p.geo.lat);
      const surBtn = container.querySelector('#d-surround');
      if (surBtn) surBtn.onclick = () => openSurroundModal(p);
    }
  }

  // ---------- 详情 ----------
  async function renderDetail(c, id) {
    renderPageName('detail');
    c.innerHTML = '<div class="empty">加载中…</div>';
    const FU_TYPES = ['看房', '电话', '议价', '签约', '贷款', '交房', '其他'];
    const todayStr = new Date().toISOString().slice(0, 10);
    let p;
    try { p = await Store.get(id); } catch (e) { c.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; return; }
    const loc = p.location || {}, attr = p.attributes || {}, media = p.media || {}, tran = p.transaction || {}, fac = p.facilities || {};
    const kv = (k, v) => `<div class="kv"><span class="k">${esc(k)}</span><span>${v == null || v === '' ? '—' : esc(v)}</span></div>`;
    const facYes = (k, label) => `<div class="kv"><span class="k">${label}</span><span class="${fac[k] ? 'yes' : 'no'}">${fac[k] ? '✓ 有' : '— 无'}</span></div>`;
    const isUrl = (s) => /^https?:\/\//i.test(s) || /^\/media\//.test(s) || /^data:/i.test(s);
    const imgListHtml = (arr) => {
      if (!arr || !arr.length) return '<div class="muted">无</div>';
      let h = '<div class="media-list lg">';
      arr.forEach((u) => { h += isUrl(u) ? `<img src="${esc(u)}" alt=""/>` : `<a href="${esc(u)}" target="_blank">📷 ${esc(u)}</a>`; });
      return h + '</div>';
    };

    let mediaHtml = '<div class="muted">无</div>';
    const imgs = media.images || [], vids = media.videos || [];
    if (imgs.length || vids.length) {
      mediaHtml = '<div class="media-list lg">';
      imgs.forEach((u) => { mediaHtml += isUrl(u) ? `<img src="${esc(u)}" alt=""/>` : `<a href="${esc(u)}" target="_blank">📷 ${esc(u)}</a>`; });
      vids.forEach((u) => { mediaHtml += isUrl(u) ? `<video src="${esc(u)}" controls style="max-width:100%"></video>` : `<a href="${esc(u)}" target="_blank">🎬 ${esc(u)}</a>`; });
      mediaHtml += '</div>';
    }
    const floorHtml = imgListHtml(media.floorPlans);
    const envHtml = imgListHtml(media.environment);

    const bought = isPurchased(p);
    const stText = bought ? '已购' : (tran.status || '在售');
    const stChip = stText === '在售' ? '<span class="st-chip ok">在售</span>'
      : stText === '已售' ? '<span class="st-chip warn">已售</span>'
      : stText === '已下架' ? '<span class="st-chip off">已下架</span>'
      : stText === '待看' ? '<span class="st-chip await">待看</span>'
      : '<span class="st-chip bought">已购</span>';
    const backView = MENU_VIEWS.indexOf(state.lastMenuView) !== -1 ? state.lastMenuView : 'list';
    state.detailTab = 'basic';   // 进入详情页默认看「基本信息」，装修信息改为顶部页签内联展示
    const renovatedText = atOf(p).renovated === true ? '是' : (atOf(p).renovated === false ? '否' : '');
    const annualVal = tran.annualPayment != null ? tran.annualPayment : (num(tran.monthlyPayment) ? Math.round(num(tran.monthlyPayment) * 12 * 100) / 100 : '');
    // 房贷信息：只显示填过的字段，避免老房源冒出一排「—」
    const loanKV = (label, v, suffix) => (v == null || v === '' ? '' : kv(label, v + (suffix || '')));
    const loanRows = [
      loanKV('首付比例', tran.downPaymentRatio != null ? (Math.round(tran.downPaymentRatio * 1000) / 10) + '%' : ''),
      loanKV('首付金额', tran.downPayment, ' 万'),
      loanKV('贷款类型', tran.loanType),
      loanKV('商贷年利率', tran.commRate != null ? tran.commRate + '%' : ''),
      loanKV('公积金年利率', tran.fundRate != null ? tran.fundRate + '%' : ''),
      loanKV('公积金贷款金额', tran.fundAmount, ' 万'),
      loanKV('还款方式', tran.repayment),
      loanKV('组合贷公积金占比', tran.gfundRatio, '%')
    ].join('');
    // 购房信息卡片：已购与非已购共用同一标题与样式；已购时补充购房价与贷款明细，非已购只显示成交相关字段。取消原先独立的「交易信息」卡片，避免内容分散。
    const purchaseBox = `<div class="detail-box" style="margin-bottom:16px">
      <h3 style="margin-top:0">🏡 购房信息</h3>
      <div class="kv"><span class="k">房源状态</span><span>${stChip}</span></div>
      ${bought ? kv('购房价（万）', tran.purchasePrice != null ? tran.purchasePrice + ' 万' : '') : ''}
      ${kv('总价（万）', tran.totalPrice != null ? tran.totalPrice + ' 万' : '')}
      ${kv('单价（元/㎡）', tran.unitPrice != null ? tran.unitPrice : '')}
      ${loanRows}
      ${kv(tran.repayment === '等额本金' ? '月供（首月，元/月）' : '月供（元/月）', tran.monthlyPayment != null ? tran.monthlyPayment : '')}
      ${kv('周期 / 贷款年限', tran.loanYears != null ? tran.loanYears + ' 年' : '')}
      ${kv('年供（元/年）', annualVal !== '' ? annualVal : '')}
      ${kv('来源平台', tran.sourcePlatform)}
      ${kv('房源编号', tran.houseNumber)}
      ${kv('看房日期', tran.viewingDate)}
      ${kv('中介', tran.agentName)}
      ${kv('电话', tran.agentPhone)}
      ${kv('微信', tran.wechat)}
      ${kv('税费(万)', tran.tax != null ? tran.tax : '')}
      ${kv('产权状态', tran.ownership)}
      ${kv('是否可贷款', tran.loanable)}
    </div>`;
    const detailTabs = bought ? `<div class="detail-tabs utabs">
        <button class="tab ${state.detailTab === 'basic' ? 'active' : ''}" data-dtab="basic">基本信息</button>
        <button class="tab ${state.detailTab === 'renovation' ? 'active' : ''}" data-dtab="renovation">装修信息</button>
      </div>` : '';
    // 右上角操作按钮按页签互斥显隐：基本信息 → 房源相关操作；装修信息 → 装修相关操作。
    // 「返回」放在两组之外，任何页签下都保留，避免切到装修页后出不去。
    const renoActions = bought ? `<span class="detail-actions hidden" id="detail-reno-actions">
        <button class="btn" id="d-reno-add">＋ 加一家报价</button>
        <button class="btn primary" id="d-reno-edit">✏️ 编辑装修信息</button>
      </span>` : '';
    c.innerHTML = `
      ${crumb(['看房记录', '房源详情'])}
      <div class="section-head"><h2>${esc(p.title || loc.community || '房源详情')}</h2>
        ${detailTabs}
        ${bought ? '' : `<div class="detail-status">${stChip}</div>`}
        <div class="spacer"></div>
        <span class="detail-actions" id="detail-basic-actions">
          <button class="btn ${bought ? '' : 'primary'}" id="d-purchase">${bought ? '✏️ 修改购房信息' : '🏡 标记为已购房'}</button>
          <button class="btn primary" id="d-fu-add">＋ 添加跟进</button>
          <button class="btn ${p.favorite ? 'on' : ''}" id="d-fav">${p.favorite ? '★ 已收藏' : '☆ 收藏'}</button>
          <button class="btn" id="d-edit">编辑</button>
          <button class="btn danger" id="d-del">删除</button>
        </span>
        ${renoActions}
        <button class="btn" id="d-back">返回</button></div>
      <div id="detail-content"></div>
      <div class="fu-drawer-overlay" id="fu-drawer-overlay"></div>
      <div class="fu-drawer" id="fu-drawer" role="dialog" aria-modal="true">
        <div class="fu-drawer-head"><h3 style="margin:0">添加跟进日志</h3><button class="btn sm" id="fu-drawer-close" title="关闭">✕</button></div>
        <div class="fu-drawer-body">
          <label class="fu-label">类型</label>
          <select id="fu-type" class="tb-in">${FU_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
          <label class="fu-label" style="margin-top:14px">日期</label>
          <input id="fu-date" type="date" class="tb-in" value="${todayStr}"/>
          <label class="fu-label" style="margin-top:14px">内容</label>
          <textarea id="fu-content" class="zy-textarea" style="margin-top:6px" placeholder="记录这次跟进：看了房、和中介沟通了什么、报价/议价情况…"></textarea>
          <h4 style="margin:18px 0 6px;font-size:14px">历史记录</h4>
          <div id="fu-list" class="fu-list"></div>
        </div>
        <div class="fu-drawer-foot">
          <button class="btn" id="fu-drawer-cancel">取消</button>
          <button class="btn primary" id="fu-add">添加</button>
        </div>
      </div>`;
    // 内容区：基本信息 / 装修信息 两个页签（装修信息内联展示，不再跳转独立页面）
    // 右上角按钮组随页签互斥显隐；paintContent 每次重绘都同步一次，避免状态漂移。
    const syncDetailActions = () => {
      const isReno = bought && state.detailTab === 'renovation';
      const basic = $('detail-basic-actions'), reno = $('detail-reno-actions');
      if (basic) basic.classList.toggle('hidden', isReno);
      if (reno) reno.classList.toggle('hidden', !isReno);
    };
    const paintContent = () => { paintDetailContent(c, p, purchaseBox); syncDetailActions(); };
    paintContent();
    c.querySelectorAll('[data-dtab]').forEach((b) => b.onclick = () => {
      state.detailTab = b.dataset.dtab;
      c.querySelectorAll('[data-dtab]').forEach((x) => x.classList.toggle('active', x.dataset.dtab === state.detailTab));
      paintContent(); window.scrollTo(0, 0);
    });
    $('d-back').onclick = () => setView(backView);
    // 装修页签右上角：新建报价 / 编辑当前方案。点击时实时算当前展示的方案，
    // 这样在内容区切「已确定方案 / 比价记录」子页签后，按钮不会指向过时的方案。
    if ($('d-reno-add')) $('d-reno-add').onclick = () => {
      state.renoTab = 'quotes';
      openRenoForm(p.id, null, 'renovation');
    };
    if ($('d-reno-edit')) $('d-reno-edit').onclick = () => {
      const list = renoListOf(p);
      const confirmed = list.find((x) => x.confirmed) || null;
      const viewing = (state.renoTab === 'quotes' && state.renoDetailId)
        ? list.find((x) => x.id === state.renoDetailId) : null;
      // 优先编辑正在查看的那条；否则编辑已确定的方案（即便当前停在「比价记录」列表，
      // 「编辑装修信息」也应指向这套房的装修档案，而不是退化成新增）；都没有才新建。
      const target = viewing || confirmed;
      if (!target) {
        toast('还没有装修方案，已为你打开新增报价');
        state.renoTab = 'quotes';
        openRenoForm(p.id, null, 'renovation');
        return;
      }
      openRenoForm(p.id, target.id, 'renovation');
    };
    $('d-purchase').onclick = () => openPurchaseModal(p, () => renderDetail(c, id));
    $('d-edit').onclick = () => renderForm(c, id);
    $('d-del').onclick = async () => { await doDelete(id); setView(backView); };
    $('d-fav').onclick = async () => {
      try {
        const row = await Store.toggleFavorite(id, !p.favorite);
        p = row;
        const idx = state.properties.findIndex((x) => x.id === id);
        if (idx >= 0) state.properties[idx] = row;
        const btn = $('d-fav');
        btn.textContent = row.favorite ? '★ 已收藏' : '☆ 收藏';
        btn.classList.toggle('on', row.favorite);
        toast(row.favorite ? '★ 已收藏' : '已取消收藏', true);
      } catch (e) { toast('收藏操作失败：' + e.message); }
    };
    // 跟进日志
    const drawer = $('fu-drawer');
    const overlay = $('fu-drawer-overlay');
    const openDrawer = () => {
      const cEl = $('fu-content'); if (cEl) cEl.value = '';
      const dEl = $('fu-date'); if (dEl) dEl.value = todayStr;
      overlay.classList.add('open');
      drawer.classList.add('open');
      setTimeout(() => { const el = $('fu-content'); if (el) el.focus(); }, 60);
    };
    const closeDrawer = () => { overlay.classList.remove('open'); drawer.classList.remove('open'); };
    $('d-fu-add').onclick = openDrawer;
    overlay.onclick = closeDrawer;
    $('fu-drawer-close').onclick = closeDrawer;
    $('fu-drawer-cancel').onclick = closeDrawer;
    const fuList = $('fu-list');
    const renderFuList = (items) => {
      if (!items.length) { fuList.innerHTML = '<div class="muted" style="margin-top:12px">还没有跟进记录，添加第一条吧。</div>'; return; }
      fuList.innerHTML = '<div class="fu-tl">' + items.map((it) => {
        const d = it.happened_date ? String(it.happened_date).slice(0, 10) : new Date(it.created_at).toISOString().slice(0, 10);
        const t = it.type && it.type !== '其他' ? `<span class="fu-tag">${esc(it.type)}</span>` : '';
        return `<div class="fu-tl-item">
          <span class="fu-tl-dot"></span>
          <div class="fu-tl-body">
            <div class="fu-item-head"><span class="fu-date">${esc(d)}</span>${t}<span class="spacer"></span><button class="btn sm danger" data-fu-del="${it.id}">删除</button></div>
            <div class="fu-content">${esc(it.content).replace(/\n/g, '<br/>')}</div>
          </div>
        </div>`;
      }).join('') + '</div>';
      fuList.querySelectorAll('[data-fu-del]').forEach((b) => b.onclick = async () => {
        if (!confirm('确定删除这条跟进记录？')) return;
        try { await Store.delFollowup(id, b.dataset.fuDel); toast('已删除', true); renderFuList(await Store.listFollowups(id)); }
        catch (e) { toast('删除失败：' + e.message); }
      });
    };
    try { renderFuList(await Store.listFollowups(id)); } catch (e) { fuList.innerHTML = '<div class="muted">跟进日志加载失败：' + esc(e.message) + '</div>'; }
    const fuAdd = $('fu-add');
    if (fuAdd) fuAdd.onclick = async () => {
      const content = ($('fu-content').value || '').trim();
      if (!content) { toast('请先填写跟进内容'); return; }
      try {
        await Store.addFollowup(id, { type: $('fu-type').value, happenedDate: $('fu-date').value || null, content });
        $('fu-content').value = '';
        toast('已添加跟进', true);
        const items = await Store.listFollowups(id);
        renderFuList(items);
        const body = drawer.querySelector('.fu-drawer-body');
        const listEl = $('fu-list');
        if (body && listEl) body.scrollTop = Math.max(0, listEl.offsetTop - 12);
      } catch (e) { toast('添加失败：' + e.message); }
    };
  }

  // ---------- 小区周边配套（Plan A：高德 PlaceSearch 周边搜索 + 卫星图）----------
  // 地图分布页：用同一个地址输入框查看周边配套（先地理编码成坐标，再复用周边弹窗）
  async function openSurroundByAddress() {
    const input = $('commute-dest');
    const q = (input && input.value.trim()) || '';
    if (!q) { toast('请先在上方输入框填入要查看的小区名或地址'); return; }
    if (!Geo.hasKey()) { toast('未配置高德 Key，无法查看周边配套'); return; }
    const btn = $('sr-go');
    if (btn) { btn.disabled = true; btn.textContent = '定位中…'; }
    try {
      try { await Geo.ensureAmap(); } catch (e) { /* SDK 未就绪时由 geocode 自行回退 */ }
      const g = await Geo.geocode(q, '成都');
      openSurroundModal(null, { name: q, center: { lng: g.lng, lat: g.lat }, city: '成都' });
    } catch (e) {
      toast('地址定位失败：' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📍 查看周边配套'; }
    }
  }

  // 打开周边配套弹窗。p 为房源对象；ov 可覆盖（供地图分布页按「输入的地址」查看）：
  // ov = { name, center: {lng,lat}, city }
  function openSurroundModal(p, ov) {
    ov = ov || {};
    const modal = $('surround-modal');
    if (!modal) return;
    const loc = (p && p.location) || {};
    const name = ov.name || (p && p.title) || loc.community || '该房源';
    const city = ov.city || loc.city || '成都';
    $('sr-title').textContent = '📍 ' + name + ' · 周边配套';
    const listEl = $('surround-list');
    const mapEl = $('surround-map');
    listEl.innerHTML = '<div class="muted">加载中…</div>';
    mapEl.innerHTML = '<div class="empty">地图加载中…</div>';
    // 若上一次没销毁，先销毁，避免重复地图实例
    if (window.__srMap) { try { window.__srMap.destroy(); } catch (e) {} window.__srMap = null; }
    modal.classList.remove('hidden');

    function closeSr() {
      modal.classList.add('hidden');
      if (window.__srMap) { try { window.__srMap.destroy(); } catch (e) {} window.__srMap = null; }
    }
    $('sr-x').onclick = closeSr;
    modal.onclick = (e) => { if (e.target === modal) closeSr(); };

    if (!Geo.hasKey()) {
      mapEl.innerHTML = '<div class="empty">未配置高德 Key，无法显示在线地图与周边配套。<br/>请在左上角「设置」里填入高德 Key 与密钥（Web 端 JS API）。</div>';
      listEl.innerHTML = '<div class="muted">未配置高德 Key。</div>';
      return;
    }

    (async () => {
      let center = ov.center && ov.center.lng ? { lng: ov.center.lng, lat: ov.center.lat }
        : ((p && p.geo && p.geo.lng) ? { lng: p.geo.lng, lat: p.geo.lat } : null);
      if (!center) {
        try {
          const q = [loc.city, loc.district, loc.community, loc.address].filter(Boolean).join(' ');
          const g = await Geo.geocode(q || name, city);
          center = { lng: g.lng, lat: g.lat };
        } catch (e) {
          mapEl.innerHTML = '<div class="empty">无法定位该地址，请换一个更具体的地名再试（如「春熙路」「天府三街」）。</div>';
          listEl.innerHTML = '<div class="muted">定位失败：' + esc(e.message) + '</div>';
          return;
        }
      }
      let AMap;
      try { AMap = await Geo.ensureAmap(); }
      catch (e) { mapEl.innerHTML = '<div class="empty">在线地图加载失败，请检查网络后刷新重试。</div>'; return; }
      if (!mapEl.isConnected) return;
      mapEl.innerHTML = '';
      const map = new AMap.Map(mapEl, { zoom: 15, center: [center.lng, center.lat], viewMode: '2D' });
      window.__srMap = map;

      // 中心点（房源本身）
      const centerMarker = new AMap.Marker({ position: [center.lng, center.lat], title: name,
        content: '<div class="sr-center" title="' + esc(name) + '">🏠</div>', zIndex: 200 });
      map.add(centerMarker);

      // 卫星图层切换
      let satLayer = null;
      const satBtn = $('sr-sat');
      satBtn.classList.remove('active');
      satBtn.onclick = () => {
        if (!satLayer) { satLayer = new AMap.TileLayer.Satellite(); satLayer.setMap(map); satBtn.classList.add('active'); }
        else { satLayer.setMap(null); satLayer = null; satBtn.classList.remove('active'); }
        setTimeout(() => { try { map.setFitView(); } catch (e) {} }, 50);
      };

      const CATS = [
        { key: 'subway', label: '地铁', kw: '地铁站' },
        { key: 'bus', label: '公交', kw: '公交站' },
        { key: 'school', label: '学校', kw: '学校' },
        { key: 'hospital', label: '医院', kw: '医院' },
        { key: 'shop', label: '商超', kw: '购物' },
        { key: 'bank', label: '银行', kw: '银行' },
        { key: 'food', label: '餐饮', kw: '餐饮' },
        { key: 'park', label: '公园', kw: '公园' }
      ];
      const colorOf = (key) => ({ subway: '#1e88e5', bus: '#00897b', school: '#fb8c00', hospital: '#e53935', shop: '#8e24aa', bank: '#43a047', food: '#f4511e', park: '#00acc1' }[key] || '#546e7a');
      const store = {}; // key -> { markers:[], items:[] }

      function radius() { return parseInt($('sr-radius').value, 10) || 1500; }
      function renderList() {
        const items = [];
        Object.keys(store).forEach((k) => store[k].items.forEach((it) => items.push(it)));
        items.sort((a, b) => (a.distance || 0) - (b.distance || 0));
        if (!items.length) { listEl.innerHTML = '<div class="muted">所选范围内未找到配套。试试调大半径或勾选更多类别。</div>'; return; }
        listEl.innerHTML = items.map((it) => `<div class="sr-item">
          <span class="sr-dot" style="background:${colorOf(it.key)}"></span>
          <span class="sr-info"><span class="sr-name">${esc(it.name)}</span>
          <span class="sr-meta">${esc(it.type)} · ${it.distance != null ? Math.round(it.distance) + ' m' : ''} · ${esc(it.address || '')}</span></span>
        </div>`).join('');
      }
      async function runSearch(cat) {
        await new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          const timer = setTimeout(finish, 8000);   // 兜底：回调不触发也不至于一直卡在「加载中」
          AMap.plugin('AMap.PlaceSearch', () => {
            try {
              const ps = new AMap.PlaceSearch({ pageSize: 25, pageIndex: 1, city: city });
              ps.searchNearBy(cat.kw, [center.lng, center.lat], radius(), (status, result) => {
                clearTimeout(timer);
                if (status === 'complete' && result && result.poiList && result.poiList.pois) {
                  const pois = result.poiList.pois;
                  const markers = pois.map((poi) => {
                    const m = new AMap.Marker({ position: [poi.location.lng, poi.location.lat], title: poi.name,
                      content: '<div class="sr-pin" style="background:' + colorOf(cat.key) + '">' + esc(cat.label.charAt(0)) + '</div>' });
                    map.add(m); return m;
                  });
                  store[cat.key] = { markers, items: pois.map((poi) => ({
                    key: cat.key, name: poi.name, type: cat.label, distance: poi.distance,
                    address: poi.address || ((poi.pname || '') + (poi.cityname || '') + (poi.adname || ''))
                  })) };
                } else {
                  store[cat.key] = { markers: [], items: [] };
                }
                finish();
              });
            } catch (e) {
              clearTimeout(timer); store[cat.key] = { markers: [], items: [] }; finish();
            }
          });
        });
      }
      function clearCat(key) {
        if (store[key]) { store[key].markers.forEach((m) => map.remove(m)); delete store[key]; }
      }
      async function activate(cat) {
        const btn = catBar.querySelector('[data-cat="' + cat.key + '"]');
        if (!btn || btn.classList.contains('active')) return;
        btn.classList.add('active'); btn.disabled = true;
        try { await runSearch(cat); } catch (e) { toast(cat.label + ' 搜索失败：' + e.message); }
        btn.disabled = false;
        try { renderList(); } catch (e) { /* 单个类别渲染异常不影响其它类别 */ }
      }
      function deactivate(cat) {
        const btn = catBar.querySelector('[data-cat="' + cat.key + '"]');
        if (btn) btn.classList.remove('active');
        clearCat(cat.key); renderList();
      }

      const catBar = $('sr-cats');
      catBar.innerHTML = CATS.map((c2) => `<button class="btn sm sr-cat" data-cat="${c2.key}" type="button">${c2.label}</button>`).join('');
      catBar.querySelectorAll('.sr-cat').forEach((btn) => {
        btn.onclick = () => {
          const cat = CATS.find((x) => x.key === btn.dataset.cat);
          if (btn.classList.contains('active')) deactivate(cat); else activate(cat);
        };
      });
      $('sr-radius').onchange = async () => {
        const active = CATS.filter((x) => store[x.key]);
        CATS.forEach((x) => clearCat(x.key));
        for (const cat of active) { try { await runSearch(cat); } catch (e) {} }
        renderList();
      };

      // 默认开启：交通 / 学校 / 商超
      for (const k of ['subway', 'school', 'shop']) { await activate(CATS.find((x) => x.key === k)); }
      setTimeout(() => { try { map.setFitView(); } catch (e) {} }, 400);
    })();
  }

  // ---------- 启动 ----------
  // ---------- 个人信息维护（昵称 + 头像 + 顶部栏配色）----------
  const HEADER_THEMES = [
    { id: 'hd-auto', name: '跟随系统' },
    { id: 'hd-1', name: '极浅' },
    { id: 'hd-6', name: '深色' }
  ];
  // hd-auto 不是一种配色，而是「按操作系统偏好选 hd-1 / hd-6」；
  // state.headerTheme 存用户的选择（含 auto），effectiveTheme() 才是真正应用到 DOM 的配色。
  const DARK_MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function effectiveTheme() {
    if (state.headerTheme !== 'hd-auto') return state.headerTheme;
    return DARK_MQ && DARK_MQ.matches ? 'hd-6' : 'hd-1';
  }
  // 深色主题只作用于「主应用」；登录/注册页始终保持设计时的浅色，不受 hd-6 影响。
  // 用视图可见性判断，避免 body.dark 里的全局变量（--panel/--text 等）把登录卡片带成深色。
  function syncDark() {
    const app = $('app-view');
    const inApp = !!app && !app.classList.contains('hidden');
    document.body.classList.toggle('dark', effectiveTheme() === 'hd-6' && inApp);
  }
  function applyHeaderTheme() {
    const h = document.querySelector('.zy-header');
    if (h) {
      HEADER_THEMES.forEach((t) => h.classList.remove(t.id));
      h.classList.add(effectiveTheme());
    }
    syncDark();
  }
  // 系统明暗偏好变化时，只有「跟随系统」模式需要跟着变（手动极浅/深色不受影响）
  if (DARK_MQ) {
    const onSchemeChange = () => {
      if (state.headerTheme !== 'hd-auto') return;
      applyHeaderTheme();
      updateThemeToggle();
    };
    if (DARK_MQ.addEventListener) DARK_MQ.addEventListener('change', onSchemeChange);
    else if (DARK_MQ.addListener) DARK_MQ.addListener(onSchemeChange);
  }
  // 头部主题切换按钮：根据当前「实际生效」主题显示 月亮（浅色态）/ 太阳（深色态）图标
  function updateThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const dark = effectiveTheme() === 'hd-6';
    btn.innerHTML = dark
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
  function toggleTheme() {
    // 顶部按钮是「手动切一下」：从当前实际生效的配色取反，并存为显式选择（自动退出跟随系统）
    state.headerTheme = effectiveTheme() === 'hd-6' ? 'hd-1' : 'hd-6';
    try { localStorage.setItem('hvt_header_theme', state.headerTheme); } catch (e) {}
    applyHeaderTheme();
    updateThemeToggle();
    // 顶部按钮会退出「跟随系统」，若此刻正停留在设置页，同步三色块的高亮状态
    document.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('active', x.dataset.theme === state.headerTheme));
    toast('主题已切换为「' + (HEADER_THEMES.find((t) => t.id === state.headerTheme) || {}).name + '」', true);
  }
  // 版本信息：直接读 index.html 中 app.js 的资源版本号，以后升版本设置页不用再手改
  function buildInfo() {
    const s = document.querySelector('script[src*="app.js"]');
    const tag = (s && (s.src.match(/[?&]v=([^&]+)/) || [])[1]) || 'dev';
    const m = tag.match(/^(\d{4})(\d{2})(\d{2})/);
    return { tag: tag, date: m ? (m[1] + '-' + m[2] + '-' + m[3]) : '—' };
  }
  function renderProfile(c) {
    const u = state.user || {};
    const dm = u.demand || {};
    const bv = buildInfo();
    c.innerHTML =
      crumb(['看房记录', '设置']) +
      // 保存按钮提到页级标题栏：它同时保存个人信息 + 购房需求 + 最晚提醒，不属于某一张卡片
      '<div class="section-head profile-head"><h2>设置</h2><span class="h-sub">个人信息 · 购房需求 · 最晚提醒</span>' +
        '<span class="spacer"></span><span id="pf-msg" class="msg"></span>' +
        '<button class="btn primary" id="pf-save">保存</button></div>' +
      '<div class="profile-grid">' +
        // 左栏：个人信息 + 顶部栏配色 + 购房最晚提醒
        '<div class="profile-col col-a">' +
          '<div class="profile-card">' +
            '<h4 class="pc-title">👤 个人信息</h4>' +
            '<div class="profile-avatar">' +
              '<span class="hv-avatar lg" id="pf-avatar"></span>' +
              '<div class="profile-avatar-ops">' +
                '<label class="btn primary" for="pf-file">上传头像</label>' +
                '<input type="file" id="pf-file" accept="image/*" hidden />' +
                '<button class="btn" id="pf-remove">移除头像</button>' +
              '</div>' +
            '</div>' +
            '<div class="form-grid one">' +
              '<div class="field"><label>昵称</label><input id="pf-name" value="' + esc(u.name || '') + '" placeholder="给自己起个名字" maxlength="40" /></div>' +
              '<div class="field"><label>邮箱（不可修改）</label><input value="' + esc(u.email || '') + '" disabled /></div>' +
            '</div>' +
          '</div>' +
          '<div class="profile-card">' +
            '<h4 class="pc-title">🎨 主题</h4>' +
            '<div class="theme-swatches">' +
              HEADER_THEMES.map((t) => '<button class="theme-swatch ' + t.id + (state.headerTheme === t.id ? ' active' : '') + '" data-theme="' + t.id + '" title="' + t.name + '"><span class="sw"></span><span class="nm">' + t.name + '</span></button>').join('') +
            '</div>' +
          '</div>' +
          // 最晚提醒移到左栏：左栏三张卡片与右栏「购房需求」一张卡片底边对齐
          '<div class="profile-card">' +
            '<h4 class="pc-title">⏰ 购房最晚提醒时间</h4>' +
            '<div class="deadline-row">' +
              '<label class="dl-switch"><input type="checkbox" id="d-deadline-on" ' + (dm.deadlineEnabled ? 'checked' : '') + '/> 开启提醒（默认关闭）</label>' +
              '<input id="d-deadline-date" type="date" value="' + esc(dm.deadlineDate || '') + '" ' + (dm.deadlineEnabled ? '' : 'disabled') + '/>' +
              '<span class="muted" id="d-deadline-hint" style="font-size:12px"></span>' +
            '</div>' +
            '<p class="muted" style="font-size:12px;margin:8px 0 0">开启并保存后，顶部栏中间会常驻显示剩余天数提醒。</p>' +
          '</div>' +
        '</div>' +
        // 右栏（宽）：购房需求，撑满左栏三张卡片的总高度
        '<div class="profile-col col-b">' +
          '<div class="profile-card">' +
            '<h4 class="pc-title">🎯 购房需求</h4>' +
            '<p class="muted" style="font-size:12px;margin:0 0 12px">记录你的意向要求；保存后到「房源列表」点「🎯 需求匹配」，会自动给已录入房源打分并筛出匹配度最高的（≥40 分）。也可在列表页点「🎯 需求匹配」直接弹窗填写。</p>' +
            '<div class="form-grid">' +
              '<div class="field"><label>预算上限（万）</label><input id="d-budgetMax" type="number" value="' + esc(dm.budgetMax != null ? dm.budgetMax : '') + '" placeholder="如 200"/></div>' +
              '<div class="field"><label>意向区域（多个用逗号分隔）</label><input id="d-districts" value="' + esc(dm.districts || '') + '" placeholder="如 高新区,天府新区"/></div>' +
              '<div class="field"><label>意向户型</label><input id="d-layout" value="' + esc(dm.layout || '') + '" placeholder="如 3室（按“N室”匹配）"/></div>' +
              '<div class="field"><label>面积范围（㎡）</label><div class="range-pair"><input id="d-areaMin" type="number" value="' + esc(dm.areaMin != null ? dm.areaMin : '') + '" placeholder="下限，如 80"/><span>—</span><input id="d-areaMax" type="number" value="' + esc(dm.areaMax != null ? dm.areaMax : '') + '" placeholder="上限，如 120"/></div></div>' +
              '<div class="field full"><label>必须满足</label>' +
                '<div class="checks">' +
                  '<label><input type="checkbox" id="d-subway" ' + (dm.needSubway ? 'checked' : '') + '/> 近地铁（≤1km）</label>' +
                  '<label><input type="checkbox" id="d-school" ' + (dm.needSchool ? 'checked' : '') + '/> 有学区</label>' +
                '</div>' +
              '</div>' +
              '<div class="field full"><label>补充说明</label><textarea id="d-notes" style="min-height:56px">' + esc(dm.notes || '') + '</textarea></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // 高德 Key：每用户自配。已保存的 Key / 密钥一律不回显（password 且 value 为空），
      // 留空表示不修改；Web 服务 Key 服务端专用，不下发前端。
      // 地图功能默认关闭：必须点「启用地图功能」后才加载高德脚本 / 显示地图分布菜单。
      '<div class="profile-card amap-card">' +
        '<h4 class="pc-title">🗺️ 高德地图 Key（每用户自配）</h4>' +
        '<div class="form-grid amap-key-grid">' +
          '<div class="field"><label>高德 JS API Key</label>' +
            '<div class="secret-row"><input id="amap-jskey" type="password" name="hvt-amap-jskey" data-secret-input="1" readonly autocomplete="new-password" spellcheck="false" placeholder="' +
              (u.amapJsKey ? '已配置 · 留空表示不修改；更换请直接输入新 Key' : '高德开放平台 → 创建应用 → 添加 Key（Web端 JS API）') +
            '"/><button type="button" class="btn" data-secret-toggle="amap-jskey">显示</button></div>' +
          '</div>' +
          '<div class="field"><label>高德安全密钥（securityJsCode）</label>' +
            '<div class="secret-row"><input id="amap-security" type="password" name="hvt-amap-security" data-secret-input="1" readonly autocomplete="new-password" spellcheck="false" placeholder="' +
              (u.amapSecurityCode ? '已配置 · 留空表示不修改' : '与左侧 Key 配套的安全密钥') +
            '"/><button type="button" class="btn" data-secret-toggle="amap-security">显示</button></div>' +
          '</div>' +
        '</div>' +
        '<div class="amap-enable-row">' +
          '<span class="muted" id="amap-state">' + (u.mapEnabled ? '✅ 地图功能已启用' : '⏸ 地图功能未启用') + '</span>' +
          '<button type="button" class="btn ' + (u.mapEnabled ? '' : 'primary') + '" id="amap-enable">' +
            (u.mapEnabled ? '⏸ 停用地图功能' : '🚀 启用地图功能') + '</button>' +
        '</div>' +
        '<p class="muted" id="amap-hint" style="font-size:12px;margin:8px 0 0"></p>' +
        '<div class="amap-actions">' +
          '<span class="muted" style="font-size:12px">已保存的 Key 与密钥不会回显；留空即保持原值。浏览器自动填入的登录密码会被忽略并清空。</span>' +
          (u.amapJsKey ? '<button type="button" class="btn" id="amap-clear">清除已保存的 Key</button>' : '') +
        '</div>' +
      '</div>' +
      // 长时间未操作自动退出：设置只存当前浏览器，不参与页级「保存」按钮（不属于用户资料）
      '<div class="profile-card idle-card">' +
        '<h4 class="pc-title">⏰ 自动退出</h4>' +
        '<div class="form-grid">' +
          '<div class="field"><label>无操作多久后自动退出</label>' +
            '<select id="idle-minutes" class="tb-in">' +
              IDLE_OPTIONS.map((m) => '<option value="' + m + '"' + (idleMinutes() === m ? ' selected' : '') + '>' +
                (m === 0 ? '不自动退出' : m + ' 分钟') + '</option>').join('') +
            '</select>' +
          '</div>' +
          '<div class="field"><label>当前状态</label><div class="muted" style="padding-top:8px" id="idle-state"></div></div>' +
        '</div>' +
        '<p class="muted" style="font-size:12px;margin:8px 0 0">鼠标移动、点击、输入、滚动都算「有操作」；到期前 1 分钟会提醒。自动退出会让后端令牌同时失效，需重新登录。该设置只保存在当前浏览器。</p>' +
      '</div>' +
      // 修改密码（P0）：校验原密码 → 换新哈希 → 后端自增 token_version 踢掉其它设备
      '<div class="profile-card pwd-card">' +
        '<h4 class="pc-title">🔒 修改密码</h4>' +
        '<div class="form-grid pwd-grid">' +
          '<div class="field"><label>原密码</label><input id="pwd-old" type="password" name="hvt-pwd-old" data-pwd-input="1" readonly autocomplete="new-password" placeholder="当前登录密码"/></div>' +
          '<div class="field"><label>新密码（至少 8 位）</label><input id="pwd-new" type="password" name="hvt-pwd-new" data-pwd-input="1" readonly autocomplete="new-password" placeholder="至少 8 位"/></div>' +
          '<div class="field"><label>确认新密码</label><input id="pwd-new2" type="password" name="hvt-pwd-new2" data-pwd-input="1" readonly autocomplete="new-password" placeholder="再输入一次"/></div>' +
        '</div>' +
        '<div class="pwd-actions">' +
          '<span class="muted" id="pwd-hint">修改成功后会退出登录，请用新密码重新登录；其它设备会同时下线。</span>' +
          '<button type="button" class="btn primary" id="pwd-change">修改密码</button>' +
        '</div>' +
      '</div>' +
      // 版本信息：全宽独立行，不参与左右两列的高度对齐
      '<div class="profile-version">' +
        '<span class="pv-mark">🏠</span>' +
        '<div class="pv-main"><b>看房记录与对比</b><span>本地部署 · Node.js + PostgreSQL · 数据仅自己可见</span></div>' +
        '<div class="pv-meta"><span>版本 <b>v' + esc(bv.tag) + '</b></span><span>构建于 ' + esc(bv.date) + '</span></div>' +
      '</div>';

    // 防浏览器密码自动填充：注册/登录后 Chrome 会把保存的登录密码填进任意 type=password
    // 输入框（autocomplete="off" 会被无视）。三重防护：
    // ① readonly 直到用户真正聚焦（浏览器不预填 readonly 字段）+ autocomplete="new-password"；
    // ② 只有触发过 input 事件（真人输入）才打 dirty 标记，保存时只认 dirty 的字段；
    // ③ 渲染后立刻 + 延迟清一遍未被真人输入过的残留值，兜住晚到的自动填充。
    const secretInputs = c.querySelectorAll('[data-secret-input]');
    const scrubSecretInputs = () => secretInputs.forEach((inp) => {
      if (inp.dataset.dirty !== '1') inp.value = '';
    });
    secretInputs.forEach((inp) => {
      const unlock = () => { if (inp.readOnly) inp.readOnly = false; };
      inp.addEventListener('focus', unlock);
      inp.addEventListener('click', unlock);
      inp.addEventListener('input', () => { inp.dataset.dirty = '1'; });
    });
    scrubSecretInputs();
    setTimeout(scrubSecretInputs, 300);

    // 修改密码（P0）：同样要防浏览器把登录密码自动填进这三个 password 框
    const pwdInputs = Array.from(c.querySelectorAll('[data-pwd-input]'));
    const scrubPwdInputs = () => pwdInputs.forEach((inp) => { if (inp.dataset.dirty !== '1') inp.value = ''; });
    pwdInputs.forEach((inp) => {
      const unlock = () => { if (inp.readOnly) inp.readOnly = false; };
      inp.addEventListener('focus', unlock);
      inp.addEventListener('click', unlock);
      inp.addEventListener('input', () => { inp.dataset.dirty = '1'; });
    });
    scrubPwdInputs();
    setTimeout(scrubPwdInputs, 300);
    const pwdChange = $('pwd-change');
    if (pwdChange) pwdChange.onclick = async () => {
      // 只认真人输入：浏览器密码管理器自动填充不会派发 input 事件，必须拦掉
      if (!pwdInputs.every((inp) => inp.dataset.dirty === '1')) {
        toast('请手动填写原密码、新密码和确认密码'); return;
      }
      const oldPw = $('pwd-old').value, newPw = $('pwd-new').value, newPw2 = $('pwd-new2').value;
      if (!oldPw || !newPw) { toast('请填写原密码和新密码'); return; }
      if (newPw.length < 8) { toast('新密码至少 8 位'); return; }
      if (newPw !== newPw2) { toast('两次输入的新密码不一致'); return; }
      pwdChange.disabled = true;
      try {
        await Api.changePassword(oldPw, newPw);
        pwdInputs.forEach((inp) => { inp.value = ''; inp.dataset.dirty = ''; });
        authNotice = '密码已修改，请用新密码重新登录';
        await Auth.signOut(); // 后端已自增 token_version，旧令牌立即失效
      } catch (e) {
        toast('修改失败：' + e.message);
      } finally { pwdChange.disabled = false; }
    };

    // 密钥输入框：默认 password 且不回显；「显示」只切换用户当前输入内容的可见性
    c.querySelectorAll('[data-secret-toggle]').forEach((b) => {
      b.onclick = () => {
        const inp = $(b.dataset.secretToggle);
        if (!inp) return;
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.textContent = show ? '隐藏' : '显示';
      };
    });
    // 启用 / 停用地图功能：持久化到用户资料；启用后立即注入高德脚本并显示「地图分布」菜单
    const amapEnable = $('amap-enable');
    if (amapEnable) amapEnable.onclick = async () => {
      const next = !mapEnabled();
      // 允许「先启用、后配置」：地图分布页会给出配置引导 + 跳转设置按钮
      if (next && !u.amapJsKey &&
          !window.confirm('还没有配置高德 Key。可以先启用，但地图分布页会提示你去配置 Key。确定继续启用吗？')) return;
      amapEnable.disabled = true;
      try {
        const rr = await Api.updateProfile({ mapEnabled: next });
        state.user = rr.data.user;
        Object.assign(u, state.user); // 同步闭包引用，保证后续读取到最新状态
        Api.setSession(Api.token(), state.user);
        syncMapMenu();
        applyAmapKey();
        toast(next ? '地图功能已启用' : '地图功能已停用', true);
        renderProfile(c);
      } catch (e) { toast('操作失败：' + e.message); amapEnable.disabled = false; }
    };
    // 清除已保存的 Key：显式传空串（后端 COALESCE 会把空串写入，达到清空效果）
    const amapClear = $('amap-clear');
    if (amapClear) amapClear.onclick = async () => {
      if (!window.confirm('确定清除已保存的高德 Key 与密钥吗？清除后地图 / 定位 / 周边配套将不可用。')) return;
      try {
        const rr = await Api.updateProfile({ amapJsKey: '', amapSecurityCode: '' });
        state.user = rr.data.user;
        Api.setSession(Api.token(), state.user);
        toast('已清除高德 Key，刷新页面后生效', true);
        renderProfile(c);
      } catch (e) { toast('清除失败：' + e.message); }
    };

    // 自动退出时长：改动立即生效并重新计时，不走页级「保存」按钮
    const idleSel = $('idle-minutes');
    const paintIdleState = () => {
      const el = $('idle-state');
      if (el) el.textContent = idleMinutes() ? ('已开启 · 闲置 ' + idleMinutes() + ' 分钟后退出') : '已关闭';
    };
    if (idleSel) idleSel.onchange = () => {
      const n = Number(idleSel.value);
      try { localStorage.setItem(IDLE_STORE_KEY, String(n)); } catch (e) {}
      idleKick();
      paintIdleState();
      toast(n ? ('自动退出已设为 ' + n + ' 分钟') : '自动退出已关闭', true);
    };
    paintIdleState();

    c.querySelectorAll('[data-theme]').forEach((b) => b.onclick = () => {
      state.headerTheme = b.dataset.theme;
      try { localStorage.setItem('hvt_header_theme', state.headerTheme); } catch (e) {}
      applyHeaderTheme();
      updateThemeToggle();
      c.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('active', x.dataset.theme === state.headerTheme));
      toast('主题已切换为「' + (HEADER_THEMES.find((t) => t.id === state.headerTheme) || {}).name + '」', true);
    });

    const av = $('pf-avatar');
    function paintAv() {
      if (u.avatar) { av.style.backgroundImage = 'url(' + u.avatar + ')'; av.textContent = ''; }
      else { av.style.backgroundImage = 'none'; av.textContent = initialOf(u); }
    }
    paintAv();
    // 高德 Key 配置状态提示
    const ah = $('amap-hint');
    if (ah) ah.innerHTML = (!u.amapJsKey
      ? '⚠️ 尚未配置高德 Key：填好上面两项并点「保存」，再点「启用地图功能」即可使用。'
      : (!u.mapEnabled
        ? '⚠️ Key 已配置，但地图功能尚未启用。点下方「启用地图功能」后才会加载地图并显示「地图分布」菜单。'
        : '✅ 已配置 Key 且地图功能已启用。如需更换，直接输入新的 Key 与密钥后保存（更换后请刷新页面）。'));
    // 头像改为二进制直传（与房源图片/视频同一条通道），不再转 base64：
    // 后端读 JSON 请求体有 1MB 上限，一张普通照片转 base64 就会超限被断开，
    // 前端会误报「无法连接服务器」，并连带中断整个保存流程（最晚提醒等字段也存不上）。
    let pendingFile = null;
    const fileInput = $('pf-file');
    if (fileInput) fileInput.onchange = (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      pendingFile = f;
      const rd = new FileReader(); // 仅用于本地预览，不参与上传
      rd.onload = () => { av.style.backgroundImage = 'url(' + rd.result + ')'; av.textContent = ''; };
      rd.readAsDataURL(f);
    };
    const rm = $('pf-remove');
    if (rm) rm.onclick = () => { pendingFile = null; u.avatar = ''; paintAv(); };
    // 最晚提醒：开关控制日期输入 + 剩余天数提示
    const dOn = $('d-deadline-on'), dDate = $('d-deadline-date'), dHint = $('d-deadline-hint');
    function paintDeadline() {
      if (!dOn || !dDate) return;
      dDate.disabled = !dOn.checked;
      if (!dHint) return;
      if (!dOn.checked) { dHint.textContent = '已关闭，顶部栏不会显示提醒。'; return; }
      if (!dDate.value) { dHint.textContent = '已开启，请选择日期。'; return; }
      const days = Math.ceil((new Date(dDate.value + 'T00:00:00') - new Date()) / 86400000);
      dHint.textContent = isNaN(days) ? '' : (days < 0 ? '该日期已过去。' : '距最晚购房时间还有 ' + days + ' 天，顶部栏会显示提醒。');
    }
    if (dOn) dOn.onchange = paintDeadline;
    if (dDate) dDate.onchange = paintDeadline;
    paintDeadline();
    const save = $('pf-save');
    if (save) save.onclick = async () => {
      const name = $('pf-name').value.trim();
      const msg = $('pf-msg');
      msg.style.color = 'var(--danger)'; msg.textContent = '';
      try {
        let avatar = pendingFile ? '__pending__' : (u.avatar || '');
        if (avatar === '__pending__') {
          const up = await Store.uploadFile(pendingFile, 'avatar');
          avatar = up.url || '';
        }
        // 购房需求 + 最晚提醒（与个人信息一起保存）
        const demand = {
          budgetMax: parseFloat($('d-budgetMax').value) || '',
          districts: $('d-districts').value.trim(),
          layout: $('d-layout').value.trim(),
          areaMin: parseFloat($('d-areaMin').value) || '',
          areaMax: parseFloat($('d-areaMax').value) || '',
          needSubway: $('d-subway').checked,
          needSchool: $('d-school').checked,
          notes: $('d-notes').value.trim(),
          deadlineEnabled: $('d-deadline-on').checked,
          deadlineDate: $('d-deadline-on').checked ? $('d-deadline-date').value : ''
        };
        // 高德 Key 默认不回显：留空 = 不修改（后端 COALESCE 保持原值）。
        // 只认「真人输入过」的字段（data-dirty），浏览器密码自动填充的值一律忽略，
        // 避免把登录密码误存成高德 Key。
        const patch = { name, avatar, demand };
        const jsEl = $('amap-jskey'), secEl = $('amap-security');
        const newJsKey = (jsEl && jsEl.dataset.dirty === '1') ? jsEl.value.trim() : '';
        const newSec = (secEl && secEl.dataset.dirty === '1') ? secEl.value.trim() : '';
        // 弱格式兜底：只挡明显不是 Key 的值（太短 / 太长 / 含空格或特殊符号，例如被误填的登录密码），
        // 不硬卡 32 位十六进制，避免误伤其它合法格式。
        const saneKey = (v) => v.length >= 16 && v.length <= 64 && /^[0-9a-zA-Z_-]+$/.test(v);
        if (newJsKey && !saneKey(newJsKey)) { msg.textContent = '高德 JS API Key 格式不对，请检查是否误填了登录密码'; return; }
        if (newSec && !saneKey(newSec)) { msg.textContent = '高德安全密钥格式不对，请检查是否误填了登录密码'; return; }
        const oldJsKey = (u.amapJsKey || '').trim();
        if (newJsKey) patch.amapJsKey = newJsKey;
        if (newSec) patch.amapSecurityCode = newSec;
        const r = await Api.updateProfile(patch);
        // 保存成功后清空输入框并复位 dirty，避免再次点「保存」把同一份 Key 重复提交
        [jsEl, secEl].forEach((inp) => { if (inp) { inp.value = ''; delete inp.dataset.dirty; } });
        state.user = r.data.user;
        Object.assign(u, state.user); // 同步闭包引用：paintAv 才能用新的头像 URL 重绘
        pendingFile = null;           // 清掉待上传文件，避免再次点保存时重复上传
        Api.setSession(Api.token(), state.user);
        applyAmapKey();               // 若改了高德 Key，立即重新注入
        renderUser();
        paintAv();
        paintDeadline();
        // 换了 Key 时高德脚本已在页面里加载过（_amapLoaded 防重复），需刷新才能用新 Key
        const keyChanged = newJsKey && newJsKey !== oldJsKey;
        msg.style.color = 'var(--ok)';
        msg.textContent = keyChanged ? '已保存 · 请刷新页面使新高德 Key 生效' : '已保存';
        toast(keyChanged ? '设置已保存，刷新页面后新 Key 生效' : '设置已保存', true);
      } catch (err) { msg.textContent = err.message; }
    };
  }

  // ---------- 房贷计算（参考贝壳/链家/银行实现）----------
  async function renderMortgage(c) {
    c.classList.add('m-page-host'); // 让整页填满视口，内部区域各自滚动，页面本身不出现滚动条
    if (!(state.properties && state.properties.length)) {
      try { state.properties = await Store.list(); } catch (e) { state.properties = []; }
    }
    const propOptions = (state.properties || []).map((p) => {
      const loc = p.location || {}, tran = p.transaction || {};
      const title = p.title || loc.community || '未命名';
      const price = tran.totalPrice ? (' ｜ ' + tran.totalPrice + '万') : '';
      return '<option value="' + p.id + '">' + esc(title) + price + '</option>';
    }).join('');
    c.innerHTML = `
    <div class="m-page">
      <div class="m-head">
        <p class="m-tip">支持商业贷款、公积金贷款、组合贷款，等额本息 / 等额本金两种还款方式，实时计算月供、总利息与逐月还款明细。结果仅供参考，以银行实际批复为准。</p>
      </div>
      <div class="m-grid">
        <div class="m-card m-form">
          <div class="m-row" id="m-prop-row">
            <label>选择房源（可选，自动带入房价）</label>
            <select id="m-prop" class="tb-in">
              <option value="">— 不选，手动输入 —</option>
              ${propOptions}
            </select>
            <div class="m-prop-info hidden" id="m-prop-info"></div>
          </div>
          <div class="m-seg" id="m-calcmode">
            <button class="m-seg-btn active" data-cm="price">按房价总额</button>
            <button class="m-seg-btn" data-cm="loan">按贷款金额</button>
          </div>

          <div class="m-block" data-cm-block="price">
            <div class="m-row">
              <label>房屋总价（万元）</label>
              <input id="m-price" class="tb-in" type="number" min="0" step="1" value="200">
            </div>
            <div class="m-row">
              <label>首付比例</label>
              <select id="m-down" class="tb-in">
                <option value="0.15">15%（首套最低）</option>
                <option value="0.2">20%</option>
                <option value="0.25">25%</option>
                <option value="0.3" selected>30%（通用）</option>
                <option value="0.4">40%</option>
                <option value="0.5">50%</option>
                <option value="0.7">70%</option>
                <option value="0.8">80%</option>
                <option value="1">全款</option>
              </select>
            </div>
          </div>

          <div class="m-block hidden" data-cm-block="loan">
            <div class="m-row">
              <label>贷款金额（万元）</label>
              <input id="m-loan" class="tb-in" type="number" min="0" step="1" value="140">
            </div>
          </div>

          <div class="m-row">
            <label>贷款类型</label>
            <select id="m-loantype" class="tb-in">
              <option value="comm" selected>商业贷款</option>
              <option value="fund">公积金贷款</option>
              <option value="combo">组合贷款</option>
            </select>
          </div>

          <div class="m-block hidden" id="m-combo-block">
            <div class="m-row">
              <label>商贷金额（万元）</label>
              <input id="m-comm-amt" class="tb-in" type="number" min="0" step="1" value="100">
            </div>
            <div class="m-row">
              <label>公积金金额（万元）</label>
              <input id="m-fund-amt" class="tb-in" type="number" min="0" step="1" value="40">
            </div>
          </div>

          <div class="m-row">
            <label>贷款年限</label>
            <div class="m-inline">
              <input id="m-years" class="tb-in" type="number" min="1" max="30" step="1" value="30">
              <span class="m-unit">年（最长 30）</span>
            </div>
          </div>

          <div class="m-row" id="m-comm-rate-row">
            <label>商贷年利率</label>
            <div class="m-presets" id="m-comm-presets">
              <button type="button" data-rate="3.0">商贷 3.0%（现行）</button>
              <button type="button" data-rate="3.5">LPR 3.5%</button>
            </div>
            <input id="m-comm-rate" class="tb-in" type="number" min="0" step="0.01" value="3.0">
          </div>

          <div class="m-row" id="m-fund-rate-row">
            <label>公积金年利率</label>
            <div class="m-presets" id="m-fund-presets">
              <button type="button" data-rate="2.6">公积金 2.6%（首套）</button>
              <button type="button" data-rate="3.075">公积金 3.075%（二套）</button>
            </div>
            <input id="m-fund-rate" class="tb-in" type="number" min="0" step="0.01" value="2.6">
          </div>

          <div class="m-row">
            <label>还款方式</label>
            <div class="m-seg" id="m-method">
              <button class="m-seg-btn active" data-m="bx">等额本息</button>
              <button class="m-seg-btn" data-m="bj">等额本金</button>
            </div>
          </div>
        </div>

        <div class="m-card m-result">
          <div class="m-kpis">
            <div class="m-kpi"><div class="m-kpi-num" id="m-r-down">—</div><div class="m-kpi-label">首付</div></div>
            <div class="m-kpi"><div class="m-kpi-num" id="m-r-loan">—</div><div class="m-kpi-label">贷款总额</div></div>
            <div class="m-kpi m-kpi-main"><div class="m-kpi-num" id="m-r-month">—</div><div class="m-kpi-label" id="m-r-month-label">月供</div></div>
            <div class="m-kpi"><div class="m-kpi-num" id="m-r-interest">—</div><div class="m-kpi-label">总利息</div></div>
            <div class="m-kpi"><div class="m-kpi-num" id="m-r-total">—</div><div class="m-kpi-label">还款总额</div></div>
          </div>
          <div class="m-note" id="m-r-note"></div>
          <div class="m-sched-head">
            <div class="m-seg m-seg-sm" id="m-schedmode">
              <button class="m-seg-btn active" data-sm="month">按月明细</button>
              <button class="m-seg-btn" data-sm="year">按年明细</button>
            </div>
            <span class="m-sched-hint">共 <b id="m-r-months">0</b> 期</span>
          </div>
          <div class="m-sched-wrap">
            <table class="m-sched">
              <thead id="m-sched-thead"><tr><th>期数</th><th>月供</th><th>本金</th><th>利息</th><th>剩余本金</th></tr></thead>
              <tbody id="m-sched-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;

    // 计算公式已抽到文件顶部 computeMortgage()（全应用唯一实现），本页只负责取表单值 + 渲染，
    // 不要再在这里写第二份公式；以后改公式改顶部那一处即可。

    const m$ = (id) => document.getElementById(id);
    let schedView = 'month';
    const fmtY = (v) => (v / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + ' 万';
    const fmtYuan = (v) => '¥' + Math.round(v).toLocaleString('zh-CN');

    function recalc() {
      const cm = document.querySelector('#m-calcmode .active').dataset.cm;
      const method = document.querySelector('#m-method .active').dataset.m;
      // 本页只收集表单值，计算全部交给顶部唯一的 computeMortgage()，改公式只改那一处
      const R = computeMortgage({
        mode: cm,
        totalPrice: (parseFloat(m$('m-price').value) || 0) * 10000,
        loanAmt: (parseFloat(m$('m-loan').value) || 0) * 10000,
        downRatio: parseFloat(m$('m-down').value) || 0,
        years: m$('m-years').value,
        loanType: m$('m-loantype').value,
        commRate: m$('m-comm-rate').value,
        fundRate: m$('m-fund-rate').value,
        commAmt: (parseFloat(m$('m-comm-amt').value) || 0) * 10000,
        fundAmt: (parseFloat(m$('m-fund-amt').value) || 0) * 10000,
        method
      });
      const { months, sched, totalInterest, totalPayment, monthlyFirst, monthlyLast, downPay, loanAmt } = R;
      const type = R.type;

      m$('m-r-down').textContent = (cm === 'price' && downPay > 0) ? fmtY(downPay) : '—';
      m$('m-r-loan').textContent = fmtY(loanAmt);
      if (method === 'bx') {
        m$('m-r-month').textContent = fmtYuan(monthlyFirst);
        m$('m-r-month-label').textContent = '月供（每月固定）';
      } else {
        m$('m-r-month').textContent = fmtYuan(monthlyFirst);
        m$('m-r-month-label').textContent = '首月月供（逐月递减）';
      }
      m$('m-r-interest').textContent = fmtY(totalInterest);
      m$('m-r-total').textContent = fmtY(totalPayment);
      m$('m-r-months').textContent = months;

      let note = '';
      if (method === 'bj') {
        const dec = months > 1 ? (monthlyFirst - monthlyLast) / (months - 1) : 0;
        note = '等额本金：首月 ' + fmtYuan(monthlyFirst) + '，末月 ' + fmtYuan(monthlyLast) + '，每月递减约 ' + fmtYuan(dec) + '。';
      }
      if (type === 'combo') note += (note ? ' ' : '') + '组合贷：商贷与公积金分别按各自利率计算后按月相加。';
      m$('m-r-note').textContent = note;
      m$('m-r-note').classList.toggle('hidden', !note);

      // 按月 / 按年 明细
      const thead = m$('m-sched-thead');
      const body = m$('m-sched-body');
      if (schedView === 'year') {
        thead.innerHTML = '<tr><th>年份</th><th>年供合计</th><th>年本金</th><th>年利息</th><th>年末剩余本金</th></tr>';
        const yearsN = Math.ceil(months / 12);
        let rows = '';
        for (let y = 1; y <= yearsN; y++) {
          const start = (y - 1) * 12, end = Math.min(y * 12, months);
          let yPay = 0, yPrin = 0, yInt = 0, yRemain = 0;
          for (let k = start; k < end; k++) { const s = sched[k]; if (!s) continue; yPay += s.monthly; yPrin += s.principalPart; yInt += s.interest; yRemain = s.remain; }
          rows += '<tr><td>' + y + '</td><td>' + fmtYuan(yPay) + '</td><td>' + fmtYuan(yPrin) + '</td><td>' + fmtYuan(yInt) + '</td><td>' + fmtYuan(yRemain) + '</td></tr>';
        }
        body.innerHTML = rows;
      } else {
        thead.innerHTML = '<tr><th>期数</th><th>月供</th><th>本金</th><th>利息</th><th>剩余本金</th></tr>';
        body.innerHTML = sched.map((s) =>
          '<tr><td>' + s.k + '</td><td>' + fmtYuan(s.monthly) + '</td><td>' + fmtYuan(s.principalPart) + '</td><td>' + fmtYuan(s.interest) + '</td><td>' + fmtYuan(s.remain) + '</td></tr>'
        ).join('');
      }
    }

    function setActive(group, btn) {
      group.querySelectorAll('.m-seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    }
    function applyCalcMode(mode) {
      const grp = m$('m-calcmode');
      grp.querySelectorAll('.m-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.cm === mode));
      document.querySelectorAll('[data-cm-block]').forEach((el) => el.classList.toggle('hidden', el.dataset.cmBlock !== mode));
    }
    document.querySelectorAll('#m-calcmode .m-seg-btn').forEach((b) => b.onclick = () => {
      applyCalcMode(b.dataset.cm);
      recalc();
    });
    document.querySelectorAll('#m-method .m-seg-btn').forEach((b) => b.onclick = () => { setActive(m$('m-method'), b); recalc(); });
    // 按月 / 按年 明细切换
    document.querySelectorAll('#m-schedmode .m-seg-btn').forEach((b) => b.onclick = () => {
      setActive(m$('m-schedmode'), b);
      schedView = b.dataset.sm;
      recalc();
    });
    // 选择房源：带入房价与房源信息
    m$('m-prop').onchange = () => {
      const id = m$('m-prop').value;
      const info = m$('m-prop-info');
      if (!id) { info.textContent = ''; info.classList.add('hidden'); recalc(); return; }
      const p = (state.properties || []).find((x) => String(x.id) === String(id));
      if (!p) { info.textContent = ''; info.classList.add('hidden'); return; }
      const loc = p.location || {}, attr = p.attributes || {}, tran = p.transaction || {};
      if (tran.totalPrice != null && tran.totalPrice !== '') {
        m$('m-price').value = tran.totalPrice;
        applyCalcMode('price');
      }
      const bits = [];
      if (loc.community) bits.push('小区：' + loc.community);
      if (attr.area) bits.push('面积：' + attr.area + '㎡');
      if (attr.layout) bits.push('户型：' + attr.layout);
      if (tran.status) bits.push('状态：' + tran.status);
      info.textContent = bits.length ? ('已带入 ｜ ' + bits.join(' ｜ ')) : '';
      info.classList.toggle('hidden', !bits.length);
      recalc();
    };
    m$('m-loantype').onchange = () => {
      const t = m$('m-loantype').value;
      m$('m-combo-block').classList.toggle('hidden', t !== 'combo');
      m$('m-fund-rate-row').classList.toggle('hidden', t === 'comm');
      m$('m-comm-rate-row').classList.toggle('hidden', t === 'fund');
      recalc();
    };
    ['m-price', 'm-down', 'm-loan', 'm-comm-amt', 'm-fund-amt', 'm-years', 'm-comm-rate', 'm-fund-rate'].forEach((id) => {
      const el = m$(id); if (!el) return;
      el.addEventListener('input', recalc);
      el.addEventListener('change', recalc);
    });
    document.querySelectorAll('#m-comm-presets button').forEach((b) => b.onclick = () => { m$('m-comm-rate').value = b.dataset.rate; recalc(); });
    document.querySelectorAll('#m-fund-presets button').forEach((b) => b.onclick = () => { m$('m-fund-rate').value = b.dataset.rate; recalc(); });

    // 初始可见性（默认商业贷款）
    m$('m-combo-block').classList.add('hidden');
    m$('m-fund-rate-row').classList.add('hidden');
    m$('m-comm-rate-row').classList.remove('hidden');
    recalc();
  }

  // 地图功能总开关：用户在「设置 → 高德地图 Key」点「启用」后才加载高德 / 显示地图分布菜单。
  // 未启用时 APP_CONFIG.AMAP_KEY 保持为空，Geo.hasKey() 为 false，所有地图能力自动不生效。
  function mapEnabled() { return !!(state.user && state.user.mapEnabled); }
  function syncMapMenu() {
    const on = mapEnabled();
    document.querySelectorAll('[data-view="map"]').forEach((el) => el.classList.toggle('hidden', !on));
  }
  // 启动时从服务端刷新用户资料（含 mapEnabled），避免 localStorage 里的旧对象缺字段导致误判
  async function refreshUserProfile() {
    try {
      const r = await Api.me();
      if (r && r.data && r.data.user) {
        state.user = r.data.user;
        Api.setSession(Api.token(), state.user);
        syncMapMenu();
        applyAmapKey();
        if (state.view === 'map') renderView('map');
      }
    } catch (e) { /* 会话过期时保持本地状态，后续请求自然返回 401 */ }
  }

  // 高德 Key 动态加载：登录 + 已启用地图 + 已配置 Key 才注入脚本（不再写死在前端）
  function applyAmapKey() {
    const u = state.user || {};
    const k = (u.amapJsKey || '').trim();
    const sc = (u.amapSecurityCode || '').trim();
    if (mapEnabled() && k) {
      window.APP_CONFIG.AMAP_KEY = k;
      window.APP_CONFIG.AMAP_SECURITY_CODE = sc;
      if (!window._amapLoaded) {
        try { window._AMapSecurityConfig = { securityJsCode: sc }; } catch (e) {}
        const s = document.createElement('script');
        s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(k) +
          '&plugin=AMap.Geocoder,AMap.Marker,AMap.InfoWindow,AMap.Driving,AMap.PlaceSearch';
        s.onerror = () => toast('高德地图脚本加载失败，请检查 Key 或网络');
        document.head.appendChild(s);
        window._amapLoaded = true;
      }
    } else {
      window.APP_CONFIG.AMAP_KEY = '';
      window.APP_CONFIG.AMAP_SECURITY_CODE = '';
    }
  }

  // ---------- 长时间未操作自动退出 ----------
  // 时长只存当前浏览器 localStorage（每设备独立，不写后端用户表）。
  // 仅已登录时计时；到期前 1 分钟提醒；到期调 Auth.signOut() 让后端 token_version
  // 自增、旧令牌立即失效，必须重新登录。
  const IDLE_OPTIONS = [0, 15, 30, 60, 120];
  const IDLE_STORE_KEY = 'hvt_idle_minutes';
  let idleLogoutTimer = null, idleWarnTimer = null, idleLastReset = 0;

  function idleMinutes() {
    try {
      const raw = localStorage.getItem(IDLE_STORE_KEY);
      // 坑：Number(null) === 0，而 0 是合法的「不自动退出」选项。
      // 必须先判 null，否则从没设置过的用户会被当成「已关闭」，自动退出默认不生效。
      if (raw === null) return 30;
      const n = Number(raw);
      if (IDLE_OPTIONS.indexOf(n) !== -1) return n;
    } catch (e) {}
    return 30; // 默认 30 分钟
  }
  function idleStop() {
    clearTimeout(idleLogoutTimer); clearTimeout(idleWarnTimer);
    idleLogoutTimer = idleWarnTimer = null;
  }
  function idleKick() {
    idleStop();
    const mins = idleMinutes();
    if (!mins || !Auth.getSession().session) return;
    const total = mins * 60 * 1000;
    if (total > 60 * 1000) {
      idleWarnTimer = setTimeout(() => {
        toast('长时间未操作，1 分钟后将自动退出；动一下鼠标或按任意键可继续保持登录');
      }, total - 60 * 1000);
    }
    idleLogoutTimer = setTimeout(idleAutoLogout, total);
  }
  async function idleAutoLogout() {
    idleStop();
    // 先置提示，再由 Auth.signOut() 触发 SIGNED_OUT → showAuth() 消费它，无竞态
    authNotice = '⏰ 因长时间未操作已自动退出，请重新登录';
    try { await Auth.signOut(); } catch (e) { /* 网络异常也必须清掉本地会话 */ }
  }
  function idleActivity() {
    const now = Date.now();
    if (now - idleLastReset < 1000) return; // mousemove 高频触发，1 秒节流
    idleLastReset = now;
    if (!Auth.getSession().session) return;
    idleKick();
  }
  function initIdleGuard() {
    ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart', 'click', 'input'].forEach((ev) => {
      document.addEventListener(ev, idleActivity, { passive: true, capture: true });
    });
    // 后台标签页的 timer 会被浏览器节流，重新可见时按当前状态重新计时
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Auth.getSession().session) idleKick();
    });
  }

  async function boot() {
    Auth.init();
    loadSavedView(); // 恢复上次停留的菜单，刷新浏览器不回到房源列表
    // 点击任意菜单（含当前菜单）：重置筛选与页面内容
    document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { resetListFilters(); setView(b.dataset.view); });
    // 侧边栏收起 / 展开（状态持久化到 localStorage）
    const sb = document.getElementById('sidebar');
    const sbt = document.getElementById('sidebar-toggle');
    function applySidebar(collapsed) {
      if (sb) sb.classList.toggle('collapsed', collapsed);
      if (sbt) sbt.textContent = collapsed ? '›' : '‹';
      try { localStorage.setItem('hvt_sidebar_collapsed', collapsed ? '1' : '0'); } catch (e) {}
    }
    if (sbt) {
      if (localStorage.getItem('hvt_sidebar_collapsed') === '1') applySidebar(true);
      sbt.onclick = () => applySidebar(!sb.classList.contains('collapsed'));
    }
    $('logout-btn').onclick = async () => { await Auth.signOut(); };
    const tt = document.getElementById('theme-toggle');
    if (tt) tt.onclick = toggleTheme;
    // 头部全局搜索：联动列表筛选
    const gs = document.getElementById('global-search');
    if (gs) gs.oninput = (e) => {
      state.filters.q = e.target.value;
      if (state.view === 'list') {
        const fq = document.getElementById('f-q'); if (fq) fq.value = e.target.value;
        renderListInner($('content'), state.properties);
      } else setView('list');
    };
    // 事件委托：列表页“导入示例数据”按钮（列表/空列表都挂载在 #content 内）
    $('content').addEventListener('click', (e) => {
      if (e.target.closest('#seed-demo')) doSeed();
    });
    // 点击外部关闭“录入”下拉菜单
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('add-menu');
      if (menu && !e.target.closest('.dd')) menu.classList.add('hidden');
    });
    // 放大地图弹窗：拖动右下角调整大小（全局只注册一次）
    document.addEventListener('mousemove', (e) => {
      if (!rz.dragging) return;
      const box = document.getElementById('map-modal-box');
      if (!box) return;
      const w = Math.min(Math.max(rz.w + (e.clientX - rz.x), 520), window.innerWidth - 32);
      const h = Math.min(Math.max(rz.h + (e.clientY - rz.y), 300), window.innerHeight - 32);      box.style.width = w + 'px';
      box.style.height = h + 'px';
      try { if (bigMap && typeof bigMap.resize === 'function') bigMap.resize(); } catch (err) {}
    });
    document.addEventListener('mouseup', () => {
      if (!rz.dragging) return;
      rz.dragging = false;
      setTimeout(() => { try { if (bigMap && typeof bigMap.resize === 'function') bigMap.resize(); } catch (err) {} window.dispatchEvent(new Event('resize')); }, 60);
    });
    // 顶部栏配色（本地记忆）+ 每次进入应用重置勾选状态
    try {
      const th = localStorage.getItem('hvt_header_theme');
      if (th && HEADER_THEMES.some((t) => t.id === th)) state.headerTheme = th;
    } catch (e) {}
    applyHeaderTheme();
    updateThemeToggle();
    // 批量选择与勾选模式每次进入应用重置；对比勾选按用户持久化（见 loadCompareSel）
    state.selected = new Set(); state.batchSel.clear(); state.pickMode = null; state.page = 1;

    const s = Auth.getSession();
    if (s.session) {
      state.user = s.session.user;
      applyAmapKey();       // 已登录 + 已启用地图 + 已配置 Key 才注入高德脚本
      refreshUserProfile(); // 后台校准 mapEnabled 等资料，避免本地缓存过期
      loadCompareSel();     // 恢复上次的对比勾选记录
      showApp();
    } else {
      showAuth();
    }
    Auth.onAuthStateChange((_event, session) => {
      if (session) { state.user = session.user; applyAmapKey(); syncMapMenu(); loadCompareSel(); showApp(); idleKick(); }
      else { state.user = null; applyAmapKey(); syncMapMenu(); showAuth(); idleStop(); }
    });
    initIdleGuard();
    if (s.session) idleKick(); // 刷新页面时本地会话仍在，也要开始计时
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

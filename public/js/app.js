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

  // ---------- 模型类型（唯一权威白名单在 ai-providers.js 的 MODEL_TYPES，
  // 由 contract.js 断言两边逐项一致；这里只补中文名。类型只做标注，不参与选路） ----------
  const AI_MODEL_TYPES = [
    { id: 'llm', name: '大语言' },
    { id: 'vision', name: '视觉' },
    { id: 'multimodal', name: '多模态' },
    { id: 'reasoning', name: '推理' },
    { id: 'code', name: '代码' },
    { id: 'embedding', name: '嵌入' },
    { id: 'other', name: '其他' }
  ];
  // ---------- AI 服务商预设（唯一数据源，勿在别处再列一份） ----------
  // 只收录 OpenAI 兼容 /chat/completions 端点。一家服务商共用一个接口地址 + 一个 API Key，
  // 下面挂多个具体模型；模型名变动很快，每行都能改 / 加 / 删，预设只是起点。
  const AI_PROVIDER_PRESETS = [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', logo: 'D', kind: '国内', models: [
      { id: 'chat', name: 'DeepSeek Chat', model: 'deepseek-chat', type: 'llm' },
      { id: 'reasoner', name: 'DeepSeek Reasoner', model: 'deepseek-reasoner', type: 'reasoning' },
      { id: 'v4flash', name: 'V4 Flash', model: 'deepseek-v4-flash', type: 'llm' }
    ] },
    { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', logo: '通', kind: '国内', models: [
      { id: 'plus', name: 'Qwen Plus', model: 'qwen-plus', type: 'llm' },
      { id: 'q35plus', name: 'Qwen3.5 Plus', model: 'qwen3.5-plus', type: 'multimodal' },
      { id: 'vlmax', name: 'Qwen VL Max', model: 'qwen-vl-max', type: 'vision' }
    ] },
    { id: 'doubao', name: '豆包 · 火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', logo: '豆', kind: '国内', models: [
      { id: 'seedpro', name: 'Seed 2.0 Pro', model: 'doubao-seed-2-0-pro-260215', type: 'multimodal' },
      { id: 'seedlite', name: 'Seed 2.0 Lite', model: 'doubao-seed-2-0-lite-260428', type: 'llm' },
      { id: 'vision', name: 'Vision Pro', model: 'doubao-1.5-vision-pro-32k-250115', type: 'vision' }
    ] },
    { id: 'glm', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', logo: 'G', kind: '国内', models: [
      { id: 'glm46', name: 'GLM-4.6', model: 'glm-4.6', type: 'llm' },
      { id: 'glm52', name: 'GLM-5.2', model: 'glm-5.2', type: 'reasoning' },
      { id: 'glm46v', name: 'GLM-4.6V', model: 'glm-4.6v', type: 'vision' }
    ] },
    { id: 'kimi', name: 'Kimi · 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', logo: 'K', kind: '国内', models: [
      { id: 'v18k', name: 'Moonshot 8K', model: 'moonshot-v1-8k', type: 'llm' },
      { id: 'k26', name: 'Kimi K2.6', model: 'kimi-k2.6', type: 'multimodal' },
      { id: 'vision', name: 'Moonshot Vision', model: 'moonshot-v1-8k-vision-preview', type: 'vision' }
    ] },
    { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', logo: '硅', kind: '国内', models: [
      { id: 'dsv3', name: 'DeepSeek V3', model: 'deepseek-ai/DeepSeek-V3', type: 'llm' },
      { id: 'qwen3vl', name: 'Qwen3 VL 32B', model: 'Qwen/Qwen3-VL-32B-Instruct', type: 'vision' },
      { id: 'bgem3', name: 'BGE-M3', model: 'BAAI/bge-m3', type: 'embedding' }
    ] },
    { id: 'hunyuan', name: '腾讯混元', baseUrl: 'https://tokenhub.tencentmaas.com/v1', logo: '混', kind: '国内', models: [
      { id: 'hy4', name: 'HY4 Preview', model: 'hy4-preview', type: 'llm' },
      { id: 'turbos', name: 'Hunyuan TurboS', model: 'hunyuan-turbos', type: 'llm' },
      { id: 'vision', name: 'Hunyuan Vision', model: 'hunyuan-vision', type: 'vision' }
    ] },
    { id: 'qianfan', name: '百度千帆', baseUrl: 'https://qianfan.baidubce.com/v2', logo: '千', kind: '国内', models: [
      { id: 'e45t', name: 'ERNIE 4.5 Turbo', model: 'ernie-4.5-turbo-128k', type: 'llm' },
      { id: 'e45', name: 'ERNIE 4.5', model: 'ernie-4.5-8k', type: 'llm' },
      { id: 'e5', name: 'ERNIE 5', model: 'ernie-5.0', type: 'reasoning' }
    ] },
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', logo: 'O', kind: '海外', models: [
      { id: 'gpt4o', name: 'GPT-4o', model: 'gpt-4o', type: 'multimodal' },
      { id: 'mini', name: 'GPT-4o mini', model: 'gpt-4o-mini', type: 'llm' },
      { id: 'gpt54', name: 'GPT-5.4', model: 'gpt-5.4', type: 'reasoning' }
    ] },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', logo: 'R', kind: '聚合', models: [
      { id: 'gpt4o', name: 'openai/gpt-4o', model: 'openai/gpt-4o', type: 'multimodal' },
      { id: 'claude', name: 'claude-sonnet-5', model: 'anthropic/claude-sonnet-5', type: 'llm' },
      { id: 'gemini', name: 'gemini-2.5-flash', model: 'google/gemini-2.5-flash', type: 'multimodal' }
    ] }
  ];
  // 设置页左侧分组导航（7 组，默认打开「个人信息」）。
  // 只切换显示，所有卡片始终在 DOM 里，页级「保存」行为不变。
  const SETTINGS_GROUPS = [
    { id: 'personal', name: '个人信息', icon: '👤' },
    { id: 'appearance', name: '外观设置', icon: '🎨' },
    { id: 'demand', name: '购房需求', icon: '🎯' },
    { id: 'map', name: '地图服务', icon: '🗺️' },
    { id: 'ai', name: 'AI 功能', icon: '🤖' },
    { id: 'security', name: '安全设置', icon: '🔒' },
    { id: 'monitor', name: '运行监控', icon: '📈' },
    { id: 'about', name: '关于', icon: 'ℹ️' }
  ];
  const SETTINGS_DEFAULT_GROUP = 'personal';
  // 记住当前打开的分组：保存 / 切页重绘后不跳回第一项
  let settingsCurrentGroup = SETTINGS_DEFAULT_GROUP;

  // ---------- 用户级配置：users.demand 统一读写（勿删） ----------
  // demand 是「整体覆盖」语义：看房驾驶 / 购房计划的数据挂在 dashboard / plan 两个子键里，
  // 因此任何一处保存都必须先合并旧值再提交，否则设置页、购房需求弹窗会把新子键清掉。
  // 后端 PATCH /api/auth/me 早已支持 demand，所以这里不需要改 server.js、也不需要重启 8787。
  function demandNow() { return (state.user && state.user.demand) || {}; }
  async function saveDemandSection(section, value) {
    const demand = Object.assign({}, demandNow(), { [section]: value });
    const r = await Api.updateProfile({ demand });
    state.user = r.data.user;
    Api.setSession(Api.token(), state.user);
    applyAmapKey();
    return state.user;
  }
  // 页面内编辑自动保存：输入停顿 350ms 后合并提交，避免每次按键都发请求。
  // 关键：先同步写进内存里的 demand（并落到 session），否则「刚填完就切菜单」时
  // 新页面会从旧 demand 重新初始化，看起来像数据丢了；后端提交仍由 debounce 合并。
  function makeAutoSave(section, getVal, statusEl) {
    let timer = null;
    return () => {
      clearTimeout(timer);
      if (state.user) {
        state.user = Object.assign({}, state.user, {
          demand: Object.assign({}, demandNow(), { [section]: getVal() })
        });
        try { Api.setSession(Api.token(), state.user); } catch (e) {}
      }
      if (statusEl) statusEl.textContent = '保存中…';
      timer = setTimeout(async () => {
        try {
          await saveDemandSection(section, getVal());
          if (statusEl) statusEl.textContent = '✅ 已自动保存到账号';
        } catch (e) {
          if (statusEl) statusEl.textContent = '保存失败：' + e.message;
        }
      }, 350);
    };
  }

  // ---------- 字段路径读写（CSV 导入导出用）----------
  // 房源字段清单唯一来源：public/js/property-schema.json（boot 启动时加载）。
  // 系统录入 / CSV 导入导出、安居客采集插件、验证脚本都读这一份，别在这里再硬编码一份 CSV_COLS。
  let CSV_COLS = [];
  async function loadPropertySchema() {
    const r = await fetch('/js/property-schema.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('字段清单加载失败（HTTP ' + r.status + '）');
    const j = await r.json();
    if (!Array.isArray(j.csvCols) || !j.csvCols.length) throw new Error('字段清单格式不正确');
    CSV_COLS = j.csvCols;
    // 外链图片规则与插件共用同一份；必须在首次 Store.list() 之前注入，
    // 这样历史房源里已存坏的贝壳原图链接在读取时就能自动修好。
    if (j.imageRules) Store.configureMediaRules(j.imageRules);
  }
  function getPath(o, path) { let v = o; for (const k of path.split('.')) { if (v == null) return ''; v = v[k]; } return v == null ? '' : v; }
  function setPath(o, path, val) {
    const ks = path.split('.'); let v = o;
    for (let i = 0; i < ks.length - 1; i++) { if (v[ks[i]] == null || typeof v[ks[i]] !== 'object') v[ks[i]] = {}; v = v[ks[i]]; }
    v[ks[ks.length - 1]] = val;
  }
  // 坐标安全格式化：导入数据可能把经纬度存成字符串，直接 .toFixed() 会抛 TypeError
  function fmtCoord(v) {
    const n = Number(v);
    return Number.isFinite(n) && v !== '' && v != null ? n.toFixed(5) : String(v == null ? '' : v);
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
        if (col) {
          const raw = (cells[i] || '').trim();
          if (raw === '') return;
          // 经纬度按数值写入，CSV 只是文本容器；其余字段保持原样
          if (col[0] === 'geo.lng' || col[0] === 'geo.lat') {
            const n = Number(raw);
            if (Number.isFinite(n)) setPath(o, col[0], n);
          } else setPath(o, col[0], raw);
        }
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
    // 区县不再写死成都 12 个，改从全国行政区划表里识别；命中后同步带出省 / 市
    const geoHit = (window.Regions && Regions.findInText) ? Regions.findInText(t) : null;
    out.location.district = pick(/(?:区域|区县|地段)[：: ]*([^\n，。,]+)/) || (geoHit && geoHit.district) || '';
    if (geoHit) {
      if (geoHit.province) out.location.province = geoHit.province;
      if (geoHit.city) out.location.city = geoHit.city;
      if (!out.location.district && geoHit.district) out.location.district = geoHit.district;
    }
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

  // ---------- 视图切换 / 高级搜索图标（线性 SVG，统一随文字色）----------
  const ICON_CARD = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  const ICON_LIST = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
  const ICON_FILTER = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
  // 视图按钮：当前是表格就显示「卡片」图标（点它切回卡片），反之显示「列表」图标
  function viewModeBtn(id) {
    const toCard = state.listMode === 'table';
    return `<button class="btn btn-icon view-mode-btn" id="${id}" title="${toCard ? '切换为卡片显示' : '切换为列表显示'}" aria-label="${toCard ? '切换为卡片显示' : '切换为列表显示'}">${toCard ? ICON_CARD : ICON_LIST}</button>`;
  }

  const state = {
    user: null, properties: [], view: 'dashboard', listMode: 'card', selected: new Set(), editing: null, formGeo: null,
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
    lastMenuView: 'dashboard',                            // 最后一次菜单视图：详情 / 装修页返回时用
    filtered: [],                                         // 当前筛选结果（供“全选”使用）
    headerTheme: 'hd-1',                                  // 顶部栏配色主题
    filters: { q: '', city: '', district: '', platform: '', status: '', sort: 'time',
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
    state.filters = { q: '', city: '', district: '', platform: '', status: '', sort: 'time',
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
  const MENU_VIEWS = ['dashboard', 'plan', 'list', 'map', 'compare', 'knowledge', 'mortgage', 'purchased', 'renoList', 'floorplan', 'trash', 'profile'];
  // 顶部栏左侧标题跟随当前菜单（刷新后由 setView 恢复，不会出现标题与菜单不一致）
  const VIEW_TITLES = {
    list: '房源列表', dashboard: '看房驾驶', plan: '购房计划',
    map: '地图分布', compare: '房源对比', knowledge: '购房知识',
    mortgage: '房贷计算', purchased: '已购房源', renoList: '装修列表', floorplan: '装修设计',
    trash: '回收站', profile: '设置',
    renovation: '装修信息', renovationForm: '填写装修信息', detail: '房源详情'
  };
  function renderPageName(name) {
    const el = $('hv-page-name');
    if (!el) return;
    if (name === 'form') { el.textContent = state.editing ? '编辑房源' : '录入房源'; return; }
    el.textContent = VIEW_TITLES[name] || '择隅';
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
  function dismissBootLoading() {
    // 先撤掉 index.html 内联脚本打的 boot-app 类：它只是「JS 加载完之前的临时遮挡策略」，
    // 撤掉后 #app-view 的显隐重新由 .hidden 控制，退出登录才能正常回到登录页。
    document.documentElement.classList.remove('boot-app');
    const bl = $('boot-loading');
    if (bl) bl.remove();
  }
  // 退出登录 / 令牌过期 / 闲置自动退出 → 回登录页时，必须把所有浮层一起收掉。
  // 这些浮层都是 body 级 fixed 定位（z-index 远高于 auth-view），只隐藏 #app-view
  // 会让设置弹窗、成交价弹窗、资料抽屉等直接浮在登录页上面。
  function closeAllOverlays() {
    document.querySelectorAll(
      '.settings-modal-overlay.open, .cd-modal-overlay.open, .fu-drawer-overlay.open, .fu-drawer.open'
    ).forEach((el) => el.classList.remove('open'));
    // 知识库阅读器是 hidden + open 两态，两个都要复位
    const kb = $('kb-modal');
    if (kb) { kb.classList.remove('open'); kb.classList.add('hidden'); }
    document.body.classList.remove('modal-open');
  }
  function showAuth() {
    closeAllOverlays(); // 先收浮层，再切视图，避免弹窗残留在登录页上
    $('auth-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
    dismissBootLoading(); // 登录态判断完成，撤掉启动遮罩
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
    dismissBootLoading(); // 登录态判断完成，撤掉启动遮罩
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
    if (name === 'profile') { openSettingsModal(); return; }
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
    // 3D 场景持有 WebGL 上下文与 RAF，离开页面必须销毁，避免多开泄漏
    if (name !== 'floorplan') destroyFloorplan();
    if (name === 'list') return renderList(c);
    if (name === 'dashboard') return renderDashboard(c);
    if (name === 'plan') return renderPlan(c);
    if (name === 'purchased') return renderPurchased(c);
    if (name === 'renoList') return renderRenoList(c);
    if (name === 'floorplan') return renderFloorplan(c);
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

  /* ============================================================
     装修设计 · 3D 户型工作台
     两套渲染源：true = 上游开源 floorplan-3d（同源 iframe）；
     false = 自研引擎 ./js/floorplan-3d.js（保留作回退）。
     方案统一存 properties.attributes.floorplan（写前合并其余 attributes），
     走现有 PUT /api/properties/:id，零后端改动、不重启 8787。
     ------------------------------------------------------------
     上游页只把方案写进 localStorage['huxing-design-v1']，不发任何网络请求。
     这里把同源 localStorage 当「通信管道」，真正持久化在服务端：
       进页面/换房源/换房型 → 按所选房源 + 房型把服务端方案预置进管道 → 再建 iframe
       用户改动 → 上游照旧写管道 → storage 事件 → 350ms 防抖后 PUT 回服务端
     内置房型：iframe URL 带 ?layout=<id>，上游按 URL 选户型包；
     三室两厅是上游原始默认，另两套数据在 ./js/floorplan-layouts.js。
     attributes.floorplan.layout = 当前房型，.plans = 每房型一份独立布置，
     都跟房源 / 账号走；切房型不会丢其它房型已保存的布置。
     ============================================================ */
  const FP_USE_UPSTREAM = true;
  const FP_STORE = 'huxing-design-v1';
  const FP_SYNC_DELAY = 350;
  const FP_PLAN_SOURCE = 'floorplan-3d';
  // 内置房型清单：id 必须与 public/js/floorplan-layouts.js 的 window.HVT_LAYOUTS 对齐
  const FP_LAYOUTS = [
    { id: 'a3b2b', name: '三室两厅两卫' },
    { id: 'a3b1b2', name: '三室一厅' },
    { id: 'b2b1b', name: '两室一厅一卫' },
    { id: 'c1b1b', name: '一室一厅（小户型）' }
  ];
  const FP_LAYOUT_DEFAULT = 'a3b2b';

  let fpUpPropId = null;
  let fpUpLayout = FP_LAYOUT_DEFAULT;
  let fpUpTimer = null;
  let fpUpDirty = false;
  let fpUpStorageHandler = null;

  function fpUpProp() {
    return (state.properties || []).find((p) => p.id === fpUpPropId) || null;
  }
  function fpUpBar(text, cls) {
    const el = $('fp-up-state');
    if (!el) return;
    el.textContent = text;
    el.className = 'fp-state' + (cls ? ' ' + cls : '');
  }
  // 自研版旧数据（无 source/state）视作无方案，互不干扰
  function fpUpSavedPlan(p) {
    const saved = p ? atOf(p).floorplan : null;
    return (saved && saved.source === FP_PLAN_SOURCE) ? saved : null;
  }
  // 房型 id 也跟着房源走；未知 / 缺失一律回退到默认三室两厅
  function fpUpLayoutOf(p) {
    const saved = fpUpSavedPlan(p);
    const id = saved && saved.layout;
    return FP_LAYOUTS.some((x) => x.id === id) ? id : FP_LAYOUT_DEFAULT;
  }
  // 取指定房型的布置：优先 plans[layout]，兼容旧版单份 state
  function fpUpSavedState(p, layout) {
    const saved = fpUpSavedPlan(p);
    if (!saved) return null;
    const st = (saved.plans && saved.plans[layout])
      || (saved.state && (!saved.layout || saved.layout === layout) ? saved.state : null);
    return (st && Array.isArray(st.furniture)) ? st : null;
  }
  // 组装服务端方案：当前房型 + 每房型一份布置 + state 兼容旧版读取
  function fpUpBuildPlan(p, st, layout) {
    const saved = fpUpSavedPlan(p);
    const plans = Object.assign({}, (saved && saved.plans) || {});
    if (saved && saved.state && !saved.plans) plans[saved.layout || FP_LAYOUT_DEFAULT] = saved.state;
    if (st) plans[layout] = st;
    return {
      version: 2, source: FP_PLAN_SOURCE, layout, plans,
      state: st || null, updatedAt: new Date().toISOString()
    };
  }
  // 预置管道：有该房型方案写入；没方案清空，让上游回退到该房型默认布置
  function fpUpSeed(p) {
    const st = fpUpSavedState(p, fpUpLayout);
    try {
      if (st) localStorage.setItem(FP_STORE, JSON.stringify(Object.assign({}, st, { layout: fpUpLayout })));
      else localStorage.removeItem(FP_STORE);
    } catch (e) { /* 隐私模式 localStorage 不可用时降级为纯演示 */ }
  }
  function fpUpCreateFrame() {
    const stage = $('fp-up-stage');
    if (!stage) return;
    stage.innerHTML = ''; // 移除旧 iframe：DOM 一摘，WebGL / RAF 由浏览器释放
    const f = document.createElement('iframe');
    f.className = 'fp-embed';
    f.src = './floorplan.html?layout=' + encodeURIComponent(fpUpLayout) + '&v=v1.8.4';
    f.title = '装修设计 · 3D 户型';
    f.setAttribute('allow', 'fullscreen; pointer-lock');
    f.setAttribute('referrerpolicy', 'no-referrer');
    stage.appendChild(f);
  }
  // 把管道里当前方案写回指定房源；不传则用当前选中房源
  async function fpUpFlush(targetId) {
    const id = targetId || fpUpPropId;
    if (!id) return;
    const p = (state.properties || []).find((x) => x.id === id);
    if (!p) return;
    let st = null;
    try {
      const raw = localStorage.getItem(FP_STORE);
      const o = raw ? JSON.parse(raw) : null;
      if (o && Array.isArray(o.furniture)) st = o;
    } catch (e) { /* 数据异常时绝不覆盖服务端 */ }
    if (!st) return;
    const layout = st.layout || fpUpLayout;
    if (!targetId) fpUpBar('● 保存中…', 'dirty');
    try {
      await fpSavePlan(p, fpUpBuildPlan(p, st, layout));
      if (id === fpUpPropId) { fpUpDirty = false; fpUpBar('✅ 已保存到房源', 'saved'); }
    } catch (e) {
      if (id === fpUpPropId) fpUpBar('⚠ 保存失败：' + (e && e.message ? e.message : '未知错误'), 'dirty');
    }
  }
  // 只切房型、还没动过家具时也要立刻存下 layout（否则刷新会回到旧房型）
  async function fpUpPersistLayout() {
    const p = fpUpProp();
    if (!p) return;   // 无房源时纯演示，不写服务端
    fpUpBar('● 保存房型…', 'dirty');
    try {
      await fpSavePlan(p, fpUpBuildPlan(p, fpUpSavedState(p, fpUpLayout), fpUpLayout));
      if (state.view === 'floorplan') {
        const name = (FP_LAYOUTS.find((x) => x.id === fpUpLayout) || {}).name || fpUpLayout;
        fpUpBar('✅ 已切换到「' + name + '」，布置按房型分别保存', 'saved');
      }
    } catch (e) {
      fpUpBar('⚠ 房型未保存：' + (e && e.message ? e.message : '未知错误'), 'dirty');
    }
  }
  function fpUpTeardown(flush) {
    if (fpUpStorageHandler) {
      window.removeEventListener('storage', fpUpStorageHandler);
      fpUpStorageHandler = null;
    }
    if (fpUpTimer) { clearTimeout(fpUpTimer); fpUpTimer = null; }
    // 离开视图 / 重复进入前，把未同步的改动补写一次（fetch 不依赖 DOM，可 fire-and-forget）
    if (flush && fpUpDirty && fpUpPropId) fpUpFlush(fpUpPropId);
    fpUpDirty = false;
  }
  function fpUpWatch() {
    if (fpUpStorageHandler) return;
    fpUpStorageHandler = (e) => {
      if (e.key !== FP_STORE || !e.newValue) return;
      let ok = false;
      try { const o = JSON.parse(e.newValue); ok = !!(o && Array.isArray(o.furniture)); } catch (err) { ok = false; }
      if (!ok) return;
      fpUpDirty = true;
      if (!fpUpPropId) { fpUpBar('未关联房源（仅演示）', ''); return; }
      fpUpBar('● 待同步…', 'dirty');
      if (fpUpTimer) clearTimeout(fpUpTimer);
      fpUpTimer = setTimeout(() => { fpUpTimer = null; fpUpFlush(); }, FP_SYNC_DELAY);
    };
    window.addEventListener('storage', fpUpStorageHandler);
  }

  async function renderFloorplanUpstream(c) {
    destroyFloorplan(); // 清自研引擎，并补写上一轮尚未同步的改动
    const layoutOpts = FP_LAYOUTS.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    c.innerHTML = `
      <div class="fp-embed-wrap fp-up-wrap">
        <div class="fp-prop-bar">
          <label for="fp-up-prop-sel">关联房源</label>
          <select id="fp-up-prop-sel" disabled><option>加载中…</option></select>
          <label for="fp-up-layout-sel">房型</label>
          <select id="fp-up-layout-sel">${layoutOpts}</select>
          <span class="fp-up-hint">方案自动保存到所选房源，换设备登录仍在</span>
          <span class="fp-state" id="fp-up-state">正在加载…</span>
          <button type="button" class="btn" id="fp-up-advanced">高级设计</button>
        </div>
        <div class="fp-embed-stage" id="fp-up-stage"><div class="fp-loading">正在加载 3D 户型…</div></div>
      </div>`;
    try { await ensureProperties(); } catch (e) { /* 后端不可用时降级为纯演示 */ }
    if (state.view !== 'floorplan' || !$('fp-up-stage')) return; // 加载期间已切走，别覆盖别的页面
    const props = state.properties || [];
    if (!fpUpPropId || !props.some((p) => p.id === fpUpPropId)) {
      fpUpPropId = props.length ? props[0].id : null;
    }
    fpUpLayout = fpUpLayoutOf(fpUpProp());   // 房型跟着房源恢复
    const sel = $('fp-up-prop-sel');
    sel.disabled = !props.length;
    sel.innerHTML = props.length
      ? props.map((p) => `<option value="${esc(p.id)}"${p.id === fpUpPropId ? ' selected' : ''}>${esc(p.title || (p.location && p.location.community) || '未命名房源')}</option>`).join('')
      : '<option value="">暂无房源（仅演示）</option>';
    const laySel = $('fp-up-layout-sel');
    laySel.value = fpUpLayout;
    sel.onchange = async (e) => {
      if (fpUpTimer) { clearTimeout(fpUpTimer); fpUpTimer = null; }
      if (fpUpDirty && fpUpPropId) await fpUpFlush(fpUpPropId); // 先把旧房源的改动存回去
      fpUpPropId = e.target.value || null;
      fpUpDirty = false;
      fpUpLayout = fpUpLayoutOf(fpUpProp());   // 每个房源记住自己的房型
      laySel.value = fpUpLayout;
      fpUpSeed(fpUpProp());
      fpUpCreateFrame();
      fpUpBar(fpUpPropId ? '✅ 方案随房源保存' : '未关联房源（仅演示）', fpUpPropId ? 'saved' : '');
    };
    laySel.onchange = async (e) => {
      const next = e.target.value;
      if (!FP_LAYOUTS.some((x) => x.id === next) || next === fpUpLayout) return;
      if (fpUpTimer) { clearTimeout(fpUpTimer); fpUpTimer = null; }
      if (fpUpDirty && fpUpPropId) await fpUpFlush(fpUpPropId); // 旧房型的改动先存回去
      fpUpLayout = next;
      fpUpDirty = false;
      fpUpSeed(fpUpProp());      // 有该房型方案就恢复，没有就清空 → 上游用该房型默认布置
      fpUpCreateFrame();         // iframe 带 ?layout= 全新加载，3D 从零 init
      if (!fpUpPropId) fpUpBar('未关联房源（仅演示）', '');
      await fpUpPersistLayout(); // 立刻把房型 id 存到房源，刷新不会回退
    };
    fpUpSeed(fpUpProp());
    fpUpCreateFrame();
    fpUpWatch();
    fpUpBar(fpUpPropId ? '✅ 方案随房源保存' : '未关联房源（仅演示）', fpUpPropId ? 'saved' : '');
    const advBtn = $('fp-up-advanced');
    if (advBtn) advBtn.onclick = () => window.open(fpAdvancedUrl(), '_blank');
  }

  // 「高级设计」按钮：永远直接进 3D 设计器（AI 体检面板在那儿）。
  // 需要（重新）生成方案时，从设计器里 AI 面板的「上传户型图」入口进识别页。
  function fpAdvancedUrl() {
    return './floorplan-designer.html?propId=' + encodeURIComponent(fpUpPropId || '');
  }

  // 统一入口：离开本视图时 renderView 会调 destroyFloorplan()（同时清理同源同步监听）
  function renderFloorplan(c) {
    return FP_USE_UPSTREAM ? renderFloorplanUpstream(c) : renderFloorplanSelf(c);
  }

  let fpInstance = null;
  let fpPropId = null;
  let fpDirty = false;
  let fpReadyHandler = null;

  function destroyFloorplan() {
    if (fpReadyHandler) {
      window.removeEventListener('floorplan:ready', fpReadyHandler);
      fpReadyHandler = null;
    }
    if (fpInstance) { try { fpInstance.destroy(); } catch (e) { /* 已销毁 */ } fpInstance = null; }
    fpDirty = false;
    fpUpTeardown(true); // 上游 iframe 版：移除 storage 监听 + 补写未同步的改动
  }
  function fpProp() { return (state.properties || []).find((p) => p.id === fpPropId) || null; }
  function fpBar() {
    const el = $('fp-state');
    if (!el) return;
    el.textContent = fpDirty ? '● 有未保存的修改' : (fpProp() ? '✅ 方案随房源保存' : '未关联房源（仅演示）');
    el.className = 'fp-state ' + (fpDirty ? 'dirty' : 'saved');
    const b = $('fp-save');
    if (b) b.disabled = !fpProp();
  }
  function fpMarkDirty() { fpDirty = true; fpBar(); }
  async function fpSavePlan(p, plan) {
    const a = Object.assign({}, atOf(p));
    a.floorplan = plan;
    return syncPropertyRow(await Store.update(p.id, { attributes: a }));
  }
  function fpMount() {
    const host = $('fp-host');
    if (!host) return;
    const p = fpProp();
    const plan = p ? atOf(p).floorplan : null;
    const boot = () => {
      if (!document.getElementById('fp-host')) return; // 已切到别的页面
      if (fpInstance) { try { fpInstance.destroy(); } catch (e) { /* 已销毁 */ } fpInstance = null; }
      if (!window.Floorplan3D) return;
      fpInstance = window.Floorplan3D.init(host, {
        plan: plan || window.Floorplan3D.samplePlan(),
        toast: (m) => toast(m),
        onChange: () => fpMarkDirty()
      });
      const eng = $('fp-engine');
      if (eng) eng.textContent = fpInstance.isWebGLOK()
        ? ' · 3D 引擎就绪（本地 Three.js，离线可用）'
        : ' · WebGL 不可用，仅面板可编辑';
      fpBar();
    };
    if (window.Floorplan3D) { boot(); return; }
    host.innerHTML = '<div class="fp-loading">3D 引擎加载中…</div>';
    fpReadyHandler = () => { fpReadyHandler = null; boot(); };
    window.addEventListener('floorplan:ready', fpReadyHandler, { once: true });
  }
  // 自研引擎版（保留作回退：FP_USE_UPSTREAM=false 时启用）
  async function renderFloorplanSelf(c) {
    await ensureProperties();
    const props = state.properties || [];
    if (!fpPropId || !props.some((p) => p.id === fpPropId)) fpPropId = props.length ? props[0].id : null;
    const opts = props.map((p) =>
      `<option value="${esc(p.id)}"${p.id === fpPropId ? ' selected' : ''}>${esc(p.title || (p.location && p.location.community) || '未命名房源')}</option>`
    ).join('');
    c.innerHTML = `
      <div class="fp-page">
        <div class="fp-head">
          <div class="fp-head-left">
            <h3>装修设计 <small>3D 户型演示 · 一期</small></h3>
            <label class="fp-prop">关联房源
              <select id="fp-prop-sel" ${props.length ? '' : 'disabled'}>
                ${props.length ? opts : '<option value="">暂无房源</option>'}
              </select>
            </label>
          </div>
          <div class="fp-head-right">
            <span class="fp-state" id="fp-state"></span>
            <button class="btn sm" id="fp-reset" type="button">重置示例</button>
            <button class="btn sm primary" id="fp-save" type="button">保存方案</button>
          </div>
        </div>
        <div class="fp-note">
          一期使用内置示例户型演示 3D 浏览、家具摆放、拆墙与地面造价；二期将支持为每套房源录入自己的户型。
          方案保存在所选房源上，换设备登录仍在。<span class="muted" id="fp-engine"></span>
        </div>
        <div id="fp-host"></div>
      </div>`;
    $('fp-prop-sel').onchange = (e) => {
      if (fpDirty && !confirm('当前修改尚未保存，切换房源会丢失，继续吗？')) {
        e.target.value = fpPropId || ''; return;
      }
      fpPropId = e.target.value || null;
      fpDirty = false;
      fpMount(); fpBar();
    };
    $('fp-reset').onclick = () => {
      if (!window.Floorplan3D || !fpInstance) return;
      if (!confirm('恢复为内置示例户型？当前未保存的修改会丢失。')) return;
      fpInstance.setPlan(window.Floorplan3D.samplePlan());
      fpMarkDirty();
      toast('已恢复示例户型');
    };
    $('fp-save').onclick = async () => {
      const p = fpProp();
      if (!p || !fpInstance) { toast('请先到房源列表录入一套房源'); return; }
      try {
        await fpSavePlan(p, fpInstance.getPlan());
        fpDirty = false; fpBar();
        toast('装修方案已保存到该房源', true);
      } catch (e) {
        toast('保存失败：' + (e && e.message ? e.message : '未知错误'));
      }
    };
    fpBar();
    fpMount();
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
    const imgs = (media.images || []).filter(Boolean);
    const coverImgs = imgs.length ? imgs : [presetCover(p.id)];
    const status = opts.statusText || tran.status || '在售';
    const statusCls = status === '在售' ? 'st-ok' : (status === '已售' ? 'st-sold' : (status === '已下架' ? 'st-off' : (status === '待看' ? 'st-await' : 'st-bought')));
    const title = p.title || loc.community || '未命名';
    const ph = (title || '房').slice(0, 1);
    const locTxt = [loc.city, loc.district, loc.community].filter(Boolean).join(' / ');
    const tp = parseFloat(tran.totalPrice), ar = parseFloat(attr.area);
    const unit = (tp > 0 && ar > 0) ? Math.round(tp * 10000 / ar) : null;
    const picked = mode === 'compare' ? state.selected.has(p.id) : (mode === 'batch' ? state.batchSel.has(p.id) : false);
    const priceTxt = tran.totalPrice ? esc(tran.totalPrice) + ' 万' : '—';
    const layoutTxt = esc(attr.layout || '—');
    const areaTxt = attr.area ? esc(attr.area) : '—';
    const locFull = locTxt || '未填写地址';
    // 左下角媒体标签：按需显示（贝壳风格）——图片 / 户型 / VR
    const hasImgs = imgs.length > 0;
    const hasFloor = (media.floorPlans || []).filter(Boolean).length > 0;
    const hasVr = mediaLinksOf(p).some((x) => x.kind === 'vr');
    const mediaTabs = [
      hasImgs ? `<button type="button" class="cm-tab" data-cmedia="images" data-cpid="${esc(p.id)}" title="查看房源图片">图片</button>` : '',
      hasFloor ? `<button type="button" class="cm-tab" data-cmedia="floor" data-cpid="${esc(p.id)}" title="查看户型图">户型</button>` : '',
      hasVr ? `<button type="button" class="cm-tab" data-cmedia="vr" data-cpid="${esc(p.id)}" title="查看 VR 看房">VR</button>` : ''
    ].filter(Boolean).join('');
    return `<div class="card list-card">
      <div class="card-cover${coverImgs.length > 1 ? ' has-multi' : ''}">
        <div class="cover-ph">${esc(ph)}</div>
        <div class="cover-scroll"${showDetail ? ` data-cover-detail="${p.id}"` : ''}>${coverImgs.map((src) => `<img src="${esc(src)}" alt="看房图片" loading="lazy" onerror="this.style.display='none'"/>`).join('')}</div>
        ${mediaTabs ? `<div class="cover-media-tabs">${mediaTabs}</div>` : ''}
        ${mode ? `<label class="cover-pick" title="${mode === 'compare' ? '勾选以对比' : '勾选以批量操作'}"><input type="checkbox" data-pick="${p.id}" ${picked ? 'checked' : ''}/></label>` : ''}
        ${showFav ? `<button class="fav-star ${p.favorite ? 'on' : ''}" data-fav="${p.id}" title="收藏">${p.favorite ? '★' : '☆'}</button>` : ''}
      </div>
      <div class="card-body">
        <h3 class="card-title"${showDetail ? ` data-detail="${p.id}" title="${esc(title)}（点击查看详情）"` : ` title="${esc(title)}"`}>${esc(title)}</h3>
        <div class="card-sub" title="${esc(locFull)}">${esc(locFull)}</div>
        <div class="card-metrics">
          <div class="metric" title="总价 ${priceTxt}"><span class="metric-num metric-price">${priceTxt}</span><span class="metric-label">总价</span></div>
          <div class="metric" title="户型 ${layoutTxt}"><span class="metric-num">${layoutTxt}</span><span class="metric-label">户型</span></div>
          <div class="metric" title="面积 ${areaTxt} ㎡"><span class="metric-num">${areaTxt}</span><span class="metric-label">面积 ㎡</span></div>
        </div>
        <div class="card-foot">
          <div class="card-tags">${(state.selected && state.selected.has(p.id)) ? `<span class="tag tag-compare">对比中</span>` : ''}${unit != null ? `<span class="card-unit" title="${unit.toLocaleString('zh-CN')} 元/㎡">${unit.toLocaleString('zh-CN')} 元/㎡</span>` : ''}${state.demandMatch ? `<span class="tag" title="${esc((demandMatch(p).reasons || []).join('、'))}">匹配 ${demandMatch(p).score}%</span>` : ''}${tran.sourcePlatform ? `<span class="tag tag-src" title="来源平台：${esc(tran.sourcePlatform)}">${esc(tran.sourcePlatform)}</span>` : ''}${tran.viewingDate ? `<span class="tag" title="看房日期：${esc(tran.viewingDate)}">看房 ${esc(tran.viewingDate)}</span>` : ''}<span class="tag ${statusCls}" title="状态：${esc(status)}">${esc(status)}</span></div>
        </div>
        <div class="card-foot">
          <div class="card-sub" title="评分 ${computeScore(p)}">评分 ${computeScore(p)}</div>
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
      if (f.city && (loc.city || '') !== f.city) return false;
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
    // 筛选值一律只从「已录房源」里动态收集，列表里没有的省市/区域不会出现在下拉里
    const cities = all.map((p) => (p.location && p.location.city) || '');
    const districts = all.map((p) => (p.location && p.location.district) || '');
    const platforms = all.map((p) => (p.transaction && p.transaction.sourcePlatform) || '');
    const layouts = all.map((p) => (p.attributes && p.attributes.layout) || '');
    const orientations = all.map((p) => (p.attributes && p.attributes.orientation) || '');
    const floors = all.map((p) => (p.attributes && p.attributes.floor) || '');
    const pickCount = state.pickMode === 'compare' ? state.selected.size : state.batchSel.size;
    const head = crumb(['择隅', '房源列表']) + `<div class="section-head"><h2>已记录房源（${all.length}${shown.length !== all.length ? '，筛选后 ' + shown.length : ''}）</h2>
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
      <span class="dd">
        <button class="btn" id="btn-export">导出CSV</button>
        <button class="btn dd-caret" id="export-toggle" title="更多导出选项" aria-label="更多导出选项">▾</button>
        <span class="dd-menu hidden" id="export-menu">
          <button class="dd-item" id="btn-export-csv2">导出 CSV（表格）</button>
          <button class="dd-item" id="btn-export-json">导出 JSON（完整数据）</button>
        </span>
      </span>
      <input type="file" id="csv-file" accept=".csv" style="display:none"/>
    </div>`;
    const pickBar = state.pickMode ? `<div class="pick-bar">
      <span class="muted">当前${state.pickMode === 'compare' ? '对比' : '批量'}模式 · 已勾选 <b>${pickCount}</b> 套</span>
      <button class="btn" id="btn-pick-all">全选</button>
      <button class="btn" id="btn-pick-none">取消勾选</button>
    </div>` : '';
    const statusOpts = ['', '在售', '已售', '已下架', '待看', '已购'].map((s) => `<option value="${esc(s)}" ${f.status === s ? 'selected' : ''}>${s || '全部状态'}</option>`).join('');
    const sortOpts = [['time', '时间倒序'], ['score', '综合评分']].map(([v, t]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${t}</option>`).join('');
    // 城市 / 排序（时间倒序）已移入高级搜索；主筛选栏只留高频项，避免挤到第二排
    const toolbar = `<div class="toolbar">
      <select id="f-district" class="tb-in">${opt(districts, { k: 'district', t: '全部区域' })}</select>
      <select id="f-platform" class="tb-in">${opt(platforms, { k: 'platform', t: '全部平台' })}</select>
      <select id="f-layout" class="tb-in">${opt(layouts, { k: 'layout', t: '全部户型' })}</select>
      <select id="f-orientation" class="tb-in">${opt(orientations, { k: 'orientation', t: '全部朝向' })}</select>
      <select id="f-floor" class="tb-in">${opt(floors, { k: 'floor', t: '全部楼层' })}</select>
      <select id="f-status" class="tb-in">${statusOpts}</select>
      <div class="tb-right">
        <input id="f-q" class="tb-in tb-search" placeholder="搜索小区/编号/中介" value="${esc(f.q)}"/>
        ${viewModeBtn('btn-view-mode')}
        <button class="btn btn-icon" id="btn-adv" title="高级搜索（含城市 / 排序等）" aria-label="高级搜索">${ICON_FILTER}</button>
      </div>
    </div>`;
    const advPanel = `<div class="adv-panel ${state.advOpen ? '' : 'hidden'}" id="adv-panel">
      <div class="adv-grid">
        <div class="field"><label>关键词</label><input id="a-q" value="${esc(f.q)}" placeholder="小区 / 编号 / 中介"/></div>
        <div class="field"><label>城市</label><select id="a-city">${opt(cities, { k: 'city', t: '全部城市' })}</select></div>
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
    safe('btn-export-csv2', () => doExportCsv());
    safe('btn-export-json', () => doExportJson());
    // 导出下拉菜单
    safe('export-toggle', () => {
      const m = document.getElementById('export-menu');
      if (m) m.classList.toggle('hidden');
    });
    const expMenu = document.getElementById('export-menu');
    if (expMenu) expMenu.addEventListener('click', () => expMenu.classList.add('hidden'));
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
    // 城市 / 排序已移入高级搜索，主筛选栏不再有 f-city / f-sort
    bindSel('f-district', 'district'); bindSel('f-platform', 'platform');
    bindSel('f-layout', 'layout'); bindSel('f-orientation', 'orientation'); bindSel('f-floor', 'floor');
    bindSel('f-status', 'status');
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
        q: gv('a-q'), city: gv('a-city'), district: gv('a-district'), platform: gv('a-platform'),
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
      state.filters = { q: '', city: '', district: '', platform: '', status: '', sort: 'time',
        layout: '', orientation: '', floor: '',
        totalMin: '', totalMax: '', areaMin: '', areaMax: '',
        decoration: '', subwayMax: '', viewingFrom: '', viewingTo: '',
        withTransport: false, withSchool: false, scoreMin: '', favOnly: false };
      const gs2 = document.getElementById('global-search'); if (gs2) gs2.value = '';
      refresh();
      toast('筛选条件已重置', true);
    });
    c.querySelectorAll('[data-detail]').forEach((b) => b.onclick = () => renderDetail(c, b.dataset.detail));
    // 封面图片点击进详情：用按下/抬起位移判断，横向拖动翻图时不误触
    c.querySelectorAll('[data-cover-detail]').forEach((box) => {
      let sx = 0, sy = 0, moved = false;
      box.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; moved = false; });
      box.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) moved = true; });
      box.addEventListener('click', (e) => {
        if (moved) { e.preventDefault(); return; }
        // 收藏星标 / 勾选框等浮层不触发详情
        if (e.target.closest('.fav-star, .cover-pick')) return;
        renderDetail(c, box.dataset.coverDetail);
      });
    });
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
    // 装修页图片也走详情页同一套 mediaListHTML()，点击同样能放大左右切换
    const mediaHtml = RENO_MEDIA_META.map((mm) => `<div class="reno-media"><h4>${esc(mm.label)}</h4>${mediaListHTML(asImages(m[mm.k]), mm.label)}</div>`).join('');
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
      ${viewModeBtn('p-view-mode')}
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
      const area = [p.location && p.location.province, p.location && p.location.city, p.location && p.location.district].filter(Boolean).join(' / ');
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
    const head = crumb(['择隅', '回收站']) + `<div class="section-head"><h2>回收站</h2><div class="spacer"></div>${viewModeBtn('trash-view-mode')}<button class="btn" id="trash-back">返回列表</button></div>`;
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

  // 导出 CSV（表格字段，适合 Excel）
  function doExportCsv() {
    const list = state.properties;
    if (!list.length) { toast('没有可导出的数据'); return; }
    downloadCsv('择隅_' + new Date().toISOString().slice(0, 10) + '.csv', toCsv(list));
    toast('已导出 ' + list.length + ' 条 CSV', true);
  }

  // 导出 JSON（完整数据）：直接序列化房源原始对象，保留 CSV 会丢的图片 / 视频 / 外链 /
  // 收藏 / 评分要素 / 跟进等所有字段，另一个系统拿到可完整还原。带 version + 导出时间便于识别。
  function doExportJson() {
    const list = state.properties;
    if (!list.length) { toast('没有可导出的数据'); return; }
    const payload = {
      format: 'house-view-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: list.length,
      properties: list
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '择隅_完整数据_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出 ' + list.length + ' 条完整数据（JSON）', true);
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
      openSettingsModal('demand');
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
      // demand 是整体覆盖：先合并旧值，保住「看房驾驶 / 购房计划」子键与本弹窗不展示的字段
      const base = demandNow();
      const demand = Object.assign({}, base, {
        budgetMax: parseFloat($('dm-budgetMax').value) || '',
        districts: $('dm-districts').value.trim(),
        layout: $('dm-layout').value.trim(),
        areaMin: parseFloat($('dm-areaMin').value) || '',
        areaMax: parseFloat($('dm-areaMax').value) || '',
        needSubway: $('dm-subway').checked,
        needSchool: $('dm-school').checked,
        notes: $('dm-notes').value.trim(),
        deadlineEnabled: !!base.deadlineEnabled,
        deadlineDate: base.deadlineDate || ''
      });
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
      c.innerHTML = crumb(['择隅', '地图分布']) +
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
      if (gb) gb.onclick = () => openSettingsModal('map');
      return;
    }
    const dest = state.commuteDest;
    c.innerHTML = `
      ${crumb(['择隅', '地图分布'])}
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
      // 通勤终点按当前筛选城市（或已有房源所在城市）限定，不再写死成都
      const hintCity = (state.filters && state.filters.city)
        || ((state.properties.find((x) => x.geo && x.location && x.location.city) || {}).location || {}).city
        || '全国';
      const dest = await Geo.geocode(destName, hintCity);
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
      c.innerHTML = crumb(['择隅', '房源对比']) + tabs + `<div class="cmp-empty">
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
      ['省 / 市 / 区县', (p) => [p.location && p.location.province, p.location && p.location.city, p.location && p.location.district].filter(Boolean).join(' / ') || '—'],
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
    let html = crumb(['择隅', '房源对比']) + tabs + '<div class="section-head"><h2>房源对比（' + items.length + '）</h2><div class="spacer"></div>' +
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
      c.innerHTML = crumb(['择隅', '房源对比']) + tabs + `<div class="cmp-empty">
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
    let html = crumb(['择隅', '房源对比']) + tabs +
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
      floorPlans: [...(media.floorPlans || [])], environment: [...(media.environment || [])],
      // 一键导入带来的外链视频 / VR 不在表单里显示，但保存时必须原样保留
      links: (media.links || []).map((x) => Object.assign({}, x))
    };
    const chk = (v) => v ? 'checked' : '';

    c.innerHTML = `
      <div class="section-head">
        ${crumb(['择隅', id ? '编辑房源' : '录入房源'])}
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
              <div class="field full region-field" id="rg-field">
                <label>省 / 市 / 区县</label>
                <div class="region-picker">
                  <input id="rg-search" class="tb-in" autocomplete="off" placeholder="输入名称搜索，如 宜宾、高新区、浦东新区"/>
                  <div class="region-results hidden" id="rg-results"></div>
                </div>
                <div class="region-chips" id="rg-chips"></div>
                <input type="hidden" id="f-province" value="${esc(loc.province || '')}"/>
                <input type="hidden" id="f-city" value="${esc(loc.city || '')}"/>
                <input type="hidden" id="f-district" value="${esc(loc.district || '')}"/>
                <div class="region-custom">
                  <input id="rg-custom" class="tb-in" placeholder="其它区域，手填"/>
                  <button type="button" class="btn sm" id="rg-custom-apply">填入区域</button>
                </div>
              </div>
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
      $('coord-text').textContent = g && g.lng ? `经度 ${fmtCoord(g.lng)}，纬度 ${fmtCoord(g.lat)}（来源：${g.source || '未知'}）${g.formattedAddress ? ' · ' + g.formattedAddress : ''}` : '尚未定位';
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

    // ===== 省 / 市 / 区县可搜索选择器：选中末级自动带出上级，不用逐级点 =====
    (function wireRegionPicker() {
      const sEl = $('rg-search'), rEl = $('rg-results'), cEl = $('rg-chips');
      if (!sEl || !rEl || !cEl || !window.Regions) return;
      const hp = $('f-province'), hc = $('f-city'), hd = $('f-district');
      const hide = () => rEl.classList.add('hidden');
      const paintChips = () => {
        let parts = [hp.value, hc.value, hd.value].filter(Boolean);
        if (parts.length >= 2 && parts[0] === parts[1]) parts = [parts[0]].concat(parts.slice(2));
        cEl.innerHTML = parts.length
          ? parts.map((x) => '<span class="region-chip">' + esc(x) + '</span>').join('<span class="region-sep">›</span>')
            + '<button type="button" class="region-clear" id="rg-clear">清除</button>'
          : '<span class="region-hint">未选择，输入上方关键词搜索</span>';
        const clr = $('rg-clear');
        if (clr) clr.onclick = () => {
          hp.value = ''; hc.value = ''; hd.value = '';
          paintChips(); refreshPreview();
        };
      };
      const show = (q) => {
        const items = Regions.search(q, 40);
        if (!items.length) {
          rEl.innerHTML = '<div class="region-empty">没有匹配的地区，可用下方「手填区域」</div>';
        } else {
          rEl.innerHTML = items.map((x, i) =>
            '<button type="button" class="region-item" data-rg="' + i + '">' + esc(Regions.label(x)) + '</button>').join('');
          rEl.querySelectorAll('[data-rg]').forEach((b) => {
            b.onclick = () => {
              const x = items[parseInt(b.dataset.rg, 10)];
              hp.value = x.p || ''; hc.value = x.c || ''; hd.value = x.d || '';
              sEl.value = ''; hide(); paintChips(); refreshPreview();
            };
          });
        }
        rEl.classList.remove('hidden');
      };
      sEl.addEventListener('focus', () => show(sEl.value));
      sEl.addEventListener('input', () => show(sEl.value));
      sEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { hide(); sEl.blur(); }
        if (e.key === 'Enter') {
          e.preventDefault();
          const first = rEl.querySelector('.region-item');
          if (first) first.click();
        }
      });
      // 点控件外收起；每次重绘表单只保留一个全局监听，避免累积
      if (window.__rgDocHandler) document.removeEventListener('click', window.__rgDocHandler);
      window.__rgDocHandler = (e) => {
        const f = $('rg-field');
        if (!f || !f.contains(e.target)) hide();
      };
      document.addEventListener('click', window.__rgDocHandler);
      // 国标不收录的各类功能区 / 新区，允许直接手填区域（省、市仍按已选值）
      const ca = $('rg-custom-apply');
      if (ca) ca.onclick = () => {
        const v = $('rg-custom').value.trim();
        if (!v) { toast('请先输入区域名称'); return; }
        hd.value = v; $('rg-custom').value = '';
        paintChips(); refreshPreview(); toast('已填入区域：' + v, true);
      };
      paintChips();
      state.rgSync = paintChips; // 供智能解析 / AI 录入回填后同步显示
    })();

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
      if (r.location.province) $('f-province').value = r.location.province;
      if (r.location.city) $('f-city').value = r.location.city;
      if (r.location.district) $('f-district').value = r.location.district;
      if (state.rgSync) state.rgSync();
      if (r.location.community) $('f-community').value = r.location.community;
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
          ['省份', loc.province], ['城市', loc.city], ['区域', loc.district], ['小区', loc.community], ['地址', loc.address],
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
        set('f-province', loc.province);
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
        // AI 结果常只给「市 / 区县」，按行政区划表反查把省份补上
        if (window.Regions && !$('f-province').value.trim()) {
          const pc = Regions.provinceByCity($('f-city').value.trim())
            || (Regions.lookupDistrict($('f-district').value.trim())[0] || null);
          if (pc) {
            $('f-province').value = pc.p;
            if (!$('f-city').value.trim()) $('f-city').value = pc.c;
          }
        }
        if (state.rgSync) state.rgSync();
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
          province: $('f-province').value.trim(),
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
          floorPlans: fm.floorPlans.slice(), environment: fm.environment.slice(),
          links: fm.links.map((x) => Object.assign({}, x))
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

  // ---------- 详情页媒体：一套渲染 + 一个查看器（所有房源、所有区块共用） ----------
  // 多媒体 / 户型图 / 小区环境图 / 装修页图片都走 mediaListHTML()，不要按来源或区块另写模板。
  // 每个可预览项是一个 .media-item 按钮，data-media-src/type 供查看器收集；非 URL 的文本路径
  // 仍渲染成外链。查看器用 document 事件委托绑定，详情页动态重绘后依然有效。
  function isMediaUrl(s) {
    return /^https?:\/\//i.test(s) || /^\/media\//.test(s) || /^data:/i.test(s);
  }
  /* 只有真正的视频文件才能交给 <video>。安居客 / 贝壳给的都是「播放页 HTML 链接」或封面图，
   * 塞进 <video src> 只会显示一块灰色（用户反馈「感觉是张图片」），必须改成外链卡片。 */
  function isPlayableVideo(s) {
    const u = String(s || '').trim();
    // media.videos 里的本地上传文件一律可播（扩展名由上传时按 mime 生成，别因缺扩展名误判）
    return /^data:video\//i.test(u)
      || /^\/media\//i.test(u)
      || /^https?:\/\/\S+\.(mp4|webm|ogg|mov|m4v|m3u8)(\?|#|$)/i.test(u);
  }
  /* 外链视频 / VR：优先用房源 media.links（插件新采集，带封面）；历史房源没有这个字段，
   * 就从备注里插件写下的【VR】/【视频/VR/沙盘】行解析，按 URL 去重，不用重新采集。 */
  function mediaLinksOf(p) {
    const out = [], seen = Object.create(null);
    const add = (x) => {
      const url = String((x && x.url) || '').trim();
      if (!/^https?:\/\//i.test(url) || seen[url]) return;
      seen[url] = 1;
      out.push({
        url, kind: x.kind === 'vr' ? 'vr' : 'video',
        cover: String((x && x.cover) || ''), label: String((x && x.label) || '')
      });
    };
    const m = (p && p.media) || {};
    if (Array.isArray(m.links)) m.links.forEach(add);
    String((p && p.notes) || '').split('\n').forEach((line) => {
      const hit = line.match(/^【(VR|视频\/VR\/沙盘|视频)】(.+)$/);
      if (!hit) return;
      (hit[2].match(/https?:\/\/[^\s，,；;]+/g) || []).forEach((u) => {
        add({ url: u, kind: /(realsee|panorama|pano_|\/vr\b|vr=)/i.test(u) ? 'vr' : 'video' });
      });
    });
    return out;
  }
  function mediaItemHTML(item) {
    const u = String(item && item.url != null ? item.url : '');
    const type = (item && item.type) || 'image';
    if (type === 'link') {
      // 外链视频 / VR：有封面显示封面，没有封面用带图标的占位块
      const cover = String(item.cover || '');
      const thumb = isMediaUrl(cover)
        ? `<img src="${esc(cover)}" alt="" referrerpolicy="no-referrer"/>`
        : `<span class="media-ph">${item.kind === 'vr' ? '🌀' : '🎬'}</span>`;
      const label = item.label || (item.kind === 'vr' ? '🌀 VR 看房' : '▶ 视频讲解');
      return `<button type="button" class="media-item media-link-item" data-media-src="${esc(cover)}" data-media-type="link" data-media-link="${esc(item.linkUrl || '')}" data-media-label="${esc(label)}" data-media-kind="${esc(item.kind || 'video')}" title="${esc(label)}">`
        + thumb + `<span class="media-play" aria-hidden="true">${item.kind === 'vr' ? '🌀' : '▶'}</span>`
        + `<span class="media-badge">${esc(label)}</span></button>`;
    }
    if (!isMediaUrl(u)) {
      return `<a class="media-link" href="${esc(u)}" target="_blank" rel="noopener">${type === 'video' ? '🎬' : '📷'} ${esc(u)}</a>`;
    }
    return `<button type="button" class="media-item" data-media-src="${esc(u)}" data-media-type="${type === 'video' ? 'video' : 'image'}" title="点击放大">`
      + (type === 'video'
        ? `<video src="${esc(u)}" preload="metadata" muted playsinline></video><span class="media-play" aria-hidden="true">▶</span>`
        : `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer"/>`)
      + '</button>';
  }
  function mediaListHTML(items, title) {
    if (!items || !items.length) return '<div class="muted">无</div>';
    return `<div class="media-list lg" data-media-title="${esc(title || '媒体')}">`
      + items.map(mediaItemHTML).join('') + '</div>';
  }
  const asImages = (arr) => (arr || []).map((u) => ({ url: u, type: 'image' }));

  // 查看器：按「所在区块」收集媒体，左右循环切换图片 / 视频。
  let mmItems = [], mmIndex = 0, mmTitle = '';
  function mmRender() {
    const view = $('mm-view');
    if (!view) return;
    const it = mmItems[mmIndex] || {};
    if (it.type === 'link') {
      // 视频 / VR 由原站提供（播放页不是 mp4，且多数站点拒绝被 iframe 嵌套），
      // 查看器里展示封面 + 明确的「在原站打开」按钮，保持左右切换能力。
      const cover = it.src ? Store.mediaLargeUrl(it.src) : '';
      view.innerHTML = '<div class="mm-link">'
        + (cover
          ? `<img class="mm-link-cover" src="${esc(cover)}" alt="" referrerpolicy="no-referrer"/>`
          : `<div class="mm-link-ph">${it.kind === 'vr' ? '🌀' : '🎬'}</div>`)
        + '<div class="mm-link-cta">'
        + `<div class="mm-link-label">${esc(it.label || (it.kind === 'vr' ? '🌀 VR 看房' : '▶ 视频讲解'))}</div>`
        + '<button type="button" class="btn primary" id="mm-open-link">'
        + (it.kind === 'vr' ? '🌀 打开 VR 看房' : '▶ 在原站播放视频') + '</button>'
        + '<div class="muted">视频 / VR 由原站提供，点击会在新窗口打开</div>'
        + '</div></div>';
    } else {
      view.innerHTML = it.type === 'video'
        ? `<video src="${esc(it.src)}" controls autoplay playsinline></video>`
        : (it.src ? `<img src="${esc(Store.mediaLargeUrl(it.src))}" alt="" referrerpolicy="no-referrer"/>` : '<div class="muted">无法预览</div>');
    }
    $('mm-title').textContent = mmTitle || '媒体预览';
    $('mm-count').textContent = mmItems.length ? (mmIndex + 1) + ' / ' + mmItems.length : '';
    const multi = mmItems.length > 1;
    $('mm-prev').hidden = !multi;
    $('mm-next').hidden = !multi;
  }
  function mmStep(d) {
    if (mmItems.length < 2) return;
    mmIndex = (mmIndex + d + mmItems.length) % mmItems.length;
    mmRender();
  }
  function openMediaViewer(items, index, title) {
    // 外链视频 / VR 可能没有封面（src 为空），仍要能在查看器里切换、打开播放页
    mmItems = (items || []).filter((x) => x && (x.src || x.link));
    if (!mmItems.length) return;
    mmIndex = Math.max(0, Math.min(index, mmItems.length - 1));
    mmTitle = title || '媒体预览';
    const m = $('media-modal');
    if (m) m.classList.remove('hidden');
    mmRender();
  }
  function closeMediaViewer() {
    const m = $('media-modal');
    if (m) m.classList.add('hidden');
    const view = $('mm-view');
    if (view) view.innerHTML = '';   // 移除 video 节点，立即停掉播放和声音
    mmItems = []; mmIndex = 0;
  }
  // 卡片左下角标签：按类型取房源媒体，复用同一个查看器
  function openCardMedia(pid, kind) {
    const p = (state.properties || []).find((x) => x.id === pid);
    if (!p) return;
    const media = p.media || {};
    if (kind === 'images') {
      const items = (media.images || []).filter(Boolean).map((u) => ({ src: u, type: 'image' }));
      openMediaViewer(items, 0, p.title || (p.location || {}).community || '房源图片');
    } else if (kind === 'floor') {
      const items = (media.floorPlans || []).filter(Boolean).map((u) => ({ src: u, type: 'image' }));
      openMediaViewer(items, 0, '户型图');
    } else if (kind === 'vr') {
      const items = mediaLinksOf(p).filter((x) => x.kind === 'vr').map((x) => ({
        src: x.cover || '', type: 'link', link: x.url, kind: 'vr',
        label: x.label || '🌀 VR 看房'
      }));
      openMediaViewer(items, 0, 'VR 看房');
    }
  }
  function wireMediaViewer() {
    const m = $('media-modal');
    if (!m) return;
    $('mm-x').onclick = closeMediaViewer;
    $('mm-prev').onclick = () => mmStep(-1);
    $('mm-next').onclick = () => mmStep(1);
    $('mm-stage').addEventListener('click', (e) => {
      if (e.target === $('mm-stage') || e.target === $('mm-view')) closeMediaViewer();
    });
    // 外链视频 / VR 的「在原站打开」按钮每次 mmRender 都会重建，用委托绑一次
    $('mm-view').addEventListener('click', (e) => {
      if (!e.target.closest || !e.target.closest('#mm-open-link')) return;
      const it = mmItems[mmIndex];
      if (it && it.link) window.open(it.link, '_blank', 'noopener');
    });
    m.addEventListener('click', (e) => { if (e.target === m) closeMediaViewer(); });
    document.addEventListener('keydown', (e) => {
      if (m.classList.contains('hidden')) return;
      if (e.key === 'Escape') closeMediaViewer();
      else if (e.key === 'ArrowLeft') { e.preventDefault(); mmStep(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); mmStep(1); }
    });
    // 事件委托：详情页 / 装修页内容都会重绘，绑在 document 上一次即可
    document.addEventListener('click', (e) => {
      // 卡片左下角「图片 / 户型 / VR」标签
      const tab = e.target.closest && e.target.closest('.cm-tab');
      if (tab) {
        e.preventDefault(); e.stopPropagation();
        openCardMedia(tab.getAttribute('data-cpid'), tab.getAttribute('data-cmedia'));
        return;
      }
      const item = e.target.closest && e.target.closest('.media-item');
      if (!item) return;
      const list = item.closest('.media-list[data-media-title]');
      if (!list) return;
      e.preventDefault();
      const nodes = Array.prototype.slice.call(list.querySelectorAll('.media-item'));
      const items = nodes.map((n) => ({
        src: n.getAttribute('data-media-src') || '',
        type: n.getAttribute('data-media-type') || 'image',
        link: n.getAttribute('data-media-link') || '',
        label: n.getAttribute('data-media-label') || '',
        kind: n.getAttribute('data-media-kind') || ''
      }));
      openMediaViewer(items, nodes.indexOf(item), list.getAttribute('data-media-title'));
    });
  }

  // ---------- 详情：基本信息 / 装修信息 两个页签的内容渲染 ----------

  // 基本信息页：原「交易信息」卡片已合并进「购房信息」，这里只保留基础信息 + 配套设施 + 位置/多媒体/户型图/环境
  function detailBasicHTML(p, purchaseBox) {
    const loc = p.location || {}, attr = p.attributes || {}, media = p.media || {}, fac = p.facilities || {};
    const kv = (k, v) => `<div class="kv"><span class="k">${esc(k)}</span><span>${v == null || v === '' ? '—' : esc(v)}</span></div>`;
    const facYes = (k, label) => `<div class="kv"><span class="k">${label}</span><span class="${fac[k] ? 'yes' : 'no'}">${fac[k] ? '✓ 有' : '— 无'}</span></div>`;
    // 三个区块共用同一套渲染；点开后按区块左右切换（图片 / 视频 / 外链视频 VR 混排也可切）
    const linkItems = mediaLinksOf(p).map((x) => ({
      url: x.cover, cover: x.cover, type: 'link', linkUrl: x.url, kind: x.kind,
      label: x.label || (x.kind === 'vr' ? '🌀 VR 看房' : '▶ 视频讲解')
    }));
    const linkUrls = Object.create(null);
    linkItems.forEach((x) => { linkUrls[x.linkUrl] = 1; });
    const isImageUrl = (u) => /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(String(u == null ? '' : u).trim());
    const videoItems = (media.videos || [])
      .filter((u) => !linkUrls[String(u == null ? '' : u).trim()])
      .map((u) => isPlayableVideo(u)
        ? { url: u, type: 'video' }
        // 视频封面图本来就是静态图片，按图片显示，别再套 <video> 变成「点了没反应」
        : (isImageUrl(u) ? { url: u, type: 'image' }
          : { url: '', type: 'link', linkUrl: u, kind: 'video', label: '▶ 打开视频播放页' }));
    const mediaItems = asImages(media.images).concat(videoItems, linkItems);
    const mediaHtml = mediaListHTML(mediaItems, '多媒体');
    const floorHtml = mediaListHTML(asImages(media.floorPlans), '户型图');
    const envHtml = mediaListHTML(asImages(media.environment), '小区环境图');
    const renovatedText = atOf(p).renovated === true ? '是' : (atOf(p).renovated === false ? '否' : '');
    // 备注：所有房源用同一个 kv 结构，长文本由 wireNoteFold() 统一折叠（不看数据来源）。
    // 这样导入房源带大量补充说明时，详情页仍是同一套布局，不会把左右两列撑变形。
    const noteText = String(p.notes == null ? '' : p.notes);
    const notesHtml = `<div class="kv kv-notes"><span class="k">备注</span><span class="note-wrap"><span class="note-body">${noteText ? esc(noteText) : '—'}</span><button type="button" class="btn sm note-fold hidden">展开查看</button></span></div>`;
    return `<div class="detail-grid">
        <div>
          ${purchaseBox}
          <div class="detail-box" style="margin-bottom:16px">
            <h3 style="margin-top:0">基础信息</h3>
            ${kv('省 / 市 / 区县', [loc.province, loc.city, loc.district].filter(Boolean).join(' / '))}
            ${kv('小区', loc.community)}
            <div class="kv"><span class="k">地址</span><span class="kv-addr">${loc.address ? esc(loc.address) : '—'}<button class="btn sm" id="d-surround" data-surround type="button">📍 查看周边配套</button></span></div>
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
            ${notesHtml}
          </div>
        </div>
        <div>
          <div class="detail-box" style="margin-bottom:16px">
            <div class="detail-box-head">
              <h3>位置</h3>
              <button class="btn sm" data-surround type="button">📍 查看周边配套</button>
            </div>
            ${p.geo && p.geo.lng && p.geo.lat ? kv('坐标', fmtCoord(p.geo.lng) + ', ' + fmtCoord(p.geo.lat) + '（' + esc(p.geo.source || '') + '）') : '<div class="muted">未定位</div>'}
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

  // ---------- 详情右列媒体高度上限（动态按左列算，不写死像素） ----------
  // 需求：多媒体 / 户型图 / 小区环境图仍随图片自适应，但整个右列不能拖到左列最后一张卡片以下。
  // 只有「右列自然高度 > 左列内容高度」时才加限制；按各区块自然高度分配剩余空间
  // （water-filling：图片少的区块不占多余空间，剩下的都给图片多的区块），超出部分在区块内滚动。
  // 依赖 CSS `.detail-grid { align-items:start }`：否则右列盒子被 grid 拉伸，量不到真实内容高度。
  function capDetailMediaHeight(container) {
    if (!container) return () => {};
    function apply() {
      // 每次都重新查 DOM：详情页可能被局部重绘（页签 / 跟进 / 查看器），
      // 缓存旧节点会拿到全 0 的 rect，导致「清空限制后提前 return」而右列失去上限。
      const grid = container.querySelector('.detail-grid');
      if (!grid || grid.children.length < 2) return;
      const left = grid.children[0], right = grid.children[1];
      const lists = Array.from(right.querySelectorAll('.media-list.lg'));
      const leftBoxes = Array.from(left.querySelectorAll(':scope > .detail-box'));
      if (!lists.length || !leftBoxes.length) return;
      // 先还原自然高度，保证重复执行幂等（备注展开、改窗口、地图渲染后重算不累积误差）
      lists.forEach((l) => { l.style.maxHeight = ''; l.style.overflowY = ''; l.classList.remove('capped'); });
      right.style.maxHeight = ''; right.style.overflowY = '';
      right.classList.remove('hvt-capped-col');

      const top = grid.getBoundingClientRect().top;
      const leftBottom = leftBoxes[leftBoxes.length - 1].getBoundingClientRect().bottom;
      const cap = leftBottom - top;                       // 左列内容高度（到最后一张卡片底部）
      if (!(cap > 0)) return;
      const offset = Math.max(0, right.getBoundingClientRect().top - top);
      const naturals = lists.map((l) => l.scrollHeight);
      const totalNatural = naturals.reduce((a, b) => a + b, 0);
      const fixed = Math.max(0, right.scrollHeight - totalNatural); // 位置卡片 + 各标题 / 内边距 / 间距
      const budget = cap - offset - fixed - 4;           // 预留取整误差，保证不越过左列底部
      if (totalNatural <= budget) return;               // 放得下 → 完全自适应，不加任何限制

      const MIN = 128;                                  // 至少露一行缩略图
      const caps = new Array(lists.length).fill(0);
      let remaining = Math.max(0, budget);
      let active = naturals.map((h, i) => (h > 0 ? i : -1)).filter((i) => i >= 0);
      while (active.length) {
        const share = remaining / active.length;
        const done = active.filter((i) => naturals[i] <= share + 1);
        if (!done.length) { active.forEach((i) => { caps[i] = Math.floor(share); }); break; }
        done.forEach((i) => { caps[i] = naturals[i]; remaining -= naturals[i]; });
        active = active.filter((i) => done.indexOf(i) < 0);
      }
      const heights = caps.map((v, i) => naturals[i] > 0
        ? Math.min(naturals[i], Math.max(v, Math.min(MIN, naturals[i]))) : 0);
      // 取整误差可能让各区块上限之和比预算多 1px，先把最大的区块压回去，
      // 否则会误触发「整列滚动」兜底（位置卡片会跟着滚走，体验比分块内滚差）。
      const limit = Math.floor(budget);
      let sumHeights = heights.reduce((a, b) => a + b, 0);
      if (sumHeights > limit) {
        let big = 0;
        for (let i = 1; i < heights.length; i++) if (heights[i] > heights[big]) big = i;
        heights[big] = Math.max(0, heights[big] - (sumHeights - limit));
        sumHeights = heights.reduce((a, b) => a + b, 0);
      }
      // 左列太短、连每个区块一行都放不下：改由右列整列滚动兜底，绝不超过左列底部
      if (sumHeights > limit) {
        right.style.maxHeight = Math.max(0, cap - offset) + 'px';
        right.classList.add('hvt-capped-col');
        return;
      }
      lists.forEach((l, i) => {
        if (naturals[i] <= 0 || heights[i] >= naturals[i] - 1) return; // 放得下的区块保持自适应
        l.style.maxHeight = Math.round(heights[i]) + 'px';
        l.classList.add('capped');
      });
      // 校正浏览器取整误差：只比「右列高度 - 左列高度」。
      // 坑：不能用 right.bottom - leftBottom —— 压缩右列会让浏览器调整滚动位置（scroll anchoring），
      // 开头缓存的 leftBottom 与后续 right.bottom 不在同一坐标系，会凭空多出几百像素触发误兜底。
      let over = Math.round(right.getBoundingClientRect().height - cap);
      if (over > 0) {
        const bySize = lists.map((l, i) => i).filter((i) => lists[i].classList.contains('capped'))
          .sort((a, b) => naturals[b] - naturals[a]);
        for (const i of bySize) {
          const cur = parseFloat(lists[i].style.maxHeight) || 0;
          lists[i].style.maxHeight = Math.round(Math.max(MIN, cur - over)) + 'px';
          over = Math.round(right.getBoundingClientRect().height - cap);
          if (over <= 0) break;
        }
      }
      if (over > 0) {
        lists.forEach((l) => { l.style.maxHeight = ''; l.style.overflowY = ''; l.classList.remove('capped'); });
        right.style.maxHeight = Math.max(0, cap - offset) + 'px';
        right.classList.add('hvt-capped-col');
      }
    }
    container.__hvtMediaCap = apply;
    return apply;
  }
  // 供窗口 resize / 侧边栏收起时复用；#detail-content 元素本身不会被重绘替换，闭包一直有效
  function recalcDetailMediaCap() {
    const dc = document.getElementById('detail-content');
    if (dc && typeof dc.__hvtMediaCap === 'function') dc.__hvtMediaCap();
  }

  // 备注折叠：所有房源统一规则（超过约 6 行才折叠，短备注连按钮都不出现）。
  // 只按内容高度判断，绝不按来源平台/导入方式分流，详情页始终只有一套布局。
  function wireNoteFold(container, onChange) {
    container.querySelectorAll('.kv-notes').forEach((row) => {
      const body = row.querySelector('.note-body');
      const btn = row.querySelector('.note-fold');
      if (!body || !btn) return;
      body.classList.add('folded');
      if (body.scrollHeight <= body.clientHeight + 2) { body.classList.remove('folded'); return; }
      btn.classList.remove('hidden');
      btn.onclick = () => {
        const folded = body.classList.toggle('folded');
        btn.textContent = folded ? '展开查看' : '收起';
        // 备注展开 / 收起会改变左列高度，右列上限要跟着重算
        if (typeof onChange === 'function') requestAnimationFrame(onChange);
      };
    });
  }

  // 根据顶部页签把 #detail-content 渲染为基本信息或装修信息
  function paintDetailContent(c, p, purchaseBox) {
    const container = document.getElementById('detail-content');
    if (!container) return;
    if (state.detailTab === 'renovation' && isPurchased(p)) {
      container.innerHTML = detailRenovationHTML(p);
      container.__hvtMediaCap = null; // 装修页不在两栏 grid 内，清掉上一次的重算闭包
      wireDetailRenovation(c, p);
    } else {
      container.innerHTML = detailBasicHTML(p, purchaseBox);
      const recalcMedia = capDetailMediaHeight(container);
      wireNoteFold(container, recalcMedia);
      const mapEl = container.querySelector('#detail-map');
      if (mapEl) HVMap.renderSingle(mapEl, p.geo && p.geo.lng, p.geo && p.geo.lat);
      // 地址行与位置卡片标题行各有一个按钮，统一走 data-surround 绑定
      container.querySelectorAll('[data-surround]').forEach((btn) => {
        btn.onclick = () => openSurroundModal(p);
      });
      recalcMedia();
      requestAnimationFrame(recalcMedia); // 字体 / 地图渲染稳定后再校准一次
    }
  }

  // ---------- 历史成交价：按小区聚合的成交记录弹窗 ----------
  // 一条 = 一次成交，按小区共享；本房源的小区名自动预填。手动录入与插件采集走同一张表。
  async function openCommunityDealsModal(p) {
    const loc = p.location || {};
    const city = String(loc.city || '').trim();
    const district = String(loc.district || '').trim();
    const community = String(loc.community || '').trim();

    let overlay = $('cd-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'cd-modal-overlay';
      overlay.id = 'cd-modal-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.innerHTML =
        '<div class="cd-modal" role="dialog" aria-modal="true" aria-label="历史成交价">' +
          '<div class="cd-modal-head">' +
            '<h3 style="margin:0">📈 历史成交价</h3>' +
            '<button type="button" class="btn sm" id="cd-close" title="关闭">✕</button>' +
          '</div>' +
          '<div class="cd-modal-body">' +
            '<div id="cd-summary" class="cd-summary"></div>' +
            '<div class="cd-toolbar">' +
              '<button type="button" class="btn primary sm" id="cd-add">＋ 新增成交记录</button>' +
              '<span class="muted" id="cd-scope"></span>' +
            '</div>' +
            '<div id="cd-form-wrap" class="cd-form-wrap hidden"></div>' +
            '<div id="cd-table-wrap" class="cd-table-wrap"></div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCommunityDealsModal(); });
      const cb = overlay.querySelector('#cd-close');
      if (cb) cb.onclick = closeCommunityDealsModal;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('open')) closeCommunityDealsModal();
      });
    }

    const state_cd = { rows: [], editing: null };
    const formWrap = overlay.querySelector('#cd-form-wrap');
    const tableWrap = overlay.querySelector('#cd-table-wrap');
    const summary = overlay.querySelector('#cd-summary');
    const scope = overlay.querySelector('#cd-scope');

    const fmt = (n, suffix) => (n == null || n === '' ? '—' : esc(String(n)) + (suffix || ''));
    const dealDateOf = (r) => (r.deal_date ? String(r.deal_date).slice(0, 10) : '—');

    const renderTable = () => {
      const rows = state_cd.rows;
      if (!rows.length) {
        tableWrap.innerHTML = '<div class="muted" style="padding:24px 0;text-align:center">该小区还没有成交记录。点「＋ 新增成交记录」录一条，或用采集插件批量导入。</div>';
        summary.innerHTML = '';
        return;
      }
      // 统计：均价 / 套数 / 最近成交
      const priced = rows.filter((r) => r.unit_price != null && Number(r.unit_price) > 0);
      const avg = priced.length ? Math.round(priced.reduce((s, r) => s + Number(r.unit_price), 0) / priced.length) : null;
      summary.innerHTML =
        '<span>共 <b>' + rows.length + '</b> 条</span>' +
        (avg != null ? '<span>平均单价 <b>' + avg + '</b> 元/㎡</span>' : '') +
        '<span>最近成交 <b>' + esc(dealDateOf(rows[0])) + '</b></span>';
      tableWrap.innerHTML =
        '<table class="cd-table"><thead><tr>' +
          '<th>户型</th><th>面积(㎡)</th><th>楼层</th><th>成交总价(万)</th>' +
          '<th>单价(元/㎡)</th><th>挂牌价(万)</th><th>成交日期</th><th>周期</th><th>成交人</th><th>操作</th>' +
        '</tr></thead><tbody>' +
        rows.map((r) =>
          '<tr>' +
            '<td>' + esc(r.layout || '—') + '</td>' +
            '<td>' + fmt(r.area) + '</td>' +
            '<td>' + esc(r.floor || '—') + '</td>' +
            '<td>' + fmt(r.total_price) + '</td>' +
            '<td>' + fmt(r.unit_price) + '</td>' +
            '<td>' + fmt(r.list_price) + '</td>' +
            '<td>' + esc(dealDateOf(r)) + '</td>' +
            '<td>' + esc(r.deal_cycle || '—') + '</td>' +
            '<td>' + esc(r.agent || '—') + '</td>' +
            '<td class="cd-ops">' +
              '<button type="button" class="btn sm cd-edit" data-id="' + esc(r.id) + '">编辑</button>' +
              '<button type="button" class="btn sm danger cd-del" data-id="' + esc(r.id) + '">删</button>' +
            '</td>' +
          '</tr>'
        ).join('') +
        '</tbody></table>';
      tableWrap.querySelectorAll('.cd-edit').forEach((b) => b.onclick = () => {
        const row = state_cd.rows.find((x) => x.id === b.dataset.id);
        if (row) showForm(row);
      });
      tableWrap.querySelectorAll('.cd-del').forEach((b) => b.onclick = async () => {
        if (!confirm('确定删除这条成交记录？删除后不可恢复。')) return;
        try {
          await Store.dealDelete(b.dataset.id);
          state_cd.rows = state_cd.rows.filter((x) => x.id !== b.dataset.id);
          renderTable(); toast('已删除');
        } catch (e) { toast('删除失败：' + e.message); }
      });
    };

    const showForm = (row) => {
      state_cd.editing = row || null;
      // 新增时预填当前房源的小区/城市/区域，省得重复手输
      const d = row || { community, city, district };
      const val = (k) => esc(d[k] == null ? '' : String(d[k]));
      const dateVal = d.deal_date ? String(d.deal_date).slice(0, 10) : '';
      formWrap.innerHTML =
        '<div class="cd-form-title">' + (row ? '编辑成交记录' : '新增成交记录') + '</div>' +
        '<div class="cd-form-grid">' +
          '<label>小区<input id="cd-f-community" class="tb-in" value="' + val('community') + '" placeholder="小区名称"/></label>' +
          '<label>城市<input id="cd-f-city" class="tb-in" value="' + val('city') + '" placeholder="如 成都"/></label>' +
          '<label>区域<input id="cd-f-district" class="tb-in" value="' + val('district') + '" placeholder="如 天府新区"/></label>' +
          '<label>户型<input id="cd-f-layout" class="tb-in" value="' + val('layout') + '" placeholder="如 3-2-1-2"/></label>' +
          '<label>面积(㎡)<input id="cd-f-area" class="tb-in" type="number" step="0.01" value="' + val('area') + '"/></label>' +
          '<label>楼层<input id="cd-f-floor" class="tb-in" value="' + val('floor') + '" placeholder="如 26/41"/></label>' +
          '<label>成交总价(万)<input id="cd-f-total" class="tb-in" type="number" step="0.01" value="' + val('total_price') + '"/></label>' +
          '<label>单价(元/㎡)<input id="cd-f-unit" class="tb-in" type="number" step="0.01" value="' + val('unit_price') + '"/></label>' +
          '<label>挂牌价(万)<input id="cd-f-list" class="tb-in" type="number" step="0.01" value="' + val('list_price') + '"/></label>' +
          '<label>成交日期<input id="cd-f-date" class="tb-in" type="date" value="' + esc(dateVal) + '"/></label>' +
          '<label>成交周期<input id="cd-f-cycle" class="tb-in" value="' + val('deal_cycle') + '" placeholder="如 181天"/></label>' +
          '<label>成交人<input id="cd-f-agent" class="tb-in" value="' + val('agent') + '"/></label>' +
        '</div>' +
        '<div class="cd-form-ops">' +
          '<button type="button" class="btn sm" id="cd-form-cancel">取消</button>' +
          '<button type="button" class="btn primary sm" id="cd-form-save">保存</button>' +
        '</div>';
      formWrap.classList.remove('hidden');
      const g = (id) => formWrap.querySelector('#' + id);
      g('cd-form-cancel').onclick = () => { formWrap.classList.add('hidden'); state_cd.editing = null; };
      g('cd-form-save').onclick = async () => {
        const payload = {
          community: g('cd-f-community').value.trim(),
          city: g('cd-f-city').value.trim(),
          district: g('cd-f-district').value.trim(),
          layout: g('cd-f-layout').value.trim(),
          area: g('cd-f-area').value,
          floor: g('cd-f-floor').value.trim(),
          totalPrice: g('cd-f-total').value,
          unitPrice: g('cd-f-unit').value,
          listPrice: g('cd-f-list').value,
          dealDate: g('cd-f-date').value,
          dealCycle: g('cd-f-cycle').value.trim(),
          agent: g('cd-f-agent').value.trim()
        };
        if (!payload.community) { toast('请填小区名称'); return; }
        try {
          let saved;
          if (state_cd.editing) {
            saved = await Store.dealUpdate(state_cd.editing.id, payload);
            const i = state_cd.rows.findIndex((x) => x.id === saved.id);
            if (i >= 0) state_cd.rows[i] = saved;
          } else {
            saved = await Store.dealAdd(payload);
            state_cd.rows.unshift(saved);
          }
          state_cd.rows.sort((a, b) => String(b.deal_date || b.created_at).localeCompare(String(a.deal_date || a.created_at)));
          formWrap.classList.add('hidden');
          state_cd.editing = null;
          renderTable(); toast('已保存');
        } catch (e) { toast('保存失败：' + e.message); }
      };
      if (window.innerWidth > 720) setTimeout(() => { const el = g('cd-f-layout'); if (el) el.focus(); }, 40);
    };

    overlay.querySelector('#cd-add').onclick = () => showForm(null);
    scope.textContent = community ? ('当前小区：' + city + (district ? ' · ' + district : '') + ' · ' + community) : '本房源未填小区，可手动录入小区名';
    overlay.classList.add('open');
    document.body.classList.add('modal-open');
    try {
      state_cd.rows = community ? await Store.dealList({ city, district, community }) : [];
      renderTable();
    } catch (e) {
      tableWrap.innerHTML = '<div class="muted" style="padding:24px 0;text-align:center">加载失败：' + esc(e.message) + '</div>';
    }
  }
  function closeCommunityDealsModal() {
    const overlay = $('cd-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
  }

  // ---------- 详情 ----------
  async function renderDetail(c, id) {
    renderPageName('detail');
    c.innerHTML = '<div class="empty">加载中…</div>';
    const FU_TYPES = ['看房', '电话', '议价', '签约', '贷款', '交房', '其他'];
    const todayStr = new Date().toISOString().slice(0, 10);
    let p;
    try { p = await Store.get(id); } catch (e) { c.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; return; }
    // 媒体区块由 detailBasicHTML() 内的 mediaListHTML() 统一渲染（第 18 轮重构后这里不再重复一套模板）
    const loc = p.location || {}, attr = p.attributes || {}, tran = p.transaction || {}, fac = p.facilities || {};
    const kv = (k, v) => `<div class="kv"><span class="k">${esc(k)}</span><span>${v == null || v === '' ? '—' : esc(v)}</span></div>`;
    const facYes = (k, label) => `<div class="kv"><span class="k">${label}</span><span class="${fac[k] ? 'yes' : 'no'}">${fac[k] ? '✓ 有' : '— 无'}</span></div>`;

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
      ${crumb(['择隅', '房源详情'])}
      <div class="section-head"><h2>${esc(p.title || loc.community || '房源详情')}</h2>
        ${detailTabs}
        ${bought ? '' : `<div class="detail-status">${stChip}</div>`}
        <div class="spacer"></div>
        <span class="detail-actions" id="detail-basic-actions">
          <button class="btn ${bought ? '' : 'primary'}" id="d-purchase">${bought ? '✏️ 修改购房信息' : '🏡 标记为已购房'}</button>
          <button class="btn primary" id="d-fu-add">＋ 添加跟进</button>
          <button class="btn" id="d-deals" title="查看本小区历史成交价">📈 历史成交价</button>
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
    $('d-deals').onclick = () => openCommunityDealsModal(p);
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
      const g = await Geo.geocode(q, '全国');
      openSurroundModal(null, { name: q, center: { lng: g.lng, lat: g.lat }, city: '' });
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
    const city = ov.city || loc.city || '';
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
              const ps = new AMap.PlaceSearch({ pageSize: 25, pageIndex: 1, city: city || '全国' });
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

  // 语义化版本比较：vX.Y.Z → 数组逐位比；返回 1=a新 / -1=b新 / 0=相同；无法解析按字符串比。
  function cmpVersion(a, b) {
    const pa = String(a || '').replace(/^v/i, '').split('.').map(Number);
    const pb = String(b || '').replace(/^v/i, '').split('.').map(Number);
    if (pa.some(isNaN) || pb.some(isNaN) || pa.length !== 3 || pb.length !== 3) {
      return String(a) === String(b) ? 0 : (String(a) > String(b) ? 1 : -1);
    }
    for (let i = 0; i < 3; i++) {
      if (pa[i] > pb[i]) return 1;
      if (pa[i] < pb[i]) return -1;
    }
    return 0;
  }
  // 检查更新：读公开 version.json；管理员且后端支持时显示「一键升级」，否则退回复制命令。
  // 一键升级：后端异步下载/备份/覆盖/重启，本页轮询状态；重启瞬间连接会断，自动重试。
  let upgradePoll = null;
  function stopUpgradePoll() { if (upgradePoll) { clearInterval(upgradePoll); upgradePoll = null; } }
  function manualUpgradeCard(info, latest, reason) {
    const pkg = String(info.package || 'house-view-tracker-linux-x64_' + latest.replace(/^v/i, '') + '.tar.gz');
    const dl = String((info.downloadUrls && info.downloadUrls[0]) || info.downloadUrl || '');
    const dir = String(info.installDir || '/data/house-view-tracker');
    const lines = [
      'sudo systemctl stop house-view-tracker',
      'cd ' + dir.replace(/\/+$/, ''),
      'cp -r data ../house-view-tracker-data-backup-$(date +%Y%m%d)',
      dl ? ('curl -fL -o /tmp/' + pkg + ' "' + dl + '"') : ('# 请先把升级包 ' + pkg + ' 上传到服务器 /tmp/'),
      'tar -xzf /tmp/' + pkg + ' --strip-components=1',
      'sudo systemctl restart house-view-tracker'
    ];
    const cmd = lines.join('\n');
    const notes = String(info.notes || '').trim();
    const date = String(info.date || '').trim();
    return '<div class="pv-up-card">' +
      '<div class="pv-up-head"><b>发现新版本 ' + esc(latest) + '</b>' + (date ? '<span>' + esc(date) + '</span>' : '') + '</div>' +
      (notes ? '<div class="pv-up-notes">' + esc(notes) + '</div>' : '') +
      (reason ? '<div class="pv-up-tip">' + esc(reason) + ' 可复制下面命令手动升级：</div>' : '') +
      '<pre class="pv-up-cmd" id="pv-up-cmd">' + esc(cmd) + '</pre>' +
      '<button type="button" class="btn primary" id="pv-up-copy">复制升级命令</button>' +
    '</div>';
  }
  function bindCopy(box, cmd) {
    const cp = $('pv-up-copy');
    if (!cp) return;
    cp.onclick = async () => {
      try {
        await navigator.clipboard.writeText(cmd);
        cp.textContent = '✓ 已复制';
        setTimeout(() => { if (cp.isConnected) cp.textContent = '复制升级命令'; }, 1800);
      } catch (e) {
        const pre = $('pv-up-cmd');
        if (pre) { const rg = document.createRange(); rg.selectNodeContents(pre); const se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); }
        cp.textContent = '请手动复制上面选中的命令';
      }
    };
  }
  // 轮询升级状态；重启时 fetch 会短暂失败，容忍 6 次（约 12 秒）。
  function pollUpgrade(box, target) {
    stopUpgradePoll();
    let misses = 0;
    const render = (s) => {
      const pct = Math.max(0, Math.min(100, Number(s.progress) || 0));
      box.innerHTML = '<div class="pv-up-card pv-up-running">' +
        '<div class="pv-up-head"><b>正在升级到 ' + esc(target) + '</b><span>' + esc(String(s.phase || '')) + '</span></div>' +
        '<div class="pv-up-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="pv-up-phase">' + esc(s.message || '处理中…') + '（' + pct + '%）</div>' +
        (s.error ? '<div class="pv-up-err">' + esc(s.error) + '</div>' : '') +
      '</div>';
    };
    const tick = async () => {
      let d;
      try {
        const r = await Api.get('/api/upgrade/status');
        d = (r && r.data) || {};
        misses = 0;
      } catch (e) {
        misses++;
        if (misses >= 6) {
          stopUpgradePoll();
          box.innerHTML = '<div class="pv-up-card"><div class="pv-up-phase">服务正在重启或暂时无法连接。请刷新页面（Ctrl+F5）后到「设置 → 关于」查看升级结果。</div>' +
            '<button type="button" class="btn primary" id="pv-up-refresh">刷新页面</button></div>';
          const rf = $('pv-up-refresh'); if (rf) rf.onclick = () => location.reload();
          return;
        }
        box.innerHTML = '<div class="pv-up-card"><div class="pv-up-phase">服务正在重启，正在重新连接（' + misses + '/6）…</div></div>';
        return;
      }
      render(d);
      if (d.phase === 'done') {
        stopUpgradePoll();
        box.innerHTML = '<div class="pv-up-card"><div class="pv-up-ok">✓ 升级完成，当前版本 ' + esc(d.target || target) + '。请刷新页面（Ctrl+F5）使新界面生效。</div>' +
          '<button type="button" class="btn primary" id="pv-up-refresh">立即刷新</button></div>';
        const rf = $('pv-up-refresh'); if (rf) rf.onclick = () => location.reload();
        return;
      }
      if (d.phase === 'failed') {
        stopUpgradePoll();
        box.innerHTML = '<div class="pv-up-card"><div class="pv-up-err">升级失败：' + esc(d.error || d.message || '未知错误') + '</div>' +
          '<div class="pv-up-tip">程序已自动回滚到升级前版本；如未回滚，请联系管理员。</div></div>';
        return;
      }
      // 还在 downloading / backingup / extracting / restarting，继续轮询
    };
    tick();
    upgradePoll = setInterval(tick, 2000);
  }
  async function oneKeyUpgrade(box, latest) {
    if (!window.confirm('确定升级到 ' + latest + ' 吗？\n\n服务器会自动下载升级包、备份程序、覆盖并重启，期间网站会短暂中断（约几十秒）。数据不会丢失。')) return;
    box.innerHTML = '<div class="pv-up-card"><div class="pv-up-phase">正在启动升级…</div></div>';
    try {
      await Api.post('/api/upgrade/start', { confirm: 'UPGRADE' });
      pollUpgrade(box, latest);
    } catch (e) {
      box.innerHTML = '<div class="pv-up-card"><div class="pv-up-err">启动升级失败：' + esc(e.message || e) + '</div></div>';
    }
  }
  // 版本文件多源读取（v1.8.4）：raw.githubusercontent.com 在部分机房会间歇性超时，
  // 服务端已改为并发竞速；浏览器侧同样按 UPDATE_URL → UPDATE_MIRRORS 顺序兜底，各 8 秒超时。
  function updateSourceList() {
    const cfg = window.APP_CONFIG || {};
    const out = [];
    const push = (v) => { const s = String(v || '').trim(); if (s && out.indexOf(s) < 0) out.push(s); };
    push(cfg.UPDATE_URL);
    (Array.isArray(cfg.UPDATE_MIRRORS) ? cfg.UPDATE_MIRRORS : []).forEach(push);
    return out;
  }
  async function fetchVersionJSON() {
    const list = updateSourceList();
    if (!list.length) throw new Error('未配置更新地址');
    const errs = [];
    for (const url of list) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      try {
        const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!j || !j.version) throw new Error('版本文件缺少 version 字段');
        return j;
      } catch (e) {
        let host = url;
        try { host = new URL(url).host; } catch (_) {}
        errs.push(host + ' → ' + (e.name === 'AbortError' ? '超时 8 秒' : (e.message || String(e))));
      } finally { clearTimeout(t); }
    }
    throw new Error(errs.join('；'));
  }
  async function checkForUpdate(curTag, box) {
    if (!box) return;
    stopUpgradePoll();
    box.hidden = false;
    box.className = 'pv-update';
    box.innerHTML = '<span class="pv-up-muted">正在检查…</span>';
    let info = null, latest = '', backendErr = '';
    try {
      const chk = await Api.get('/api/upgrade/check');
      info = (chk && chk.data) || {};
      latest = String(info.latest || '').trim();
      if (!latest) throw new Error('版本文件缺少 version 字段');
      if (upgraderCmp(latest, curTag) <= 0) {
        box.innerHTML = '<span class="pv-up-ok">✓ 当前已是最新版本（' + esc(curTag) + '）</span>';
        return;
      }
    } catch (e) {
      // 记下真实原因：旧服务端 404 / 非管理员 403 / 服务端拉不到版本文件 502
      backendErr = (e && e.message) || String(e || '');
      // 后端接口不可用（旧版本服务端 / 非管理员 / 网络问题）→ 退回浏览器多源直读 version.json
      try {
        info = await fetchVersionJSON();
        latest = String(info.version || '').trim();
        if (!latest) throw new Error('版本文件缺少 version 字段');
        if (cmpVersion(latest, curTag) <= 0) {
          box.innerHTML = '<span class="pv-up-ok">✓ 当前已是最新版本（' + esc(curTag) + '）</span>';
          return;
        }
      } catch (e2) {
        // 后端和浏览器两条路都失败：把后端真实原因一并显示，避免只看到笼统的失败提示
        const both = backendErr ? ('服务端：' + backendErr + '；浏览器：' + (e2.message || e2)) : (e2.message || e2);
        box.innerHTML = '<span class="pv-up-err">检查失败：' + esc(both) + '。请检查网络或 UPDATE_URL 配置。</span>';
        return;
      }
    }
    const canOneKey = !!(info && info.hasNew === true) && (info.admin !== false);
    const notes = String(info.notes || '').trim();
    const date = String(info.date || '').trim();
    // v1.8.4：服务端所有源都失败时会用本地缓存顶上，这里必须说清楚「可能不是最新」
    const cachedTip = (info && info.cached)
      ? '<div class="pv-up-muted">⚠ 服务器此刻连不上版本文件，以下为上次缓存的信息' +
        (info.cachedAt ? '（' + new Date(info.cachedAt).toLocaleString() + '）' : '') + '，可能不是最新。</div>'
      : '';
    if (canOneKey) {
      box.innerHTML = '<div class="pv-up-card">' +
        '<div class="pv-up-head"><b>发现新版本 ' + esc(latest) + '</b>' + (date ? '<span>' + esc(date) + '</span>' : '') + '</div>' +
        (notes ? '<div class="pv-up-notes">' + esc(notes) + '</div>' : '') +
        cachedTip +
        '<div class="pv-up-tip">点击后服务器自动下载、备份、覆盖并重启，期间网站短暂中断，数据不会丢失。</div>' +
        '<button type="button" class="btn primary" id="pv-up-onekey">一键升级到 ' + esc(latest) + '</button>' +
      '</div>';
      const btn = $('pv-up-onekey');
      if (btn) btn.onclick = () => oneKeyUpgrade(box, latest);
    } else {
      // 非管理员或旧服务端：只给手动命令（保持向后兼容，不暴露升级操作给普通用户）
      // 重新拼一份完整命令（info 可能来自公开 version.json）
      const pkg = String(info.package || 'house-view-tracker-linux-x64_' + latest.replace(/^v/i, '') + '.tar.gz');
      const dl = String((info.downloadUrls && info.downloadUrls[0]) || info.downloadUrl || '');
      const dir = String(info.installDir || '/data/house-view-tracker');
      const cmd = [
        'sudo systemctl stop house-view-tracker',
        'cd ' + dir.replace(/\/+$/, ''),
        'cp -r data ../house-view-tracker-data-backup-$(date +%Y%m%d)',
        dl ? ('curl -fL -o /tmp/' + pkg + ' "' + dl + '"') : ('# 请先把升级包 ' + pkg + ' 上传到服务器 /tmp/'),
        'tar -xzf /tmp/' + pkg + ' --strip-components=1',
        'sudo systemctl restart house-view-tracker'
      ].join('\n');
      // 提示语按真实原因区分：把「服务端拉不到版本文件」和「不是管理员」分开说，
      // 否则用户会以为是自己权限没配好，实际是服务器网络/取版本文件失败。
      const tip = backendErr
        ? (/管理员/.test(backendErr)
            ? '当前账号不是管理员（仅 ADMIN_EMAILS 里的账号可一键升级）'
            : '服务端检查更新失败：' + backendErr + '（以下为手动升级命令）')
        : '当前账号不是管理员，或服务端尚未开启一键升级';
      box.innerHTML = manualUpgradeCard(info, latest, tip);
      if (cachedTip) box.insertAdjacentHTML('afterbegin', cachedTip);
      bindCopy(box, cmd);
    }
  }
  // 与后端一致的版本比较（缺少后端接口时的前端兜底用）
  function upgraderCmp(a, b) { return cmpVersion(a, b); }
  // 关于页「版本更新记录」：从 version.json 的 changelog 读取，纵向时间轴渲染（新→旧）。
  // 与检查更新共用 UPDATE_URL；缓存一份避免每次切组都重复请求。
  let _changelogCache = null;
  async function loadChangelog(force) {
    const box = $('about-timeline');
    if (!box) return;
    if (!updateSourceList().length) {
      box.innerHTML = '<div class="cl-empty">未配置更新地址：在部署目录 config.js 填 UPDATE_URL 后即可显示版本更新记录。</div>';
      return;
    }
    const render = (list) => {
      if (!Array.isArray(list) || !list.length) {
        box.innerHTML = '<div class="cl-empty">暂无更新记录。</div>';
        return;
      }
      // 按版本号语义化从新到旧排序，第一条标「最新」
      const sorted = list.slice().sort((a, b) => cmpVersion(b.version, a.version));
      box.innerHTML = sorted.map((it, i) => {
        const isLatest = i === 0;
        const ver = String(it.version || '').trim();
        const date = String(it.date || '').trim();
        const notes = String(it.notes || '').trim();
        return '<div class="cl-item' + (isLatest ? ' is-latest' : '') + '">' +
          '<div class="cl-head">' +
            '<span class="cl-ver">' + esc(ver) + '</span>' +
            (isLatest ? '<span class="cl-tag">当前版本</span>' : '') +
            (date ? '<span class="cl-date">' + esc(date) + '</span>' : '') +
          '</div>' +
          (notes ? '<p class="cl-notes">' + esc(notes) + '</p>' : '') +
        '</div>';
      }).join('');
    };
    if (_changelogCache && !force) { render(_changelogCache); return; }
    box.innerHTML = '<div class="cl-loading">正在加载更新记录…</div>';
    try {
      const info = await fetchVersionJSON();
      const list = Array.isArray(info.changelog) ? info.changelog : [];
      _changelogCache = list;
      render(list);
    } catch (e) {
      box.innerHTML = '<div class="cl-err">更新记录加载失败：' + esc(e.message || e) + '。请检查 UPDATE_URL 或稍后重试。</div>';
    }
  }
  // ---------- 设置页改为弹窗显示（点击「设置」菜单直接弹窗，而非整页切换） ----------
  function openSettingsModal(group) {
    if (group) settingsCurrentGroup = group;
    let overlay = $('settings-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'settings-modal-overlay';
      overlay.id = 'settings-modal-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.innerHTML =
        '<div class="settings-modal" role="dialog" aria-modal="true" aria-label="设置">' +
          '<button type="button" class="settings-modal-close" id="settings-modal-close" aria-label="关闭">×</button>' +
          '<div class="settings-modal-body profile-view" id="settings-modal-body"></div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettingsModal(); });
      const cb = overlay.querySelector('#settings-modal-close');
      if (cb) cb.onclick = closeSettingsModal;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('open')) closeSettingsModal();
      });
    }
    const body = overlay.querySelector('#settings-modal-body');
    body.innerHTML = '';
    renderProfile(body);
    overlay.classList.add('open');
    document.body.classList.add('modal-open');
  }
  function closeSettingsModal() {
    const overlay = $('settings-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
  }

  function renderProfile(c) {
    const u = state.user || {};
    const dm = u.demand || {};
    const bv = buildInfo();
    c.innerHTML =
      crumb(['择隅', '设置']) +
      // 布局：左侧分类导航 + 右侧内容卡片。只切换显示，不改字段 / 文案 / 保存行为。
      '<div class="settings-layout" id="settings-layout">' +
        '<aside class="settings-sidebar">' +
          '<div class="settings-side-head"><h2>设置</h2>' +
            '<button type="button" class="settings-fold" id="settings-fold" title="收起 / 展开分类">‹</button></div>' +
          '<nav class="settings-nav">' +
            SETTINGS_GROUPS.map((g) =>
              '<button type="button" class="settings-nav-item' + (g.id === SETTINGS_DEFAULT_GROUP ? ' active' : '') +
              '" data-group="' + g.id + '"><span class="sn-ico">' + g.icon + '</span>' +
              '<span class="sn-name">' + g.name + '</span><span class="sn-arrow">›</span></button>'
            ).join('') +
          '</nav>' +
        '</aside>' +
        '<div class="settings-main">' +
          '<div class="settings-main-head">' +
            '<h3 id="settings-group-title">个人信息</h3>' +
            '<span class="spacer"></span><span id="pf-msg" class="msg"></span>' +
            '<button class="btn primary" id="pf-save">保存</button>' +
          '</div>' +
          '<div class="settings-panels">' +
            '<section class="settings-panel" data-panel="personal">' +
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
            '</section>' +
            '<section class="settings-panel" data-panel="appearance" hidden>' +
          '<div class="profile-card">' +
            '<h4 class="pc-title">🎨 主题</h4>' +
            '<div class="theme-swatches">' +
              HEADER_THEMES.map((t) => '<button class="theme-swatch ' + t.id + (state.headerTheme === t.id ? ' active' : '') + '" data-theme="' + t.id + '" title="' + t.name + '"><span class="sw"></span><span class="nm">' + t.name + '</span></button>').join('') +
            '</div>' +
          '</div>' +
            '</section>' +
            '<section class="settings-panel" data-panel="demand" hidden>' +
          // 购房需求分组：最晚提醒 + 意向需求
          '<div class="profile-card">' +
            '<h4 class="pc-title">⏰ 购房最晚提醒时间</h4>' +
            '<div class="deadline-row">' +
              '<label class="dl-switch"><input type="checkbox" id="d-deadline-on" ' + (dm.deadlineEnabled ? 'checked' : '') + '/> 开启提醒（默认关闭）</label>' +
              '<input id="d-deadline-date" type="date" value="' + esc(dm.deadlineDate || '') + '" ' + (dm.deadlineEnabled ? '' : 'disabled') + '/>' +
              '<span class="muted" id="d-deadline-hint" style="font-size:12px"></span>' +
            '</div>' +
            '<p class="muted" style="font-size:12px;margin:8px 0 0">开启并保存后，顶部栏中间会常驻显示剩余天数提醒。</p>' +
          '</div>' +
        // 购房需求卡片继续留在 demand 分组里
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
              '<div class="field full"><label>补充说明</label><textarea id="d-notes">' + esc(dm.notes || '') + '</textarea></div>' +
            '</div>' +
          '</div>' +
            '</section>' +
            '<section class="settings-panel" data-panel="map" hidden>' +
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
            '</section>' +
            '<section class="settings-panel" data-panel="ai" hidden>' +
      // 多模型清单：预设只露 Key 输入框，地址 / 模型名在「高级」里可改；密钥只存服务端。
      '<div class="profile-card ai-mm-card">' +
        '<h4 class="pc-title">🤖 AI 模型配置</h4>' +
        '<p class="muted" style="font-size:12px;margin:0 0 10px">不开启就走本机网关自动选模型；开启后，聊天、房源截图识别、户型图识别都走「当前使用」的那一个模型。每个服务商共用一个接口地址和 API Key，下面可以挂多个模型并标注类型；类型只是标注，不影响调用。密钥只存服务端，不会回显。</p>' +
        '<div class="ai-mm-top">' +
          '<div class="ai-mm-top-txt"><b>启用 AI 直连</b><span class="muted" id="ai-mm-state"></span></div>' +
          '<label class="ai-mm-switch"><input type="checkbox" id="ai-mm-enabled" ' + (u.aiDirectEnabled ? 'checked' : '') + '/><span></span></label>' +
        '</div>' +
        '<div class="ai-mm-current" id="ai-mm-current"></div>' +
        '<div class="ai-mm-list" id="ai-mm-list"></div>' +
        '<div class="aip-editor aip-ve" id="aip-vendor-editor" hidden>' +
          '<div class="aip-editor-box aip-ve-box" role="dialog" aria-label="编辑服务商">' +
            '<h4 class="aip-editor-title">编辑服务商：<span id="aip-ve-title">—</span></h4>' +
            '<div class="aip-ve-grid">' +
              '<label>服务商名称<input id="aip-ve-name" class="tb-in" placeholder="显示名称"/></label>' +
              '<label>接口地址<input id="aip-ve-base" class="tb-in" placeholder="https://.../v1"/></label>' +
              '<label>API Key<input id="aip-ve-key" class="tb-in" type="password" ' +
                'data-secret-input="1" data-ai-key="1" readonly autocomplete="new-password" spellcheck="false" ' +
                'placeholder="粘贴 API Key"/></label>' +
              '<span class="aip-ve-key-act">' +
                '<button type="button" class="btn" data-secret-toggle="aip-ve-key">显示</button>' +
                '<button type="button" class="btn" data-act="clear-key">清除</button>' +
              '</span>' +
            '</div>' +
            '<div class="aip-ve-models">' +
              '<div class="aip-ve-models-head"><span>模型清单 · 名称和类型直接改，改完点「保存」</span>' +
                '<button type="button" class="btn" data-act="addmodel">＋ 添加模型</button></div>' +
              '<div id="aip-ve-models"></div>' +
            '</div>' +
            '<div class="aip-edit-actions">' +
              '<button type="button" class="btn primary" data-act="save-vendor">保存</button>' +
              '<button type="button" class="btn" data-act="cancel-vendor">取消</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ai-mm-actions">' +
          '<button type="button" class="btn primary" id="ai-mm-save-all">保存全部</button>' +
          '<button type="button" class="btn" id="ai-mm-add">＋ 自定义服务商</button>' +
          '<span class="muted" style="font-size:12px">下面只列厂商。点厂商名称或「编辑」可以查看和修改它的接口地址、API Key 和模型清单；密钥只存服务端，不会回显。</span>' +
        '</div>' +
      '</div>' +
            '</section>' +
            '<section class="settings-panel" data-panel="security" hidden>' +
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
            '</section>' +
            '<section class="settings-panel" data-panel="about" hidden>' +
      // 系统介绍：择隅是什么、能做什么、数据存在哪
      '<div class="about-intro">' +
        '<div class="ai-hero"><span class="ai-mark">🏠</span>' +
          '<div class="ai-title"><b>择隅</b><span class="ai-slogan">择一隅　安此生</span></div>' +
        '</div>' +
        '<p class="ai-lead">从看房记录到购房决策，再到装修落地——把散落在记忆和聊天记录里的房源信息，收进一个只属于你自己的系统。</p>' +
        '<div class="ai-feats">' +
          '<div class="ai-feat"><span>📋</span><b>房源全记录</b><small>价格户型面积、图片户型图 VR、周边配套，一套不落</small></div>' +
          '<div class="ai-feat"><span>⚖️</span><b>横向对比</b><small>多套房源打分对比，优劣一眼看清</small></div>' +
          '<div class="ai-feat"><span>🗺️</span><b>地图标注</b><small>房源位置与通勤一目了然，购房倒计时随时提醒</small></div>' +
          '<div class="ai-feat"><span>🧮</span><b>房贷测算</b><small>月供明细、提前还款、购房计划一手掌握</small></div>' +
          '<div class="ai-feat"><span>🧱</span><b>装修设计</b><small>户型识别、3D 设计、家具布置，从图纸到落地</small></div>' +
          '<div class="ai-feat"><span>🔒</span><b>数据自主</b><small>本地部署、按账号隔离，你的数据只你自己可见</small></div>' +
        '</div>' +
        '<p class="ai-foot">技术栈：Node.js + PostgreSQL（本地内嵌）· 纯前端交互 · 数据不上传第三方</p>' +
      '</div>' +
      // 版本信息：独立分组，不参与其它分组的排布
      '<div class="profile-version">' +
        '<span class="pv-mark">🏠</span>' +
        '<div class="pv-main"><b>择隅</b><span>本地部署 · Node.js + PostgreSQL · 数据仅自己可见</span></div>' +
        '<div class="pv-meta"><span>版本 <b>' + esc(bv.tag) + '</b></span><span>构建于 ' + esc(bv.date) + '</span>' +
          '<button type="button" class="btn pv-up-btn" id="pv-check-update" title="检查是否有新版本">检查更新</button></div>' +
        '<div class="pv-update" id="pv-update" hidden></div>' +
      '</div>' +
      // 版本更新记录：纵向时间轴，内容来自 version.json 的 changelog
      '<div class="about-changelog">' +
        '<h4 class="cl-title">版本更新记录</h4>' +
        '<div id="about-timeline" class="cl-timeline"><div class="cl-loading">正在加载更新记录…</div></div>' +
      '</div>' +
            '</section>' +
            // 运行监控：只读面板，内容由 js/monitor.js 异步填充（首次切到该组才加载数据）
            '<section class="settings-panel" data-panel="monitor" hidden>' +
              '<div id="hvt-monitor-root"></div>' +
            '</section>' +
          '</div>' +
        '</div>' +
      '</div>';

    // ---------- 设置页：左侧分组导航（只切换显示，字段与保存行为不变） ----------
    const settingsLayout = $('settings-layout');
    const settingsMain = settingsLayout.querySelector('.settings-main');
    const settingsPanels = Array.from(c.querySelectorAll('.settings-panel'));
    const settingsNavItems = Array.from(c.querySelectorAll('.settings-nav-item'));
    const showSettingsGroup = (gid) => {
      const g = SETTINGS_GROUPS.find((x) => x.id === gid) || SETTINGS_GROUPS[0];
      settingsCurrentGroup = g.id;
      settingsPanels.forEach((p) => { p.hidden = p.dataset.panel !== g.id; });
      settingsNavItems.forEach((b) => b.classList.toggle('active', b.dataset.group === g.id));
      // 运行监控与 AI 功能一样需要整行宽度（表格列多，不能被 720px 窄栏挤扁）
      if (settingsMain) settingsMain.classList.toggle('narrow', g.id !== 'ai' && g.id !== 'monitor');
      const t = $('settings-group-title'); if (t) t.textContent = g.name;
      const m = $('pf-msg'); if (m) m.textContent = '';
      // 只读面板：每次切到该组都重新挂载（设置弹窗重绘后 DOM 是新的），筛选状态留在模块内部
      if (g.id === 'monitor' && window.HvtMonitor) {
        window.HvtMonitor.mount($('hvt-monitor-root'));
      }
      // 关于页：异步加载版本更新记录时间轴（失败不影响其它功能）
      if (g.id === 'about') { try { loadChangelog(); } catch (_) {} }
    };
    settingsNavItems.forEach((b) => b.onclick = () => showSettingsGroup(b.dataset.group));
    showSettingsGroup(settingsCurrentGroup);
    const settingsFold = $('settings-fold');
    if (settingsFold) settingsFold.onclick = () => {
      const collapsed = settingsLayout.classList.toggle('collapsed');
      settingsFold.textContent = collapsed ? '›' : '‹';
    };

    // ---------- 多模型清单（唯一数据源：u.aiProviders 脱敏视图 + 预设常量） ----------
    // v10：主列表**只列厂商**；点厂商名称或「编辑」→ 弹窗里查看/编辑该厂商的接口地址、API Key、模型清单。
    //      弹窗里的改动先落在草稿 aiDrafts，点「保存」才提交；提交结构与后端完全一致（零后端改动）。
    const ACTIVE_SEP = '::';
    const savedProviders = () => (Array.isArray(u.aiProviders) ? u.aiProviders : []);
    const presetOf = (id) => AI_PROVIDER_PRESETS.find((p) => p.id === id);
    const typeName = (t) => (AI_MODEL_TYPES.find((x) => x.id === t) || AI_MODEL_TYPES[0]).name;
    const parseActive = (key) => {
      const k = String(key || '');
      const i = k.indexOf(ACTIVE_SEP);
      return i > 0 ? { pid: k.slice(0, i), mid: k.slice(i + ACTIVE_SEP.length) } : { pid: k, mid: '' };
    };
    const activeKeyOf = (pid, mid) => pid + ACTIVE_SEP + mid;
    // 上一版存的单模型记录惰性补成一行
    const oldModels = (p) => (Array.isArray(p.models) && p.models.length
      ? p.models
      : (p.model ? [{ id: 'm1', name: p.model, model: p.model, type: 'llm' }] : []));
    function providerRows() {
      const saved = savedProviders();
      const byId = new Map(saved.map((p) => [p.id, p]));
      const rows = AI_PROVIDER_PRESETS.map((pre) => {
        const sv = byId.get(pre.id) || {};
        // 用户保存过清单就用他自己的（可能删过预设模型）；否则给完整预设
        const svModels = oldModels(sv);
        const models = svModels.length ? svModels.slice() : pre.models.map((m) => Object.assign({}, m));
        return Object.assign({}, pre, sv, {
          id: pre.id, preset: pre.id, logo: pre.logo, kind: pre.kind, models
        });
      });
      saved.forEach((p) => {
        if (!presetOf(p.id)) rows.push(Object.assign({}, p, {
          logo: '自', kind: '自定义', models: oldModels(p)
        }));
      });
      return rows;
    }
    // 草稿：厂商弹窗里的编辑先落这里，点「保存」才提交（取消＝丢弃）
    const aiDrafts = {};
    const draftOf = (pid) => aiDrafts[pid] || null;
    function currentRow() {
      const a = parseActive(u.aiActiveProvider);
      const p = providerRows().find((x) => x.id === a.pid);
      if (!p) return null;
      const m = (a.mid ? p.models.find((x) => x.id === a.mid) : p.models[0]) || null;
      return m ? { provider: p, model: m, key: activeKeyOf(p.id, m.id) } : null;
    }
    function paintAiState() {
      const on = !!u.aiDirectEnabled;
      const st = $('ai-mm-state');
      if (st) st.textContent = on ? '✅ 直连已启用' : '⏸ 未启用（走本机网关自动选模型）';
      const cb = $('ai-mm-enabled'); if (cb) cb.checked = on;
      const cur = $('ai-mm-current');
      if (cur) {
        const c = currentRow();
        cur.innerHTML = c
          ? '当前使用：<b>' + esc(c.provider.name) + '</b> · ' + esc(c.model.model || '') +
            ' <em class="aip-type">' + esc(typeName(c.model.type)) + '</em>' +
            (c.provider.keySet ? ' · 已配置' : ' · <em>还没填 API Key</em>')
          : '当前使用：<b>本机网关自动选模型</b>（还没选模型）';
      }
    }
    // 组装要提交的清单：来自 providerRows + 草稿（结构与后端完全一致）
    function collectAiRows(overrides) {
      const a = parseActive(u.aiActiveProvider);
      const rows = [];
      providerRows().forEach((p) => {
        const saved = savedProviders().find((x) => x.id === p.id) || {};
        const dr = draftOf(p.id);
        const src = dr ? dr.models : (p.models || []);
        const row = {
          id: p.id,
          preset: saved.preset || p.preset || 'custom',
          name: (dr && dr.name) || saved.name || p.name || p.id,
          baseUrl: (dr ? dr.baseUrl : (saved.baseUrl || p.baseUrl || '')) || '',
          apiKey: (dr ? dr.apiKey : '') || '',
          models: src.map((m) => ({
            id: m.id, name: m.name || m.model || '', model: m.model || '', type: m.type || 'llm'
          }))
        };
        // 只提交「有用」条目：已入库过 / 已配 Key / 刚输入 Key / 自定义 / 当前使用 / 改过内容。
        // 已入库的必须继续提交——否则只想改个名字（没配 Key）的厂商会在下一次保存时被静默丢掉。
        // 从没入过库的预设仍然跳过，避免后端为一堆没用到的地址逐个做 DNS 校验。
        const persisted = !!saved.id;
        if (persisted || saved.keySet || row.apiKey || row.preset === 'custom' || a.pid === p.id || (dr && dr.changed)) {
          rows.push(Object.assign(row, (overrides && overrides[p.id]) || {}));
        }
      });
      return rows;
    }
    async function saveAi(opt, okMsg) {
      const o = opt || {};
      const rows = collectAiRows(o.overrides).filter((r) => r.id !== o.skip);
      const patch = { aiProviders: rows };
      if (o.activeKey !== undefined) patch.aiActiveProvider = o.activeKey;
      if (o.enabled !== undefined) patch.aiDirectEnabled = o.enabled;
      if (o.patch) Object.assign(patch, o.patch);
      // 删服务商 / 删当前模型 / 清 Key 时自动切回网关，避免启用着却指向空配置
      const a = parseActive(u.aiActiveProvider);
      if ((o.skip && o.skip === a.pid) || o.clearActive) {
        patch.aiActiveProvider = ''; patch.aiDirectEnabled = false;
      }
      if (o.overrides) Object.keys(o.overrides).forEach((id) => {
        if (id === a.pid && o.overrides[id].apiKey === '__clear__') {
          patch.aiActiveProvider = ''; patch.aiDirectEnabled = false;
        }
      });
      const rr = await Api.updateProfile(patch);
      state.user = rr.data.user;
      Object.assign(u, state.user);
      Api.setSession(Api.token(), state.user);
      renderProfile(c);
      if (okMsg) toast(okMsg, true);
      return rr;
    }

    // ---------- 主列表：一行一个厂商 ----------
    function vendorRowHTML(p) {
      const saved = savedProviders().find((x) => x.id === p.id) || {};
      const dr = draftOf(p.id);
      const keySet = dr ? (!!dr.apiKey || !!saved.keySet) : !!saved.keySet;
      const n = (dr ? dr.models : (p.models || [])).length;
      const canDel = (p.preset === 'custom' || p.id === 'legacy');
      return '<div class="aip-vendor-row" data-pid="' + esc(p.id) + '">' +
        '<span class="aip-logo">' + esc(p.logo || '自') + '</span>' +
        '<button type="button" class="aip-vendor-name" data-act="edit-vendor" title="点击查看与编辑">' + esc(p.name) + '</button>' +
        '<span class="aip-kind">' + esc(p.kind || '自定义') + '</span>' +
        '<span class="aip-state' + (keySet ? ' ok' : '') + '">' +
          (keySet ? '已配置 Key' : '未配置 Key') + ' · ' + n + ' 个模型</span>' +
        '<span class="aip-cell-act">' +
          '<button type="button" class="btn" data-act="edit-vendor">编辑</button>' +
          (canDel ? '<button type="button" class="btn" data-act="del-vendor">删除</button>' : '') +
        '</span>' +
      '</div>';
    }
    function renderAiProviders() {
      const box = $('ai-mm-list');
      if (!box) return;
      box.innerHTML = providerRows().map(vendorRowHTML).join('');
      bindAiList();
    }
    // 事件委托：厂商行（点名称或「编辑」→ 打开厂商弹窗）
    function bindAiList() {
      const box = $('ai-mm-list');
      if (!box || box.dataset.bound === '1') return;
      box.dataset.bound = '1';
      box.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-act]');
        if (!btn || !box.contains(btn)) return;
        const rowEl = btn.closest('.aip-vendor-row');
        const pid = rowEl ? rowEl.dataset.pid : '';
        const act = btn.dataset.act;
        btn.disabled = true;
        try {
          if (act === 'edit-vendor') {
            openVendorEditor(pid);
          } else if (act === 'del-vendor') {
            if (!window.confirm('删除这个服务商及其所有模型？')) { btn.disabled = false; return; }
            await saveAi({ skip: pid }, '已删除服务商');
          }
        } catch (e) { toast('操作失败：' + e.message); }
        // 关键：必须复位。原先 edit-vendor 分支没复位，按钮一变灰就再也点不开（要重渲染才恢复）
        finally { btn.disabled = false; }
      });
    }

    // ---------- 厂商编辑弹窗（地址 + Key + 模型清单） ----------
    function openVendorEditor(pid) {
      const ed = $('aip-vendor-editor');
      const p = providerRows().find((x) => x.id === pid);
      if (!ed || !p) return;
      const saved = savedProviders().find((x) => x.id === pid) || {};
      const prev = draftOf(pid);
      const draft = {
        name: prev ? prev.name : (saved.name || p.name || ''),
        baseUrl: prev ? prev.baseUrl : (saved.baseUrl || p.baseUrl || ''),
        apiKey: prev ? prev.apiKey : '',
        models: (prev ? prev.models : (p.models || [])).map((m) => ({
          id: m.id, name: m.name || m.model || '', model: m.model || '', type: m.type || 'llm'
        })),
        activeKey: prev ? prev.activeKey : '',      // 草稿里选中的「当前使用」
        removedActive: prev ? prev.removedActive : false,
        changed: false
      };
      aiDrafts[pid] = draft;
      ed._pid = pid;
      ed._draft = draft;
      ed._tests = {};   // 换厂商时清掉上一次的检测结果
      const title = $('aip-ve-title'); if (title) title.textContent = draft.name || '—';
      const nEl = $('aip-ve-name'); if (nEl) nEl.value = draft.name || '';
      const bEl = $('aip-ve-base'); if (bEl) bEl.value = draft.baseUrl;
      const kEl = $('aip-ve-key'); if (kEl) { kEl.value = ''; kEl.dataset.dirty = '0'; }
      renderVendorModels(pid);
      ed.removeAttribute('hidden');
    }
    function renderVendorModels(pid) {
      const box = $('aip-ve-models');
      const ed = $('aip-vendor-editor');
      if (!box || !ed || !ed._draft) return;
      const saved = savedProviders().find((x) => x.id === pid) || {};
      const keySet = !!saved.keySet || !!ed._draft.apiKey;
      const a = parseActive((ed._draft && ed._draft.activeKey) || u.aiActiveProvider);
      const ms = ed._draft.models || [];
      const first = ms.length ? ms[0].id : '';
      box.innerHTML = ms.map((m) => {
        const isActive = a.pid === pid && (a.mid ? a.mid === m.id : m.id === first);
        const opts = AI_MODEL_TYPES.map((t) =>
          '<option value="' + t.id + '"' + (t.id === (m.type || 'llm') ? ' selected' : '') + '>' +
          esc(t.name) + '</option>').join('');
        // 检测结果按模型 id 存在弹窗对象上，重绘（加/删模型）后仍在
        const t = (ed._tests || {})[m.id] || null;
        return '<div class="aip-ve-row' + (isActive ? ' is-active' : '') + '" data-mid="' + esc(m.id) + '">' +
          '<input class="tb-in" data-mf="model" value="' + esc(m.model || '') +
            '" placeholder="模型 ID，如 deepseek-chat" spellcheck="false" aria-label="模型名称"/>' +
          '<select class="tb-in" data-mf="type" aria-label="模型类型">' + opts + '</select>' +
          '<span class="aip-cell-state' + (isActive ? ' on' : '') + '">' +
            (isActive ? '● 使用中' : (keySet ? '已配置' : '未配 Key')) + '</span>' +
          '<span class="aip-cell-act">' +
            '<button type="button" class="btn" data-act="test-model">检测</button>' +
            '<button type="button" class="btn" data-act="use-model"' + (isActive ? ' disabled' : '') + '>' +
              (isActive ? '使用中' : '设为当前') + '</button>' +
            '<button type="button" class="btn" data-act="del-model">删除</button>' +
          '</span>' +
          // 检测结果单独占下一行整宽：长文案（上游报错）不会被截成一串省略号
          '<span class="aip-cell-test' + (t ? (t.ok ? ' ok' : ' err') : '') +
            '" data-test-for="' + esc(m.id) + '" title="' + esc(t ? (t.title || t.text) : '') + '">' +
            esc(t ? t.text : '') + '</span>' +
        '</div>';
      }).join('') || '<div class="aip-empty">这个厂商还没有模型，点上面「＋ 添加模型」加一个。</div>';
    }
    // 厂商编辑弹窗事件（同样在 #ai-mm-list 之外，单独绑）
    const aiVendorEditor = $('aip-vendor-editor');
    if (aiVendorEditor && aiVendorEditor.dataset.bound !== '1') {
      aiVendorEditor.dataset.bound = '1';
      aiVendorEditor.addEventListener('click', async (ev) => {
        if (ev.target === aiVendorEditor) { aiVendorEditor.setAttribute('hidden', ''); return; }
        const btn = ev.target.closest('[data-act]');
        if (!btn || !aiVendorEditor.contains(btn)) return;
        const act = btn.dataset.act;
        const pid = aiVendorEditor._pid;
        const dr = aiVendorEditor._draft;
        btn.disabled = true;
        try {
          if (act === 'cancel-vendor') {
            delete aiDrafts[pid];
            aiVendorEditor._draft = null;
            aiVendorEditor.setAttribute('hidden', '');
            btn.disabled = false; return;
          } else if (act === 'save-vendor') {
            const bEl = $('aip-ve-base');
            const kEl = $('aip-ve-key');
            const extra = {};
            if (dr) {
              const nEl2 = $('aip-ve-name');
              if (nEl2) dr.name = nEl2.value.trim() || dr.name || '';
              dr.baseUrl = bEl ? bEl.value.trim() : '';
              dr.apiKey = (kEl && kEl.dataset.dirty === '1') ? kEl.value.trim() : '';
              dr.changed = true;
              // 草稿里选过「当前使用」/ 删掉了当前使用 → 一起提交
              if (dr.activeKey) { extra.aiActiveProvider = dr.activeKey; extra.aiDirectEnabled = true; }
              else if (dr.removedActive) { extra.aiActiveProvider = ''; extra.aiDirectEnabled = false; }
            }
            aiVendorEditor.setAttribute('hidden', '');
            await saveAi({ patch: extra }, '服务商已保存');
          } else if (act === 'clear-key') {
            if (!window.confirm('清除这个服务商已保存的 API Key？')) { btn.disabled = false; return; }
            const ov = {}; ov[pid] = { apiKey: '__clear__' };
            await saveAi({ overrides: ov }, '已清除 API Key；如它是当前服务商会自动切回网关');
          } else if (act === 'addmodel') {
            if (!dr) { btn.disabled = false; return; }
            const nid = 'm-' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
            const m = { id: nid, name: '', model: '', type: 'llm' };
            dr.models.push(m);
            dr.changed = true;
            renderVendorModels(pid);
            // 新行直接把焦点落在「模型名称」输入框，边填边改草稿（不再弹第二层）
            const inp = document.querySelector('#aip-ve-models .aip-ve-row[data-mid="' + nid + '"] [data-mf="model"]');
            if (inp) { try { inp.focus(); } catch (e) {} }
            btn.disabled = false; return;
          } else if (act === 'test-model') {
            // 检测：拿弹窗里正在编辑的模型名 / 地址 / Key 真打一次，结果就地写在这一行（不重绘，避免丢焦点）
            const rowEl = btn.closest('.aip-ve-row');
            const mid = rowEl ? rowEl.dataset.mid : '';
            const m = (dr && (dr.models || []).find((x) => x.id === mid)) || null;
            const modelName = m ? String(m.model || '').trim() : '';
            if (!modelName) { toast('先在「模型 ID」里填模型名，再点检测'); btn.disabled = false; return; }
            const bEl = $('aip-ve-base');
            const kEl = $('aip-ve-key');
            const cell = rowEl ? rowEl.querySelector('[data-test-for="' + mid + '"]') : null;
            const paint = (res) => {
              aiVendorEditor._tests = aiVendorEditor._tests || {};
              aiVendorEditor._tests[mid] = res;
              if (cell) {
                cell.className = 'aip-cell-test ' + (res.ok ? 'ok' : 'err');
                cell.textContent = res.text;
                cell.title = res.title || res.text;
              }
            };
            // 没填过 Key 就别发请求：直接说清楚，免得白等一轮还抛个 400
            const savedP = savedProviders().find((x) => x.id === pid) || {};
            const typedKey = (kEl && kEl.dataset.dirty === '1') ? String(kEl.value || '').trim() : '';
            if (!typedKey && !savedP.keySet) {
              paint({ ok: false, text: '✗ 这个服务商还没填 API Key', title: '先在「API Key」输入框粘贴 Key，再点检测' });
              btn.disabled = false;
              return;
            }
            const oldTxt = btn.textContent;
            btn.textContent = '检测中…';
            if (cell) { cell.className = 'aip-cell-test'; cell.textContent = '检测中…'; cell.title = ''; }
            try {
              const rr = await Api.post('/api/ai/test-provider', {
                pid,
                baseUrl: (bEl ? bEl.value.trim() : '') || (dr ? dr.baseUrl : ''),
                // Key 只在这次输入过才传，否则后端复用库里已保存的那把
                apiKey: (kEl && kEl.dataset.dirty === '1') ? kEl.value.trim() : '',
                model: modelName
              });
              const d = (rr && rr.data) || {};
              if (!d.ok) {
                paint({
                  ok: false,
                  text: '✗ ' + (d.error || '不通'),
                  title: (d.status ? 'HTTP ' + d.status + ' · ' : '') + (d.error || '')
                });
              } else {
                const v = d.vision || {};
                const vTxt = v.supported
                  ? (v.ok ? '支持看图' : '看图不对（答「' + (v.note || '?') + '」）')
                  : '不支持看图';
                paint({
                  ok: true,
                  text: '✓ 通 · ' + (d.latencyMs || 0) + 'ms · ' + vTxt,
                  title: '模型 ' + d.model + (d.reply ? ' · 回复「' + d.reply + '」' : '') +
                    (d.note ? ' · ' + d.note : '') + (v.note ? ' · 看图答「' + v.note + '」' : '')
                });
              }
            } catch (e) {
              paint({ ok: false, text: '✗ ' + (e.message || '检测失败'), title: e.message || '' });
            }
            btn.textContent = oldTxt;
            btn.disabled = false;
            return;
          } else if (act === 'use-model') {
            const rowEl = btn.closest('.aip-ve-row');
            const mid = rowEl ? rowEl.dataset.mid : '';
            if (dr) { dr.activeKey = activeKeyOf(pid, mid); dr.removedActive = false; }
            renderVendorModels(pid);
            btn.disabled = false; return;
          } else if (act === 'del-model') {
            if (!window.confirm('删除这个模型？')) { btn.disabled = false; return; }
            const rowEl = btn.closest('.aip-ve-row');
            const mid = rowEl ? rowEl.dataset.mid : '';
            const a = parseActive(u.aiActiveProvider);
            const isCur = a.pid === pid && a.mid === mid;
            if (dr) {
              dr.models = (dr.models || []).filter((x) => x.id !== mid);
              if (isCur) dr.removedActive = true;
              if (dr.activeKey === activeKeyOf(pid, mid)) dr.activeKey = '';
            }
            renderVendorModels(pid);
            btn.disabled = false; return;
          }
        } catch (e) { toast('操作失败：' + e.message); }
        finally { btn.disabled = false; }
      });
      // 弹窗内「模型名称 / 类型 / 服务商名称」直接改：即时写入草稿，不重绘（否则会丢焦点）
      const draftModelOf = (el) => {
        const rowEl = el.closest('.aip-ve-row');
        const mid = rowEl ? rowEl.dataset.mid : '';
        const dr = aiVendorEditor._draft;
        if (!dr || !mid) return null;
        return (dr.models || []).find((x) => x.id === mid) || null;
      };
      aiVendorEditor.addEventListener('input', (ev) => {
        const t = ev.target;
        if (t.id === 'aip-ve-name') {
          const dr = aiVendorEditor._draft;
          if (dr) { dr.name = t.value; dr.changed = true; }
          const ti = $('aip-ve-title');
          if (ti) ti.textContent = t.value.trim() || '—';
          return;
        }
        const inp = t.closest('[data-mf="model"]');
        if (!inp) return;
        const m = draftModelOf(inp);
        if (!m) return;
        m.model = inp.value;
        m.name = inp.value;
        if (aiVendorEditor._draft) aiVendorEditor._draft.changed = true;
      });
      aiVendorEditor.addEventListener('change', (ev) => {
        const sel = ev.target.closest('select[data-mf="type"]');
        if (!sel) return;
        const m = draftModelOf(sel);
        if (!m) return;
        m.type = sel.value;
        if (aiVendorEditor._draft) aiVendorEditor._draft.changed = true;
      });
    }

    renderAiProviders();
    paintAiState();

    // 保存全部：提交所有厂商草稿
    const aiSaveAll = $('ai-mm-save-all');
    if (aiSaveAll) aiSaveAll.onclick = async () => {
      aiSaveAll.disabled = true;
      try { await saveAi({}, '模型配置已保存'); }
      catch (e) { toast('保存失败：' + e.message); aiSaveAll.disabled = false; }
    };
    // 总开关：没选模型 / 没填 Key 不许启用（后端同样明确报错，绝不静默回落网关）
    const aiEnabledBox = $('ai-mm-enabled');
    if (aiEnabledBox) aiEnabledBox.onchange = async () => {
      const next = aiEnabledBox.checked;
      aiEnabledBox.disabled = true;
      try {
        if (next) {
          const rows = collectAiRows({});
          const a = parseActive(u.aiActiveProvider);
          const p = rows.find((r) => r.id === a.pid);
          const saved = savedProviders().find((x) => x.id === a.pid) || {};
          const hasModel = !!(p && p.models && p.models.length && p.models.some((m) => m.model));
          if (!p || !hasModel || (!p.apiKey && !saved.keySet)) {
            toast('启用前请先填好 API Key，并在某个模型行点「设为当前」');
            aiEnabledBox.checked = false; return;
          }
        }
        await saveAi({ enabled: next }, next ? 'AI 直连已启用' : '已切回本机网关自动选模型');
      } catch (e) { toast('操作失败：' + e.message); aiEnabledBox.checked = !next; }
      finally { aiEnabledBox.disabled = false; }
    };
    // 自定义服务商：加一条空白记录，再点名称填详情
    const aiAdd = $('ai-mm-add');
    if (aiAdd) aiAdd.onclick = async () => {
      const name = (window.prompt('给这个自定义服务商起个名字：', '我的服务商') || '').trim();
      if (!name) return;
      const id = 'custom-' + Date.now().toString(36);
      const rows = collectAiRows({});
      rows.push({ id, preset: 'custom', name, baseUrl: '', apiKey: '',
        models: [{ id: 'm1', name: '', model: '', type: 'llm' }] });
      try {
        const rr = await Api.updateProfile({ aiProviders: rows });
        state.user = rr.data.user;
        Object.assign(u, state.user);
        Api.setSession(Api.token(), state.user);
        renderProfile(c);
        toast('已添加，点它的名称填接口地址、模型名和 API Key', true);
      } catch (e) { toast('添加失败：' + e.message); }
    };

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

    // 多模型配置的保存 / 切换 / 清除 / 自定义都在上面的 AI 面板里独立处理，
    // 不再参与页级「保存」（页级保存只管个人信息 / 购房需求 / 高德 Key）。
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
    // ---------- 检查更新（只读公开 version.json，不上传任何数据；仅提示 + 给命令，不碰服务器文件） ----------
    const chkBtn = $('pv-check-update');
    if (chkBtn) chkBtn.onclick = () => checkForUpdate(bv.tag, $('pv-update'));

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
        // 购房需求 + 最晚提醒（与个人信息一起保存）。
        // demand 整体覆盖，必须先合并旧值，否则会清掉「看房驾驶 / 购房计划」的数据。
        const demand = Object.assign({}, demandNow(), {
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
        });
        // 高德 Key 默认不回显：留空 = 不修改（后端 COALESCE 保持原值）。
        // 只认「真人输入过」的字段（data-dirty），浏览器密码自动填充的值一律忽略，
        // 避免把登录密码误存成高德 Key。
        const patch = { name, avatar, demand };
        const jsEl = $('amap-jskey'), secEl = $('amap-security');
        // 多模型清单由 AI 分组内的按钮独立提交，页级「保存」绝不碰这些字段：
        // 旧的单模型输入框已移除，若还按旧逻辑读空值会把用户配置清空。
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

  // ==================================================================
  // 看房驾驶 / 购房计划
  // 约定（勿改）：
  //  ① 数据只存 users.demand 的 dashboard / plan 子键，统一经 saveDemandSection() 合并保存。
  //     后端 PATCH /api/auth/me 早已支持 demand → 零后端改动、无需重启 8787。
  //  ② 所有房贷数字只调文件顶部唯一的 computeMortgage()；本区只收集表单值 + 渲染。
  //     利率敏感性 / 还款方式对比只是换参数重复调用同一个函数，绝不另写公式。
  //  ③ 金额口径：房屋总价 / 首付 / 贷款 / 目标 / 已存用「万」，月供 / 工资 / 费用用「元」。
  // ==================================================================
  const dashWan = (v) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + ' 万';
  const dashYuan = (v) => '¥' + Math.round(Number(v) || 0).toLocaleString('zh-CN');
  const dashPct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round(a / b * 100))) : 0);
  const dashRatio = (v) => Math.max(0, num(v) || 0) / 100;
  const dashUID = () => 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const dashDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';

  const DASH_DEFAULT = {
    totalPrice: '', downPayment: '', loanType: '商业贷款（商贷）', years: 30,
    commRate: 3.0, fundRate: 2.6, fundAmt: '', method: '等额本息',
    savingTarget: '', savingSaved: '', downTarget: '', downSaved: '',
    savingTargetTouched: false, downTargetTouched: false,
    monthlySaving: '', salary: '', monthlyOverride: '',
    feeDeed: 1, feeAgent: 2, feeMaintenance: 1, feeOther: 0.5, feeReno: ''
  };
  const DASH_LOAN_TYPES = ['商业贷款（商贷）', '公积金贷款', '组合贷（公积金+商贷）', '全款'];
  const DASH_METHODS = ['等额本息', '等额本金'];

  function dashData() { return Object.assign({}, DASH_DEFAULT, demandNow().dashboard || {}); }
  // 唯一的「表单值 → computeMortgage 参数」适配层；over 只用于敏感性对比换利率/还款方式
  function dashArgs(d, over) {
    const price = Math.max(0, num(d.totalPrice) || 0);
    const totalPrice = price * 10000;
    const cash = d.loanType === '全款';
    const downWan = Math.max(0, num(d.downPayment) || 0); // 万；与 price 同单位才能直接相除
    const downRatio = cash ? 1 : (price > 0 ? Math.min(1, downWan / price) : 0);
    const loanAmt = totalPrice * (1 - downRatio);
    const fundAmt = Math.min(Math.max(0, (num(d.fundAmt) || 0) * 10000), loanAmt);
    const commAmt = Math.max(0, loanAmt - fundAmt);
    return Object.assign({
      mode: 'price', totalPrice, downRatio,
      years: d.years || 30,
      loanType: LOAN_TYPE_TO_CALC[d.loanType] || 'comm',
      commRate: d.commRate, fundRate: d.fundRate, commAmt, fundAmt,
      method: REPAY_TO_CALC[d.method] || 'bx'
    }, over || {});
  }
  function dashCalc(d, over) { return computeMortgage(dashArgs(d, over)); }
  function dashMonthly(d, R) {
    const mo = num(d.monthlyOverride);
    return (mo != null && mo > 0) ? mo : R.monthlyFirst;
  }
  function dashRing(pct, label, side, color) {
    const C = 2 * Math.PI * 52, p = Math.max(0, Math.min(100, pct));
    return `<div class="dash-ring-card">
      <svg class="dash-ring" viewBox="0 0 130 130" aria-hidden="true">
        <circle cx="65" cy="65" r="52" fill="none" stroke="var(--line-strong)" stroke-width="11"/>
        <circle cx="65" cy="65" r="52" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"
          stroke-dasharray="${(p / 100 * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 65 65)"/>
        <text x="65" y="62" text-anchor="middle" class="dash-ring-num">${p}%</text>
        <text x="65" y="83" text-anchor="middle" class="dash-ring-cap">${esc(label)}</text>
      </svg>
      <div class="dash-ring-side">${side}</div>
    </div>`;
  }
  function dashPressure(ratio, noLoan) {
    if (noLoan) return { label: '全款购房', color: 'var(--muted)', hint: '没有贷款，不存在月供压力', cls: 'na' };
    if (!(ratio > 0)) return { label: '未测算', color: 'var(--muted)', hint: '填写月工资后自动测算', cls: 'na' };
    if (ratio <= 0.3) return { label: '健康', color: 'var(--success)', hint: '月供压力小，生活仍有弹性', cls: 'ok' };
    if (ratio <= 0.4) return { label: '适中', color: 'var(--aux-cyan)', hint: '可接受，但不建议再加杠杆', cls: 'mid' };
    if (ratio <= 0.5) return { label: '偏高', color: 'var(--warning)', hint: '抗风险能力变弱，务必留足应急金', cls: 'warn' };
    return { label: '高危', color: 'var(--error)', hint: '超过银行 50% 审批红线，建议降杠杆', cls: 'bad' };
  }
  function dashGauge(ratioPct, st) {
    const R = 76, L = Math.PI * R, p = Math.max(0, Math.min(100, ratioPct));
    return `<svg class="dash-gauge" viewBox="0 0 200 118" aria-hidden="true">
      <path d="M24 100 A76 76 0 0 1 176 100" fill="none" stroke="var(--line-strong)" stroke-width="14" stroke-linecap="round"/>
      <path d="M24 100 A76 76 0 0 1 176 100" fill="none" stroke="${st.color}" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${(p / 100 * L).toFixed(1)} ${L.toFixed(1)}"/>
      <text x="100" y="86" text-anchor="middle" class="dash-gauge-num">${Math.round(ratioPct)}%</text>
      <text x="100" y="108" text-anchor="middle" class="dash-gauge-cap">月供 / 月工资</text>
    </svg>`;
  }
  function dashEta(target, saved, monthly) {
    const gap = Math.max(0, (num(target) || 0) - (num(saved) || 0));
    if (gap <= 0 && (num(target) || 0) > 0) return '<div class="dash-eta done">🎉 目标已达成</div>';
    if (!(num(monthly) > 0)) return `<div class="dash-eta">还差 <b>${dashWan(gap)}</b> · 填「每月可存」可预测达成时间</div>`;
    const months = Math.ceil(gap / num(monthly));
    const dt = new Date(); dt.setMonth(dt.getMonth() + months);
    return `<div class="dash-eta">还差 <b>${dashWan(gap)}</b> · 按每月 ${dashWan(monthly)} 还需 <b>${months}</b> 个月，约 ${dt.getFullYear()} 年 ${dt.getMonth() + 1} 月达成</div>`;
  }
  function dashFees(d, R) {
    const price = (num(d.totalPrice) || 0) * 10000;
    const rows = [
      ['首付款', R.downPay], ['契税', price * dashRatio(d.feeDeed)],
      ['中介费', price * dashRatio(d.feeAgent)], ['维修基金', price * dashRatio(d.feeMaintenance)],
      ['其它杂费', price * dashRatio(d.feeOther)], ['装修预算', (num(d.feeReno) || 0) * 10000]
    ];
    return { rows, total: rows.reduce((s, x) => s + x[1], 0) };
  }
  async function dashRecentFollowups(props) {
    const all = await Promise.all(props.slice(0, 6).map(async (p) => {
      try {
        const rs = await Store.listFollowups(p.id);
        return (rs || []).map((r) => Object.assign({}, r, { _title: p.title || (p.location || {}).community || '房源' }));
      } catch (e) { return []; }
    }));
    return all.flat().sort((a, b) => String(b.happened_date || b.created_at || '')
      .localeCompare(String(a.happened_date || a.created_at || ''))).slice(0, 3);
  }

  // 购房设定表单：首页只读、购房计划页可编辑，共用同一份字段结构（勿写两套）
  function dashFieldHTML(k, label, type, ph, d) {
    return `<div class="field"><label>${esc(label)}</label><input type="${type || 'text'}" data-dash="${k}" value="${esc(d[k] == null ? '' : d[k])}" placeholder="${esc(ph || '')}" ${type === 'number' ? 'step="any" min="0"' : ''}/></div>`;
  }
  function dashSelectHTML(k, label, arr, d) {
    const opt = (a, cur) => a.map((x) => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    return `<div class="field"><label>${esc(label)}</label><select data-dash="${k}">${opt(arr, d[k])}</select></div>`;
  }
  // 目标值（存款 / 首付）未手动改过时，自动跟随总价 / 首付
  function dashApplyAutoTargets(d) {
    if (!d.savingTarget && !d.savingTargetTouched) d.savingTarget = d.totalPrice != null ? d.totalPrice : '';
    if (!d.downTarget && !d.downTargetTouched) d.downTarget = d.downPayment != null ? d.downPayment : '';
  }
  // 可编辑表单 HTML（购房计划页用）；首页只读视图 dashViewHTML 是它的只读镜像
  function dashFormHTML(d, props) {
    const purchasedOpts = (props || []).filter(isPurchased).map((p) =>
      `<option value="${esc(p.id)}">${esc(p.title || (p.location || {}).community || '已购房源')}</option>`).join('');
    return `
      <div class="dash-form-grid">
        <div class="dash-fsec">
          <h4>购房基础信息</h4>
          <div class="form-grid">
            ${dashFieldHTML('totalPrice', '房屋总价（万）', 'number', '例如 180', d)}
            ${dashFieldHTML('downPayment', '首付（万）', 'number', '填金额，自动算贷款', d)}
            ${dashSelectHTML('loanType', '贷款方式', DASH_LOAN_TYPES, d)}
            ${dashSelectHTML('method', '还款方式', DASH_METHODS, d)}
            ${dashFieldHTML('years', '贷款年限（年）', 'number', '1 ~ 30', d)}
            ${dashFieldHTML('commRate', '商贷利率（%）', 'number', '默认 3.0', d)}
            ${dashFieldHTML('fundRate', '公积金利率（%）', 'number', '默认 2.6', d)}
            ${dashFieldHTML('fundAmt', '公积金金额（万，组合贷）', 'number', '组合贷必填', d)}
          </div>
        </div>
        <div class="dash-fsec">
          <h4>进度与收入</h4>
          <div class="form-grid">
            ${dashFieldHTML('savingTarget', '存款目标（万）', 'number', '填总价后自动带入', d)}
            ${dashFieldHTML('savingSaved', '存款已存（万）', 'number', '手动填写', d)}
            ${dashFieldHTML('downTarget', '首付目标（万）', 'number', '填首付后自动带入', d)}
            ${dashFieldHTML('downSaved', '首付已存（万）', 'number', '手动填写', d)}
            ${dashFieldHTML('monthlySaving', '每月可存（万）', 'number', '用于预测达成时间', d)}
            ${dashFieldHTML('salary', '月工资（元）', 'number', '用于月供压力测算', d)}
            ${dashFieldHTML('monthlyOverride', '月供（元，留空用自动值）', 'number', '一般不用填', d)}
          </div>
        </div>
        <div class="dash-fsec">
          <h4>一次性费用比例（%）</h4>
          <div class="form-grid">
            ${dashFieldHTML('feeDeed', '契税', 'number', '1', d)}
            ${dashFieldHTML('feeAgent', '中介费', 'number', '2', d)}
            ${dashFieldHTML('feeMaintenance', '维修基金', 'number', '1', d)}
            ${dashFieldHTML('feeOther', '其它杂费', 'number', '0.5', d)}
            ${dashFieldHTML('feeReno', '装修预算（万）', 'number', '选填', d)}
          </div>
        </div>
      </div>
      <div class="dash-actions">
        <button class="btn sm" id="dash-from-budget" type="button">从购房需求预算带入</button>
        <select id="dash-pick-purchased" class="dash-mini-sel"><option value="">选择已购房源…</option>${purchasedOpts}</select>
        <button class="btn sm" id="dash-from-purchased" type="button">带入已购房源</button>
        <button class="btn sm" id="dash-go-mortgage" type="button">打开房贷计算 →</button>
      </div>`;
  }
  // 首页只读视图（看房驾驶用）；编辑入口在购房计划页
  function dashViewHTML(d) {
    const v = (x) => (x == null || x === '') ? '—' : esc(x);
    const w = (x, u) => (x == null || x === '') ? '—' : (esc(x) + ' ' + u);
    const sec = (title, rows) => `<div class="dash-fsec"><h4>${esc(title)}</h4><div class="dash-view-grid">${rows.map(([k, val]) => `<div class="kv"><span class="k">${esc(k)}</span><span>${val}</span></div>`).join('')}</div></div>`;
    return `<div class="dash-form-grid dash-form-grid--view">
      ${sec('购房基础信息', [
        ['房屋总价', w(d.totalPrice, '万')], ['首付', w(d.downPayment, '万')],
        ['贷款方式', v(d.loanType)], ['还款方式', v(d.method)],
        ['贷款年限', w(d.years, '年')], ['商贷利率', w(d.commRate, '%')],
        ['公积金利率', w(d.fundRate, '%')], ['公积金金额', w(d.fundAmt, '万')]
      ])}
      ${sec('进度与收入', [
        ['存款目标', w(d.savingTarget, '万')], ['存款已存', w(d.savingSaved, '万')],
        ['首付目标', w(d.downTarget, '万')], ['首付已存', w(d.downSaved, '万')],
        ['每月可存', w(d.monthlySaving, '万')], ['月工资', w(d.salary, '元')],
        ['月供(手动)', w(d.monthlyOverride, '元')]
      ])}
      ${sec('一次性费用比例（%）', [
        ['契税', v(d.feeDeed)], ['中介费', v(d.feeAgent)], ['维修基金', v(d.feeMaintenance)],
        ['其它杂费', v(d.feeOther)], ['装修预算', w(d.feeReno, '万')]
      ])}
    </div>`;
  }
  // 把可编辑表单的事件与「目标自动跟随」逻辑接到宿主容器（首页只读、计划页可编辑共用一套）
  function wireDashForm(host, d, onChange) {
    function setFieldSilent(k, val) {
      d[k] = val;
      const el = host.querySelector(`[data-dash="${k}"]`);
      if (el) el.value = val == null ? '' : val;
    }
    function onField(e) {
      const el = e.target.closest('[data-dash]');
      if (!el) return;
      const k = el.dataset.dash;
      d[k] = el.value;
      if (k === 'savingTarget') d.savingTargetTouched = true;
      if (k === 'downTarget') d.downTargetTouched = true;
      if (k === 'totalPrice' && !d.savingTargetTouched) setFieldSilent('savingTarget', el.value);
      if (k === 'downPayment' && !d.downTargetTouched) setFieldSilent('downTarget', el.value);
      if (onChange) onChange();
    }
    host.addEventListener('input', onField);
    host.addEventListener('change', onField);
    dashApplyAutoTargets(d);
    return { setFieldSilent };
  }

  async function renderDashboard(c) {
    if (!(state.properties && state.properties.length)) {
      try { state.properties = await Store.list(); } catch (e) { state.properties = []; }
    }
    const props = state.properties || [];
    const d = dashData();
    dashApplyAutoTargets(d);
    const recent = await dashRecentFollowups(props);
    const plan = planData();

    c.innerHTML = `
      <div class="dash-wrap dash-workspace">
        <div class="dash-results" id="dash-results">
          <div class="dash-kpi-band" id="dash-kpi-band"></div>
          <div class="dash-grid" id="dash-columns">
            <div class="dash-col" id="dash-col-l">
              <div class="card-block dash-view">
                <h3>购房设定<small>只读，点「编辑购房设定」到购房计划页修改</small><button class="dash-edit-link" id="dash-edit-btn" type="button">编辑购房设定</button></h3>
                ${dashViewHTML(d)}
              </div>
              <div class="dash-result" id="dash-fees"></div>
              <div class="dash-result" id="dash-funnel"></div>
            </div>
            <div class="dash-col" id="dash-col-r">
              <div id="dash-results-r"></div>
              <div class="dash-result" id="dash-sens"></div>
            </div>
          </div>
        </div>
      </div>`;

    $('dash-edit-btn').onclick = () => setView('plan');

    paintDashboard(props, d, recent, plan);
  }

  // 看房驾驶（只读版，第 29 轮定稿内容）：购房设定只读 + KPI + 看房漏斗与近期待办 + 贷款测算 + 资金进度 + 月供压力 + 一次性现金总需求 + 利率与还款方式敏感性
  // 编辑入口在购房计划页；所有数字只来自 dashCalc / dashFees / dashPressure 等单一数据源，不另写公式
  function paintDashboard(props, d, recent, plan) {
    const R = dashCalc(d);
    const monthly = dashMonthly(d, R);
    const noLoan = d.loanType === '全款' || !(R.loanAmt > 0);
    const salary = num(d.salary) || 0;
    const ratio = salary > 0 ? monthly / salary : 0;
    const st = dashPressure(ratio, noLoan);
    const saveTarget = num(d.savingTarget) || 0, saveNow = num(d.savingSaved) || 0;
    const downTarget = num(d.downTarget) || 0, downNow = num(d.downSaved) || 0;
    const fees = dashFees(d, R);
    const cr = num(d.commRate) || 0, fr = num(d.fundRate) || 0;
    const atRate = (delta) => dashCalc(d, { commRate: Math.max(0, cr + delta), fundRate: Math.max(0, fr + delta) }).monthlyFirst;
    const otherMethod = (REPAY_TO_CALC[d.method] || 'bx') === 'bx' ? 'bj' : 'bx';
    const alt = dashCalc(d, { method: otherMethod });
    const altName = otherMethod === 'bj' ? '等额本金' : '等额本息';
    const cnt = (s) => props.filter((p) => (txOf(p).status || '在售') === s).length;

    const kpis = [
      ['在库房源', props.length, '📋', 'primary'], ['待看房源', cnt('待看'), '🕒', 'orange'],
      ['已购房源', props.filter(isPurchased).length, '🏡', 'green'], ['收藏房源', props.filter((p) => p.favorite).length, '⭐', 'cyan']
    ].map(([k, v, ico, c]) => `<div class="dash-kpi kpi-c-${c}"><span class="dash-kpi-ico">${ico}</span><div class="kpi-txt"><b>${v}</b><span>${esc(k)}</span></div></div>`).join('');

    const funnel = ['在售', '待看', '已售', '已下架', '已购'].map((s) => {
      const n = cnt(s), p = props.length ? Math.round(n / props.length * 100) : 0;
      return `<div class="dash-funnel-row"><span>${esc(s)}</span><div class="dash-bar"><i style="width:${p}%"></i></div><b>${n}</b></div>`;
    }).join('');

    const todos = (plan.milestones || []).filter((x) => x && x.status !== '已完成' && dashDate(x.planDate))
      .sort((a, b) => a.planDate.localeCompare(b.planDate)).slice(0, 3);
    const followRows = recent.length ? recent.map((r) =>
      `<li><span class="dash-li-tag">跟进</span> ${esc(r._title)} · ${esc(r.content || r.type || '')} <em>${esc(r.happened_date || '')}</em></li>`).join('')
      : '<li class="muted">暂无跟进记录</li>';
    const todoRows = todos.length ? todos.map((x) =>
      `<li><span class="dash-li-tag plan">计划</span> ${esc(x.title)} <em>${esc(x.planDate)}</em></li>`).join('')
      : '<li class="muted">购房计划里暂无带日期的未完成节点</li>';

    const loanCard = `
      <div class="card-block">
        <h3>贷款测算结果<small>与「房贷计算」同一套公式</small></h3>
        <div class="dash-metrics">
          <div><span>预计贷款总额</span><b>${dashWan(R.loanAmt / 10000)}</b></div>
          <div><span>首付</span><b>${dashWan(R.downPay / 10000)}</b></div>
          <div><span>${d.method === '等额本金' ? '首月月供（逐月递减）' : '月供（每月固定）'}</span><b>${dashYuan(R.monthlyFirst)}</b></div>
          <div><span>总利息</span><b>${dashWan(R.totalInterest / 10000)}</b></div>
          <div><span>首年还款</span><b>${dashWan(R.annualFirst / 10000)}</b></div>
          <div><span>还款期数</span><b>${R.months} 期</b></div>
        </div>
        ${d.loanType === '组合贷（公积金+商贷）' ? '<div class="dash-tip">组合贷：商贷与公积金分别按各自利率计算后按月相加（口径与房贷计算一致）。</div>' : ''}
      </div>`;

    const savingCard = `
      <div class="card-block">
        <h3>资金进度<small>目标可手改，两个「已存」各自独立</small></h3>
        <div class="dash-rings">
          ${dashRing(dashPct(saveNow, saveTarget), '存款进度',
            `<b>${dashWan(saveNow)} / ${dashWan(saveTarget)}</b>${dashEta(saveTarget, saveNow, d.monthlySaving)}`, 'var(--primary)')}
          ${dashRing(dashPct(downNow, downTarget), '首付进度',
            `<b>${dashWan(downNow)} / ${dashWan(downTarget)}</b>${dashEta(downTarget, downNow, d.monthlySaving)}`, 'var(--aux-green)')}
        </div>
      </div>`;

    const pressureCard = `
      <div class="card-block">
        <h3>月供压力<small>工资 ${dashYuan(salary)} · 月供 ${dashYuan(monthly)}</small></h3>
        <div class="dash-pressure">
          ${dashGauge(ratio * 100, st)}
          <div class="dash-pressure-side">
            <div class="dash-health ${st.cls}">${esc(st.label)}</div>
            <div class="muted">${esc(st.hint)}</div>
            <div class="kv"><span class="k">月供后剩余</span><span>${dashYuan(Math.max(0, salary - monthly))}</span></div>
            <div class="kv"><span class="k">收入覆盖倍数</span><span>${salary > 0 && monthly > 0 ? (salary / monthly).toFixed(2) + ' 倍' : '—'}</span></div>
            <div class="kv"><span class="k">建议月供上限（工资 30%）</span><span>${dashYuan(salary * 0.3)}</span></div>
            <div class="dash-scale"><i class="ok"></i>≤30% 健康 <i class="mid"></i>30–40% 适中 <i class="warn"></i>40–50% 偏高 <i class="bad"></i>&gt;50% 高危</div>
          </div>
        </div>
      </div>`;

    const feesCard = `
      <div class="card-block">
        <h3>一次性现金总需求<small>首付之外还要准备的钱</small></h3>
        <div class="dash-fees">
          ${fees.rows.map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span>${dashYuan(v)}</span></div>`).join('')}
          <div class="dash-fee-total"><span>合计需现金</span><b>${dashWan(fees.total / 10000)}</b></div>
        </div>
        <div class="dash-tip">这里只作提醒，不会覆盖你上面手填的两个进度目标。</div>
      </div>`;

    const sensCard = `
      <div class="card-block">
        <h3>利率与还款方式敏感性<small>同一公式换参数测算</small></h3>
        <table class="dash-table"><thead><tr><th>情形</th><th>月供</th><th>说明</th></tr></thead><tbody>
          <tr><td>利率 -0.25%</td><td>${dashYuan(atRate(-0.25))}</td><td>商贷 / 公积金同时下调</td></tr>
          <tr class="cur"><td>当前方案</td><td>${dashYuan(R.monthlyFirst)}</td><td>${esc(d.method)} · ${R.years} 年</td></tr>
          <tr><td>利率 +0.25%</td><td>${dashYuan(atRate(0.25))}</td><td>商贷 / 公积金同时上调</td></tr>
          <tr><td>换成${altName}</td><td>${dashYuan(alt.monthlyFirst)}</td><td>总利息 ${dashWan(alt.totalInterest / 10000)}（当前 ${dashWan(R.totalInterest / 10000)}）</td></tr>
        </tbody></table>
      </div>`;

    const funnelCard = `
      <div class="card-block">
        <h3>看房漏斗与近期待办</h3>
        <div class="dash-funnel">${funnel}</div>
        <div class="dash-two-col">
          <div><h4>最近跟进</h4><ul class="dash-list">${followRows}</ul></div>
          <div><h4>计划里临近的节点</h4><ul class="dash-list">${todoRows}</ul></div>
        </div>
      </div>`;

    $('dash-kpi-band').innerHTML = `<div class="dash-kpis">${kpis}</div>`;
    $('dash-fees').innerHTML = feesCard;
    $('dash-sens').innerHTML = sensCard;
    $('dash-funnel').innerHTML = funnelCard;
    $('dash-results-r').innerHTML = loanCard + savingCard + pressureCard;
  }


  // ---- 看房驾驶 v2 卡片用到的数据聚合辅助（区域 / 装修），被上方 paintDashboard 复用，不另写公式 ----
  function anaRegion(props, d) {
    const map = {};
    props.forEach((p) => {
      const dist = (p.location && p.location.district) || '';
      if (!dist) return;
      if (!map[dist]) map[dist] = { count: 0, sum: 0 };
      map[dist].count++; map[dist].sum += (num(txOf(p).totalPrice) || 0);
    });
    const rows = Object.keys(map).map((k) => ({ name: k, count: map[k].count, avg: map[k].sum / map[k].count }))
      .sort((a, b) => b.count - a.count);
    const maxC = Math.max(1, ...rows.map((r) => r.count));
    rows.forEach((r) => { r.wpct = Math.round(r.count / maxC * 100); });
    const pref = String(d.districts || '').split(/[,，、\s]+/).filter(Boolean);
    let matchCount = 0;
    props.forEach((p) => {
      const dist = (p.location && p.location.district) || '';
      if (dist && pref.some((x) => dist.indexOf(x) > -1)) matchCount++;
    });
    return { rows, prefText: pref.join('/') || '未设置', matchCount };
  }
  function anaRenovation(props) {
    const items = [];
    props.filter(isPurchased).forEach((p) => {
      const a = atOf(p);
      const renos = Array.isArray(a.renovations) ? a.renovations : [];
      const budget = num(a.renovationCost);
      const title = p.title || (p.location && p.location.community) || '已购房源';
      if (renos.length) {
        renos.forEach((r) => {
          const phases = Array.isArray(r.progress) ? r.progress : [];
          const done = phases.filter((x) => x.status === '已完成').length;
          const pct = phases.length ? Math.round(done / phases.length * 100) : 0;
          const actual = phases.reduce((s, x) => s + (num(x.cost) || 0), 0);
          items.push({ title: renos.length > 1 ? title + ' · ' + (r.name || '方案') : title, phases, pct, budget, actual, over: budget > 0 && actual > budget });
        });
      } else if (budget > 0) {
        items.push({ title, phases: [], pct: 0, budget, actual: 0, over: false });
      }
    });
    return { items };
  }


  // ---------- 购房计划（里程碑 + 自定义任务） ----------
  // 第 28 轮（④A 已拍板）：把原「购房资格与预算核对」拆成 3 个购房前准备节点，共 12 个
  const MILESTONE_TPL = [
    '购房需求清单', '资格与征信自查', '资金预算与首付准备',
    '贷款预审与征信自查', '看房筛选与复看', '议价与支付定金',
    '网签与合同签署', '首付资金到账', '面签与贷款审批', '缴税与过户', '交房验收', '装修与入住'
  ];
  const DOC_TASK_TPL = ['身份证 / 户口本', '购房资格证明', '征信报告', '银行流水',
    '收入证明', '定金与首付凭证', '网签合同', '不动产权证'];
  const PLAN_STATUS = ['未开始', '进行中', '已完成'];
  function planToday() {
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }
  function planData() {
    const s = demandNow().plan || {};
    const ms = Array.isArray(s.milestones) ? s.milestones.map((x) => Object.assign({}, x)) : null;
    const ts = Array.isArray(s.tasks) ? s.tasks.map((x) => Object.assign({}, x)) : [];
    return {
      milestones: ms && ms.length ? ms : MILESTONE_TPL.map((t) => ({
        id: dashUID(), title: t, status: '未开始', planDate: '', doneDate: '', amount: '', note: '', propId: ''
      })),
      tasks: ts
    };
  }

  async function renderPlan(c) {
    if (!(state.properties && state.properties.length)) {
      try { state.properties = await Store.list(); } catch (e) { state.properties = []; }
    }
    const props = state.properties || [];
    const data = planData();
    const today = planToday();
    const propOpts = (cur) => '<option value="">不关联房源</option>' + props.map((p) =>
      `<option value="${esc(p.id)}" ${String(p.id) === String(cur || '') ? 'selected' : ''}>${esc(p.title || (p.location || {}).community || '房源')}</option>`).join('');
    const statusOpts = (cur) => PLAN_STATUS.map((s) =>
      `<option value="${s}" ${s === (cur || '未开始') ? 'selected' : ''}>${s}</option>`).join('');
    // ⑤A：任务可关联里程碑；下拉只列当前节点，老任务没有该字段时默认「不关联」
    const msOpts = (cur) => '<option value="">不关联里程碑</option>' + data.milestones.map((m, i) =>
      `<option value="${esc(m.id)}" ${String(m.id) === String(cur || '') ? 'selected' : ''}>${i + 1}. ${esc(m.title || '未命名节点')}</option>`).join('');
    const linkedTasks = (mid) => data.tasks.filter((t) => String(t.milestoneId || '') === String(mid));

    c.innerHTML = `
      <div class="plan-wrap">
        <div class="section-head"><h2>购房计划</h2><div class="spacer"></div><span class="dash-save" id="plan-save-state">✅ 数据随账号保存</span></div>
        <div id="plan-top"></div>
        <div class="card-block" id="plan-dash-card">
          <h3>购房设定<small>房屋总价 / 首付 / 贷款 / 进度与收入 / 一次性费用比例；保存后看房驾驶同步更新</small></h3>
          <div id="plan-dash-form-body"></div>
          <div class="dash-tip">金额口径：总价 / 首付 / 贷款 / 目标 / 已存用「万」，月供 / 工资 / 费用用「元」。数据保存在账号下，换设备也在。<span class="dash-save" id="plan-dash-save-state">✅ 数据随账号保存</span></div>
        </div>
        <div class="card-block">
          <h3>购房里程碑<small>默认 12 个节点（含购房前准备），可增删改名、调整顺序、关联房源</small></h3>
          <div class="plan-legend"><span>序号</span><span>节点名称 / 状态 / 计划日期 / 完成日期</span><span>金额 · 关联房源 · 备注 · 任务进度</span></div>
          <div id="plan-milestones"></div>
          <div class="plan-actions">
            <button class="btn sm primary" id="plan-add-m" type="button">＋ 新增节点</button>
            <button class="btn sm" id="plan-tpl" type="button">补齐默认节点</button>
            <button class="btn sm" id="plan-go-dash" type="button">去看房驾驶 →</button>
          </div>
        </div>
        <div class="card-block">
          <h3>自定义任务<small>资料清单等零散待办，可关联到里程碑</small></h3>
          <div class="plan-legend"><span>序号</span><span>任务名称 / 状态 / 截止日</span><span>关联里程碑 · 关联房源 · 备注</span></div>
          <div id="plan-tasks"></div>
          <div class="plan-actions">
            <button class="btn sm primary" id="plan-add-t" type="button">＋ 新增任务</button>
            <button class="btn sm" id="plan-docs" type="button">📎 一键生成资料清单</button>
          </div>
        </div>
        <div class="dash-tip">编辑后自动保存到账号（users.demand.plan），无需点保存；两台设备同时编辑时以最后一次保存为准。</div>
      </div>`;

    const statusEl = $('plan-save-state');
    const queueSave = makeAutoSave('plan', () => data, statusEl);
    const msEl = $('plan-milestones'), tsEl = $('plan-tasks');

    function rowHTML(kind, it, i) {
      const dueField = kind === 'm' ? it.planDate : it.due;
      const overdue = it.status !== '已完成' && dashDate(dueField) && dueField < today;
      const ops = `<div class="plan-ops">
        <button class="plan-ico" data-act="up" title="上移" type="button">↑</button>
        <button class="plan-ico" data-act="down" title="下移" type="button">↓</button>
        ${it.propId ? `<button class="plan-ico" data-act="open" title="查看关联房源" type="button">↗</button>` : ''}
        <button class="plan-ico del" data-act="del" title="删除" type="button">✕</button>
      </div>`;
      if (kind === 't') {
        return `<div class="plan-row t ${overdue ? 'overdue' : ''}" data-kind="t" data-id="${esc(it.id)}">
          <span class="plan-idx">${i + 1}</span>
          <div class="plan-main">
            <input data-field="title" value="${esc(it.title)}" placeholder="任务名称"/>
            <select data-field="status">${statusOpts(it.status)}</select>
            <input type="date" data-field="due" value="${esc(dashDate(it.due))}"/>
          </div>
          <div class="plan-sub">
            <select data-field="milestoneId" title="关联里程碑">${msOpts(it.milestoneId)}</select>
            <select data-field="propId">${propOpts(it.propId)}</select>
            <input data-field="note" value="${esc(it.note)}" placeholder="备注"/>
          </div>${ops}</div>`;
      }
      // ⑤A：里程碑只展示关联任务完成率；全部完成也只提示，不自动改状态
      const lk = linkedTasks(it.id);
      const lkDone = lk.filter((t) => t.status === '已完成').length;
      const lkPct = lk.length ? Math.round(lkDone / lk.length * 100) : 0;
      const canConfirm = lk.length > 0 && lkDone === lk.length && it.status !== '已完成';
      return `<div class="plan-row m ${overdue ? 'overdue' : ''}" data-kind="m" data-id="${esc(it.id)}">
        <span class="plan-idx">${i + 1}</span>
        <div class="plan-main">
          <input data-field="title" value="${esc(it.title)}" placeholder="节点名称"/>
          <select data-field="status">${statusOpts(it.status)}</select>
          <input type="date" data-field="planDate" value="${esc(dashDate(it.planDate))}" title="计划日期"/>
          <input type="date" data-field="doneDate" value="${esc(dashDate(it.doneDate))}" title="完成日期"/>
        </div>
        <div class="plan-sub">
          <input data-field="amount" value="${esc(it.amount)}" placeholder="金额(万)"/>
          <select data-field="propId">${propOpts(it.propId)}</select>
          <input data-field="note" value="${esc(it.note)}" placeholder="备注"/>
        </div>
        <div class="plan-m-progress">
          <span>关联任务</span>
          <div class="dash-bar"><i style="width:${lkPct}%"></i></div>
          <b>${lkDone} / ${lk.length} 已完成</b>
          ${lk.length === 0 ? '<em class="muted">暂无关联任务</em>'
            : canConfirm ? '<em class="plan-can-confirm">✓ 任务已全完成，可把上方状态改为「已完成」</em>' : ''}
        </div>${ops}</div>`;
    }
    function paintMilestones() {
      msEl.innerHTML = data.milestones.length
        ? data.milestones.map((it, i) => rowHTML('m', it, i)).join('')
        : '<div class="muted" style="padding:10px">还没有节点，点「新增节点」或「补齐默认节点」。</div>';
    }
    function paintTasks() {
      tsEl.innerHTML = data.tasks.length
        ? data.tasks.map((it, i) => rowHTML('t', it, i)).join('')
        : '<div class="muted" style="padding:10px">还没有自定义任务，可用「一键生成资料清单」快速添加。</div>';
    }
    function paintLists() { paintMilestones(); paintTasks(); }
    function paintTop() {
      const total = data.milestones.length;
      const done = data.milestones.filter((x) => x.status === '已完成').length;
      const pct = total ? Math.round(done / total * 100) : 0;
      const next = data.milestones.find((x) => x.status !== '已完成');
      const openTasks = data.tasks.filter((x) => x.status !== '已完成').length;
      const overdue = data.milestones.filter((x) => x.status !== '已完成' && dashDate(x.planDate) && x.planDate < today).length
        + data.tasks.filter((x) => x.status !== '已完成' && dashDate(x.due) && x.due < today).length;
      const dd = demandNow();
      let deadline = '<div class="muted">未设置最晚购房时间，可在「设置 → 购房需求」里开启。</div>';
      if (dd.deadlineEnabled && dashDate(dd.deadlineDate)) {
        const days = Math.ceil((new Date(dd.deadlineDate + 'T00:00:00') - new Date()) / 86400000);
        deadline = `<div class="plan-deadline ${days < 0 ? 'over' : ''}">⏰ ${days < 0 ? '已超期 ' + Math.abs(days) + ' 天' : '距最晚购房时间 ' + days + ' 天'}（${esc(dd.deadlineDate)}）</div>`;
      }
      // 第三栏：用已有数据填满顶部卡片右侧空白（不新增业务字段）
      const statusRows = PLAN_STATUS.map((s) => {
        const n = data.milestones.filter((x) => (x.status || '未开始') === s).length;
        const p = total ? Math.round(n / total * 100) : 0;
        const col = s === '已完成' ? 'var(--success)' : s === '进行中' ? 'var(--primary)' : 'var(--line-strong)';
        return `<div class="plan-stat-row"><span>${esc(s)}</span><div class="dash-bar"><i style="width:${p}%;background:${col}"></i></div><b>${n}</b></div>`;
      }).join('');
      const amountSum = data.milestones.reduce((a, x) => a + (num(x.amount) || 0), 0);
      const taskTotal = data.tasks.length;
      const taskDone = taskTotal - openTasks;
      const nearest = data.milestones.filter((x) => x.status !== '已完成' && dashDate(x.planDate))
        .sort((a, b) => a.planDate.localeCompare(b.planDate))[0];
      $('plan-top').innerHTML = `<div class="card-block plan-top-card">
        ${dashRing(pct, '计划完成度',
          `<b>${done} / ${total} 个节点已完成</b><div class="dash-eta">自定义任务待办 ${openTasks} 项 · 逾期 ${overdue} 项</div>`, 'var(--primary)')}
        <div class="plan-next-box">
          <div class="plan-next-label">下一步该做</div>
          ${next ? `<b>${esc(next.title)}</b><div class="muted">计划日期：${esc(next.planDate || '未设置')}</div>
            <button class="btn sm" id="plan-next-done" type="button">✓ 标记完成</button>`
            : '<b>全部节点已完成 🎉</b><div class="muted">可以新增节点继续跟踪装修与入住。</div>'}
          ${deadline}
        </div>
        <div class="plan-stat-box">
          <div class="plan-next-label">节点状态分布</div>
          <div class="plan-stat-bars">${statusRows}</div>
          <div class="plan-stat-grid">
            <div><span>计划金额合计</span><b>${amountSum ? dashWan(amountSum) : '—'}</b></div>
            <div><span>自定义任务</span><b>${taskDone} / ${taskTotal} 已完成</b></div>
            <div><span>逾期项</span><b class="${overdue ? 'is-over' : ''}">${overdue} 项</b></div>
            <div><span>下一个计划日</span><b>${esc(nearest ? nearest.planDate : '未设置')}</b></div>
          </div>
        </div>
      </div>`;
      const btn = $('plan-next-done');
      if (btn) btn.onclick = () => {
        if (!next) return;
        next.status = '已完成'; next.doneDate = today;
        paintLists(); paintTop(); queueSave();
      };
    }
    function onEdit(e) {
      const el = e.target.closest('[data-field]');
      if (!el) return;
      const row = el.closest('[data-id]');
      if (!row) return;
      const arr = row.dataset.kind === 'm' ? data.milestones : data.tasks;
      const it = arr.find((x) => String(x.id) === String(row.dataset.id));
      if (!it) return;
      it[el.dataset.field] = el.value;
      // 改成「已完成」且没填完成日期时自动补今天
      if (row.dataset.kind === 'm' && el.dataset.field === 'status' && el.value === '已完成' && !it.doneDate) {
        it.doneDate = today;
        const de = row.querySelector('[data-field="doneDate"]');
        if (de) de.value = today;
      }
      // 任务改状态 / 改关联里程碑时只重绘里程碑行，避免任务行输入框失焦
      if (row.dataset.kind === 't' && (el.dataset.field === 'status' || el.dataset.field === 'milestoneId')) {
        paintMilestones();
      } else if (el.dataset.field === 'status' || el.dataset.field === 'planDate' || el.dataset.field === 'due') {
        paintLists();
      }
      paintTop(); queueSave();
    }
    function onAct(e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('[data-id]');
      if (!row) return;
      const arr = row.dataset.kind === 'm' ? data.milestones : data.tasks;
      const i = arr.findIndex((x) => String(x.id) === String(row.dataset.id));
      if (i < 0) return;
      const act = btn.dataset.act;
      if (act === 'open') {
        const pid = arr[i].propId;
        if (pid) renderDetail(c, pid);
        return;
      }
      if (act === 'del') {
        // 删除里程碑时清掉任务上的悬空关联，避免进度统计找不到归属
        if (row.dataset.kind === 'm') {
          const gone = String(arr[i].id);
          data.tasks.forEach((t) => { if (String(t.milestoneId || '') === gone) t.milestoneId = ''; });
        }
        arr.splice(i, 1);
      }
      if (act === 'up' && i > 0) { const t = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = t; }
      if (act === 'down' && i < arr.length - 1) { const t = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = t; }
      paintLists(); paintTop(); queueSave();
    }
    [msEl, tsEl].forEach((el) => {
      el.addEventListener('input', onEdit);
      el.addEventListener('change', onEdit);
      el.addEventListener('click', onAct);
    });
    $('plan-add-m').onclick = () => {
      data.milestones.push({ id: dashUID(), title: '', status: '未开始', planDate: '', doneDate: '', amount: '', note: '', propId: '' });
      paintLists(); paintTop(); queueSave();
    };
    $('plan-add-t').onclick = () => {
      data.tasks.push({ id: dashUID(), title: '', status: '未开始', due: '', note: '', propId: '', milestoneId: '' });
      paintLists(); paintTop(); queueSave();
    };
    $('plan-tpl').onclick = () => {
      const have = new Set(data.milestones.map((x) => x.title));
      MILESTONE_TPL.forEach((t) => {
        if (!have.has(t)) data.milestones.push({ id: dashUID(), title: t, status: '未开始', planDate: '', doneDate: '', amount: '', note: '', propId: '' });
      });
      paintLists(); paintTop(); queueSave();
      toast('已补齐默认节点（不会改动已有节点）', true);
    };
    $('plan-docs').onclick = () => {
      const have = new Set(data.tasks.map((x) => x.title));
      DOC_TASK_TPL.forEach((t) => {
        if (!have.has(t)) data.tasks.push({ id: dashUID(), title: t, status: '未开始', due: '', note: '资料清单', propId: '', milestoneId: '' });
      });
      paintLists(); paintTop(); queueSave();
      toast('资料清单已加入自定义任务（重复项不会再加）', true);
    };
    $('plan-go-dash').onclick = () => setView('dashboard');
    // 购房设定可编辑表单（与首页只读视图共用 dashFormHTML / wireDashForm，勿写两套）
    const dashD = dashData();
    const formBody = $('plan-dash-form-body');
    formBody.innerHTML = dashFormHTML(dashD, props);
    const dashSave = makeAutoSave('dashboard', () => dashD, $('plan-dash-save-state'));
    const wf = wireDashForm(formBody, dashD, () => dashSave());
    $('dash-from-budget').onclick = () => {
      const b = num(demandNow().budgetMax);
      if (b == null) { toast('请先到「设置 → 购房需求」填写预算上限', true); return; }
      wf.setFieldSilent('totalPrice', String(b));
      if (!dashD.savingTargetTouched) wf.setFieldSilent('savingTarget', String(b));
      if (!dashD.downTargetTouched) wf.setFieldSilent('downTarget', dashD.downPayment);
      dashSave();
      toast('已从购房需求预算带入总价', true);
    };
    $('dash-from-purchased').onclick = () => {
      const p = props.find((x) => x.id === $('dash-pick-purchased').value);
      if (!p) { toast('请先选择一套已购房源', true); return; }
      const t = txOf(p);
      const price = t.purchasePrice != null ? t.purchasePrice : t.totalPrice;
      const fields = { totalPrice: price, loanType: t.loanType || dashD.loanType, years: t.loanYears || dashD.years, commRate: t.commRate, fundRate: t.fundRate, fundAmt: t.fundAmount, monthlyOverride: t.monthlyPayment };
      Object.keys(fields).forEach((k) => { if (fields[k] != null && fields[k] !== '') wf.setFieldSilent(k, String(fields[k])); });
      if (t.repayment) { dashD.method = t.repayment; const mEl = formBody.querySelector('[data-dash="method"]'); if (mEl) mEl.value = t.repayment; }
      const ratio = num(t.downPaymentRatio);
      if (ratio != null && num(price)) wf.setFieldSilent('downPayment', (num(price) * ratio).toFixed(2));
      if (!dashD.downTargetTouched) wf.setFieldSilent('downTarget', dashD.downPayment);
      if (!dashD.savingTargetTouched) wf.setFieldSilent('savingTarget', dashD.totalPrice);
      dashSave();
      toast('已带入该房源的购房信息', true);
    };
    $('dash-go-mortgage').onclick = () => setView('mortgage');
    paintLists(); paintTop();
    // 首次进入时把默认 12 个节点（含生成的 id）落到账号，避免每次刷新都换 id
    if (!demandNow().plan) queueSave();
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
    // 字段清单先就位，之后绑定导入/导出按钮时才不会拿到空表头
    try { await loadPropertySchema(); }
    catch (e) { console.error('[SCHEMA]', e.message); toast('字段清单加载失败，CSV 导入导出暂不可用：' + e.message); }
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
      requestAnimationFrame(recalcDetailMediaCap); // 内容宽度变了，左列高度与右列上限要重算
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
    wireMediaViewer();   // 详情页媒体查看器：全局只注册一次（内部用事件委托）
    // 窗口宽度变化会改变左列换行与高度，右列媒体上限跟着重算（防抖）
    let detailCapTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(detailCapTimer);
      detailCapTimer = setTimeout(recalcDetailMediaCap, 120);
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
    // API 返回 401 且已清本地会话时，兜底回到登录页（覆盖「页面一直开着、令牌 2 小时后过期」）
    window.addEventListener('hvt:unauthorized', () => {
      authNotice = '⏰ 登录已过期，请重新登录';
      state.user = null; applyAmapKey(); syncMapMenu(); showAuth(); idleStop();
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

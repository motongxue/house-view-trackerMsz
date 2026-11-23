/* core.js —— 房源采集插件的唯一核心：字段清单 -> 房源对象 -> CSV。
 *
 * 站点适配器（sites/*.js）只做一件事：把各自页面读成一份「扁平字段字典」。
 * 字段清单（public/js/property-schema.json）、数值/坐标归一化、经纬度坐标系转换、
 * 备注拼装、CSV 生成、统计，全部只在这里实现一份。以后加平台只加一个 site 文件。
 *
 * 纯函数，无浏览器 API；service worker（importScripts）/ Node（require）/ vm 测试三处共用。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HVT_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 唯一数据源是系统的 public/js/property-schema.json，插件不内嵌副本。
  // configure() 原地替换数组，保证外部拿到 CSV_COLS 引用时始终是最新的。
  var CSV_COLS = [];
  // configure 既收老的「纯数组」，也收新的完整 schema 对象 { csvCols, imageRules }。
  // imageRules 是外链图片规范化规则的唯一来源，别在站点适配器里另写一份。
  var IMAGE_RULES = [];
  function configure(input) {
    var cols = Array.isArray(input) ? input : (input && input.csvCols);
    if (Array.isArray(cols) && cols.length) {
      CSV_COLS.length = 0;
      cols.forEach(function (c) { CSV_COLS.push(c); });
    }
    // 传老格式（纯数组）时保留已有规则，不清空
    if (input && !Array.isArray(input) && Array.isArray(input.imageRules)) IMAGE_RULES = input.imageRules;
    return CSV_COLS;
  }

  // 站点注册表：registerSite() 由各 site 文件（或 mapper.js 门面）调用
  var SITES = {};
  function registerSite(site) {
    if (site && site.id) SITES[site.id] = site;
    return site;
  }
  function siteList() { return Object.keys(SITES); }
  function detectSite(url) {
    var u = String(url || '');
    for (var i = 0; i < siteList().length; i++) {
      var s = SITES[siteList()[i]];
      if (s && typeof s.match === 'function' && s.match(u)) return s.id;
    }
    return '';
  }

  // ---------- 通用工具（站点适配器共用，不要在 site 里重写） ----------
  function get(o, path) {
    var v = o;
    var ks = String(path || '').split('.');
    for (var i = 0; i < ks.length; i++) { if (v === null || v === undefined) return ''; v = v[ks[i]]; }
    return (v === null || v === undefined) ? '' : v;
  }
  function set(o, path, val) {
    var ks = path.split('.'), v = o;
    for (var i = 0; i < ks.length - 1; i++) {
      if (v[ks[i]] === null || v[ks[i]] === undefined || typeof v[ks[i]] !== 'object') v[ks[i]] = {};
      v = v[ks[i]];
    }
    v[ks[ks.length - 1]] = val;
  }
  function firstNum(v) {
    var m = String((v === null || v === undefined) ? '' : v).match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : '';
  }
  // 页面里的经纬度常是字符串；详情页/录入页会对 geo.lng/lat 调 .toFixed()，字符串直接抛 TypeError
  // F178：除类型与有限性外，再校验取值范围（纬度 [-90,90]，经度 [-180,180]），越界返回空
  function coordNum(v, isLat) {
    if (v === '' || v === null || v === undefined) return '';
    var n = Number(v);
    if (!isFinite(n)) return '';
    if (isLat ? (n < -90 || n > 90) : (n < -180 || n > 180)) return '';
    return n;
  }
  // 「住宅：2.5 别墅：2.5」这类多物业类型值，去掉类型标签后取第一段
  function cleanMulti(v) {
    var s = String((v === null || v === undefined) ? '' : v)
      .replace(/(?:住宅|别墅|商业|公寓|写字楼|商铺|洋房)\s*[:：]\s*/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return (s.split(' ')[0] || s).trim();
  }
  function uniq(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (u) {
      if (typeof u === 'string' && /^https?:\/\//.test(u) && !seen[u]) { seen[u] = 1; out.push(u); }
    });
    return out;
  }
  function safeText(v) { return String((v === null || v === undefined) ? '' : v).trim(); }
  // 系统 parseCsv 用 split(',') 且不解析引号，所以单元格里绝不能出现英文逗号/双引号/换行
  function sanitizeCsv(v) {
    return safeText(v).replace(/[\r\n]+/g, '；').replace(/,/g, '，').replace(/"/g, "'");
  }

  // 页面只有市级名称，省份靠这张小表补；未命中留空（系统 Regions.migrate 会按城市自动补）
  var PROVINCE_BY_CITY = {
    '北京': '北京市', '上海': '上海市', '天津': '天津市', '重庆': '重庆市',
    '成都': '四川省', '绵阳': '四川省', '德阳': '四川省', '宜宾': '四川省', '泸州': '四川省', '南充': '四川省',
    '乐山': '四川省', '眉山': '四川省', '自贡': '四川省', '达州': '四川省', '遂宁': '四川省', '内江': '四川省',
    '广州': '广东省', '深圳': '广东省', '佛山': '广东省', '东莞': '广东省', '珠海': '广东省', '惠州': '广东省',
    '杭州': '浙江省', '宁波': '浙江省', '温州': '浙江省', '南京': '江苏省', '苏州': '江苏省', '无锡': '江苏省',
    '武汉': '湖北省', '长沙': '湖南省', '郑州': '河南省', '西安': '陕西省', '济南': '山东省', '青岛': '山东省',
    '合肥': '安徽省', '福州': '福建省', '厦门': '福建省', '昆明': '云南省', '贵阳': '贵州省', '南宁': '广西壮族自治区',
    '海口': '海南省', '沈阳': '辽宁省', '大连': '辽宁省', '长春': '吉林省', '哈尔滨': '黑龙江省',
    '石家庄': '河北省', '太原': '山西省', '南昌': '江西省', '兰州': '甘肃省', '西宁': '青海省',
    '银川': '宁夏回族自治区', '乌鲁木齐': '新疆维吾尔自治区', '呼和浩特': '内蒙古自治区',
    '拉萨': '西藏自治区', '香港': '中国香港', '澳门': '中国澳门', '台北': '中国台湾'
  };
  function provinceOf(city) { return PROVINCE_BY_CITY[safeText(city)] || ''; }

  // ---------- 坐标：系统地图用高德 GCJ02，贝壳页面给的是百度 BD09 ----------
  // BD09 -> GCJ02 标准逆变换（纯数学，无网络请求）。参考样本：
  // 天安门 BD09 (116.403972, 39.915344) -> GCJ02 ≈ (116.397428, 39.909230)
  var X_PI = Math.PI * 3000.0 / 180.0;
  function bd09ToGcj02(lng, lat) {
    var x = Number(lng) - 0.0065, y = Number(lat) - 0.006;
    var z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
    var theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
    return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
  }
  function round8(n) { return Math.round(n * 1e8) / 1e8; }
  function normalizeGeo(lng, lat, coordSystem, sourceLabel) {
    var a = coordNum(lng, false), b = coordNum(lat, true);
    if (a === '' || b === '') return null;         // 只有半个坐标 / 非法值 -> 未定位
    if (coordSystem === 'BD09') {
      var g = bd09ToGcj02(a, b);
      a = round8(g.lng); b = round8(g.lat);
    }
    var geo = { lng: a, lat: b };
    if (sourceLabel) geo.source = sourceLabel;    // 安居客原样例不带 source，保持原样
    return geo;
  }

  // 数值列：统一把纯数字字符串转成 number（房源编号、户型等非纯数字文本保持原样）
  var NUM_PATHS = [
    'attributes.area', 'attributes.subwayDistance', 'attributes.propertyFee',
    'location.subwayDistance', 'transaction.totalPrice', 'transaction.unitPrice',
    'transaction.tax', 'transaction.downPayment', 'transaction.monthlyPayment',
    'transaction.gfundRatio', 'transaction.loanYears'
  ];
  function normalizeValue(path, v) {
    if (typeof v === 'number') return v;
    if (NUM_PATHS.indexOf(path) >= 0) {
      var s = safeText(v);
      if (s !== '' && /^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
    }
    return v;
  }

  function joinNotes(lines) {
    var out = [];
    (lines || []).forEach(function (l) {
      var s = safeText(l);
      if (s) out.push(s.replace(/[\r\n]+/g, '；'));
    });
    return out.join('\n');
  }

  function emptyMedia() {
    // links = 外链视频 / VR 播放页（{kind,cover,url,label}），不是 mp4，不能放进 videos
    return { images: [], videos: [], floorPlans: [], environment: [], links: [] };
  }

  /* 外链图片 URL 规范化：规则来自 property-schema.json 的 imageRules（和系统前端共用一份）。
   * 贝壳图片 CDN 只放行平台已申请的 m_fill 指令，原图直链会 403 CommandNotMatch(m_original)。
   * 只处理白名单 host + 白名单路径前缀 + 不带 '!' 指令的图片；已带指令的链接、本地 /media/、
   * data:、其它站点一律原样返回，不会破坏手动录入或安居客的图片。 */
  function mediaUrl(u) {
    var s = String((u === null || u === undefined) ? '' : u).trim();
    var m = s.match(/^(https?:\/\/)([^/?#]+)(\/[^?#]*)(\?[^#]*)?(#.*)?$/i);
    if (!m) return s;
    var host = m[2].toLowerCase(), p = m[3];
    for (var i = 0; i < IMAGE_RULES.length; i++) {
      var r = IMAGE_RULES[i];
      if (!r || !r.host || !r.command || !Array.isArray(r.pathPrefixes)) continue;
      var h = String(r.host).toLowerCase();
      if (host !== h && host.slice(-(h.length + 1)) !== '.' + h) continue;
      if (p.indexOf('!') >= 0 || !/\.(jpe?g|png|webp|gif)$/i.test(p)) return s;
      for (var k = 0; k < r.pathPrefixes.length; k++) {
        if (p.indexOf(r.pathPrefixes[k]) === 0) return m[1] + m[2] + p + r.command;
      }
    }
    return s;
  }
  function normalizeMedia(media) {
    ['images', 'videos', 'floorPlans', 'environment'].forEach(function (k) {
      if (Array.isArray(media[k])) media[k] = media[k].map(mediaUrl);
    });
    (Array.isArray(media.links) ? media.links : []).forEach(function (l) {
      if (l && typeof l === 'object' && l.cover) l.cover = mediaUrl(l.cover);
    });
    return media;
  }

  /* 主入口：站点适配器给字典，core 负责组装成标准房源对象。
   * raw = { fields:{路径:值}, media, notesLines, geoSystem, geoSourceLabel,
   *         name, hasMain, hasParams, singlePage, extras:{links,permits,groups,coordSource,...} } */
  function build(siteId, saved, meta) {
    // F179：未知 siteId 显式报错，不再静默用 anjuke 适配器套到别的页面上
    var site = SITES[siteId];
    if (!site) throw new Error('没有注册站点适配器：' + siteId);
    var raw = site.extract(saved || {}, meta || {}) || {};
    var fields = raw.fields || {};
    var row = {};

    // 与系统录入表单 collectForm 的结构保持一致：清单里每一列都存在，没采到的值为 ''
    CSV_COLS.forEach(function (c) {
      if (c[0] === 'notes' || c[0].indexOf('geo.') === 0) return; // 单独处理
      var v = fields[c[0]];
      set(row, c[0], (v === '' || v === null || v === undefined) ? '' : normalizeValue(c[0], v));
    });

    var media = Object.assign(emptyMedia(), raw.media || {});
    normalizeMedia(media);              // 外链图片补平台处理指令，避免导入后全部裂图
    row.media = media;
    row.geo = normalizeGeo(fields['geo.lng'], fields['geo.lat'], raw.geoSystem || '', raw.geoSourceLabel || '');
    row.notes = joinNotes(raw.notesLines);

    var filled = CSV_COLS.filter(function (c) {
      var v = get(row, c[0]); return v !== '' && v !== null && v !== undefined;
    }).length;
    var extras = raw.extras || {};
    var stats = {
      csvFilled: filled, csvTotal: CSV_COLS.length,
      media: {
        images: media.images.length, floorPlans: media.floorPlans.length,
        environment: media.environment.length, videos: media.videos.length,
        vr: (extras.links && extras.links.vr || []).length
      },
      detailGroups: extras.detailGroups || 0,
      permits: extras.permits || 0,
      coordSource: extras.coordSource || '',
      hasMain: raw.hasMain !== false,
      hasParams: !!raw.hasParams,
      singlePage: !!raw.singlePage,
      site: site.id,
      siteName: site.name
    };
    return {
      row: row,
      stats: stats,
      name: raw.name || row.title || '',
      site: site.id,
      siteName: site.name,
      singlePage: stats.singlePage,
      hasMain: stats.hasMain,
      hasParams: stats.hasParams,
      links: extras.links || { videos: [], vr: [], sand: [] },
      permits: extras.permitsData || [],
      groups: extras.groups || []
    };
  }

  function toCsv(row) {
    var head = CSV_COLS.map(function (c) { return c[1]; }).join(',');
    var line = CSV_COLS.map(function (c) { return sanitizeCsv(get(row, c[0])); }).join(',');
    return '\ufeff' + head + '\r\n' + line + '\r\n';
  }
  function fieldList(row) {
    return CSV_COLS.map(function (c) {
      return { path: c[0], label: c[1], value: get(row, c[0]) };
    });
  }

  return {
    CSV_COLS: CSV_COLS, configure: configure, registerSite: registerSite,
    siteList: siteList, detectSite: detectSite, build: build,
    toCsv: toCsv, fieldList: fieldList,
    get: get, set: set, safeText: safeText, sanitizeCsv: sanitizeCsv,
    firstNum: firstNum, coordNum: coordNum, cleanMulti: cleanMulti, uniq: uniq,
    mediaUrl: mediaUrl, normalizeMedia: normalizeMedia,
    provinceOf: provinceOf, PROVINCE_BY_CITY: PROVINCE_BY_CITY,
    bd09ToGcj02: bd09ToGcj02, normalizeGeo: normalizeGeo
  };
});

/* mapper.js —— 兼容门面：把「核心 + 站点适配器」组装起来，并保留旧的 HVT_MAP API。
 *
 * 旧的 MAP.build(main, params, meta) 仍然可用（安居客测试脚本/样例生成脚本依赖它），
 * 但实现已搬到 core.js + sites/anjuke.js；新代码一律用 MAP.buildSite(siteId, saved, meta)。
 * 字段清单唯一来源仍是系统的 public/js/property-schema.json（由 background 注入 core）。
 */
(function (root, factory) {
  // F133：显式布尔值，既用于判断环境也用于导出，避免把 module.exports 对象当标志位
  const isNode = typeof module !== 'undefined' && !!module.exports;
  var CORE = isNode ? require('./core.js') : (root && root.HVT_CORE);
  var ANJUKE = isNode ? require('./sites/anjuke.js') : (root && root.HVT_SITE_ANJUKE);
  var BEIKE = isNode ? require('./sites/beike.js') : (root && root.HVT_SITE_BEIKE);
  var api = factory(CORE, ANJUKE, BEIKE);
  if (isNode) module.exports = api;
  if (root) root.HVT_MAP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE, ANJUKE, BEIKE) {
  'use strict';
  if (!CORE) throw new Error('core.js 未加载');

  CORE.registerSite(ANJUKE);
  CORE.registerSite(BEIKE);

  // 新入口：按站点分派（background.js 使用）
  function buildSite(siteId, saved, meta) {
    return CORE.build(siteId, saved, meta);
  }

  // 旧入口：安居客两屏 Nuxt 数据 -> 房源对象（保持签名/返回结构不变）
  function build(main, params, meta) {
    return buildSite('anjuke', { main: main, params: params }, meta);
  }

  return {
    CSV_COLS: CORE.CSV_COLS,
    CORE: CORE,
    SITES: { anjuke: ANJUKE, beike: BEIKE },
    configure: CORE.configure,
    buildSite: buildSite,
    detectSite: CORE.detectSite,
    build: build,
    toCsv: CORE.toCsv,
    fieldList: CORE.fieldList,
    get: CORE.get,
    set: CORE.set,
    sanitizeCsv: CORE.sanitizeCsv,
    firstNum: CORE.firstNum,
    PROVINCE_BY_CITY: CORE.PROVINCE_BY_CITY
  };
});

// geo.js —— 地理编码：优先高德（输入小区名精准定位），未配置/失败则回退本地名称表
const Geo = (function () {
  // 等待高德脚本异步加载完成
  function ensureAmap() {
    if (window.AMap) return Promise.resolve(window.AMap);
    return new Promise((resolve, reject) => {
      let tries = 0;
      const timer = setInterval(() => {
        if (window.AMap) { clearInterval(timer); resolve(window.AMap); }
        else if (++tries > 100) { clearInterval(timer); reject(new Error('高德脚本未加载')); }
      }, 100);
    });
  }

  // 是否配置了有效 Key：只看配置，不看 SDK 是否加载完。
  // 刷新后直接进地图页时，高德脚本是异步加载的，此时 window.AMap 还没有，
  // 若用 amapReady() 当门禁会把「还没加载完」误报成「未配置 Key」。
  function hasKey() {
    const k = window.APP_CONFIG && window.APP_CONFIG.AMAP_KEY;
    return !!(k && !String(k).startsWith('YOUR_'));
  }
  function amapReady() {
    return hasKey() && !!window.AMap;
  }

  // 高德地理编码（返回第一个匹配）
  async function geocodeAmap(text, city) {
    const AMap = await ensureAmap();
    // 防御：若 Geocoder 插件尚未就绪（URL 插件加载时序差），用 AMap.plugin 兜底加载
    if (typeof AMap.Geocoder !== 'function') {
      await new Promise((resolve, reject) => {
        let done = false;
        const t = setTimeout(() => { if (!done) reject(new Error('Geocoder 插件加载超时')); }, 8000);
        AMap.plugin('AMap.Geocoder', () => { done = true; clearTimeout(t); resolve(); });
      });
    }
    const geocoder = new AMap.Geocoder({ city: city || '全国', batch: false });
    return new Promise((resolve, reject) => {
      geocoder.getLocation(text, (status, result) => {
        if (status === 'complete' && result.geocodes && result.geocodes.length) {
          const g = result.geocodes[0];
          resolve({
            lng: g.location.lng,
            lat: g.location.lat,
            formattedAddress: g.formattedAddress,
            source: 'amap'
          });
        } else {
          reject(new Error('高德未匹配到该地址'));
        }
      });
    });
  }

  // 本地名称表兜底（仅覆盖已录入的小区，坐标为近似示意）
  async function geocodeLocal(text, city) {
    const res = await fetch('./data/gazetteer.json');
    const gaz = await res.json();
    const entry = gaz[city] || gaz['成都'];
    if (!entry || !Array.isArray(entry.communities)) throw new Error('本地库无该城市数据');
    const q = (text || '').toLowerCase();
    for (const c of entry.communities) {
      const name = (c.name || '').toLowerCase();
      const kws = Array.isArray(c.keywords) ? c.keywords.map((k) => String(k).toLowerCase()) : [name];
      if (kws.some((k) => k && q.includes(k)) || name.includes(q)) {
        return {
          lng: c.lng, lat: c.lat,
          formattedAddress: (entry.center ? entry.center.name + ' · ' : '') + c.name,
          source: 'local'
        };
      }
    }
    throw new Error('本地名称表也未匹配，请在地图上手动点选');
  }

  // 统一入口
  async function geocode(text, city) {
    if (amapReady()) {
      try { return await geocodeAmap(text, city); }
      catch (e) { console.warn('高德定位失败，回退本地：', e.message); }
    }
    return await geocodeLocal(text, city);
  }

  return { geocode, ensureAmap, amapReady, hasKey };
})();
window.Geo = Geo;

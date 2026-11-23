// geo.js —— 地理编码：优先高德（输入小区名精准定位），未配置/失败则回退本地名称表
const Geo = (function () {
  // 等待高德脚本异步加载完成。缓存 in-flight promise，避免并发调用各自起一个轮询定时器（F060）。
  const AMAP_POLL_MS = 100;
  const AMAP_WAIT_MAX_MS = 10000; // 总等待上限（原 100 次 × 100ms）
  let amapPromise = null;
  function ensureAmap() {
    if (window.AMap) return Promise.resolve(window.AMap);
    if (amapPromise) return amapPromise;
    amapPromise = new Promise((resolve, reject) => {
      let elapsed = 0;
      const timer = setInterval(() => {
        if (window.AMap) {
          clearInterval(timer); amapPromise = null; resolve(window.AMap);
        } else if ((elapsed += AMAP_POLL_MS) >= AMAP_WAIT_MAX_MS) {
          clearInterval(timer); amapPromise = null; reject(new Error('高德脚本未加载'));
        }
      }, AMAP_POLL_MS);
    });
    return amapPromise;
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
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error('Geocoder 插件加载超时'));
        }, 8000);
        AMap.plugin('AMap.Geocoder', () => {
          if (done) return; // 超时后的晚回调不再改变 promise 状态（F059）
          done = true; clearTimeout(t); resolve();
        });
      });
      if (typeof AMap.Geocoder !== 'function') throw new Error('Geocoder 插件未就绪'); // 回调后复核（F059）
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
  let gazetteerPromise = null;
  function loadGazetteer() {
    if (!gazetteerPromise) {
      gazetteerPromise = fetch('./data/gazetteer.json').then((res) => {
        if (!res.ok) throw new Error('离线小区库加载失败（HTTP ' + res.status + '）'); // F187
        return res.json();
      }).catch((e) => { gazetteerPromise = null; throw e; }); // 失败后允许下次重试（F187）
    }
    return gazetteerPromise;
  }
  async function geocodeLocal(text, city) {
    const gaz = await loadGazetteer();
    const key = String(city || '').trim();
    const entry = gaz[key] || gaz[key.replace(/市$/, '')];
    if (!entry || !Array.isArray(entry.communities)) {
      throw new Error('该城市暂无离线小区库，请配置高德 Key 或直接在地图上点选');
    }
    const q = (text || '').trim().toLowerCase();
    if (!q) throw new Error('请输入小区名称或地址'); // F266: 空查询绝不能命中列表第一个小区
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
    if (!String(text == null ? '' : text).trim()) throw new Error('请输入小区名称或地址'); // F266
    // F188: 配了 Key 就尝试高德，由 geocodeAmap 内 ensureAmap 负责等待 SDK 异步加载完成，
    // 不再用 amapReady() 当门禁（刷新后 SDK 未就绪会误回退到近似坐标）。
    if (hasKey()) {
      try { return await geocodeAmap(text, city); }
      catch (e) { console.warn('高德定位失败，回退本地：', e.message); }
    }
    return await geocodeLocal(text, city);
  }

  return { geocode, ensureAmap, amapReady, hasKey };
})();
window.Geo = Geo;

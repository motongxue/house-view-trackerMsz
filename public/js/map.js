// map.js —— 高德真实底图封装（点标注 / 点击查看摘要 / 点击补点）
const HVMap = (function () {
  // 转义用户可控文本，避免注入到 InfoWindow 的 HTML 造成 XSS
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isReady() { return Geo.amapReady(); }

  // 多房源聚合地图：points = [{id, title, sub, geo:{lng,lat}}]
  async function renderMulti(container, points, onPointClick) {
    if (!Geo.hasKey()) {
      container.innerHTML = '<div class="empty">未配置高德 Key，无法显示在线地图。<br/>请在 config.js 填入 AMAP_KEY / AMAP_SECURITY_CODE，或去“录入”里手动点图定位。</div>';
      return null;
    }
    // Key 已配置但高德脚本可能仍在异步加载（刷新后直接进地图页就会这样）：等待加载完成再画
    container.innerHTML = '<div class="empty">地图加载中…</div>';
    let AMap;
    try { AMap = await Geo.ensureAmap(); }
    catch (e) {
      container.innerHTML = '<div class="empty">在线地图加载失败，请检查网络后刷新重试。</div>';
      return null;
    }
    if (!container.isConnected) return null; // 等待期间用户已切走，不要往游离节点里画地图
    container.innerHTML = ''; // 清掉加载占位，AMap.Map 需要干净的容器
    const map = new AMap.Map(container, { zoom: 11, viewMode: '2D' });
    const markers = [];
    (points || []).forEach((p) => {
      if (p.geo && p.geo.lng && p.geo.lat) {
        const marker = new AMap.Marker({ position: [p.geo.lng, p.geo.lat], title: p.title || '' });
        marker.on('click', () => {
          const info = new AMap.InfoWindow({
            content: `<div class="map-tip"><b>${escHtml(p.title)}</b><br/>${escHtml(p.sub)}</div>`,
            offset: new AMap.Pixel(0, -28)
          });
          info.open(map, marker.getPosition());
          if (onPointClick) onPointClick(p);
        });
        map.add(marker);
        markers.push(marker);
      }
    });
    if (markers.length) map.setFitView(markers, false, [50, 50, 50, 50]);
    else container.innerHTML = '<div class="empty">暂无已定位的房源。</div>';
    return map;
  }

  // 单点地图（详情/录入用）。opts.onClick(lng, lat) 用于“点击补点”
  async function renderSingle(container, lng, lat, opts) {
    opts = opts || {};
    if (!Geo.hasKey()) {
      container.innerHTML = '<div class="empty">未配置高德 Key，无法显示在线地图。</div>';
      return null;
    }
    container.innerHTML = '<div class="empty">地图加载中…</div>';
    let AMap;
    try { AMap = await Geo.ensureAmap(); }
    catch (e) {
      container.innerHTML = '<div class="empty">在线地图加载失败，请检查网络后刷新重试。</div>';
      return null;
    }
    if (!container.isConnected) return null;
    container.innerHTML = '';
    const center = (lng && lat) ? [lng, lat] : [104.0668, 30.5728];
    const map = new AMap.Map(container, { zoom: lng && lat ? 15 : 11, center });
    let marker = null;
    function setMarker(lo, la) {
      if (marker) map.remove(marker);
      marker = new AMap.Marker({ position: [lo, la] });
      map.add(marker);
      map.setCenter([lo, la]);
    }
    if (lng && lat) setMarker(lng, lat);
    if (opts.onClick) {
      map.on('click', (e) => {
        const lo = e.lnglat.getLng(), la = e.lnglat.getLat();
        setMarker(lo, la);
        opts.onClick(lo, la);
      });
    }
    return map;
  }

  return { renderMulti, renderSingle, isReady };
})();
window.HVMap = HVMap;

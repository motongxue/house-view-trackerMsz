// map.js —— 高德真实底图封装（点标注 / 点击查看摘要 / 点击补点）
const HVMap = (function () {
  // 转义用户可控文本，避免注入到 InfoWindow 的 HTML 造成 XSS
  function escHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isReady() { return Geo.amapReady(); }

  // F072: 默认中心与缩放级别集中定义，避免散落魔数。
  const DEFAULT_CENTER = [104.0668, 30.5728];
  const ZOOM_SINGLE = 15;
  const ZOOM_MULTI = 11;
  const ZOOM_DEFAULT = 11;

  // F205/F206/F207: 经纬度 0 是合法坐标，不能用真值判断缺失。
  function hasPos(lng, lat) {
    return Number.isFinite(lng) && Number.isFinite(lat);
  }

  // F208/F270: 同一容器只保留一个 Map 实例，重建前销毁旧实例，避免实例 / 点击监听器累积泄漏。
  function destroyMap(container) {
    const old = container.__hvtMap;
    if (old) {
      try { old.destroy(); } catch (e) { /* 已销毁则忽略 */ }
      container.__hvtMap = null;
    }
  }
  function keepMap(container, map) {
    destroyMap(container);
    container.__hvtMap = map;
    return map;
  }

  // F204: renderMulti / renderSingle 共用的准备逻辑：Key 检查、加载占位、ensureAmap 错误处理。
  // 返回 AMap 命名空间；返回 null 表示已写入提示或容器已卸载，调用方不要继续绘制。
  async function prepareContainer(container, noKeyMsg) {
    destroyMap(container); // 先销毁旧实例，再写 innerHTML，否则旧 canvas 被 detach 但实例仍存活（F269/F270）
    if (!Geo.hasKey()) {
      container.innerHTML = '<div class="empty">' + noKeyMsg + '</div>';
      return null;
    }
    container.innerHTML = '<div class="empty">地图加载中…</div>';
    let AMap;
    try { AMap = await Geo.ensureAmap(); }
    catch (e) {
      container.innerHTML = '<div class="empty">在线地图加载失败，请检查网络后刷新重试。</div>';
      return null;
    }
    if (!container.isConnected) return null; // 等待期间用户已切走，不要往游离节点里画地图
    return AMap;
  }

  // 多房源聚合地图：points = [{id, title, sub, geo:{lng,lat}}]
  async function renderMulti(container, points, onPointClick) {
    const AMap = await prepareContainer(container,
      '未配置高德 Key，无法显示在线地图。<br/>请在 config.js 填入 AMAP_KEY / AMAP_SECURITY_CODE，或去“录入”里手动点图定位。');
    if (!AMap) return null;
    container.innerHTML = ''; // 清掉加载占位，AMap.Map 需要干净的容器
    const map = new AMap.Map(container, { zoom: ZOOM_MULTI, viewMode: '2D' });
    keepMap(container, map);
    const markers = [];
    (points || []).forEach((p) => {
      if (p.geo && hasPos(p.geo.lng, p.geo.lat)) { // F205
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
    if (markers.length) {
      map.setFitView(markers, false, [50, 50, 50, 50]);
    } else {
      // F269: 不能直接覆盖持有画布的容器，先销毁实例再写空态，避免 Map 持有被 detach 的 DOM。
      destroyMap(container);
      container.innerHTML = '<div class="empty">暂无已定位的房源。</div>';
      return null;
    }
    return map;
  }

  // 单点地图（详情/录入用）。opts.onClick(lng, lat) 用于“点击补点”
  async function renderSingle(container, lng, lat, opts) {
    opts = opts || {};
    const AMap = await prepareContainer(container, '未配置高德 Key，无法显示在线地图。');
    if (!AMap) return null;
    container.innerHTML = '';
    const okPos = hasPos(lng, lat); // F206
    const center = okPos ? [lng, lat] : DEFAULT_CENTER;
    const map = new AMap.Map(container, { zoom: okPos ? ZOOM_SINGLE : ZOOM_DEFAULT, center });
    keepMap(container, map); // F208
    let marker = null;
    function setMarker(lo, la) {
      if (!hasPos(lo, la)) return; // F207
      if (marker) map.remove(marker);
      marker = new AMap.Marker({ position: [lo, la] });
      map.add(marker);
      map.setCenter([lo, la]);
    }
    if (okPos) setMarker(lng, lat);
    if (opts.onClick) {
      map.on('click', (e) => {
        const ll = e && e.lnglat; // F207: click 事件可能没有 lnglat，先 guard 再取值
        if (!ll || typeof ll.getLng !== 'function' || typeof ll.getLat !== 'function') return;
        const lo = ll.getLng(), la = ll.getLat();
        if (!hasPos(lo, la)) return;
        setMarker(lo, la);
        opts.onClick(lo, la);
      });
    }
    return map;
  }

  return { renderMulti, renderSingle, isReady };
})();
window.HVMap = HVMap;

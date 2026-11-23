/* ============================================================
 * 「装修设计」页 · 一键布置家具
 * 纯函数、零 DOM、零网络：按房间名配家具 → 在房间多边形内靠墙找位置 →
 * 自动避开墙体（外扩 PAD）与已摆家具（间隔 GAP）。
 *
 * 用法（浏览器）：
 *   window.hvtAutoFurnish(ROOMS, F, LIB)  →  furniture[]
 * 其中 F 是页面里的家具工厂 (type,name,cx,cy,w,d,rot,color) => obj，
 * LIB 是页面家具库（尺寸从库里取，不写死）。
 * Node 下 require() 拿到同一个函数，便于离线验证。
 * ============================================================ */
(function (root, factory) {
  const fn = factory();
  if (typeof module === 'object' && module.exports) module.exports = fn;
  if (root) { root.hvtAutoFurnish = fn; root.hvtAutoFurnishRecipes = fn.recipes; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // 业务数值集中为常量（PAD/GAP/STEP :mm），避免散落的魔数
  const PAD = 130;    // 家具外沿与墙的最小净距（mm）
  const GAP = 90;     // 家具之间的最小净距（mm）
  const STEP = 160;   // 候选位置网格步长（mm）
  const MAX_CANDIDATES = 4000; // 极端大房间候选点上限

  // 房间名 → 家具「类型」清单；顺序是匹配优先级（先特殊后通用）
  const RECIPES = [
    [/玄关|门厅|过道|走廊|hall|entry/i,        ['shoecab']],
    [/衣帽|储物|cloak|storage/i,                ['wardrobe', 'wardrobe', 'dresser']],
    [/书房|study|办公/i,                        ['desk', 'bookshelf', 'officechair', 'chair']],
    [/厨|kitchen/i,                             ['counter', 'counter', 'stove', 'ksink', 'fridge']],
    [/卫|浴|厕|洗手|bath|wc/i,                  ['shower', 'vanity', 'toilet', 'washer']],
    [/阳台|露台|balcony/i,                      ['washer', 'plant', 'armchair']],
    [/餐|dining/i,                              ['table', 'chair', 'chair', 'chair', 'chair', 'cabinet']],
    [/客厅|起居室|living|family/i,              ['sofa', 'tvstand', 'coffeetable', 'rug', 'armchair', 'plant']],
    [/卧|bedroom|主卧|次卧|儿童/i,              ['bed', 'wardrobe', 'nightstand', 'nightstand', 'dresser']],
    [/影音|娱乐|休闲|活动/i,                    ['cornersofa', 'tvstand', 'coffeetable', 'beanbag']],
    // 兜底：英文用单词边界，避免把 "Showroom"/"Mushroom" 之类误判成客厅
    [/厅|\broom\b/i,                            ['sofa', 'coffeetable', 'plant']]
  ];

  function itemsFor(lib, type) {
    const out = [];
    (lib || []).forEach(function (cat) {
      (cat.items || []).forEach(function (it) {
        if (it && it[0] === type && Number.isFinite(it[2]) && Number.isFinite(it[3])) {
          out.push({ type: it[0], name: it[1], w: it[2], d: it[3], color: it[4] });
        }
      });
    });
    // 大件优先（放不下时会自动降级到小一号）
    out.sort(function (a, b) { return b.w * b.d - a.w * a.d; });
    return out;
  }

  function inPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // 加密采样（5×5）判定整个外扩矩形是否落在房间内。
  // 3×3 的四角+边中点可能让跨凹口的大件家具「九点都在内」，这里增加边缘采样密度。
  function rectInside(cx, cy, hw, hh, poly) {
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        if (!inPoly(cx + i * hw / 2, cy + j * hh / 2, poly)) return false;
      }
    }
    return true;
  }

  function bbox(poly) {
    const xs = poly.map(function (p) { return p[0]; });
    const ys = poly.map(function (p) { return p[1]; });
    return [Math.min.apply(null, xs), Math.min.apply(null, ys),
            Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }

  function overlaps(cx, cy, hw, hh, placed) {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (Math.abs(cx - p.cx) < hw + p.hw + GAP && Math.abs(cy - p.cy) < hh + p.hh + GAP) return true;
    }
    return false;
  }

  // 候选中心点：全网格但按「距房间边界由近到远」排序，
  // 于是第一个可行解就是最贴墙的位置，后续家具沿墙依次排开。
  // F039: 房间任一维小于 2*PAD 时降级 PAD，保证网格非空；
  // F166: 超限时不直接 slice 前 N 个（会丢掉远离墙的候选），改为等间隔抽样保留覆盖。
  function candidates(bb) {
    const spanX = bb[2] - bb[0], spanY = bb[3] - bb[1];
    const padX = Math.min(PAD, Math.max(0, spanX / 2 - 1));
    const padY = Math.min(PAD, Math.max(0, spanY / 2 - 1));
    const pts = [];
    for (let x = bb[0] + padX; x <= bb[2] - padX; x += STEP) {
      for (let y = bb[1] + padY; y <= bb[3] - padY; y += STEP) {
        const d = Math.min(x - bb[0], bb[2] - x, y - bb[1], bb[3] - y);
        pts.push([x, y, d]);
      }
    }
    pts.sort(function (a, b) { return a[2] - b[2]; });
    if (pts.length > MAX_CANDIDATES) {
      const stride = pts.length / MAX_CANDIDATES;
      const sampled = [];
      for (let i = 0; i < MAX_CANDIDATES; i++) sampled.push(pts[Math.floor(i * stride)]);
      return sampled;
    }
    return pts;
  }

  // F166: pts 由每房间预算一次并传入，不再在 placeOne 内重复全网格构建+排序。
  function placeOne(roomPoly, pts, placed, w, d) {
    let best = null;
    // rot 0 与 90 各试一次；AABB 只需交换宽深。
    // hw/hh 是家具真实半宽（用于彼此间隔），外扩 PAD 后的矩形只用于判断是否贴墙。
    const rots = [[0, w / 2, d / 2], [90, d / 2, w / 2]];
    for (let r = 0; r < rots.length; r++) {
      const rot = rots[r][0], hw = rots[r][1], hh = rots[r][2];
      for (let i = 0; i < pts.length; i++) {
        const cx = pts[i][0], cy = pts[i][1], wallD = pts[i][2];
        // 按 bbox 距离排序，越靠后越不可能优于已有解
        if (best && wallD > best.wallD) break;
        if (!rectInside(cx, cy, hw + PAD, hh + PAD, roomPoly)) continue;
        if (overlaps(cx, cy, hw, hh, placed)) continue;
        const cand = { cx: cx, cy: cy, rot: rot, hw: hw, hh: hh, wallD: wallD };
        if (!best || cand.wallD < best.wallD) best = cand;
      }
    }
    return best;
  }

  function recipeFor(name) {
    const n = String(name || '');
    for (let i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i][0].test(n)) return RECIPES[i][1];
    }
    // F040: 未匹配的房间名输出诊断，便于发现新语种/特殊命名，而不是静默不摆
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[autoFurnish] 未匹配到家具配方，房间将不自动摆放：' + n);
    }
    return null;
  }

  function autoFurnish(rooms, makeF, lib) {
    const out = [];
    if (!Array.isArray(rooms) || typeof makeF !== 'function') return out;
    // F038: 按 type 预算家具变体，避免在「每个房间的每个配方」里全量重扫家具库
    const variantCache = new Map();
    function variantsOf(type) {
      if (!variantCache.has(type)) variantCache.set(type, itemsFor(lib, type));
      return variantCache.get(type);
    }
    rooms.forEach(function (room) {
      if (!room) return;
      // F257: 先过滤畸形顶点，单个坏房间不再让整批布置崩溃
      let poly = (Array.isArray(room.poly) ? room.poly : []).filter(function (v) {
        return Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
      });
      if (poly.length < 3) return;
      // 去掉闭合重复点，避免零长度边
      const p0 = poly[0], pn = poly[poly.length - 1];
      if (p0[0] === pn[0] && p0[1] === pn[1]) poly = poly.slice(0, -1);
      if (poly.length < 3) return;
      const recipe = recipeFor(room.name || room.id);
      if (!recipe || !recipe.length) return;
      const bb = bbox(poly);
      const pts = candidates(bb);       // 每房间只算一次候选点
      const placed = [];                // 房间内的占位（含外扩），跨房间不互相影响
      recipe.forEach(function (type) {
        const variants = variantsOf(type);
        for (let v = 0; v < variants.length; v++) {
          const it = variants[v];
          const pos = placeOne(poly, pts, placed, it.w, it.d);
          if (!pos) continue;           // 这间房放不下 → 试小一号 / 换类型
          out.push(makeF(it.type, it.name, pos.cx, pos.cy, it.w, it.d, pos.rot, it.color));
          placed.push({ cx: pos.cx, cy: pos.cy, hw: pos.hw, hh: pos.hh });
          return;
        }
      });
    });
    return out;
  }

  // F041: 导出冻结副本，外部篡改不会污染全局/Node 消费者行为
  autoFurnish.recipes = Object.freeze(RECIPES.map(function (r) {
    return Object.freeze([r[0], Object.freeze(r[1].slice())]);
  }));
  autoFurnish.constants = Object.freeze({ PAD: PAD, GAP: GAP, STEP: STEP, MAX_CANDIDATES: MAX_CANDIDATES });
  return autoFurnish;
});

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
  var fn = factory();
  if (typeof module === 'object' && module.exports) module.exports = fn;
  if (root) { root.hvtAutoFurnish = fn; root.hvtAutoFurnishRecipes = fn.recipes; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var PAD = 130;    // 家具外沿与墙的最小净距（mm）
  var GAP = 90;     // 家具之间的最小净距（mm）
  var STEP = 160;   // 候选位置网格步长（mm）

  // 房间名 → 家具「类型」清单；顺序是匹配优先级（先特殊后通用）
  var RECIPES = [
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
    [/厅|room/i,                                ['sofa', 'coffeetable', 'plant']]
  ];

  function itemsFor(lib, type) {
    var out = [];
    (lib || []).forEach(function (cat) {
      (cat.items || []).forEach(function (it) {
        if (it[0] === type && Number.isFinite(it[2]) && Number.isFinite(it[3])) {
          out.push({ type: it[0], name: it[1], w: it[2], d: it[3], color: it[4] });
        }
      });
    });
    // 大件优先（放不下时会自动降级到小一号）
    out.sort(function (a, b) { return b.w * b.d - a.w * a.d; });
    return out;
  }

  function inPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // 3×3 采样（四角 + 边中点 + 中心）判定整个外扩矩形是否落在房间内
  function rectInside(cx, cy, hw, hh, poly) {
    for (var i = -1; i <= 1; i++) {
      for (var j = -1; j <= 1; j++) {
        if (!inPoly(cx + i * hw, cy + j * hh, poly)) return false;
      }
    }
    return true;
  }

  function bbox(poly) {
    var xs = poly.map(function (p) { return p[0]; });
    var ys = poly.map(function (p) { return p[1]; });
    return [Math.min.apply(null, xs), Math.min.apply(null, ys),
            Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }

  function overlaps(cx, cy, hw, hh, placed) {
    for (var i = 0; i < placed.length; i++) {
      var p = placed[i];
      if (Math.abs(cx - p.cx) < hw + p.hw + GAP && Math.abs(cy - p.cy) < hh + p.hh + GAP) return true;
    }
    return false;
  }

  // 候选中心点：全网格但按「距房间边界由近到远」排序，
  // 于是第一个可行解就是最贴墙的位置，后续家具沿墙依次排开。
  function candidates(bb) {
    var pts = [];
    for (var x = bb[0] + PAD; x <= bb[2] - PAD; x += STEP) {
      for (var y = bb[1] + PAD; y <= bb[3] - PAD; y += STEP) {
        var d = Math.min(x - bb[0], bb[2] - x, y - bb[1], bb[3] - y);
        pts.push([x, y, d]);
      }
    }
    pts.sort(function (a, b) { return a[2] - b[2]; });
    // 极端大房间限制搜索量，避免卡顿
    return pts.length > 4000 ? pts.slice(0, 4000) : pts;
  }

  function placeOne(roomPoly, bb, placed, w, d) {
    var pts = candidates(bb);
    var best = null;
    // rot 0 与 90 各试一次；AABB 只需交换宽深。
    // hw/hh 是家具真实半宽（用于彼此间隔），外扩 PAD 后的矩形只用于判断是否贴墙。
    var rots = [[0, w / 2, d / 2], [90, d / 2, w / 2]];
    for (var r = 0; r < rots.length; r++) {
      var rot = rots[r][0], hw = rots[r][1], hh = rots[r][2];
      for (var i = 0; i < pts.length; i++) {
        var cx = pts[i][0], cy = pts[i][1], wallD = pts[i][2];
        // 按 bbox 距离排序，越靠后越不可能优于已有解
        if (best && wallD > best.wallD) break;
        if (!rectInside(cx, cy, hw + PAD, hh + PAD, roomPoly)) continue;
        if (overlaps(cx, cy, hw, hh, placed)) continue;
        var cand = { cx: cx, cy: cy, rot: rot, hw: hw, hh: hh, wallD: wallD };
        if (!best || cand.wallD < best.wallD) best = cand;
      }
    }
    return best;
  }

  function recipeFor(name) {
    var n = String(name || '');
    for (var i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i][0].test(n)) return RECIPES[i][1];
    }
    return null;
  }

  function autoFurnish(rooms, makeF, lib) {
    var out = [];
    if (!Array.isArray(rooms) || typeof makeF !== 'function') return out;
    rooms.forEach(function (room) {
      if (!room || !Array.isArray(room.poly) || room.poly.length < 3) return;
      var poly = room.poly;
      // 去掉闭合重复点，避免零长度边
      var p0 = poly[0], pn = poly[poly.length - 1];
      if (p0[0] === pn[0] && p0[1] === pn[1]) poly = poly.slice(0, -1);
      if (poly.length < 3) return;
      var recipe = recipeFor(room.name || room.id);
      if (!recipe || !recipe.length) return;
      var bb = bbox(poly);
      var placed = [];   // 房间内的占位（含外扩），跨房间不互相影响
      recipe.forEach(function (type) {
        var variants = itemsFor(lib, type);
        for (var v = 0; v < variants.length; v++) {
          var it = variants[v];
          var pos = placeOne(poly, bb, placed, it.w, it.d);
          if (!pos) continue;   // 这间房放不下 → 试小一号 / 换类型
          out.push(makeF(it.type, it.name, pos.cx, pos.cy, it.w, it.d, pos.rot, it.color));
          placed.push({ cx: pos.cx, cy: pos.cy, hw: pos.hw, hh: pos.hh });
          return;
        }
      });
    });
    return out;
  }

  autoFurnish.recipes = RECIPES;
  autoFurnish.constants = { PAD: PAD, GAP: GAP, STEP: STEP };
  return autoFurnish;
});

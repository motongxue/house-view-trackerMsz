/* ============================================================
 * HouseSpec → floorplan.html 内部格式转换器（纯函数，无 DOM 依赖）
 *
 * 输入：house-plan-designer 技能产出的 HouseSpec
 *   walls : [{ a:[x,y], b:[x,y], t, bearing, openings:[
 *              {type:'window'|'door'|'hole'|'sliding', from, to, sill} ]}]
 *   ※ from/to 是「墙所在轴」上的绝对坐标（不是距 a 的偏移量）
 *   rooms : [{name, mat, at:[x,y]}]   —— 只有中心点，没有边界多边形
 *
 * 输出：floorplan.html 直接可用的几何对象
 *   { WALLS, WINS, DOORS, SLIDES, ROOMS, bounds, origin, underlay }
 *
 * 两个关键点：
 *  1) 内部格式的墙是「有厚度的矩形」，门窗是墙上挖出来的洞（墙必须在洞口处断开）。
 *     所以这里把每面墙按洞口切成若干实心段，每段生成 [x0,y0,x1,y1,类型]。
 *  2) 房间不自带边界，用「面追踪 face tracing」从墙网推导真实房间多边形；
 *     匹配不到的房间退化成方块，保证不崩。
 * ============================================================ */
(function (root) {
  'use strict';

  // ---------- 几何基础 ----------
  const key = p => p[0] + ',' + p[1];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
  const vlen = u => Math.hypot(u[0], u[1]);
  const TOL = 1e-6;

  function onSeg(p, a, b) {
    if (Math.abs(cross(sub(b, a), sub(p, a))) > TOL * Math.max(1, vlen(sub(b, a)))) return false;
    const t = dot(sub(p, a), sub(b, a)) / (dot(sub(b, a), sub(b, a)) || 1);
    return t >= -TOL && t <= 1 + TOL;
  }
  function segInt(a, b, c, d) {
    const r = sub(b, a), s = sub(d, c);
    const den = cross(r, s);
    if (Math.abs(den) < 1e-9) return null;
    const t = cross(sub(c, a), s) / den;
    const u = cross(sub(c, a), r) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return [a[0] + t * r[0], a[1] + t * r[1]];
  }
  function ptInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      const hit = ((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }
  function polyArea(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    return a / 2;
  }
  function distToSeg(p, a, b) {
    const ab = sub(b, a), d = dot(ab, ab) || 1;
    let t = dot(sub(p, a), ab) / d; t = Math.max(0, Math.min(1, t));
    return vlen(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
  }
  function simplify(poly) {
    if (poly.length <= 3) return poly.slice();
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], prev = poly[(i - 1 + poly.length) % poly.length], next = poly[(i + 1) % poly.length];
      if (Math.abs(cross(sub(p, prev), sub(next, p))) > 1e-3) out.push(p);
    }
    return out.length >= 3 ? out : poly.slice();
  }

  // ---------- 墙网建图 + 面追踪（用于推导房间多边形） ----------
  function buildGraph(walls) {
    const segs = walls.map((w, i) => ({ a: w.a, b: w.b, wi: i }));
    const ptsBySeg = segs.map(() => new Set());
    for (let i = 0; i < segs.length; i++) { ptsBySeg[i].add(key(segs[i].a)); ptsBySeg[i].add(key(segs[i].b)); }
    for (let i = 0; i < segs.length; i++) for (let j = 0; j < segs.length; j++) {
      if (i === j) continue;
      const p = segInt(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (p && onSeg(p, segs[i].a, segs[i].b)) ptsBySeg[i].add(key(p));
    }
    const nodeIdx = new Map(), nodes = [];
    const nid = p => { const k = key(p); if (!nodeIdx.has(k)) { nodeIdx.set(k, nodes.length); nodes.push(p); } return nodeIdx.get(k); };
    const adj = new Map();
    const addEdge = (u, v) => { if (!adj.has(u)) adj.set(u, new Set()); if (!adj.has(v)) adj.set(v, new Set()); adj.get(u).add(v); adj.get(v).add(u); };
    for (let i = 0; i < segs.length; i++) {
      const list = [...ptsBySeg[i]].map(k => k.split(',').map(Number));
      const dir = sub(segs[i].b, segs[i].a);
      list.sort((p, q) => dot(sub(p, segs[i].a), dir) - dot(sub(q, segs[i].a), dir));
      for (let k = 0; k < list.length - 1; k++) { const u = nid(list[k]), v = nid(list[k + 1]); if (u !== v) addEdge(u, v); }
    }
    return { nodes, adj };
  }

  function traceFaces(nodes, adj) {
    const ang = (u, v) => Math.atan2(nodes[v][1] - nodes[u][1], nodes[v][0] - nodes[u][0]);
    const sorted = new Map();
    for (const [u, nbrs] of adj) sorted.set(u, [...nbrs].sort((a, b) => ang(u, a) - ang(u, b)));
    const used = new Set(), faces = [];
    for (const [u, nbrs] of adj) for (const v of nbrs) {
      if (used.has(u + '->' + v)) continue;
      const startU = u, startV = v, poly = [], edges = [];
      let cur = u, nxt = v, guard = 0;
      do {
        used.add(cur + '->' + nxt);
        poly.push(nodes[cur].slice()); edges.push([cur, nxt]);
        const revAng = ang(nxt, cur), arr = sorted.get(nxt);
        let best = -1, bestAng = -Infinity;
        for (const w of arr) {
          if (w === cur) continue;
          let diff = ang(nxt, w) - revAng;
          while (diff <= 0) diff += 2 * Math.PI;
          while (diff > 2 * Math.PI) diff -= 2 * Math.PI;
          if (diff > bestAng) { bestAng = diff; best = w; }
        }
        if (best < 0) break;
        cur = nxt; nxt = best;
      } while (!(cur === startU && nxt === startV) && (++guard) < 100000);
      if (poly.length >= 3) faces.push({ poly: simplify(poly), edges, signedArea: polyArea(poly) });
    }
    return faces;
  }

  // ---------- 材质映射（技能材质名 → 本页 MATS 键） ----------
  const MATMAP = {
    oak: 'wood', wood: 'wood', walnut: 'walnut', parquet: 'wood', laminate: 'wood', vinyl: 'tile600',
    tile: 'tile800', tile800: 'tile800', tile600: 'tile600', bath: 'antislip', antislip: 'antislip',
    marble: 'marble', terrazzo: 'terrazzo', carpet: 'carpet', deck: 'wood',
    concrete: 'terrazzo', stone: 'marble'
  };
  const mapMat = m => MATMAP[(m || '').toLowerCase()] || 'tile800';

  // ---------------------------------------------------------------- 主转换
  function hsToFloorplan(spec) {
    spec = spec || {};
    const walls = Array.isArray(spec.walls) ? spec.walls : [];
    const rooms = Array.isArray(spec.rooms) ? spec.rooms : [];
    const WALLS = [], WINS = [], DOORS = [], SLIDES = [];

    // 房间中心的整体重心，用于给门选一个「朝室内开」的方向（纯视觉）
    let ref = null;
    if (rooms.length) {
      let sx = 0, sy = 0, n = 0;
      rooms.forEach(r => { if (Array.isArray(r.at) && r.at.length === 2) { sx += r.at[0]; sy += r.at[1]; n++; } });
      if (n) ref = [sx / n, sy / n];
    }

    // ===== 1) 墙网 → 面 → 判定外墙 =====
    let faces = [], outerFace = null, exteriorFlags = [];
    try {
      if (walls.length) {
        const { nodes, adj } = buildGraph(walls);
        faces = traceFaces(nodes, adj);
        let maxA = -1;
        for (const f of faces) { const a = Math.abs(f.signedArea); if (a > maxA) { maxA = a; outerFace = f; } }
        const outerSegs = outerFace ? outerFace.edges.map(([u, v]) => [nodes[u], nodes[v]]) : [];
        exteriorFlags = walls.map(w => {
          const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
          for (const [p, q] of outerSegs) if (distToSeg(mid, p, q) < 5) return true;
          return false;
        });
      }
    } catch (e) { exteriorFlags = walls.map(() => false); }

    // ===== 2) 每面墙：按洞口切段 → 实心墙矩形 + 门窗洞口 =====
    walls.forEach((w, wi) => {
      const a = w.a, b = w.b;
      if (!Array.isArray(a) || !Array.isArray(b)) return;
      const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
      const axis = horizontal ? 0 : 1;              // 0=x, 1=y
      const off = (horizontal ? (a[1] + b[1]) / 2 : (a[0] + b[0]) / 2); // 墙中心线在另一轴上的坐标
      const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
      const t = (+w.t > 0 ? +w.t : 240), half = t / 2;
      const kind = exteriorFlags[wi] ? 'e' : 'b';

      // 洞口（from/to 是轴上绝对坐标），裁剪到墙体范围内并按位置排序
      const ops = (Array.isArray(w.openings) ? w.openings : [])
        .map(o => ({ o, from: Math.max(lo, Math.min(hi, +o.from || 0)), to: Math.max(lo, Math.min(hi, +o.to || 0)) }))
        .filter(x => x.to - x.from > 1)
        .sort((x, y) => x.from - y.from);

      // 洞口矩形 / 墙段矩形（统一输出 [x0,y0,x1,y1]）
      const rect = (p, q) => horizontal ? [p, off - half, q, off + half] : [off - half, p, off + half, q];

      let cursor = lo;
      for (const x of ops) {
        if (x.from - cursor > 1) WALLS.push([...rect(cursor, x.from), kind]);
        const r = rect(x.from, x.to), type = (x.o.type || 'door').toLowerCase();
        const mid = horizontal ? [(x.from + x.to) / 2, off] : [off, (x.from + x.to) / 2];
        if (type === 'window') {
          WINS.push(r);
        } else if (type === 'sliding' || type === 'slidingdoor' || type === 'slide') {
          SLIDES.push({ rect: r, v: !horizontal });
        } else {
          // 平开门 / 垭口：c = 关门方向（沿墙），o = 开门方向（垂直墙、朝室内）
          const c = horizontal ? [1, 0] : [0, 1];
          const n = horizontal ? [0, 1] : [-1, 0];
          let sgn = 1;
          if (ref && dot(n, [ref[0] - mid[0], ref[1] - mid[1]]) < 0) sgn = -1;
          const o = [n[0] * sgn, n[1] * sgn];
          DOORS.push({
            name: type === 'hole' ? '垭口' : '门',
            rect: r,
            h: horizontal ? [x.from, off] : [off, x.from],
            c: c, o: o, len: x.to - x.from,
            hole: type === 'hole'
          });
        }
        cursor = Math.max(cursor, x.to);
      }
      if (hi - cursor > 1) WALLS.push([...rect(cursor, hi), kind]);
    });

    // ===== 3) 房间 → 真实多边形 =====
    const ROOMS = [], interiorFaces = faces.filter(f => f !== outerFace);
    rooms.forEach((r, i) => {
      const at = Array.isArray(r.at) && r.at.length === 2 ? r.at : null;
      let poly = null;
      if (at) {
        const cand = interiorFaces.filter(f => ptInPoly(at, f.poly))
          .sort((x, y) => Math.abs(x.signedArea) - Math.abs(y.signedArea));
        if (cand.length) poly = cand[0].poly;
      }
      if (!poly) { // 兜底：以 at 为中心的方块
        const c = at || [i * 3500 + 1000, 1000], s = 3000;
        poly = [[c[0] - s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] - s / 2],
                [c[0] + s / 2, c[1] + s / 2], [c[0] - s / 2, c[1] + s / 2]];
      }
      ROOMS.push({ id: 'r' + i, name: r.name || ('房间' + (i + 1)), poly, mat: mapMat(r.mat), at: at || poly[0] });
    });

    // ===== 4) 包围盒 / 原点 =====
    let minX = 1e15, minY = 1e15, maxX = -1e15, maxY = -1e15, has = false;
    const eat = (x, y) => { has = true; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const w of WALLS) { eat(w[0], w[1]); eat(w[2], w[3]); }
    if (!has) for (const r of ROOMS) for (const p of r.poly) eat(p[0], p[1]);
    if (!has) { minX = 0; minY = 0; maxX = 10000; maxY = 10000; }
    const pad = 900;
    const bounds = { x: Math.floor(minX - pad), y: Math.floor(minY - pad), w: Math.ceil(maxX - minX + 2 * pad), h: Math.ceil(maxY - minY + 2 * pad) };
    const origin = [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)];
    const underlay = (spec.underlay && typeof spec.underlay === 'object') ? spec.underlay : null;

    return { WALLS, WINS, DOORS, SLIDES, ROOMS, bounds, origin, underlay };
  }

  const api = { hsToFloorplan, buildGraph, traceFaces, mapMat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.hsToFloorplan = api.hsToFloorplan;
})(typeof window !== 'undefined' ? window : globalThis);

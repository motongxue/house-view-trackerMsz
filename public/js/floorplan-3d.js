/* ============================================================
 * 装修设计 · 3D 户型引擎（本项目自研实现，v1 一期）
 *
 * 设计原则：
 *  - 只参考同类工具的「功能效果」，代码与数据结构全部独立设计，
 *    未移植任何第三方项目的源码、常量或户型数据。
 *  - 唯一外部依赖是本地化的 three@0.160.0 ES module（MIT，见 ./three/LICENSE），
 *    不使用任何 addons、CDN、importmap、构建步骤，断网可完整运行。
 *  - 户型几何由外部注入（setPlan），二期换成用户自录户型时渲染层无需重写。
 *  - UI 颜色一律取系统 design tokens；3D 材质色属于内容表现，走中性色板。
 *
 * 对外门面：window.Floorplan3D = { version, samplePlan, normalizePlan, init }
 * ============================================================ */
import * as THREE from './three/three.module.js';

const VERSION = '1.0.0';
const WALL_H = 2.9;
const DOOR_H = 2.1;
const WIN_SILL = 0.9;
const WIN_H = 1.4;

/* 地板材料：price 为每平米参考单价（元），仅用于面积造价估算 */
const MATERIALS = {
  tile:       { name: '瓷砖',     price: 180, color: 0xe9e7e2 },
  wood:       { name: '实木地板', price: 320, color: 0xc9a678 },
  laminate:   { name: '强化地板', price: 140, color: 0xd8c1a0 },
  stone:      { name: '石材',     price: 420, color: 0xd6d3cd },
  waterproof: { name: '防滑砖',   price: 160, color: 0xcfd8d5 }
};

/* 家具库：w/d/h 为默认外形尺寸（米），改尺寸时整体等比缩放，不重建几何 */
const CATALOG = [
  { kind: 'sofa',     name: '沙发',     w: 2.00, d: 0.86, h: 0.78, color: 0x8ea6be },
  { kind: 'tv',       name: '电视柜',   w: 1.60, d: 0.40, h: 0.50, color: 0x6f6257 },
  { kind: 'ctable',   name: '茶几',     w: 1.10, d: 0.60, h: 0.42, color: 0xb99a76 },
  { kind: 'dtable',   name: '餐桌',     w: 1.40, d: 0.80, h: 0.75, color: 0xb08e68 },
  { kind: 'chair',    name: '餐椅',     w: 0.44, d: 0.44, h: 0.86, color: 0x9a8570 },
  { kind: 'bed',      name: '双人床',   w: 1.80, d: 2.00, h: 0.52, color: 0xb9a68c },
  { kind: 'wardrobe', name: '衣柜',     w: 1.60, d: 0.58, h: 2.20, color: 0xa9947c },
  { kind: 'desk',     name: '书桌',     w: 1.20, d: 0.60, h: 0.75, color: 0xb08e68 },
  { kind: 'cabinet',  name: '橱柜',     w: 1.80, d: 0.60, h: 0.88, color: 0x9fb0a8 },
  { kind: 'fridge',   name: '冰箱',     w: 0.62, d: 0.62, h: 1.80, color: 0xd0d6d8 },
  { kind: 'bathtub',  name: '浴缸',     w: 1.50, d: 0.72, h: 0.55, color: 0xe4e9e9 },
  { kind: 'plant',    name: '绿植',     w: 0.46, d: 0.46, h: 1.10, color: 0x4f8f68 }
];
const CAT_BY_KIND = Object.fromEntries(CATALOG.map((x) => [x.kind, x]));

/* ---------------- 示例户型（自行设计，非任何第三方数据） ----------------
 * 坐标系：米，原点为户型左上角，x 向右、z 向下；渲染时整体平移到世界原点。
 * 两室一厅一厨一卫，外轮廓 10.0 × 8.0。
 */
function samplePlan() {
  return {
    version: 1,
    name: '示例户型 · 两室两厅一厨一卫',
    bounds: { w: 10, d: 8 },
    materials: clone(MATERIALS),
    rooms: [
      { id: 'r_living', name: '客厅',   x: 0,   z: 0,   w: 5.0, d: 4.6, material: 'wood' },
      { id: 'r_dining', name: '餐厅',   x: 5.0, z: 0,   w: 2.6, d: 4.6, material: 'wood' },
      { id: 'r_kitchen',name: '厨房',   x: 7.6, z: 0,   w: 2.4, d: 4.6, material: 'tile' },
      { id: 'r_master', name: '主卧',   x: 0,   z: 4.6, w: 4.4, d: 3.4, material: 'laminate' },
      { id: 'r_second', name: '次卧',   x: 4.4, z: 4.6, w: 3.2, d: 3.4, material: 'laminate' },
      { id: 'r_bath',   name: '卫生间', x: 7.6, z: 4.6, w: 2.4, d: 3.4, material: 'waterproof' }
    ],
    walls: [
      { id: 'w_n', a: [0, 0],  b: [10, 0], t: 0.24, bearing: true,
        openings: [{ type: 'window', at: 1.3, w: 2.2 }, { type: 'window', at: 8.3, w: 1.0 }] },
      { id: 'w_e', a: [10, 0], b: [10, 8], t: 0.24, bearing: true,
        openings: [{ type: 'window', at: 6.1, w: 1.0 }] },
      { id: 'w_s', a: [0, 8],  b: [10, 8], t: 0.24, bearing: true,
        openings: [{ type: 'window', at: 1.2, w: 1.8 }, { type: 'window', at: 5.3, w: 1.2 },
                   { type: 'door', at: 3.1, w: 0.95 }] },
      { id: 'w_w', a: [0, 0],  b: [0, 8],  t: 0.24, bearing: true,
        openings: [{ type: 'window', at: 2.0, w: 1.6 }] },
      { id: 'w_l_d', a: [5.0, 0], b: [5.0, 4.6], t: 0.12, bearing: false,
        openings: [{ type: 'door', at: 3.3, w: 0.9 }] },
      { id: 'w_d_k', a: [7.6, 0], b: [7.6, 4.6], t: 0.12, bearing: false,
        openings: [{ type: 'door', at: 3.2, w: 0.8 }] },
      { id: 'w_mid', a: [0, 4.6], b: [10, 4.6], t: 0.12, bearing: false,
        openings: [{ type: 'door', at: 1.5, w: 0.9 }, { type: 'door', at: 5.4, w: 0.9 },
                   { type: 'door', at: 8.5, w: 0.8 }] },
      { id: 'w_m_s', a: [4.4, 4.6], b: [4.4, 8], t: 0.20, bearing: true, openings: [] },
      { id: 'w_s_b', a: [7.6, 4.6], b: [7.6, 8], t: 0.12, bearing: false, openings: [] }
    ],
    removedWalls: [],
    furniture: [
      { id: 'f1',  kind: 'sofa',     x: 1.45, z: 2.55, rot: 0 },
      { id: 'f2',  kind: 'ctable',   x: 2.60, z: 1.45, rot: 0 },
      { id: 'f3',  kind: 'tv',       x: 2.60, z: 0.42, rot: 0 },
      { id: 'f4',  kind: 'plant',    x: 4.35, z: 3.85, rot: 0 },
      { id: 'f5',  kind: 'dtable',   x: 6.30, z: 1.75, rot: 0 },
      { id: 'f6',  kind: 'chair',    x: 5.55, z: 1.75, rot: 0 },
      { id: 'f7',  kind: 'chair',    x: 7.05, z: 1.75, rot: 0 },
      { id: 'f8',  kind: 'cabinet',  x: 8.80, z: 0.45, rot: 0 },
      { id: 'f9',  kind: 'fridge',   x: 9.25, z: 3.75, rot: 0 },
      { id: 'f10', kind: 'bed',      x: 2.20, z: 6.35, rot: 0 },
      { id: 'f11', kind: 'wardrobe', x: 0.45, z: 5.10, rot: 0 },
      { id: 'f12', kind: 'bed',      x: 6.00, z: 6.35, rot: 0 },
      { id: 'f13', kind: 'desk',     x: 5.20, z: 7.45, rot: 0 },
      { id: 'f14', kind: 'bathtub',  x: 8.80, z: 7.10, rot: 0 }
    ]
  };
}

/* ---------------- 通用工具 ---------------- */
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9); }
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    // 自定义属性若仍带 var() / 非颜色字面量，Three.Color 会解析失败，统一回退
    return (v && v.indexOf('var(') === -1) ? v : fallback;
  } catch (e) { return fallback; }
}
function areaOf(r) { return Math.max(0, num(r.w, 0)) * Math.max(0, num(r.d, 0)); }
function wallLen(w) { return Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); }
function matOf(plan, key) { return (plan.materials && plan.materials[key]) || MATERIALS[key] || MATERIALS.tile; }

/* 外部数据兼容处理：缺字段补默认，防止二期自录户型把渲染层打崩 */
function normalizePlan(input) {
  const base = samplePlan();
  if (!input || typeof input !== 'object') return base;
  const p = Object.assign(base, clone(input));
  p.bounds = Object.assign({ w: 10, d: 8 }, input.bounds || {});
  // F167: 合并不可信 materials 时过滤 __proto__/constructor/prototype，避免原型污染；
  // 目标用 Object.create(null) 彻底隔离原型链（materials 仅作键值表用）。
  const safeMaterials = Object.create(null);
  Object.assign(safeMaterials, clone(MATERIALS));
  const inMat = input.materials || {};
  Object.keys(inMat).forEach((k) => {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    safeMaterials[k] = inMat[k];
  });
  p.materials = safeMaterials;
  p.rooms = Array.isArray(input.rooms) ? input.rooms.map((r) => Object.assign(
    { id: uid('r'), name: '房间', x: 0, z: 0, w: 3, d: 3, material: 'tile' }, r)) : base.rooms;
  p.walls = Array.isArray(input.walls) ? input.walls.map((w) => Object.assign(
    { id: uid('w'), a: [0, 0], b: [0, 3], t: 0.12, bearing: false, openings: [] }, w,
    { openings: Array.isArray(w.openings) ? w.openings : [] })) : base.walls;
  p.removedWalls = Array.isArray(input.removedWalls) ? input.removedWalls.slice() : [];
  p.furniture = Array.isArray(input.furniture) ? input.furniture.map((f) => {
    const def = CAT_BY_KIND[f.kind] || CATALOG[0];
    return Object.assign({ id: uid('f'), kind: def.kind, x: 0, z: 0, rot: 0,
      w: def.w, d: def.d, h: def.h }, f);
  }) : base.furniture;
  return p;
}

/* ---------------- 家具几何（自研组合，按 kind 用基础体块搭） ---------------- */
function addBox(g, w, h, d, x, y, z, color, opts) {
  const o = opts || {};
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: color,
      roughness: o.roughness == null ? 0.82 : o.roughness,
      metalness: o.metalness == null ? 0.02 : o.metalness,
      transparent: !!o.opacity, opacity: o.opacity == null ? 1 : o.opacity
    })
  );
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
function buildFurniture(item) {
  const def = CAT_BY_KIND[item.kind] || CATALOG[0];
  const g = new THREE.Group();
  const c = def.color;
  const W = def.w, D = def.d, H = def.h;
  switch (item.kind) {
    case 'sofa':
      addBox(g, W, H * 0.42, D, 0, H * 0.21, 0, c);
      addBox(g, W, H * 0.62, D * 0.20, 0, H * 0.69, -D * 0.40, c);
      addBox(g, W * 0.10, H * 0.52, D, -W * 0.45, H * 0.42, 0, c);
      addBox(g, W * 0.10, H * 0.52, D,  W * 0.45, H * 0.42, 0, c);
      break;
    case 'bed':
      addBox(g, W, H * 0.55, D, 0, H * 0.28, 0, 0x8d7b66);
      addBox(g, W * 0.94, H * 0.40, D * 0.94, 0, H * 0.72, D * 0.02, c);
      addBox(g, W, H * 1.5, D * 0.08, 0, H * 0.75, -D * 0.46, 0x7d6b58);
      addBox(g, W * 0.34, 0.10, D * 0.18, -W * 0.22, H * 0.98, -D * 0.30, 0xf2efe8);
      addBox(g, W * 0.34, 0.10, D * 0.18,  W * 0.22, H * 0.98, -D * 0.30, 0xf2efe8);
      break;
    case 'ctable': case 'dtable': case 'desk': {
      addBox(g, W, H * 0.10, D, 0, H * 0.92, 0, c);
      const lx = W * 0.42, lz = D * 0.38;
      [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].forEach(([x, z]) =>
        addBox(g, W * 0.07, H * 0.86, D * 0.07, x, H * 0.44, z, 0x8a745d));
      break;
    }
    case 'chair':
      addBox(g, W, H * 0.10, D, 0, H * 0.48, 0, c);
      addBox(g, W, H * 0.52, D * 0.10, 0, H * 0.74, -D * 0.45, c);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) =>
        addBox(g, W * 0.09, H * 0.46, D * 0.09, a * W * 0.40, H * 0.23, b * D * 0.40, 0x8a745d));
      break;
    case 'wardrobe': case 'cabinet': case 'tv': case 'fridge': {
      addBox(g, W, H, D, 0, H / 2, 0, c);
      const seam = item.kind === 'fridge' ? H * 0.62 : H * 0.5;
      addBox(g, W * 0.985, 0.012, D * 0.02, 0, seam, D * 0.505, 0x6b6b6b, { roughness: 0.5 });
      addBox(g, W * 0.02, 0.012, D * 0.02, 0, H * 0.72, D * 0.51, 0x6b6b6b, { roughness: 0.35, metalness: 0.4 });
      if (item.kind === 'tv') addBox(g, W * 0.62, 0.03, D * 0.30, 0, H + 0.02, 0, 0x30363a);
      break;
    }
    case 'bathtub':
      addBox(g, W, H, D, 0, H / 2, 0, c);
      addBox(g, W * 0.86, H * 0.12, D * 0.70, 0, H * 0.96, 0, 0xb9c9cb, { opacity: 0.72 });
      break;
    case 'plant':
      addBox(g, W * 0.62, H * 0.26, D * 0.62, 0, H * 0.13, 0, 0x9a7b60);
      addBox(g, W * 0.16, H * 0.42, D * 0.16, 0, H * 0.47, 0, 0x6f8a5c);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(W * 0.42, 12, 8),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
      leaf.position.set(0, H * 0.79, 0); leaf.scale.y = 0.78; g.add(leaf);
      break;
    default:
      addBox(g, W, H, D, 0, H / 2, 0, c);
  }
  g.userData.furnId = item.id;
  g.scale.set(num(item.w, def.w) / def.w, num(item.h, def.h) / def.h, num(item.d, def.d) / def.d);
  return g;
}

/* ---------------- 实例 ---------------- */
function createInstance(host, opts) {
  const O = opts || {};
  const notify = typeof O.toast === 'function' ? O.toast : function (m) { /* 无系统 toast 时静默 */ };
  const changed = typeof O.onChange === 'function' ? O.onChange : function () {};

  let plan = normalizePlan(O.plan || samplePlan());
  let selected = null;          // { type:'wall'|'furniture', id }
  let mode = 'orbit';           // orbit | place
  let placeKind = null;
  let destroyed = false;
  let webglOK = true;
  let dirty = true;
  let raf = 0;
  let ro = null;

  /* ---------- DOM 骨架 ---------- */
  host.innerHTML = `
    <div class="fp-root">
      <div class="fp-stage">
        <div class="fp-canvas-host"></div>
        <div class="fp-labels"></div>
        <div class="fp-toolbar">
          <button class="btn sm" data-fp-view="angle" type="button">斜视</button>
          <button class="btn sm" data-fp-view="top" type="button">俯视</button>
          <button class="btn sm" data-fp-view="reset" type="button">复位</button>
          <span class="fp-toolbar-sep"></span>
          <button class="btn sm" data-fp-action="png" type="button">导出图片</button>
        </div>
        <div class="fp-hint">左键拖拽旋转 · 右键拖拽平移 · 滚轮缩放 · 点墙体可拆除/恢复 · 点家具可编辑</div>
        <div class="fp-webgl-fail hidden">当前浏览器未启用 WebGL，无法渲染 3D 视图。右侧的房间、材料与造价信息仍可查看和编辑。</div>
      </div>
      <aside class="fp-panel">
        <section class="fp-sec">
          <h4>户型概览</h4>
          <div class="fp-summary" id="fp-summary"></div>
        </section>
        <section class="fp-sec">
          <h4>家具库 <small>点选后到画面中点击摆放</small></h4>
          <div class="fp-catalog" id="fp-catalog"></div>
        </section>
        <section class="fp-sec">
          <h4>选中对象</h4>
          <div class="fp-selection" id="fp-selection"><div class="fp-empty">未选中任何对象</div></div>
        </section>
        <section class="fp-sec">
          <h4>房间与地面材料</h4>
          <div class="fp-rooms" id="fp-rooms"></div>
        </section>
        <section class="fp-sec">
          <h4>墙体状态 <small>承重墙不可拆除</small></h4>
          <div class="fp-walls" id="fp-walls"></div>
        </section>
      </aside>
    </div>`;

  const root = host.querySelector('.fp-root');
  const stage = host.querySelector('.fp-stage');
  const canvasHost = host.querySelector('.fp-canvas-host');
  const labelHost = host.querySelector('.fp-labels');
  const $ = (id) => host.querySelector('#' + id);

  /* ---------- Three 场景 ---------- */
  let renderer = null, scene = null, camera = null;
  const wallGroup = new THREE.Group();
  const floorGroup = new THREE.Group();
  const furnGroup = new THREE.Group();
  const markerGroup = new THREE.Group();
  let preview = null, boxHelper = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const cam = { theta: 0.68, phi: 0.72, r: 17.5, target: new THREE.Vector3(0, 0, 0) };

  function offX() { return num(plan.bounds.w, 10) / 2; }
  function offZ() { return num(plan.bounds.d, 8) / 2; }
  function wx(x) { return num(x, 0) - offX(); }
  function wz(z) { return num(z, 0) - offZ(); }
  function px(X) { return X + offX(); }
  function pz(Z) { return Z + offZ(); }

  function invalidate() { dirty = true; }
  // 闭包内统一取快照；实例方法 getPlan() 也复用它，避免内部调用找不到函数
  function currentPlan() { return clone(plan); }

  function applyCamera() {
    if (!camera) return;
    const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    camera.position.set(
      cam.target.x + cam.r * sp * Math.sin(cam.theta),
      cam.target.y + cam.r * cp,
      cam.target.z + cam.r * sp * Math.cos(cam.theta)
    );
    camera.lookAt(cam.target);
    camera.updateMatrixWorld();
    invalidate();
  }

  function setCameraPreset(kind) {
    if (kind === 'top') { cam.phi = 0.10; cam.theta = 0; }
    else if (kind === 'angle') { cam.phi = 0.72; cam.theta = 0.68; }
    else { cam.phi = 0.72; cam.theta = 0.68; cam.r = 17.5; cam.target.set(0, 0, 0); }
    applyCamera();
  }

  function initGL() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    canvasHost.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(cssVar('--bg', '#f0f1f4'));
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b2a6, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(8, 16, 10); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-10, 9, -8); scene.add(fill);

    scene.add(floorGroup, wallGroup, furnGroup, markerGroup);

    const grid = new THREE.GridHelper(24, 24,
      new THREE.Color(cssVar('--border-strong', '#e6e6e6')),
      new THREE.Color(cssVar('--border', '#efefef')));
    grid.position.y = -0.045;
    grid.material.transparent = true; grid.material.opacity = 0.65;
    scene.add(grid);

    preview = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(cssVar('--primary', '#5d9cec')),
        transparent: true, opacity: 0.45, depthWrite: false })
    );
    preview.visible = false;
    scene.add(preview);

    applyCamera();
    ro = new ResizeObserver(onResize);
    ro.observe(stage);
    onResize();
  }

  function onResize() {
    if (!renderer || !camera || destroyed) return;
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }

  /* ---------- 几何重建 ---------- */
  function clearGroup(g) {
    // F053: 用 g.remove(c) 而非直接 pop children，清除 THREE 内部的 parent 反向引用
    while (g.children.length) {
      const c = g.children[g.children.length - 1];
      g.remove(c);
      c.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((m) => m.dispose());
        }
      });
    }
  }

  function addWallSegment(w, from, to, y0, y1, color, wallId, opacity) {
    if (to - from < 0.005 || y1 - y0 < 0.005) return;
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1];
    const L = Math.hypot(dx, dz) || 1;
    const segLen = to - from;
    const mid = (from + to) / 2;
    const cx = w.a[0] + (dx / L) * mid;
    const cz = w.a[1] + (dz / L) * mid;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(segLen, y1 - y0, num(w.t, 0.12)),
      new THREE.MeshStandardMaterial({
        color: color, roughness: 0.95,
        transparent: opacity != null && opacity < 1,
        opacity: opacity == null ? 1 : opacity
      })
    );
    mesh.position.set(wx(cx), (y0 + y1) / 2, wz(cz));
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.userData.wallId = wallId;
    wallGroup.add(mesh);
  }

  function buildWalls() {
    clearGroup(wallGroup);
    clearGroup(markerGroup);
    const wallColor = new THREE.Color(cssVar('--panel', '#ffffff'));
    const bearingColor = new THREE.Color(cssVar('--text-3', '#999999')).lerp(wallColor, 0.55);
    const glassColor = new THREE.Color(cssVar('--aux-cyan-08', '#97FCF9'));
    const goneColor = new THREE.Color(cssVar('--aux-orange-06', '#FFB652'));

    plan.walls.forEach((w) => {
      const removed = plan.removedWalls.indexOf(w.id) !== -1;
      if (removed) {
        const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1];
        const L = Math.hypot(dx, dz) || 1;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(L, 0.022, num(w.t, 0.12) * 1.6),
          new THREE.MeshBasicMaterial({ color: goneColor, transparent: true, opacity: 0.55 })
        );
        m.position.set(wx((w.a[0] + w.b[0]) / 2), 0.012, wz((w.a[1] + w.b[1]) / 2));
        m.rotation.y = -Math.atan2(dz, dx);
        m.userData.wallId = w.id;
        markerGroup.add(m);
        return;
      }
      const col = w.bearing ? bearingColor : wallColor;
      const L = wallLen(w);
      const ops = (w.openings || []).slice().sort((a, b) => num(a.at, 0) - num(b.at, 0));
      let cursor = 0;
      ops.forEach((op) => {
        const s = clamp(num(op.at, 0), 0, L);
        const e = clamp(s + Math.max(0.1, num(op.w, 0.8)), s, L);
        addWallSegment(w, cursor, s, 0, WALL_H, col, w.id);
        if (op.type === 'door') {
          addWallSegment(w, s, e, DOOR_H, WALL_H, col, w.id);
        } else if (op.type === 'window') {
          addWallSegment(w, s, e, 0, WIN_SILL, col, w.id);
          addWallSegment(w, s, e, WIN_SILL + WIN_H, WALL_H, col, w.id);
          addWallSegment(w, s, e, WIN_SILL, WIN_SILL + WIN_H, glassColor, w.id, 0.32);
        } else {
          addWallSegment(w, s, e, 0, WALL_H, col, w.id);
        }
        cursor = e;
      });
      addWallSegment(w, cursor, L, 0, WALL_H, col, w.id);
    });
  }

  function buildFloors() {
    clearGroup(floorGroup);
    plan.rooms.forEach((r) => {
      const m = matOf(plan, r.material);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(num(r.w, 1), 0.05, num(r.d, 1)),
        new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.9 })
      );
      mesh.position.set(wx(num(r.x, 0) + num(r.w, 1) / 2), -0.025,
        wz(num(r.z, 0) + num(r.d, 1) / 2));
      mesh.userData.roomId = r.id;
      floorGroup.add(mesh);
    });
  }

  // 注意：不要与顶层的单件构造函数 buildFurniture(item) 同名，
  // 否则内部声明会遮蔽外层并造成自递归（渲染面板会整个消失）。
  function rebuildFurniture() {
    clearGroup(furnGroup);
    plan.furniture.forEach((f) => {
      const g = buildFurniture(f);
      g.position.set(wx(f.x), 0.026, wz(f.z));
      g.rotation.y = num(f.rot, 0) * Math.PI / 180;
      furnGroup.add(g);
    });
  }

  function rebuildAll() {
    if (!webglOK) return;
    buildFloors(); buildWalls(); rebuildFurniture();
    refreshSelectionHelper();
    invalidate();
  }

  function refreshSelectionHelper() {
    if (boxHelper) { scene.remove(boxHelper); boxHelper.geometry.dispose(); boxHelper = null; }
    if (webglOK && selected && selected.type === 'furniture') {
      const g = furnGroup.children.find((x) => x.userData.furnId === selected.id);
      if (g) {
        boxHelper = new THREE.BoxHelper(g, new THREE.Color(cssVar('--primary', '#5d9cec')));
        scene.add(boxHelper);
      }
    }
    invalidate();
  }

  function updateLabels() {
    if (!webglOK || !camera) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    labelHost.innerHTML = plan.rooms.map((r) => {
      const v = new THREE.Vector3(wx(num(r.x, 0) + num(r.w, 1) / 2), 0.08,
        wz(num(r.z, 0) + num(r.d, 1) / 2)).project(camera);
      if (v.z > 1) return '';
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      return `<span class="fp-label" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${esc(r.name)}<i>${areaOf(r).toFixed(1)}㎡</i></span>`;
    }).join('');
  }

  function loop() {
    if (destroyed) return;
    if (dirty && webglOK && renderer) {
      renderer.render(scene, camera);
      if (boxHelper) boxHelper.update();
      updateLabels();
      dirty = false;
    }
    raf = requestAnimationFrame(loop);
  }

  /* ---------- 面板渲染 ---------- */
  function totalArea() { return plan.rooms.reduce((s, r) => s + areaOf(r), 0); }
  function totalCost() {
    return plan.rooms.reduce((s, r) => s + areaOf(r) * num(matOf(plan, r.material).price, 0), 0);
  }
  function fmtMoney(n) { return Math.round(n).toLocaleString('zh-CN'); }

  function renderSummary() {
    $('fp-summary').innerHTML = `
      <div class="fp-stat"><b>${plan.rooms.length}</b><span>房间</span></div>
      <div class="fp-stat"><b>${totalArea().toFixed(1)}</b><span>面积 ㎡</span></div>
      <div class="fp-stat"><b>${plan.furniture.length}</b><span>家具</span></div>
      <div class="fp-stat"><b>${plan.removedWalls.length}</b><span>已拆墙</span></div>
      <div class="fp-cost">地面材料参考造价 <b>¥ ${fmtMoney(totalCost())}</b></div>`;
  }

  function renderCatalog() {
    $('fp-catalog').innerHTML = CATALOG.map((c) =>
      `<button class="fp-chip${placeKind === c.kind ? ' active' : ''}" data-fp-kind="${c.kind}" type="button">${esc(c.name)}</button>`
    ).join('');
  }

  function renderSelection() {
    const box = $('fp-selection');
    if (!selected) { box.innerHTML = '<div class="fp-empty">未选中任何对象</div>'; return; }
    if (selected.type === 'wall') {
      const w = plan.walls.find((x) => x.id === selected.id);
      if (!w) { selected = null; box.innerHTML = '<div class="fp-empty">未选中任何对象</div>'; return; }
      const removed = plan.removedWalls.indexOf(w.id) !== -1;
      box.innerHTML = `<div class="fp-sel-head">墙体 <b>${esc(w.id)}</b> <span class="fp-tag${w.bearing ? ' lock' : ''}">${w.bearing ? '承重墙' : '非承重墙'}</span></div>
        <div class="fp-sel-line">长度 ${wallLen(w).toFixed(2)} m · 厚度 ${num(w.t, 0.12)} m${w.bearing ? ' · 不可拆除' : ''}</div>
        <div class="fp-sel-actions">
          ${w.bearing ? '<span class="fp-empty">承重墙不可拆除</span>' :
            `<button class="btn sm${removed ? '' : ' danger'}" data-fp-toggle-wall="${esc(w.id)}" type="button">${removed ? '恢复此墙' : '拆除此墙'}</button>`}
          <button class="btn sm ghost" data-fp-clear-sel type="button">取消选择</button>
        </div>`;
      return;
    }
    const f = plan.furniture.find((x) => x.id === selected.id);
    if (!f) { selected = null; box.innerHTML = '<div class="fp-empty">未选中任何对象</div>'; return; }
    const def = CAT_BY_KIND[f.kind] || CATALOG[0];
    box.innerHTML = `<div class="fp-sel-head">家具 <b>${esc(def.name)}</b></div>
      <div class="fp-sel-grid">
        <label>宽 <input type="number" step="0.1" min="0.2" max="6" value="${num(f.w, def.w).toFixed(2)}" data-fp-f="w"></label>
        <label>深 <input type="number" step="0.1" min="0.2" max="6" value="${num(f.d, def.d).toFixed(2)}" data-fp-f="d"></label>
        <label>高 <input type="number" step="0.1" min="0.2" max="4" value="${num(f.h, def.h).toFixed(2)}" data-fp-f="h"></label>
      </div>
      <div class="fp-sel-actions">
        <button class="btn sm" data-fp-rotate="-90" type="button">↺ 左转</button>
        <button class="btn sm" data-fp-rotate="90" type="button">↻ 右转</button>
        <button class="btn sm danger" data-fp-del-furn type="button">删除</button>
        <button class="btn sm ghost" data-fp-clear-sel type="button">取消</button>
      </div>`;
  }

  function renderRooms() {
    // F056: 按 key 显式写 selected，不再用字符串 replace（对含转义字符的 key 或缺失材质会选错/全不选）
    const matKeys = Object.keys(plan.materials);
    $('fp-rooms').innerHTML = plan.rooms.map((r) => {
      const m = matOf(plan, r.material);
      const optsHtml = matKeys.map((k) =>
        `<option value="${esc(k)}"${k === r.material ? ' selected' : ''}>${esc(matOf(plan, k).name)} · ¥${num(matOf(plan, k).price, 0)}/㎡</option>`).join('');
      return `<div class="fp-room-row" data-fp-room="${esc(r.id)}">
        <input class="fp-room-name" data-fp-room-name="${esc(r.id)}" value="${esc(r.name)}" aria-label="房间名">
        <span class="fp-room-area">${areaOf(r).toFixed(1)}㎡</span>
        <select class="fp-room-mat" data-fp-room-mat="${esc(r.id)}" aria-label="地面材料">
          ${optsHtml}
        </select>
        <span class="fp-room-cost">¥${fmtMoney(areaOf(r) * num(m.price, 0))}</span>
      </div>`;
    }).join('') + `<div class="fp-total">合计 <b>¥ ${fmtMoney(totalCost())}</b></div>`;
  }

  function renderWalls() {
    const inner = plan.walls.filter((w) => !w.bearing);
    $('fp-walls').innerHTML = inner.length ? inner.map((w) => {
      const removed = plan.removedWalls.indexOf(w.id) !== -1;
      return `<button class="fp-wall-row${removed ? ' removed' : ''}${selected && selected.type === 'wall' && selected.id === w.id ? ' active' : ''}"
        data-fp-wall="${esc(w.id)}" type="button">
        <span>${esc(w.id)}</span><span>${wallLen(w).toFixed(1)}m</span><em>${removed ? '已拆除 · 点击恢复' : '点击拆除'}</em>
      </button>`;
    }).join('') : '<div class="fp-empty">当前户型没有非承重墙</div>';
  }

  function renderPanels() {
    renderSummary(); renderCatalog(); renderSelection(); renderRooms(); renderWalls();
  }

  /* ---------- 数据变更 ---------- */
  function commit(rebuild) {
    if (rebuild) rebuildAll();
    renderPanels();
    changed(currentPlan());
    invalidate();
  }

  function toggleWall(id) {
    const w = plan.walls.find((x) => x.id === id);
    if (!w) return;
    if (w.bearing) { notify('承重墙不能拆除'); return; }
    const i = plan.removedWalls.indexOf(id);
    if (i >= 0) { plan.removedWalls.splice(i, 1); notify('已恢复墙体'); }
    else { plan.removedWalls.push(id); notify('已标记拆除（可在列表中恢复）'); }
    commit(true);
  }

  function addFurniture(kind, x, z) {
    const def = CAT_BY_KIND[kind];
    if (!def) return;
    const item = { id: uid('f'), kind: kind, x: clamp(x, 0.2, plan.bounds.w - 0.2),
      z: clamp(z, 0.2, plan.bounds.d - 0.2), rot: 0, w: def.w, d: def.d, h: def.h };
    plan.furniture.push(item);
    selected = { type: 'furniture', id: item.id };
    mode = 'orbit'; placeKind = null;
    if (preview) preview.visible = false;
    stage.classList.remove('fp-placing');
    notify('已摆放「' + def.name + '」，可继续拖动调整位置');
    commit(true);
  }

  /* ---------- 交互 ---------- */
  function setPointer(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  function groundAt(e) {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(groundPlane, hitPoint) ? hitPoint.clone() : null;
  }
  function pick(e) {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(furnGroup.children.concat(wallGroup.children, markerGroup.children), true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.furnId) return { type: 'furniture', id: o.userData.furnId, object: o };
        if (o.userData && o.userData.wallId) return { type: 'wall', id: o.userData.wallId, object: o };
        o = o.parent;
      }
    }
    return null;
  }

  let drag = null;
  function onPointerDown(e) {
    if (!webglOK || e.button === 1) return;
    if (e.button === 2) {
      drag = { type: 'pan', x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
      e.preventDefault(); return;
    }
    if (e.button !== 0) return;
    if (mode === 'place') {
      const p = groundAt(e);
      if (p) addFurniture(placeKind, px(p.x), pz(p.z));
      return;
    }
    const hit = pick(e);
    if (hit && hit.type === 'furniture') {
      selected = { type: 'furniture', id: hit.id };
      // F180: 记录 pointerId，多指场景下只响应发起拖拽的那根指针
      drag = { type: 'move', id: hit.id, moved: false, pointerId: e.pointerId };
      if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
      renderPanels(); refreshSelectionHelper();
      return;
    }
    if (hit && hit.type === 'wall') {
      selected = { type: 'wall', id: hit.id };
      renderPanels(); refreshSelectionHelper();
      return;
    }
    drag = { type: 'orbit', x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  }
  function onPointerMove(e) {
    if (!webglOK) return;
    // F180: 忽略非发起指针的 move，避免多指/丢失 capture 后家具持续跟随
    if (drag && drag.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
    if (mode === 'place' && preview) {
      const p = groundAt(e);
      if (p) {
        const def = CAT_BY_KIND[placeKind];
        preview.visible = true;
        preview.scale.set(def.w, def.h, def.d);
        preview.position.set(p.x, def.h / 2 + 0.03, p.z);
        invalidate();
      }
      return;
    }
    if (!drag) return;
    if (drag.type === 'orbit') {
      cam.theta -= (e.clientX - drag.x) * 0.006;
      cam.phi = clamp(cam.phi - (e.clientY - drag.y) * 0.005, 0.08, 1.45);
      drag.x = e.clientX; drag.y = e.clientY;
      applyCamera();
    } else if (drag.type === 'pan') {
      const k = cam.r * 0.0016;
      cam.target.x -= (e.clientX - drag.x) * k;
      cam.target.z -= (e.clientY - drag.y) * k;
      drag.x = e.clientX; drag.y = e.clientY;
      applyCamera();
    } else if (drag.type === 'move') {
      const p = groundAt(e);
      if (!p) return;
      const f = plan.furniture.find((x) => x.id === drag.id);
      if (!f) return;
      f.x = clamp(px(p.x), 0.2, plan.bounds.w - 0.2);
      f.z = clamp(pz(p.z), 0.2, plan.bounds.d - 0.2);
      const g = furnGroup.children.find((x) => x.userData.furnId === drag.id);
      if (g) g.position.set(wx(f.x), 0.026, wz(f.z));
      drag.moved = true;
      invalidate();
    }
  }
  function onPointerUp(e) {
    if (drag && e.pointerId !== undefined && drag.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
    if (drag && drag.type === 'move' && drag.moved) { renderPanels(); changed(currentPlan()); }
    drag = null;
    if (stage.releasePointerCapture && e.pointerId !== undefined && e.pointerId !== null) {
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放 */ }
    }
  }
  // F180: capture 失败且指针移出 stage 时 pointerup 可能丢失，pointerleave 兜底复位拖拽
  function onPointerLeave(e) {
    if (drag && drag.type === 'move') {
      if (drag.moved) { renderPanels(); changed(currentPlan()); }
      drag = null;
    }
  }
  function onWheel(e) {
    if (!webglOK) return;
    e.preventDefault();
    cam.r = clamp(cam.r * (e.deltaY > 0 ? 1.10 : 0.90), 4, 60);
    applyCamera();
  }

  /* ---------- 事件委托（挂在会被整体移除的 DOM 上，无需手动解绑） ---------- */
  function onClick(e) {
    const t = e.target.closest('[data-fp-view],[data-fp-action],[data-fp-kind],[data-fp-wall],' +
      '[data-fp-toggle-wall],[data-fp-clear-sel],[data-fp-rotate],[data-fp-del-furn],[data-fp-room]');
    if (!t || !host.contains(t)) return;
    const v = t.dataset.fpView;
    if (v) { setCameraPreset(v); return; }
    if (t.dataset.fpAction === 'png') { exportPNG(); return; }
    if (t.dataset.fpKind) {
      const k = t.dataset.fpKind;
      // 再点一次同一件家具即取消放置模式（无需键盘，触屏也适用）
      if (mode === 'place' && placeKind === k) {
        mode = 'orbit'; placeKind = null;
        if (preview) preview.visible = false;
        stage.classList.remove('fp-placing');
        renderCatalog(); invalidate();
        notify('已取消摆放');
      } else {
        placeKind = k; mode = 'place';
        stage.classList.add('fp-placing');
        renderCatalog();
        const def = CAT_BY_KIND[placeKind];
        if (def) notify('已选中「' + def.name + '」，到左侧画面点击地面摆放');
      }
      return;
    }
    if (t.dataset.fpWall) { selected = { type: 'wall', id: t.dataset.fpWall }; toggleWall(t.dataset.fpWall); return; }
    if (t.dataset.fpToggleWall) { toggleWall(t.dataset.fpToggleWall); return; }
    if (t.hasAttribute('data-fp-clear-sel')) {
      selected = null; renderPanels(); refreshSelectionHelper(); return;
    }
    if (t.dataset.fpRotate) {
      const f = plan.furniture.find((x) => x.id === (selected && selected.id));
      if (!f) return;
      // F168: 用 num 兜底，避免空属性产生 NaN（虽有 truthy guard，显式更安全）
      f.rot = (num(f.rot, 0) + num(t.dataset.fpRotate, 0) + 360) % 360;
      const g = furnGroup.children.find((x) => x.userData.furnId === f.id);
      if (g) g.rotation.y = f.rot * Math.PI / 180;
      commit(false); refreshSelectionHelper(); return;
    }
    if (t.hasAttribute('data-fp-del-furn')) {
      const id = selected && selected.id;
      plan.furniture = plan.furniture.filter((x) => x.id !== id);
      selected = null; commit(true); notify('已删除家具'); return;
    }
  }
  function onInputChange(e) {
    const t = e.target;
    // F168: dataset 值恒为字符串，用显式 !== undefined 判定，避免 != null 把空串也当作有效键
    if (t.dataset.fpRoomName !== undefined) {
      const r = plan.rooms.find((x) => x.id === t.dataset.fpRoomName);
      if (r) { r.name = t.value.slice(0, 20); commit(false); updateLabels(); }
      return;
    }
    if (t.dataset.fpRoomMat !== undefined) {
      const r = plan.rooms.find((x) => x.id === t.dataset.fpRoomMat);
      if (r) { r.material = t.value; commit(true); }
      return;
    }
    if (t.dataset.fpF !== undefined && selected && selected.type === 'furniture') {
      const f = plan.furniture.find((x) => x.id === selected.id);
      if (!f) return;
      const def = CAT_BY_KIND[f.kind] || CATALOG[0];
      const key = t.dataset.fpF;
      // F162: 高度 h 使用自身上限 4（宽/深仍为 6），与 input 声明的 max 一致
      const hi = key === 'h' ? 4 : 6;
      const v = clamp(num(t.value, def[key]), 0.2, hi);
      f[key] = v;
      const g = furnGroup.children.find((x) => x.userData.furnId === f.id);
      if (g) g.scale.set(num(f.w, def.w) / def.w, num(f.h, def.h) / def.h, num(f.d, def.d) / def.d);
      commit(false); refreshSelectionHelper();
    }
  }

  /* ---------- 导出 ---------- */
  function exportPNG() {
    if (!webglOK || !renderer) { notify('当前浏览器未启用 WebGL，无法导出图片'); return; }
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = '户型设计-' + new Date().toISOString().slice(0, 10) + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    notify('图片已导出');
  }

  /* ---------- 装配 ---------- */
  try { initGL(); }
  catch (err) {
    webglOK = false;
    host.querySelector('.fp-webgl-fail').classList.remove('hidden');
    console.warn('[floorplan] WebGL 初始化失败：', err && err.message);
  }
  if (webglOK) rebuildAll();
  renderPanels();
  raf = requestAnimationFrame(loop);

  root.addEventListener('click', onClick);
  root.addEventListener('change', onInputChange);
  root.addEventListener('input', (e) => {
    if (e.target.dataset && e.target.dataset.fpRoomName !== undefined) {
      const r = plan.rooms.find((x) => x.id === e.target.dataset.fpRoomName);
      if (r) { r.name = e.target.value.slice(0, 20); updateLabels(); changed(currentPlan()); }
    }
  });
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('pointerleave', onPointerLeave);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    getPlan: currentPlan,
    setPlan(p) { plan = normalizePlan(p); selected = null; mode = 'orbit'; placeKind = null;
      stage.classList.remove('fp-placing'); rebuildAll(); renderPanels(); },
    exportPNG: exportPNG,
    setView: setCameraPreset,
    isWebGLOK() { return webglOK; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      if (ro) { ro.disconnect(); ro = null; }
      // F052: 按资源是否实际创建来无条件释放，而非依赖 webglOK。
      // initGL 中途抛错时 webglOK=false 但 renderer/canvas 可能已创建，旧逻辑会跳过 dispose 造成泄漏。
      clearGroup(floorGroup); clearGroup(wallGroup); clearGroup(furnGroup); clearGroup(markerGroup);
      if (preview) {
        if (preview.geometry) preview.geometry.dispose();
        if (preview.material) preview.material.dispose();
        preview = null;
      }
      if (renderer) { renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.remove(); renderer = null; }
      host.innerHTML = '';
    }
  };
}

/* ---------------- 门面 ---------------- */
const api = {
  version: VERSION,
  samplePlan: samplePlan,
  normalizePlan: normalizePlan,
  init(host, opts) {
    if (!host) throw new Error('floorplan: 缺少挂载容器');
    const inst = createInstance(host, opts || {});
    return inst;
  }
};

window.Floorplan3D = api;
window.dispatchEvent(new CustomEvent('floorplan:ready', { detail: { version: VERSION } }));

export default api;

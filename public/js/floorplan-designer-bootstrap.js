/*!
 * floorplan-designer-bootstrap.js · house-view-tracker
 * ---------------------------------------------------------------------------
 * 把系统内置户型（window.HVT_LAYOUTS，来自 ./js/floorplan-layouts.js）或内置的
 * a3b2b（三室两厅两卫，几何在 floorplan.html 内联，这里补一份兜底），转换成
 * house-plan-designer skill 模板（public/floorplan-designer.html = 其 template.html）
 * 所需的 HouseSpec，注入 window.__PRESET__，让同源打开的设计器直接展示该房源户型。
 *
 * 本文件在 <head> 内以经典 <script> 同步执行，早于模板的 <script type="module">，
 * 因此 window.__PRESET__ 一定先被设置好。
 * 坐标约定与 HouseSpec 一致：mm，x 向右(东)，y 向下(南)，墙为轴对齐矩形。
 * 一期只转换 墙 / 房间 / 门窗洞口（几何 + 语义），家具同步留作下一步。
 * --------------------------------------------------------------------------- */
(function () {
  'use strict';

  // a3b2b（三室两厅两卫）几何回退：floorplan.html 内联原始常量，这里补全，保证四种房型都能转
  var A3B2B = {
    id: 'a3b2b', name: '三室两厅两卫 · 装修设计',
    WALLS: [
      [1580,-240,2120,0,'b'],[1580,0,1820,300,'b'],[2120,-240,4580,0,'e'],[4580,-240,5140,0,'e'],
      [5760,-240,6050,0,'e'],[6050,-240,6600,0,'b'],[6360,0,6600,300,'b'],[6600,-240,9960,0,'e'],
      [9960,-240,10510,0,'b'],[10270,0,10510,300,'b'],
      [10270,300,10510,800,'e'],[10270,2600,10510,3090,'e'],[10270,3090,10510,4260,'b'],
      [10270,5740,10510,6370,'b'],[9960,6370,10510,6610,'b'],[10270,6610,10510,7400,'b'],
      [10270,9770,10510,10560,'b'],[9960,10560,10510,10800,'b'],
      [4580,10560,9960,10800,'e'],[10510,10560,12090,10800,'e'],[11850,9960,12090,10560,'e'],
      [4580,9200,4820,10560,'e'],[4580,7960,4820,8310,'e'],
      [3620,7960,4580,8200,'e'],[2180,7960,3620,8200,'b'],[2180,7590,2420,7960,'b'],[2180,7400,2420,7590,'n'],
      [-240,7960,2180,8200,'e'],[-240,3610,0,7960,'e'],
      [0,4950,200,5190,'n'],[200,4950,1275,5190,'low'],[1580,3370,2420,3825,'b'],
      [2180,4430,2420,5796,'n'],[2090,4950,2180,5190,'n'],
      [2420,4950,4580,5190,'n'],[4580,3280,4820,4075,'n'],[4580,4860,4820,5190,'n'],[2420,3370,4580,3610,'n'],
      [4580,0,4820,2400,'n'],[4820,2080,6360,2320,'n'],[6360,300,6600,1198,'n'],[6360,1983,6600,2400,'n'],
      [6083,3370,6600,3707,'b'],[6360,3280,6600,3370,'n'],[6600,3370,9960,3610,'n'],[9960,3370,10270,3610,'b'],
      [6083,4600,6323,6610,'n'],[6323,6370,9960,6610,'n']
    ],
    WINS: [
      [5140,-240,5760,0],[1580,300,1820,3370],[-240,3370,1580,3610],[2180,3825,2420,4430],
      [10510,6370,12090,6610],[11850,6610,12090,9960],
      [10510,660,11130,760],[11030,760,11130,2650],[10510,2650,11130,2750],
      [10510,4110,11130,4210],[11030,4210,11130,5785],[10510,5785,11130,5885]
    ],
    DOORS: [
      {name:'小孩房门',rect:[4580,2400,4820,3280],len:880},
      {name:'主卧门',rect:[6360,2400,6600,3280],len:880},
      {name:'主卫门',rect:[6360,1198,6600,1983],len:785},
      {name:'客卫门',rect:[4580,4075,4820,4860],len:785},
      {name:'子女房门',rect:[6083,3707,6323,4600],len:893},
      {name:'入户门',rect:[4580,8310,4820,9200],len:890,entry:true}
    ],
    SLIDES: [
      {rect:[10270,7400,10510,9770],v:true},
      {rect:[1275,4950,2090,5190],v:false}
    ],
    ROOMS: [
      {id:'master', name:'主卧室', at:[8435,2420], mat:'wood'},
      {id:'mbath', name:'主卫浴', at:[5980,1780], mat:'antislip'},
      {id:'kid', name:'小孩房', at:[3380,2330], mat:'wood'},
      {id:'gbath', name:'客卫浴', at:[3760,4620], mat:'antislip'},
      {id:'laundry', name:'洗衣阳台', at:[1250,4330], mat:'antislip'},
      {id:'child', name:'子女房', at:[8850,4850], mat:'wood'},
      {id:'kitchen', name:'厨房', at:[1300,6500], mat:'tile600'},
      {id:'dining', name:'餐厅', at:[3900,5520], mat:'tile800'},
      {id:'hall', name:'过道', at:[5450,4450], mat:'tile800'},
      {id:'living', name:'客厅', at:[7600,7560], mat:'tile800'},
      {id:'balcony', name:'休闲阳台', at:[11180,9450], mat:'walnut'},
      {id:'bay1', name:'主卧飘窗', at:[10470,1700], mat:'marble'},
      {id:'bay2', name:'子女房飘窗', at:[10470,5000], mat:'marble'}
    ]
  };

  function mapMat(m) {
    if (!m) return 'tile';
    if (m === 'wood') return 'oak';
    if (m === 'walnut') return 'walnut';
    if (m === 'marble') return 'marble';
    if (m === 'antislip') return 'bath';
    if (m && m.indexOf('tile') === 0) return 'tile';
    return 'tile';
  }

  // 墙矩形 [x0,y0,x1,y1] -> 中线墙 {a,b,t,bearing}
  function toWalls(walls) {
    return (walls || []).map(function (w) {
      var x0 = w[0], y0 = w[1], x1 = w[2], y1 = w[3], type = w[4];
      var horiz = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
      var a, b, t;
      if (horiz) {
        a = [Math.min(x0, x1), (y0 + y1) / 2];
        b = [Math.max(x0, x1), (y0 + y1) / 2];
        t = Math.abs(y1 - y0);
      } else {
        a = [(x0 + x1) / 2, Math.min(y0, y1)];
        b = [(x0 + x1) / 2, Math.max(y0, y1)];
        t = Math.abs(x1 - x0);
      }
      return { a: a, b: b, t: t, bearing: type === 'b' };
    });
  }

  function centroid(poly) {
    var sx = 0, sy = 0, n = 0;
    (poly || []).forEach(function (p) { sx += p[0]; sy += p[1]; n++; });
    return n ? [Math.round(sx / n), Math.round(sy / n)] : [0, 0];
  }

  function buildSpec(layoutId) {
    var L = (window.HVT_LAYOUTS && window.HVT_LAYOUTS[layoutId]) || (layoutId === 'a3b2b' ? A3B2B : null);
    if (!L) return null;

    var walls = toWalls(L.WALLS).map(function (w) {
      return { a: w.a, b: w.b, t: w.t, bearing: w.bearing, openings: [] };
    });

    var slideRects = (L.SLIDES || []).map(function (s) { return s.rect; });
    function isSlide(rect) {
      return slideRects.some(function (r) {
        return Math.abs(r[0] - rect[0]) < 5 && Math.abs(r[1] - rect[1]) < 5 &&
               Math.abs(r[2] - rect[2]) < 5 && Math.abs(r[3] - rect[3]) < 5;
      });
    }

    function attach(rect, type, extra) {
      var ox0 = Math.min(rect[0], rect[2]), ox1 = Math.max(rect[0], rect[2]);
      var oy0 = Math.min(rect[1], rect[3]), oy1 = Math.max(rect[1], rect[3]);
      var tol = 30;
      for (var i = 0; i < walls.length; i++) {
        var w = walls[i];
        var horiz = Math.abs(w.b[0] - w.a[0]) >= Math.abs(w.b[1] - w.a[1]);
        var cx = (w.a[0] + w.b[0]) / 2, cy = (w.a[1] + w.b[1]) / 2;
        var half = w.t / 2;
        // 墙的包络盒：长轴取整段长度，短轴为厚度 ±t/2（不能用中心线坐标直接比洞口）
        var xr, yr;
        if (horiz) {
          xr = [Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])];
          yr = [cy - half, cy + half];
        } else {
          xr = [cx - half, cx + half];
          yr = [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])];
        }
        if (horiz) {
          if (oy0 >= yr[0] - tol && oy1 <= yr[1] + tol && ox0 >= xr[0] - tol && ox1 <= xr[1] + tol) {
            w.openings.push(Object.assign({ type: type, from: ox0, to: ox1 }, extra || {}));
            return true;
          }
        } else {
          if (ox0 >= xr[0] - tol && ox1 <= xr[1] + tol && oy0 >= yr[0] - tol && oy1 <= yr[1] + tol) {
            w.openings.push(Object.assign({ type: type, from: oy0, to: oy1 }, extra || {}));
            return true;
          }
        }
      }
      return false;
    }

    (L.WINS || []).forEach(function (r) { attach(r, isSlide(r) ? 'slideWindow' : 'window'); });
    (L.DOORS || []).forEach(function (d) {
      var r = d.rect || d;
      var ex = {}; if (d.entry) ex.entry = true;
      attach(r, isSlide(r) ? 'sliding' : 'door', ex);
    });

    var finalWalls = walls.map(function (w) {
      var o = { a: w.a, b: w.b, t: w.t, bearing: w.bearing };
      if (w.openings.length) o.openings = w.openings;
      return o;
    });

    var rooms = (L.ROOMS || []).map(function (r) {
      return { at: r.at || centroid(r.poly), name: r.name, mat: mapMat(r.mat) };
    });

    return {
      name: (L.name || '户型') + ' · 高级设计',
      height: 2800,
      phase: 'renovate',
      north: 0,
      look: { style: 'real', palette: 'plan' },
      walls: finalWalls,
      rooms: rooms,
      autoElec: true
    };
  }

  function boot() {
    if (window.__PRESET__) return; // 防止重复注入
    var q = new URLSearchParams(location.search);
    var layout = q.get('layout') || 'a3b2b';
    var propId = q.get('propId') || '';
    var spec = buildSpec(layout);
    if (!spec) spec = { name: '暂无户型数据 · 高级设计', height: 2800, walls: [], rooms: [] };
    spec.propertyId = propId;
    window.__PRESET__ = { spec: spec };
  }

  // 调试/回归用：暴露纯转换函数（不影响页面逻辑）
  window.__hvtBuildSpec = buildSpec;

  boot();
})();

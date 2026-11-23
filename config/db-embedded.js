// ============================================================
// 内嵌 PostgreSQL（PGlite / WASM）适配层 —— 用于「上传即跑」的绿色部署包
//
// 目的：服务器上不安装 PostgreSQL 也能运行。PGlite 是完整 PostgreSQL 编译成
// WebAssembly，支持 jsonb / plpgsql 触发器 / RETURNING / ON CONFLICT 等本系统
// 用到的全部语法，数据直接落在本地目录，备份就是拷这个目录。
//
// server.js 全程只调用 pool.query(sql, params) → { rows, rowCount }，
// 这里把 PGlite 的 API 映射成完全相同的形状，业务 SQL 一行都不用改。
//
// 启用：环境变量 HVT_DB=embedded（部署包的 start.sh / systemd unit 已设置）
// 数据目录：HVT_DATA_DIR（绝对路径，或相对项目根），默认 <项目根>/data
// 关闭：不设置 HVT_DB 即回到原来的 PostgreSQL 连接，本地开发零影响。
// ============================================================
const fs = require('fs');
const path = require('path');

let db = null;
let ready = null;
let failedInit = null;       // 缓存初始化失败，避免每个 query 都重复 mkdir/require
let initLogged = false;      // 同一初始化失败只打一次日志
const INIT_RETRY_MS = 5000;  // 失败后短暂退避再重试，兼顾「瞬时故障可自愈」与「避免反复空转」

function dataDir() {
  const root = path.join(__dirname, '..');
  const raw = process.env.HVT_DATA_DIR || 'data';
  return path.isAbsolute(raw) ? raw : path.join(root, raw);
}

async function ensure() {
  if (!ready) {
    // 初始化失败后在退避窗口内直接复用同一个错误，避免每次 query 都重跑 mkdir/require
    if (failedInit) {
      if (Date.now() - failedInit.at < INIT_RETRY_MS) throw failedInit.err;
      failedInit = null;
    }
    ready = (async () => {
      const dir = dataDir();
      fs.mkdirSync(dir, { recursive: true });
      const { PGlite } = require('@electric-sql/pglite');
      const inst = new PGlite(dir);
      await inst.waitReady;
      db = inst;
      failedInit = null;
      initLogged = false;
      console.log('✅ 内嵌 PostgreSQL 已就绪（数据目录：' + dir + '）');
      return inst;
    })().catch((e) => {
      ready = null;
      if (!initLogged) {
        console.error('[embedded-db] 内嵌数据库初始化失败（数据目录：' + dataDir() + '）：' + (e && e.message || e));
        initLogged = true;
      }
      failedInit = { at: Date.now(), err: e };
      throw e;
    });
  }
  return ready;
}

function shape(r) {
  const rows = Array.isArray(r && r.rows) ? r.rows : [];
  let rowCount = (r && typeof r.rowCount === 'number') ? r.rowCount : undefined;
  if (rowCount === undefined) {
    rowCount = (r && typeof r.affectedRows === 'number') ? r.affectedRows : rows.length;
  }
  return { rows: rows, rowCount: rowCount, fields: (r && r.fields) || [] };
}

const pool = {
  // 有参数 → query()（prepared statement，类型解析与 pg 一致）
  // 无参数 → exec()（simple protocol），因为 SCHEMA / 建触发器是一次多语句字符串，
  //           PGlite 的 query() 会报 "cannot insert multiple commands into a prepared statement"。
  //           exec() 返回多条结果组成的数组，取最后一条对齐 pg 的单结果语义。
  async query(sql, params) {
    await ensure();
    if (Array.isArray(params) && params.length > 0) {
      return shape(await db.query(sql, params));
    }
    const arr = await db.exec(sql);
    return shape(Array.isArray(arr) ? arr[arr.length - 1] : arr);
  },
  async end() {
    // 先等 in-flight 的 ensure() 结算，否则可能 close 之后才把 db 赋值，留下未关闭的实例
    if (ready) { try { await ready; } catch (_) {} }
    if (db) { await db.close(); db = null; }
    ready = null;
    failedInit = null;
  }
};

module.exports = pool;
module.exports.ensureEmbedded = ensure;
module.exports.embeddedDataDir = dataDir;

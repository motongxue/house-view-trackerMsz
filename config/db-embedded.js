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

function dataDir() {
  const root = path.join(__dirname, '..');
  const raw = process.env.HVT_DATA_DIR || 'data';
  return path.isAbsolute(raw) ? raw : path.join(root, raw);
}

async function ensure() {
  if (!ready) {
    ready = (async () => {
      const dir = dataDir();
      fs.mkdirSync(dir, { recursive: true });
      const { PGlite } = require('@electric-sql/pglite');
      const inst = new PGlite(dir);
      await inst.waitReady;
      db = inst;
      console.log('✅ 内嵌 PostgreSQL 已就绪（数据目录：' + dir + '）');
      return inst;
    })().catch((e) => { ready = null; throw e; });
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
    if (db) { await db.close(); db = null; ready = null; }
  }
};

module.exports = pool;
module.exports.ensureEmbedded = ensure;
module.exports.embeddedDataDir = dataDir;

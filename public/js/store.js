// store.js —— 数据层（对接本地后端 REST；owner_id 由后端按登录用户自动注入，前端无需关心）
const Store = (function () {
  // ---------- 外链图片 URL 规范化 ----------
  // 规则唯一来源：public/js/property-schema.json 的 imageRules（插件采集读的是同一份）。
  // 贝壳图片 CDN 只放行平台已申请的处理指令，插件早期把原图直链存进了库，详情页 4 张图全裂。
  // 这里在「读数据」时就修好，历史上已导入的房源不用重新采集、也不用刷库即可恢复显示。
  // 只处理白名单域名 + 路径前缀 + 无 '!' 指令的图片；已带指令、本地 /media/、data:、
  // 其它平台链接一律原样返回，不会影响手动录入的图片。
  let MEDIA_RULES = [];
  function configureMediaRules(rules) {
    MEDIA_RULES = Array.isArray(rules)
      ? rules.filter((r) => r && r.host && r.command && Array.isArray(r.pathPrefixes))
      : [];
  }
  function mediaUrl(u) {
    const s = String(u == null ? '' : u).trim();
    const m = s.match(/^(https?:\/\/)([^/?#]+)(\/[^?#]*)(\?[^#]*)?(#.*)?$/i);
    if (!m) return s;
    const host = m[2].toLowerCase(), p = m[3];
    for (const r of MEDIA_RULES) {
      const h = String(r.host).toLowerCase();
      if (host !== h && !host.endsWith('.' + h)) continue;
      if (p.includes('!') || !/\.(jpe?g|png|webp|gif)$/i.test(p)) return s;
      if (r.pathPrefixes.some((pre) => p.startsWith(pre))) return m[1] + m[2] + p + r.command;
    }
    return s;
  }
  /* 查看器放大时用：把缩略图指令换成平台已放行的「大图指令」。
   * 贝壳 280x210 缩略图撑满 90% 屏会又糊又窄，页面自己用的是 710x400。
   * 已带指令的链接先截到扩展名再拼 largeCommand，因此对读时修好的历史数据同样有效、且幂等。 */
  function mediaLargeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    const m = s.match(/^(https?:\/\/)([^/?#]+)(\/[^?#]*)/i);
    if (!m) return s;
    const host = m[2].toLowerCase();
    const bang = m[3].indexOf('!');
    const base = bang >= 0 ? m[3].slice(0, bang) : m[3];
    if (!/\.(jpe?g|png|webp|gif)$/i.test(base)) return s;
    for (const r of MEDIA_RULES) {
      if (!r.largeCommand) continue;
      const h = String(r.host).toLowerCase();
      if (host !== h && !host.endsWith('.' + h)) continue;
      if (r.pathPrefixes.some((pre) => base.startsWith(pre))) return m[1] + m[2] + base + r.largeCommand;
    }
    return s;
  }
  function normalizeMedia(row) {
    const m = row && row.media;
    if (!m || typeof m !== 'object' || !MEDIA_RULES.length) return row;
    ['images', 'videos', 'floorPlans', 'environment'].forEach((k) => {
      if (Array.isArray(m[k])) m[k] = m[k].map(mediaUrl);
    });
    // 外链视频 / VR 卡片的封面也是图片，同样要补平台指令（否则缩略图会裂）
    if (Array.isArray(m.links)) {
      m.links.forEach((l) => { if (l && typeof l === 'object' && l.cover) l.cover = mediaUrl(l.cover); });
    }
    return row;
  }

  // ---------- 行级归一化（勿删）----------
  // ① 经纬度：CSV 导入、插件一键导入、老数据都可能把坐标存成字符串（"104.25..."），
  // 详情页 / 录入页会对 lng/lat 调 .toFixed()，字符串直接抛 TypeError，高德 Marker 也不稳。
  // ② 外链图片：见上。两者都在「内存归一化 + 写入时清洗」，不批量改写数据库历史值。
  function normalizeRow(row) {
    if (!row || typeof row !== 'object') return row;
    normalizeMedia(row);
    if (!row.geo || typeof row.geo !== 'object') return row;
    ['lng', 'lat'].forEach((k) => {
      const v = row.geo[k];
      const n = Number(v);
      if (v !== '' && v != null && Number.isFinite(n)) row.geo[k] = n;
      else delete row.geo[k];
    });
    // 只有一对完整有效的经纬度才算定位点，否则下游的 `p.geo && p.geo.lng` 判断会拿到半个坐标
    if (row.geo.lng == null || row.geo.lat == null) row.geo = null;
    return row;
  }
  // 写入路径用浅拷贝清洗，避免改动调用方持有的表单状态对象
  function cleanRow(row) {
    if (!row || typeof row !== 'object') return row;
    const c = Object.assign({}, row);
    if (c.geo && typeof c.geo === 'object') c.geo = Object.assign({}, c.geo);
    if (c.media && typeof c.media === 'object') {
      c.media = Object.assign({}, c.media);
      ['images', 'videos', 'floorPlans', 'environment'].forEach((k) => {
        if (Array.isArray(c.media[k])) c.media[k] = c.media[k].slice();
      });
      // links 是对象数组（外链视频/VR），编辑房源保存时不能被丢掉
      if (Array.isArray(c.media.links)) c.media.links = c.media.links.map((l) => Object.assign({}, l));
    }
    return normalizeRow(c);
  }

  // ---------- 老房源自动补省份（全国化迁移）----------
  // 只补空缺的 location.province / city，绝不改写已有 city / district 文本，避免影响筛选值。
  // 内存补全让列表 / 详情 / 筛选 / 导出立刻带上省份；同一登录态只静默写回一次数据库。
  let regionMigrated = false;
  function migrateRows(rows) {
    if (!window.Regions || !Array.isArray(rows)) return;
    const changed = [];
    rows.forEach((p) => { if (Regions.migrate(p)) changed.push(p); });
    if (!changed.length || regionMigrated) return;
    regionMigrated = true;
    try {
      const tk = sessionStorage.getItem('hvt_token') || localStorage.getItem('hvt_token') || '';
      const key = 'hvt_region_migrated_' + tk.slice(-16);
      if (!tk || localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch (e) { return; }
    // 后台静默写回，不阻塞界面；失败也不影响显示（内存已补全）
    (async () => {
      for (let i = 0; i < changed.length; i += 4) {
        await Promise.allSettled(changed.slice(i, i + 4).map((p) => update(p.id, p)));
      }
      console.log('[REGION] 已为 ' + changed.length + ' 条老房源补上省份');
    })();
  }

  async function list() {
    const r = await Api.get('/api/properties');
    const rows = r.data || [];
    rows.forEach(normalizeRow);
    migrateRows(rows);
    return rows;
  }

  async function get(id) {
    const r = await Api.get('/api/properties/' + encodeURIComponent(id));
    if (window.Regions && r.data) Regions.migrate(r.data);
    return normalizeRow(r.data);
  }

  // row 不含 owner_id，后端自动补上当前登录用户
  async function create(row) {
    const r = await Api.post('/api/properties', cleanRow(row));
    return normalizeRow(r.data);
  }

  async function update(id, row) {
    const r = await Api.put('/api/properties/' + encodeURIComponent(id), cleanRow(row));
    return normalizeRow(r.data);
  }

  async function remove(id) {
    await Api.del('/api/properties/' + encodeURIComponent(id));
  }

  // 一键导入 5 条示例数据（后端按当前登录用户写入）
  async function seed() {
    const r = await Api.post('/api/properties/seed');
    const rows = r.data || [];
    rows.forEach(normalizeRow);
    return rows;
  }

  // 批量导入（CSV / 插件一键导入等）：写入前清洗，避免字符串坐标进库
  async function batch(rows) {
    const r = await Api.post('/api/properties/batch', (rows || []).map(cleanRow));
    const out = r.data || [];
    out.forEach(normalizeRow);
    return out;
  }

  // 回收站列表
  async function trash() {
    const r = await Api.get('/api/trash');
    const rows = r.data || [];
    rows.forEach(normalizeRow);
    return rows;
  }

  // 恢复已删除房源
  async function restore(id) {
    const r = await Api.post('/api/properties/' + encodeURIComponent(id) + '/restore');
    return normalizeRow(r.data);
  }

  // 图片上传（旧方式，base64）——已弃用：后端 JSON 请求体限 1MB，稍大的图片会被断开连接。
  // 头像已改走 uploadFile（二进制直传），此函数仅为兼容保留，请勿在新代码里调用。
  async function upload(dataUrl, filename) {
    const r = await Api.post('/api/upload', { dataUrl, filename });
    // 兼容 { url } 与 { data: { url } } 两种返回格式，避免静默失败（前端显示“已上传”却取不到地址 → 图片不显示）
    const url = (r && r.url) || (r && r.data && r.data.url) || '';
    return { url };
  }

  // 文件上传（新方式，流式二进制）——用于房源图片/视频/户型图/环境图，避免大文件转 base64 撑爆内存
  async function uploadFile(file, key) {
    const r = await Api.uploadFile('/api/upload', file, key, file && file.name);
    const url = (r && r.data && r.data.url) || (r && r.url) || '';
    return { url };
  }

  // 彻底删除（回收站）
  async function purge(id) {
    const r = await Api.post('/api/properties/' + encodeURIComponent(id) + '/purge');
    return r.data;
  }

  // 收藏 / 取消收藏（val 传 true/false 定向设置；不传则切换）
  async function toggleFavorite(id, val) {
    const body = typeof val === 'boolean' ? { favorite: val } : {};
    const r = await Api.post('/api/properties/' + encodeURIComponent(id) + '/favorite', body);
    return r.data;
  }

  // 房源跟进日志
  async function listFollowups(propertyId) {
    const r = await Api.get('/api/properties/' + encodeURIComponent(propertyId) + '/followups');
    return r.data || [];
  }
  async function addFollowup(propertyId, payload) {
    const r = await Api.post('/api/properties/' + encodeURIComponent(propertyId) + '/followups', payload);
    return r.data;
  }
  async function delFollowup(propertyId, fid) {
    await Api.del('/api/properties/' + encodeURIComponent(propertyId) + '/followups/' + encodeURIComponent(fid));
  }

  // 购房知识：用户上传资料（按账号隔离）
  async function knowledgeList() {
    const r = await Api.get('/api/knowledge');
    return r.data || [];
  }
  async function knowledgeUpload(dataUrl, filename, title) {
    const r = await Api.post('/api/knowledge', { dataUrl, filename, title });
    return r.data;
  }
  async function knowledgeDelete(id) {
    await Api.del('/api/knowledge/' + encodeURIComponent(id));
  }
  async function knowledgeCreateNote(title, content) {
    const r = await Api.post('/api/knowledge', { kind: 'note', title, content });
    return r.data;
  }

  return { configureMediaRules, mediaUrl, mediaLargeUrl, list, get, create, update, remove, seed, batch, trash, restore, upload, uploadFile, purge, toggleFavorite, listFollowups, addFollowup, delFollowup, knowledgeList, knowledgeUpload, knowledgeDelete, knowledgeCreateNote };
})();
window.Store = Store;

// store.js —— 数据层（对接本地后端 REST；owner_id 由后端按登录用户自动注入，前端无需关心）
const Store = (function () {
  async function list() {
    const r = await Api.get('/api/properties');
    return r.data || [];
  }

  async function get(id) {
    const r = await Api.get('/api/properties/' + encodeURIComponent(id));
    return r.data;
  }

  // row 不含 owner_id，后端自动补上当前登录用户
  async function create(row) {
    const r = await Api.post('/api/properties', row);
    return r.data;
  }

  async function update(id, row) {
    const r = await Api.put('/api/properties/' + encodeURIComponent(id), row);
    return r.data;
  }

  async function remove(id) {
    await Api.del('/api/properties/' + encodeURIComponent(id));
  }

  // 一键导入 5 条示例数据（后端按当前登录用户写入）
  async function seed() {
    const r = await Api.post('/api/properties/seed');
    return r.data || [];
  }

  // 批量导入（CSV 等）
  async function batch(rows) {
    const r = await Api.post('/api/properties/batch', rows);
    return r.data || [];
  }

  // 回收站列表
  async function trash() {
    const r = await Api.get('/api/trash');
    return r.data || [];
  }

  // 恢复已删除房源
  async function restore(id) {
    const r = await Api.post('/api/properties/' + encodeURIComponent(id) + '/restore');
    return r.data;
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

  return { list, get, create, update, remove, seed, batch, trash, restore, upload, uploadFile, purge, toggleFavorite, listFollowups, addFollowup, delFollowup, knowledgeList, knowledgeUpload, knowledgeDelete, knowledgeCreateNote };
})();
window.Store = Store;

// ============================================================
// 应用配置（客户端可读，均非机密）
// 存储层说明：本应用使用「同源本地后端 + 本地 PostgreSQL」，
//   后端连接配置在服务端 config/db.js（不暴露给浏览器）。
//   发布到 WorkBuddy 云端时，只需把后端数据层从“本地 PG”切到平台托管的 Postgres，
//   前端代码（这里的配置 + 各 UI 模块）无需改动。
// 地图（高德）：高德 Key 改为【每用户自配】——用户登录后到「设置 → 高德地图 Key」
//   填写自己的 JS API Key 与安全密钥，存到后端、随账号走。这里不再写死任何密钥。
//   申请：高德开放平台 → 应用管理 → 创建应用 → 添加 Key（服务平台选“Web端(JS API)”），
//   并配置“域名白名单”（本地 localhost / 127.0.0.1；发布时再加你的域名）。
// ============================================================
window.APP_CONFIG = {
  // 高德「Web端(JS API)」Key + 安全密钥：留空，由登录后从后端拉取当前用户自配的 Key 动态注入。
  // （请勿在此写死真实 Key：会随前端代码分发出去，且多人/多部署共用同一把 Key。）
  AMAP_KEY: '',
  AMAP_SECURITY_CODE: '',

  // （可选备用）高德「Web服务」Key：仅服务端使用，不在此暴露；用户在设置页填写后存后端。
  AMAP_WEB_KEY: '',

  // 版本更新检测：填你自己的 Gitee / GitHub 公开仓库里 version.json 的 raw 地址。
  // 留空 = 「检查更新」按钮会提示未配置。只读取公开版本信息，不上传任何账号/房源数据。
  // Gitee 示例：https://gitee.com/你的账号/house-view-tracker/raw/main/version.json
  // GitHub 示例：https://raw.githubusercontent.com/你的账号/house-view-tracker/main/version.json
  // 已配置：Gitee 仓库 mo_shan_zhu/house-view-tracker 的 version.json（同时供检查更新与关于页时间轴读取）
  // v1.8.5：主源切到 Gitee。原因：GitHub raw / jsDelivr 的 CDN 会把 @main 这个别名缓存住，
  //   推送后仍返回旧提交里的版本号，导致「服务器说已是最新、页面时间轴说 1.8.x」这种自相矛盾。
  //   Gitee raw 走 302 到 raw.giteeusercontent.com，缓存短、国内直连稳定（CSP 已放行该域名）。
  UPDATE_URL: 'https://gitee.com/mo_shan_zhu/house-view-tracker/raw/main/version.json',

  // 版本文件备用镜像（可选，数组，按顺序兜底）。
  // 背景：Gitee 偶尔也会抽风，GitHub raw 在国内机房会间歇性 ETIMEDOUT，多留两条线。
  // 前端与后端都读这份清单；镜像只镜像仓库文件，所以能取 version.json，但取不了 56MB 的 Release 附件。
  UPDATE_MIRRORS: [
    'https://raw.githubusercontent.com/motongxue/house-view-trackerMsz/main/version.json',
    'https://fastly.jsdelivr.net/gh/motongxue/house-view-trackerMsz@main/version.json'
  ]
};

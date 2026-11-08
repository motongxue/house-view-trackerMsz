# 看房记录与对比工具（本地 PostgreSQL 版）

面向个人购房者的**看房记录与横向对比工具**：长期记录多套看过的房源，录入小区名即自动在真实地图上定位标注，支持列表、详情、地图分布、并排对比。支持任意城市。

> 数据**完全保存在你本机 PostgreSQL**，不联网、不上传；多人各自注册账号、数据互相隔离。

## 1. 为什么用本地 PostgreSQL（而不是 Supabase）

前面一版用的是 Supabase，但 `supabase.co` 在国内常被网络限制，你本地浏览器连不上、注册/登录一直失败。所以改成本机已有的 **PostgreSQL 15**：

- 你本机已经装了 PostgreSQL 15（`E:\app\tool\PostgreSQL\15`），和云端托管的是**同一种引擎**，表结构/SQL 可 1:1 平移；以后切到 WorkBuddy 云端 Postgres 时，**只需把后端数据层从“本地 PG”换成云端连接串，前端业务代码一行不用改**。
- 不再依赖任何外网域名，注册/登录/读写都在 localhost 完成。
- 仍保留**高德真实地图 + 输入小区名自动定位**（这部分本就走高德，和数据库无关）。

## 2. 技术选型

| 关注点 | 方案 | 说明 |
|---|---|---|
| 数据库 | **本地 PostgreSQL 15**（库 `house_view`，角色 `hvt`） | 你本机已装；服务端用 `pg` 连接。 |
| 后端 | **Node 原生 http + pg**（同源本地服务） | 提供认证 + 房源 CRUD 接口；启动自动建表。**无需自建数据库，无需手动初始化。** |
| 登录与隔离 | 邮箱+密码（scrypt 哈希 + HMAC 令牌） | 每人只看到自己 `owner_id` 的数据（服务端按登录用户过滤，比 RLS 更直接）。 |
| 地图 / 地理编码 | **高德地图 JS API 2.0** | 真实街道底图；输入小区名即精准定位。未配/失败自动回退内置本地名称表。 |
| 前端 | 原生 HTML/CSS/JS（无构建） | 通过同源 REST 与后端通信。 |
| 本地运行 | `node server.js`（默认 8787） | 既托管前端，也提供 API。 |

## 3. 数据库结构（与云端 Postgres 一致，便于以后切换）

服务端启动时自动执行（`server.js` 的 `ensureSchema()`），无需手动建表。两张表：

```sql
-- 账号
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  password_hash text not null,
  created_at  timestamptz not null default now()
);

-- 房源（核心字段走 jsonb，方便扩展）
create table if not exists properties (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,  -- 数据隔离关键
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  title       text,
  location    jsonb not null default '{}',   -- {city, district, community, address}
  attributes  jsonb not null default '{}',   -- {layout, area, orientation, floor}
  media       jsonb not null default '{}',   -- {images:[], videos:[]}
  transaction jsonb not null default '{}',   -- {totalPrice, unitPrice, agentName, agentPhone}
  facilities  jsonb not null default '{}',   -- {transport, supermarket, school, hospital, water, electricity, gas, notes}
  geo         jsonb,                         -- {lng, lat, source, formattedAddress}
  notes       text
);
```

**数据隔离实现**：所有房源读写接口都由后端按当前登录用户的 `owner_id` 过滤，用户 A 既看不到也改不了用户 B 的数据（已端到端测试验证）。

### 已为你初始化（无需你再做）
- 专用角色 `hvt`（低权限）、专用库 `house_view`（owner=hvt）、public schema 授权、表与索引。
- 你的 PostgreSQL 超级用户 `postgres` 密码**已还原为你提供的原始值**，不影响你其他程序。
- 应用连接配置见 `config/db.js`（默认指向本机库 `house_view`；**部署时务必用环境变量 `PGPASSWORD` 覆盖默认开发口令**，生产库口令不要写进任何文件）。

> ⚠️ 前提：本机 **PostgreSQL 服务要处于运行状态**。若启动应用后接口报“无法连接服务器”，多半是 PG 服务没开。可在 Windows 服务里启动 `postgresql-x64-15`，或管理员命令行 `net start postgresql-x64-15`。

## 4. 高德地图 Key 配置（每用户自配）

`public/config.js` 中三个高德 Key **一律留空**，源码里不写死任何 Key。每位用户登录后到「设置 → 高德地图 Key」填写自己的 **Web 端 (JS API) Key** 与 **安全密钥（securityJsCode）**，存到后端 `users` 表、随账号走；再点「启用地图功能」，才会加载高德脚本并显示「地图分布」菜单。可选的 **Web 服务 Key** 仅服务端使用，不会下发浏览器。

⚠️ **域名白名单**：高德 Web 端 (JS API) Key 按请求域名校验。
- 本地开发：在 Key 设置里把 `localhost`、`127.0.0.1` 加入白名单。
- 发布到服务器后：把你的域名加进白名单。
- 没加白名单时，地图会报 `USERKEY_PLAT_NOMATCH` / `INVALID_USER_KEY`，地图与自动定位失败。

未启用地图或未配 Key 时，地图页显示引导卡片（可一键跳设置页）；地理编码自动回退到内置 `public/data/gazetteer.json` 本地名称表（仅少量示例小区，坐标为近似值）。

## 5. 运行

```bash
cd house-view-tracker
npm install            # 安装 pg（已装则可跳过）
npm start              # 启动服务（默认 8787）
# 浏览器打开 http://127.0.0.1:8787/
```

首次进入先**注册**一个账号：图形安全验证通过后，服务端发 6 位邮箱验证码，填码完成注册（密码 ≥8 位）。登录可选「验证码登录」或「密码登录」。需先按 `.env.example` 配好 `SMTP_*`，否则发码类操作会明确报「邮件服务未配置」。

## 6. 目录结构

```
house-view-tracker/
├─ server.js            # 本地后端：静态托管 + REST(API 认证/房源) + 启动自动建表
├─ config/db.js         # ★ 服务端数据库连接配置（仅后端用，不暴露给浏览器）
├─ package.json
└─ public/
   ├─ config.js         # 前端公开配置：三个高德 Key 一律留空，由用户自行配置
   ├─ index.html
   ├─ css/style.css
   ├─ data/gazetteer.json   # 离线地理编码兜底名称表
   └─ js/
      ├─ api.js         # 与后端 REST 通信（同源）
      ├─ auth.js        # 登录/注册/会话
      ├─ store.js       # 数据层（CRUD，owner_id 由后端注入）
      ├─ geo.js         # 地理编码（高德优先，本地兜底）
      ├─ map.js         # 高德地图封装（标注/点击摘要/点击补点）
      └─ app.js         # 主逻辑（列表/地图/对比/录入/详情）
```

## 7. 切换到 WorkBuddy 云端 Postgres（以后要做时）

设计上已为这一步留好口子：表结构与云端 Postgres 完全一致；要上云时，只需把后端数据层（`server.js` 的 `Pool` 连接 + `config/db.js` 的连接串）改为平台托管的 Postgres，**前端代码（含 config.js 与所有 UI 模块）无需改动**。具体发布方式以 WorkBuddy 平台为准。

## 8. 已知限制

1. **本地媒体预览受限**：浏览器安全策略通常不能直接加载本地绝对路径的图片/视频。媒体字段以「URL 或路径记录」为主；若为 http(s) URL 可直接预览。需要本地预览可把素材放到 `public/` 下用相对路径，或后续改为上传到对象存储。
2. **离线兜底坐标仅为近似**：未配高德 Key 时用的 `gazetteer.json` 坐标是示意值，非真实楼栋位置；配了高德后即为真实定位。
3. **高德配额**：个人免费额度对看房这类低频使用完全够用；超限只限流不扣费。
4. **数据在本机**：目前数据存在本机 PostgreSQL，换电脑/重装需自行备份 `house_view` 库。若以后上云则无此问题。
5. **多用户是“账号级隔离”**：每人数据互相不可见；若要做“分享给朋友共看”，需另加协作/分享逻辑（暂不实现）。
```

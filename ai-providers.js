'use strict';
// ==================================================================
// 每账号「多模型清单」的唯一数据实现（纯函数，不碰数据库 / 网络）。
//   mergeProviders    保存时合并：Key 留空 = 保留旧值，'__clear__' = 清空
//   sanitizeProviders 下发给前端：密钥明文绝不出现，只给 keySet 布尔
//   pickActive        取「当前生效」的那一条模型，并给出完整/缺项判定
//   legacyProvider    旧单模型四列 → 一条清单记录（迁移 / 回退兜底）
//
// 数据结构（2026-11-14 v5）：一张厂商卡共享接口地址 + 一个 API Key，
// 下面挂多行具体模型；「当前使用」精确到某一行。
//   provider = { id, preset, name, baseUrl, apiKey, model(兼容快照),
//                models: [{ id, name, model, type }] }
//   ai_active_provider = '厂商ID::模型ID'；旧值只有厂商ID时自动取第一行，
//   所以上一版存的数据不用迁移也能继续用。
// 出站地址的安全校验仍由 server.js 的 assertSafeUrl() 负责，这里不重复实现。
// ==================================================================

const MAX_PROVIDERS = 24;
const MAX_MODELS_PER_PROVIDER = 20;
const CLEAR_SENTINEL = '__clear__';
const ACTIVE_SEP = '::';

// 模型类型白名单（唯一权威定义；前端 app.js 的 AI_MODEL_TYPES 必须逐项一致，
// 由 contract.js 静态断言保证）。类型只做标注/筛选，不影响 resolveAiEndpoint 的选路。
const MODEL_TYPES = ['llm', 'vision', 'multimodal', 'reasoning', 'code', 'embedding', 'other'];
const DEFAULT_TYPE = 'llm';

function s(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }

function asList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
  }
  return [];
}

function normType(v) {
  const t = s(v, 20);
  return MODEL_TYPES.indexOf(t) >= 0 ? t : DEFAULT_TYPE;
}

// 缺 id 时按「模型内容」生成稳定标识（FNV-1a），而不是按数组下标：
// 下标 id 在删除/重排后会指向另一条模型，导致已保存的 activeKey 失效或错位。
function stableModelId(m, i) {
  const basis = s(m.model, 120) + '|' + s(m.name, 80);
  if (!s(m.model, 120) && !s(m.name, 80)) return 'm' + (i + 1);
  let h = 2166136261;
  for (let k = 0; k < basis.length; k++) { h ^= basis.charCodeAt(k); h = Math.imul(h, 16777619); }
  return 'm' + (h >>> 0).toString(36);
}

// 惰性兼容：上一版记录只有单个 model 字段、没有 models 数组。
// 这里统一补成一行，旧账号不需要数据库迁移。
function modelList(p) {
  const arr = asList(p && p.models);
  if (arr.length) {
    const seen = new Set();
    return arr.filter(m => m && typeof m === 'object').map((m, i) => {
      let id = s(m.id, 60) || stableModelId(m, i);
      if (seen.has(id)) id = id + '-' + i; // 与 normModels 一致：重复 id 追加序号，避免 activeKey 指向歧义模型
      seen.add(id);
      return {
        id,
        name: s(m.name, 80) || s(m.model, 120) || ('模型' + (i + 1)),
        model: s(m.model, 120),
        type: normType(m.type)
      };
    });
  }
  const legacy = s(p && p.model, 120);
  return legacy ? [{ id: 'm1', name: legacy, model: legacy, type: DEFAULT_TYPE }] : [];
}

// 旧版单模型配置 → 一条清单记录。旧四列保留不动，随时可一键回退。
function legacyProvider(row) {
  if (!row) return null;
  const baseUrl = s(row.ai_direct_base_url, 300);
  const model = s(row.ai_direct_model, 120);
  const apiKey = s(row.ai_direct_api_key, 300);
  if (!baseUrl && !model && !apiKey) return null;
  const models = model ? [{ id: 'm1', name: model, model, type: DEFAULT_TYPE }] : [];
  return {
    id: 'legacy', preset: 'custom', name: '原有自定义模型',
    baseUrl, model, apiKey, models
  };
}

function activeKeyOf(providerId, modelId) {
  return s(providerId, 60) + ACTIVE_SEP + s(modelId, 60);
}

// 同时认 '厂商ID::模型ID' 与旧版 '厂商ID'（后者取第一行模型）。
function parseActive(key) {
  const k = s(key, 160);
  const i = k.indexOf(ACTIVE_SEP);
  if (i > 0) return { providerId: k.slice(0, i), modelId: k.slice(i + ACTIVE_SEP.length) };
  return { providerId: k, modelId: '' };
}

function normModels(raw, prev) {
  if (!Array.isArray(raw)) return modelList(prev);
  // 先过滤掉非对象项再计数：否则 20 个合法模型 + 1 条垃圾会被误报超限，
  // 而垃圾项还会参与 id 序号计算。raw 有内容但全部非法时直接报错，不静默存空清单。
  const accepted = raw.filter(m => m && typeof m === 'object');
  if (raw.length && !accepted.length) throw new Error('没有有效的模型数据');
  if (accepted.length > MAX_MODELS_PER_PROVIDER) {
    throw new Error('单个服务商下最多 ' + MAX_MODELS_PER_PROVIDER + ' 个模型');
  }
  const seen = new Set();
  return accepted.map((m, i) => {
    let id = s(m.id, 60) || stableModelId(m, i);
    if (seen.has(id)) id = id + '-' + i;
    seen.add(id);
    const model = s(m.model, 120);
    return {
      id,
      name: s(m.name, 80) || model || id,
      model,
      type: normType(m.type)
    };
  });
}

// 保存入口：incoming 是前端提交的完整清单；oldList 是库里已有清单。
// 语义是 full-replace：incoming 中未出现的旧服务商会被移除；这是前端「整表提交」的既有约定。
// 只保留白名单字段，绝不把前端传来的其它键写进数据库。
function mergeProviders(oldList, incoming) {
  const old = asList(oldList);
  const src = asList(incoming);
  if (src.length > MAX_PROVIDERS) throw new Error('服务商数量超过上限（' + MAX_PROVIDERS + '）');
  const byId = new Map(old.filter(p => p && p.id).map(p => [String(p.id), p]));
  const out = [];
  const seen = new Set();
  for (const raw of src) {
    if (!raw || typeof raw !== 'object') continue;
    const id = s(raw.id, 60);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const prev = byId.get(id) || {};
    const rawKey = s(raw.apiKey, 300);
    let apiKey;
    if (rawKey === CLEAR_SENTINEL) apiKey = '';
    else if (rawKey) apiKey = rawKey;
    else apiKey = s(prev.apiKey, 300); // 留空 = 不修改（前端不回显密钥）
    const models = normModels(raw.models, prev);
    out.push({
      id,
      preset: s(raw.preset, 40) || s(prev.preset, 40) || 'custom',
      name: s(raw.name, 60) || s(prev.name, 60) || id,
      baseUrl: s(raw.baseUrl, 300) || s(prev.baseUrl, 300),
      apiKey,
      models,
      model: models.length ? models[0].model : '' // 兼容快照：回退到旧前端时仍能显示
    });
  }
  // 提交了内容却一条都没通过校验（全无效/重复 id）时拒绝保存，避免 COALESCE 把用户清单静默清空
  if (src.length && !out.length) throw new Error('没有有效的服务商数据，未修改原有清单');
  return out;
}

// 下发给前端的安全视图：字段名与存储一致，但 apiKey 换成 keySet。
function sanitizeProviders(list) {
  return asList(list).filter(p => p && p.id).map(p => ({
    id: s(p.id, 60),
    preset: s(p.preset, 40) || 'custom',
    name: s(p.name, 60) || s(p.id, 60),
    baseUrl: s(p.baseUrl, 300),
    model: s(p.model, 120),
    models: modelList(p),
    keySet: !!s(p.apiKey, 300)
  }));
}

// 校验「当前生效」的那一条模型。enabled=false 时直接走网关，不算错误。
function pickActive(list, activeKey, enabled, legacyRow) {
  const arr = asList(list);
  if (!enabled) return { ok: true, provider: null, channel: 'gateway' };
  const { providerId, modelId } = parseActive(activeKey);
  let p = arr.find(x => x && s(x.id, 60) === providerId);
  let fromLegacy = false;
  if (!p) {
    // 迁移未跑到 / 旧数据兜底：旧四列仍可用，保证老账号不突然失效
    const old = legacyProvider(legacyRow);
    if (old) { p = old; fromLegacy = true; }
  }
  if (!p) return { ok: false, provider: null, missing: ['还没有选择「当前使用」的模型'] };
  const models = modelList(p);
  const m = (modelId ? models.find(x => x.id === modelId) : models[0]) || null;
  const baseUrl = s(p.baseUrl, 300), apiKey = s(p.apiKey, 300);
  const model = m ? s(m.model, 120) : '';
  const missing = [];
  if (!baseUrl) missing.push('接口地址');
  if (!model) missing.push('模型名');
  if (!apiKey) missing.push('API Key');
  if (missing.length) return { ok: false, provider: p, missing };
  return {
    ok: true,
    provider: {
      id: s(p.id, 60), name: s(p.name, 60),
      // legacy 兜底不签发 'legacy::m1' 这类合成模型键（迁移完成后会失效）；
      // 只用固定的 'legacy' 厂商键，解析时自动取第一行，稳定且不会指向歧义模型。
      activeKey: fromLegacy ? s(p.id, 60) : activeKeyOf(p.id, m.id),
      baseUrl, model, apiKey,
      modelName: s(m.name, 80) || model, modelType: m.type,
      providerId: s(p.id, 60), modelId: m.id
    },
    channel: 'direct'
  };
}

module.exports = {
  MAX_PROVIDERS, MAX_MODELS_PER_PROVIDER, CLEAR_SENTINEL,
  ACTIVE_SEP, MODEL_TYPES, DEFAULT_TYPE,
  asList, modelList, legacyProvider, activeKeyOf, parseActive, normType,
  mergeProviders, sanitizeProviders, pickActive
};

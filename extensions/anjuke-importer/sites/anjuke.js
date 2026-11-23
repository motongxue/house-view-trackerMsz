/* sites/anjuke.js —— 安居客楼盘页适配器：两屏 Nuxt 数据 -> 统一字段字典。
 * 只负责「读页面」，不写字段清单、不生成 CSV、不做坐标归一化，全部交给 core.js。 */
(function (root, factory) {
  const CORE = (typeof module !== 'undefined' && module.exports)
    ? require('../core.js')
    : (root && root.HVT_CORE);
  const api = factory(CORE);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HVT_SITE_ANJUKE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  const id = 'anjuke';
  const name = '安居客';

  function match(url) {
    return /^https?:\/\/m\.anjuke\.com\/[^/]+\/loupan\/\d+/.test(String(url || ''));
  }

  /* 在页面主世界执行（由 background 用 chrome.scripting world:'MAIN' 注入）。
   * 函数体必须自包含：序列化后不引用任何闭包变量。 */
  function probeInPage() {
    try {
      const st = window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state.loupan;
      window.postMessage({
        __HVT__: 1, site: 'anjuke', url: window.location.href,
        nonce: window.__HVT_NONCE__,
        ok: !!st, data: st ? JSON.stringify(st) : null
      }, window.location.origin);
    } catch (e) {
      window.postMessage({ __HVT__: 1, site: 'anjuke', url: window.location.href,
        nonce: window.__HVT_NONCE__, ok: false, error: String(e) }, window.location.origin);
    }
  }

  function detailGroups(params) {
    const kv = {}, groups = [], permits = [];
    const list = C.get(params, 'detail.loupanDetail') || [];
    (Array.isArray(list) ? list : []).forEach(function (g) {
      const item = { title: C.safeText(g && g.title), rows: [] };
      let cur = null;
      ((g && g.rows) || []).forEach(function (r) {
        const d = (r && r.data) || {};
        if (!d.key) return;
        const k = C.safeText(d.key), v = C.safeText(d.value);
        if (!(k in kv)) kv[k] = v;
        item.rows.push([k, v]);
        if (item.title === '预售许可证') {
          if (k === '预售证号') { cur = { no: v, date: '', building: '' }; permits.push(cur); }
          else if (cur && k === '发证时间') cur.date = v;
          else if (cur && k === '绑定楼栋') cur.building = v;
        }
      });
      groups.push(item);
    });
    return { kv: kv, groups: groups, permits: permits };
  }

  function collectMedia(main) {
    const images = [], floorPlans = [], environment = [], links = { videos: [], vr: [], sand: [] };
    let linkItems = [];
    const tabAlbums = C.get(main, 'tabAlbums');
    (Array.isArray(tabAlbums) ? tabAlbums : []).forEach(function (t) { // F146
      const slug = C.get(t, 'category.slug') || '';
      const medias = Array.isArray(t && t.medias) ? t.medias : []; // F147
      const urls = medias.map(function (m) { return m && m.image_url; });
      const acts = medias.map(function (m) { return m && m.action_url; });
      if (slug === 'loupan') images.push.apply(images, urls);
      else if (slug === 'layout') floorPlans.push.apply(floorPlans, urls);
      else if (slug === 'sand_table') { environment.push.apply(environment, urls); links.sand.push.apply(links.sand, acts); }
      else if (slug === 'video' || slug === 'vr') {
        // 播放页是 HTML 不是 mp4：封面只做外链卡片封面，不再混进小区环境图，
        // 否则用户点开只看到一张静态图（「感觉是张图片，无法播放」）。
        medias.forEach(function (m, i) {
          const u = C.safeText(m && m.action_url);
          if (!/^https?:\/\//.test(u)) return;
          const kind = slug === 'vr' ? 'vr' : 'video';
          linkItems.push({
            kind: kind, url: u, cover: C.safeText(m && m.image_url),
            label: (kind === 'vr' ? '🌀 VR 看房' : '▶ 视频讲解') + (medias.length > 1 ? ' ' + (i + 1) : '')
          });
          (kind === 'vr' ? links.vr : links.videos).push(u);
        });
      }
      else environment.push.apply(environment, urls);
    });
    const seen = {};
    linkItems = linkItems.filter(function (x) { if (seen[x.url]) return false; seen[x.url] = 1; return true; });
    return {
      images: C.uniq(images), floorPlans: C.uniq(floorPlans), environment: C.uniq(environment),
      videos: [], // 安居客只给封面 + 播放页链接，没有 mp4 直链；塞进 <video src> 会加载失败
      linkItems: linkItems,
      links: { videos: C.uniq(links.videos), vr: C.uniq(links.vr), sand: C.uniq(links.sand) }
    };
  }

  function extract(saved, meta) {
    const main = saved.main || {}, params = saved.params || {};
    meta = meta || {};
    const info = C.get(params, 'detail.loupanInfo') || {};
    const basic = C.get(main, 'loupanPageBlockInfo.loupan_basic') || {};
    const g = detailGroups(params);
    const media = collectMedia(main);

    const title = C.safeText(info.loupan_name || C.get(basic, 'name.text'));
    const city = C.safeText(C.get(info, 'location.city.name') || main.loupanCity && main.loupanCity.name);
    const district = C.safeText(C.get(info, 'location.district.name') ||
      C.get(main, 'districtAndBlockInfo.district_evaluation.district_name'));
    const rawHouseList = C.get(main, 'loupanPageBlockInfo.house_combo.house.list');
    const houseList = Array.isArray(rawHouseList) ? rawHouseList : []; // F148
    const h0 = houseList[0] || {};
    const loan = g.kv['房贷计算'] || '';
    const downM = loan.match(/首付\s*([\d.]+)\s*万/), monthM = loan.match(/月供\s*([\d.]+)\s*元/);
    // 系统地图用高德坐标，优先取 params 的 gaode；只有主页面时退化到 surrounding（百度坐标）
    const gaode = C.get(info, 'geo_location_map.gaode') || {};
    const bd = C.get(main, 'loupanPageBlockInfo.surrounding.geo_location') || {};
    // F024：0 是合法坐标，用显式判空代替 ||，避免误切换坐标源
    const has = function (v) { return v !== null && v !== undefined && v !== ''; };
    const pick = function (a, b) { return has(a) ? a : (has(b) ? b : ''); };
    const lng = C.coordNum(pick(gaode.longitude, bd.longitude), false);
    const lat = C.coordNum(pick(gaode.latitude, bd.latitude), true);
    const coordSource = has(gaode.longitude) ? '高德' : (has(bd.longitude) ? '百度(未校准)' : '');
    const houseNumber = C.safeText(info.loupan_id || basic.id || meta.loupanId || meta.id);

    const fields = {
      'title': title,
      'location.province': C.provinceOf(city),
      'location.city': city,
      'location.district': district,
      'location.community': title,
      'location.address': C.safeText(C.get(info, 'location.address') || C.get(basic, 'address.text')),
      'attributes.layout': C.safeText(h0.alias || C.get(basic, 'room_range.text')),
      'attributes.area': C.firstNum(h0.area || C.get(basic, 'area_range.text')),
      'attributes.decoration': C.cleanMulti(g.kv['装修情况']),
      'attributes.parking': C.cleanMulti(g.kv['车位数']),
      'attributes.propertyFee': C.firstNum(C.cleanMulti(g.kv['物业管理费'])),
      'transaction.totalPrice': C.firstNum(C.get(basic, 'total_price.price.value') || info.min_total_price),
      'transaction.unitPrice': C.firstNum(C.get(basic, 'price.price.value')),
      'transaction.status': C.safeText(info.sale_status_name) || '在售',
      'transaction.sourcePlatform': '安居客',
      'transaction.houseNumber': houseNumber,
      'transaction.downPayment': downM ? parseFloat(downM[1]) : '',
      'transaction.monthlyPayment': monthM ? parseFloat(monthM[1]) : '',
      'geo.lng': lng,
      'geo.lat': lat
    };

    // 备注：所有没进结构化字段的信息都留在这里，避免丢数据（内容/顺序与旧版逐字一致）
    const lines = [];
    lines.push('【来源】安居客 ' + C.safeText(meta.sourceUrl) + '（楼盘ID ' + houseNumber + '）');
    if (coordSource) lines.push('【坐标】' + coordSource + ' ' + lng + ',' + lat);
    // F149：tags_all 与 basic.tags 两个分支都必须是数组
    const rawTags = info.tags_all;
    const tags = Array.isArray(rawTags) ? rawTags
      : (Array.isArray(basic.tags) ? basic.tags.map(function (t) { return t && t.text; }) : []);
    if (tags.length) lines.push('【标签】' + tags.filter(Boolean).join('、'));
    if (houseList.length) {
      lines.push('【主力户型】' + houseList.slice(0, 6).map(function (h) {
        return [h && h.alias, h && h.area, h && h.price_value ? (h.price_value + '万') : ''].filter(Boolean).join(' ');
      }).join(' / '));
    }
    g.groups.forEach(function (grp) {
      if (grp.title === '预售许可证') return;
      if (!grp.rows.length) return;
      lines.push('【' + grp.title + '】' + grp.rows.map(function (r) { return r[0] + '：' + r[1]; }).join('；'));
    });
    if (g.permits.length) {
      lines.push('【预售许可证】共 ' + g.permits.length + ' 条，最近：' +
        g.permits.slice(0, 3).map(function (p) { return p.no + '(' + p.date + ')'; }).join('；'));
    }
    if (media.links.videos.length || media.links.vr.length || media.links.sand.length) {
      lines.push('【视频/VR/沙盘】' + media.links.videos.concat(media.links.vr, media.links.sand).slice(0, 6).join(' '));
    }
    lines.push('【媒体】楼盘图 ' + media.images.length + ' 张、户型图 ' + media.floorPlans.length + ' 张、区位/沙盘 ' +
      media.environment.length + ' 张、视频 ' + media.links.videos.length + ' 个、VR ' + media.links.vr.length +
      ' 个（视频 / VR 在「多媒体」里以卡片展示，点击可在原站打开播放）');
    lines.push('【页面未提供】朝向、楼层、建成年代、地铁、中介、税费、产权、贷款方式等需看房后补录');

    return {
      fields: fields,
      media: { images: media.images, videos: media.videos, floorPlans: media.floorPlans, environment: media.environment, links: media.linkItems },
      notesLines: lines,
      geoSystem: '',               // 安居客优先取高德坐标，不做坐标系转换
      geoSourceLabel: '',
      name: title,
      hasMain: !!basic.name,
      hasParams: !!info.loupan_name,
      singlePage: false,           // 主屏 + 「更多信息」两屏合并
      extras: {
        links: media.links,
        permitsData: g.permits,
        groups: g.groups,
        coordSource: coordSource,
        detailGroups: g.groups.length,
        permits: g.permits.length
      }
    };
  }

  return { id: id, name: name, match: match, probeInPage: probeInPage, extract: extract };
});

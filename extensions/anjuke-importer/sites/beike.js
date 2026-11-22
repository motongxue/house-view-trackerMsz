/* sites/beike.js —— 贝壳二手房详情页适配器：window.GLOBAL_INFOS + 服务端渲染 DOM -> 统一字段字典。
 * 贝壳详情页是单页全字段（不像安居客要「更多信息」第二屏），一次采集即可。
 * 只负责「读页面」；字段清单、CSV、归一化、坐标系转换全部交给 core.js。
 */
(function (root, factory) {
  var CORE = (typeof module !== 'undefined' && module.exports)
    ? require('../core.js')
    : (root && root.HVT_CORE);
  var api = factory(CORE);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HVT_SITE_BEIKE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  var id = 'beike';
  var name = '贝壳';

  function match(url) {
    return /^https?:\/\/[a-z0-9-]+\.ke\.com\/ershoufang\/\d+\.html/.test(String(url || ''));
  }

  /* 在页面主世界执行（background 用 chrome.scripting world:'MAIN' 注入）。
   * 函数体必须自包含：经 executeScript 序列化后不引用任何闭包变量。 */
  function probeInPage() {
    try {
      var g = window.GLOBAL_INFOS || {};
      var T = function (n) { return ((n && n.textContent) || '').replace(/\s+/g, ' ').trim(); };
      var Q = function (sel) { return T(document.querySelector(sel)); };
      var QA = function (sel) {
        return Array.prototype.slice.call(document.querySelectorAll(sel)).map(T).filter(Boolean);
      };
      // 基本属性 / 交易属性：[label, 值] 成对取回，提示按钮等噪声由 extract 清洗
      var pairs = function (sel) {
        return Array.prototype.slice.call(document.querySelectorAll(sel)).map(function (li) {
          var lab = li.querySelector('.label');
          var k = T(lab);
          var v = T(li);
          if (k && v.indexOf(k) === 0) v = v.slice(k.length).trim();
          return [k, v];
        }).filter(function (p) { return p[0]; });
      };
      var attrs = Array.prototype.slice.call(
        document.querySelectorAll('.introContent.showbasemore .baseattribute')).map(function (d) {
        return [T(d.querySelector('.name')), T(d.querySelector('.content'))];
      });
      var imgs = (Array.isArray(g.images) ? g.images : []).map(function (im) {
        return { type: (im && im.type) || '', uri: (im && im.uri) || '', url: (im && im.url) || '' };
      });
      if (!imgs.length) {
        imgs = Array.prototype.slice.call(document.querySelectorAll('#thumbnail2 .smallpic li')).map(function (li) {
          return {
            type: li.getAttribute('data-desc') || '',
            uri: li.getAttribute('data-uri') || li.getAttribute('data-src') || '',
            url: li.getAttribute('data-pic') || li.getAttribute('data-src') || ''
          };
        });
      }
      var agents = (Array.isArray(g.agentList) ? g.agentList : []).map(function (a) {
        return { name: (a && a.name) || '', brand: (a && a.brand) || '', phone400: (a && a.phone400) || '' };
      });
      var vrNode = document.querySelector('[data-vr]');
      // VR 封面优先取 [data-vr] 容器里的 img（贝壳是 vrlab 截图），取不到再兜底扫全页 / 用第一张房源图
      var vrCover = '';
      if (vrNode) {
        var vImg = String(vrNode.tagName).toUpperCase() === 'IMG' ? vrNode : vrNode.querySelector('img');
        if (vImg) vrCover = vImg.getAttribute('src') || vImg.getAttribute('data-src') || '';
      }
      if (!vrCover) {
        var allImgs = Array.prototype.slice.call(document.querySelectorAll('img'));
        for (var vi = 0; vi < allImgs.length; vi++) {
          var vs = allImgs[vi].getAttribute('src') || allImgs[vi].getAttribute('data-src') || '';
          if (/vrlab-image|realsee|pano|vr-cover/i.test(vs)) { vrCover = vs; break; }
        }
      }
      var data = {
        g: {
          houseCode: String(g.houseCode || g.houseId || ''),
          totalPrice: String(g.totalPrice || ''),
          price: String(g.price || ''),
          area: String(g.area || ''),
          resblockName: String(g.resblockName || ''),
          resblockId: String(g.resblockId || ''),
          resblockPosition: String(g.resblockPosition || ''),
          status: String(g.status || ''),
          title: String(g.title || ''),
          cityId: String(g.cityId || '')
        },
        cityName: String((window.ljConf && window.ljConf.city_name) || ''),
        title: Q('h1.main'),
        sub: Q('.detailHeader .sub'),
        priceTotal: Q('.price .total'),
        priceUnit: Q('.unitPriceValue'),
        room: Q('.houseInfo .room .mainInfo'),
        roomSub: Q('.houseInfo .room .subInfo'),
        orient: Q('.houseInfo .type .mainInfo'),
        orientSub: Q('.houseInfo .type .subInfo'),
        areaMain: Q('.houseInfo .area .mainInfo'),
        areaSub: Q('.houseInfo .area .subInfo'),
        community: Q('.aroundInfo .communityName .info'),
        areaName: Q('.aroundInfo .areaName .info'),
        visitTime: Q('.aroundInfo .visitTime .info'),
        houseRecord: Q('.aroundInfo .houseRecord .info'),
        breadcrumbLinks: QA('.intro .l-txt a'),
        base: pairs('.introContent .base li'),
        transaction: pairs('.introContent .transaction li'),
        tags: QA('.introContent.showbasemore .tags .tag'),
        attrs: attrs,
        resblockText: Q('#resblockCardContainer'),
        broker: {
          name: Q('.brokerInfo .ke-agent-sj-name'),
          brand: Q('.brokerInfo .ke-agent-sj-tag'),
          phone: Q('.brokerInfo .ke-agent-sj-phone')
        },
        imgs: imgs,
        agents: agents,
        vr: vrNode ? (vrNode.getAttribute('data-vr') || '') : '',
        vrCover: vrCover
      };
      window.postMessage({
        __HVT__: 1, site: 'beike', url: window.location.href,
        id: data.g.houseCode, ok: !!(data.g.houseCode || data.title),
        data: JSON.stringify(data)
      }, '*');
    } catch (e) {
      window.postMessage({ __HVT__: 1, site: 'beike', url: window.location.href, ok: false, error: String(e) }, '*');
    }
  }

  // ---------- 纯解析（Node 测试可直接调用 extract，不需要浏览器） ----------
  function pairMap(list, cleaner) {
    var out = {};
    (list || []).forEach(function (p) {
      var k = C.safeText(p && p[0]);
      if (!k) return;
      var v = C.safeText(p && p[1]);
      if (typeof cleaner === 'function') v = cleaner(k, v);
      if (v) out[k] = v;
    });
    return out;
  }
  function stripSuffix(s) {
    return C.safeText(s).replace(/(二手房|房产)$/, '').trim();
  }
  function unescapeAgentPhone(p) {
    return C.safeText(p).replace(/(\d{10,})-(\d+)/, '$1 转 $2');
  }

  function extract(saved, meta) {
    var d = saved.page || saved.data || {};
    meta = meta || {};
    var g = d.g || {};
    var base = pairMap(d.base, function (k, v) {
      // 「中楼层 (共41层) 咨询楼层」「暂无数据 实际层高需现场测量…」等按钮/提示文本要去掉
      return v.replace(/\s*咨询楼层.*$/, '')
        .replace(/\s*实际层高需现场测量.*$/, '')
        .trim();
    });
    var tran = pairMap(d.transaction);
    var attrs = pairMap(d.attrs);
    var rbText = C.safeText(d.resblockText || '').replace(/\s+/g, ' ');
    var rb = {
      avg: (rbText.match(/小区均价\s*([\d.]+)/) || [])[1] || '',
      year: (rbText.match(/建筑年代\s*([^\s]+)/) || [])[1] || '',
      buildings: (rbText.match(/楼栋总数\s*(\d+)/) || [])[1] || '',
      type: (rbText.match(/建筑类型\s*([^\s]+)/) || [])[1] || ''
    };

    var links = C.safeText(d.breadcrumbLinks && d.breadcrumbLinks[0]);
    var city = C.safeText(d.cityName) || stripSuffix(links) ||
      stripSuffix(d.breadcrumbLinks && d.breadcrumbLinks[1]);
    var district = stripSuffix(d.breadcrumbLinks && d.breadcrumbLinks[2]) ||
      C.safeText(d.areaName).split(/\s+/)[0];
    var bizcircle = stripSuffix(d.breadcrumbLinks && d.breadcrumbLinks[3]) ||
      C.safeText(d.areaName).split(/\s+/)[1] || '';

    // 交通出行里「13号线龙华寺站800米」-> 站点 + 距离（只取明确带米数的那段）
    var traffic = attrs['交通出行'] || '';
    var metro = String(traffic).match(/(\d+)\s*号线\s*([^\s，,。;；]+?站)\s*(\d+)\s*米/);
    var station = metro ? metro[2] + '(' + metro[1] + '号线)' : '';
    var metroDistance = metro ? Number(metro[3]) : '';

    var pos = C.safeText(g.resblockPosition).split(',');
    var lngRaw = pos[0] || '', latRaw = pos[1] || '';
    var houseNumber = C.safeText(g.houseCode) || C.safeText(g.resblockId) || C.safeText(meta.id);
    var broker = d.broker || {};
    var agent0 = (d.agents || [])[0] || {};
    var agentName = C.safeText(broker.name) || C.safeText(agent0.name);
    var agentBrand = C.safeText(broker.brand) || C.safeText(agent0.brand);
    var agentPhone = C.safeText(broker.phone) || unescapeAgentPhone(agent0.phone400);

    var title = C.safeText(d.title) || (C.safeText(g.resblockName) + ' ' + C.safeText(d.room) + ' ' + C.safeText(d.orient)).trim();
    var community = C.safeText(d.community) || C.safeText(g.resblockName);
    var totalPrice = C.firstNum(g.totalPrice || d.priceTotal);
    var unitPrice = C.firstNum(g.price || d.priceUnit);

    var fields = {
      'title': title,
      'location.province': C.provinceOf(city),
      'location.city': city,
      'location.district': district,
      'location.community': community,
      'location.subwayStation': station,
      'location.subwayDistance': metroDistance,
      'attributes.layout': C.safeText(base['房屋户型']) || C.safeText(d.room),
      'attributes.area': C.firstNum(base['建筑面积'] || g.area || d.areaMain),
      'attributes.orientation': C.safeText(base['房屋朝向']) || C.safeText(d.orient),
      'attributes.floor': C.safeText(base['所在楼层']) || C.safeText(d.roomSub),
      'attributes.builtYear': rb.year,
      'attributes.decoration': C.safeText(base['装修情况']),
      'attributes.elevator': C.safeText(base['配备电梯']),
      'attributes.propertyType': C.safeText(tran['交易权属']),
      'transaction.totalPrice': totalPrice,
      'transaction.unitPrice': unitPrice,
      'transaction.status': g.status === '0' ? '已下架' : '在售',
      'transaction.sourcePlatform': '贝壳',
      'transaction.houseNumber': houseNumber,
      'transaction.ownership': [
        tran['产权所属'], tran['房屋年限'], tran['抵押信息']
      ].filter(Boolean).map(C.safeText).join('；'),
      'transaction.agentName': agentName,
      'transaction.agentPhone': agentPhone,
      'geo.lng': C.coordNum(lngRaw),
      'geo.lat': C.coordNum(latRaw)
    };

    // 图片：贝壳只给房源实拍 + 户型图，没有 mp4 直链；VR 是 realsee 播放页，只进备注
    var images = [], floorPlans = [];
    (d.imgs || []).forEach(function (im) {
      var u = C.safeText(im && (im.uri || im.url));
      if (!/^https?:\/\//.test(u)) return;
      if (C.safeText(im && im.type) === '户型图') floorPlans.push(u);
      else images.push(u);
    });
    images = C.uniq(images); floorPlans = C.uniq(floorPlans);
    var vr = C.safeText(d.vr);
    // VR 是 realsee 播放页（不是 mp4），做成可点击的外链卡片；贝壳页面没有视频直链
    var linkItems = vr ? [{
      kind: 'vr', url: vr,
      cover: C.safeText(d.vrCover) || images[0] || '',
      label: '🌀 VR 看房'
    }] : [];

    // 备注按用户确认的「精简摘要」口径：只留核对要点，不把小区介绍/周边配套/带看全文塞进来
    var lines = [];
    lines.push('【来源】贝壳 ' + C.safeText(meta.sourceUrl) + '（房源编号 ' + houseNumber + '）');
    if (d.sub) lines.push('【卖点】' + C.safeText(d.sub));
    if ((d.tags || []).length) lines.push('【标签】' + d.tags.map(C.safeText).filter(Boolean).join('、'));
    var rights = [
      ['挂牌', tran['挂牌时间']], ['上次交易', tran['上次交易']], ['房屋年限', tran['房屋年限']],
      ['产权所属', tran['产权所属']], ['抵押', tran['抵押信息']], ['房屋用途', tran['房屋用途']],
      ['核验码', tran['房源核验码']]
    ].filter(function (p) { return p[1]; }).map(function (p) { return p[0] + ' ' + p[1]; });
    if (rights.length) lines.push('【产权】' + rights.join('；'));
    var houseBits = [
      ['套内面积', base['套内面积']], ['梯户比', base['梯户比例']], ['建筑结构', base['建筑结构']],
      ['建筑类型', base['建筑类型'] || rb.type], ['商圈', bizcircle]
    ].filter(function (p) { return p[1]; }).map(function (p) { return p[0] + ' ' + p[1]; });
    if (houseBits.length) lines.push('【房屋】' + houseBits.join('；'));
    var rbBits = [];
    if (rb.avg) rbBits.push('均价 ' + rb.avg + ' 元/㎡');
    if (rb.year) rbBits.push('年代 ' + rb.year);
    if (rb.buildings) rbBits.push('楼栋 ' + rb.buildings + ' 栋');
    if (rbBits.length) lines.push('【小区】' + rbBits.join('；'));
    if (station) lines.push('【交通】' + station + ' 约 ' + metroDistance + ' 米（页面描述，供参考）');
    if (agentBrand) lines.push('【中介】' + agentBrand + (agentName ? ' · ' + agentName : '') + (agentPhone ? ' · ' + agentPhone + '（400 虚拟号）' : ''));
    if (lngRaw && latRaw) lines.push('【坐标】贝壳百度坐标 ' + lngRaw + ',' + latRaw + ' 已转换为高德 GCJ02');
    if (vr) lines.push('【VR】' + vr);
    lines.push('【媒体】房源图 ' + images.length + ' 张、户型图 ' + floorPlans.length + ' 张、VR ' + linkItems.length +
      ' 个（贝壳缩略图外链，已按平台图片指令转换；VR 在「多媒体」里以卡片展示，点击可在原站打开；页面未提供 mp4 视频直链）');
    lines.push('【页面未提供】门牌地址、车位、物业费、税费/首付/月供、贷款方式、微信、看房日期，需看房后补录');

    return {
      fields: fields,
      media: { images: images, videos: [], floorPlans: floorPlans, environment: [], links: linkItems },
      notesLines: lines,
      geoSystem: 'BD09',              // 贝壳 resblockPosition 用于百度地图，转高德 GCJ02
      geoSourceLabel: '贝壳(百度→高德)',
      name: title,
      hasMain: true,
      hasParams: true,
      singlePage: true,               // 单页一次采全，不需要「更多信息」第二屏
      extras: {
        links: { videos: [], vr: vr ? [vr] : [], sand: [] },
        permitsData: [],
        groups: [],
        coordSource: '贝壳(百度→高德)',
        detailGroups: 0,
        permits: 0
      }
    };
  }

  return { id: id, name: name, match: match, probeInPage: probeInPage, extract: extract };
});

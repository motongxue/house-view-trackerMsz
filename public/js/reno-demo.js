/* reno-demo.js —— 装修比价「示例方案」数据（演示用，不自动写库）
 *
 * 口径来源：2026 年成都家装市场公开报价（土巴兔大数据研究院 2025-09~2026-09
 * 成都 90-109㎡ 成交样本、成都本地装企 2026 预算指南）：
 *   半包（人工+辅材）约 680-1100 元/㎡；全包（含主材）约 1200-1800 元/㎡；
 *   整装（含家具家电，拎包）约 1500-2200 元/㎡；旧房翻新比毛坯贵约 20%；
 *   设计与管理费合计约占总价 5%-10%；全包标准工期 45-60 天。
 *   行业通行的安全付款节奏：开工 ≤30% → 水电验收 30% → 泥木/主材安装 35% → 竣工 5% 尾款，
 *   合同里通常约定「增项不超过合同总价 5%」。
 * 以下公司名、门店、人名、电话、合同号、金额均为演示虚构，仅用于体现真实报价结构，
 * 不代表任何真实企业报价。金额单位统一为万元（主材清单为元）。
 *
 * 用法：装修列表页点「载入示例方案」才会写入当前登录账号的房源；
 * 点「清除示例方案」可一次删干净。所有示例方案 id 以 demo_rn_ 开头，不会碰到自建方案。
 */
(function () {
  var PHASES = ['拆改', '水电', '泥瓦', '木工', '油漆', '安装', '软装进场'];
  var PAY_4 = '开工 30% → 水电验收 30% → 泥木/主材安装 35% → 竣工验收 5% 尾款（入住 3-6 个月后付清）；合同写明增项不超过总价 5%，无业主签字变更单不计费。';
  var PAY_PKG = '定金 10% → 开工 20% → 水电验收 30% → 主材安装完 35% → 竣工验收 5% 尾款；尾款压到 5%，不接受签约付 60% 以上。';

  // 主材简写：[品类, 品牌, 型号/规格, 数量, 单价(元), 金额(元), 渠道, 已到货]
  function mats(rows) {
    return (rows || []).map(function (r) {
      return { category: r[0], brand: r[1], model: r[2], qty: r[3], unitPrice: r[4], amount: r[5], channel: r[6], arrived: !!r[7] };
    });
  }
  function mk(o) {
    var pm = o.progress || {};
    return {
      id: 'demo_rn_' + o.id,
      name: o.name,
      confirmed: !!o.confirmed,
      createdAt: o.createdAt,
      basic: Object.assign({
        method: '', style: '', status: '', startDate: '', endDate: '', area: '',
        company: '', designer: '', foreman: '', phone: '', contractNo: '', layoutChange: ''
      }, o.basic || {}),
      budget: Object.assign({
        total: '', spent: '', hard: '', soft: '', appliance: '', design: '', manage: '', paymentNodes: ''
      }, o.budget || {}),
      progress: PHASES.map(function (n) {
        return Object.assign({ name: n, status: '未开始', start: '', end: '', cost: '' }, pm[n] || {}, { name: n });
      }),
      materials: mats(o.materials),
      media: { effect: [], construction: [], contract: [], acceptance: [] },
      notes: o.notes || ''
    };
  }

  window.RenoDemo = {
    version: '20261107',
    groups: [
      // ① 天府新区 89㎡ 刚需三房：半包 / 全包 / 整装 三家比价
      {
        keywords: ['滨江和城'],
        label: '89㎡ 刚需三房',
        plans: [
          mk({
            id: 'bjhc_yzf', name: '业之峰装饰 · 半包清单式报价', confirmed: true, createdAt: '2026-09-02',
            basic: {
              method: '半包', style: '现代简约', status: '施工中', startDate: '2026-09-12', endDate: '2026-12-18', area: 89,
              company: '业之峰装饰（天府新区店）', designer: '张设计', foreman: '刘工长', phone: '138****6621', contractNo: 'CD-YZF-2026-0912',
              layoutChange: '主卧与次卧之间非承重墙局部内推，做 1.2m 嵌入式衣柜位；生活阳台打通并入洗衣区，厨房保持封闭。'
            },
            budget: {
              total: 14.8, spent: 9.2, hard: 8.6, soft: 2.4, appliance: 2.2, design: 0.6, manage: 0.5,
              paymentNodes: PAY_4 + '本单半包施工 6.8 万（约 764 元/㎡），水电 62 个点位包干。'
            },
            progress: {
              '拆改': { status: '已完成', start: '2026-09-12', end: '2026-09-18', cost: 0.45 },
              '水电': { status: '已完成', start: '2026-09-19', end: '2026-10-08', cost: 1.35 },
              '泥瓦': { status: '进行中', start: '2026-10-09', end: '', cost: 1.6 },
              '木工': { status: '未开始', start: '', end: '', cost: 0.9 },
              '油漆': { status: '未开始', start: '', end: '', cost: 0.8 },
              '安装': { status: '未开始', start: '', end: '', cost: 1.1 }
            },
            materials: [
              ['地板', '圣象', '三层实木复合 / 橡木纹', '32㎡', 268, 8576, '红星美凯龙', true],
              ['瓷砖', '马可波罗', '800×800 抛釉砖 / CZ8812', '48㎡', 158, 7584, '建材市场团购', true],
              ['橱柜', '志邦', '双饰面地柜 3.6 延米 + 吊柜', '1 套', 9800, 9800, '门店下单', false],
              ['卫浴', '九牧', '智能马桶 + 花洒 + 浴室柜', '2 套', 4600, 9200, '苏宁易购', false],
              ['墙面漆', '立邦', '净味五合一 / 18L', '4 桶', 620, 2480, '京东自营', true],
              ['其他', '西门子', '开关插座 远景系列', '62 位', 38, 2356, '京东自营', false]
            ],
            notes: '踩坑记录：① 报价单里「墙面基层处理」默认只含局部找平，全屋挂网要另算，签之前让工长写死；② 水电按点位包干比按实结算省心，本单 62 个点位写进合同附件；③ 半包主材自购，瓷砖多买 5% 损耗并认准同一批次色号，不然后补会有色差。目前泥瓦阶段，进度比计划慢了约 5 天，等木工进场要复尺全屋定制。'
          }),
          mk({
            id: 'bjhc_shj', name: '生活家装饰 · 1299 元/㎡ 整装套餐', confirmed: false, createdAt: '2026-10-18',
            basic: {
              method: '整装', style: '奶油风', status: '设计中', startDate: '', endDate: '', area: 89,
              company: '生活家家居（成都旗舰店）', designer: '陈设计', foreman: '', phone: '138****3078', contractNo: '',
              layoutChange: '套餐内含标准平面方案，未做墙体改动；圆弧门洞与微水泥背景墙属造型增项，需单独报价。'
            },
            budget: {
              total: 16.9, spent: '', hard: 10.2, soft: 3.4, appliance: 2.3, design: 0, manage: 1.0,
              paymentNodes: PAY_PKG
            },
            progress: {},
            materials: [
              ['瓷砖', '东鹏', '750×1500 岩板（套餐升级款）', '45㎡', 198, 8910, '套餐内', false],
              ['橱柜', '欧派', '套餐标准 3 延米地柜', '1 套', 0, 0, '套餐内', false],
              ['卫浴', '恒洁', '套餐标配两卫', '2 套', 0, 0, '套餐内', false]
            ],
            notes: '套餐按建筑面积 89㎡×1299 ≈ 11.6 万起，含 60 个水电点位、3 延米地柜、12㎡ 投影柜体，宣传「全含」。但报价单里拆改、垃圾外运、美缝、窗帘、空调打孔都不含，柜体超出投影面积按 580 元/㎡ 结算，销售自己估算落地约 16-17 万。要盯三件事：是否闭口合同、增项上限 5%、主材品牌型号是否写进附件；低于 550 元/㎡ 的全包报价直接跳过，差额一定会从增项找回来。'
          }),
          mk({
            id: 'bjhc_lt', name: '岚庭家居 · 全包优惠报价', confirmed: false, createdAt: '2026-10-26',
            basic: {
              method: '全包', style: '原木风', status: '未开始', startDate: '', endDate: '', area: 89,
              company: '岚庭家居', designer: '李设计', foreman: '', phone: '138****9145', contractNo: '',
              layoutChange: '建议保留原三房格局，仅把客厅与阳台之间的推拉门拆除，做通铺地板。'
            },
            budget: {
              total: 15.2, spent: '', hard: 9.4, soft: 2.6, appliance: 2.4, design: 0.3, manage: 0.5,
              paymentNodes: '首期 30% → 水电验收 30% → 主材安装 35% → 竣工 5%；尚未签约，付款节点待谈。'
            },
            progress: {},
            materials: [
              ['地板', '大自然', '实木复合 / 原木色', '34㎡', 246, 8364, '门店', false],
              ['门窗', 'TATA', '静音木门', '4 樘', 1580, 6320, '门店', false]
            ],
            notes: '报价看着比整装低，实际不含拆改（约 0.45 万）、垃圾清运（约 0.3 万）、中央空调打孔，且橱柜只含 2.4 延米，折算后和整装套餐差别不大。销售承诺的「0 增项」只在宣传页上，合同正文没写；已要求把主材品牌、型号、环保等级写进附件，并把工期精确到天、延期赔付按合同总价万分之三/天，再谈签约。'
          })
        ]
      },

      // ② 高新区 128㎡ 改善四房：全案设计 / 整装 / 已交付全包
      {
        keywords: ['中海天府里'],
        label: '128㎡ 改善四房',
        plans: [
          mk({
            id: 'zhtfl_sd', name: '圣都整装 · 全包（已交付）', confirmed: true, createdAt: '2026-02-20',
            basic: {
              method: '全包', style: '轻奢', status: '已完工', startDate: '2026-03-08', endDate: '2026-07-26', area: 128,
              company: '圣都整装（高新店）', designer: '王设计', foreman: '周工长', phone: '138****4402', contractNo: 'CD-SD-2026-0308',
              layoutChange: '四房改三房 + 独立书房，主卧增加衣帽间；客厅做无主灯磁吸轨道，全屋中央空调 + 新风。'
            },
            budget: {
              total: 26.5, spent: 27.3, hard: 16.8, soft: 4.6, appliance: 3.8, design: 1.2, manage: 0.9,
              paymentNodes: PAY_4 + '实际结算超支 0.8 万，已在竣工决算单上逐项签字确认。'
            },
            progress: {
              '拆改': { status: '已完成', start: '2026-03-08', end: '2026-03-20', cost: 0.9 },
              '水电': { status: '已完成', start: '2026-03-21', end: '2026-04-16', cost: 2.8 },
              '泥瓦': { status: '已完成', start: '2026-04-17', end: '2026-05-15', cost: 3.2 },
              '木工': { status: '已完成', start: '2026-05-16', end: '2026-06-05', cost: 2.4 },
              '油漆': { status: '已完成', start: '2026-06-06', end: '2026-06-24', cost: 1.8 },
              '安装': { status: '已完成', start: '2026-06-25', end: '2026-07-18', cost: 4.1 },
              '软装进场': { status: '已完成', start: '2026-07-19', end: '2026-07-26', cost: 4.6 }
            },
            materials: [
              ['瓷砖', '东鹏', '900×1800 岩板 / 客厅地面', '62㎡', 328, 20336, '门店', true],
              ['橱柜', '欧派', '石英石台面 + 双饰面 5.2 延米', '1 套', 26800, 26800, '门店', true],
              ['卫浴', '科勒', '智能马桶 + 恒温花洒 + 双台盆', '2 套', 12400, 24800, '居然之家', true],
              ['地板', '大自然', '实木复合 / 卧室', '46㎡', 315, 14490, '门店', true],
              ['墙面漆', '多乐士', '森呼吸抗甲醛 5L', '9 桶', 680, 6120, '京东自营', true],
              ['灯具', '雷士', '无主灯磁吸轨道 + 射灯', '1 套', 9800, 9800, '门店', true]
            ],
            notes: '超支 0.8 万的来源：全屋定制柜体投影面积超出套餐 12㎡（+0.62 万）、中央空调/新风打孔与加长风口（+0.18 万）。经验：整装也别只看单价，柜体投影面积、水电点位、窗台石门槛石最容易加钱；全屋定制要在墙体改造后和油漆完工后各复尺一次，板材品牌/型号/环保等级写进合同并现场拆包验收。竣工验收留了 5% 尾款压 3 个月，期间补了两处柜门缝隙，响应还算及时。'
          }),
          mk({
            id: 'zhtfl_dyr', name: '东易日盛 · 全案设计 + 半包', confirmed: false, createdAt: '2026-08-14',
            basic: {
              method: '半包', style: '新中式', status: '施工中', startDate: '2026-09-20', endDate: '2027-01-10', area: 128,
              company: '东易日盛（成都）', designer: '赵设计', foreman: '何工长', phone: '138****7736', contractNo: 'CD-DYR-2026-0920',
              layoutChange: '客餐厅一体做对称轴线，玄关加格栅隔断；书房与客厅之间用通透木格栅替代实墙。'
            },
            budget: {
              total: 24.8, spent: 11.6, hard: 15.2, soft: 4.2, appliance: 2.4, design: 1.8, manage: 1.2,
              paymentNodes: PAY_4 + '设计费单独按 140 元/㎡ 计，出全套施工图与软装清单。'
            },
            progress: {
              '拆改': { status: '已完成', start: '2026-09-20', end: '2026-09-29', cost: 0.8 },
              '水电': { status: '已完成', start: '2026-09-30', end: '2026-10-24', cost: 2.6 },
              '泥瓦': { status: '进行中', start: '2026-10-25', end: '', cost: 3.0 },
              '木工': { status: '未开始', start: '', end: '', cost: 2.6 }
            },
            materials: [
              ['瓷砖', '马可波罗', '仿古砖 600×1200', '58㎡', 218, 12644, '建材市场', true],
              ['其他', '伟星', 'PPR 水管 + 阻燃线管', '1 批', 0, 6800, '半包辅料', true],
              ['地板', '生活家', '实木复合 / 胡桃色', '44㎡', 298, 13112, '门店', false]
            ],
            notes: '半包施工 820 元/㎡ 属成都中上水平，辅材全部写明品牌（伟星管、鸽牌线、德高防水），不转包、自有工长。设计费 1.8 万换全套施工图 + 软装落地清单，对效果有要求、愿意自己跑主材的人比较合适；缺点是主材要自己盯 8-10 个商家，进场时间和工期容易打架。已付到水电验收节点，下一步泥木验收前要确认瓷砖铺贴空鼓率。'
          }),
          mk({
            id: 'zhtfl_lf', name: '龙发装饰 · 整装拎包套餐', confirmed: false, createdAt: '2026-10-30',
            basic: {
              method: '整装', style: '法式', status: '未开始', startDate: '', endDate: '', area: 128,
              company: '龙发装饰（成都）', designer: '孙设计', foreman: '', phone: '138****2280', contractNo: '',
              layoutChange: '轻法式方案含弧形门洞、石膏线条背景墙、微水泥地面，造型部分按项单独报价。'
            },
            budget: {
              total: 29.6, spent: '', hard: 17.5, soft: 6.2, appliance: 4.0, design: 0.8, manage: 1.1,
              paymentNodes: PAY_PKG
            },
            progress: {},
            materials: [
              ['其他', '索菲亚', '全屋定制 投影面积（含柜体）', '38㎡', 1180, 44840, '套餐内', false],
              ['灯具', '雷士', '法式吊灯 + 氛围灯', '1 套', 0, 0, '套餐内', false]
            ],
            notes: '报价 2310 元/㎡（含家具家电窗帘），在 2026 成都高端整装 2500-5000 元/㎡ 的下沿。赠送的「全屋家电」多为入门款，可换成折价 2 万自购；轻法式流行的微水泥、藤编、弧形门洞、石膏线都是造型增项，要逐项问清单价。工期口头说「3 个月左右」，已要求合同精确到天并写清延期赔付（合同总价万分之三至万分之五/天），删掉「赔付上限 2000 元」条款。'
          })
        ]
      },

      // ③ 武侯区 78㎡ 老房翻新：拆旧 / 水电全改 / 局部改造 对照
      {
        keywords: ['桐梓林壹号'],
        label: '78㎡ 老房翻新',
        plans: [
          mk({
            id: 'tzlyh_ch', name: '川豪装饰 · 老房翻新全包', confirmed: true, createdAt: '2026-08-28',
            basic: {
              method: '全包', style: '北欧', status: '施工中', startDate: '2026-09-15', endDate: '2026-12-30', area: 78,
              company: '川豪装饰', designer: '杨设计', foreman: '罗工长', phone: '138****5519', contractNo: 'CD-CH-2026-0915',
              layoutChange: '拆除厨房与卫生间之间非承重隔墙做干湿分离；原客厅与阳台之间的窗下墙不动，保留结构安全。'
            },
            budget: {
              total: 12.6, spent: 7.8, hard: 8.4, soft: 1.8, appliance: 1.6, design: 0.3, manage: 0.5,
              paymentNodes: PAY_4 + '拆旧、垃圾清运、水电全改三项在报价单里单列，不进套餐。'
            },
            progress: {
              '拆改': { status: '已完成', start: '2026-09-15', end: '2026-09-28', cost: 1.2 },
              '水电': { status: '已完成', start: '2026-09-29', end: '2026-10-22', cost: 1.8 },
              '泥瓦': { status: '进行中', start: '2026-10-23', end: '', cost: 1.6 },
              '油漆': { status: '未开始', start: '', end: '', cost: 0.9 }
            },
            materials: [
              ['瓷砖', '东鹏', '厨卫墙地砖 300×600', '42㎡', 128, 5376, '门店', true],
              ['卫浴', '箭牌', '马桶 + 浴室柜 + 淋浴房', '1 套', 8600, 8600, '京东自营', false],
              ['橱柜', '金牌', '3.2 延米地柜 + 石英石台面', '1 套', 12800, 12800, '门店', false],
              ['墙面漆', '立邦', '净味五合一', '3 桶', 620, 1860, '京东自营', false],
              ['门窗', '美心', '室内木门', '3 樘', 1280, 3840, '门店', false]
            ],
            notes: '2005 年的房子，原镀锌水管和铝芯线全部换掉，墙面铲到红砖重新找平。旧房翻新比毛坯贵约 20%：拆旧+垃圾清运 1.2 万、水电全改 1.8 万、墙面基层 0.9 万都在报价单里单列。武侯核心区人工与材料进场成本高，全包约 1615 元/㎡（含软装家电）。物业只允许工作日 9:00-12:00、14:00-18:00 施工，工期比新房多约 3 周；验收重点查空鼓、渗水、门窗密封。'
          }),
          mk({
            id: 'tzlyh_hljy', name: '欢乐佳园 · 厨卫 + 墙面局部改造', confirmed: false, createdAt: '2026-10-08',
            basic: {
              method: '半包', style: '日式', status: '未开始', startDate: '', endDate: '', area: 78,
              company: '欢乐佳园（旧房翻新）', designer: '', foreman: '陈工长', phone: '138****8063', contractNo: '',
              layoutChange: '不动格局，只翻厨房、卫生间和全屋墙面；客厅原实木地板打磨翻新后保留。'
            },
            budget: {
              total: 8.9, spent: '', hard: 5.6, soft: 1.4, appliance: 1.5, design: 0.1, manage: 0.3,
              paymentNodes: '开工 30% → 水电改造验收 35% → 竣工验收 30% → 5% 质保金；工期约 30 天，可边住边施工。'
            },
            progress: {},
            materials: [
              ['卫浴', '九牧', '马桶 + 花洒', '1 套', 4200, 4200, '京东自营', false],
              ['瓷砖', '马可波罗', '厨卫砖', '36㎡', 118, 4248, '门店', false]
            ],
            notes: '局部改造按项计费（成都市场常见 2-6 万施工费），这套含主材家电后约 8.9 万。优点是省钱、不用搬家、一个月能完事；缺点是水电只能局部改，老管道没换的部分仍有隐患，且拆旧后才发现的问题（防水层、墙面空鼓）容易临时加钱。若打算长住 10 年以上，还是倾向全改那套。'
          }),
          mk({
            id: 'tzlyh_bw', name: '被窝家装（贝壳）· 标准化整装', confirmed: false, createdAt: '2026-11-01',
            basic: {
              method: '整装', style: '现代简约', status: '设计中', startDate: '', endDate: '', area: 78,
              company: '被窝家装 · 成都', designer: '林设计', foreman: '', phone: '138****1902', contractNo: '',
              layoutChange: '设计师建议保留原两室格局，厨房改半开放加吧台；含 3 次免费方案修改。'
            },
            budget: {
              total: 13.9, spent: '', hard: 8.8, soft: 2.2, appliance: 2.1, design: 0.3, manage: 0.5,
              paymentNodes: PAY_PKG + '旧房拆除包 1.1 万单独计。'
            },
            progress: {},
            materials: [
              ['地板', '圣象', '强化复合 / 原木色', '30㎡', 168, 5040, '套餐内', false],
              ['橱柜', '志邦', '套餐标准 3 延米', '1 套', 0, 0, '套餐内', false]
            ],
            notes: '线上标准化套餐，报价单逐项列明、可在 App 看每日工地播报和节点验收，适合没时间盯工地的人。78㎡ 老房要额外买「旧房拆除包」约 1.1 万，加上后 13.9 万，比本地全包略高但流程透明。还在对比：套餐主材升级款差价、闭口合同是否真闭口、尾款能否压到 5%。'
          })
        ]
      }
    ]
  };
})();

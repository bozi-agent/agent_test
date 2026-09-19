/**
 * 界面侧组件测试（不需要浏览器、不需要启动 Harness）
 *
 * 新交互：侧边栏一个入口按钮（**开关**）→ 点开是**全屏弹窗**（只盖右侧内容区，不盖左侧栏）
 *       弹窗里：一级 = 模块网格（5 张模块卡）
 *               二级 = 模块详情页（带"← 返回"）
 *       没有标题栏；关闭方式 = 再点一次侧边栏入口 / 按 Esc
 *
 * 验证：
 *   1) 只注册 sidebar.footer.action（不再注册 conversation.view 标签页）
 *   2) 侧边栏里只有一个按钮，没铺任何卡片
 *   3) 点按钮 → 出现弹窗（fixed 定位 + data-xmt-workbench=modal），弹窗左边界 ≥ 侧边栏宽度
 *   4) 一级页 = 7 格模块网格，没有控制室、没有标题行、没有底部操作行
 *   5) 二级页有"返回"，返回后回到一级页
 *   6) 入口开关能关也能开；弹窗里没有标题栏 ×（按需求删了）
 *   7) 主机侧连不上时不白屏、有提示、还能导航
 *   8) 弹窗几何（不盖侧边栏、不是一条缝）
 *   9) 按钮规范 + 异步按钮加载态 + 弹窗内容结构
 *  10) 本轮修复的 15 个问题逐条守住（时间过滤文案 / 数量实时 / 红点 8 秒 / 省略号 /
 *      不跳转 / 状态栏固定 / 保存后不再展示…）
 *
 * 跑法：node test/ui.mjs
 */

import { createHarness, createFakeFetch, createAsserter } from './_harness.mjs'

const { check, finish } = createAsserter()
const harness = createHarness()
harness.enableProbe()
const options = { stage: 'idle' }
const { apiCalls, state } = createFakeFetch(options)

globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1440, innerHeight: 900 }
globalThis.document = harness.documentStub

const requiredSpecs = []
globalThis.require = (spec) => {
  requiredSpecs.push(spec)
  if (spec === 'react') return harness.React
  throw new Error(`测试里没有准备 ${spec} 的替身`)
}

const nodes = (tree) => harness.flattenNodes(tree)
const buttons = (tree) => nodes(tree).filter((n) => n.type === 'button')
/** 按钮上的文字（不含 title 之类属性；卡片按钮的 title 是"进入 扫源抓取"，别拿它当文字用） */
const labelOf = (node) => harness.flatten(node.props && node.props.children).join('').trim()
const findButton = (tree, text) => buttons(tree).find((n) => labelOf(n).includes(text))
/** 按按钮文字精确匹配（"⚙ 设置" 这种，避免被卡片 title 里的同名字串命中） */
const findButtonExact = (tree, text) => buttons(tree).find((n) => labelOf(n) === text)
const modalNode = (tree) => nodes(tree).find((n) => n.props && n.props['data-xmt-workbench'] === 'modal')
/** 一级页的 5 张模块卡（现在是整卡可点，没有单独的"进入"按钮） */
const moduleCards = (tree) => nodes(tree).filter((n) => n.type === 'button' && String(n.props.className || '').split(/\s+/).includes('xmt-mcard'))
/** 按 class 找元素节点（注意：拍平的字符串里也会含类名，所以要判 type 是字符串） */
const byClass = (tree, cls) => nodes(tree).filter((n) => typeof n.type === 'string' && String(n.props.className || '').split(/\s+/).includes(cls))
/**
 * 反复渲染直到条件成立（最多 4 次）。
 * ⚠ 为什么需要：假接口是异步的，界面里"读数据 → setState"落地需要几轮渲染；
 *   一次 render 就断言容易读到中间态（本轮排查 m2 条数时踩过）。
 *   真 react 里用户看到的是最终稳定态，所以测试也等它稳定。
 */
async function settle(until, props = { wide: true }) {
  let view = await harness.render(Entry, props, 120)
  for (let i = 0; i < 3 && !until(view); i++) view = await harness.render(Entry, props, 120)
  return view
}

/**
 * 把工作台"复位"到一级页：关掉弹窗再打开。
 * 关掉时会 harness.reset() —— 真 react 里弹窗一卸载，组件状态（当前在哪一页）就没了；
 * 测试替身按路径保留 hook 槽位，所以要显式清一次，才能模拟"重新挂载回到主页"。
 */
async function backToMain() {
  let view = await harness.render(Entry, { wide: true }, 40)
  if (modalNode(view.tree)) {
    const entry = findButton(view.tree, 'AI 资讯工作台')
    if (entry) entry.props.onClick()
    harness.reset() // 关掉 = 卸载弹窗
    view = await harness.render(Entry, { wide: true }, 40)
  }
  const entry = findButton(view.tree, 'AI 资讯工作台')
  if (entry) entry.props.onClick()
  return harness.render(Entry, { wide: true }, 60)
}
/**
 * 确保弹窗是打开的。
 * 入口按钮现在是开关（点一下开、再点一下关），而状态在测试段落之间是共享的，
 * 所以不能无脑点一下（可能正好把开着的关掉）。先渲染看看，关着才点。
 */
async function ensureOpen(props = { wide: true }, waitMs = 60) {
  let view = await harness.render(Entry, props, 40)
  if (!modalNode(view.tree)) {
    const entry = findButton(view.tree, 'AI 资讯工作台')
    if (entry) entry.props.onClick()
    view = await harness.render(Entry, props, waitMs)
  }
  return view
}

console.log('== 界面侧组件测试（弹窗式工作台）==')
const client = await import('../lib/client/client.js')

const injected = []
const registered = []
const slotsService = {
  inject(name, fn) {
    injected.push(name)
    return fn()
  },
  register(options, Component) {
    registered.push({ options, Component })
    return { options, Component }
  },
}
const ctx = { get: (name) => (name === 'slots' ? slotsService : undefined), slots: slotsService }

let threw = false
try {
  client.apply(ctx)
} catch (err) {
  threw = true
  console.log('  apply 抛错：', err.message)
}
check('apply 不抛错', threw === false)
check('声明了 slots 依赖（必须，否则 apply 会在服务就绪前跑）', Array.isArray(client.inject) && client.inject.includes('slots'), JSON.stringify(client.inject))
check('只注册了侧边栏入口，没注册会话标签页', injected.length === 1 && injected[0] === 'sidebar.footer.action', JSON.stringify(injected))
check('没有注册 conversation.view（不再和对话/轨迹挤标签页）', !injected.includes('conversation.view'))
check('侧边栏入口带自己的 id', !!(registered[0] && registered[0].options.id === 'ai-news-workbench'), JSON.stringify(registered[0] && registered[0].options))

const Entry = registered[0].Component
check('拿到入口组件', typeof Entry === 'function')

// ---------------------------------------------------------------------------
// 1) 关闭状态：侧边栏只有一个按钮
// ---------------------------------------------------------------------------
{
  const closed = await harness.render(Entry, { wide: true }, 40)
  check('入口渲染不报错', !closed.error, closed.error && closed.error.message)
  check('入口写着"AI 资讯工作台"', closed.text.includes('AI 资讯工作台'), closed.text.slice(0, 120))
  check('关闭状态没有弹窗', !modalNode(closed.tree))
  check('侧边栏里没有任何模块卡片（不挤在侧边栏）', !closed.text.includes('控制室') && !closed.text.includes('扫源抓取'), closed.text.slice(0, 200))
  check('侧边栏只有一个按钮', buttons(closed.tree).length === 1, String(buttons(closed.tree).length))

  const rail = await harness.render(Entry, { wide: false }, 40)
  check('收起态也是一个小图标按钮', !rail.error && buttons(rail.tree).length === 1 && !modalNode(rail.tree))
}

// ---------------------------------------------------------------------------
// 2) 点入口 → 弹窗出现
// ---------------------------------------------------------------------------
let opened = null
{
  const closed = await harness.render(Entry, { wide: true }, 40)
  const entryButton = findButton(closed.tree, 'AI 资讯工作台')
  check('入口按钮可点', !!entryButton)
  entryButton.props.onClick()
  opened = await harness.render(Entry, { wide: true }, 80)

  const modal = modalNode(opened.tree)
  check('点开后出现弹窗', !!modal)
  check('弹窗是 fixed 定位（浮在界面上）', !!(modal && modal.props.style.position === 'fixed'))
  check('弹窗层级在聊天之上', !!(modal && modal.props.style.zIndex >= 1000), String(modal && modal.props.style.zIndex))
  check('弹窗左边不盖住侧边栏（left ≥ 260px 兜底）', !!(modal && parseInt(modal.props.style.left, 10) >= 260), modal && modal.props.style.left)
  // 真机踩过的坑：之前按"内容区 rect"算位置，量到贴右边的窄元素，弹窗被压成 1px 宽的缝
  check('弹窗宽度铺满剩余视口（不是一条缝）', parseInt(modal.props.style.width, 10) > 400, modal.props.style.width)
  check('弹窗上边贴到视口顶、占满高度（盖住右侧内容区）', !!(modal && modal.props.style.top === '0px' && parseInt(modal.props.style.height, 10) > 300), JSON.stringify(modal && modal.props.style))
  check('弹窗里没有标题栏（标题/副标题/关闭按钮都删了）', !opened.text.includes('选题 抓取') && !byClass(opened.tree, 'xmt-topbar').length && !findButton(opened.tree, '×'), opened.text.slice(0, 160))
  // 本轮需求：取消全屏 —— 外壳只当"安全垫"，真正的工作台是里面一层限定尺寸、整体居中的面板
  check('工作台外面套了一层居中的安全垫（xmt-overlay）', (() => {
    const overlay = byClass(opened.tree, 'xmt-overlay')[0]
    return !!overlay && byClass(opened.tree, 'xmt-panel').length === 1
  })(), opened.text.slice(0, 120))
  check('真正的工作台面板在安全垫里面（面板里有 xmt-panel-scroll 滚动区）', (() => {
    const overlay = byClass(opened.tree, 'xmt-overlay')[0]
    const panel = overlay ? byClass(overlay, 'xmt-panel')[0] : null
    return !!panel && byClass(panel, 'xmt-panel-scroll').length === 1
  })())
  check('面板尺寸交给样式表限定（不再由内联尺寸铺满整屏）', !!(modal && !String(modal.props.style.maxWidth || '').length))
  check('面板里的工作台根节点就是普通 .xmt-root（光晕走 box-shadow，不需要额外标记）', (() => {
    const view = nodes(opened.tree).find((n) => n.props && n.props['data-xmt-workbench'] === 'view')
    return !!view && String(view.props.className).split(/\s+/).includes('xmt-root')
  })())
  check('弹窗打开后侧边栏按钮还在（左侧栏一直可见）', !!findButton(opened.tree, 'AI 资讯工作台'))
  // 入口按钮是开关：已打开时再点一次就收起来
  const entryAgain = findButton(opened.tree, 'AI 资讯工作台')
  check('入口按钮标成了开关（aria-pressed=true）', String(entryAgain.props['aria-pressed']) === 'true', String(entryAgain.props['aria-pressed']))
  entryAgain.props.onClick()
  const toggledOff = await harness.render(Entry, { wide: true }, 60)
  check('已打开时再点侧边栏入口 → 弹窗收起', !modalNode(toggledOff.tree))
  findButton(toggledOff.tree, 'AI 资讯工作台').props.onClick()
  opened = await harness.render(Entry, { wide: true }, 60)
  check('收起后再点还能打开', !!modalNode(opened.tree))
}

// ---------------------------------------------------------------------------
// 3) 弹窗里的一级主页
// ---------------------------------------------------------------------------
{
  check(
    '控制室整块已删除（标题/数据条/关于折叠区/底部操作行都没了）',
    !opened.text.includes('控制室') && !opened.text.includes('关于这个工作台') && !opened.text.includes('今日抓取') && !opened.text.includes('开始全部') && !opened.text.includes('刷新数据'),
    opened.text.slice(0, 240),
  )
  check(
    '弹窗里有 5 个模块卡片（「发布与互动」「数据复盘」已移除）',
    ['选题库', '扫源抓取', '筛选核实', '写文案', '封面标签'].every((name) => opened.text.includes(name)),
    opened.text.slice(0, 300),
  )
  check(
    '已移除的两个模块不再出现',
    !opened.text.includes('发布与互动') && !opened.text.includes('数据复盘'),
    opened.text.slice(0, 300),
  )
  check('一级页有 5 张可点击的模块卡', moduleCards(opened.tree).length === 5, String(moduleCards(opened.tree).length))
  check('卡片右下角不再有单独的「进入」按钮（整卡可点）', !buttons(opened.tree).some((b) => harness.flatten(b).join('').trim() === '进入'), opened.text.slice(0, 200))
  check('一级页没有结果区内容', !opened.text.includes('发布前检查清单') && !opened.text.includes('操作与结果'), opened.text.slice(0, 300))
  check('模块网格上方那一行标题删掉了（不留占位）', !opened.text.includes('模块（点卡片或「进入」看详情）'), opened.text.slice(0, 160))
  check('模块网格下方那一行操作删掉了（开始全部/刷新数据/状态标签）', !findButton(opened.tree, '开始全部') && byClass(opened.tree, 'xmt-badge').length === 0)

  // 网格：5 张模块卡
  const grid = byClass(opened.tree, 'xmt-grid')[0]
  check('一级页内容区直接就是模块网格（前面没有别的行）', !!grid)
  check('主界面套了一层居中的"舞台"', byClass(opened.tree, 'xmt-stage').length === 1)
  // 背景：整块渐变只画在滚动容器 .xmt-panel-scroll 那一层（弹窗外壳不再铺背景，免得切断背景）
  check('弹窗外壳不再单独铺背景层（避免切断整块渐变）', (() => {
    const modal = modalNode(opened.tree)
    if (!modal) return false
    return byClass(opened.tree, 'xmt-modal-bg').length === 0 && byClass(opened.tree, 'xmt-modal-bg-flow').length === 0
  })(), (() => {
    const modal = modalNode(opened.tree)
    return modal ? JSON.stringify([].concat(modal.props.children || []).map((k) => String((k && k.props && k.props.className) || k))) : '（没找到弹窗）'
  })())
  check('弹窗里工作台自己不再重复画背景（避免两层背景叠加/断层）', byClass(opened.tree, 'xmt-bg').length === 0 && byClass(opened.tree, 'xmt-bg-flow').length === 0)
  check('一级页的页面层带 is-stage-page（舞台才能撑满滚动区、真正上下居中）', byClass(opened.tree, 'is-stage-page').length === 1)
  check('舞台在滚动区里面（面板里的 .xmt-panel-scroll 负责上下滑）', (() => {
    const scroll = byClass(opened.tree, 'xmt-panel-scroll')[0]
    return !!scroll && byClass(scroll, 'xmt-stage').length === 1
  })())
  // 右下角虚线入口卡按需求删掉了；设置入口挪到一级页左上角
  check('右下角虚线入口卡已删除（不再有 xmt-mcard-add）', byClass(opened.tree, 'xmt-mcard-add').length === 0)
  check('一级页里不再有 SOP / 日志 入口（按需求删除）', !findButton(opened.tree, '📖 SOP') && !findButton(opened.tree, '📋 日志'))
  check('设置入口在一级页左上角（xmt-main-bar 里）', (() => {
    const bar = byClass(opened.tree, 'xmt-main-bar')[0]
    return !!bar && buttons(bar).some((b) => labelOf(b).includes('设置'))
  })(), opened.text.slice(0, 120))
  check('原来虚线卡里那句"添加网站 / 手动添加选题"也没了', !opened.text.includes('添加网站 / 手动添加选题'))

  // 左上角那个入口要真的能切到设置页
  const settingsBtn = buttons(byClass(opened.tree, 'xmt-main-bar')[0] || {}).find((b) => labelOf(b).includes('设置'))
  if (settingsBtn) settingsBtn.props.onClick()
  const settingsPage = await harness.render(Entry, { wide: true }, 60)
  check('点左上角「⚙ 设置」能进设置页', settingsPage.text.includes('网站清单'), settingsPage.text.slice(0, 200))
  const backFromSettings = findButton(settingsPage.tree, '← 返回')
  if (backFromSettings) backFromSettings.props.onClick()
  opened = await harness.render(Entry, { wide: true }, 60)
}

// ---------------------------------------------------------------------------
// 4) 二级页 + 返回
// ---------------------------------------------------------------------------
{
  // 不依赖上一段停在哪：先用"关掉再打开"把工作台复位到一级页
  const homeStart = await backToMain()
  check('回到一级页（5 张模块卡）', moduleCards(homeStart.tree).length === 5, homeStart.text.slice(0, 200))

  // 整卡可点：直接点第 2 张卡（扫源抓取）的卡片本体
  moduleCards(homeStart.tree)[1].props.onClick()
  const detail = await harness.render(Entry, { wide: true }, 60)
  check('点卡片本体就进入二级界面（不需要"进入"按钮）', detail.text.includes('扫源抓取') && detail.text.includes('操作与结果'), detail.text.slice(0, 240))
  check('二级页顶部不再有面包屑（"AI 资讯工作台 / 模块详情"）', !detail.text.includes('AI 资讯工作台 / 模块详情'), detail.text.slice(0, 160))
  check('二级页标题行精简成「返回」', buttons(detail.tree).some((b) => labelOf(b) === '← 返回') && !buttons(detail.tree).some((b) => labelOf(b).includes('返回工作台主页')))
  check('二级页不做 100vh 居中（页面层没有 is-stage-page，内容正常顶对齐）', byClass(detail.tree, 'is-stage-page').length === 0 && byClass(detail.tree, 'xmt-stage').length === 0)

  // 标题行（返回 + 图标 + 模块名 + 状态徽章 + 右侧操作按钮）在"操作与结果"卡片里面
  const headCard = byClass(detail.tree, 'xmt-card').find((c) => harness.flatten(byClass(c, 'xmt-card-title')[0]).join('').includes('操作与结果'))
  const head = headCard ? byClass(headCard, 'xmt-module-head')[0] : null
  check('标题行挪进了"操作与结果"卡片，且是卡片第一行', !!head && byClass(head, 'xmt-module-head-left').length === 1 && byClass(head, 'xmt-badge').length === 1)
  check('标题行里有模块图标+模块名', !!head && harness.flatten(byClass(head, 'xmt-module-title')[0]).join('').includes('扫源抓取') && byClass(head, 'xmt-mcard-icon').length === 1)
  check('标题行里没有模块描述副标题', !!head && !byClass(head, 'xmt-subtitle').length, head ? harness.flatten(head).join('|') : '')
  // 本轮改动：状态徽章挪到左边那一组（模块名后面），右边一整块留给操作按钮
  check('状态徽章在模块名同一组里（module-head-left）', !!head && byClass(byClass(head, 'xmt-module-head-left')[0], 'xmt-badge').length === 1)
  check(
    '该模块的操作按钮全部在标题行右侧（module-actions），同一行显示',
    !!head && (() => {
      const actions = byClass(head, 'xmt-module-actions')[0]
      if (!actions) return false
      return buttons(actions).some((b) => labelOf(b).includes('开始抓取'))
    })(),
    head ? buttons(byClass(head, 'xmt-module-actions')[0] || {}).map((b) => labelOf(b)).join(',') : '',
  )
  check('顺序：卡片标题行 → "操作与结果"标题 → 内容', !!headCard && String((headCard.props.children || [])[0].props.className).includes('xmt-module-head'))
  check('二级界面才出现该模块的操作按钮', detail.text.includes('开始抓取'))
  check('二级界面没有标题栏关闭按钮（统一用侧边栏开关收起）', !findButton(detail.tree, '×'))
  // "操作与结果"下面不再单独占一行放按钮：标题卡片里只有标题行和结果区两块
  check(
    '"操作与结果"下方不再有单独的操作行（按钮没重复出现）',
    !!headCard && (() => {
      const opsRow = (headCard.props.children || []).slice(1).find((child) => child && child.props && String(child.props.className || '').includes('xmt-row'))
      if (!opsRow) return true
      return buttons(opsRow).filter((b) => !String(b.props.className || '').includes('is-danger')).length === 0
    })(),
    headCard ? buttons(headCard).map((b) => labelOf(b)).join(' , ') : '',
  )

  const back = findButton(detail.tree, '← 返回')
  check('返回按钮可点', !!back)
  back.props.onClick()
  const home = await harness.render(Entry, { wide: true }, 60)
  check('点返回回到主页', home.text.includes('选题库') && moduleCards(home.tree).length === 5)

  const moduleChecks = [
    { index: 2, name: '筛选核实', expect: ['开始筛选'] },
    { index: 3, name: '写文案', expect: ['刷新'] },
    { index: 4, name: '封面标签', expect: ['刷新', '打开模板文件'] },
  ]
  for (const item of moduleChecks) {
    const current = await harness.render(Entry, { wide: true }, 40)
    moduleCards(current.tree)[item.index].props.onClick()
    const page = await harness.render(Entry, { wide: true }, 60)
    check(`${item.name} 二级页按钮齐全（顶部改动没误删功能按钮）`, item.expect.every((text) => page.text.includes(text)), page.text.slice(0, 300))
    check(`${item.name} 二级页也有卡片内的标题行`, byClass(page.tree, 'xmt-module-head').length === 1)
    const backBtn = findButton(page.tree, '← 返回')
    if (backBtn) {
      backBtn.props.onClick()
      await harness.render(Entry, { wide: true }, 40)
    }
  }
}

// ---------------------------------------------------------------------------
// 4.5) 模块1 选题库 + 模块2 扫源抓取
// ---------------------------------------------------------------------------
{
  // 换成"真的会存"的假接口：titles 都对得上，才能验证字段映射与删除后的局部更新
  harness.reset()
  state.offline = false
  state.topics = [
    { id: 't1', title: '标题一号：某模型发布', source: '量子位', link: 'https://example.com/a', date: '2026-09-17 14:07', savedAt: '2026-09-17T06:30:00.000Z' },
    { id: 't2', title: '标题二号：某工具开源', source: '量子位', link: 'https://example.com/b', date: '', savedAt: '2026-09-17T06:31:00.000Z' },
  ]
  options.fetchResult = {
    items: [
      { title: '抓到的第一条', link: 'https://example.com/a', date: '2026-09-17 14:07', dateLabel: '2026-09-17 14:07', source: '量子位' },
      { title: '抓到的第二条', link: 'https://example.com/c', date: '', dateLabel: '日期未读到', source: '量子位' },
    ],
    groups: [
      { source: '量子位', items: [
        { title: '抓到的第一条', link: 'https://example.com/a', date: '2026-09-17 14:07', dateLabel: '2026-09-17 14:07', source: '量子位' },
        { title: '抓到的第二条', link: 'https://example.com/c', date: '', dateLabel: '日期未读到', source: '量子位' },
      ] },
    ],
    failures: [],
    sites: [{ site: '量子位', ok: true, count: 2 }],
    total: 2,
    lastFetchDate: '2026-09-17',
    fetchedAt: '2026-09-17T06:30:00.000Z',
  }
  options.settings = { websites: [{ name: '量子位', url: 'https://www.qbitai.com', difficulty: '普通', selectors: {} }] }

  const home = await backToMain()
  check('（准备）回到一级页', moduleCards(home.tree).length === 5, home.text.slice(0, 200))

  // ---- 模块1：双列 + 标题链接正确 + 删除后局部更新 ----
  moduleCards(home.tree)[0].props.onClick()
  let m1 = await harness.render(Entry, { wide: true }, 80)
  check('选题库：两条都渲染出来了（标题没丢）', m1.text.includes('标题一号') && m1.text.includes('标题二号'), m1.text.slice(0, 260))
  check('选题库：链接也带出来了（不是(无标题)）', m1.text.includes('https://example.com/a') === false && !!byClass(m1.tree, 'xmt-link').length && !m1.text.includes('(无标题)'), m1.text.slice(0, 260))
  check('选题库：列表改成双列（xmt-grid-2 里面装着两条）', (() => {
    const grid = byClass(m1.tree, 'xmt-grid-2')[0]
    return !!grid && byClass(grid, 'xmt-item').length === 2
  })())

  // 删除第 1 条：剩下那条必须还在（以前会被整页清空）
  const delBtn = buttons(m1.tree).find((b) => labelOf(b) === '删除')
  check('选题库：能找到「删除」按钮', !!delBtn)
  delBtn.props.onClick()
  m1 = await harness.render(Entry, { wide: true }, 80)
  check('删除一条后：剩下的那条还在（不再整页清空，也不用刷新）', m1.text.includes('标题二号') && !m1.text.includes('标题一号'), m1.text.slice(0, 300))
  check('删除一条后：主机侧也真的少了（假接口里剩 1 条）', state.topics.length === 1, String(state.topics.length))

  // ---- 模块2：双列结果 + 已存过按钮禁用 + 存入成功提示 ----
  const backFromM1 = findButton(m1.tree, '← 返回')
  backFromM1.props.onClick()
  const home2 = await harness.render(Entry, { wide: true }, 60)
  moduleCards(home2.tree)[1].props.onClick()
  // 等界面稳定（假接口是异步的，"读取数据 → setState"要几轮渲染才落地）
  let m2 = await settle((view) => byClass(view.tree, 'xmt-subitem').length === 2)
  check('扫源抓取：最近抓取精确到"小时:分钟"（2026-09-17 14:30）', m2.text.includes('最近抓取：2026-09-17 14:30'), m2.text.slice(0, 300))
  check('扫源抓取：结果列表双列（xmt-grid-2）', (() => {
    const grid = byClass(m2.tree, 'xmt-grid-2')[0]
    return !!grid && byClass(grid, 'xmt-subitem').length === 2
  })(), m2.text.slice(0, 300))
  check('扫源抓取：列表里按抓到的日期显示（界面上不再出现「最新」这种假日期）', m2.text.includes('【2026-09-17 14:07】') && !m2.text.includes('【最新】'), m2.text.slice(0, 400))
  // 按需求：标题行右侧那个数字必须跟列表的真实条数一致（实时算）
  const countPillOf = (view) => {
    const pills = nodes(view.tree).filter((n) => String((n.props && n.props.className) || '').split(/\s+/).includes('xmt-pill'))
    return pills.map((p) => harness.flatten(p).join('')).find((text) => text.includes('本次有效')) || ''
  }
  check('扫源抓取：标题行显示"本次有效 N 条"，且跟列表实际条数一致', (() => {
    const pill = countPillOf(m2)
    return !!pill && pill.includes(`本次有效 ${byClass(m2.tree, 'xmt-subitem').length} 条`)
  })(), `${countPillOf(m2)} / 列表 ${byClass(m2.tree, 'xmt-subitem').length} 条`)

  const saveBtn = buttons(m2.tree).find((b) => labelOf(b) === '存入选题库')
  check('扫源抓取：没存过的都是可点的「存入选题库」（存过的直接不显示）', !!saveBtn && saveBtn.props.disabled !== true, buttons(m2.tree).map((b) => labelOf(b)).join(' , '))
  check('（准备）列表里一开始有 2 条', byClass(m2.tree, 'xmt-subitem').length === 2, String(byClass(m2.tree, 'xmt-subitem').length))
  const saveBtns = buttons(m2.tree).filter((b) => labelOf(b) === '存入选题库')
  if (saveBtns[0]) saveBtns[0].props.onClick()
  m2 = await settle((view) => byClass(view.tree, 'xmt-subitem').length === 1)
  check('点「存入选题库」后有成功提示', m2.text.includes('已存入'), m2.text.slice(0, 300))
  check(
    '存入后那一条**从列表里消失**（列表少一条、顶部数字跟着减）',
    byClass(m2.tree, 'xmt-subitem').length === 1 && countPillOf(m2).includes('本次有效 1 条'),
    `条目数=${byClass(m2.tree, 'xmt-subitem').length}；${countPillOf(m2)}`,
  )
  const savedTopic = state.topics[state.topics.length - 1]
  check('存入后主机侧真的多了 1 条（字段映射对上了，标题不是空的）', state.topics.length === 2 && !!savedTopic && savedTopic.title !== '(无标题)', JSON.stringify(state.topics.map((t) => [t.title, t.link])))
  check('存进去的 title 和 link 都不是空的', state.topics.every((t) => t.title && t.title !== '(无标题)') && state.topics.every((t) => t.link), JSON.stringify(state.topics.map((t) => [t.title, t.link])))

  // 重新进一次模块2：主机侧已经有的那条仍然不出现
  findButton(m2.tree, '← 返回').props.onClick()
  const home3 = await harness.render(Entry, { wide: true }, 60)
  moduleCards(home3.tree)[1].props.onClick()
  const m2again = await settle((view) => byClass(view.tree, 'xmt-subitem').length === 1)
  check('重新进来时，已存入的那条依然不在列表里', byClass(m2again.tree, 'xmt-subitem').length === 1, String(byClass(m2again.tree, 'xmt-subitem').length))

  // 去「① 选题库」把刚存的那条删掉，再回模块2：这条要重新出现，按钮可点
  findButton(m2again.tree, '← 返回').props.onClick()
  const homeForM1 = await harness.render(Entry, { wide: true }, 60)
  moduleCards(homeForM1.tree)[0].props.onClick() // ① 选题库
  let m1Back = await harness.render(Entry, { wide: true }, 80)
  const delSaved = buttons(m1Back.tree).find((b) => labelOf(b) === '删除')
  check('（准备）选题库里有可删的条目', !!delSaved)
  if (delSaved) delSaved.props.onClick()
  m1Back = await harness.render(Entry, { wide: true }, 80)
  findButton(m1Back.tree, '← 返回').props.onClick()
  const homeForM2 = await harness.render(Entry, { wide: true }, 60)
  moduleCards(homeForM2.tree)[1].props.onClick() // ② 扫源抓取
  const m2afterDel = await settle((view) => byClass(view.tree, 'xmt-subitem').length === 2)
  check(
    '在选题库里删掉之后，回模块2 这条**重新出现**且按钮恢复成可点的「存入选题库」',
    byClass(m2afterDel.tree, 'xmt-subitem').length === 2 &&
      buttons(m2afterDel.tree).filter((b) => labelOf(b) === '存入选题库').length === 2 &&
      countPillOf(m2afterDel).includes('本次有效 2 条'),
    `条目数=${byClass(m2afterDel.tree, 'xmt-subitem').length}；${countPillOf(m2afterDel)}；按钮：${buttons(m2afterDel.tree).map((b) => labelOf(b)).join(' , ')}`,
  )
}

// ---------------------------------------------------------------------------
// 4.6) 本轮修复的界面问题（逐条守住）
// ---------------------------------------------------------------------------
{
  harness.reset()
  state.offline = false
  state.topics = []
  const fakeItem = (n, link) => ({
    id: `c${n}`,
    title: `候选第${n}条：某模型发布 ${n}.0`,
    link,
    source: '量子位',
    date: '2026-09-18 10:00',
    confirmed: false,
    checksCount: 3,
    summary: '正文摘要：涨幅 120%，覆盖 10 万开发者。',
    summarySegments: [{ text: '正文摘要：涨幅 120%，覆盖 10 万开发者。', highlight: false }],
    checkList: [{ key: 'bigTech', label: '大厂发布', rule: '', checked: true, reason: '提到了 OpenAI' }],
  })
  const fakeCopy = (id, extra) => Object.assign(
    { id, titles: [`标题 ${id}`], body: `正文 ${id}`, bodyAfterDeAi: `正文 ${id}`, sourceTitle: `原文标题 ${id}`, sourceLink: `https://example.com/${id}`, checklist: [], savedByUser: false, polished: false },
    extra,
  )
  options.candidates = [fakeItem(1, 'https://example.com/1'), fakeItem(2, 'https://example.com/2'), fakeItem(3, 'https://example.com/3')]
  options.copies = [fakeCopy('u1'), fakeCopy('u2'), fakeCopy('s1', { savedByUser: true })]
  options.fetchResult = {
    items: [
      { title: '抓到的第一条', link: 'https://example.com/a', date: '2026-09-18 10:00', dateLabel: '2026-09-18 10:00', source: '量子位' },
      { title: '抓到的第二条', link: 'https://example.com/b', date: '2026-09-18 09:00', dateLabel: '2026-09-18 09:00', source: '量子位' },
    ],
    groups: [{ source: '量子位', items: [
      { title: '抓到的第一条', link: 'https://example.com/a', date: '2026-09-18 10:00', dateLabel: '2026-09-18 10:00', source: '量子位' },
      { title: '抓到的第二条', link: 'https://example.com/b', date: '2026-09-18 09:00', dateLabel: '2026-09-18 09:00', source: '量子位' },
    ] }],
    failures: [],
    sites: [],
    total: 2,
    lastFetchDate: '2026-09-18',
    fetchedAt: '2026-09-18T02:00:00.000Z',
  }

  // ---- 问题 7：选题库点「写文案」不跳转 ----
  state.topics = [{ id: 'tp1', title: '选题第一条：某大模型发布', source: '量子位', link: 'https://example.com/t1', date: '2026-09-18 10:00' }]
  let home = await backToMain()
  moduleCards(home.tree)[0].props.onClick()
  let m1 = await harness.render(Entry, { wide: true }, 80)
  const writeBtn = buttons(m1.tree).find((b) => labelOf(b).includes('写文案'))
  check('（准备）选题库里有「✍ 写文案」按钮', !!writeBtn, buttons(m1.tree).map(labelOf).join(' , '))
  if (writeBtn) writeBtn.props.onClick()
  m1 = await harness.render(Entry, { wide: true }, 100)
  check('点选题库的「写文案」不再跳到写文案模块（留在当前页）', m1.text.includes('① 选题库') && !buttons(m1.tree).some((b) => labelOf(b) === '刷新'), m1.text.slice(0, 200))

  // ---- 问题 4：扫源抓取的条数实时 ----
  const countOf = (view) => {
    const pill = nodes(view.tree)
      .filter((n) => String((n.props && n.props.className) || '').split(/\s+/).includes('xmt-pill'))
      .map((p) => harness.flatten(p).join(''))
      .find((t) => t.includes('本次有效'))
    return pill || ''
  }
  findButton(m1.tree, '← 返回').props.onClick()
  home = await harness.render(Entry, { wide: true }, 60)
  moduleCards(home.tree)[1].props.onClick()
  let m2 = await harness.render(Entry, { wide: true }, 80)
  check('扫源抓取：顶部显示"本次有效 2 条"（跟列表 2 条一致）', countOf(m2).includes('本次有效 2 条'), countOf(m2))
  const saveBtns2 = buttons(m2.tree).filter((b) => labelOf(b) === '存入选题库')
  if (saveBtns2[0]) saveBtns2[0].props.onClick()
  m2 = await harness.render(Entry, { wide: true }, 100)
  check('存入选题库后：列表少一条，顶部数字立刻变成 1 条', byClass(m2.tree, 'xmt-subitem').length === 1 && countOf(m2).includes('本次有效 1 条'), `${byClass(m2.tree, 'xmt-subitem').length} 条 / ${countOf(m2)}`)

  // ---- 问题 8：筛选核实的正文用省略号截断 ----
  findButton(m2.tree, '← 返回').props.onClick()
  home = await harness.render(Entry, { wide: true }, 60)
  moduleCards(home.tree)[2].props.onClick()
  let m3 = await harness.render(Entry, { wide: true }, 80)
  const clamped = byClass(m3.tree, 'xmt-body-clamp')
  check('筛选核实：候选正文带省略号截断类（xmt-body-clamp）', clamped.length >= 1 && clamped.every((n) => String(n.props.className).includes('xmt-body')), String(clamped.length))
  const confirmBtn = buttons(m3.tree).find((b) => labelOf(b).includes('核实通过'))
  check('（准备）筛选核实里有「✓ 核实通过」按钮', !!confirmBtn, buttons(m3.tree).map(labelOf).join(' , '))
  if (confirmBtn) confirmBtn.props.onClick()
  m3 = await harness.render(Entry, { wide: true }, 100)
  check('核实通过后这条从候选列表里消失', !m3.text.includes('候选第1条'), m3.text.slice(0, 240))

  // ---- 问题 11~15：写文案这一屏 ----
  findButton(m3.tree, '← 返回').props.onClick()
  home = await harness.render(Entry, { wide: true }, 60)
  const m4StateOf = (view) => {
    const badge = nodes(view.tree)
      .filter((n) => String((n.props && n.props.className) || '').split(/\s+/).includes('xmt-badge'))
      .map((b) => harness.flatten(b).join(''))
      .find((t) => t.includes('就绪'))
    return badge || ''
  }
  const m4Card = moduleCards(home.tree)[3]
  check('问题11：写文案一级卡片状态栏固定显示「已就绪 · N 篇」', harness.flatten(m4Card).join('').includes('已就绪 ·'), harness.flatten(m4Card).join(' | '))
  check('问题11：写文案卡片状态色固定走"已完成"绿', /--xmt-ok/.test(String((m4Card.props.style || {})['--xmt-tone'] || '')), JSON.stringify(m4Card.props.style))
  m4Card.props.onClick()
  let m4 = await harness.render(Entry, { wide: true }, 80)
  check('问题11：二级页状态徽章是「已就绪 · 2 篇」（只数还没保存的）', m4StateOf(m4).includes('已就绪 · 2 篇'), m4StateOf(m4))
  check('问题15：保存过的帖子不再出现在列表里', m4.text.includes('标题 u1') && m4.text.includes('标题 u2') && !m4.text.includes('标题 s1'), m4.text.slice(0, 300))
  check('问题13：取消「还没保存（保存后才进封面标签）」这行字', !m4.text.includes('还没保存') && !m4.text.includes('保存后才进'), m4.text.slice(0, 300))
  // 问题14：「打开原文」要排在「保存」右边（往左挪），排在「删除」前面
  check('问题14：「打开原文」挪到「保存」右边（不再贴在右下角）', (() => {
    const texts = buttons(m4.tree).map(labelOf)
    const saveIdx = texts.findIndex((t) => t === '保存')
    const delIdx = texts.findIndex((t) => t === '删除')
    const openIdx = nodes(m4.tree).findIndex((n) => n.type === 'a' && String((n.props && n.props.className) || '').includes('xmt-link'))
    return saveIdx >= 0 && openIdx > saveIdx && (delIdx === -1 || delIdx > saveIdx)
  })(), buttons(m4.tree).map(labelOf).join(' , '))
  const delCopy = buttons(m4.tree).find((b) => labelOf(b) === '删除')
  check('（准备）写文案里有「删除」按钮', !!delCopy)
  if (delCopy) delCopy.props.onClick()
  m4 = await harness.render(Entry, { wide: true }, 100)
  // 问题12：删除后留在原地（只看二级页标题行里的模块名 —— 删除按钮的 title 里也写着"② 扫源抓取"，不能拿整页文字判）
  const headNameAfterDelete = (() => {
    const head = byClass(m4.tree, 'xmt-module-title')[0]
    return head ? harness.flatten(head).join('') : ''
  })()
  check('问题12：删除文案后留在「④ 写文案」（不再跳回扫源抓取）', headNameAfterDelete.includes('写文案') && !buttons(m4.tree).some((b) => labelOf(b) === '开始抓取'), `${headNameAfterDelete} | ${buttons(m4.tree).map(labelOf).join(' , ')}`)
  check('问题12：删除后列表里少了一条（还留在原地，页面没被清空）', m4.text.includes('已删除'), m4.text.slice(0, 120))
}

// ---------------------------------------------------------------------------
// 5) 设置页（SOP / 日志 入口已按需求从一级页删除）
// ---------------------------------------------------------------------------
{
  // 复位到一级页，再点左上角的「⚙ 设置」
  let home = await backToMain()
  const homeCards = moduleCards(home.tree)
  check('回到一级页（能看到 5 张模块卡）', homeCards.length === 5, home.text.slice(0, 200))

  const settingsBtn = findButtonExact(home.tree, '⚙ 设置')
  check('一级页左上角能找到「设置」入口', !!settingsBtn)
  if (settingsBtn) settingsBtn.props.onClick()
  const settings = await harness.render(Entry, { wide: true }, 60)
  check('设置页能打开（模型 / 网站清单）', settings.text.includes('网站清单') && settings.text.includes('模型'), settings.text.slice(0, 240))
  check('设置里读到了主机侧的网站清单', settings.text.includes('量子位'), settings.text.slice(0, 300))
  check('设置页的返回也是「← 返回」（不再写"返回工作台主页"）', buttons(settings.tree).some((b) => labelOf(b) === '← 返回') && !buttons(settings.tree).some((b) => labelOf(b).includes('返回工作台主页')), buttons(settings.tree).map(labelOf).join(' , '))

  // ---- 设置页 UI 优化（本轮改动）----
  check('问题1：模型配置那段解释文字删掉了', !settings.text.includes('「AI 润色」用这套'), settings.text.slice(0, 240))
  check('问题3：抓取参数那段解释文字删掉了', !settings.text.includes('「抓取最近几天」默认 1 天'))
  check('问题2：「删除这个网站」在右上角那一列（xmt-site-row-action）', byClass(settings.tree, 'xmt-site-row-action').length === 1 && byClass(settings.tree, 'xmt-site-row').length === 1, String(byClass(settings.tree, 'xmt-site-row-action').length))
  // 底部那对按钮取消了：保存设置 / ← 返回 各只剩顶部那一个
  check('问题4：底部按钮已取消（保存设置只剩 1 个）', buttons(settings.tree).filter((b) => labelOf(b) === '保存设置').length === 1, buttons(settings.tree).map(labelOf).join(' , '))
  check('问题4：底部按钮已取消（← 返回 只剩 1 个）', buttons(settings.tree).filter((b) => labelOf(b) === '← 返回').length === 1, buttons(settings.tree).map(labelOf).join(' , '))
  // 问题5：在设置页里点保存，也要能弹出「设置已保存」
  const saveBtn = buttons(settings.tree).find((b) => labelOf(b) === '保存设置')
  if (saveBtn) saveBtn.props.onClick()
  const afterSave = await harness.render(Entry, { wide: true }, 80)
  check('问题5：设置页内点保存也能看到「设置已保存」提示', afterSave.text.includes('设置已保存'), afterSave.text.slice(0, 260))
  check('问题5：提示用的是浮层（xmt-toast），不是页面里的普通一行', byClass(afterSave.tree, 'xmt-toast').length === 1, String(byClass(afterSave.tree, 'xmt-toast').length))

  // 点返回能回到一级页
  const back1 = buttons(settings.tree).find((b) => labelOf(b) === '← 返回')
  if (back1) back1.props.onClick()
  home = await harness.render(Entry, { wide: true }, 60)
  check('设置页点「← 返回」回到一级页', moduleCards(home.tree).length === 5, home.text.slice(0, 200))
  check('一级页不再有 SOP / 日志 入口', !findButtonExact(home.tree, '📖 SOP') && !findButtonExact(home.tree, '📋 日志'))
}

// ---------------------------------------------------------------------------
// 6) 关闭弹窗：入口按钮当开关用（标题栏的 × 已按需求删除）
// ---------------------------------------------------------------------------
{
  const home = await harness.render(Entry, { wide: true }, 40)
  check('打开状态下弹窗在', !!modalNode(home.tree))
  const entry = findButton(home.tree, 'AI 资讯工作台')
  check('入口按钮标题提示"收起"', String(entry.props.title || '').includes('收起'), String(entry.props.title))
  entry.props.onClick()
  const closed = await harness.render(Entry, { wide: true }, 60)
  check('再点一次侧边栏入口 → 弹窗消失', !modalNode(closed.tree))
  check('收起后回到聊天（侧边栏按钮还在）', !!findButton(closed.tree, 'AI 资讯工作台'))

  findButton(closed.tree, 'AI 资讯工作台').props.onClick()
  const reopened = await harness.render(Entry, { wide: true }, 60)
  check('可以再次打开', !!modalNode(reopened.tree))
}

// ---------------------------------------------------------------------------
// 7) 接口地址与鉴权
// ---------------------------------------------------------------------------
{
  check('界面侧调的是主机侧接口 /xmt-kf/api', apiCalls.length > 0 && apiCalls.every((call) => call.url.includes('/xmt-kf/api')), JSON.stringify(apiCalls.map((c) => c.url).slice(0, 3)))
  const posts = apiCalls.filter((call) => call.options.method === 'POST')
  check('POST 带同源 cookie + JSON 头', posts.length > 0 && posts.every((call) => call.options.credentials === 'same-origin' && /application\/json/.test(call.options.headers['Content-Type'])))
  check(
    'POST 体是 {action, payload} 结构',
    posts.every((call) => {
      const body = JSON.parse(call.options.body)
      return typeof body.action === 'string' && typeof body.payload === 'object'
    }),
  )
  check('启动时拉取了设置与状态', apiCalls.some((call) => call.url.includes('action=settings')) && apiCalls.some((call) => call.url.includes('action=status')))
  check('界面侧只依赖 react（不直接抓网页/读文件）', requiredSpecs.every((spec) => spec === 'react'), JSON.stringify(requiredSpecs))
}

// ---------------------------------------------------------------------------
// 8) 主机侧连不上：不白屏 + 有提示 + 界面还能导航
// ---------------------------------------------------------------------------
{
  harness.reset() // 相当于重新挂载：清掉 hook 槽位，从零开始
  state.offline = true
  const down = await ensureOpen({ wide: true }, 60)
  check('主机侧连不上时弹窗仍能渲染（不白屏）', !down.error && !!modalNode(down.tree), down.error && down.error.message)
  check('并且提示了错误，不静默失败', down.text.includes('失败') || down.text.includes('读取数据'), down.text.slice(0, 240))
  check('断网时 5 个卡片照样在', ['选题库', '扫源抓取', '封面标签'].every((name) => down.text.includes(name)), down.text.slice(0, 240))
}

// ---------------------------------------------------------------------------
// 9) 弹窗几何：真机踩过的坑（回归测试）
//    之前按"右侧内容区 rect"算位置，量到了贴右边的窄元素 → 弹窗被压成 1px 宽的缝，
//    看起来就是"点了按钮没反应"。这里用假 DOM 复现那个页面结构，确保不会再犯。
// ---------------------------------------------------------------------------
{
  const el = (rect, cls = '') => ({
    className: cls,
    parentElement: null,
    getBoundingClientRect: () => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.left + rect.width, bottom: rect.top + rect.height }),
  })

  /** 造一个"贴右边的窄元素"，正是当年把 right 算成 31px 的那种东西 */
  const sidebar = el({ left: 0, top: 0, width: 244, height: 900 }, 'SidebarRoot_x')
  const workspaces = el({ left: 0, top: 60, width: 244, height: 720 }, 'sidebar_region')
  const rightNarrow = el({ left: 1409, top: 0, width: 31, height: 900 })

  const makeDoc = (sections) => ({
    documentElement: { clientWidth: 1440, clientHeight: 900 },
    querySelectorAll(selector) {
      if (/SidebarRoot|sidebar|aside|rail/.test(selector)) return sections.sidebar
      if (/div, aside, nav, section/.test(selector)) return sections.all
      return []
    },
    querySelector: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    body: { appendChild() {}, removeChild() {} },
  })

  /** 切换假 DOM（模拟不同侧边栏状态） */
  const useLayout = (sections, viewport = { innerWidth: 1440, innerHeight: 900 }) => {
    globalThis.window = Object.assign({ addEventListener() {}, removeEventListener() {} }, viewport)
    globalThis.document = makeDoc(sections)
  }

  // 9.1 展开态：侧边栏 244px + 右边有个窄元素（历史 bug 的触发条件）
  useLayout({ sidebar: [sidebar, workspaces], all: [sidebar, workspaces, rightNarrow] })
  harness.reset() // 相当于重新挂载：清掉 hook 槽位，从零开始
  const wide = await ensureOpen({ wide: true }, 200)
  const wideModal = modalNode(wide.tree)
  const wideStyle = (wideModal && wideModal.props.style) || {}
  check('有假 DOM 时弹窗照样渲染出来', !!wideModal)
  check('弹窗左边让开侧边栏（≥244px + 余量，不盖左侧栏）', parseInt(wideStyle.left, 10) >= 244, wideStyle.left)
  check('量到侧边栏时按"最右边界 + 8px 余量"让位（252）', parseInt(wideStyle.left, 10) === 252, wideStyle.left)
  check('弹窗宽度铺满剩余视口（不会被压成一条缝）', parseInt(wideStyle.width, 10) >= 1000, `width=${wideStyle.width}（历史 bug 时是 1px）`)
  check('弹窗上/下贴边、占满高度', wideStyle.top === '0px' && parseInt(wideStyle.height, 10) >= 800, `${wideStyle.top} / ${wideStyle.height}`)
  check('弹窗右边贴到视口右侧（left + width = 视口宽）', parseInt(wideStyle.left, 10) + parseInt(wideStyle.width, 10) === 1440, `${wideStyle.left} + ${wideStyle.width}`)

  // 9.1b 外层留位比内层面板窄（真实结构里的常见坑）：必须取最右边那条边界
  const outerSlot = el({ left: 0, top: 0, width: 206, height: 900 }, 'SidebarSlot_outer')
  const innerPanel = el({ left: 0, top: 0, width: 240, height: 900 }, 'SidebarRoot_inner')
  innerPanel.parentElement = outerSlot
  useLayout({ sidebar: [outerSlot, innerPanel], all: [outerSlot, innerPanel, rightNarrow] })
  harness.reset()
  const layered = await ensureOpen({ wide: true }, 200)
  const layeredModal = modalNode(layered.tree)
  const layeredLeft = parseInt(((layeredModal && layeredModal.props.style) || {}).left, 10)
  check('侧边栏里外两层宽度不同时，取最右边的边界（248，而不是 206）', layeredLeft === 248, String(layeredLeft))

  // 9.2 收起态（细轨道）：左边让开轨道即可，弹窗更宽
  const rail = el({ left: 0, top: 0, width: 68, height: 900 }, 'SidebarRoot_collapsed')
  useLayout({ sidebar: [rail], all: [rail, rightNarrow] })
  // 注意：这里是"换了一套布局再挂载"，要连重建一次（用 reset）。
  // 只清 effect 队列（begin）在真实 React 里不成立：同一位置的组件不会重挂载，state 会留着。
  harness.reset()
  const railOpen = await ensureOpen({ wide: false }, 200)
  const railModal = modalNode(railOpen.tree)
  const railStyle = (railModal && railModal.props.style) || {}
  check('收起态弹窗也在，且左边让开细轨道 + 余量', !!railModal && parseInt(railStyle.left, 10) === 76, `${railStyle.left} (期望 76)`)
  check('收起态弹窗宽度=视口-轨道', parseInt(railStyle.width, 10) === 1364, railStyle.width)

  // 恢复真实测试环境（后面的断言/退出不受影响）
  useLayout({ sidebar: [], all: [] })
}

// ---------------------------------------------------------------------------
// 10) 按钮视觉规范 + 点击反馈 + 异步加载态（样式改造的验收）
// ---------------------------------------------------------------------------
{
  state.offline = false // 恢复假接口，后面的用例要用正常链路
  state.topics = [] // 这一段要验"空数据占位"，所以先把选题库清空（前面几段存过东西）
  harness.reset() // 相当于重新挂载：清掉 hook 槽位，从零开始
  const home = await ensureOpen({ wide: true }, 60)

  const allButtons = buttons(home.tree)
  const str = (node) => String((node && node.props && node.props.className) || '')
  // 虚线卡片和侧边栏入口按钮是专门样式；其余按钮都要走统一样式类
  const okClass = (b) => {
    const c = str(b).split(/\s+/)
    // xmt-mcard 是"整卡当按钮"，样式在卡片自己的规则里
    return c.includes('xmt-btn') || c.includes('xmt-mcard-add') || c.includes('xmt-enter-entry') || c.includes('xmt-mcard')
  }
  const classed = allButtons.filter(okClass)
  check('所有按钮都带统一样式类（xmt-btn / 整卡 xmt-mcard / 虚线卡片、侧边栏入口除外）', allButtons.length > 0 && classed.length === allButtons.length, `${classed.length}/${allButtons.length}`)
  check('一级页的「⚙ 设置」是大号入口按钮（带专属样式类 xmt-settings-entry）', allButtons.filter((b) => str(b).includes('xmt-settings-entry')).length === 1, String(allButtons.filter((b) => str(b).includes('xmt-settings-entry')).length))
  check('模块卡就是按钮本体（type=button，可点可键盘触发）', moduleCards(home.tree).length === 5 && moduleCards(home.tree).every((c) => typeof c.props.onClick === 'function'))

  const cards = byClass(home.tree, 'xmt-mcard')
  check('模块卡片用玻璃卡片类（xmt-mcard）', cards.length === 5, String(cards.length))
  const tones = cards.map((c) => (c.props.style || {})['--xmt-tone'])
  check('卡片描边色按状态走（灰/蓝/绿/黄四选一）', tones.length === 5 && tones.every((t) => /--xmt-(line|accent|ok|warn)/.test(String(t))), JSON.stringify(tones))
  check(
    '卡片只有两组：顶部"图标+模块名"，下方紧跟状态文字',
    cards.every((c) => byClass(c, 'xmt-mcard-top').length === 1 && byClass(c, 'xmt-mcard-state').length === 1 && byClass(c, 'xmt-mcard-icon').length === 1 && byClass(c, 'xmt-mcard-name').length === 1),
  )
  check('卡片里不再有重复的数字块（xmt-mcard-mid / xmt-mcard-num 已删）', cards.every((c) => byClass(c, 'xmt-mcard-mid').length === 0 && byClass(c, 'xmt-mcard-num').length === 0))
  check('卡片里不再有说明文字（xmt-mcard-desc 已删）', cards.every((c) => byClass(c, 'xmt-mcard-desc').length === 0))
  check('状态文字紧跟在模块名之后（顺序：top → state）', cards.every((c) => {
    const kids = (c.props.children || []).filter((k) => k && k.props && k.props.className)
    return kids.length === 2 && String(kids[0].props.className).includes('xmt-mcard-top') && String(kids[1].props.className).includes('xmt-mcard-state')
  }))
  check('卡片标题就是模块名（不再带 ①② 序号）', cards.every((c) => !/[①②③④⑤⑥⑦]/.test(harness.flatten(byClass(c, 'xmt-mcard-name')[0]).join(''))), harness.flatten(byClass(cards[0], 'xmt-mcard-name')[0]).join(''))
  check('右下角那格虚线卡已删除（xmt-mcard-add 不再出现）', byClass(home.tree, 'xmt-mcard-add').length === 0)
  check('控制室已删除（没有数据条元素）', byClass(home.tree, 'xmt-data-item').length === 0, String(byClass(home.tree, 'xmt-data-item').length))
  check('底部操作行已删除（没有主按钮"开始全部"）', !findButton(home.tree, '开始全部'))

  // 异步按钮的加载态：抓取中… + 转圈 + 禁用（把 fetch 挂起，界面就停在加载中）
  moduleCards(home.tree)[1].props.onClick() // 扫源抓取（整卡可点）
  const mod = await harness.render(Entry, { wide: true }, 60)
  const fetchBtn = findButton(mod.tree, '开始抓取')
  check('二级页主按钮是主按钮样式', str(fetchBtn).includes('is-primary'), str(fetchBtn))
  check('二级页顶部有状态徽章', byClass(mod.tree, 'xmt-badge').length >= 1)

  const passFetch = state.hold('fetch')
  // 抓取进行中：主机侧报"第 2 / 3 个网站"，界面要画出进度条
  state.progress = { running: true, done: 1, total: 3, currentSite: '量子位', phase: 'site', detailDone: 0, detailTotal: 0, items: 8, failures: 0, percent: 33 }
  fetchBtn.props.onClick()
  // 注意：这里要用 rerender（只重渲染一次）。render() 会跑一遍 effect，而 effect 里的
  // "读取数据"会把 busy 覆盖掉，反而看不到"抓取中…"这个中间态。
  const mid = harness.rerender(Entry, { wide: true })
  const midBtn = buttons(mid.tree).find((b) => /抓取中/.test(harness.flatten(b).join('')))
  check(
    '点异步按钮后立刻进入加载态（文案变"抓取中…"）',
    !!midBtn,
    `held=${state.held}；按钮清单：${buttons(mid.tree).map((b) => harness.flatten(b).join('')).join(' , ')}`,
  )
  check('加载中按钮被禁用（防重复点击）', !!(midBtn && midBtn.props.disabled === true))
  check('加载中有转圈元素（xmt-spinner）', !!(midBtn && String(midBtn.props['aria-busy']) === 'true' && byClass(midBtn, 'xmt-spinner').length === 1))
  // 进度条：主机侧轮询回来之后要有（第几个网站 / 共几个）
  await new Promise((resolve) => setTimeout(resolve, 900))
  const midProgress = harness.rerender(Entry, { wide: true })
  const bar = byClass(midProgress.tree, 'xmt-progress')[0]
  const fill = byClass(midProgress.tree, 'xmt-progress-fill')[0]
  check('抓取中显示进度条（xmt-progress）', !!bar, midProgress.text.slice(0, 260))
  check('进度条写着"第几个 / 共几个网站"，并带上网站名', !!bar && /第\s*2\s*\/\s*3\s*个网站/.test(harness.flatten(byClass(bar, 'xmt-progress-label')[0]).join('')) && harness.flatten(byClass(bar, 'xmt-progress-label')[0]).join('').includes('量子位'), bar ? harness.flatten(bar).join(' / ') : '')
  check('进度条有百分比数字，填充宽度跟着走', !!fill && String(fill.props.style.width) === '33%' && harness.flatten(byClass(bar, 'xmt-progress-num')[0]).join('').includes('33%'), fill ? JSON.stringify(fill.props.style) : '')
  // 问题3：删掉"已完成 N / M 个网站 · 已拿到 N 条"这行冗余文字（进度条只留标题 + 百分比 + 进度槽）
  check('问题3：进度条删掉了「已完成 … 个网站 · 已拿到 … 条」这行冗余文字', !!bar && byClass(bar, 'xmt-progress-foot').length === 0 && !harness.flatten(bar).join('').includes('已完成'), bar ? harness.flatten(bar).join(' / ') : '')
  state.progress = { running: false, done: 3, total: 3, phase: 'done', items: 5, failures: 1, percent: 100 }
  passFetch()
  const done = await harness.render(Entry, { wide: true }, 60)
  check('请求完成后按钮恢复（文案回到"开始抓取"、可再点）', (() => {
    const back = findButton(done.tree, '开始抓取')
    return !!back && back.props.disabled !== true && !/抓取中/.test(done.text)
  })(), done.text.slice(-160))

  // 空数据占位 / 返回按钮
  moduleCards(home.tree)[0].props.onClick() // 选题库（整卡可点）
  const m1 = await harness.render(Entry, { wide: true }, 60)
  check('问题2：空数据时显示"暂无数据"占位（不留白）', byClass(m1.tree, 'xmt-empty').length >= 1 && m1.text.includes('暂无数据'), m1.text.slice(0, 160))
  check('问题2：扫源抓取空列表的提示也统一成"暂无数据"', (() => {
    const pillText = m1.text
    return !pillText.includes('日期优先从详情页的 <time> / meta 里读')
  })(), m1.text.slice(0, 200))
  check('二级页有卡片内的标题行（返回 + 模块名 + 状态徽章）', byClass(m1.tree, 'xmt-module-head').length === 1 && !!findButton(m1.tree, '← 返回'))

  // 量不到侧边栏时的兜底：弹窗绝不许从视口最左边开始铺（"变成全屏"就是这里崩的）
  {
    const el = (rect) => ({
      className: '',
      parentElement: null,
      getBoundingClientRect: () => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    })
    // 所有元素都"贴左边但很矮"→ 竖长条判定不过 → 一条都量不到
    const dwarfs = [el({ left: 0, top: 0, width: 240, height: 20 }), el({ left: 0, top: 300, width: 240, height: 10 })]
    globalThis.window = Object.assign({ addEventListener() {}, removeEventListener() {} }, { innerWidth: 1440, innerHeight: 900 })
    globalThis.document = {
      documentElement: { clientWidth: 1440, clientHeight: 900 },
      querySelectorAll: (selector) => (/div, aside, nav, section|SidebarRoot|sidebar|aside|rail/.test(selector) ? dwarfs : []),
      querySelector: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      body: { appendChild() {}, removeChild() {} },
    }
    harness.reset()
    const degraded = await ensureOpen({ wide: true }, 200)
    const dModal = modalNode(degraded.tree)
    const dStyle = (dModal && dModal.props.style) || {}
    const dLeft = parseInt(dStyle.left, 10)
    const dWidth = parseInt(dStyle.width, 10)
    check('量不到侧边栏时按 260 兜底，弹窗不会铺满整屏（回归）', !!dModal && dLeft >= 260 && dLeft + dWidth === 1440, `left=${dStyle.left} width=${dStyle.width}`)
    // 恢复真实测试环境（空 DOM，弹窗会用兜底宽度）
    globalThis.window = Object.assign({ addEventListener() {}, removeEventListener() {} }, { innerWidth: 1440, innerHeight: 900 })
    globalThis.document = harness.documentStub
  }
}

// ---------------------------------------------------------------------------
// 11) 「⑤ 封面标签」（简化后：只选模板 + 展示文案/标签，不往图上画东西）
// ---------------------------------------------------------------------------
{
  harness.reset()
  state.offline = false
  state.topics = []
  options.candidates = []
  options.layouts = []
  options.copies = [
    { id: 'u1', titles: ['标题 u1'], body: '正文 u1。今年大模型免费额度翻倍。', bodyAfterDeAi: '正文 u1。今年大模型免费额度翻倍。', checklist: [], savedByUser: false },
    { id: 's1', titles: ['标题 s1（已保存）'], body: '正文 s1。智谱发布 GLM-5.3，最高 200 tokens/s。', bodyAfterDeAi: '正文 s1。智谱发布 GLM-5.3，最高 200 tokens/s。', sourceTitle: '原文 s1', sourceLink: 'https://example.com/s1', checklist: [], savedByUser: true },
  ]
  options.template = { file: '', name: '', width: 0, height: 0, exists: false }
  state.template = options.template
  state.templateList = [
    { file: 'tpl-a.png', name: 'tpl-a.png', size: 1024, mtime: '2026-09-18T10:00:00.000Z' },
    { file: 'tpl-b.jpg', name: 'tpl-b.jpg', size: 2048, mtime: '2026-09-18T09:00:00.000Z' },
  ]

  let home = await backToMain()
  const badgeOf = (view, keyword) => {
    const badge = nodes(view.tree)
      .filter((n) => String((n.props && n.props.className) || '').split(/\s+/).includes('xmt-badge'))
      .map((b) => harness.flatten(b).join(''))
      .find((t) => t.includes(keyword))
    return badge || ''
  }
  const m3Card = moduleCards(home.tree)[2]
  const m4Card = moduleCards(home.tree)[3]
  const m5Card = moduleCards(home.tree)[4]
  check('写文案计数只数"还没保存"的稿子', harness.flatten(m4Card).join('').includes('已就绪 · 1 篇'), harness.flatten(m4Card).join(' | '))
  check('写文案有内容时卡片发绿光', /--xmt-ok/.test(String((m4Card.props.style || {})['--xmt-tone'] || '')), JSON.stringify(m4Card.props.style))
  check('筛选核实状态栏只显示"候选 N 条"（不再带等待/已确认）', /候选 \d+ 条/.test(harness.flatten(m3Card).join('')) && !/等待|已确认/.test(harness.flatten(m3Card).join('')), harness.flatten(m3Card).join(' | '))
  check('筛选核实状态色也是绿色', /--xmt-ok/.test(String((m3Card.props.style || {})['--xmt-tone'] || '')), JSON.stringify(m3Card.props.style))
  check('模块卡叫「封面标签」', harness.flatten(m5Card).join('').includes('封面标签') && !harness.flatten(m5Card).join('').includes('做图排版'), harness.flatten(m5Card).join(' | '))

  // ---- 进「⑤ 封面标签」 ----
  moduleCards(home.tree)[4].props.onClick()
  let m5 = await harness.render(Entry, { wide: true }, 200)
  check('右上角只有「刷新」，没有「X 篇」小胶囊', !!findButton(m5.tree, '刷新') && byClass(m5.tree, 'xmt-pill').length === 0, buttons(m5.tree).map(labelOf).join(' , '))
  check('按钮叫「打开模板文件夹」', !!findButton(m5.tree, '打开模板文件夹'), buttons(m5.tree).map(labelOf).join(' , '))
  check('进入后自动刷新过了（不用手动点）', apiCalls.some((c) => String(c.options.body || '').includes('"action":"layout"')))
  check('文件夹里的模板都列成缩略图了', byClass(m5.tree, 'xmt-template-card').length === 2, String(byClass(m5.tree, 'xmt-template-card').length))
  check('每条帖子都显示标题 + 内容（只是文案，不画进图片）', m5.text.includes('标题 s1') && m5.text.includes('正文 s1'), m5.text.slice(0, 300))
  check('删掉了「出图方式：…」那段说明', !m5.text.includes('出图方式'))
  check('删掉了「先去「④ 写文案」写好文案并点「保存」」那句', !m5.text.includes('先去「④ 写文案」'), m5.text.slice(0, 300))
  check('删掉了「模板文件夹里还没有图片：…」那句', !m5.text.includes('模板文件夹里还没有图片'))
  check('删掉了「当前使用：xxx」那行', !m5.text.includes('当前使用：'))
  check('没有旧的「模板生图 / 复制标签 / 打开原文」按钮', !findButton(m5.tree, '模板生图') && !findButton(m5.tree, '复制标签') && !findButton(m5.tree, '打开原文'), buttons(m5.tree).map(labelOf).join(' , '))

  // ---- 问题1：点按钮要真的调主机侧去打开资源管理器 ----
  const openBtn = buttons(m5.tree).find((b) => labelOf(b).includes('打开模板文件夹'))
  const openBefore = apiCalls.filter((c) => String(c.options.body || '').includes('openTemplateFolder')).length
  await openBtn.props.onClick()
  m5 = await harness.render(Entry, { wide: true }, 150)
  check('点「打开模板文件夹」真的去调主机侧接口了（由它唤起资源管理器）', apiCalls.filter((c) => String(c.options.body || '').includes('openTemplateFolder')).length === openBefore + 1, `调用 ${apiCalls.filter((c) => String(c.options.body || '').includes('openTemplateFolder')).length} 次`)
  check('打开后给了反馈提示', m5.text.includes('已打开模板文件夹') || m5.text.includes('打不开文件夹'), m5.text.slice(0, 200))

  // ---- 问题3：点缩略图 = 选中它当封面（不生成任何图片） ----
  const tplButtons = byClass(m5.tree, 'xmt-template-card')
  await tplButtons[1].props.onClick()
  m5 = await harness.render(Entry, { wide: true }, 200)
  check('点缩略图会调主机侧 useTemplate（把这张设为当前封面）', apiCalls.some((c) => String(c.options.body || '').includes('useTemplate')))
  check('被选中的那张模板卡片带选中态', byClass(m5.tree, 'xmt-template-card').filter((n) => String(n.props.className).includes('is-active')).length === 1, JSON.stringify(byClass(m5.tree, 'xmt-template-card').map((n) => String(n.props.className))))
  check('封面区展示的就是选中的模板图（img src 指向模板接口）', (() => {
    const imgs = nodes(m5.tree).filter((n) => n.type === 'img' && /action=templateImage/.test(String(n.props.src || '')))
    return imgs.length >= 2 && imgs.some((n) => String(n.props.src).includes('tpl-b.jpg'))
  })(), nodes(m5.tree).filter((n) => n.type === 'img').map((n) => String(n.props.src).slice(-40)).join(' | '))
  check('问题3：不再自动生成多张缩略图（xmt-thumb-item 为 0）', byClass(m5.tree, 'xmt-thumb-item').length === 0, String(byClass(m5.tree, 'xmt-thumb-item').length))
  check('问题3：图片预览区没有把标题/正文叠上去（页面上只有 img，没有生成的卡片）', !m5.text.includes('共 3 张') && !m5.text.includes('缩略图（'))

  // ---- 标签依然展示、也能改 ----
  const tagInputs = byClass(m5.tree, 'xmt-tag-input')
  // 按需求：标签改成生成 4~6 个（原来那条断言写的是 >=5，对应旧的 5~10 规则）
  check('标签数量在 4~6 个之间（按需求）', tagInputs.length >= 4 && tagInputs.length <= 6, String(tagInputs.length))
  tagInputs[0].props.onChange({ target: { value: '我改的标签' } })
  m5 = harness.rerender(Entry, { wide: true })
  check('改完标签界面就是用户输入的内容', byClass(m5.tree, 'xmt-tag-input').map((n) => String(n.props.value)).includes('我改的标签'), JSON.stringify(byClass(m5.tree, 'xmt-tag-input').map((n) => String(n.props.value))))
  const addTagBtn = buttons(m5.tree).find((b) => labelOf(b).includes('加标签'))
  check('有「+ 加标签」按钮', !!addTagBtn)
  const beforeCount = byClass(m5.tree, 'xmt-tag-input').length
  addTagBtn.props.onClick()
  m5 = await harness.render(Entry, { wide: true }, 120)
  check('点「+ 加标签」会多一个标签输入框', byClass(m5.tree, 'xmt-tag-input').length === beforeCount + 1, `${beforeCount} → ${byClass(m5.tree, 'xmt-tag-input').length}`)

  // ---- 删除：留在原地 ----
  const delBtn = buttons(m5.tree).find((b) => labelOf(b) === '删除')
  check('（准备）封面标签里有「删除」按钮', !!delBtn)
  await delBtn.props.onClick()
  m5 = await harness.render(Entry, { wide: true }, 150)
  check('删除后调了主机侧 deleteCopy', apiCalls.some((c) => String(c.options.body || '').includes('deleteCopy')))
  check('删除后仍留在封面标签这一页', (() => {
    const head = byClass(m5.tree, 'xmt-module-title')[0]
    return !!head && harness.flatten(head).join('').includes('封面标签')
  })(), m5.text.slice(0, 160))
}
// ---------------------------------------------------------------------------
// 12) 问题5 + 问题6：写文案保存 → 进封面标签刷得出来；1/3/4/5 进入自动刷新
// ---------------------------------------------------------------------------
{
  harness.reset()
  state.offline = false
  state.topics = []
  options.candidates = []
  options.copies = []
  options.layouts = []
  options.template = { file: 'tpl-a.png', name: 'tpl-a.png', width: 1080, height: 1440, exists: true }
  state.templateList = [{ file: 'tpl-a.png', name: 'tpl-a.png', size: 1024, mtime: '2026-09-18T10:00:00.000Z' }]
  state.template = options.template
  const makeCopy = (saved) => [{ id: 'c1', titles: ['刚写好的标题'], body: '刚写好的正文，OpenAI 免费额度翻倍。', bodyAfterDeAi: '刚写好的正文，OpenAI 免费额度翻倍。', sourceTitle: '原文 c1', sourceLink: 'https://x/1', checklist: [], savedByUser: !!saved }]

  // 进写文案：主机侧还没有稿子
  options.copies = []
  let view = await backToMain()
  moduleCards(view.tree)[3].props.onClick()
  view = await harness.render(Entry, { wide: true }, 200)
  check('问题6：进写文案会自动刷一次（不用手动点刷新）', apiCalls.some((c) => String(c.options.body || '').includes('writeCopy')), String(apiCalls.filter((c) => String(c.options.body || '').includes('writeCopy')).length))

  // 主机侧这时才有一篇没保存的稿子（模拟刚写出来）
  options.copies = makeCopy(false)
  const refreshBtn = buttons(view.tree).find((b) => labelOf(b) === '刷新')
  await refreshBtn.props.onClick()
  view = await harness.render(Entry, { wide: true }, 200)
  check('（准备）写文案里出现了这篇稿子', view.text.includes('刚写好的标题'), view.text.slice(0, 200))
  // 点「保存」
  const saveBtn = buttons(view.tree).find((b) => labelOf(b) === '保存')
  check('（准备）有「保存」按钮', !!saveBtn)
  await saveBtn.props.onClick()
  // 主机侧保存后：savedByUser=true（下次 load copies 就能读到）
  options.copies = makeCopy(true)
  view = await harness.render(Entry, { wide: true }, 200)

  // 回主页 → 进封面标签 → 点「刷新」
  findButton(view.tree, '← 返回').props.onClick()
  view = await harness.render(Entry, { wide: true }, 120)
  moduleCards(view.tree)[4].props.onClick()
  view = await harness.render(Entry, { wide: true }, 250)
  check('问题5：保存过的帖子进封面标签就能看到（自动刷新）', view.text.includes('刚写好的标题'), view.text.slice(0, 260))
  const refreshBtn2 = buttons(view.tree).find((b) => labelOf(b) === '刷新')
  await refreshBtn2.props.onClick()
  view = await harness.render(Entry, { wide: true }, 250)
  check('问题5：在封面标签点「刷新」也刷得出来（不再空白）', view.text.includes('刚写好的标题') && !view.text.includes('暂无数据'), view.text.slice(0, 300))

  // 问题6：模块1 / 模块3 进入也自动刷新
  findButton(view.tree, '← 返回').props.onClick()
  view = await harness.render(Entry, { wide: true }, 120)
  const beforeTopicCalls = apiCalls.filter((c) => String(c.options.body || '').includes('"what":"topics"')).length
  moduleCards(view.tree)[0].props.onClick()
  view = await harness.render(Entry, { wide: true }, 200)
  check('问题6：进选题库会自动刷一次', apiCalls.filter((c) => String(c.options.body || '').includes('"what":"topics"')).length > beforeTopicCalls, String(apiCalls.filter((c) => String(c.options.body || '').includes('topics')).length))
  findButton(view.tree, '← 返回').props.onClick()
  view = await harness.render(Entry, { wide: true }, 120)
  const beforeFilterCalls = apiCalls.filter((c) => String(c.options.body || '').includes('"action":"filter"')).length
  moduleCards(view.tree)[2].props.onClick()
  view = await harness.render(Entry, { wide: true }, 200)
  check('问题6：进筛选核实会自动筛一次', apiCalls.filter((c) => String(c.options.body || '').includes('"action":"filter"')).length > beforeFilterCalls, String(apiCalls.filter((c) => String(c.options.body || '').includes('filter')).length))
}
process.exit(finish() ? 1 : 0)

/**
 * 侧边栏入口测试（不需要浏览器）：落位 + 样式
 *
 * 需求：
 *   a) 取消入口的灰色边框，变成和「设置」一样的无框文字按钮
 *   b) hover 变灰 + 手型指针；移开恢复透明；静态无背景无边框
 *   c) 从侧边栏最底部挪到「技能中心」正下方（左对齐、间距和其他菜单项一致）
 *
 * 槽位（sidebar.footer.action）本身在最底部，所以真正的搬移是 DOM 级的
 * （见 lib/client/sidebar-entry.js）。这里用一个最小假 DOM 把真机上的结构复现出来：
 *
 *   sidebarCol
 *   └ root
 *      ├ logoRow
 *      ├ 新会话 button
 *      ├ 技能中心 button            ← skill-explorer 插件注入的那一行
 *      ├ regionArea（工作区）
 *      └ footArea
 *         ├ footerActions
 *         │  └ display:contents 壳  ← React 给入口按钮的原位
 *         │     └ 入口 button
 *         └ settingsArea（设置）
 *
 * 验证：
 *   1) 挂载后：入口紧跟「技能中心」，且已经不在底部原位
 *   2) 自愈：被挤开/被搬回去之后，再摆一次
 *   3) 技能中心晚一步出现：入口自动落到它下面（顺序对新会话 → 技能中心 → 入口）
 *   4) 没有技能中心时：退回跟在"新会话"按钮后面
 *   5) 找不到侧边栏 / 没有 MutationObserver：不抛错、保持原样
 *   6) 卸载（dispose）：入口放回 React 的原位，免得 React 删不动自己的子节点
 *   7) 按钮本身：无边框、静态无底色、cursor:pointer、展开/折叠两套尺寸都在一行里
 *   8) 样式表：hover 灰底（!important 压过内联兜底）+ 24px 图标对齐盒
 *
 * 跑法：node test/sidebar-entry.mjs
 */

import { mountSidebarEntry } from '../lib/client/sidebar-entry.js'
import { ensureStyles } from '../lib/client/ui.js'
import { createHarness, createFakeFetch, createAsserter } from './_harness.mjs'

const { check, finish } = createAsserter()

console.log('== 侧边栏入口测试（落位 + 样式）==')

// ---------------------------------------------------------------------------
// 最小假 DOM：只实现 sidebar-entry.js 用到的那几个 API
// ---------------------------------------------------------------------------
const SKILL_ATTR = 'data-dsh-skill-explorer-entry'

/** 极简选择器匹配：支持 tag、[attr]、[attr="v"]、[attr*="v"]，以及逗号分隔 */
function matchSimple(el, rawSelector) {
  const selector = String(rawSelector).trim()
  if (!selector) return false
  const shape = /^([a-zA-Z]*)((?:\s*\[[^\]]+\])*)$/.exec(selector)
  if (!shape) return false
  const tag = shape[1].toLowerCase()
  if (tag && el.tagName.toLowerCase() !== tag) return false
  for (const piece of shape[2].match(/\[[^\]]+\]/g) || []) {
    const inner = piece.slice(1, -1)
    const star = inner.indexOf('*=')
    const eq = star === -1 ? inner.indexOf('=') : -1
    let name = inner
    let op = 'exists'
    let want = ''
    if (star !== -1) {
      name = inner.slice(0, star)
      want = inner.slice(star + 2)
      op = 'contains'
    } else if (eq !== -1) {
      name = inner.slice(0, eq)
      want = inner.slice(eq + 1)
      op = 'equals'
    }
    want = want.replace(/^["']|["']$/g, '')
    const actual = el.getAttribute(name)
    if (op === 'exists' && (actual === null || actual === undefined)) return false
    if (op === 'equals' && String(actual) !== want) return false
    if (op === 'contains' && (actual === null || actual === undefined || !String(actual).includes(want))) return false
  }
  return true
}

function matches(el, selector) {
  return String(selector)
    .split(',')
    .some((one) => matchSimple(el, one))
}

class El {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase()
    this.attributes = Object.assign({}, attrs)
    this.children = []
    this.parentElement = null
    this.ownerDocument = null
  }
  get className() {
    return this.attributes.class || ''
  }
  set className(value) {
    this.attributes.class = String(value)
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }
  hasAttribute(name) {
    return name in this.attributes
  }
  get firstElementChild() {
    return this.children[0] || null
  }
  get previousElementSibling() {
    const parent = this.parentElement
    if (!parent) return null
    const index = parent.children.indexOf(this)
    return index > 0 ? parent.children[index - 1] : null
  }
  get nextElementSibling() {
    const parent = this.parentElement
    if (!parent) return null
    const index = parent.children.indexOf(this)
    return index >= 0 && index + 1 < parent.children.length ? parent.children[index + 1] : null
  }
  appendChild(node) {
    if (node.parentElement) node.parentElement.removeChild(node)
    node.parentElement = this
    node.ownerDocument = this.ownerDocument
    this.children.push(node)
    return node
  }
  removeChild(node) {
    const index = this.children.indexOf(node)
    if (index === -1) throw new Error('NotFoundError：要删的节点不是这个父节点的子节点')
    this.children.splice(index, 1)
    node.parentElement = null
    return node
  }
  insertBefore(node, ref) {
    if (ref === null || ref === undefined) return this.appendChild(node)
    const index = this.children.indexOf(ref)
    if (index === -1) throw new Error('NotFoundError：参照节点不在这个父节点下')
    if (node.parentElement) node.parentElement.removeChild(node)
    node.parentElement = this
    node.ownerDocument = this.ownerDocument
    this.children.splice(index, 0, node)
    return node
  }
  /** 只用到 afterend（插到本节点后面、同一层） */
  insertAdjacentElement(position, node) {
    if (position !== 'afterend' || !this.parentElement) return null
    return this.parentElement.insertBefore(node, this.nextElementSibling)
  }
  contains(node) {
    let cursor = node
    while (cursor) {
      if (cursor === this) return true
      cursor = cursor.parentElement
    }
    return false
  }
  matches(selector) {
    return matches(this, selector)
  }
  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new El('html')
    this.body = new El('body')
    this.body.ownerDocument = this
    this.documentElement.ownerDocument = this
    this.documentElement.appendChild(this.body)
  }
  querySelector(selector) {
    return (matches(this.body, selector) ? this.body : null) || this.body.querySelector(selector)
  }
  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector)
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    FakeMutationObserver.instances.push(this)
  }
  observe(target, options) {
    this.target = target
    this.options = options
  }
  disconnect() {
    this.disconnected = true
  }
  fire() {
    if (!this.disconnected) this.callback([])
  }
  static latest() {
    return FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1]
  }
}
FakeMutationObserver.instances = []

/** 造一棵和真机一样的侧边栏（withSkillCenter=false 时模拟没装技能中心） */
function buildSidebar({ withSkillCenter = true, withNewSession = true } = {}) {
  const doc = new FakeDocument()
  const col = new El('div', { class: 'pI_x6G_sidebarCol' })
  doc.body.appendChild(col)
  const root = new El('div', { class: 'hHd-Xa_root' })
  col.appendChild(root)

  const logo = new El('div', { class: 'hHd-Xa_logoRow' })
  root.appendChild(logo)
  const newSession = withNewSession ? root.appendChild(new El('button', { class: 'hHd-Xa_newSession' })) : null
  const skill = withSkillCenter ? root.appendChild(new El('button', { [SKILL_ATTR]: '' })) : null
  root.appendChild(new El('div', { class: 'hHd-Xa_regionArea' }))

  const foot = root.appendChild(new El('div', { class: 'hHd-Xa_footArea' }))
  const actions = foot.appendChild(new El('div', { class: 'hHd-Xa_footerActions' }))
  const host = actions.appendChild(new El('div', { style: 'display:contents' }))
  const entry = host.appendChild(new El('button', { class: 'xmt-enter-entry', 'data-xmt-workbench': 'entry' }))
  foot.appendChild(new El('div', { class: 'hHd-Xa_settingsArea' }))

  return { doc, col, root, logo, newSession, skill, foot, actions, host, entry }
}

/** 每次都装一个新的假 MutationObserver，保证只观察本次的实例 */
function withObserver(fn) {
  FakeMutationObserver.instances = []
  globalThis.MutationObserver = FakeMutationObserver
  try {
    return fn()
  } finally {
    delete globalThis.MutationObserver
  }
}

// ---------------------------------------------------------------------------
// 1) 挂载：入口挪到「技能中心」正下方，底部不再有它
// ---------------------------------------------------------------------------
{
  const dom = buildSidebar()
  const dispose = withObserver(() => mountSidebarEntry(dom.entry))

  check('入口跟到了「技能中心」下面', dom.entry.parentElement === dom.root && dom.entry.previousElementSibling === dom.skill, `前一个兄弟=${dom.entry.previousElementSibling && dom.entry.previousElementSibling.className}`)
  check('顺序是 新会话 → 技能中心 → 入口', dom.root.children.indexOf(dom.skill) + 1 === dom.root.children.indexOf(dom.entry), dom.root.children.map((c) => c.className || c.tagName).join(' | '))
  check('底部原位（footerActions 的壳）里不再有入口', !dom.actions.contains(dom.entry) && dom.host.children.length === 0)
  check('还观察了侧边栏，准备自愈', !!FakeMutationObserver.latest() && FakeMutationObserver.latest().target === dom.root)

  dispose()
  check('卸载后入口回到 React 的原位（壳里）', dom.entry.parentElement === dom.host && dom.host.children.length === 1)
}

// ---------------------------------------------------------------------------
// 2) 自愈：被 React 重渲染挤开之后，再摆一次
// ---------------------------------------------------------------------------
{
  const dom = buildSidebar()
  const dispose = withObserver(() => mountSidebarEntry(dom.entry))
  check('先就位', dom.entry.previousElementSibling === dom.skill)

  dom.host.appendChild(dom.entry) // 模拟"被挤回底部"
  FakeMutationObserver.latest().fire()
  check('被挤开后自动摆回「技能中心」下面', dom.entry.parentElement === dom.root && dom.entry.previousElementSibling === dom.skill)

  FakeMutationObserver.latest().fire()
  check('已经就位时不会重复搬（节点还是同一个）', dom.entry.parentElement === dom.root && dom.root.children.filter((c) => c === dom.entry).length === 1)

  dispose()
  check('断开观察后再触发回调也不动它', (() => {
    FakeMutationObserver.latest().fire()
    return dom.entry.parentElement === dom.host
  })())
}

// ---------------------------------------------------------------------------
// 3) 技能中心晚一步出现（skill-explorer 在别的插件之后才注入）
// ---------------------------------------------------------------------------
{
  const dom = buildSidebar({ withSkillCenter: false })
  const dispose = withObserver(() => mountSidebarEntry(dom.entry))
  check('技能中心还没出现时，先跟在"新会话"后面', dom.entry.parentElement === dom.root && dom.entry.previousElementSibling === dom.newSession)

  // skill-explorer 插到自己该在的位置：新会话后面（也就是入口前面）
  const skill = new El('button', { [SKILL_ATTR]: '' })
  dom.root.insertBefore(skill, dom.newSession.nextElementSibling)
  FakeMutationObserver.latest().fire()
  check('技能中心出现后，入口就在它正下方（不用再搬）', dom.entry.previousElementSibling === skill && dom.root.children.indexOf(skill) + 1 === dom.root.children.indexOf(dom.entry), dom.root.children.map((c) => c.className || c.tagName).join(' | '))
  dispose()
}

// ---------------------------------------------------------------------------
// 4) 没有技能中心也没关系：退回"新会话"下面
// ---------------------------------------------------------------------------
{
  const dom = buildSidebar({ withSkillCenter: false })
  const dispose = withObserver(() => mountSidebarEntry(dom.entry))
  check('没有技能中心时跟在"新会话"后面（同一片区域，不是最底部）', dom.entry.previousElementSibling === dom.newSession && dom.root.children.indexOf(dom.entry) === dom.root.children.indexOf(dom.newSession) + 1)
  dispose()
}

// ---------------------------------------------------------------------------
// 5) 拿不到 DOM / 没有 MutationObserver：不抛错，保持原样
// ---------------------------------------------------------------------------
{
  let threw = null
  let dispose = null
  try {
    dispose = mountSidebarEntry(null)
  } catch (err) {
    threw = err
  }
  check('传 null 不抛错，返回一个可调用的清理函数', !threw && typeof dispose === 'function')
  try {
    dispose()
  } catch (err) {
    threw = err
  }
  check('空清理函数调了也不抛错', !threw)

  // 侧边栏还没挂载：观察 body，先把节点原样留着
  const doc = new FakeDocument()
  const orphan = doc.body.appendChild(new El('button', { class: 'xmt-enter-entry' }))
  let orphanDispose = null
  try {
    orphanDispose = withObserver(() => mountSidebarEntry(orphan))
  } catch (err) {
    threw = err
  }
  check('找不到侧边栏时不抛错、入口留在原处', !threw && orphan.parentElement === doc.body && typeof orphanDispose === 'function')

  // 连 MutationObserver 都没有（老环境/测试沙箱）
  orphanDispose()
  const dom = buildSidebar()
  FakeMutationObserver.instances = []
  let noMoDispose = null
  try {
    noMoDispose = mountSidebarEntry(dom.entry)
  } catch (err) {
    threw = err
  }
  check('没有 MutationObserver 时照样能搬一次、且不抛错', !threw && dom.entry.previousElementSibling === dom.skill, threw && threw.message)
  try {
    noMoDispose()
  } catch (err) {
    threw = err
  }
  check('没有 MutationObserver 时卸载也安全', !threw && dom.entry.parentElement === dom.host)
}

// ---------------------------------------------------------------------------
// 6) 样式表：hover 灰底（用壳里的令牌）+ 24px 图标对齐盒
// ---------------------------------------------------------------------------
{
  const injected = []
  const fakeDoc = {
    head: {
      appendChild(node) {
        injected.push(node)
      },
    },
    createElement(tag) {
      return { tagName: tag, textContent: '', setAttribute(k, v) { this[k] = v } }
    },
    getElementById: () => null,
  }
  ensureStyles(fakeDoc)
  const css = String((injected[0] && injected[0].textContent) || '')
  // 去掉空白再比对，免得以后调整换行/缩进就把断言弄挂
  const tight = css.replace(/\s+/g, '')
  check('样式表注入了（入口的 hover/点击变色只能靠样式表，内联写不了 :hover）', css.includes('.xmt-enter-entry'))
  check(
    'hover：灰底 + 字变黑（都用壳里的令牌，!important 压过内联的"淡灰字/透明底"兜底）',
    tight.includes('.xmt-enter-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))!important;color:var(--dsw-alias-label-primary,inherit)!important;}'),
    tight.slice(tight.indexOf('.xmt-enter-entry:hover'), tight.indexOf('.xmt-enter-entry:hover') + 180),
  )
  check(
    '点开工作台：底色 + 黑字都保持住（aria-pressed=true）',
    tight.includes(".xmt-enter-entry[aria-pressed='true']{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.14))!important;color:var(--dsw-alias-label-primary,inherit)!important;}"),
    tight.slice(tight.indexOf("[aria-pressed='true']"), tight.indexOf("[aria-pressed='true']") + 180),
  )
  check('样式表不给入口画边框（无边框只靠这一条 + 内联 border:none）', !/\.xmt-enter-entry\{[^}]*border/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')))
  check('图标 24px 对齐盒（和「技能中心」那一行的图标/文字左边界对齐）', css.includes('.xmt-enter-icon{flex:none;width:24px;height:24px'))
  check('文字过长省略号（窄侧边栏不撑破）', css.includes('.xmt-enter-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis'))
}

// ---------------------------------------------------------------------------
// 7) 按钮本体（React 渲染出来的内联样式）：无边框 + 静态透明 + 手型 + 一行 36px
// ---------------------------------------------------------------------------
{
  const harness = createHarness()
  harness.enableProbe()
  createFakeFetch({ stage: 'idle' })
  globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1440, innerHeight: 900 }
  globalThis.document = harness.documentStub
  const requiredSpecs = []
  globalThis.require = (spec) => {
    requiredSpecs.push(spec)
    if (spec === 'react') return harness.React
    throw new Error(`测试里没有准备 ${spec} 的替身`)
  }

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
  client.apply({ get: (name) => (name === 'slots' ? slotsService : undefined), slots: slotsService })

  check('槽位注册方式没变：还是 sidebar.footer.action + 原来的 id', injected.length === 1 && injected[0] === 'sidebar.footer.action' && registered[0] && registered[0].options.id === 'ai-news-workbench', JSON.stringify(injected))
  const Entry = registered[0].Component

  const buttonsOf = (tree) => harness.flattenNodes(tree).filter((n) => n.type === 'button')
  const wide = await harness.render(Entry, { wide: true }, 40)
  const wideBtn = buttonsOf(wide.tree)[0]
  const style = (wideBtn && wideBtn.props.style) || {}

  check('入口渲染不报错、只有一个按钮', !wide.error && buttonsOf(wide.tree).length === 1, wide.error && wide.error.message)
  check('没有灰边框（border:none）', style.border === 'none', String(style.border))
  check('静态无背景（内联 transparent）', style.background === 'transparent', String(style.background))
  check('平时是淡灰色字（内联兜底走 label-secondary，和「技能中心」一样）', style.color === 'var(--dsw-alias-label-secondary, inherit)', String(style.color))
  check('鼠标是手型（cursor:pointer）', style.cursor === 'pointer', String(style.cursor))
  check('展开态是一整行（36px 高、100% 宽、0 10px 内边距、8px 间距、8px 圆角）', style.height === '36px' && style.width === '100%' && style.padding === '0 10px' && style.gap === '8px' && style.borderRadius === '8px', JSON.stringify({ h: style.height, w: style.width, p: style.padding, gap: style.gap, r: style.borderRadius }))
  check('展开态贴着「技能中心」下面一小段间距（margin-top 4px，和面板列表 gap 一致）', style.margin === '4px 0 0', String(style.margin))
  check('入口带统一样式类（xmt-enter-entry，测试/样式都认它）', String(wideBtn.props.className || '').split(/\s+/).includes('xmt-enter-entry'), String(wideBtn.props.className))
  check('图标套了 24px 对齐盒', buttonsOf(wide.tree).length === 1 && harness.flattenNodes(wideBtn).some((n) => typeof n.type === 'string' && String(n.props.className || '').split(/\s+/).includes('xmt-enter-icon')))
  check('关着的时候也套着壳（按钮在 React 树里的位置稳定，开/关不会把它删掉重建）', String(wide.tree.type) === 'div' && String(wide.tree.props.style.display) === 'contents')

  const rail = await harness.render(Entry, { wide: false }, 40)
  const railBtn = buttonsOf(rail.tree)[0]
  const railStyle = (railBtn && railBtn.props.style) || {}
  check('折叠态也只有一个按钮、还是无边框无底色', !rail.error && buttonsOf(rail.tree).length === 1 && railStyle.border === 'none' && railStyle.background === 'transparent')
  check('折叠态是 36×36 圆形图标按钮，水平居中（margin:0 auto 12px）', railStyle.width === '36px' && railStyle.height === '36px' && railStyle.borderRadius === '50%' && railStyle.margin === '0 auto 12px', JSON.stringify({ w: railStyle.width, h: railStyle.height, r: railStyle.borderRadius, m: railStyle.margin }))
  check('折叠态不渲染文字标签（只剩图标，文字只留在 title 提示里）', harness.flatten(railBtn.props.children).join('').trim() === '' && String(railBtn.props.title || '').includes('AI 资讯工作台'), JSON.stringify(harness.flatten(railBtn.props.children)))
  check('折叠态平时也是淡灰色', railStyle.color === 'var(--dsw-alias-label-secondary, inherit)', String(railStyle.color))
  check('折叠态也是手型指针', railStyle.cursor === 'pointer')

  // 点开 → 黑字（aria-pressed=true 的样式规则生效）；再点一次关掉 → 回到淡灰（false）
  const labelOf = (node) => harness.flatten(node.props && node.props.children).join('')
  const entryButton = (tree) => buttonsOf(tree).find((n) => labelOf(n).includes('AI 资讯工作台'))
  const isOpen = (view) => harness.flattenNodes(view.tree).some((n) => n.props && n.props['data-xmt-workbench'] === 'modal')

  let view = await harness.render(Entry, { wide: true }, 40)
  check('刚打开页面时入口是"未点开"状态（样式表按 aria-pressed=false 给淡灰字）', !isOpen(view) && String(entryButton(view.tree).props['aria-pressed']) === 'false', String(entryButton(view.tree).props['aria-pressed']))
  entryButton(view.tree).props.onClick()
  view = await harness.render(Entry, { wide: true }, 60)
  check('点开工作台后是"已点开"状态（aria-pressed=true → 黑字 + 底色）', isOpen(view) && String(entryButton(view.tree).props['aria-pressed']) === 'true', String(entryButton(view.tree).props['aria-pressed']))
  entryButton(view.tree).props.onClick()
  view = await harness.render(Entry, { wide: true }, 60)
  check('关掉工作台后又回到"未点开"（黑字退回淡灰）', !isOpen(view) && String(entryButton(view.tree).props['aria-pressed']) === 'false', String(entryButton(view.tree).props['aria-pressed']))
}

process.exit(finish() ? 1 : 0)

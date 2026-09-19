/**
 * AI 资讯工作台 —— 界面侧入口
 *
 * 交互（按需求）：
 *  1) 侧边栏只放**一个入口按钮**：注册在官方的 `sidebar.footer.action` 槽位上，
 *     渲染出来后由 `sidebar-entry.js` 搬到「技能中心」正下方（带自愈 + 卸载还原）
 *  2) 点它 → 弹出**全屏工作台弹窗**，覆盖在右侧聊天/内容区之上
 *     - 不占用会话标签页（不再挤在「对话」「轨迹」旁边）
 *     - **不盖住左侧侧边栏**：弹窗的左边界按侧边栏实际宽度算出来
 *  3) 弹窗右上角「×」关闭，回到正常聊天界面
 *
 * 防崩：
 *  - `inject: ['slots']`（必须声明，否则 apply 会在服务就绪前执行、注册全失效）
 *  - 所有注册、定位、渲染都包在 try/catch 里；组件套错误边界
 *  - 拿不到侧边栏宽度时退回"不盖住最左侧 260px"，最多盖住一点点，不会整个糊住
 */

import { createWorkbench } from './workbench.js'
import { mountSidebarEntry } from './sidebar-entry.js'
import { closeWorkbench, getSnapshot, openWorkbench, subscribe } from './store.js'
import { CLS, ensureStyles, ST } from './ui.js'
export const name = 'ai-news-workbench-ui'

/** 必须声明 slots：平台会等这个服务就绪之后才调用 apply */
export const inject = ['slots']

/** 侧边栏槽位里的入口 id */
const SLOT_ID = 'ai-news-workbench'

/** 侧边栏宽度兜底值（量不到真实宽度时用它，保证不盖住左侧栏） */
const SIDEBAR_FALLBACK_WIDTH = 300

/**
 * ⚠ 弹窗左边界与导航栏之间**不再写死任何像素**：
 *   量到的导航栏右边缘写进 CSS 变量 --xmt-nav-edge，
 *   真正生效的 left 由样式表里的 calc(var(--xmt-nav-edge) + var(--xmt-nav-gap)) 算出来，
 *   --xmt-nav-gap 默认 0px（＝紧贴导航栏右边缘）。想留缝只改这一个变量。
 */

/** 上一次量到的侧边栏宽度（量失败时优先沿用它，而不是退回 0） */
let lastSidebarEdge = 0

/** 没有 useSyncExternalStore 时的兜底订阅（React 17 也能跑） */
function useSnapshotFallback(reactImpl) {
  const [snap, setSnap] = reactImpl.useState(getSnapshot)
  reactImpl.useEffect(() => {
    const unsub = subscribe(() => setSnap(getSnapshot()))
    setSnap(getSnapshot())
    return typeof unsub === 'function' ? unsub : undefined
  }, [])
  return snap
}

export function apply(ctx) {
  // 平台注入的 require 只用来拿 react（不依赖别的客户端模块，加载顺序上最安全）
  const requireFn = typeof require === 'function' ? require : null
  if (!requireFn) throw new Error('客户端模块加载器没有提供 require，无法拿到 react')
  const react = requireFn('react')
  const h = react.createElement

  // 测试探针：只有测试脚手架打开开关时才生效（生产环境走不到）
  if (globalThis.__XMT_TEST_HARNESS__ === true && typeof globalThis.__XMT_TEST_PROBE__ === 'function') {
    try {
      globalThis.__XMT_TEST_PROBE__(react)
    } catch (err) {
      try {
        console.error('[ai-news-workbench] 测试探针执行失败：', err)
      } catch (logErr) {
        /* 忽略 */
      }
    }
  }

  // 深色玻璃拟态样式表（hook / :active / 动画都靠它；注入失败只丢视觉）
  try {
    ensureStyles(typeof document !== 'undefined' ? document : null)
  } catch (err) {
    /* 忽略 */
  }

  /** 出错时兜底显示的小卡片（避免整块区域空白，方便排查） */
  function FailCard(message) {
    return h(
      'div',
      {
        className: CLS.msgBad,
        style: { maxWidth: '460px', margin: '8px 0' },
        title: String(message || ''),
      },
      '⚠ AI 资讯工作台加载失败。点这里看详情；这不影响聊天，刷新页面可恢复。',
    )
  }

  /** 错误边界：任何渲染错误只替换这块内容，不拖垮整个页面 */
  class Boundary extends react.Component {
    constructor(props) {
      super(props)
      this.state = { error: null }
    }
    static getDerivedStateFromError(error) {
      return { error }
    }
    componentDidCatch(error) {
      try {
        console.error('[ai-news-workbench] 界面渲染出错：', error)
      } catch (err) {
        /* 忽略 */
      }
    }
    render() {
      if (this.state.error) return FailCard((this.state.error && this.state.error.message) || this.state.error)
      return this.props.children
    }
  }

  /** 用错误边界包一层 */
  function Guarded(props) {
    return h(Boundary, null, h(props.Comp, props.compProps || {}))
  }

  // 建工作台组件（失败也要能加载插件）
  let Workbench = null
  try {
    Workbench = createWorkbench(react)
  } catch (err) {
    try {
      console.error('[ai-news-workbench] 界面初始化失败：', err)
    } catch (logErr) {
      /* 忽略 */
    }
    const Broken = () => FailCard(`界面初始化失败：${(err && err.message) || err}`)
    Workbench = Broken
  }

  /**
   * 量"视口尺寸"（拿不到就退回 1280×800）
   *
   * ⚠ 这里刻意只算视口和侧边栏右边界，**不去量右侧内容区**。
   *  踩过的坑：之前按内容区 rect 算 right = 视口宽 - 内容区右边界，
   *  结果量到了一个贴右边的窄元素，弹窗被压成屏幕最右边 1 像素宽的一条缝，
   *  看起来就像"点了按钮没反应"。弹窗本来就是全屏浮层，
   *  左边让开侧边栏、其余铺满视口，最稳。
   */
  function viewportSize() {
    let width = 0
    let height = 0
    try {
      if (typeof window !== 'undefined') {
        width = Number(window.innerWidth) || 0
        height = Number(window.innerHeight) || 0
      }
    } catch (err) {
      /* 继续兜底 */
    }
    try {
      const de = typeof document !== 'undefined' ? document.documentElement : null
      if (!width && de && de.clientWidth) width = Number(de.clientWidth) || 0
      if (!height && de && de.clientHeight) height = Number(de.clientHeight) || 0
    } catch (err) {
      /* 继续兜底 */
    }
    return { width: width || 1280, height: height || 800 }
  }

  /**
   * 量"侧边栏右边界"：这就是弹窗的左边界，保证**永不盖住左侧栏**。
   *
   * 两条硬要求（都踩过坑）：
   *  1) **不许算出 0**：量不到时用记住的好值 / 兜底宽度，否则弹窗从视口最左边铺 → "变成全屏了"；
   *  2) **不许取到偏小的那个**：侧边栏常常是"外层留位 + 内层实际面板"两层，
   *     只按第一个命中的（比如外层的占位宽 206）算，弹窗还是压住侧边栏右半边。
   *     所以：把所有贴左边、够高的候选**都收集起来，取最右边的那条边界**（+ 一点余量），
   *     并且优先相信侧边栏那一侧的容器（不拿右边聊天区当侧边栏）。
   */
  function measureSidebarEdge() {
    const view = viewportSize()
    const apply = (edge) => {
      // 只有"彻底没量到"（0 / NaN / 小于一条边缝）才用记住的好值或兜底；
      // 量到的窄值（比如收起的细轨道 68px）是**真的**，照用，不算失败。
      const safe = Number.isFinite(edge) && edge >= 24 ? edge : Math.max(SIDEBAR_FALLBACK_WIDTH, lastSidebarEdge || 0)
      // 不再额外加余量：量到的就是导航栏右边缘，弹窗从这里开始（缝隙交给 CSS 的 --xmt-nav-gap）
      const capped = Math.min(safe, Math.max(0, view.width - 120))
      lastSidebarEdge = Math.min(safe, capped)
      return Math.round(capped)
    }
    try {
      const doc = typeof document !== 'undefined' ? document : null
      if (!doc || typeof doc.querySelectorAll !== 'function') return apply(0)

      const onLeft = (rect) => rect.left <= 8
      const tallEnough = (rect) => rect.height > Math.max(160, view.height * 0.4)
      // 侧边栏不可能超过视口宽的 45%（超过的肯定是右边的主内容区，别拿它当侧边栏）
      const sidebarMax = Math.max(260, view.width * 0.45)
      const wideEnough = (rect) => rect.width >= 24 && rect.width <= Math.min(460, sidebarMax)

      const rectOf = (el) => {
        try {
          const rect = el.getBoundingClientRect()
          return rect && rect.width > 0 ? rect : null
        } catch (err) {
          return null
        }
      }

      // 只要"最右边那条边界"，所以取最大值（而不是碰到第一个就收工）
      let edge = 0
      const take = (el, depth) => {
        let node = el
        for (let i = 0; node && i <= depth; i++) {
          const rect = rectOf(node)
          if (rect && onLeft(rect) && tallEnough(rect) && wideEnough(rect)) edge = Math.max(edge, rect.right)
          node = node && node.parentElement
        }
      }

      // ① 明确是侧边栏/侧栏轨道的元素（含它们的祖先，兼容"外层留位"结构）
      let stack = []
      try {
        stack = Array.from(doc.querySelectorAll('[class*="SidebarRoot"], [class*="sidebar"], [class*="SideBar"], [class*="side-nav"], [class*="sideNav"], aside, [class*="rail"]'))
      } catch (err) {
        stack = []
      }
      for (const el of stack) take(el, 4)

      // ② 没量到的话：不限 class 名，扫前 300 个里"贴左边 + 竖长条"的最宽边界
      if (edge < 24) {
        let list = []
        try {
          list = Array.from(doc.querySelectorAll('div, aside, nav, section'))
        } catch (err) {
          list = []
        }
        for (const el of list.slice(0, 300)) {
          const rect = rectOf(el)
          if (!rect || !onLeft(rect) || !tallEnough(rect) || !wideEnough(rect)) continue
          edge = Math.max(edge, rect.right)
        }
      }

      return apply(edge)
    } catch (err) {
      return apply(0)
    }
  }

  /**
   * 弹窗位置：左边让开侧边栏，上/右/下都贴视口边（= 覆盖右侧聊天/内容区）。
   * 只依赖侧边栏右边界，不会再被"量错内容区"压成一条缝。
   */
  function measureLayout() {
    try {
      const view = viewportSize()
      const sidebarEdge = Math.max(0, Math.min(measureSidebarEdge(), view.width - 120))
      return {
        left: sidebarEdge,
        top: 0,
        right: 0,
        bottom: 0,
        width: Math.max(0, view.width - sidebarEdge),
        height: view.height,
        sidebarWidth: sidebarEdge,
      }
    } catch (err) {
      return null
    }
  }

  /** 全屏工作台弹窗：固定定位，从侧边栏右边一直铺到视口四边（不盖左侧栏） */
  function WorkbenchModal(props) {
    const [layout, setLayout] = react.useState(() => measureLayout())

    react.useEffect(() => {
      let timer = null
      const remeasure = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          try {
            setLayout(measureLayout())
          } catch (err) {
            /* 忽略 */
          }
        }, 120)
      }
      try {
        if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener('resize', remeasure)
          window.addEventListener('scroll', remeasure, true)
        }
      } catch (err) {
        /* 忽略 */
      }
      remeasure() // 打开瞬间再量一次（侧边栏可能刚展开/收起）

      // 侧边栏可能会在打开后一小会儿才落位（展开动画 / 异步渲染），
      // 这里的短轮询只在"量到的左边界变了"时才更新，避免弹窗位置卡在旧值上（"变成全屏"的另一种成因）。
      let probe = null
      let probeCount = 0
      try {
        probe = setInterval(() => {
          probeCount++
          try {
            const next = measureLayout()
            setLayout((prev) => {
              const changed = !prev || Math.abs((prev.left || 0) - (next.left || 0)) > 1 || Math.abs((prev.width || 0) - (next.width || 0)) > 1
              return changed ? next : prev
            })
          } catch (err) {
            /* 忽略 */
          }
          if (probeCount >= 8 && probe) {
            clearInterval(probe)
            probe = null
          }
        }, 500)
      } catch (err) {
        probe = null
      }

      // 滚动锁：弹窗铺满右侧时，别让底下的聊天区跟着一起滚（关掉弹窗会还原）
      let restoreScroll = null
      try {
        const body = typeof document !== 'undefined' ? document.body : null
        if (body && body.style) {
          const before = body.style.overflow
          body.style.overflow = 'hidden'
          restoreScroll = () => {
            try {
              body.style.overflow = before || ''
            } catch (err) {
              /* 忽略 */
            }
          }
        }
      } catch (err) {
        restoreScroll = null
      }

      return () => {
        if (timer) clearTimeout(timer)
        if (probe) {
          clearInterval(probe)
          probe = null
        }
        if (restoreScroll) restoreScroll()
        try {
          if (typeof window !== 'undefined' && window.removeEventListener) {
            window.removeEventListener('resize', remeasure)
            window.removeEventListener('scroll', remeasure, true)
          }
        } catch (err) {
          /* 忽略 */
        }
      }
    }, [])

    // Esc 关闭
    react.useEffect(() => {
      const onKey = (event) => {
        try {
          if (event && event.key === 'Escape') props.onClose()
        } catch (err) {
          /* 忽略 */
        }
      }
      try {
        if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', onKey)
      } catch (err) {
        /* 忽略 */
      }
      return () => {
        try {
          if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('keydown', onKey)
        } catch (err) {
          /* 忽略 */
        }
      }
    }, [props.onClose])

    // ⚠ 只认 left/top/height，不再用 right/bottom 反推 —— 免得又被算成一条缝
    const box = layout || { left: SIDEBAR_FALLBACK_WIDTH, top: 0, width: viewportSize().width - SIDEBAR_FALLBACK_WIDTH, height: viewportSize().height }
    return h(
      'div',
      {
        'data-xmt-workbench': 'modal',
        className: CLS.root,
        style: Object.assign(
          {
            position: 'fixed',
            // 弹窗左边界：**用 CSS 变量 + calc 算**，不写死像素 ——
            // 导航栏宽度是动态的（展开/收起不一样），所以由脚本量出来写进 --xmt-nav-edge；
            // --xmt-nav-gap 是"想让多少缝"，默认 0px（紧贴导航栏右边缘）。
            left: 'calc(var(--xmt-nav-edge, 0px) + var(--xmt-nav-gap, 0px))',
            top: `${box.top}px`,
            right: 0,
            height: `${box.height}px`,
            zIndex: 1400,
            // 面板尺寸、圆角、内边距、滚动都在样式表里（.xmt-panel / .xmt-overlay / .xmt-panel-scroll）：
            // 这里只给"必须内联"的定位
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            // 量到的导航栏右边缘（动态值，脚本每次重新测量都会更新）
            '--xmt-nav-edge': `${box.left}px`,
            // 弹窗与导航栏之间的缝：想留缝就改这一个数，别去动 left
            '--xmt-nav-gap': '0px',
            // 背景层/提示浮层的左边界都跟着这条走，保证它们和面板严丝合缝
            '--xmt-modal-left': 'calc(var(--xmt-nav-edge, 0px) + var(--xmt-nav-gap, 0px))',
          },
          // 兜底底色只染"右侧这块"（不是整个视口），样式表没注入也不会漏出后面的聊天
          ST.rootVars,
        ),
      },
      // 没有标题栏：直接铺内容（关闭方式是再点一次侧边栏入口，或按 Esc）
      // 背景只在 .xmt-panel-scroll 那一层画一次（fixed 钉在视口上，滚到底不断层）；
      // 弹窗外壳不再单独铺背景，免得把整块渐变切断。
      // .xmt-overlay：fixed 浮层（不挤下面主界面，左边让开侧边栏）
      // .xmt-panel-scroll：面板内部自己滚动（内容超高时能上下滑）
      // .xmt-panel-glow：背景上那层"会飘会呼吸"的柔光（真正的 CSS @keyframes 动画）。
      //   fixed 钉在视口上、永远在最底下、pointer-events:none —— 卡片布局和点击完全不受影响。
      h(
        'div',
        { className: CLS.overlay },
        h(
          'div',
          { className: CLS.panel },
          h(
            'div',
            { className: CLS.panelScroll },
            h('div', { className: CLS.panelGlow, 'aria-hidden': 'true' }),
            h(Guarded, { Comp: Workbench, compProps: { onClose: props.onClose, inModal: true } }),
          ),
        ),
      ),
    )
  }

  /** 侧边栏入口：按钮 + 弹窗（同一个组件实例，共享 open 状态） */
  function SidebarEntry(props) {
    const wide = !!(props && props.wide)
    const snap = typeof react.useSyncExternalStore === 'function' ? react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot) : useSnapshotFallback(react)
    const open = !!(snap && snap.open)

    /** 同一个按钮当开关：关着就打开，已经打开就关掉（弹窗没标题栏了，这是主要的关闭方式） */
    const onToggle = () => {
      try {
        if (open) closeWorkbench()
        else openWorkbench()
      } catch (err) {
        try {
          console.error('[ai-news-workbench] 切换工作台开关失败：', err)
        } catch (logErr) {
          /* 忽略 */
        }
      }
    }

    const spark = h(
      'svg',
      { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('path', { d: 'M8 1.8l1.6 4 4 1.6-4 1.6L8 13l-1.6-4-4-1.6 4-1.6L8 1.8z' }),
    )

    /** 图标外面套一层 24px 的盒子：这样图标和文字的左边界都和「技能中心」那一行对齐 */
    const icon = h('span', { className: CLS.enterIcon, 'aria-hidden': 'true' }, spark)

    /** 有 useLayoutEffect 就用它：卸载清理必须赶在 React 删节点之前跑（见 sidebar-entry.js） */
    const useIsoLayoutEffect = react.useLayoutEffect || react.useEffect
    const entryRef = react.useRef(null)

    /**
     * 落位：槽位（sidebar.footer.action）只能给到侧边栏最底部，
     * 这里把渲染出来的按钮搬到「技能中心」正下方；返回的清理函数会把它放回原位。
     * 拿不到真实 DOM（比如测试脚手架）时是空操作，不影响渲染。
     */
    useIsoLayoutEffect(() => {
      const node = entryRef.current
      if (!node) return undefined
      return mountSidebarEntry(node)
    }, [])

    // 需求：无边框 + 平时淡灰字 + 静态无底色
    // （hover / 点开后的"黑字 + 灰底"只能靠样式表，内联会盖掉 :hover）
    const baseStyle = {
      boxSizing: 'border-box',
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, inherit)',
      fontFamily: 'inherit',
      cursor: 'pointer',
      flex: 'none',
    }

    const button = wide
      ? h(
          'button',
          {
            type: 'button',
            ref: entryRef,
            title: open ? '收起 AI 资讯工作台（回到聊天）' : '打开 AI 资讯工作台（全屏弹窗，不盖左侧栏）',
            'aria-pressed': open ? 'true' : 'false',
            onClick: onToggle,
            'data-xmt-workbench': 'entry',
            className: CLS.enterBtn,
            style: Object.assign({}, baseStyle, {
              // 展开态：和「技能中心」一样是一整行文字按钮（36px 高、0 10px 内边距、8px 间距）
              width: '100%',
              height: '36px',
              margin: '4px 0 0',
              padding: '0 10px',
              borderRadius: '8px',
              fontSize: '13px',
              lineHeight: '1',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: '8px',
            }),
          },
          icon,
          h('span', { className: CLS.enterLabel }, 'AI 资讯工作台'),
        )
      : h(
          'button',
          {
            type: 'button',
            ref: entryRef,
            title: open ? '收起 AI 资讯工作台' : 'AI 资讯工作台',
            'aria-pressed': open ? 'true' : 'false',
            onClick: onToggle,
            'data-xmt-workbench': 'entry',
            className: CLS.enterBtn,
            style: Object.assign({}, baseStyle, {
              // 折叠态：细轨道里就是一个圆形图标按钮，水平居中，间距和其他图标项一致
              width: '36px',
              height: '36px',
              margin: '0 auto 12px',
              padding: '0',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }),
          },
          icon,
        )

    // 关着也套一层 display:contents 的壳：按钮在 React 树里的位置必须**始终不变**。
    // 否则开/关会把它删掉重建，而它已经被搬到别处，React 会删不动（见 sidebar-entry.js 的说明）。
    // 壳是 display:contents，不占位、不影响侧边栏布局。
    return h('div', { style: { display: 'contents' } }, button, open ? h(WorkbenchModal, { onClose: () => closeWorkbench() }) : null)
  }

  // 取槽位服务（声明了 inject: ['slots']，正常一定拿得到）
  const slots = (() => {
    try {
      if (ctx && ctx.slots && typeof ctx.slots.inject === 'function') return ctx.slots
    } catch (err) {
      /* 继续尝试 */
    }
    try {
      return typeof ctx.get === 'function' ? ctx.get('slots') : null
    } catch (err) {
      return null
    }
  })()
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    try {
      console.warn('[ai-news-workbench] 槽位服务不可用，工作台界面没有注册（聊天功能不受影响）')
    } catch (err) {
      /* 忽略 */
    }
    return
  }

  try {
    slots.inject('sidebar.footer.action', () =>
      slots.register(
        {
          name: 'sidebar.footer.action',
          id: SLOT_ID,
          order: 20,
        },
        SidebarEntry,
      ),
    )
  } catch (err) {
    try {
      console.error('[ai-news-workbench] 注册侧边栏入口失败：', err)
    } catch (logErr) {
      /* 忽略 */
    }
  }
}

export default { name, inject, apply }

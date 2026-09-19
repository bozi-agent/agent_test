/**
 * AI 资讯工作台 —— 侧边栏入口的"落位"（纯 DOM，不碰 React 树）
 *
 * 为什么需要它：
 *   DSH 的侧边栏壳只开放了一个入口槽位 `sidebar.footer.action`，它的位置就是
 *   侧边栏**最底部**（"设置"上面那一行）。需求要把入口挪到「技能中心」正下方，
 *   而侧边栏上半部分没有任何槽位能注册（「技能中心」自己也是 skill-explorer 插件
 *   用 DOM 注入进去的一行）。
 *
 *   所以这里的做法是：**槽位注册方式完全不动**（还是 `sidebar.footer.action`，
 *   组件还是那个 React 组件），只把 React 渲染出来的那个按钮节点搬到
 *   「技能中心」下面。React 依旧管着它的属性、样式和点击。
 *
 * 安全边界（都做到了才搬）：
 *  1) 只"搬"节点，不改节点：不克隆、不重建，事件与样式都不受影响；
 *  2) 自愈：技能中心晚一步出现、或者 React 重渲染把它挤开了，会自动再摆一次；
 *  3) 卸载时先放回原位，再让 React 去删它（否则 React 删一个"已经不在自己名下的
 *     子节点"会抛 NotFoundError，可能连累整个侧边栏）；
 *  4) 任何一步拿不到 DOM、或者找不到侧边栏/锚点，就原样不动 —— 最差也只是留在
 *     底部，功能不受影响。
 */

/** 「技能中心」那一行的标记（skill-explorer 插件注入时打的属性） */
const SKILL_CENTER_ATTR = 'data-dsh-skill-explorer-entry'

/** 「技能中心」行的选择器 */
const SKILL_CENTER_SELECTOR = `[${SKILL_CENTER_ATTR}]`

/** 兜底锚点：技能中心没装/被停用时，跟在"新会话"按钮后面（同一片区域） */
const NEW_SESSION_SELECTOR = 'button[class*="newSession"]'

/** 侧边栏：AppFrame 的 sidebarCol（class 名带 hash，用子串匹配） */
const SIDEBAR_COLUMN_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'

/** 侧边栏里品牌那一行，用它反推侧边栏根节点（skill-explorer 用的同一招） */
const LOGO_ROW_SELECTOR = '[class*="logoRow"]'

/** 取 MutationObserver（浏览器里有；测试/老环境里可能没有） */
function observerCtor() {
  try {
    if (typeof MutationObserver === 'function') return MutationObserver
    if (typeof window !== 'undefined' && typeof window.MutationObserver === 'function') return window.MutationObserver
  } catch (err) {
    /* 忽略 */
  }
  return null
}

/**
 * 找侧边栏根节点：它是 `display:flex;flex-direction:column` 的那一列，
 * 里面依次是 品牌行 / 新会话 / 全局面板 / 工作区 / 底部（设置）。
 */
function findRoot(doc) {
  try {
    if (!doc || typeof doc.querySelector !== 'function') return null
    const column = doc.querySelector(SIDEBAR_COLUMN_SELECTOR)
    if (!column) return null
    const logo = typeof column.querySelector === 'function' ? column.querySelector(LOGO_ROW_SELECTOR) : null
    return (logo && logo.parentElement) || column.firstElementChild || column
  } catch (err) {
    return null
  }
}

/** 锚点：优先「技能中心」那一行；没有就退回"新会话"按钮 */
function findAnchor(root) {
  try {
    if (!root || typeof root.querySelector !== 'function') return null
    return root.querySelector(SKILL_CENTER_SELECTOR) || root.querySelector(NEW_SESSION_SELECTOR) || null
  } catch (err) {
    return null
  }
}

/**
 * 已经在正确位置了吗？
 * 这条判断要够便宜 —— MutationObserver 每次回调都会问一遍。
 */
function alreadyPlaced(entry, root) {
  try {
    if (!entry || !root || entry.parentElement !== root) return false
    const prev = entry.previousElementSibling
    if (!prev) return false
    if (typeof prev.hasAttribute === 'function' && prev.hasAttribute(SKILL_CENTER_ATTR)) return true
    return !!(typeof prev.matches === 'function' && prev.matches(NEW_SESSION_SELECTOR))
  } catch (err) {
    return false
  }
}

/** 把入口节点插到锚点正下方（同一层、紧邻，左对齐与间距由按钮自身样式决定） */
function place(entry, root) {
  try {
    const anchor = findAnchor(root)
    if (!anchor || anchor === entry) return false
    if (entry.parentElement === root && entry.previousElementSibling === anchor) return true
    anchor.insertAdjacentElement('afterend', entry)
    return true
  } catch (err) {
    return false
  }
}

/**
 * 把侧边栏入口搬到「技能中心」下面，并保持住。
 *
 * @param entry - React 渲染出来的那个入口按钮节点
 * @returns 清理函数：断开监听，并把按钮放回原位（React 卸载前必须调）
 */
export function mountSidebarEntry(entry) {
  const noop = () => {}
  try {
    if (!entry || typeof entry.insertAdjacentElement !== 'function') return noop
    const doc = entry.ownerDocument || (typeof document !== 'undefined' ? document : null)
    if (!doc || typeof doc.querySelector !== 'function') return noop

    /** React 给它的原位（底部 footerActions 里那层 display:contents 壳），卸载时要还回去 */
    const home = entry.parentElement || null
    const MO = observerCtor()
    let root = null
    let observer = null

    const tryPlace = () => {
      if (!root) root = findRoot(doc)
      if (!root) return false
      if (alreadyPlaced(entry, root)) return true
      return place(entry, root)
    }

    tryPlace()

    if (MO) {
      try {
        observer = new MO(() => {
          tryPlace()
        })
        observer.observe(root || doc.body || doc.documentElement, { childList: true, subtree: true })
      } catch (err) {
        observer = null
      }
    }

    return function dispose() {
      try {
        if (observer && typeof observer.disconnect === 'function') observer.disconnect()
      } catch (err) {
        /* 忽略 */
      }
      observer = null
      try {
        if (home && entry.parentElement !== home) home.appendChild(entry)
      } catch (err) {
        /* 忽略：放不回去也不要抛，交给 React 自己的兜底 */
      }
    }
  } catch (err) {
    return noop
  }
}

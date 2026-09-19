/**
 * AI 资讯工作台 —— 界面侧小状态仓
 *
 * 为什么需要它：
 *  侧边栏按钮和"全屏弹窗"是两个互不相邻的组件，按钮点击后要通知弹窗打开。
 *  client 代码是同一个 bundle、同一个 JS 作用域，所以这里用一个极小的订阅式 store
 *  做通信（比再塞一个 cordis 服务简单、也更不容易崩）。
 *
 * ⚠ 关键点（踩过坑）：getSnapshot() 必须返回**稳定引用**。
 *  如果每次都 `Object.assign({}, state)` 造新对象，React 的 useSyncExternalStore
 *  会认为"状态一直在变"，进而无限重渲染 —— 也就是 React error #185。
 *  所以这里把快照冻结成一个对象，只在真正变化时替换它。
 */

const listeners = new Set()

/** 内部状态（不直接暴露出去） */
const state = {
  /** 弹窗是否打开 */
  open: false,
  /** 最近一次界面错误（给用户看的一句话） */
  lastError: '',
}

/** 对外快照：只在变化时整体替换，保证引用稳定 */
let snapshot = Object.freeze(Object.assign({}, state))

function setState(patch) {
  let changed = false
  for (const key of Object.keys(patch)) {
    if (state[key] !== patch[key]) {
      state[key] = patch[key]
      changed = true
    }
  }
  if (!changed) return
  snapshot = Object.freeze(Object.assign({}, state))
  emit()
}

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener(snapshot)
    } catch (err) {
      try {
        console.error('[ai-news-workbench] store 订阅者出错：', err)
      } catch (logErr) {
        /* 忽略 */
      }
    }
  }
}

/** 订阅（返回退订函数） */
export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 读快照（引用稳定，可以直接喂给 useSyncExternalStore） */
export function getSnapshot() {
  return snapshot
}

/** 打开工作台弹窗 */
export function openWorkbench() {
  setState({ open: true })
}

/** 关闭工作台弹窗（回到聊天界面） */
export function closeWorkbench() {
  setState({ open: false })
}

/** 切换开关 */
export function toggleWorkbench() {
  setState({ open: !state.open })
}

/** 记一条错误 */
export function setLastError(message) {
  setState({ lastError: String(message || '') })
}

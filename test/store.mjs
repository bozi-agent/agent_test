/**
 * 界面侧小状态仓测试（不需要浏览器）
 *
 * 重点：**getSnapshot() 必须返回稳定引用**。
 * 如果每次返回新对象，React 的 useSyncExternalStore 会认为状态一直在变，
 * 进而无限重渲染 —— 也就是 React error #185（"Maximum update depth exceeded"）。
 * 这个坑真踩过，所以单独拉出来测。
 *
 * 跑法：node test/store.mjs
 */

import { createAsserter } from './_harness.mjs'

const { check, finish } = createAsserter()
const store = await import('../lib/client/store.js')

console.log('== 界面侧小状态仓测试 ==')

// --- 1) 快照引用稳定（防 React #185） --------------------------------------
const a = store.getSnapshot()
const b = store.getSnapshot()
const c = store.getSnapshot()
check('getSnapshot 多次调用返回同一个引用（这是防 #185 的关键）', a === b && b === c)
check('快照被冻结（外部改不动）', Object.isFrozen(a))
check('默认是关闭状态', a.open === false)

// --- 2) 订阅：只在真正变化时通知 ------------------------------------------
let notified = 0
let lastSnapshot = null
const unsubscribe = store.subscribe((snap) => {
  notified++
  lastSnapshot = snap
})

store.openWorkbench()
check('openWorkbench 会通知订阅者', notified === 1, String(notified))
check('快照变成打开状态', store.getSnapshot().open === true)
check('新的快照是新的引用（引用变了才说明状态真变了）', lastSnapshot !== a)
check('新快照也被冻结', Object.isFrozen(lastSnapshot))
check('openView 之后引用再次稳定', store.getSnapshot() === store.getSnapshot())

store.openWorkbench()
check('重复 open 不会重复通知（值没变）', notified === 1, String(notified))

store.closeWorkbench()
check('closeWorkbench 会通知', notified === 2, String(notified))
check('快照变成关闭状态', store.getSnapshot().open === false)

store.closeWorkbench()
check('重复 close 不会重复通知', notified === 2, String(notified))

// --- 3) 退订 ---------------------------------------------------------------
unsubscribe()
store.openWorkbench()
check('退订后不再收到通知', notified === 2, String(notified))
store.closeWorkbench()

// --- 4) 订阅者抛错不影响其他订阅者 ----------------------------------------
let okCalled = 0
const bad = store.subscribe(() => {
  throw new Error('故意炸一下')
})
const good = store.subscribe(() => {
  okCalled++
})
let threw = false
try {
  store.openWorkbench()
} catch (err) {
  threw = true
}
check('某个订阅者抛错不会把 emit 带崩', threw === false)
check('其他订阅者照样收到通知', okCalled === 1, String(okCalled))
bad()
good()
store.closeWorkbench()

// --- 5) 对非法订阅者容错 ---------------------------------------------------
let badUnsub = null
let threw2 = false
try {
  badUnsub = store.subscribe(null)
  if (typeof badUnsub === 'function') badUnsub()
} catch (err) {
  threw2 = true
}
check('订阅非函数不抛错（返回空退订函数）', threw2 === false && typeof badUnsub === 'function')

process.exit(finish() ? 1 : 0)

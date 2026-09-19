/**
 * 界面侧 bundle 体检（模拟浏览器里的真实加载条件）
 *
 * **这个测试专门盯"客户端 bundle 格式"**，因为它踩过一个大坑：
 * DSH 的客户端插件不是普通 ES 模块，必须打成"注册工厂"：
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ...纯脚本... } })
 *
 * 如果 bundle 里出现 import/export，浏览器执行到就抛
 * "Cannot use import statement outside a module" —— 这个插件注册不上，
 * **并且会连累排在它后面的所有客户端插件**，页面报：
 *   Failed to load plugins ... loaded without registering ...
 *
 * 校验的是构建产物 `lib/client-dist/client.js`（不是源码）。
 *
 * 跑法：node test/bundle-check.mjs（先跑 npm run build）
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHarness, createFakeFetch, createAsserter } from './_harness.mjs'

const OWN_DIR = path.resolve(import.meta.dirname, '..')
const BUNDLE_FILE = path.join(OWN_DIR, 'lib', 'client-dist', 'client.js')
const PKG = JSON.parse(fs.readFileSync(path.join(OWN_DIR, 'package.json'), 'utf8'))

const { check, finish } = createAsserter()
const harness = createHarness()
harness.enableProbe()
const { apiCalls, state } = createFakeFetch()

console.log('== 界面侧 bundle 体检（模拟浏览器加载条件）==')

// --- 1) 构建产物格式 -------------------------------------------------------
check('构建产物存在（先跑 npm run build）', fs.existsSync(BUNDLE_FILE), BUNDLE_FILE)
if (!fs.existsSync(BUNDLE_FILE)) process.exit(finish() ? 1 : 0)
const source = fs.readFileSync(BUNDLE_FILE, 'utf8')
check('bundle 里没有 import / export 语句（最关键的一条）', !/^\s*(import|export)\s/m.test(source), (source.match(/^\s*(import|export)\s.*$/m) || [''])[0])
check('bundle 里没有任何 LLM 调用（不会触发 DeepSeek 请求扩展）', !/llm\s*\.\s*stream|agentDefaultModel|REQUEST_EXTENSION/.test(source))
check('bundle 用的是 __ModuleLoader__.load 注册工厂', source.includes('window.__ModuleLoader__.load('))
check('注册的 id 是包名', source.includes(`id: ${JSON.stringify(PKG.name)}`))
check('package.json 的 ./client 指向构建产物', String(PKG.exports['./client']).includes('client-dist'))

// --- 2) 在模拟浏览器环境里执行 ---------------------------------------------
const registrations = new Map()
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(registration) {
        registrations.set(String(registration.id).replace(/\/client$/, ''), registration)
      },
    },
    addEventListener() {},
    removeEventListener() {},
  },
  document: {
    createElement: () => ({ setAttribute() {}, style: {}, attributes: {} }),
    body: { appendChild() {}, removeChild() {} },
  },
  console,
  setTimeout,
  clearTimeout,
  Promise,
  JSON,
  Math,
  Date,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  RegExp,
  Map,
  Set,
  Symbol,
  AbortSignal: { timeout: () => ({}) },
  fetch: globalThis.fetch,
}
sandbox.globalThis = sandbox
sandbox.self = sandbox
sandbox.__XMT_TEST_HARNESS__ = true
sandbox.__XMT_TEST_PROBE__ = harness.probe

let thrown = null
try {
  vm.runInContext(source, vm.createContext(sandbox), { filename: BUNDLE_FILE })
} catch (err) {
  thrown = err
}
check('整段执行不抛错（浏览器里也是这样一轮执行）', !thrown, thrown && thrown.message)

const own = registrations.get(PKG.name)
check('注册了自己（浏览器靠这个认插件）', !!own)

if (own) {
  const requiredSpecs = []
  let exports = null
  let factoryError = null
  try {
    exports = own.factory((spec) => {
      requiredSpecs.push(spec)
      if (spec === 'react') return harness.React
      throw new Error(`bundle 里 require 了没准备的东西：${spec}`)
    })
  } catch (err) {
    factoryError = err
  }
  check('工厂能执行（平台这样拿导出）', !factoryError, factoryError && factoryError.message)
  check('只 require 了 react（不依赖别的客户端模块）', requiredSpecs.every((spec) => spec === 'react'), JSON.stringify(requiredSpecs))
  check('导出了 name / inject / apply', !!(exports && typeof exports.apply === 'function' && Array.isArray(exports.inject)))
  check('声明了 slots 依赖（平台会等它就绪再调 apply，这是必须的）', !!(exports && exports.inject.includes('slots')), JSON.stringify(exports && exports.inject))
  check('package.json 的 dsh.client.inject 也声明了 slots（两边必须一致）', Array.isArray(PKG.dsh.client.inject) && PKG.dsh.client.inject.includes('slots'), JSON.stringify(PKG.dsh.client.inject))
  check('package.json 里没有混进主机侧服务（如 webServer）', !(PKG.dsh.client.inject || []).includes('webServer'))

  // --- 3) apply：只注册侧边栏入口（弹窗挂在入口组件里） ---------------------
  const injected = []
  const registered = []
  const slotsService = {
    inject(name, fn) {
      injected.push(name)
      return fn()
    },
    register(options, Component) {
      registered.push({ options, Component })
      return { dispose() {} }
    },
  }
  let applyError = null
  try {
    exports.apply({ get: (name) => (name === 'slots' ? slotsService : undefined), slots: slotsService })
  } catch (err) {
    applyError = err
  }

  check('apply 不抛错', !applyError, applyError && applyError.message)
  check('注册了侧边栏入口 sidebar.footer.action', injected.includes('sidebar.footer.action'), JSON.stringify(injected))
  check('没有注册会话标签页 conversation.view（改成弹窗了）', !injected.includes('conversation.view'), JSON.stringify(injected))

  const entryReg = registered.find((item) => item.options.name === 'sidebar.footer.action')
  check('侧边栏入口带自己的 id（不顶掉别人的槽位）', !!(entryReg && entryReg.options.id === 'ai-news-workbench'), JSON.stringify(entryReg && entryReg.options))

  // --- 4) 侧边栏：只有一个按钮，点了弹窗出现 --------------------------------
  if (entryReg && typeof entryReg.Component === 'function') {
    const Entry = entryReg.Component
    harness.begin()
    const closed = await harness.render(Entry, { wide: true })
    check('入口渲染不报错', !closed.error, closed.error && closed.error.message)
    check('入口显示"AI 资讯工作台"', closed.text.includes('AI 资讯工作台'), closed.text.slice(0, 160))
    check('侧边栏没有铺开任何模块卡片（不挤在侧边栏）', !closed.text.includes('扫源抓取'), closed.text.slice(0, 160))

    const entryButton = harness.flattenNodes(closed.tree).find((node) => node.type === 'button')
    check('侧边栏入口是个按钮', !!entryButton)
    if (entryButton) {
      // 入口是开关，状态在用例间是共享的：先看当前是不是已经开着，关着才点
      let open = closed
      const isOpen = () => !!harness.flattenNodes(open.tree).find((n) => n.props && n.props['data-xmt-workbench'] === 'modal')
      if (!isOpen()) {
        entryButton.props.onClick()
        open = await harness.render(Entry, { wide: true })
      }
      const modal = harness.flattenNodes(open.tree).find((n) => n.props && n.props['data-xmt-workbench'] === 'modal')
      check('点入口后出现全屏弹窗', !!modal)
      check('弹窗 fixed 定位且左边界不盖侧边栏', !!(modal && modal.props.style.position === 'fixed' && parseInt(modal.props.style.left, 10) >= 260), modal && modal.props.style.left)
      check(
        '弹窗里有 5 个模块卡片（控制室、「发布与互动」「数据复盘」都按需求删除了）',
        !open.text.includes('控制室') && ['选题库', '扫源抓取', '筛选核实', '写文案', '封面标签'].every((name) => open.text.includes(name)) && !open.text.includes('发布与互动') && !open.text.includes('数据复盘'),
        open.text.slice(0, 260),
      )
      check('没有标题栏关闭按钮（× 已按需求删除）', !harness.flattenNodes(open.tree).some((n) => n.type === 'button' && harness.flatten(n).join('') === '×'))
      check('调的是主机侧接口', apiCalls.length > 0 && apiCalls.every((call) => call.url.includes('/xmt-kf/api')))
    }
  }
}

process.exit(finish() ? 1 : 0)

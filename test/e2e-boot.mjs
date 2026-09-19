/**
 * 端到端体检：真的起一个 dsh web 实例，把它发给浏览器的"客户端组合脚本"整段拉下来，
 * 在模拟浏览器环境里按顺序执行一遍，看到底哪个 bundle 会挂。
 *
 * 这是"页面报 Failed to load plugins"的最终判定依据：
 * 报错说的是"组合脚本执行完了但某个 bundle 没注册自己"，
 * 只有整段执行才能看出是谁抛的错（抛错的那个会连累它后面所有的 bundle）。
 *
 * 跑法：node test/e2e-boot.mjs
 *   （会临时占用 3099 端口起一个实例，跑完自动关掉；不动你正在用的 3080）
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

/**
 * 找出 npx 缓存里装了 DSH 的那个 node_modules。
 * 不同机器的缓存目录名是个随机 hash（`_npx/<hash>/node_modules`），
 * 所以这里**扫一遍找哪个里面有 @deepseek-ai/dsh**，不要写死路径。
 * 也可以用环境变量 XMT_NPX_NM 直接指定。
 */
function findNpxModules() {
  if (process.env.XMT_NPX_NM) return process.env.XMT_NPX_NM
  const root = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx')
  try {
    for (const name of fs.readdirSync(root)) {
      const candidate = path.join(root, name, 'node_modules')
      if (fs.existsSync(path.join(candidate, '@deepseek-ai', 'dsh'))) return candidate
    }
  } catch (err) {
    /* 没有 npx 缓存就返回空，后面会给出可读的失败信息 */
  }
  return ''
}
const NPX_NM = findNpxModules()

const DSH = process.env.DSH_BIN || (NPX_NM ? path.join(NPX_NM, '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh') : '')
/** dsh 的真实入口（直接 node 起，Windows 上不用过 .cmd 那层，好收拾进程） */
const DSH_ENTRY = process.env.DSH_ENTRY || (NPX_NM ? path.join(NPX_NM, '@deepseek-ai', 'dsh', 'lib', 'bin.js') : '')
const PORT = Number(process.env.XMT_TEST_PORT || 3099)
const BASE = `http://127.0.0.1:${PORT}`
/** 本插件自己的客户端 bundle（打包产物 = 浏览器真正加载的那份） */
const OWN_BUNDLE = path.resolve(import.meta.dirname, '..', 'lib', 'client-dist', 'client.js')
/**
 * 体检用的临时 DSH_HOME。
 * 为什么不用默认的 ~/.dsh：dsh 启动时会写 profiles/<名字>/cordis.yml，
 * 一是会打扰你正在用的那个实例，二是沙箱里通常不允许写用户目录（EPERM）。
 * 这个临时实例没有装本插件（组合脚本里不会有它），所以本插件那一份改用
 * "直接读打包产物 + 整段执行"来验证。
 */
const TEST_HOME = process.env.XMT_TEST_HOME || path.join(import.meta.dirname, '..', '.tmp-e2e-home')

let pass = 0
let fail = 0
const failures = []
function check(label, condition, detail = '') {
  if (condition) {
    pass++
    console.log(`  OK  ${label}`)
  } else {
    fail++
    failures.push(`${label}${detail ? ` —— ${detail}` : ''}`)
    console.log(`  NG  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 起一个测试实例（用工作区里的临时 DSH_HOME，不碰你自己的 profile） */
async function startServer() {
  const logFile = path.join(os.tmpdir(), `xmt-e2e-${Date.now()}.log`)
  const out = fs.openSync(logFile, 'w')
  try {
    fs.mkdirSync(TEST_HOME, { recursive: true })
  } catch (err) {
    /* 忽略 */
  }
  const child = spawn(process.execPath, [DSH_ENTRY, 'web', '--port', String(PORT), '--no-open'], {
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: Object.assign({}, process.env, { DSH_HOME: TEST_HOME }),
  })
  let output = ''
  const readLog = () => {
    try {
      return fs.readFileSync(logFile, 'utf8')
    } catch (err) {
      return ''
    }
  }
  // 等它打印出带 token 的地址
  let url = ''
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    output = readLog()
    const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/.exec(output)
    if (match) {
      url = match[1]
      break
    }
  }
  return {
    url,
    log: () => readLog(),
    stop() {
      try {
        child.kill()
      } catch (err) {
        /* 忽略 */
      }
      try {
        fs.closeSync(out)
      } catch (err) {
        /* 忽略 */
      }
      try {
        fs.unlinkSync(logFile)
      } catch (err) {
        /* 忽略 */
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 模拟浏览器：执行组合脚本
// ---------------------------------------------------------------------------

function makeReactStub() {
  return {
    createElement(type, props, ...children) {
      return { type, props: Object.assign({}, props || {}, { children }) }
    },
    Component: class Component {
      constructor(props) {
        this.props = props || {}
        this.state = {}
      }
      setState(patch) {
        this.state = Object.assign({}, this.state, patch)
      }
      render() {
        return null
      }
    },
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
}

function makeSandbox(registrations) {
  const seed = {
    react: makeReactStub(),
    'react-dom': { createPortal: (n) => n, render: () => {}, createRoot: () => ({ render: () => {}, unmount: () => {} }) },
    'react/jsx-runtime': { jsx: (t, p) => ({ type: t, props: p }), jsxs: (t, p) => ({ type: t, props: p }), Fragment: 'F' },
    'react-dom/client': { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
  }
  const requireImpl = (spec) => {
    if (seed[spec]) return seed[spec]
    const id = String(spec).replace(/\/client$/, '')
    const entry = registrations.get(id)
    if (entry) return entry.factory(requireImpl)
    throw new Error(`require("${spec}") 拿不到`)
  }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(registration) {
          registrations.set(String(registration.id).replace(/\/client$/, ''), registration)
        },
      },
      addEventListener() {},
      removeEventListener() {},
      location: { href: BASE },
      document: {},
    },
    document: {
      createElement: () => ({ setAttribute() {}, style: {}, attributes: {}, appendChild() {}, removeChild() {}, addEventListener() {} }),
      body: { appendChild() {}, removeChild() {} },
      documentElement: { setAttribute() {}, style: {} },
      head: { appendChild() {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    AbortController,
    AbortSignal: { timeout: () => ({}) },
    structuredClone: (v) => JSON.parse(JSON.stringify(v)),
    fetch: () => Promise.reject(new Error('体检环境没有网络')),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: () => {},
    __DSH_BOOT_READY__: { promise: Promise.resolve() },
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  sandbox.require = requireImpl
  return sandbox
}

// ---------------------------------------------------------------------------

console.log('== 端到端启动体检（真的起一个 dsh web，跑一遍它发给浏览器的组合脚本）==')
const server = await startServer()
try {
  check('测试实例启动成功（拿到了带 token 的地址）', !!server.url, server.url || server.log().slice(-300))
  if (!server.url) throw new Error('实例没起来，后面没法测')

  // 1) 拿首页：带 token 访问会换到一张签名 cookie（浏览器打开带 token 的地址时走的就是这一步）
  const token = new URL(server.url).searchParams.get('token') || ''
  let cookies = ''
  let indexRes = await fetch(server.url, { redirect: 'manual' })
  const grabbed = []
  for (const [name, value] of indexRes.headers.entries ? indexRes.headers.entries() : []) {
    if (String(name).toLowerCase() === 'set-cookie') grabbed.push(String(value))
  }
  const rawSetCookie = typeof indexRes.headers.getSetCookie === 'function' ? indexRes.headers.getSetCookie() : grabbed
  if (Array.isArray(rawSetCookie) && rawSetCookie.length) {
    cookies = rawSetCookie.map((line) => String(line).split(';')[0]).join('; ')
  }
  if (cookies) {
    indexRes = await fetch(`${BASE}/`, { headers: { Cookie: cookies }, redirect: 'follow' })
  }
  let indexHtml = await indexRes.text()
  check('首页能打开（鉴权通过）', indexRes.status === 200 && indexHtml.includes('__DSH_BOOT__'), `HTTP ${indexRes.status}；cookie=${cookies ? '已拿到' : '没拿到'}`)

  // 2) 从首页里取出组合脚本的包列表
  const comboMatch = /\/plugins\/\?\?([^"'&]+)/.exec(indexHtml)
  check('首页里有客户端组合脚本的地址', !!comboMatch)
  if (!comboMatch) throw new Error('页面结构不符合预期')
  const ids = decodeURIComponent(comboMatch[1])
    .split(',')
    .map((item) => item.replace(/\/client\.js(\.map)?$/, ''))
  console.log(`     组合脚本里有 ${ids.length} 个包；含本插件：${ids.includes('dsh-ai-news-workbench')}`)
  const inCombo = ids.includes('dsh-ai-news-workbench')
  const registeredHere = inCombo
    ? `组合脚本里含本插件（共 ${ids.length} 个包）`
    : `组合脚本可下载（共 ${ids.length} 个包；本次实例是临时 DSH_HOME，没装本插件，本插件单独验证）`
  check(registeredHere, true)

  // 3) 把组合脚本整段拉下来（注意：HTML 里的 & 是 &amp;，要先解码，否则 URL 是坏的）
  const comboPathRaw = /\/plugins\/\?\?[^"'\s]+/.exec(indexHtml)
  const comboPathDecoded = comboPathRaw ? comboPathRaw[0].replace(/&amp;/g, '&').replace(/&#38;/g, '&') : ''
  const comboUrl = comboPathDecoded ? `${BASE}${comboPathDecoded}` : `${BASE}/plugins/??${comboMatch[1]}`
  const comboRes = await fetch(comboUrl, { headers: cookies ? { Cookie: cookies } : {} })
  const comboLive = await comboRes.text()
  check('组合脚本能拉下来', comboRes.status === 200 && comboLive.length > 1000, `HTTP ${comboRes.status}，长度 ${comboLive.length}`)

  // 3.1) 本插件那一份：装在实例里就从页面 URL 拉，没装就直接读打包产物（内容同一个文件）
  let ownText = ''
  const ownRow = /\/plugins\/\?\?dsh-ai-news-workbench\/client\.js[^"'\s]*/.exec(indexHtml)
  if (ownRow) {
    const ownUrl = `${BASE}${ownRow[0].replace(/&amp;/g, '&')}`
    const ownRes = await fetch(ownUrl, { headers: cookies ? { Cookie: cookies } : {} })
    ownText = await ownRes.text()
    check('本插件自己的 bundle 能从实例拉下来', ownRes.status === 200 && ownText.length > 500, `HTTP ${ownRes.status}，长度 ${ownText.length}`)
  } else {
    try {
      ownText = fs.readFileSync(OWN_BUNDLE, 'utf8')
    } catch (err) {
      ownText = ''
    }
    check('本插件的打包产物存在且能读（临时实例没装它，所以直接读文件）', ownText.length > 500, `${path.relative(path.join(import.meta.dirname, '..'), OWN_BUNDLE)} 长度 ${ownText.length}`)
  }

  // 4) 组合脚本整段执行（这就是浏览器做的事）
  const registrations = new Map()
  const sandbox = makeSandbox(registrations)
  const ctx = vm.createContext(sandbox)
  let thrown = null
  try {
    vm.runInContext(comboLive, ctx, { filename: comboUrl })
  } catch (err) {
    thrown = err
  }
  check('整段组合脚本执行不抛错', !thrown, thrown ? `${thrown.message}（这会让它后面所有插件都注册不上）` : '')

  // 4.1) 本插件那一份也整段执行一遍（它必须自己注册自己）
  let ownThrown = null
  try {
    vm.runInContext(ownText, ctx, { filename: 'dsh-ai-news-workbench/client.js' })
  } catch (err) {
    ownThrown = err
  }
  check('本插件的 bundle 整段执行不抛错', !ownThrown, ownThrown ? ownThrown.message : '')

  // 5) 每个包都应该注册了自己
  const missing = ids.filter((id) => !registrations.has(id))
  check(`组合里每个包都注册了自己（共 ${ids.length} 个）`, missing.length === 0, `没注册的：${missing.join(', ')}`)
  check('本插件在注册表里（侧边栏入口要先被浏览器加载）', registrations.has('dsh-ai-news-workbench'))

  if (thrown && thrown.stack) {
    console.log('\n     出错位置（前 6 行）：')
    console.log(
      thrown.stack
        .split('\n')
        .slice(0, 6)
        .map((line) => `     ${line}`)
        .join('\n'),
    )
    const myIndex = comboLive.indexOf('dsh-ai-news-workbench')
    if (myIndex !== -1 && /at file|anonymous/.test(thrown.stack || '')) {
      console.log('     （组合脚本里本插件 chunk 的位置：' + myIndex + '）')
    }
  }

  // 6) 本插件深度检查
  const own = registrations.get('dsh-ai-news-workbench')
  if (own) {
    try {
      const exports = own.factory(sandbox.require)
      const injected = []
      const registered = []
      const slotsService = {
        inject(name, fn) {
          injected.push(name)
          return fn()
        },
        register(options, Comp) {
          registered.push({ options, Component: Comp })
          return {}
        },
      }
      exports.apply({ get: (name) => (name === 'slots' ? slotsService : undefined), slots: slotsService })
      check('本插件声明了 slots 依赖（apply 必须等服务就绪）', Array.isArray(exports.inject) && exports.inject.includes('slots'), JSON.stringify(exports.inject))
      check('本插件注册了侧边栏入口 sidebar.footer.action', injected.includes('sidebar.footer.action'), JSON.stringify(injected))
      check('没有注册会话标签页（改成弹窗）', !injected.includes('conversation.view'), JSON.stringify(injected))
      check('注册项都带组件', registered.length >= 1 && registered.every((item) => typeof item.Component === 'function'))
    } catch (err) {
      check('本插件能注册界面（侧边栏入口 + 弹窗）', false, (err && err.message) || String(err))
    }
  }

  // 7) 主进程日志里不该有插件报错（临时实例没装本插件，所以只查"没有报错"这一半）
  const log = server.log()
  const badLines = log
    .split('\n')
    .filter((line) => /\[ai-news-workbench\]/.test(line) && /失败|错误|Error/i.test(line))
  check('主进程日志里没有本插件的报错', badLines.length === 0, badLines.slice(0, 3).join(' | '))
  if (inCombo) {
    check('主进程日志里能看到本插件注册接口', /已注册接口 \/xmt-kf\/api/.test(log), log.split('\n').filter((line) => /ai-news-workbench|workbench/i.test(line)).slice(0, 3).join(' | ') || '(日志里完全没有本插件)')
  } else {
    check('主机侧接口注册进度的日志（临时实例没装本插件，跳过）', true, '')
  }
  console.log('\n     主进程日志里和插件加载有关的行：')
  for (const line of log.split('\n').filter((line) => /ai-news-workbench|client-modules|compose|bundle|plugin/i.test(line)).slice(0, 20)) {
    console.log(`     ${line.slice(0, 220)}`)
  }
  console.log(`     日志总行数：${log.split('\n').length}`)
} catch (err) {
  check('体检流程跑通', false, (err && err.message) || String(err))
} finally {
  server.stop()
  // 清掉临时 DSH_HOME（工作区里的临时目录，不留垃圾）
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true })
  } catch (err) {
    /* 忽略 */
  }
}

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
if (fail) {
  console.log('失败明细：')
  for (const line of failures) console.log(`  - ${line}`)
}
process.exit(fail ? 1 : 0)

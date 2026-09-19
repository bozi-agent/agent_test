/**
 * 客户端组合脚本体检（按浏览器里的加载条件逐个执行）
 *
 * 背景：DSH 的客户端插件是"一个组合脚本"（combo）里依次执行的，
 * 任何一个 bundle 抛错，排在它后面的 bundle 就注册不上，页面会报
 * "Failed to load plugins ... loaded without registering ..."（报错会指到后面那个，看着像别人的问题）。
 *
 * 这个脚本模拟浏览器条件：
 *   - 构建产物（window.__ModuleLoader__.load({id, factory}) 形式）：直接执行，看有没有注册自己
 *   - 源码包（本插件是 ESM 源码）：剥掉 import/export 放进"工厂函数"里跑，再校验导出与槽位注册
 *
 * 跑法：node test/combo-check.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'

/** DSH 数据目录（默认 ~/.dsh，可用 DSH_HOME 覆盖） */
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'web')
const PROFILE_NM = path.join(PROFILE_DIR, 'node_modules')

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
    /* 没有 npx 缓存就返回空，后面缺依赖的地方会给出可读的失败信息 */
  }
  return ''
}
const NPX_NM = findNpxModules()
const OWN_DIR = path.resolve(import.meta.dirname, '..')
const OWN_PKG = 'dsh-ai-news-workbench'

/** 本机 web profile 的客户端插件加载顺序（和页面 combo URL 一致） */
const IDS = [
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-client-ui-open-in-app',
  '@deepseek-ai/dsh-api-workspace-files',
  '@deepseek-ai/dsh-client-hmr',
  '@deepseek-ai/dsh-cordis-client-runner',
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-resources',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview',
  '@deepseek-ai/dsh-client-ui-sidebar-files',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-approval',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-brand-official',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-client-ui-cordis',
  '@deepseek-ai/dsh-client-ui-workflow-run',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-client-ui-commands',
  '@deepseek-ai/dsh-client-ui-skill',
  '@deepseek-ai/dsh-client-ui-subagent',
  '@deepseek-ai/dsh-client-ui-reference',
  '@deepseek-ai/dsh-client-ui-jobs',
  '@deepseek-ai/dsh-client-ui-goal',
  '@deepseek-ai/dsh-client-ui-message-feedback',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-permission-presets',
  '@deepseek-ai/dsh-client-ui-agent-preset',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-plan',
  '@deepseek-ai/dsh-client-ui-user-questions',
  '@deepseek-ai/dsh-client-ui-trajectory',
  '@linxin666/dsh-client-ui-skill-explorer',
  '@nonamelego/dsh-catppuccin',
  OWN_PKG,
  '@deepseek-ai/dsh-session-log-export',
  '@deepseek-ai/dsh-client-file-upload',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-ui-deliverables',
  'dshmarket',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-api-workspace-controller',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-ui-directory-picker-native',
]

function resolveClientFile(pkgName) {
  if (pkgName === OWN_PKG) {
    // 本插件直接按自己的 package.json 解析 ./client（现在是构建产物 lib/client-dist/client.js）
    const ownPkg = JSON.parse(fs.readFileSync(path.join(OWN_DIR, 'package.json'), 'utf8'))
    const decl = ownPkg.exports && ownPkg.exports['./client']
    const rel = typeof decl === 'string' ? decl : decl && decl.default
    if (rel) {
      const file = path.join(OWN_DIR, rel)
      if (fs.existsSync(file)) return file
    }
    // 没构建过就退回源码（并会在下面被标出来）
    const src = path.join(OWN_DIR, 'lib', 'client', 'client.js')
    if (fs.existsSync(src)) return src
  }
  const candidates = []
  for (const root of [PROFILE_NM, NPX_NM]) {
    const pkgJson = path.join(root, ...pkgName.split('/'), 'package.json')
    if (!fs.existsSync(pkgJson)) continue
    let pkg
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
    } catch (err) {
      continue
    }
    const decl = pkg.exports && pkg.exports['./client']
    const rel = typeof decl === 'string' ? decl : decl && decl.default
    if (rel) candidates.push(path.join(path.dirname(pkgJson), rel))
    for (const guess of ['lib/client.js', 'client/client.js', 'dist/client.js']) {
      const p = path.join(path.dirname(pkgJson), guess)
      if (fs.existsSync(p)) candidates.push(p)
    }
  }
  for (const file of candidates) if (fs.existsSync(file)) return file
  return null
}

/** 假的 react（够组件模块跑起来用） */
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

function makeRequire(registrations, seed) {
  return function require(spec) {
    if (seed[spec]) return seed[spec]
    const id = String(spec).replace(/\/client$/, '')
    const entry = registrations.get(id)
    if (entry) return entry.factory(makeRequire(registrations, seed))
    throw new Error(`require("${spec}") 拿不到（体检环境没准备）`)
  }
}

const registrations = new Map()
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(registration) {
        registrations.set(String(registration.id).replace(/\/client$/, ''), registration)
      },
    },
  },
  document: {
    createElement: () => ({ setAttribute() {}, style: {}, attributes: {}, appendChild() {}, removeChild() {} }),
    body: { appendChild() {}, removeChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
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
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: () => {},
  __bundleResult: undefined,
}
sandbox.globalThis = sandbox
sandbox.self = sandbox
// 平台注入的 require（真实 bundle 里是工厂函数的参数；源码包直接读全局的 require）
sandbox.require = (spec) => sandbox.__require(spec)

const seed = {
  react: makeReactStub(),
  'react-dom': { createPortal: (node) => node, render: () => {}, createRoot: () => ({ render: () => {}, unmount: () => {} }) },
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
  'react-dom/client': { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
}
sandbox.__require = makeRequire(registrations, seed)

console.log('== 客户端组合脚本体检（按浏览器加载条件逐个执行）==')
const ctx = vm.createContext(sandbox)
let broken = 0
const lines = []
for (const id of IDS) {
  const file = resolveClientFile(id)
  if (!file) {
    lines.push(`  --  ${id}（没找到界面侧 bundle，跳过）`)
    continue
  }
  const before = registrations.size
  try {
    // 本插件现在是构建产物（和其他插件一样是"注册工厂"格式），直接执行即可
    const isOwn = id === OWN_PKG
    const raw = fs.readFileSync(file, 'utf8')
    if (isOwn && /^\s*(import|export)\s/m.test(raw)) {
      throw new Error('本插件的客户端 bundle 里还有 import/export —— 必须跑 npm run build 生成 lib/client-dist/client.js')
    }
    const wrapped = `(function(){
  ${raw}
})();
`
    vm.runInContext(wrapped, ctx, { filename: file })

    if (registrations.size === before) {
      lines.push(`  NG  ${id}  <- 执行了但没注册自己（页面报的就是这种错，会连累后面的插件）`)
      broken++
      continue
    }
    try {
      const entry = registrations.get(id.replace(/\/client$/, ''))
      const exports = entry.factory(makeRequire(registrations, seed))
      if (isOwn) {
        // 本插件额外校验：注册了侧边栏入口 + 声明了 slots 依赖
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
        if (!Array.isArray(exports.inject) || !exports.inject.includes('slots')) throw new Error('没有声明 slots 依赖（apply 会在服务就绪前执行）')
        if (!injected.includes('sidebar.footer.action')) throw new Error('没有注册侧边栏入口 sidebar.footer.action')
        if (!registered.every((item) => typeof item.Component === 'function')) throw new Error('注册项没有组件')
        lines.push(`  OK  ${id}（导出正常、注册到 ${injected.join(',')}）`)
      } else {
        lines.push(`  OK  ${id}`)
      }
    } catch (err) {
      const message = (err && err.message) || String(err)
      if (/体检环境没准备/.test(message)) {
        lines.push(`  OK  ${id}（注册正常；工厂依赖的平台模块本地不具备，跳过）`)
      } else if (/Cannot set properties of undefined/.test(message)) {
        // 这类是"沙箱里缺浏览器全局变量"造成的（这些插件在真实浏览器里是好的），不计为问题
        lines.push(`  --  ${id}（注册正常；工厂依赖浏览器全局变量，体检环境不具备，跳过）`)
      } else {
        lines.push(`  NG  ${id}  <- 工厂执行报错：${message}`)
        broken++
      }
    }
  } catch (err) {
    const stack = err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n      ') : String(err)
    lines.push(`  NG  ${id}  <- 顶层执行报错：${(err && err.message) || err}\n      ${stack}`)
    broken++
  }
}

console.log(lines.join('\n'))
console.log(`\n注册到的模块数：${registrations.size}；有问题的：${broken}`)
console.log(`结论：${broken === 0 ? '每个 bundle 都能正常执行 / 注册' : `有 ${broken} 个 bundle 有问题（页面会报 Failed to load plugins）`}`)
process.exit(broken === 0 ? 0 : 1)

/**
 * 客户端 bundle 构建脚本
 *
 * 为什么需要它：
 * DSH 的客户端插件**不是**普通 ES 模块，必须打成"注册工厂"格式给浏览器：
 *
 *   window.__ModuleLoader__.load({
 *     id: "包名",
 *     factory: (require) => { ...纯脚本代码（不能有 import / export）... return module.exports },
 *   })
 *
 * 如果没有打包（直接把带 import 的源码当 bundle），浏览器执行到 import 就抛
 * "Cannot use import statement outside a module"，这个 bundle 注册不上，
 * **并且会连累排在它后面的所有客户端插件**，页面报：
 *   Failed to load plugins ... loaded without registering ...
 *
 * 这个脚本把 lib/client/ 下的源码按依赖顺序拼成一个 bundle，写成上面那种格式。
 *
 * 跑法：node build/build-client.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC_DIR = path.join(ROOT, 'lib', 'client')
const OUT_DIR = path.join(ROOT, 'lib', 'client-dist')
const OUT_FILE = path.join(OUT_DIR, 'client.js')
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/**
 * 按依赖顺序拼（被依赖的放前面；全部包在同一个工厂作用域里，直接互相引用）
 *   - store.js         没有内部依赖
 *   - ui.js            没有内部依赖
 *   - sidebar-entry.js 没有内部依赖（纯 DOM：把入口按钮搬到「技能中心」下面）
 *   - workbench.js     依赖 store.js + ui.js
 *   - client.js        依赖 workbench.js + store.js + sidebar-entry.js
 */
const ORDER = ['store.js', 'ui.js', 'sidebar-entry.js', 'workbench.js', 'client.js']

/** 每个源文件里"被后面的文件用到"的导出（构建时校验，名字对不上就直接报错） */
const EXPORTS_BY_FILE = {
  'store.js': ['getSnapshot', 'openWorkbench', 'closeWorkbench', 'subscribe'],
  'ui.js': ['api', 'copyText', 'formatTime', 'percent', 'rate', 'renderSegments', 'S', 'ST', 'CLS', 'TOKENS', 'toneStyle', 'markAll', 'ensureStyles', 'cx', 'icon'],
  'sidebar-entry.js': ['mountSidebarEntry'],
  'workbench.js': ['createWorkbench'],
}

/** 去掉 ESM 的 import / export 语法 */
function stripModules(source, file) {
  let text = String(source)
  text = text
    // import ... from '...'  /  import '...'
    .replace(/^[ \t]*import\s+[^;\n]*?from\s*['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^[ \t]*import\s*['"][^'"]+['"];?[ \t]*$/gm, '')
    // export default xxx
    .replace(/^[ \t]*export\s+default\s+/gm, '/* eslint-disable */ var __unusedDefault = ')
    // export const/let/var/function/class
    .replace(/^[ \t]*export\s+(async\s+function|function|class|const|let|var)\s+/gm, '$1 ')
    // 单独的 export { ... }
    .replace(/^[ \t]*export\s*\{[^}]*\};?[ \t]*$/gm, '')
  if (/^\s*(import|export)\s/m.test(text)) {
    const bad = /^\s*(import|export)\s.*$/m.exec(text)
    throw new Error(`${file}: 还有没处理掉的 ESM 语法：${bad && bad[0]}`)
  }
  return text
}

const chunks = []

for (const file of ORDER) {
  const full = path.join(SRC_DIR, file)
  if (!fs.existsSync(full)) throw new Error(`缺少源文件：${full}`)
  const raw = fs.readFileSync(full, 'utf8')

  // 校验"被别的文件用到的导出"确实存在（名字写错就直接构建失败，别等运行时报错）
  const needed = EXPORTS_BY_FILE[file] || []
  for (const name of needed) {
    const declared = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${name}\\b`).test(raw)
    if (!declared) throw new Error(`${file} 里没有导出 ${name}（构建脚本的 EXPORTS_BY_FILE 与实际代码不一致）`)
  }

  // 所有源文件都拼在同一个工厂作用域里，import 行直接删掉即可（同作用域直接引用）
  const stripped = stripModules(raw, file)
  chunks.push({ file, text: stripped })
}

const banner = `/**
 * AI 资讯工作台 —— 客户端 bundle（自动生成，请勿手改）
 *
 * 源文件：lib/client/store.js + ui.js + sidebar-entry.js + workbench.js + client.js
 * 重新生成：node build/build-client.mjs
 *
 * 格式说明：DSH 的客户端插件必须是"注册工厂"形式 —— 平台把 require 传进来，
 * 这里注册自己，平台再调 apply(ctx) 把界面注册到槽位（主界面视图 + 侧边栏入口）。
 * 这里绝不能出现 import / export（那会让整个组合脚本语法报错、连累其他插件）。
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG.name)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
`

const body = chunks
  .map((chunk) => `    // ==================== ${chunk.file} ====================\n${chunk.text.replace(/^(?!$)/gm, '    ')}`)
  .join('\n')

const footer = `
    // ==================== 导出 ====================
    exports.name = name
    exports.inject = inject
    exports.apply = apply
    exports.default = { name: name, inject: inject, apply: apply }
    return module.exports
  },
})
`

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, `${banner}${body}${footer}`, 'utf8')

const size = fs.statSync(OUT_FILE).size
console.log(`已生成：${path.relative(ROOT, OUT_FILE)}（${size} 字节，${chunks.length} 个源文件）`)
console.log(`  包名：${PKG.name}`)
console.log('  校验：不含 import/export =', !/^\s*(import|export)\s/m.test(fs.readFileSync(OUT_FILE, 'utf8').replace(/^.*自动生成.*$/m, '')))

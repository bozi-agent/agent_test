/**
 * AI 资讯工作台 —— 主机侧抓取模块（模块2 用）
 *
 * 设计要点（按开发文档 6.9 / 模块2 要求）：
 *  - 自己写的最小 HTML 解析器（不依赖第三方库），支持配置化的 CSS 选择器
 *  - 网络：超时 10 秒、失败自动重试最多 3 次、重试间隔递增、网站之间随机间隔 1.5~3.5 秒
 *  - 失败降级：配置的选择器抓不到 → <article> → 页面上文字长度 > 10 的 <a> 链接
 *  - 困难网站走"浏览器抓取"（复用已登录 Chrome 的调试端口），失败给手动查看提示
 *  - 时间过滤（按需求）：抓到的每条都去详情页读真实发布时间（<time> / meta / 时间容器），
 *    读不到日期、或日期不在"最近 N 天"范围内的，**一律丢弃**（不再标"最新"、不再兜底保留整站）
 *  - 所有抓取行为写入日志文件
 */

import { appendLog } from './store.js'
import { stripLeadNoise } from './rules.js'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** 把相对链接拼成绝对链接 */
export function resolveUrl(href, base) {
  try {
    return new URL(String(href || '').trim(), base).href
  } catch (err) {
    return ''
  }
}

/** 解码常见 HTML 实体 */
export function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function safeFromCodePoint(code) {
  try {
    return String.fromCodePoint(code)
  } catch (err) {
    return ''
  }
}

/** 去掉标签，返回纯文本 */
export function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** 找到某个开标签在 HTML 中的位置（忽略注释里的假标签） */
export function findTag(html, name, from = 0) {
  const source = String(html || '')
  const lower = source.toLowerCase()
  const needle = `<${String(name).toLowerCase()}`
  let idx = lower.indexOf(needle, from)
  while (idx !== -1) {
    const after = lower.charAt(idx + needle.length)
    if (after === '>' || after === '/' || /\s/.test(after)) {
      const close = findTagEnd(source, idx)
      if (close > idx) return { start: idx, openEnd: close, attrs: source.slice(idx + needle.length, close) }
    }
    idx = lower.indexOf(needle, idx + 1)
  }
  return null
}

/** 从开标签起始位置找到 ">" 结束位置（跳过引号里的 >） */
function findTagEnd(source, start) {
  let quote = ''
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>') return i
  }
  return -1
}

/** 取一个开标签内部某个属性的值 */
export function attrOf(openTagText, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = re.exec(String(openTagText || ''))
  if (!m) return ''
  return decodeEntities(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '')
}

/** 取某个开标签对应的整段 innerHTML（含嵌套标签，靠同名标签计平衡） */
export function innerHtmlOf(html, name, openEnd) {
  const source = String(html || '')
  const lower = source.toLowerCase()
  const openToken = `<${String(name).toLowerCase()}`
  const closeToken = `</${String(name).toLowerCase()}`
  let depth = 1
  let cursor = openEnd + 1
  while (cursor < source.length) {
    const nextOpen = lower.indexOf(openToken, cursor)
    const nextClose = lower.indexOf(closeToken, cursor)
    if (nextClose === -1) return source.slice(openEnd + 1)
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const after = lower.charAt(nextOpen + openToken.length)
      if (after === '>' || after === '/' || /\s/.test(after)) depth++
      cursor = nextOpen + openToken.length
      continue
    }
    depth--
    if (depth === 0) return source.slice(openEnd + 1, nextClose)
    cursor = nextClose + closeToken.length
  }
  return source.slice(openEnd + 1)
}

/**
 * 极简 CSS 选择器解析：支持 "tag"、".class"、"#id"、"tag.class"、"[attr=value]"、"a b"（后代）、"a, b"（逗号分组）
 * 只服务于本插件的抓取配置，不追求完整 CSS 规范。
 */
export function parseSelector(selector) {
  const text = String(selector || '').trim()
  if (!text) return []
  return text
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) =>
      group
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => {
          const step = { tag: '', classes: [], id: '', attrs: [] }
          const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:([~|^$*]?=)\s*"?([^\]"]*)"?)?\]/g
          let m
          while ((m = re.exec(token)) !== null) {
            if (m[1]) step.tag = m[1].toLowerCase()
            else if (m[2]) step.classes.push(m[2])
            else if (m[3]) step.id = m[3]
            else if (m[4]) step.attrs.push({ name: m[4].toLowerCase(), op: m[5] || '', value: m[6] === undefined ? '' : m[6] })
          }
          return step
        })
        .filter((step) => step.tag || step.classes.length || step.id || step.attrs.length),
    )
    .filter((group) => group.length)
}

function elementMatches(step, openTagText, tagName) {
  if (step.tag && step.tag !== tagName) return false
  if (step.id) {
    const id = attrOf(openTagText, 'id')
    if (id !== step.id) return false
  }
  if (step.classes.length) {
    const classes = attrOf(openTagText, 'class').split(/\s+/).filter(Boolean)
    for (const cls of step.classes) if (!classes.includes(cls)) return false
  }
  for (const attr of step.attrs) {
    const value = attrOf(openTagText, attr.name)
    if (attr.op === '') {
      if (!value) return false
    } else if (attr.op === '=') {
      if (value !== attr.value) return false
    } else if (attr.op === '^=') {
      if (!value.startsWith(attr.value)) return false
    } else if (attr.op === '$=') {
      if (!value.endsWith(attr.value)) return false
    } else if (attr.op === '*=') {
      if (!value.includes(attr.value)) return false
    } else if (attr.op === '~=') {
      if (!value.split(/\s+/).includes(attr.value)) return false
    }
  }
  return true
}

/**
 * 找出所有匹配的元素，返回 [{ start, openEnd, html, attrs, tag, text }]
 * 支持逗号分组（"time, .date"），结果按在页面里出现的位置排序。
 * @param {string} html 页面源码
 * @param {string} selector CSS 选择器
 * @param {number} limit 最多返回几个（0 = 不限）
 */
export function queryAll(html, selector, limit = 0) {
  const groups = parseSelector(selector)
  if (!groups.length) return []
  const merged = []
  const seen = new Set()
  for (const steps of groups) {
    for (const item of queryAllSingle(String(html || ''), steps, limit)) {
      const key = `${item.start}:${item.tag}:${item.openEnd}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  merged.sort((a, b) => a.start - b.start)
  return limit > 0 ? merged.slice(0, limit) : merged
}

function queryAllSingle(source, steps, limit = 0) {
  const lower = source.toLowerCase()
  const tagRe = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g
  const results = []

  // 第一步：找出所有满足第一个 step 的元素
  let candidates = []
  let m
  while ((m = tagRe.exec(source)) !== null) {
    const tagName = m[1].toLowerCase()
    if (tagName === 'script' || tagName === 'style' || tagName === '!--') continue
    if (!elementMatches(steps[0], m[2], tagName)) continue
    const openEnd = m.index + m[0].length - 1
    const selfClosing = /\/$/.test(m[2].trim()) || ['br', 'img', 'input', 'meta', 'link', 'hr'].includes(tagName)
    candidates.push({
      start: m.index,
      openEnd,
      end: selfClosing ? openEnd + 1 : -1,
      attrs: m[2],
      tag: tagName,
    })
  }
  if (!candidates.length) return []

  // 后续 step 按"后代"处理：在上一层元素的范围内继续找
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i]
    const next = []
    for (const parent of candidates) {
      const from = parent.openEnd + 1
      const to = parent.end === -1 ? source.length : parent.end
      const scope = source.slice(from, to)
      const scopeRe = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g
      let sm
      while ((sm = scopeRe.exec(scope)) !== null) {
        const tagName = sm[1].toLowerCase()
        if (tagName === 'script' || tagName === 'style') continue
        if (!elementMatches(step, sm[2], tagName)) continue
        const openEnd = from + sm.index + sm[0].length - 1
        const selfClosing = /\/$/.test(sm[2].trim()) || ['br', 'img', 'input', 'meta', 'link', 'hr'].includes(tagName)
        next.push({ start: from + sm.index, openEnd, end: selfClosing ? openEnd + 1 : -1, attrs: sm[2], tag: tagName })
      }
    }
    candidates = next
    if (!candidates.length) return []
  }

  for (const item of candidates) {
    const isSelfClosing = item.end !== -1 && item.end === item.openEnd + 1
    const html_ = isSelfClosing ? source.slice(item.start, item.end) : source.slice(item.start, htmlElementEnd(source, item.tag, item.start, item.openEnd))
    results.push({
      start: item.start,
      openEnd: item.openEnd,
      tag: item.tag,
      attrs: item.attrs,
      html: html_,
      text: stripTags(html_),
    })
    if (limit > 0 && results.length >= limit) break
  }
  return results
}

function htmlElementEnd(source, tagName, start, openEnd) {
  const lower = source.toLowerCase()
  const openToken = `<${tagName}`
  const closeToken = `</${tagName}`
  let depth = 1
  let cursor = openEnd + 1
  while (cursor < source.length) {
    const nextOpen = lower.indexOf(openToken, cursor)
    const nextClose = lower.indexOf(closeToken, cursor)
    if (nextClose === -1) return source.length
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const after = lower.charAt(nextOpen + openToken.length)
      if (after === '>' || after === '/' || /\s/.test(after)) depth++
      cursor = nextOpen + openToken.length
      continue
    }
    depth--
    if (depth === 0) return nextClose + closeToken.length + 1
    cursor = nextClose + closeToken.length
  }
  return source.length
}

/**
 * 读 meta 标签内容（property 或 name）。
 * 注意：content 写在 property 前面的写法（<meta content="…" property="…">）也要认。
 */
export function metaContent(html, key) {
  const source = String(html || '')
  const re = new RegExp(
    `<meta\\b(?=[^>]*(?:property|name)\\s*=\\s*["']${escapeRe(key)}["'])[^>]*>`,
    'i',
  )
  const m = re.exec(source)
  if (!m) return ''
  return attrOf(m[0], 'content')
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 常见的"发布日期"元数据键名（顺序即优先级） */
const DATE_META_KEYS = [
  'article:published_time',
  'og:published_time',
  'og:release_date',
  'article:release_date',
  'article:published',
  'article:modified_time',
  'og:updated_time',
  'pubdate',
  'publishdate',
  'publish_date',
  'sailthru.date',
  'weibo:article:create_at',
  'date',
]

/** 日期所在的容器（class/id 里带这些词就认为这块是"时间"） */
const DATE_BOX_SELECTOR = [
  '[class*=time]',
  '[class*=date]',
  '[class*=publish]',
  '[class*=post-meta]',
  '[class*=meta]',
  '[class*=news-info]',
  '[class*=art-info]',
  '[class*=info-bar]',
  '[id*=time]',
  '[id*=date]',
  '[id*=publish]',
].join(',')

/** 中文站最常见的"日期标签"：标签后面紧跟的那串才是发布时间 */
const DATE_LABELS = ['发布时间', '更新于', '更新时间', '发布于', '发表时间', '发表于', '时间：', '时间:']

/** 清理对找日期有干扰的部分：脚本、注释、svg（图里常带 "Illustrator 2029.2.1" 这种假日期） */
function cleanForDate(source) {
  return String(source || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
}

/** 一条"人写的"日期长什么样（年月日必须有分隔符，避免命中 URL / 图片名里的纯数字） */
const DATE_PATTERN = /(\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*[号日]?(?:\s*[T ]\s*\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?)?)/

/** 往后多看几个字符，把紧跟着的时间（14:07 / 14:07:33 +08:00）一起读进来 */
function widenDateText(source, match) {
  const after = source.slice(match.index + match[0].length, match.index + match[0].length + 24)
  const clock = /^\s*[T ]?\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*\d{2})?/.exec(after)
  if (clock && !/\d\s*[:：]\s*\d{2}/.test(match[0])) {
    return `${match[0]} ${clock[1]}:${clock[2]}`
  }
  return match[0]
}

/** JSON-LD 里声明发布时间的字段名（比正文里的日期可靠得多） */
const DATE_JSONLD_KEYS = ['datePublished', 'dateCreated', 'uploadDate', 'dateModified']

/** 从 <script type="application/ld+json"> 里读发布日期（找不到返回 ''） */
function jsonLdDate(source) {
  const blocks = String(source || '').match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>[\s\S]*$/i, '')
    // 不求解析成对象（有些站点的 JSON-LD 是坏的）：直接按字段名找后面那串日期
    for (const key of DATE_JSONLD_KEYS) {
      const m = new RegExp(`"${key}"\\s*:\\s*"([^"]{6,40})"`, 'i').exec(body)
      if (m && normalizeDate(m[1])) return m[1]
    }
  }
  return ''
}

/**
 * 这条候选日期**看着像发布日期吗**：YYYY-MM-DD 形式、年份在 2000~今+1 之间。
 * 用来挡掉页面里那些"看起来像日期、其实是编号/其它年份"的串。
 */
function plausibleDate(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false
  const year = Number(String(day).slice(0, 4))
  return year >= 2000 && year <= new Date().getFullYear() + 1
}

/**
 * 在一段 HTML 里找日期。返回 { raw, score }（找不到返回 null）。
 * 优先级：显式选择器 > meta > JSON-LD > <time> > 带"时间"字样的容器 > 中文标签 > 全文兜底。
 * @param {string} html 页面或片段
 * @param {string} selector 用户配置的日期选择器（可为空）
 * @param {boolean} allowGlobal 允许兜底全文扫描（详情页用；列表项里默认不开，避免串到别的文章）
 */
export function findDate(html, selector = '', allowGlobal = true) {
  const source = String(html || '')
  if (!source) return null

  // ① 用户配置的日期选择器
  if (selector) {
    for (const node of queryAll(source, selector, 3)) {
      const raw = attrOf(node.attrs, 'datetime') || node.text
      if (normalizeDate(raw)) return { raw, score: 60 }
    }
  }

  // ② meta 元数据（发布时间最权威）
  for (const key of DATE_META_KEYS) {
    const content = metaContent(source, key)
    if (content && normalizeDate(content)) return { raw: content, score: 55 }
  }

  // ③ JSON-LD 结构化数据里的 datePublished
  const ld = jsonLdDate(source)
  if (ld) return { raw: ld, score: 52 }

  // ④ <time> 标签（有 datetime 属性优先）
  const timeTag = findTag(source, 'time')
  if (timeTag) {
    const raw = attrOf(timeTag.attrs, 'datetime') || stripTags(innerHtmlOf(source, 'time', timeTag.openEnd))
    if (normalizeDate(raw)) return { raw, score: 50 }
  }

  // ⑤ class/id 里带 time / date / publish 的容器（站点最常见的写法）
  for (const node of queryAll(source, DATE_BOX_SELECTOR, 8)) {
    const text = node.text || ''
    if (!text || text.length > 120) continue // 太长的是整块内容，不是时间标签
    const raw = attrOf(node.attrs, 'datetime') || attrOf(node.attrs, 'content') || text
    if (normalizeDate(raw)) return { raw, score: 45 }
  }

  // ⑥ 中文标签："发布时间 : 2026年9月17号 14:07" 这种（标签后面紧跟的那串才是发布时间）
  for (const label of DATE_LABELS) {
    let at = source.indexOf(label)
    let guard = 0
    while (at !== -1 && guard++ < 3) {
      const after = source.slice(at, at + 180)
      const match = DATE_PATTERN.exec(after)
      if (match && normalizeDate(match[1])) return { raw: widenDateText(after, match), score: 40 }
      at = source.indexOf(label, at + label.length)
    }
  }

  // ⑦ 兜底：全文里找**带时分的**日期串。
  //   ⚠ 这里刻意只要"日期后面紧跟时分"的（2026-09-18 14:07 / 2026年9月18日 14:07）：
  //     整页第一个干巴巴的 "2026-09-17" 很可能是侧栏/相关阅读里别人的日期
  //     （用户反馈的"抓到 2 天前的内容还标成最新"就是被这种串骗了）。
  //     一条带时分的候选都没有时，就返回"读不到" —— 上层会按需求把这条丢掉。
  if (allowGlobal) {
    const plain = cleanForDate(source)
    const re = new RegExp(DATE_PATTERN.source, 'g')
    const votes = new Map()
    let match = re.exec(plain)
    while (match) {
      const before = plain.slice(Math.max(0, match.index - 80), match.index)
      const inUrl = /(?:href|src|srcset|url|data-\w+)\s*=\s*["'][^"']*$|https?:\/\/\S*$/i.test(before)
      const widened = widenDateText(plain, match)
      const hasClock = /\d\s*[:：]\s*\d{2}/.test(widened)
      if (!inUrl && hasClock && plausibleDate(normalizeDate(widened))) {
        const key = normalizeDate(widened)
        const hit = votes.get(key) || { raw: widened, score: 10, count: 0 }
        hit.count++
        votes.set(key, hit)
      }
      match = re.exec(plain)
    }
    if (votes.size) {
      // 同一串出现多次的更像"这篇文章的发布时间"（页头 + 正文/分享区都会写一遍）
      const best = [...votes.values()].sort((a, b) => b.count - a.count)[0]
      return { raw: best.raw, score: best.score }
    }
  }
  return null
}

/**
 * 从 <time> / meta / class 容器 / 正文里识别日期，识别不出返回空串（界面显示"最新"）。
 * 能读到时分就返回 "YYYY-MM-DD HH:MM"，只有日期就返回 "YYYY-MM-DD"。
 */
export function detectDate(html, dateSelector = '', allowGlobal = true) {
  const found = findDate(html, dateSelector, allowGlobal)
  if (!found) return ''
  return normalizeDate(found.raw) || ''
}

/**
 * 把各种日期写法归一化。
 *  - 只有一个参数时（兼容老用法）返回 "YYYY-MM-DD"
 *  - 第二个参数为真时，读到时分就返回 "YYYY-MM-DD HH:MM"
 */
export function normalizeDate(raw, withTime = false) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const full = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*[号日]?/.exec(text)
  if (full) {
    const [, y, mo, d] = full
    const day = `${y}-${pad2(mo)}-${pad2(d)}`
    if (!withTime) return day
    const clock = readClock(text, full.index + full[0].length)
    return clock ? `${day} ${clock}` : day
  }
  const short = /(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/.exec(text)
  if (short) {
    const year = new Date().getFullYear()
    const day = `${year}-${pad2(short[1])}-${pad2(short[2])}`
    if (!withTime) return day
    const clock = readClock(text, short.index + short[0].length)
    return clock ? `${day} ${clock}` : day
  }
  const relative = /(\d+)\s*(分钟|个小时|小时|天|周|个月|月)前/.exec(text)
  if (relative) {
    const n = Number(relative[1])
    const unit = relative[2]
    const ms = unit === '分钟' ? 60e3 : unit === '小时' ? 3600e3 : unit === '天' ? 86400e3 : unit === '周' ? 7 * 86400e3 : 30 * 86400e3
    return beijingStampOf(new Date(Date.now() - n * ms), withTime)
  }
  if (/刚刚|今天/.test(text)) return beijingStampOf(new Date(), withTime)
  if (/昨天/.test(text)) return beijingStampOf(new Date(Date.now() - 86400e3), withTime)
  return ''
}

/** 在日期后面的几个字符里读 "14:07" / "14：07" / "T14:07"（中间允许一个逗号/空格/“日”字） */
function readClock(text, from) {
  const after = text.slice(from, from + 16)
  const m = /^\s*[T，,、]?\s*[号日]?\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(after)
  if (!m) return ''
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return ''
  return `${pad2(hh)}:${pad2(mm)}`
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 北京时间日期（可选带时分） */
export function beijingStampOf(date, withTime = false) {
  const iso = new Date(date.getTime() + 8 * 3600 * 1000).toISOString()
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10)
}

// ---------------------------------------------------------------------------
// 网络请求
// ---------------------------------------------------------------------------

function decodeBody(buffer, contentType) {
  const bytes = new Uint8Array(buffer)
  const head = Buffer.from(bytes.slice(0, 4096)).toString('latin1')
  const charset =
    (/charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '') || [])[1] ||
    (/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head) || [])[1] ||
    'utf-8'
  let label = String(charset).toLowerCase()
  if (label === 'gb2312' || label === 'gbk') label = 'gb18030'
  try {
    return new TextDecoder(label).decode(bytes)
  } catch (err) {
    try {
      return new TextDecoder('utf-8').decode(bytes)
    } catch (err2) {
      return Buffer.from(bytes).toString('utf8')
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 随机间隔（1.5~3.5 秒，可配置） */
export async function politeDelay(min = 1500, max = 3500) {
  const low = Math.max(0, Number(min) || 0)
  const high = Math.max(low, Number(max) || low)
  const wait = low + Math.random() * (high - low)
  if (wait > 0) await sleep(wait)
}

/**
 * 带超时 + 重试的 GET 文本请求
 * @param {string} url 目标地址
 * @param {object} options { timeoutMs, retries, headers }
 * @returns {Promise<{ok:boolean, status?:number, text?:string, finalUrl?:string, error?:string}>}
 */
export async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 10000
  const retries = Math.max(1, Number(options.retries) || 3)
  const headers = Object.assign(
    {
      'User-Agent': options.userAgent || DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
    },
    options.headers || {},
  )
  let lastError = ''
  for (let attempt = 1; attempt <= retries; attempt++) {
    const started = Date.now()
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        appendLog(`抓取失败 ${url} 第${attempt}/${retries}次：${lastError}（${Date.now() - started}ms）`)
        if (response.status < 500 && response.status !== 429) break
      } else {
        const buffer = await response.arrayBuffer()
        const text = decodeBody(buffer, response.headers.get('content-type') || '')
        appendLog(`抓取成功 ${url} 第${attempt}次：${text.length} 字符（${Date.now() - started}ms）`)
        return { ok: true, status: response.status, text, finalUrl: response.url || url }
      }
    } catch (err) {
      lastError = describeFetchError(err, timeoutMs)
      appendLog(`抓取异常 ${url} 第${attempt}/${retries}次：${lastError}`)
    }
    if (attempt < retries) {
      // 重试间隔递增：1s、2s、3s（再抖一点，避免被识别成机器人）
      const backoff = attempt * 1000 + Math.floor(Math.random() * 400)
      await sleep(backoff)
    }
  }
  return { ok: false, error: lastError || '未知错误' }
}

function describeFetchError(err, timeoutMs) {
  const name = (err && err.name) || ''
  const message = (err && err.message) || String(err)
  if (name === 'TimeoutError' || /timeout|timed out/i.test(message)) return `超时（>${timeoutMs}ms）`
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return '域名解析失败（网址可能写错了）'
  if (/ECONNREFUSED/i.test(message)) return '连接被拒绝'
  if (/certificate|SSL|TLS/i.test(message)) return 'HTTPS 证书校验失败'
  if (/redirect/i.test(message)) return '重定向次数过多'
  return message.slice(0, 160)
}

// ---------------------------------------------------------------------------
// 列表页解析
//   三级降级：用户配置的选择器 → 常见列表结构（重复兄弟节点）→ <article>
//   规则：
//     · 用户规则抓出来 < MIN_LIST_ITEMS 条 ⇒ **整条规则作废**，退回内置智能识别
//     · 标题超 50 字强制截断；成段摘要/正文不当作标题
//     · 不无脑扫全页链接：宁可只抓到几条，也不把页脚/广告塞进来
// ---------------------------------------------------------------------------

/** 少于这个条数就认为"用户规则失效"，退回内置识别 */
export const MIN_LIST_ITEMS = 5

/**
 * 解析一个列表页，返回 [{ title, link, date, from }]
 * @param {string} html 页面源码
 * @param {string} baseUrl 站点根地址（用于补全相对链接）
 * @param {object} selectors { listSelector, titleSelector, linkSelector, dateSelector }
 * @param {number} limit 最多取几条
 */
export function parseList(html, baseUrl, selectors = {}, limit = 8) {
  const sel = selectors || {}

  // 方案一：用户在设置里配的选择器
  const configured = parseWithConfiguredSelectors(html, baseUrl, sel, limit)
  // 方案二：常见列表结构（同一个容器里重复出现的兄弟节点，每块取一个链接）
  const repeated = parseRepeatedList(html, baseUrl, sel, limit)

  // 用户规则够用 → 直接用（它最准）
  if (configured.length >= Math.min(MIN_LIST_ITEMS, limit)) return dedupe(configured, limit, baseUrl)
  if (configured.length) appendLog(`配置的解析规则只抓到 ${configured.length} 条（少于 ${MIN_LIST_ITEMS} 条），忽略该规则，改用内置智能识别`)

  // 方案三：<article> 标签（只在前两级都没凑够时再补）
  const articles = repeated.length >= Math.min(MIN_LIST_ITEMS, limit) ? [] : parseArticles(html, baseUrl, limit)
  const merged = dedupe(repeated.concat(articles, configured), limit, baseUrl)
  if (merged.length >= Math.min(MIN_LIST_ITEMS, limit)) return merged
  if (merged.length) {
    appendLog(`内置识别只找到 ${merged.length} 条（不足 ${MIN_LIST_ITEMS} 条），不扫全页链接兜底（避免抓到页脚/广告）`)
    return merged
  }
  appendLog(`内置识别也找不到可用的列表结构（不足 ${MIN_LIST_ITEMS} 条），不扫全页链接兜底（避免抓到页脚/广告）`)
  return []
}

/**
 * 用用户配置的选择器解析。
 * ⚠ 关键：listSelector 很可能指的是**列表容器**（div.article_list），
 *   不是单篇文章。所以要判断"这个容器里是不是有一堆重复的子块"：
 *   是 → 逐个遍历子块（每块当一篇文章）；不是 → 才把容器当一篇。
 */
function parseWithConfiguredSelectors(html, baseUrl, sel, limit) {
  if (!sel.listSelector && !sel.linkSelector) return []
  const items = []
  const containers = sel.listSelector ? queryAll(html, sel.listSelector, 0) : [{ html, attrs: '', openEnd: 0, tag: 'div', text: '' }]

  for (const container of containers) {
    // ① 容器里是一堆重复子块（真正的列表）→ 逐块解析
    const children = listChildren(container)
    const blocks = children.length >= 2 ? children : [{ html: container.html, text: container.text || '', attrs: container.attrs || '' }]
    let added = 0
    for (const block of blocks) {
      const item = pickOne(block, baseUrl, sel, '配置选择器')
      if (!item) continue
      items.push(item)
      added++
      if (items.length >= limit) break
    }
    // 这个容器什么都没抓到（规则写错了）→ 跳到下一个匹配到的容器继续试，别白跑
    if (!added && containers.length > 1) continue
  }
  return items
}

/**
 * 从"一个条目块"里取 标题 + 链接（+ 日期）。
 * 取不到标题或链接就返回 null。
 */
function pickOne(block, baseUrl, sel, from) {
  const anchors = sel.linkSelector ? queryAll(block.html, sel.linkSelector, 1) : []
  let anchor = anchors[0] || null
  if (!anchor) {
    // 没配 linkSelector（或配错了）时：找块里"最像文章标题"的那个链接
    const candidates = queryAll(block.html, 'a', 0)
    anchor = candidates.find((a) => {
      const text = cleanTitle(a.text)
      return text && text.length >= 10 && isArticleLink(resolveUrl(attrOf(a.attrs, 'href'), baseUrl), baseUrl)
    }) || candidates[0] || null
  }

  // 标题：配置的选择器 → 缩略图 alt（最干净）→ meta(og:title) → 标题类 class → 链接文字
  let title = ''
  if (sel.titleSelector) {
    const titleNodes = queryAll(block.html, sel.titleSelector, 1)
    if (titleNodes[0]) title = titleNodes[0].text
  }
  if (!title) {
    const imgs = queryAll(block.html, 'img', 2)
    const alt = imgs.map((im) => cleanTitle(attrOf(im.attrs, 'alt'))).find((text) => text && text.length >= 10)
    if (alt) title = alt
  }
  if (!title) title = metaContent(block.html, 'og:title')
  if (!title) {
    const nodes = queryAll(block.html, '[class*=title], [class*=Title], h1, h2, h3, h4', 4)
    // 有些站点标题和摘要同在一个 div 里，取纯文本会连摘要一起拿 → 优先"第一个子元素"的文本
    for (const node of nodes) {
      const inner = String(node.html || '')
      const firstChild = /<(div|span|h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/i.exec(inner)
      const candidates = [firstChild ? stripTags(firstChild[2]) : '', node.text]
      const hit = candidates.map((t) => cleanTitle(t)).find((text) => text && text.length >= 10)
      if (hit) {
        title = hit
        break
      }
    }
  }
  if (!title && anchor) title = anchor.text

  const link = anchor ? resolveUrl(attrOf(anchor.attrs, 'href'), baseUrl) : ''
  const clean = cleanTitle(title)
  if (!clean || !link) return null

  // 日期：只在**这一块内部**找；块很大时先看前面一小段（更接近标题/时间的常规位置），
  // 找不到再扩大到整块（有些站点把时间放在摘要后面）
  const raw = String(block.html || '')
  const windows = raw.length > 900 ? [raw.slice(0, 600), raw.slice(0, 1600), raw] : [raw]
  let date = ''
  for (const win of windows) {
    date = detectDate(win, sel.dateSelector, false)
    if (date) break
  }
  return { title: clean, link, date, from }
}

/**
 * 找出"列表容器里重复出现的直接子块"（比如 div.article_list 下面的一堆 div.picture_text）。
 * 判定依据：同一个标签名 + 同一个 class 组合，出现 ≥2 次，并且里面带链接。
 */
function listChildren(container) {
  const source = String(container.html || '')
  // 只看直接子级：从容器开标签往后扫，深度回到 0 就停
  const body = source.slice(Math.max(0, source.indexOf('>') + 1))
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g
  const groups = new Map()
  let depth = 0
  let m
  while ((m = re.exec(body)) !== null) {
    const isClose = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === '!--') continue
    // 自闭合 / 空元素（img、br…）不改变嵌套深度，否则会把后面的兄弟节点全漏掉
    const selfClosing = /\/$/.test(m[3].trim()) || ['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'track', 'area', 'base', 'col', 'embed', 'param', 'wbr'].includes(tag)
    if (isClose) {
      if (selfClosing) continue
      if (depth === 0) break // 容器自己的结束标签
      depth--
      continue
    }
    if (depth === 0) {
      const cls = (attrOf(m[3], 'class') || '').split(/\s+/).filter(Boolean).sort().join('.')
      const sig = `${tag}${cls ? `.${cls}` : ''}`
      if (!groups.has(sig)) groups.set(sig, [])
      groups.get(sig).push({ sig, start: m.index, openEnd: m.index + m[0].length - 1, tag, attrs: m[3], selfClosing })
    }
    if (!selfClosing) depth++
  }
  // 取"重复次数最多"的那组（≥2 次），再按出现顺序拼出每个子块的 html
  let best = null
  for (const list of groups.values()) {
    if (list.length < 2) continue
    if (!best || list.length > best.length) best = list
  }
  if (!best) return []
  return best.map((node, index) => {
    const next = best[index + 1]
    const from = node.start
    const to = next ? next.start : body.length
    const html = body.slice(from, to)
    return { html, text: stripTags(html), attrs: node.attrs, openEnd: node.openEnd }
  })
}

/** 内置识别：<article> 标签（同样过滤垃圾标题） */
function parseArticles(html, baseUrl, limit) {
  const items = []
  for (const node of queryAll(html, 'article', 0)) {
    const anchor = queryAll(node.html, 'a', 1)[0]
    if (!anchor) continue
    const title = cleanTitle(anchor.text)
    const link = resolveUrl(attrOf(anchor.attrs, 'href'), baseUrl)
    if (!title || !isArticleLink(link, baseUrl)) continue
    items.push({ title, link, date: detectDate(node.html), from: 'article 标签' })
    if (items.length >= limit) break
  }
  return items
}

/**
 * 内置识别：不用用户规则时，在整页里找**真正像"文章列表"的那一块**。
 * 做法：把每个候选容器按"结构 + 里的链接"打分，取分最高的那个：
 *   · 有规律的文章链接（/news/、/details/… 或同域名同一层级）算正分
 *   · 标题偏长的条目算正分（导航菜单项通常很短）
 *   · 带日期的条目算正分
 *   · 外链、站内首页、无 href 的锚点一律不算文章
 * 这样导航菜单 / 侧边栏 / 页脚不会因为"块多"而被误当成文章列表。
 */
function parseRepeatedList(html, baseUrl, sel, limit) {
  const source = String(html || '')
  const containerSelector = [
    '[class*=list]', '[class*=List]', '[class*=news]', '[class*=News]', '[class*=article]', '[class*=Article]',
    '[class*=post]', '[class*=Post]', '[class*=feed]', '[class*=Feed]', '[class*=item]', '[class*=Item]',
    '[class*=grid]', '[class*=Grid]', '[class*=content]', '[class*=Content]', '[class*=borderTop]',
    'ul', 'ol',
  ].join(',')
  let best = []
  let bestScore = 0
  for (const container of queryAll(source, containerSelector, 80)) {
    // 导航/页脚/侧边栏这类容器直接跳过
    if (isNavLike(container.attrs || '')) continue
    const blocks = listChildren(container)
    if (blocks.length < 2) continue
    const items = []
    for (const block of blocks) {
      const item = pickOne(block, baseUrl, { linkSelector: '', titleSelector: '', dateSelector: sel.dateSelector || '' }, '内置识别')
      if (!item) continue
      if (!isArticleLink(item.link, baseUrl)) continue
      items.push(Object.assign({}, item, { date: item.date || detectDate(block.html) }))
      if (items.length >= limit) break
    }
    const score = scoreArticleList(items, baseUrl)
    if (score > bestScore) {
      bestScore = score
      best = items
    }
    if (bestScore >= limit * 4) break
  }
  return best
}

/** 容器 class/id 里带这些词 → 基本是导航/页脚/侧边栏，不是文章列表 */
const NAV_LIKE = /(^|[\s"'_-])(nav|menu|navbar|sidebar|side-bar|footer|header|breadcrumb|toolbar|topbar|tab|tabs|pagination|pager|share|social|friend|link|links|hot|recommend|ad|ads|banner)([\s"'_-]|$)/i

function isNavLike(attrs) {
  const text = String(attrs || '')
  const cls = (attrOf(text, 'class') || '') + ' ' + (attrOf(text, 'id') || '')
  return NAV_LIKE.test(cls)
}

/** 给"一组候选条目"打分：越像文章列表分越高（正分才可能被采用） */
function scoreArticleList(items, baseUrl) {
  if (!items || items.length < 2) return 0
  const host = hostOf(baseUrl)
  // 文章链接的"路径签名"（把数字换成 #）：真列表通常共享同一套签名
  const sig = (link) => {
    try {
      const u = new URL(link)
      return `/${u.pathname
        .split('/')
        .filter(Boolean)
        .map((seg) => (/^\d+$/.test(seg) || seg.length > 24 ? '#' : seg))
        .join('/')}`
    } catch (err) {
      return ''
    }
  }
  const counts = new Map()
  let sameHost = 0
  let longTitles = 0
  let dated = 0
  let distinctLinks = new Set()
  for (const it of items) {
    distinctLinks.add(it.link)
    if (hostOf(it.link) === host) sameHost++
    if (it.title.length >= 12) longTitles++
    if (it.date) dated++
    const s = sig(it.link)
    counts.set(s, (counts.get(s) || 0) + 1)
  }
  const patternHits = Math.max(...counts.values())
  const dupRatio = 1 - distinctLinks.size / items.length
  let score = 0
  score += patternHits * 4 // 链接结构一致（真正的列表特征）
  score += longTitles * 2 // 标题够长（导航项一般很短）
  score += dated * 2 // 带日期
  score += sameHost // 站内链接
  score -= dupRatio * items.length * 6 // 大量重复链接（菜单/推荐位）扣分
  return score
}

/**
 * 清洗"标题"。
 * 合并空白、去掉开头的装饰符与首尾引号；**超过 TITLE_MAX 强制截断加"……"**。
 */
export const TITLE_MAX = 50

export function cleanTitle(text, max = TITLE_MAX) {
  let out = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—|·•・:：\s]+/, '')
    .trim()
  // 标题里不该出现的换行残留 / 首尾引号
  out = out.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (!out) return ''
  // 有些站点把标题拼了两遍（"标题 标题"）或"标题+摘要"连在一起 → 只留前半段
  out = compactTitle(out)
  if (out.length > max) out = `${out.slice(0, max).trim()}……`
  return out
}

/**
 * 把"重复拼两遍"的标题压成一份。
 * 比如 aibase 的 `<h1>标题<span>标题</span></h1>` 取纯文本会变成 "标题 标题"，
 * 或者 `<div>标题<div>标题 + 摘要…</div></div>` 会变成 "标题 标题+摘要…"，
 * 列表里看着就是每条都重复、长度还被撑成两倍。只留重复的那一份。
 */
export function compactTitle(text) {
  let raw = String(text || '').trim()
  if (raw.length < 8) return raw
  // 先反复折半：整串正好由"同一段重复 N 遍"拼成的，压成一份
  for (let round = 0; round < 3; round++) {
    const half = Math.floor(raw.length / 2)
    const a = raw.slice(0, half).trim()
    const b = raw.slice(half).trim()
    if (!a || a !== b) break
    raw = a
  }
  if (raw.length < 8) return raw
  // 用标点/分隔符切成小段，若某段是"后面某段"的前缀（或完全相等），说明是重复的 → 只留第一段
  const segs = raw.split(/[\s｜|·:：\-–—，,。！？!?；;]+/).map((s) => s.trim()).filter(Boolean)
  if (segs.length >= 2) {
    const first = segs[0]
    for (let i = 1; i < segs.length; i++) {
      if (segs[i] === first || segs[i].startsWith(first)) return first
    }
  }
  // "标题 + 摘要"粘在一起（开头那一截在后面又出现一次）：只留前面
  if (raw.length >= 24) {
    const head = raw.slice(0, Math.min(15, raw.length - 10)).trim()
    if (head.length >= 8) {
      const at = raw.indexOf(head, head.length)
      if (at !== -1) {
        const trimmed = raw.slice(0, at).trim()
        if (trimmed.length >= 8) return trimmed
      }
    }
  }
  return raw
}

/**
 * 标题是不是"太长、明显是摘要/正文"。
 * 常用来剔除兜底扫描抓到的长链接文字（那种通常是整段内容）。
 */
function looksLikeParagraph(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (raw.length <= TITLE_MAX + 30) return false
  // 长文本里出现句末标点/分段，基本可以确定是正文而不是标题
  return /[。！？!?；;]/.test(raw.slice(0, TITLE_MAX + 20))
}

/** 排除导航/标签页之类明显不是文章的链接 */
function isArticleLink(link, baseUrl) {
  if (!link || !/^https?:/i.test(link)) return false
  if (link === baseUrl || link === `${baseUrl}/`) return false
  if (/#$/.test(link)) return false
  if (/\/(tag|tags|category|categories|author|about|login|signup|privacy|terms)\b/i.test(link)) return false
  return true
}

function dedupe(items, limit, baseUrl) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (!item || !item.title || !item.link) continue
    const key = item.link || item.title
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title: item.title, link: item.link, date: item.date || '', from: item.from || '', source: hostOf(item.link) || hostOf(baseUrl) })
    if (out.length >= limit) break
  }
  return out
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch (err) {
    return ''
  }
}

/** 从详情页拿标题和日期（抓不到就用列表页的） */
export function parseArticle(html, url) {
  const title =
    metaContent(html, 'og:title') ||
    stripTags((findTag(html, 'title') ? innerHtmlOf(html, 'title', findTag(html, 'title').openEnd) : '')) ||
    stripTags((findTag(html, 'h1') ? innerHtmlOf(html, 'h1', findTag(html, 'h1').openEnd) : ''))
  // 详情页的 <title> 有时是"站点名 - 长摘要"，太长的直接丢掉（宁可没有标题，也别把正文当标题）
  const safeTitle = looksLikeParagraph(title) ? '' : title
  const date = detectDate(html)
  const description = metaContent(html, 'og:description') || metaContent(html, 'description')
  const bodyText = extractBodyText(html)
  return {
    url,
    title: cleanTitle(safeTitle),
    date,
    description: String(description || '').slice(0, 300),
    bodyText,
  }
}

/** 今天的日期（**北京时间**，YYYY-MM-DD），给"最近 N 天"过滤用 */
function todayString() {
  return beijingStampOf(new Date())
}

/**
 * 这条资讯在不在"最近 N 天"里（判据必须是详情页读到的真实日期）。
 * - 读不到日期：**返回 false（丢掉）**。按需求：日期读不到的条目不再保留、也不再标"最新"，
 *   否则界面上就会有"2 天前的内容被标成最新"这种假象。
 * - 有日期：今天算第 1 天，往前数 N 天（days=1 就是只留今天）。
 *   比今天还新一点的（站点时区误差 / 预告）放行 1 天，避免跨时区把当天内容误杀。
 * （导出只是为了能单独验证这段判断，插件内部照样用）
 */
export function withinRecentDays(dateStr, days) {
  const text = String(dateStr || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const toNum = (value) => {
    const [y, m, d] = value.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  const diff = Math.round((toNum(todayString()) - toNum(text)) / 86400000)
  // diff < 0 是"日期比今天还新"（站点时区误差/预告），也放行
  return diff >= 0 ? diff <= days - 1 : diff >= -1
}

/** 抽正文前，先削掉开头的"栏目名 / 站点名 / 标题 / 发布时间 / 阅读数"这串页头
 *  （真正的实现放在 rules.js 的 stripLeadNoise 里，这里保留老函数名，调用点不用动） */
function trimArticleLead(text, title, siteName) {
  return stripLeadNoise(text, { title, source: siteName })
}

/**
 * 正文里**整行丢弃**的干扰行（用户反馈：底部混进"版权所有…违者必究""相关阅读""热门文章"）
 * 命中任意一个关键词的行直接不要。
 */
const BODY_DROP_LINE = /(版权所有|违者必究|未经授权|相关阅读|热门文章|推荐阅读|猜你喜欢|免责声明|扫码关注|扫码分享|责任编辑|点击阅读原文|更多精彩)/

/**
 * 正文**区域外**的干扰区块：这些 class / id 命中的容器连里面的标签一起删掉（提取前先删）。
 * 覆盖用户点名的：相关阅读 / 热门文章 / 推荐阅读 / 版权声明 / 分享按钮 / 评论区 / 侧边栏。
 */
const BODY_BLOCK_MARKER = /(related|recommend|hot-?|hot_|tuijian|xiangguan|yaowen|热门|推荐|相关|comment|pinglun|评论|sidebar|side-?bar|content_right|侧栏|侧边|share|分享|footer|copyright|版权|breadcrumb|crumb|nav|menu|广告|advert|banner|qrcode|erweima|二维码|subscribe|订阅|person|tags)/i

/** 这些标签本身不用去匹配"干扰区块"（结构标签） */
const BLOCK_SCAN_SKIP = new Set(['html', 'body', 'head', 'script', 'style', 'meta', 'link', 'title'])

/**
 * 这些标签**没有闭合标签**（Void Elements）。
 * ⚠ 必须按"自闭合"处理：以前这里拿 `<tag` / `</tag` 硬数嵌套，
 *   一旦碰到 `<img>`（页面里满地都是、永远没有 `</img>`），深度就再也回不到 0，
 *   于是"这个元素一直延伸到文档末尾" —— dropNoiseBlocks 会把整页正文连着删掉，
 *   结果就是详情页正文抓出来是空的（用户反馈的"正文是空的"就是这个原因）。
 */
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'])

/** 从 openEnd（`>` 的下标）往后扫一行，判断这个标签是自闭合的、还是闭合标签、还是普通开始标签 */
function tagTokenOf(source, at, tagLength) {
  let gt = source.indexOf('>', at + tagLength)
  if (gt === -1) gt = source.length - 1
  const inner = source.slice(at + tagLength, gt)
  return { gt, selfClosed: /\/\s*$/.test(inner) }
}

/**
 * 找一个元素在源码里的起止位置（含闭合标签；确实找不到闭合才延伸到文档末尾）。
 * - 自闭合标签（img/br/meta…）只占它自己那一个标签
 * - 嵌套只在**同名**标签上 +1 / -1，兄弟标签里的 `<img>` 不再影响深度
 */
function elementRange(source, tag, openStart, openEnd) {
  const lower = source.toLowerCase()
  const openToken = `<${tag}`
  const closeToken = `</${tag}`
  const target = String(tag).toLowerCase()
  const head = tagTokenOf(source, openStart, openToken.length)
  if (VOID_TAGS.has(target) || head.selfClosed) {
    return { start: openStart, end: head.gt === -1 ? source.length : head.gt + 1 }
  }
  let depth = 1
  let cursor = openEnd + 1
  while (cursor < source.length) {
    const nextOpen = lower.indexOf(openToken, cursor)
    const nextClose = lower.indexOf(closeToken, cursor)
    if (nextClose === -1) return { start: openStart, end: source.length }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const after = lower.charAt(nextOpen + openToken.length)
      if (after === '>' || after === '/' || /\s/.test(after)) {
        const token = tagTokenOf(source, nextOpen, openToken.length)
        if (!VOID_TAGS.has(target) && !token.selfClosed) depth++
      }
      cursor = nextOpen + openToken.length
      continue
    }
    depth--
    if (depth === 0) {
      const gt = source.indexOf('>', nextClose)
      return { start: openStart, end: gt === -1 ? source.length : gt + 1 }
    }
    cursor = nextClose + closeToken.length
  }
  return { start: openStart, end: source.length }
}

/** 把命中的干扰区块（相关阅读 / 热门文章 / 评论 / 侧边栏 / 分享 / 版权…）整块删掉 */
function dropNoiseBlocks(html) {
  let out = String(html || '')
  for (let round = 0; round < 40; round++) {
    const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g
    let match
    let cut = null
    while ((match = tagRe.exec(out)) !== null) {
      const tag = match[1].toLowerCase()
      if (BLOCK_SCAN_SKIP.has(tag)) continue
      const attrs = match[2] || ''
      const marker = `${attrOf(attrs, 'class')} ${attrOf(attrs, 'id')}`.trim()
      if (!marker || !BODY_BLOCK_MARKER.test(marker)) continue
      cut = { tag, openStart: match.index, openEnd: match.index + match[0].length - 1 }
      break
    }
    if (!cut) break
    const range = elementRange(out, cut.tag, cut.openStart, cut.openEnd)
    if (range.end <= range.start) break
    out = `${out.slice(0, range.start)} ${out.slice(range.end)}`
  }
  return out
}

/** 把一段 HTML 变成"按行"的纯文本（块级标签转换行），再丢掉干扰行 */
function htmlToLines(html) {
  let source = String(html || '')
  source = source.replace(/<(script|style|noscript|svg|iframe|form|button|select)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  source = source.replace(/<br\s*\/?>/gi, '\n')
  source = source.replace(/<\/(p|div|li|tr|td|dd|dt|h[1-6]|section|article|aside|blockquote|figure|figcaption|ul|ol|table)>/gi, '\n')
  const text = decodeEntities(source.replace(/<[^>]*>/g, ' '))
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, ' ').trim())
    .filter(Boolean)
}

/** 正文容器的常见 class / id 命名（没有 <article> 时用它兜底定位） */
const CONTENT_BLOCK_MARKER = /(article|post|entry|news|detail|main|story)[-_]?(content|body|text|main|wrap|inner)|content[-_]?(body|main|article|text)|正文/i

/**
 * 没找到 <article> 时，靠 class / id 命名"猜"正文容器。
 * 命中的元素里可能既有外层大包装（.article-wrap）又有真正的正文块（.article-content），
 * 所以取"够长（≥120 字）里**最小**的那个"—— 只要它不小于最长那个的一半，
 * 就认为它是更精确的正文容器（外层包装通常会连标题、作者、页脚一起包进来）。
 * 猜不到就返回 null（外层继续用整页文本）。
 */
function pickContentBlock(source) {
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g
  const skipTags = new Set(['a', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'em', 'strong', 'td', 'th'])
  const found = []
  let match
  while ((match = tagRe.exec(source)) !== null) {
    const tag = match[1].toLowerCase()
    if (BLOCK_SCAN_SKIP.has(tag) || skipTags.has(tag)) continue
    const marker = `${attrOf(match[2] || '', 'class')} ${attrOf(match[2] || '', 'id')}`.trim()
    if (!marker || !CONTENT_BLOCK_MARKER.test(marker)) continue
    const openEnd = match.index + match[0].length - 1
    const len = stripTags(innerHtmlOf(source, tag, openEnd)).length
    if (len >= 120) found.push({ tag, openEnd, len })
  }
  if (!found.length) return null
  const longest = found.reduce((best, item) => (item.len > best.len ? item : best), found[0])
  const smallest = found.reduce((best, item) => (item.len < best.len ? item : best), found[0])
  return smallest.len >= longest.len * 0.5 ? smallest : longest
}

/**
 * 抽取正文纯文本。
 * 按用户要求分三步：
 *   ① 先删掉 script/style/nav/footer/aside 这些明显不是正文的标签；
 *   ② **提取前**把"相关阅读 / 热门文章 / 推荐 / 评论 / 侧边栏 / 分享 / 版权"这类区块整块删掉；
 *   ③ 转成按行的纯文本后，**整行丢弃**带"版权所有/违者必究/相关阅读/热门文章…"这些词的行。
 * 正文容器：优先 <article>；没有再按 class/id 命名猜一个（取最长的那个）；都没有就用整页。
 *
 * ⚠ 防"正文是空的"：删噪音（第②步）有可能把正文连着一块删掉（容器的 class 里带 side / 相关 之类），
 *   所以这里做两级兜底 —— 先按"删过噪音"的版本抽，抽出来太短就退回"没删噪音"的版本再抽一次，
 *   两次都短就整页转文本兜底。宁可正文里多几行页脚，也不能给用户一个空正文。
 * @param {string} html 详情页 HTML
 * @param {number} maxChars 最多留多少字
 */
export function extractBodyText(html, maxChars = 4000) {
  const raw = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|iframe|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  const picked = (source) => {
    const article = findTag(source, 'article')
    if (article) return innerHtmlOf(source, 'article', article.openEnd)
    const block = pickContentBlock(source)
    return block ? innerHtmlOf(source, block.tag, block.openEnd) : source
  }
  // 第③步：整行过滤。页脚标记（版权所有/相关阅读/热门文章…）如果出现在**后半段**，
  // 说明正文已经结束了，从这里往后整段都不要；万一它出现在前半段（正文里正常提到），
  // 就只丢那一行，绝不把正文砍掉。
  const toText = (source) => {
    const lines = htmlToLines(picked(source))
    const total = lines.reduce((sum, line) => sum + line.length, 0)
    const kept = []
    let cursor = 0
    for (const line of lines) {
      cursor += line.length
      if (BODY_DROP_LINE.test(line)) {
        if (total > 0 && cursor >= total * 0.4) break
        continue
      }
      kept.push(line)
    }
    return kept.join('\n')
  }
  const clean = toText(dropNoiseBlocks(raw))
  if (clean.length >= 160) return clean.slice(0, maxChars)
  // 兜底一：不删噪音（有些站的正文容器 class 正好撞上"噪音关键词"）
  const loose = toText(raw)
  if (loose.length > clean.length) return loose.slice(0, maxChars)
  if (clean) return clean.slice(0, maxChars)
  // 兜底二：整页文本
  return htmlToLines(raw).join('\n').slice(0, maxChars)
}

// ---------------------------------------------------------------------------
// 困难网站：走浏览器抓取
// ---------------------------------------------------------------------------

/** 探测本机是否开着可用的 Chrome 调试端口 */
export async function browserAvailable(cdpBaseUrl = 'http://127.0.0.1:9222', timeoutMs = 1500) {
  try {
    const response = await fetch(`${String(cdpBaseUrl).replace(/\/$/, '')}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { ok: false, error: `调试端口返回 HTTP ${response.status}` }
    const data = await response.json()
    return { ok: true, browser: String(data['Browser'] || 'Chrome') }
  } catch (err) {
    return { ok: false, error: '连不上本机 Chrome 调试端口（127.0.0.1:9222）' }
  }
}

/**
 * 用浏览器（CDP）打开页面并取回渲染后的 HTML。
 * 适用场景：整站 JS 渲染、需要登录态的"困难"网站。
 */
export async function browserFetchText(url, cdpBaseUrl = 'http://127.0.0.1:9222', timeoutMs = 20000) {
  const available = await browserAvailable(cdpBaseUrl)
  if (!available.ok) return { ok: false, error: available.error }
  const base = String(cdpBaseUrl).replace(/\/$/, '')
  let wsUrl = ''
  try {
    const response = await fetch(`${base}/json/new?${encodeURIComponent('about:blank')}`, {
      method: 'PUT',
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      const target = await response.json()
      wsUrl = target.webSocketDebuggerUrl || ''
    }
  } catch (err) {
    /* 老版本 Chrome 不支持 PUT /json/new，走下面兜底 */
  }
  if (!wsUrl) {
    try {
      const response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) })
      const targets = await response.json()
      const page = Array.isArray(targets) ? targets.find((t) => t && t.type === 'page' && t.webSocketDebuggerUrl) : null
      if (page) wsUrl = page.webSocketDebuggerUrl
    } catch (err) {
      return { ok: false, error: '拿不到浏览器的调试连接' }
    }
  }
  if (!wsUrl) return { ok: false, error: '浏览器里没有可用的标签页' }

  const WebSocketImpl = typeof WebSocket === 'function' ? WebSocket : null
  if (!WebSocketImpl) return { ok: false, error: '当前 Node 版本不支持 WebSocket，无法走浏览器抓取' }

  return await new Promise((resolve) => {
    const socket = new WebSocketImpl(wsUrl)
    let nextId = 1
    let finished = false
    const pending = new Map()
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true
        try {
          socket.close()
        } catch (err) {
          /* 忽略 */
        }
        resolve({ ok: false, error: `浏览器抓取超时（>${timeoutMs}ms）` })
      }
    }, timeoutMs)

    const send = (method, params) =>
      new Promise((res) => {
        const id = nextId++
        pending.set(id, res)
        socket.send(JSON.stringify({ id, method, params: params || {} }))
      })

    socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch (err) {
        return
      }
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message.result)
        pending.delete(message.id)
      }
    })

    socket.addEventListener('error', () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve({ ok: false, error: '浏览器连接出错' })
    })

    socket.addEventListener('open', async () => {
      try {
        await send('Page.enable')
        await send('Page.navigate', { url })
        await sleep(4500) // 等 JS 渲染（动态站点的列表要等接口回来才出来）
        const result = await send('Runtime.evaluate', {
          expression: 'document.documentElement.outerHTML',
          returnByValue: true,
        })
        const html = result && result.result ? result.result.value : ''
        finished = true
        clearTimeout(timer)
        try {
          socket.close()
        } catch (err) {
          /* 忽略 */
        }
        if (!html) resolve({ ok: false, error: '浏览器没有取到页面内容' })
        else resolve({ ok: true, text: String(html), finalUrl: url })
      } catch (err) {
        finished = true
        clearTimeout(timer)
        resolve({ ok: false, error: `浏览器抓取出错：${(err && err.message) || err}` })
      }
    })
  })
}

/**
 * 抓一个网站（返回该站点的条目 + 失败信息）
 * @param {object} site 网站配置
 * @param {object} options { fetch 配置, browserCdpUrl, onProgress }
 */
export async function crawlSite(site, options = {}) {
  const config = Object.assign({ timeoutMs: 10000, retries: 3, maxItemsPerSite: 8 }, options.fetch || {})
  // 每个站最多抓几条：**按设置里的值来**（上限 50）。
  // 之前这里被写死成 Math.min(10, …)，所以设置里填 50 也只抓到 10 条。
  const limit = Math.max(1, Math.min(50, Number(config.maxItemsPerSite) || 8))
  const started = Date.now()
  const report = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  appendLog(`—— 开始抓取「${site.name}」${site.url}（难度：${site.difficulty}）`)

  if (!/^https?:\/\//i.test(String(site.url || ''))) {
    appendLog(`跳过「${site.name}」：网址不合法（${site.url}）`)
    return { ok: false, site: site.name, url: site.url, reason: '网址不合法', items: [] }
  }

  let page = null
  let usedBrowser = false

  if (site.difficulty === '困难') {
    const viaBrowser = await browserFetchText(site.url, options.browserCdpUrl, Math.max(config.timeoutMs * 2, 20000))
    if (viaBrowser.ok) {
      page = { ok: true, text: viaBrowser.text, finalUrl: viaBrowser.finalUrl }
      usedBrowser = true
    } else {
      appendLog(`「${site.name}」浏览器抓取不可用：${viaBrowser.error}，回退普通抓取`)
    }
  }
  if (!page) page = await fetchText(site.url, { timeoutMs: config.timeoutMs, retries: config.retries })

  if (!page.ok) {
    appendLog(`「${site.name}」抓取失败：${page.error}`)
    return { ok: false, site: site.name, url: site.url, reason: page.error, items: [] }
  }

  let entries = parseList(page.text, site.url, site.selectors, limit)
  // 条目太少：列表可能是"懒加载/异步渲染"的，隔一会儿再拉几次（首屏只渲染了几条的情况）
  const enough = Math.min(MIN_LIST_ITEMS, limit)
  for (let attempt = 0; entries.length < enough && attempt < 2; attempt++) {
    appendLog(`「${site.name}」首屏只解析出 ${entries.length} 条（不足 ${enough} 条），等懒加载后再抓一次（第 ${attempt + 1} 次重试）`)
    await politeDelay(1200, 2200)
    const again = await fetchText(site.url, { timeoutMs: config.timeoutMs, retries: 1 })
    if (!again.ok) break
    const second = parseList(again.text, site.url, site.selectors, limit)
    if (second.length > entries.length) {
      entries = second
      page = { ok: true, text: again.text, finalUrl: again.finalUrl }
    }
  }
  // 还是不够，而且这个站不是"困难"类型：多半是整站 JS 渲染（直接请求拿不到列表）。
  // 这时自动走一次"浏览器抓取"（用本机 Chrome 的调试端口渲染后再取 DOM）——
  // 需要用户在设置里填对 Chrome 调试端口，并且 Chrome 是带 --remote-debugging-port 启动的。
  if (!usedBrowser && entries.length < enough) {
    const viaBrowser = await browserFetchText(site.url, options.browserCdpUrl, Math.max(config.timeoutMs * 2, 20000))
    if (viaBrowser.ok) {
      const rendered = parseList(viaBrowser.text, site.url, site.selectors, limit)
      if (rendered.length > entries.length) {
        appendLog(`「${site.name}」直连只拿到 ${entries.length} 条，用浏览器渲染后拿到 ${rendered.length} 条`)
        entries = rendered
        page = { ok: true, text: viaBrowser.text, finalUrl: viaBrowser.finalUrl }
        usedBrowser = true
      }
    } else {
      appendLog(`「${site.name}」直连只拿到 ${entries.length} 条，浏览器渲染也不可用：${viaBrowser.error}`)
    }
  }
  if (!entries.length) {
    appendLog(`「${site.name}」解析不出条目（选择器可能过期）`)
    return { ok: false, site: site.name, url: site.url, reason: '解析不到文章列表（可能是选择器过期或页面结构变化）', items: [] }
  }
  if (entries.length < enough) {
    appendLog(`「${site.name}」只解析出 ${entries.length} 条（不足 ${enough} 条）：该站可能是 JS 动态渲染，需要本机 Chrome 调试端口才能抓全，或改成「困难」类型`)
  }

  // 去详情页读**真实发布时间**（+ 顺手拿完整正文，给「④ 写文案」原封不动用）。
  // 列表页 99% 的站点不给日期，而"抓取最近几天"这个设置必须按真实发布日期判，
  // 所以按需求：**每一条都去详情页读**（以前最多只补 12 条，排在后面的条目读不到日期，
  // 就被当成"最新"混进来了 —— 用户反馈的"选今天却抓出 2 天前的内容"就是这么来的）。
  // 每天最多请求数仍由设置项 maxItemsPerSite 管着（上限 50），不会无限翻页。
  const recentDaysConfig = Math.max(0, Math.min(30, Number(config.days) || 0))
  const needDetail = entries.filter((item) => !item.date || !item.bodyText)
  const detailCap = Math.max(0, Math.min(50, Number(config.detailMaxPerSite) || 12))
  // 开了时间过滤就必须每条都读日期；没开时间过滤时才按 detailMaxPerSite 省请求
  const detailLimit = recentDaysConfig > 0 ? needDetail.length : Math.max(0, Math.min(needDetail.length, detailCap))
  report({ phase: 'detail', detailDone: 0, detailTotal: detailLimit })
  for (let i = 0; i < detailLimit; i++) {
    const item = needDetail[i]
    if (i > 0) await politeDelay(config.detailMinDelayMs || 250, config.detailMaxDelayMs || 800)
    const detail = await fetchText(item.link, { timeoutMs: config.timeoutMs, retries: 2 })
    if (detail.ok) {
      const article = parseArticle(detail.text, item.link)
      if (article.date) item.date = article.date
      // ⚠ 这里**不再**用详情页的标题覆盖列表标题：
      //   详情页的 <title> 常常是"站点名 - 长摘要/栏目串"，换上去就让列表里出现大段正文
      //   （"base 分组标题混入摘要"就是这么来的）。列表页的锚点文字本来就是标题。
      // 正文：**整篇都留着**（最多 4000 字）。
      // ⚠ 以前这里只留 300 字，导致「④ 写文案」点刷新时粘贴过去的正文是断的
      //   （用户反馈"没粘贴全"就是这个原因）。筛选/摘要用的时候各自会截断，不影响。
      // ⚠ 详情页正文实在抽不出来（抽到的是空/极短）时，退回 og:description ——
      //   保证"正文"这一栏不会是空的（用户反馈的"原文没有摘要"就是这个）。
      const detailBody = trimArticleLead(article.bodyText, article.title, site.name).slice(0, 4000)
      if (detailBody.replace(/\s+/g, '').length < 30) {
        const fallback = String(article.description || item.description || '').trim()
        item.bodyText = fallback || detailBody
      } else {
        item.bodyText = detailBody
      }
      item.description = String(article.description || item.description || '').slice(0, 300)
    }
    report({ phase: 'detail', detailDone: i + 1, detailTotal: detailLimit })
  }

  // 按设置里的"抓取最近几天"过滤（设置页：抓取参数 → 抓取最近几天）
  // 判据：详情页读到的**真实发布时间**。
  // 按需求：
  //   ① 不在时间范围内的（比如设置"今天"却抓到 2 天前的）→ 直接丢掉；
  //   ② 详情页也读不到日期的 → 同样丢掉，界面不再出现"最新"这种假日期；
  //   ③ 过滤后一条不剩就让它空着（不再"兜底保留全站"，那正是旧日期的来源）。
  const recentDays = Math.max(0, Math.min(30, Number(config.days) || 0))
  let keptEntries = entries
  let droppedByDay = 0
  let droppedNoDate = 0
  if (recentDays > 0) {
    keptEntries = entries.filter((item) => {
      if (!String(item.date || '').trim()) {
        droppedNoDate++
        return false
      }
      if (withinRecentDays(item.date, recentDays)) return true
      droppedByDay++
      return false
    })
    appendLog(
      `「${site.name}」时间过滤：列表共 ${entries.length} 条 → 保留 ${keptEntries.length} 条` +
        `（超出"最近 ${recentDays} 天"丢掉 ${droppedByDay} 条，读不到日期丢掉 ${droppedNoDate} 条）`,
    )
    if (!keptEntries.length) {
      appendLog(`「${site.name}」按"最近 ${recentDays} 天"过滤后一条都不剩（本次不保留任何条目，避免把旧资讯当新的）`)
    }
  }

  const items = keptEntries.map((item) => ({
    title: item.title,
    link: item.link,
    date: item.date || '',
    dateLabel: item.date || '',
    source: site.name,
    // 正文：整篇留着（最多 4000 字），给「④ 写文案」原封不动粘贴用；
    // 列表界面不渲染它，模块3 的总结也只截前面一段。
    bodyText: String(item.bodyText || '').slice(0, 4000),
    description: String(item.description || '').slice(0, 300),
    status: 'success',
    via: usedBrowser ? '浏览器' : '普通抓取',
  }))
  appendLog(`「${site.name}」抓取完成：${items.length} 条（已读到日期 ${items.filter((item) => item.date).length} 条，带正文 ${items.filter((item) => item.bodyText).length} 条，${Date.now() - started}ms，方式：${usedBrowser ? '浏览器' : '普通抓取'}）`)
  return { ok: true, site: site.name, url: site.url, items }
}

/**
 * 抓取设置里的全部网站（网站之间随机间隔 1.5~3.5 秒）
 * @param {object} settings 设置
 * @param {object} options { onProgress } 进度回调（界面用它画进度条）
 * @returns {Promise<{items:Array, failures:Array, sites:Array}>}
 */
export async function crawlAll(settings, options = {}) {
  const sites = Array.isArray(settings.websites) ? settings.websites : []
  const fetchConfig = Object.assign({}, settings.fetch || {})
  const report = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  const items = []
  const failures = []
  const siteResults = []
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]
    if (i > 0) await politeDelay(fetchConfig.minDelayMs, fetchConfig.maxDelayMs)
    report({ phase: 'site', siteIndex: i, siteName: site.name, done: i, total: sites.length, items: items.length, failures: failures.length })
    let result
    try {
      result = await crawlSite(site, {
        fetch: fetchConfig,
        browserCdpUrl: settings.browserCdpUrl,
        onProgress: (patch) => report(Object.assign({ phase: 'site', siteIndex: i, siteName: site.name, done: i, total: sites.length, items: items.length, failures: failures.length }, patch)),
      })
    } catch (err) {
      result = { ok: false, site: site.name, url: site.url, reason: (err && err.message) || String(err), items: [] }
      appendLog(`「${site.name}」抓取异常：${result.reason}`)
    }
    siteResults.push({ site: site.name, url: site.url, ok: result.ok, count: result.items.length, reason: result.reason || '' })
    if (result.ok) items.push(...result.items)
    else failures.push({ source: site.name, url: site.url, reason: result.reason || '未知错误' })
    report({
      phase: 'site',
      siteIndex: i,
      siteName: site.name,
      done: i + 1,
      total: sites.length,
      items: items.length,
      failures: failures.length,
      lastOk: !!result.ok,
      lastCount: result.items.length,
    })
  }
  return { items, failures, sites: siteResults }
}

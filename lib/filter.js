/**
 * AI 资讯工作台 —— 模块3 本地筛选器（**不调用大模型**）
 *
 * 六条标准用关键词 + 可观察事实判定，尽量保守：
 * 判不出来的一律不勾（宁可不选，也不硬凑），并且把"为什么勾/为什么不勾"写清楚。
 * 每条候选的 summary 直接由原文标题/摘要拼成，**数字、人名、时间、版本号全部来自原文**。
 */

import { FILTER_ITEMS, countChecks, HIGHLIGHT_PATTERNS, TOPIC_SCORE_ITEMS, cleanExcerpt } from './rules.js'

/**
 * 六大判断标准的**默认关键词表**。
 * ⚠ 这只是出厂默认值：设置页「筛选规则关键词」里改过的会存进 settings.filterKeywords，
 *   判定时优先用用户改过的那份（见 resolveKeywords）。所以不要再把这些写死在判定逻辑里。
 */
export const DEFAULT_FILTER_KEYWORDS = {
  /** 大厂发布 */
  bigTech: [
    'openai', 'anthropic', 'google', 'deepmind', 'meta', 'microsoft', 'nvidia', '英伟达',
    '字节', '阿里', '腾讯', '百度', '华为', '月之暗面', '智谱', 'minimax', 'deepseek',
    'apple', '苹果', 'amazon', '亚马逊', 'xai', 'grok', 'sora', 'gemini', 'claude', 'gpt', 'llama', 'qwen',
  ],
  /** 开源爆款 */
  openSource: ['github', 'hugging face', 'huggingface', '开源', '仓库', 'star', '星', '权重', '可商用', 'apache', 'mit 协议'],
  /** 免费 / 降价 */
  freeOrCheap: ['免费', '降价', '开源', '白嫖', '限免', '试用', '不收钱', '0 元', '零成本', '免费额度', 'free', 'open source', 'open-source'],
  /** 离谱 / 有话题 */
  weird: ['居然', '竟然', '离谱', '反转', '封禁', '起诉', '泄露', '翻车', '道歉', '吵架', '奇葩', '离职', '内讧', '造假', '事故', '被罚', '打脸'],
  /** 信息差 */
  infoGap: ['悄悄', '低调', '小范围', '内测', '灰度', '冷门', '没人注意', '少有人知', '隐藏', '彩蛋', '冷知识'],
}

/**
 * 「可延展」这一项不是靠关键词，靠两个门槛：
 * 原文里具体信息（数字/版本号/日期）的条数，或者正文长度。
 */
export const DEFAULT_FILTER_EXTEND = { minFacts: 2, minChars: 200 }

/** 这次判定要用的关键词表（用户改过就用用户的，没配过就用默认） */
export function resolveKeywords(settings) {
  const raw = (settings && settings.filterKeywords) || {}
  const out = {}
  for (const key of Object.keys(DEFAULT_FILTER_KEYWORDS)) {
    out[key] = Array.isArray(raw[key])
      ? raw[key].map((word) => String(word || '').trim()).filter(Boolean)
      : DEFAULT_FILTER_KEYWORDS[key].slice()
  }
  return out
}

/** 这次判定要用的「可延展」门槛 */
export function resolveExtend(settings) {
  const raw = (settings && settings.filterExtend) || {}
  const num = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    minFacts: num(raw.minFacts, DEFAULT_FILTER_EXTEND.minFacts),
    minChars: num(raw.minChars, DEFAULT_FILTER_EXTEND.minChars),
  }
}

/**
 * 模块3 的时间筛选档位（界面上那个下拉框用）
 * all=全部（默认）/ today=今天 / 3d=近 3 天 / 7d=近 7 天
 */
export const TIME_RANGES = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: '3d', label: '近 3 天' },
  { key: '7d', label: '近 7 天' },
]

/** 档位 -> 覆盖天数（0 表示不限） */
export function rangeDays(range) {
  if (range === 'today') return 1
  if (range === '3d') return 3
  if (range === '7d') return 7
  return 0
}

/**
 * 'YYYY-MM-DD'（也容忍 'YYYY-M-D' / 'YYYY-MM-DD HH:MM'）-> 当天的 UTC 毫秒数
 * （只按"日期"算天数差，不受时区/时分秒影响）
 */
function dayNumber(value) {
  const text = String(value || '').trim().slice(0, 10)
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || !mo || !d || mo > 12 || d > 31) return null
  return Date.UTC(y, mo - 1, d)
}

/**
 * 这条资讯在不在选定的时间段里。
 *
 * ⚠ 判据是**详情页读到的真实发布日期**（用户反馈过"选今天却看到 2 天前的内容"）：
 *   读不到日期的条目一律不算在时间档位里（返回 false）。
 *   以前这里按"抓取当天"兜底，等于把没有日期的旧资讯也算成今天的，所以才会串。
 *
 * @param {object} item 抓取条目
 * @param {string} range all | today | 3d | 7d
 * @param {string} todayStr 今天（北京时间的 YYYY-MM-DD）
 */
export function withinRange(item, range, todayStr) {
  const days = rangeDays(range)
  if (!days) return true
  const dateText = String((item && item.date) || '').trim()
  const dateNum = dayNumber(dateText)
  const todayNum = dayNumber(todayStr)
  if (dateNum === null || todayNum === null) return false
  const diff = Math.round((todayNum - dateNum) / 86400000)
  return diff >= 0 && diff <= days - 1
}

function textOf(item) {
  return `${(item && item.title) || ''} ${(item && item.description) || ''} ${(item && item.bodyText) || ''}`.toLowerCase()
}

function hasAny(text, words) {
  const hit = words.filter((word) => text.includes(String(word).toLowerCase()))
  return { hit: hit.length > 0, words: hit.slice(0, 3) }
}

/** 数一下文本里有多少"具体信息"（数字/版本号/日期） */
function factCount(text) {
  let count = 0
  for (const pattern of HIGHLIGHT_PATTERNS.slice(0, 3)) {
    const re = new RegExp(pattern.source, 'g')
    const found = String(text).match(re)
    if (found) count += found.length
  }
  return count
}

/**
 * 对一条资讯逐项判定
 * @param {object} item 抓取条目
 * @param {object} [options] { keywords, extend } 关键词表与"可延展"门槛（设置页可改）
 * @returns {{checks: object, reasons: object, facts: number}}
 */
export function judgeItem(item, options = {}) {
  const keywords = Object.assign({}, DEFAULT_FILTER_KEYWORDS, options.keywords || {})
  const extend = Object.assign({}, DEFAULT_FILTER_EXTEND, options.extend || {})
  const text = textOf(item)
  const title = String((item && item.title) || '')
  const facts = factCount(`${title} ${(item && item.description) || ''} ${(item && item.bodyText) || ''}`)

  const bigTech = hasAny(text, keywords.bigTech || [])
  const free = hasAny(text, keywords.freeOrCheap || [])
  const openSource = hasAny(text, keywords.openSource || [])
  const weird = hasAny(text, keywords.weird || [])
  const infoGap = hasAny(text, keywords.infoGap || [])
  // 可延展：原文有足够细节（具体信息 ≥ 门槛）或者正文够长
  const extendable = facts >= extend.minFacts || String((item && item.bodyText) || '').length >= extend.minChars

  const checks = {
    bigTech: bigTech.hit,
    openSource: openSource.hit,
    freeOrCheap: free.hit,
    weird: weird.hit,
    infoGap: infoGap.hit,
    extendable: !!extendable,
  }
  const reasons = {
    bigTech: bigTech.hit ? `标题/正文提到 ${bigTech.words.join('、')} 这类大厂` : '没看到明确的大厂名字（关键词可在设置里改）',
    openSource: openSource.hit ? `有开源性号：${openSource.words.join('、')}` : '没有开源相关的信号（GitHub / 权重 / 协议）',
    freeOrCheap: free.hit ? `有免费/降价信号：${free.words.join('、')}` : '没提到免费、降价或可白嫖',
    weird: weird.hit ? `有话题/反差词：${weird.words.join('、')}` : '比较平，没有反差或争议点',
    infoGap: infoGap.hit ? `有信息差信号：${infoGap.words.join('、')}` : '属于大家都在讲的新闻，信息差不足',
    extendable: extendable ? `原文里有 ${facts} 处具体信息，够拆成 3 张以上卡片` : `细节偏少（具体信息 ${facts} 处 < ${extend.minFacts}，正文 ${String((item && item.bodyText) || '').length} 字 < ${extend.minChars}）`,
  }
  return { checks, reasons, facts }
}

/** 选题判断表打分（第九章，1~5 分） */
export function scoreItem(item, judge, settings) {
  const text = textOf(item)
  const positioning = String((settings && settings.accountPositioning) || 'AI圈资讯').toLowerCase()
  const match = /ai|工具|资讯|教程/.test(positioning) ? 4 : 3
  const emotion = judge.checks.weird ? 4 : judge.checks.bigTech || judge.checks.freeOrCheap ? 3 : 2
  const infoGap = judge.checks.infoGap ? 4 : 2
  const extendable = judge.checks.extendable ? 4 : 2
  const scores = { match, emotion, infoGap, extendable }
  const values = TOPIC_SCORE_ITEMS.map((entry) => scores[entry.key])
  const average = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
  return { scores, average, text }
}

/**
 * 候选的正文摘要：**只留纯净正文**，一个字不编。
 * 按需求去掉了「【标题】来自XX。」「原文标注的日期是…」「值得做的点：…」这些前缀/后缀，
 * 界面自己会单独显示标题和日期；站点名、"AI资讯/正文/发布时间/阅读"这类样板噪音也一并清掉。
 * @param {object} item 抓取条目
 */
export function buildSummary(item) {
  // 正文优先（模块2 抓详情页时把整篇都存下来了），没有正文才退回 og:description。
  // ⚠ 用 cleanExcerpt：它会先把开头那串页头削掉（栏目名 / 站点名 / **标题** / 发布时间 / 阅读数），
  //   所以候选卡片上不会再出现"标题 号 11:25"这种把标题和时间混进正文的情况。
  //   数字、人名、版本号都还是从原文里来，界面会自己高亮。
  const raw = String((item && item.bodyText) || '')
  const digest = cleanExcerpt(raw, {
    title: String((item && item.title) || ''),
    source: String((item && item.source) || ''),
    description: String((item && item.description) || ''),
    limit: 240,
  })
  if (digest.replace(/\s+/g, '').length >= 20) return digest
  // 正文削完太短（比如正文只有一句话）：改用站点摘要兜底，别给用户一句"原文没有摘要"
  const alt = cleanExcerpt(String((item && item.description) || ''), {
    title: String((item && item.title) || ''),
    source: String((item && item.source) || ''),
    limit: 240,
  })
  if (alt.replace(/\s+/g, '').length > digest.replace(/\s+/g, '').length) return alt
  if (digest) return digest
  if (alt) return alt
  return '原文没有摘要，细节请点链接看。'
}

/**
 * 本地筛选：挑出最值得发的几条
 * 规则（按需求放宽过）：6 条标准**勾中 1 项**就进候选，不再要求 2 项。
 * @param {Array} items 抓取结果
 * @param {object} settings 用户设置
 * @param {number} limit 最多几条；**传 0 表示不截断**（界面自己分页，能翻到全部）
 */
export function selectCandidates(items, settings, limit = 5) {
  const scored = []
  const rejected = []
  // 关键词和「可延展」门槛都从设置里取（设置页「筛选规则关键词」可以改）
  const keywords = resolveKeywords(settings)
  const extend = resolveExtend(settings)
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !String(item.title || '').trim()) continue
    const judge = judgeItem(item, { keywords, extend })
    const count = countChecks(judge.checks)
    const score = scoreItem(item, judge, settings)
    const entry = {
      id: `cand_${scored.length + rejected.length + 1}_${Math.random().toString(36).slice(2, 8)}`,
      title: String(item.title || '').trim(),
      link: String(item.link || ''),
      source: String(item.source || ''),
      // 日期：只写真实发布日期（读不到就写"原文未标注日期"，不再编一个"最新"）
      date: String(item.date || '').trim() || '原文未标注日期',
      dateISO: String(item.date || ''),
      summary: buildSummary(item),
      checks: judge.checks,
      checkReasons: judge.reasons,
      score: score.average,
      facts: judge.facts,
      selected: true,
    }
    if (count >= 1) scored.push(Object.assign(entry, { checksCount: count }))
    else rejected.push({ title: entry.title, reason: `6 项标准一项都没勾中：${Object.entries(judge.reasons).map(([key]) => key).join('、')}`, checksCount: count })
  }
  scored.sort((a, b) => (b.checksCount - a.checksCount) || (b.score - a.score))
  const limited = Number(limit) > 0 ? scored.slice(0, Number(limit)) : scored
  return { candidates: limited, rejected, judged: scored.length + rejected.length }
}

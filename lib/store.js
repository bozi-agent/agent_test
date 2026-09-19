/**
 * AI 资讯工作台 —— 主机侧存储层
 *
 * 所有持久化数据都落在主机侧：$DSH_HOME/ai-news-workbench/
 *   settings.json       用户设置（账号定位 / 人设 / 变现目标 / 网站清单）
 *   topic-library.json  模块1 选题库
 *   fetch-cache.json    模块2 当日抓取结果
 *   drafts.json         模块4/5/6 的中间产物（文案 / 排版 / 发布清单）
 *   review-data.json    模块7 复盘数据
 *   status.json         全流程状态（控制室用）
 *   fetch-log.txt       抓取日志
 *
 * 读写规则（按开发文档 6.4）：写之前先读当前文件，合并后整体写回；
 * 文件不存在时用默认空结构初始化。写盘用"临时文件 + rename"，避免写一半崩掉把原数据写坏。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
// 只借两个纯函数（清站点样板文字 / 削正文页头），rules.js 不依赖本文件，不会形成循环引用
import { cleanExcerpt } from './rules.js'

/** DSH 主目录（node_modules 可能只读，所以数据不放在包里） */
export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

/** 数据目录 */
export const DATA_DIR = path.join(DSH_HOME, 'ai-news-workbench')

/** 各数据文件名 */
export const FILES = {
  settings: 'settings.json',
  topics: 'topic-library.json',
  fetchCache: 'fetch-cache.json',
  drafts: 'drafts.json',
  status: 'status.json',
  fetchLog: 'fetch-log.txt',
}

/** 默认设置 */
export function defaultSettings() {
  return {
    accountPositioning: 'AI圈资讯',
    personaDescription: '语气轻松，像跟朋友聊天',
    typicalQuestions: '这个工具在哪下载？免费吗？',
    frequentWords: ['我试了下', '说实话', '真香'],
    bannedWords: ['震惊', '必看', '史上最强'],
    pastViralSamples: [],
    monetizationGoal: '暂不变现',
    /** Skill 技能指令：用户上传/输入的额外写作规则（选填） */
    skillText: '',
    /** Skill 技能指令（做图排版 / AI 生图专用，跟写文案那套分开存） */
    skillTextLayout: '',
    websites: [
      {
        name: '量子位',
        url: 'https://www.qbitai.com',
        difficulty: '普通',
        selectors: { listSelector: '', titleSelector: '', linkSelector: '', dateSelector: '' },
      },
      {
        name: 'Hugging Face Blog',
        url: 'https://huggingface.co/blog',
        difficulty: '普通',
        selectors: { listSelector: '', titleSelector: '', linkSelector: '', dateSelector: '' },
      },
    ],
    // 大模型（写文案用）。apiKey / baseUrl 都填了才会真的去调，
    // 否则退回本地规则生成（界面上会提示"请先配置模型"）。
    // 默认模型名 deepseek-flash：DeepSeek 官方当前的低档模型（推理最省，够写文案用）。
    model: { provider: '', model: 'deepseek-flash', apiKey: '', baseUrl: 'https://api.deepseek.com/v1' },
    // 做图模块单独一套模型配置；留空就沿用上面那套。
    // ⚠ DeepSeek 只出文字、**不能生图**：这个模块产出的是封面大字/卡片文案，不是图片。
    modelLayout: { model: '', apiKey: '', baseUrl: '' },
    // days：只抓"最近几天"内发布的资讯（1/3/5/7，默认 1 天）。
    // 判据是**详情页读到的真实发布日期**：抓到的每条都会去详情页读日期，
    // 读不到日期的、以及不在这个范围内的，一律丢掉（不再标"最新"混进来）。
    fetch: { timeoutMs: 10000, retries: 3, minDelayMs: 1500, maxDelayMs: 3500, maxItemsPerSite: 8, days: 1 },
    // 模块3 六项判断标准的**关键词表**：设置页「筛选规则关键词」里可以改。
    // 判定的真正默认值在 filter.js 的 DEFAULT_FILTER_KEYWORDS；这里放一份是为了
    // 设置页第一次打开就有东西可编辑（用户改过之后就以设置里的为准）。
    filterKeywords: {
      bigTech: ['openai', 'anthropic', 'google', 'deepmind', 'meta', 'microsoft', 'nvidia', '英伟达', '字节', '阿里', '腾讯', '百度', '华为', '月之暗面', '智谱', 'minimax', 'deepseek', 'apple', '苹果', 'amazon', '亚马逊', 'xai', 'grok', 'sora', 'gemini', 'claude', 'gpt', 'llama', 'qwen'],
      openSource: ['github', 'hugging face', 'huggingface', '开源', '仓库', 'star', '星', '权重', '可商用', 'apache', 'mit 协议'],
      freeOrCheap: ['免费', '降价', '开源', '白嫖', '限免', '试用', '不收钱', '0 元', '零成本', '免费额度', 'free', 'open source', 'open-source'],
      weird: ['居然', '竟然', '离谱', '反转', '封禁', '起诉', '泄露', '翻车', '道歉', '吵架', '奇葩', '离职', '内讧', '造假', '事故', '被罚', '打脸'],
      infoGap: ['悄悄', '低调', '小范围', '内测', '灰度', '冷门', '没人注意', '少有人知', '隐藏', '彩蛋', '冷知识'],
    },
    // 「可延展」这一项的两个门槛（这项不是关键词，是"具体信息条数 / 正文字数"）
    filterExtend: { minFacts: 2, minChars: 200 },
    browserCdpUrl: 'http://127.0.0.1:9222',
  }
}

/** 默认全流程状态 */
export function defaultStatus() {
  return {
    stage: 'idle', // idle | fetched | filtered | confirmed | wrote | laid | published
    module2: '未开始', // 未开始 / 正在抓取 / 完成 / 部分失败
    module3: '等待模块2', // 等待模块2 / 正在筛选 / 等待确认 / 已确认
    module4: '等待确认', // 等待确认 / 正在写 / 完成
    module5: '等待文案', // 等待文案 / 正在排版 / 完成
    lastFetchDate: '',
    lastError: '',
    updatedAt: new Date().toISOString(),
  }
}

/** 确保数据目录存在 */
export function ensureDir(dir = DATA_DIR) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    /* 目录已存在或权限问题，交给后续读写报错 */
  }
  return dir
}

function filePath(name, dir = DATA_DIR) {
  return path.join(dir, name)
}

/**
 * 读 JSON。文件不存在 / 内容坏了都返回默认值（不抛错，保证插件不崩）。
 * @param {string} name 文件名
 * @param {() => any} makeDefault 默认值工厂
 * @param {string} [dir] 数据目录
 */
export function readJson(name, makeDefault, dir = DATA_DIR) {
  try {
    const raw = fs.readFileSync(filePath(name, dir), 'utf8')
    if (!raw || !raw.trim()) return makeDefault()
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return makeDefault()
    return parsed
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error(`[ai-news-workbench] 读取 ${name} 失败：${err.message}`)
    }
    return makeDefault()
  }
}

/**
 * 原子写 JSON（先写 .tmp 再 rename）。
 * @param {string} name 文件名
 * @param {any} value 要写入的值
 * @param {string} [dir] 数据目录
 * @returns {boolean} 是否写成功
 */
export function writeJson(name, value, dir = DATA_DIR) {
  ensureDir(dir)
  const target = filePath(name, dir)
  const temp = `${target}.tmp-${process.pid}`
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(temp, target)
    return true
  } catch (err) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
    } catch (cleanupErr) {
      /* 清理失败无所谓 */
    }
    console.error(`[ai-news-workbench] 写入 ${name} 失败：${err.message}`)
    return false
  }
}

/** 生成一个短 id（不依赖第三方 uuid 包） */
export function newId(prefix = 'id') {
  const rand = crypto.randomBytes(6).toString('hex')
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

/** 北京时间当天（YYYY-MM-DD） */
export function beijingDay(date = new Date()) {
  const t = date.getTime() + 8 * 3600 * 1000
  return new Date(t).toISOString().slice(0, 10)
}

/** 此刻的北京时间字符串 */
export function beijingNow() {
  const d = new Date()
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch (err) {
    /* 某些环境不支持 Atomics.wait，忽略即可 */
  }
}

/** 磁盘短暂占用（Windows 索引器 / 杀软）时重试同步 IO */
function withRetry(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation()
    } catch (err) {
      if (attempt >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(err && err.code)) throw err
      sleepSync(20 * (attempt + 1))
    }
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

/** 读设置（缺字段用默认值补齐） */
export function loadSettings(dir = DATA_DIR) {
  const raw = readJson(FILES.settings, () => ({}), dir)
  const base = defaultSettings()
  const merged = Object.assign({}, base, raw)
  merged.websites = Array.isArray(raw.websites) && raw.websites.length ? raw.websites.map(normalizeWebsite) : base.websites
  merged.pastViralSamples = Array.isArray(raw.pastViralSamples) ? raw.pastViralSamples : []
  merged.frequentWords = Array.isArray(raw.frequentWords) ? raw.frequentWords : base.frequentWords
  merged.bannedWords = Array.isArray(raw.bannedWords) ? raw.bannedWords : base.bannedWords
  merged.model = Object.assign({}, base.model, raw.model || {})
  merged.fetch = Object.assign({}, base.fetch, raw.fetch || {})
  merged.modelLayout = Object.assign({}, base.modelLayout, raw.modelLayout || {})
  // 六项判断标准的关键词：逐项合并（老设置里没有这几项就用默认；某一项被清空就尊重用户的选择）
  const rawKeywords = raw.filterKeywords && typeof raw.filterKeywords === 'object' ? raw.filterKeywords : {}
  merged.filterKeywords = {}
  for (const key of Object.keys(base.filterKeywords)) {
    merged.filterKeywords[key] = Array.isArray(rawKeywords[key])
      ? rawKeywords[key].map((word) => String(word || '').trim()).filter(Boolean)
      : base.filterKeywords[key].slice()
  }
  merged.filterExtend = Object.assign({}, base.filterExtend, raw.filterExtend || {})
  return merged
}

/** 单个网站配置归一化（老数据 / 手填数据都要能跑） */
export function normalizeWebsite(site) {
  const s = site && typeof site === 'object' ? site : {}
  const sel = s.selectors && typeof s.selectors === 'object' ? s.selectors : {}
  return {
    name: String(s.name || s.url || '未命名网站').slice(0, 80),
    url: String(s.url || '').trim(),
    difficulty: s.difficulty === '困难' ? '困难' : '普通',
    selectors: {
      listSelector: String(sel.listSelector || ''),
      titleSelector: String(sel.titleSelector || ''),
      linkSelector: String(sel.linkSelector || ''),
      dateSelector: String(sel.dateSelector || ''),
    },
  }
}

/** 保存设置（先读后合并再整体写回） */
export function saveSettings(next, dir = DATA_DIR) {
  const current = readJson(FILES.settings, () => ({}), dir)
  const merged = Object.assign({}, defaultSettings(), current, next || {})
  if (next && Array.isArray(next.websites)) merged.websites = next.websites.map(normalizeWebsite)
  writeJson(FILES.settings, merged, dir)
  return loadSettings(dir)
}

// ---------------------------------------------------------------------------
// 模块1 选题库
// ---------------------------------------------------------------------------

/** 读选题库 */
export function loadTopics(dir = DATA_DIR) {
  const raw = readJson(FILES.topics, () => ({ topics: [] }), dir)
  const topics = Array.isArray(raw.topics) ? raw.topics : []
  return topics
    .filter((t) => t && typeof t === 'object')
    .map((t, index) => {
      const title = String(t.title || '(无标题)')
      const source = String(t.source || '')
      return {
        id: String(t.id || `legacy_${index}`),
        title,
        source,
        link: String(t.link || ''),
        date: String(t.date || ''),
        // 正文节选：选题库卡片上只展示"标题 + 部分正文"（正文截断由界面做）。
        // ⚠ 老数据里存的那份可能混进了标题/来源/时间，所以这里**每次读都再清一遍**
        //   （cleanExcerpt 是幂等的），不用等用户重新存一次才干净。
        summary: cleanExcerpt(String(t.summary || ''), { title, source, limit: 300 }),
        savedAt: String(t.savedAt || new Date().toISOString()),
        // 已经拿去「写文案」过的条目：界面不再展示（数据保留，方便回溯）
        usedForCopy: t.usedForCopy === true,
        usedAt: String(t.usedAt || ''),
      }
    })
}

/**
 * 标记某条选题"已经写过文案了"。
 * ⚠ 只是打个标记，**不删数据**：界面上不再展示，drafts / 选题库文件里都还在。
 */
export function markTopicUsed(id, dir = DATA_DIR) {
  const topics = loadTopics(dir)
  let hit = false
  const next = topics.map((topic) => {
    if (topic.id !== String(id)) return topic
    hit = true
    return Object.assign({}, topic, { usedForCopy: true, usedAt: new Date().toISOString() })
  })
  if (!hit) return { ok: false, total: topics.length }
  writeJson(FILES.topics, { topics: next }, dir)
  return { ok: true, total: next.length }
}

/** 存入选题库（同链接只存一次） */
export function saveTopic(topic, dir = DATA_DIR) {
  const topics = loadTopics(dir)
  const link = String((topic && topic.link) || '').trim()
  const title = String((topic && topic.title) || '').trim()
  const exists =
    topics.find((t) => (link && t.link === link) || (!link && title && t.title === title)) || null
  if (exists) return { added: false, topic: exists, total: topics.length }
  const siteName = String((topic && topic.source) || '')
  // 正文节选：优先详情页抓到的正文，其次 og:description。
  // 用 cleanExcerpt 把"标题 / 来源 / 发布时间 / 阅读数 / AI资讯 正文"这些页头和样板字清干净
  // —— 这段会直接显示在选题库卡片上（界面再截断到 3 行），不许混进标题和时间。
  const bodySource = String((topic && (topic.bodyText || topic.description || topic.summary)) || '')
  const item = {
    id: newId('topic'),
    title: title || '(无标题)',
    source: siteName,
    link,
    date: String((topic && topic.date) || ''),
    summary: cleanExcerpt(bodySource, {
      title: title || '',
      source: siteName,
      description: String((topic && topic.description) || ''),
      limit: 300,
    }),
    savedAt: new Date().toISOString(),
  }
  topics.unshift(item)
  writeJson(FILES.topics, { topics }, dir)
  return { added: true, topic: item, total: topics.length }
}

/** 删除选题 */
export function deleteTopic(id, dir = DATA_DIR) {
  const topics = loadTopics(dir)
  const next = topics.filter((t) => t.id !== String(id))
  writeJson(FILES.topics, { topics: next }, dir)
  return { removed: topics.length - next.length, total: next.length }
}

// ---------------------------------------------------------------------------
// 模块2 抓取缓存
// ---------------------------------------------------------------------------

/** 读抓取缓存 */
export function loadFetchCache(dir = DATA_DIR) {
  const raw = readJson(FILES.fetchCache, () => ({}), dir)
  return {
    lastFetchDate: String(raw.lastFetchDate || ''),
    items: Array.isArray(raw.items) ? raw.items : [],
    failures: Array.isArray(raw.failures) ? raw.failures : [],
    sites: Array.isArray(raw.sites) ? raw.sites : [],
    fetchedAt: String(raw.fetchedAt || ''),
  }
}

/** 写抓取缓存 */
export function saveFetchCache(cache, dir = DATA_DIR) {
  const next = {
    lastFetchDate: String((cache && cache.lastFetchDate) || beijingDay()),
    items: Array.isArray(cache && cache.items) ? cache.items : [],
    failures: Array.isArray(cache && cache.failures) ? cache.failures : [],
    sites: Array.isArray(cache && cache.sites) ? cache.sites : [],
    fetchedAt: new Date().toISOString(),
  }
  writeJson(FILES.fetchCache, next, dir)
  return next
}

// ---------------------------------------------------------------------------
// 中间产物：文案 / 排版 / 发布清单
// ---------------------------------------------------------------------------

/** 读中间产物 */
export function loadDrafts(dir = DATA_DIR) {
  const raw = readJson(FILES.drafts, () => ({}), dir)
  return {
    candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    copies: Array.isArray(raw.copies) ? raw.copies : [],
    // 用户手动删掉的帖子（key = link:xxx / title:yyy）：
    // 记在这儿，点「刷新」重建文案时**不再把它们捞回来**。
    copySkipped: Array.isArray(raw.copySkipped) ? raw.copySkipped.map(String) : [],
    layouts: Array.isArray(raw.layouts) ? raw.layouts : [],
    updatedAt: String(raw.updatedAt || ''),
  }
}

/** 局部更新中间产物 */
export function saveDrafts(patch, dir = DATA_DIR) {
  const current = loadDrafts(dir)
  const next = Object.assign({}, current, patch || {}, { updatedAt: new Date().toISOString() })
  writeJson(FILES.drafts, next, dir)
  return next
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

/** 读状态 */
export function loadStatus(dir = DATA_DIR) {
  const raw = readJson(FILES.status, () => ({}), dir)
  return Object.assign(defaultStatus(), raw)
}

/** 合并更新状态 */
export function saveStatus(patch, dir = DATA_DIR) {
  const current = loadStatus(dir)
  const next = Object.assign({}, current, patch || {}, { updatedAt: new Date().toISOString() })
  writeJson(FILES.status, next, dir)
  return next
}

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------

/** 追加一行抓取日志（只保留最近 2000 行，避免文件无限膨胀） */
export function appendLog(line, dir = DATA_DIR) {
  ensureDir(dir)
  const target = filePath(FILES.fetchLog, dir)
  const text = `[${beijingNow()}] ${String(line).replace(/\r?\n/g, ' ')}\n`
  try {
    withRetry(() => fs.appendFileSync(target, text, 'utf8'))
    maybeTrimLog(target)
  } catch (err) {
    console.error(`[ai-news-workbench] 写日志失败：${err.message}`)
  }
}

function maybeTrimLog(target, maxLines = 2000) {
  try {
    const stat = fs.statSync(target)
    if (stat.size < 512 * 1024) return
    const lines = fs.readFileSync(target, 'utf8').split('\n')
    const kept = lines.slice(Math.max(0, lines.length - maxLines)).join('\n')
    withRetry(() => fs.writeFileSync(target, kept, 'utf8'))
  } catch (err) {
    /* 裁剪失败不影响主流程 */
  }
}

/** 读日志尾部（给界面显示） */
export function tailLog(lines = 120, dir = DATA_DIR) {
  try {
    const all = fs.readFileSync(filePath(FILES.fetchLog, dir), 'utf8').split('\n')
    return all.slice(Math.max(0, all.length - lines)).join('\n')
  } catch (err) {
    return ''
  }
}

/** 存储位置概况（给界面显示，方便用户备份） */
export function storageInfo(dir = DATA_DIR) {
  const result = { dir, files: [] }
  for (const name of Object.values(FILES)) {
    const p = filePath(name, dir)
    try {
      const stat = fs.statSync(p)
      result.files.push({ name, size: stat.size, mtime: stat.mtime.toISOString() })
    } catch (err) {
      result.files.push({ name, size: 0, mtime: '' })
    }
  }
  return result
}

/**
 * AI 资讯工作台 —— 主机侧插件入口
 *
 * 职责（开发文档 6.7 架构原则）：
 *  - 主机侧：抓取、读写 JSON、解析 Excel、跑本地规则与本地生成
 *  - 界面侧：只显示按钮/卡片/结果区，通过 HTTP 接口调用主机侧
 *
 * 重要变更（安全修复）：
 *  本插件**不再调用大模型**。之前用 `ctx.llm.stream()` 从插件里直接打模型，
 *  会走进 DeepSeek 适配器的"请求扩展准备/接受"链路，在没有会话上下文时会让主聊天
 *  界面报 `DeepSeek request extension preparation failed REQUEST_EXTENSION` 并崩溃。
 *  现在筛选、文案、排版、发布清单、评论话术、复盘全部改为**本地确定性规则生成**，
 *  事实一律取自抓取到的原文，不产生任何模型请求（主机侧也不声明 llm 服务）。
 *
 * 防崩设计（第十一章）：
 *  - apply 里不抛错，所有可能失败的逻辑都包在 try/catch 里
 *  - 只声明主机侧真正需要的服务；可选服务用之前先判空
 *  - 界面侧的服务不出现在主机侧 inject 里
 */

import {
  DATA_DIR,
  FILES,
  appendLog,
  beijingDay,
  deleteTopic,
  loadDrafts,
  loadFetchCache,
  loadSettings,
  loadStatus,
  loadTopics,
  markTopicUsed,
  saveDrafts,
  saveFetchCache,
  saveSettings,
  saveStatus,
  saveTopic,
  storageInfo,
  tailLog,
} from './store.js'
import { crawlAll, browserAvailable } from './crawl.js'
import { DEFAULT_FILTER_EXTEND, DEFAULT_FILTER_KEYWORDS, selectCandidates, withinRange, rangeDays, TIME_RANGES } from './filter.js'
import {
  buildTags,
  deAiFlavorLocal,
  splitSentences,
} from './generate.js'
import { bannedBlock, chatDetailed, llmConfigured, parseJsonLoose, personaBlock, skillBlock } from './llm.js'
import {
  FILTER_ITEMS,
  QUALITY_CHECKLIST,
  countChecks,
  highlightFacts,
  judgeCopy,
  stripLeadNoise,
} from './rules.js'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** 插件名（日志前缀） */
const NS = 'ai-news-workbench'

/** 单次请求体上限（防止界面误传大文件；上传模板走 base64，留 8MB 余量） */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/** 接口路径 */
const API_PREFIX = '/xmt-kf/api'

/** 插件自己的目录（模板文件夹默认就放在它的 assets/templates 里，跟着插件走） */
const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function log(...args) {
  try {
    console.log(`[${NS}]`, ...args)
  } catch (err) {
    /* 忽略 */
  }
}

function logError(...args) {
  try {
    console.error(`[${NS}]`, ...args)
  } catch (err) {
    /* 忽略 */
  }
}

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  try {
    const body = JSON.stringify(payload === undefined ? { ok: true } : payload)
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(body)
  } catch (err) {
    try {
      res.statusCode = 500
      res.end('{"ok":false,"error":"响应序列化失败"}')
    } catch (err2) {
      /* 连接可能已经断了 */
    }
  }
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        try {
          req.destroy()
        } catch (err) {
          /* 忽略 */
        }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (err) => reject(err))
  })
}

/** 信任栅栏：Host/Origin 校验 + 浏览器鉴权（和 Harness 内置接口同一套规则） */
function rejected(ctx, req, res) {
  try {
    const connection = ctx.get ? ctx.get('connection') : ctx.connection
    if (!connection || typeof connection.requestRejection !== 'function') return false
    const code = connection.requestRejection(req)
    if (code === undefined || code === null || code === false) return false
    res.statusCode = typeof code === 'number' ? code : 403
    res.end(code === 401 ? 'unauthorized' : 'forbidden')
    return true
  } catch (err) {
    return false
  }
}

// ---------------------------------------------------------------------------
// 数据处理小工具
// ---------------------------------------------------------------------------

/** 模型是否配好了（界面据此提示"请先配置模型"） */
function modelInfo(settings) {
  const model = (settings && settings.model) || {}
  return {
    ready: llmConfigured(settings),
    baseUrl: String(model.baseUrl || ''),
    model: String(model.model || ''),
    hasKey: !!String(model.apiKey || '').trim(),
    // 做图排版已经没有"模型"这一说了（纯本地 Canvas 绘制），这几个字段留着是为了
    // 老界面/老数据读到时不出 undefined；值恒为"不需要模型"。
    layoutReady: true,
    layoutModel: '',
    layoutSeparate: false,
    canGenerateImage: true,
  }
}

/** 把抓取结果按网站分组，给界面用 */
function groupBySource(items) {
  const groups = []
  const index = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const key = item.source || '未知来源'
    if (!index.has(key)) {
      index.set(key, { source: key, items: [] })
      groups.push(index.get(key))
    }
    index.get(key).items.push(item)
  }
  return groups
}

/** 候选补高亮分段（界面直接渲染） */
function decorateCandidate(candidate) {
  return Object.assign({}, candidate, {
    summarySegments: highlightFacts(candidate.summary || ''),
    checksCount: countChecks(candidate.checks),
    checkList: FILTER_ITEMS.map((item) => ({
      key: item.key,
      label: item.label,
      rule: item.rule,
      checked: !!(candidate.checks && candidate.checks[item.key]),
      reason: (candidate.checkReasons && candidate.checkReasons[item.key]) || '',
    })),
  })
}

/** 文案补检查结果与高亮 */
function decorateCopy(copy) {
  const judge = judgeCopy(Object.assign({}, copy, { body: copy.bodyAfterDeAi || copy.body }))
  return Object.assign({}, copy, {
    checklist: judge.checklist,
    allPass: judge.allPass,
    banned: judge.banned,
    bodySegments: highlightFacts(copy.bodyAfterDeAi || copy.body || ''),
    needsManualFix: judge.checklist.filter((item) => !item.pass).map((item) => `${item.item}：${item.reason}`),
  })
}

/** 对失败的抓取给"手动查看"提示 */
function decorateFailures(failures) {
  return (Array.isArray(failures) ? failures : []).map((failure) =>
    Object.assign({}, failure, { tip: `⚠ 该网站暂时无法自动抓取，请手动打开查看：${failure.url}` }),
  )
}

// ---------------------------------------------------------------------------
// 抓取进度（模块2 的进度条用）
// 主机侧在一次抓取里不断更新这个对象，界面侧每 800ms 拉一次 GET fetchProgress。
// 只存内存，不落盘：抓取是"进程内"的活，重启后读到的就是 idle。
// ---------------------------------------------------------------------------

const fetchProgress = { running: false, done: 0, total: 0, currentSite: '', phase: 'idle', items: 0, failures: 0, startedAt: 0, updatedAt: 0 }

function updateProgress(patch) {
  Object.assign(fetchProgress, patch || {}, { updatedAt: Date.now() })
}

function readProgress() {
  const elapsed = fetchProgress.startedAt ? Date.now() - fetchProgress.startedAt : 0
  return {
    running: fetchProgress.running,
    done: fetchProgress.done,
    total: fetchProgress.total,
    currentSite: fetchProgress.currentSite,
    phase: fetchProgress.phase,
    detailDone: fetchProgress.detailDone || 0,
    detailTotal: fetchProgress.detailTotal || 0,
    items: fetchProgress.items,
    failures: fetchProgress.failures,
    elapsedMs: elapsed,
    percent: fetchProgress.total ? Math.min(100, Math.round((fetchProgress.done / fetchProgress.total) * 100)) : 0,
  }
}

// ---------------------------------------------------------------------------
// 业务动作
// ---------------------------------------------------------------------------

/** 模块2：扫源抓取 */
async function actionFetch(ctx) {
  const settings = loadSettings()
  if (!settings.websites || !settings.websites.length) {
    return { ok: false, error: '还没有配置网站清单。点"设置"添加要抓取的网站。' }
  }
  if (fetchProgress.running) {
    // 文案要求：一句话，不解释原因（界面侧统一显示成「抓取失败，请稍后重试」）
    return { ok: false, error: '抓取任务还在进行中' }
  }
  saveStatus({ module2: '正在抓取', lastError: '' })
  appendLog(`=== 开始抓取（${settings.websites.length} 个网站）===`)
  const started = Date.now()
  updateProgress({
    running: true,
    done: 0,
    total: settings.websites.length,
    currentSite: settings.websites[0] ? settings.websites[0].name : '',
    phase: 'site',
    items: 0,
    failures: 0,
    startedAt: started,
  })
  let result
  try {
    result = await crawlAll(settings, {
      onProgress: (patch) => {
        updateProgress({
          running: true,
          done: Number(patch.done) || 0,
          total: Number(patch.total) || settings.websites.length,
          currentSite: patch.siteName || fetchProgress.currentSite,
          phase: patch.phase === 'detail' ? 'detail' : 'site',
          detailDone: Number(patch.detailDone) || 0,
          detailTotal: Number(patch.detailTotal) || 0,
          items: Number(patch.items) || 0,
          failures: Number(patch.failures) || 0,
        })
      },
    })
  } catch (err) {
    const message = (err && err.message) || String(err)
    appendLog(`抓取整体失败：${message}`)
    saveStatus({ module2: '部分失败', lastError: message })
    updateProgress({ running: false, phase: 'idle' })
    return { ok: false, error: `抓取失败：${message}` }
  }
  const cache = saveFetchCache({
    lastFetchDate: beijingDay(),
    items: result.items,
    failures: result.failures,
    sites: result.sites,
  })
  saveStatus({
    module2: result.failures.length ? '部分失败' : '完成',
    lastFetchDate: cache.lastFetchDate,
    lastError: result.failures.length ? `${result.failures.length} 个网站抓取失败` : '',
  })
  const browser = await browserAvailable(settings.browserCdpUrl)
  appendLog(`=== 抓取结束：成功 ${result.items.length} 条，失败 ${result.failures.length} 个网站（${Date.now() - started}ms）===`)
  updateProgress({
    running: false,
    done: settings.websites.length,
    total: settings.websites.length,
    currentSite: '',
    phase: 'done',
    items: result.items.length,
    failures: result.failures.length,
  })
  return {
    ok: true,
    data: {
      items: result.items,
      groups: groupBySource(result.items),
      failures: decorateFailures(result.failures),
      sites: result.sites,
      total: result.items.length,
      lastFetchDate: cache.lastFetchDate,
      fetchedAt: cache.fetchedAt,
      browserAvailable: browser.ok,
      browserError: browser.ok ? '' : browser.error,
    },
  }
}

/**
 * 模块3：筛选核实（本地规则）
 * 规则按需求放宽：6 条标准**勾中 1 项**就进候选（原来要 2 项），一次最多给 5 条。
 * payload.range：时间筛选档位 all / today / 3d / 7d，默认 all。
 * 已经「核实通过」的条目不进候选池（数据还在 drafts 里，只是不再重复出现）。
 */
function actionFilter(payload) {
  const settings = loadSettings()
  const cache = loadFetchCache()
  const range = TIME_RANGES.some((item) => item.key === (payload && payload.range)) ? payload.range : 'all'
  const rangeLabel = (TIME_RANGES.find((item) => item.key === range) || {}).label || '全部'
  if (!cache.items.length) {
    saveStatus({ module3: '等待模块2' })
    // ⚠ 这不是"报错"：没抓过东西 = 空列表。
    //   以前这里返回 ok:false，界面把「还没抓取」也翻译成「请稍后重试」，用户以为坏了。
    return {
      ok: true,
      data: {
        candidates: [],
        rejected: [],
        items: FILTER_ITEMS,
        judged: 0,
        local: true,
        range,
        rangeLabel,
        poolCount: 0,
        totalCount: 0,
        confirmedCount: 0,
        emptyReason: '还没有抓取结果：先回「② 扫源抓取」点「开始抓取」。',
      },
    }
  }
  saveStatus({ module3: '正在筛选' })
  const today = beijingDay()
  const drafts = loadDrafts()
  // 用户手动删过文案的帖子（copySkipped）：它们不算"已核实"，也不占位 ——
  // 这样它们会重新回到候选池里，用户想再写一次就再点一次「核实通过」。
  const skippedKeys = new Set(drafts.copySkipped || [])
  const doneKeys = new Set(
    (drafts.candidates || [])
      .filter((candidate) => candidate && candidate.confirmed && !skippedKeys.has(copyKeyOf(candidate)))
      .map((candidate) => String(candidate.link || candidate.title || '')),
  )
  // 已经存进「① 选题库」的：不再进候选（用户要求"加入选题库的素材不要在筛选核实出现"）
  const topicKeys = new Set(loadTopics().map((topic) => String(topic.link || topic.title || '')))
  // 时间档位的判据 = 详情页读到的**真实发布日期**。
  // 按需求：读不到日期的条目一律丢掉（不再按"抓取当天"兜底 —— 那会让 2 天前的旧资讯
  // 在本该只留今天的档位里出现；日期准确性由模块2 的抓取负责）。
  const inRange = cache.items.filter((item) => withinRange(item, range, today))
  const undated = cache.items.filter((item) => !String((item && item.date) || '').trim()).length
  const pool = inRange.filter((item) => {
    const key = String((item && item.link) || (item && item.title) || '')
    if (!key) return true
    if (topicKeys.has(key)) return false
    return !doneKeys.has(key)
  })
  appendLog(
    `=== 开始筛选（本地规则，时间档位 ${range}，候选池 ${pool.length} 条 / 落在这个档位 ${inRange.length} 条 / 共 ${cache.items.length} 条；` +
      `已存选题库剔掉 ${inRange.filter((item) => topicKeys.has(String((item && item.link) || (item && item.title) || ''))).length} 条` +
      `${undated ? `；其中 ${undated} 条读不到发布日期，按需求不计入时间档位` : ''}）===`,
  )
  try {
    // limit 传 0 = 不截断：候选全给界面，界面自己分页（这样才能翻到后面的候选）
    const result = selectCandidates(pool, settings, 0)
    const candidates = result.candidates.map(decorateCandidate)
    const rangeNote = rangeDays(range) && inRange.length !== cache.items.length ? `时间筛选「${rangeLabel}」把范围收窄到 ${inRange.length} 条（共抓到 ${cache.items.length} 条）。` : ''
    // ⚠ 重新筛选时：
    //   · 已经核实过的（confirmed）单独留着，合并进新一批候选里 —— 这样它们的"已核实"状态不丢，
    //     界面照样不显示它们（按 link/title 去重）；
    //   · 但"手动删过文案"的那些（copySkipped）**不算已核实**：让它们重新进候选池，
    //     用户想再写一次就再点一次「核实通过」（点核实会把它从名单里拿掉）。
    //   · 已经写好的文案**不能清掉**（文案可能是从「选题库 → 写文案」来的，跟这次筛选无关）。
    const kept = (drafts.candidates || []).filter((candidate) => candidate && candidate.confirmed && !skippedKeys.has(copyKeyOf(candidate)))
    const merged = kept.concat(candidates.filter((candidate) => !kept.some((old) => String(old.link || old.title) === String(candidate.link || candidate.title))))
    saveDrafts({ candidates: merged, copies: drafts.copies || [], layouts: [] })
    // 只要还有核实过的，模块3 就保持"已确认"，别把用户打回等待确认（否则写文案会被挡住）
    if (kept.length) saveStatus({ module3: '已确认', stage: 'confirmed' })
    else saveStatus({ module3: '等待确认', stage: 'filtered' })

    // 这一档筛不出候选同样不是"报错"（可能只是这个时间段里没有合适的）：
    // 返回 ok + 空列表，界面显示「暂无数据」，不再弹「请稍后重试」。
    const emptyReason = !candidates.length
      ? pool.length
        ? `这一档 ${pool.length} 条里没有一条勾中 6 项标准中的任何一项。把时间范围放宽到「全部」，或者重新抓一批。`
        : rangeDays(range)
          ? `「${rangeLabel}」这个时间段里没有抓到条目（本次共抓到 ${cache.items.length} 条${undated ? `，其中 ${undated} 条读不到发布日期、按需求不参与时间筛选` : ''}）。把时间范围放宽到「全部」试试。`
          : '还没有能进候选的资讯。'
      : ''

    appendLog(`筛选完成：选出 ${candidates.length} 条候选（本地规则，勾中 1 项即可），另有 ${kept.length} 条已核实的不再显示${emptyReason ? `；${emptyReason}` : ''}`)
    return {
      ok: true,
      data: {
        candidates: merged.map(decorateCandidate),
        rejected: result.rejected,
        items: FILTER_ITEMS,
        judged: result.judged,
        local: true,
        range,
        rangeLabel,
        poolCount: pool.length,
        totalCount: cache.items.length,
        confirmedCount: kept.length,
        emptyReason,
        note: `筛选是按本地规则判定的（关键词 + 可观察事实打分），6 条标准勾中 1 项就进候选。${rangeNote}`,
      },
    }
  } catch (err) {
    const message = (err && err.message) || String(err)
    appendLog(`筛选失败：${message}`)
    saveStatus({ module3: '等待模块2', lastError: message })
    return { ok: false, error: `筛选失败：${message}` }
  }
}

/**
 * 模块3 强制关卡：核实通过（**一条一条来，不做批量**）。
 * payload.ids 里每条打上 confirmed=true；界面据此把它从列表里移走。
 * ⚠ 只是"从界面消失"，候选数据原样留在 drafts.json 里，不删。
 */
function actionConfirm(payload) {
  const drafts = loadDrafts()
  const ids = Array.isArray(payload && payload.ids) ? payload.ids.map(String) : []
  const candidates = (drafts.candidates || []).map((candidate) =>
    ids.includes(String(candidate.id)) ? Object.assign({}, candidate, { confirmed: true, selected: true }) : candidate,
  )
  const confirmed = candidates.filter((candidate) => candidate && candidate.confirmed)
  // 这次刚核实通过的这几条：把它们从"手动删过、不再重建"的名单里拿掉 ——
  // 用户是**主动**点核实通过的，说明他想让这条重新进来。
  const justKeys = new Set(candidates.filter((candidate) => ids.includes(String(candidate.id))).map((candidate) => copyKeyOf(candidate)))
  const copySkipped = (drafts.copySkipped || []).filter((key) => !justKeys.has(key))
  saveDrafts({ candidates, copySkipped })
  if (confirmed.length) saveStatus({ module3: '已确认', module4: '等待确认', stage: 'confirmed' })
  appendLog(`核实通过：这次确认 ${ids.length} 条，累计已确认 ${confirmed.length} 条（数据保留，界面不再显示）`)
  return { ok: true, data: { confirmed: confirmed.length, justConfirmed: ids.length, candidates: candidates.map(decorateCandidate) } }
}

/**
 * 用大模型写一条文案（**当前不使用**：按需求，写文案这一步只摆正文，
 * 调模型统一走「✨ AI 润色」actionPolish）。留着是为了以后想加"直接生成"时有现成提示词。
 * 提示词里带开发文档 6.3/6.8 的人设注入模板 + 用户填的 Skill 指令。
 * @returns {Promise<{title:string, body:string}>}
 */
async function llmWriteCopy(candidate, settings, extraPrompt) {
  const persona = personaBlock(settings)
  const system = [
    '你是一个小红书笔记写手，帮账号主把一条 AI 资讯改写成他自己的口吻。',
    persona,
    '硬规则：',
    '1) 用第一人称「我」的视角，像跟朋友聊天，不要说明书腔、不要翻译腔；',
    '2) 保留原文里的数字、人名、时间、版本号，一个字都不许编造；原文没有的信息不要补；',
    '3) 不要用绝对化用语（最好/第一/最强/唯一…）、不要诱导互动（求赞/关注我…）；',
    '4) 正文 150~350 字，分 2~4 个短段，可以用 1~3 个 emoji；',
    '5) 标题不超过 20 字，有具体信息，不夸张。',
    skillBlock(settings),
    bannedBlock(settings),
    '输出要求：只输出一个 JSON 对象，形如 {"title":"标题","body":"正文"}，不要任何解释、不要代码块以外的文字。',
  ]
    .filter(Boolean)
    .join('\n')
  const user = [
    `【原文标题】${String((candidate && candidate.title) || '')}`,
    `【来源】${String((candidate && candidate.source) || '')}　【日期】${String((candidate && candidate.date) || '原文未标注日期')}`,
    `【原文正文摘要】${String((candidate && candidate.summary) || '（没有正文，只有标题）')}`,
    String((candidate && candidate.link) || '') ? `【原文链接】${candidate.link}` : '',
    extraPrompt ? `【额外要求】${extraPrompt}` : '',
    '请按上面的要求写这一条。',
  ]
    .filter(Boolean)
    .join('\n')
  const reply = await chat(settings, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const parsed = parseJsonLoose(reply)
  const title = String((parsed && (parsed.title || parsed.Title)) || '').trim() || String((candidate && candidate.title) || '').trim()
  const body = String((parsed && (parsed.body || parsed.content || parsed.text)) || '').trim() || reply
  return { title, body }
}

// ---------------------------------------------------------------------------
// 模块4：把原文"原封不动"搬进文案卡片
// 需求：点「刷新」时把**完整标题 + 完整正文**照抄进去 —— 不加链接、不改一个字、
//      不调用大模型、也不做任何润色/改写。
// ---------------------------------------------------------------------------

/**
 * 按 link（没有 link 就按标题）去抓取缓存里找这条资讯的原文。
 * 抓取时每个网站都会把详情页正文的前 300 字存在 bodyText 里，那份最完整。
 * @returns {object|null}
 */
function originalSourceOf(ref) {
  const cache = loadFetchCache()
  const link = String((ref && ref.link) || '').trim()
  const title = String((ref && ref.title) || '').trim()
  const key = link || title
  if (!key) return null
  return (
    (cache.items || []).find((item) => {
      const itemLink = String((item && item.link) || '').trim()
      const itemTitle = String((item && item.title) || '').trim()
      return link ? itemLink === link : itemTitle === title
    }) || null
  )
}

/**
 * 一条帖子的去重键（跟界面侧「已存过」那套算法一致：优先链接，没链接用标题）。
 * 「④ 写文案」里手动删掉的帖子用它记账，点「刷新」时不再捞回来。
 */
function copyKeyOf(ref) {
  const link = String((ref && ref.link) || '').trim()
  if (link) return `link:${link}`
  const title = String((ref && ref.title) || '').trim()
  return title ? `title:${title}` : ''
}

/**
 * 拼一条"原封不动"的文案。
 * 正文取原文详情页抓到的 bodyText —— 现在是**整篇**（最多 4000 字，不是以前的 300 字），
 * 只在开头削掉"栏目名 / 站点名 / 标题 / 发布时间 / 阅读数"那串页头，
 * 正文本身**一个字都不改**：不 cleanDigest、不去 AI 味、不补链接、不加任何骨架句子。
 */
function buildVerbatimCopy(ref, source, extra) {
  const title = String((ref && ref.title) || (source && source.title) || '').trim()
  const siteName = String((source && source.source) || (ref && ref.source) || '').trim()
  const rawBody = String(
    (source && (source.bodyText || source.description)) || (ref && (ref.summary || ref.body)) || '',
  )
  const body = stripLeadNoise(rawBody, { title, source: siteName }).trim()
  const link = String((ref && ref.link) || (source && source.link) || '').trim()
  const copy = {
    id: `copy_${Math.random().toString(36).slice(2, 10)}`,
    candidateId: String((ref && ref.id) || ''),
    sourceTitle: title,
    sourceLink: link,
    titles: [title],
    body,
    bodyAfterDeAi: body,
    // ⚠ 标签是本地规则生成的（#定位 + 原文里的实体），不是"改写正文"：
    //   少了它「⑥ 发布与互动」就出不来标签，这里是补回这次改造丢掉的标签。
    tags: buildTags({ title, summary: body }, loadSettings()),
    sentences: splitSentences(body),
    generatedBy: '原文原封不动粘贴',
    verbatim: true,
    polished: false,
    // 按需求取消「待润色」标识：这里直接当作可用稿
    needsPolish: false,
  }
  if (extra) Object.assign(copy, extra)
  const judged = judgeCopy(Object.assign({}, copy, { body: copy.bodyAfterDeAi }))
  copy.checklist = judged.checklist
  copy.allPass = judged.allPass
  copy.banned = judged.banned
  copy.needsManualFix = judged.checklist.filter((item) => !item.pass).map((item) => `${item.item}：${item.reason}`)
  copy.titleWarning = ''
  return copy
}

/**
 * 模块4：写文案（界面右上角那个「刷新」按钮走这里）。
 * ⚠ 按需求：这一步**只是把原文的标题和正文原封不动搬进来**：
 *   · 不调用大模型
 *   · 不改写、不润色、不追加链接、不加任何自己的话
 *   想改语气就点每条右下角的「AI 润色」（那是唯一会调模型的地方）。
 */
async function actionWriteCopy(payload) {
  const settings = loadSettings()
  const status = loadStatus()
  const drafts = loadDrafts()
  const all = drafts.candidates || []
  // 一条一条「核实通过」之后，只有 confirmed 的那些才进入写文案。
  // （老数据没有 confirmed 字段时，退回按 selected 判断，免得升级后一条都写不出来）
  const confirmed = all.filter((candidate) => candidate && candidate.confirmed === true)
  const base = confirmed.length ? confirmed : all.filter((candidate) => candidate.selected !== false)
  if (!base.length) {
    saveStatus({ module4: '等待确认' })
    return { ok: false, error: '请先完成模块3的核实（在每条资讯右上角点「核实通过」）。' }
  }
  // 只要确实有"核实通过"的条目就放行（不再死盯 status 字段 —— 重新筛选、切时间档位都不该把用户挡住）
  if (!confirmed.length && status.module3 !== '已确认') {
    saveStatus({ module4: '等待确认' })
    return { ok: false, error: '请先回模块3点"核实通过"，确认选题没问题再写文案。' }
  }
  // 用户在「④ 写文案」里手动删掉的帖子：记在 copySkipped 里，刷新时**不再捞回来**
  const skipped = new Set(drafts.copySkipped || [])
  const candidates = base.filter((candidate) => !skipped.has(copyKeyOf(candidate)))
  const existing = drafts.copies || []
  // ⚠ 按需求：已经点过「保存」的帖子**不进刷新结果**（它已经进「⑤ 做图排版」了，
  //   写文案界面也不再展示它）。它们的排版结果也就不会被这次刷新冲掉。
  const savedKeys = new Set(
    existing.filter((copy) => copy && copy.savedByUser).map((copy) => copyKeyOf({ link: copy.sourceLink, title: copy.sourceTitle })),
  )
  const fresh = candidates.filter((candidate) => !savedKeys.has(copyKeyOf(candidate))).map((candidate) => buildVerbatimCopy(candidate, originalSourceOf(candidate)))
  // 没保存过的旧稿（比如「选题库 → 写文案」来的）：保留下来，刷新不会把它们冲掉
  const kept = existing.filter((copy) => {
    if (!copy || copy.savedByUser) return false
    const key = copyKeyOf({ link: copy.sourceLink, title: copy.sourceTitle })
    return !fresh.some((item) => copyKeyOf({ link: item.sourceLink, title: item.sourceTitle }) === key)
  })
  const copies = fresh.concat(kept)
  appendLog(`=== 刷新文案（原文原封不动粘贴，不调模型，${copies.length} 条；跳过手动删掉的 ${base.length - candidates.length} 条）===`)
  if (!copies.length) {
    saveStatus({ module4: '已就绪' })
    return {
      ok: true,
      data: {
        copies: [],
        local: true,
        llm: false,
        verbatim: true,
        note: '核实过的帖子都已经手动删掉了（删掉之后刷新不会再回来）。回「② 扫源抓取」可以重新挑一条。',
        failures: [],
      },
    }
  }
  saveDrafts({ copies, layouts: [] })
  saveStatus({ module4: '已就绪', module5: '等待文案', stage: 'wrote' })
  appendLog(`文案已就绪：${copies.length} 篇（原文原封不动，未调模型）`)
  return {
    ok: true,
    data: {
      copies: copies.map(decorateCopy),
      local: true,
      llm: false,
      verbatim: true,
      note: '这一步是把原文的完整标题 + 完整正文原封不动搬进来的（没截断、没调大模型、没改写、没加链接）。要改语气请点每条右下角的「AI 润色」。',
      failures: [],
    },
  }
}

/**
 * 模块1 → 模块4：把选题库里的条目直接写成文案。
 * ⚠ 按需求：这一步**只是把原文标题和正文原封不动搬过来**（不调模型、不改写、不润色）。
 * 写完给这些选题打上 usedForCopy 标记：选题库界面不再展示（数据保留）。
 */
async function actionWriteFromTopics(payload) {
  const ids = Array.isArray(payload && payload.ids) ? payload.ids.map(String) : []
  const topics = loadTopics()
  const picked = topics.filter((topic) => ids.includes(String(topic.id)))
  const useList = picked.length ? picked : topics.filter((topic) => !topic.usedForCopy).slice(0, Number((payload && payload.limit) || 1))
  if (!useList.length) return { ok: false, error: '选题库里还没有可写的条目。' }
  appendLog(`=== 选题库 → 写文案（原文原封不动粘贴，不调模型，${useList.length} 条）===`)
  const fresh = useList.map((topic) =>
    buildVerbatimCopy(
      {
        id: `topic_cand_${topic.id}`,
        title: topic.title,
        link: topic.link,
        summary: topic.summary,
      },
      originalSourceOf(topic),
      { fromTopic: topic.id },
    ),
  )
  // 标记"这条已经写过文案了"：选题库里不再显示（不删数据）
  for (const topic of useList) {
    try {
      markTopicUsed(topic.id)
    } catch (err) {
      appendLog(`标记选题已用失败（${topic.id}）：${(err && err.message) || err}`)
    }
  }
  // 追加到现有文案前面（新写的排最前，方便马上看到）
  const drafts = loadDrafts()
  const copies = fresh.concat(drafts.copies || [])
  saveDrafts({ copies })
  saveStatus({ module4: '已就绪', module5: '等待文案', stage: 'wrote' })
  return {
    ok: true,
    data: {
      copies: copies.map(decorateCopy),
      added: fresh.length,
      usedTopicIds: useList.map((topic) => topic.id),
      llm: false,
      verbatim: true,
      failures: [],
    },
  }
}

/**
 * 模块4：删掉一条文案，并把它的来源"放回上游"。
 * 按需求：删除后这条从「④ 写文案」消失，统一回到「② 扫源抓取」——
 *   · 来自选题库的（fromTopic）：把选题库那条撤掉，这样扫源抓取里它又会重新出现；
 *   · 来自筛选核实的（candidateId）：取消它的"已核实"，让它重新回到候选列表
 *     （所以想再写一次，去「③ 筛选核实」重新点「核实通过」就行 —— 那一步会把它从
 *      下面的"不再重建名单"里拿掉）；
 *   · 同时把它的 key 记进 drafts.copySkipped —— 这样点「刷新」不会又把它捞回来
 *     （用户反馈的 bug：删掉的帖子刷新又出现了）；
 *   · 顺带把这条已经生成的排版结果一起清掉（排版只认写文案里的稿子）；
 *   · 抓取缓存里的原始数据一个字都不动（数据保留）。
 */
function actionDeleteCopy(payload) {
  const id = String((payload && payload.id) || '')
  if (!id) return { ok: false, error: '缺少文案 id' }
  const drafts = loadDrafts()
  const target = (drafts.copies || []).find((copy) => copy && String(copy.id) === id) || null
  if (!target) return { ok: false, error: '没找到这条文案' }
  const copies = (drafts.copies || []).filter((copy) => String(copy.id) !== id)
  // 记一笔"这条被手动删过"：刷新文案时跳过它
  const key = copyKeyOf({ link: target.sourceLink, title: target.sourceTitle })
  const skipped = (drafts.copySkipped || []).slice()
  if (key && !skipped.includes(key)) skipped.push(key)
  // 这条的排版结果也一起清掉，别让做图排版里留一条已经没有文案的
  const layouts = (drafts.layouts || []).filter((layout) => String(layout && layout.copyId) !== id)
  // 来源候选取消"已核实"：它会重新出现在「③ 筛选核实」里，用户想再写一次就再点一次核实通过
  const candidates = (drafts.candidates || []).map((candidate) =>
    String(candidate.id) === String(target.candidateId) ? Object.assign({}, candidate, { confirmed: false }) : candidate,
  )
  saveDrafts({ copies, copySkipped: skipped, layouts, candidates })

  let topicRemoved = ''
  if (target.fromTopic) {
    try {
      deleteTopic(target.fromTopic)
      topicRemoved = `选题库里的那条也一并撤掉（${String(target.sourceTitle || '').slice(0, 30)}）`
    } catch (err) {
      appendLog(`删除来源选题失败（${target.fromTopic}）：${(err && err.message) || err}`)
    }
  }
  appendLog(`删除文案：${id}（剩 ${copies.length} 篇，已记入不再重建的名单）${topicRemoved ? `；${topicRemoved}` : ''}`)
  return { ok: true, data: { copies: copies.map(decorateCopy), removed: id, topicRemoved: !!topicRemoved, topicRemovedId: target.fromTopic || '' } }
}

/** 用"标题 + 正文"拼一条完整的 copy（大模型分支用；标签/检查清单仍按本地规则补） */
function buildCopyFromParts(candidate, title, body, generatedBy) {
  const cleanBody = deAiFlavorLocal(body, [])
  const draft = {
    id: `copy_${Math.random().toString(36).slice(2, 10)}`,
    candidateId: String((candidate && candidate.id) || ''),
    sourceTitle: String((candidate && candidate.title) || ''),
    sourceLink: String((candidate && candidate.link) || ''),
    titles: [String(title || '').trim() || String((candidate && candidate.title) || '')],
    body: String(body || '').trim(),
    bodyAfterDeAi: cleanBody,
    tags: [],
    sentences: splitSentences(cleanBody),
    generatedBy: generatedBy || '大模型生成',
  }
  const judged = judgeCopy(Object.assign({}, draft, { body: draft.bodyAfterDeAi }))
  draft.checklist = judged.checklist
  draft.allPass = judged.allPass
  draft.banned = judged.banned
  draft.needsManualFix = judged.checklist.filter((item) => !item.pass).map((item) => `${item.item}：${item.reason}`)
  draft.titleWarning = ''
  return draft
}

/** 模块4：AI 润色（把当前正文改得更像真人说话，数字/人名/版本号必须保留） */
async function actionPolish(payload) {
  const settings = loadSettings()
  if (!llmConfigured(settings)) return { ok: false, error: '请先配置模型（设置里填 API Key 和 API 地址）' }
  const text = String((payload && payload.text) || '').trim()
  if (!text) return { ok: false, error: '正文是空的，没法润色' }
  const persona = personaBlock(settings)
  const system = [
    '你是中文社交媒体文案编辑，负责把一段 AI 味很重的文案改成真人说话的样子。',
    persona,
    '要求：保持原意，**所有数字、人名、时间、版本号一个都不许改、不许删**；不要新增原文没有的事实；',
    '去掉书面语和套话（"值得注意的是""综上所述""赋能"…），句子短一点，可以加一点口语和 emoji；',
    '不要加"求点赞/关注我"这类诱导互动词，也不要用绝对化用语。',
    skillBlock(settings),
    bannedBlock(settings),
    '只输出润色后的正文本身，不要解释、不要引号、不要标题。',
  ]
    .filter(Boolean)
    .join('\n')
  const result = await chatDetailed(settings, [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ])
  const polished = result.text
  const id = String((payload && payload.id) || '')
  if (id) {
    const drafts = loadDrafts()
    const copies = (drafts.copies || []).map((copy) =>
      String(copy.id) === id
        ? Object.assign({}, copy, {
            bodyAfterDeAi: polished,
            body: polished,
            polishedAt: new Date().toISOString(),
            polished: true,
            needsPolish: false,
            polishedBy: result.model,
            generatedBy: `AI 润色（${result.model}）`,
          })
        : copy,
    )
    saveDrafts({ copies })
    saveStatus({ module4: '已润色' })
    appendLog(`AI 润色完成：${id}（实际调用模型 ${result.model}）`)
  }
  return { ok: true, data: { text: polished, llm: true, model: result.model } }
}

/**
 * 模块4：保存手动改过的标题/正文。
 * ⚠ 按需求（做图排版的唯一数据源）：**只有用户点了「保存」的稿子**才会被标记
 *   savedByUser，才允许进「⑤ 做图排版」。失焦自动存（silent:true）不算 ——
 *   它只是别把用户改到一半的内容丢了，不代表"这篇我确认了"。
 */
function actionUpdateCopy(payload) {
  const id = String((payload && payload.id) || '')
  if (!id) return { ok: false, error: '缺少文案 id' }
  const drafts = loadDrafts()
  let hit = false
  const copies = (drafts.copies || []).map((copy) => {
    if (String(copy.id) !== id) return copy
    hit = true
    const next = Object.assign({}, copy)
    if (typeof payload.title === 'string') next.titles = [payload.title, ...(copy.titles || []).slice(1)]
    if (typeof payload.body === 'string') {
      next.body = payload.body
      next.bodyAfterDeAi = payload.body
    }
    next.editedAt = new Date().toISOString()
    if (!payload.silent) {
      next.savedByUser = true
      next.savedAt = new Date().toISOString()
    }
    const judged = judgeCopy(Object.assign({}, next, { body: next.bodyAfterDeAi || next.body }))
    next.checklist = judged.checklist
    next.allPass = judged.allPass
    return next
  })
  if (!hit) return { ok: false, error: '没找到这条文案' }
  saveDrafts({ copies })
  return { ok: true, data: { copies: copies.map(decorateCopy) } }
}

/**
 * 「⑤ 做图排版」只认「④ 写文案」里**点过「保存」**的稿子。
 * 其他模块的数据（扫源抓取 / 选题库 / 筛选核实）一律不进这个模块。
 * @returns {Array} 可以排版的文案
 */
function layoutSourceCopies(drafts) {
  return (drafts.copies || []).filter((copy) => copy && copy.savedByUser === true)
}

/**
 * 模块5：做图排版 —— 纯本地模板生图（**本模块不调用任何大模型**）。
 *
 * 职责分工：
 *   · 主机侧：管"模板图片"（用户上传的底图）—— 收 base64、落盘、回元数据、按需把原图吐回去；
 *   · 界面侧：浏览器 Canvas 负责真正的绘制（把标题/正文按固定坐标贴到模板上）。
 *     这么分是因为绘图本来就在浏览器里最顺（图片解码、导出 dataURL 都是浏览器原生能力），
 *     主机侧不需要引任何图形库，也不会产生模型请求。
 */

/**
 * 模板文件夹（「⑤ 封面标签」的底图就放这儿）。
 * 取值顺序：
 *   ① 设置里手填的 layoutTemplateDir（用户想放别处就填）
 *   ② 插件自带的 `assets/templates`（可移植、跟插件在一起，默认用这个）
 *   ③ 老位置 `~/.dsh/ai-news-workbench/templates`（升级前放这儿的图还在，直接接着用）
 */
function templateDirCandidates() {
  const settings = loadSettings()
  const custom = String((settings && settings.layoutTemplateDir) || '').trim()
  const list = []
  if (custom) list.push(custom)
  list.push(path.join(PLUGIN_DIR, 'assets', 'templates'))
  list.push(path.join(DATA_DIR, 'templates'))
  return list
}

/** 当前实际用的模板文件夹：老位置有图就继续用老位置，否则用插件的 assets/templates */
function templateDir() {
  const list = templateDirCandidates()
  for (const dir of list) {
    if (hasImages(dir)) return dir
  }
  return list[0]
}

/** 目录里有没有图片（顺便把目录建出来） */
function hasImages(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    return fs.readdirSync(dir).some((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
  } catch (err) {
    return false
  }
}

/** 从 settings 里读模板信息（没有就返回空壳） */
function templateInfoOf(settings) {
  const template = (settings && settings.layoutTemplate) || {}
  const file = String(template.file || '').trim()
  return {
    file,
    name: String(template.name || ''),
    width: Number(template.width) || 0,
    height: Number(template.height) || 0,
    updatedAt: String(template.updatedAt || ''),
    exists: !!file && fs.existsSync(path.join(templateDirOf(file), file)),
    dir: file ? templateDirOf(file) : templateDir(),
  }
}

/**
 * 「⑤ 封面标签」：模板文件夹里的图片清单。
 * 用户把模板图片丢进这个文件夹，界面就把它们全部列成缩略图，点哪张用哪张。
 * 目录不存在时自动建一个（省得用户找不到该往哪放）。
 */
/**
 * 「⑤ 封面标签」：模板文件夹里的图片清单（默认目录 + 老目录合并，同名只算一次）。
 * 用户把模板图片丢进文件夹，界面就把它们全部列成缩略图，点哪张用哪张。
 */
function listTemplateFiles() {
  const dirs = templateDirCandidates()
  const out = []
  const seen = new Set()
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (err) {
      /* 目录已存在或没权限 */
    }
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch (err) {
      continue
    }
    for (const name of names) {
      if (!/^[A-Za-z0-9._-]+$/.test(name) || !/\.(png|jpe?g|webp|gif)$/i.test(name)) continue
      if (seen.has(name)) continue
      seen.add(name)
      let size = 0
      let mtime = ''
      try {
        const stat = fs.statSync(path.join(dir, name))
        size = stat.size
        mtime = stat.mtime.toISOString()
      } catch (err) {
        /* 读不到就留空 */
      }
      out.push({ file: name, name, size, mtime, dir })
    }
  }
  return out.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))
}

/** 按文件名找到它所在的目录（默认目录优先） */
function templateDirOf(file) {
  const name = String(file || '')
  for (const dir of templateDirCandidates()) {
    try {
      if (fs.existsSync(path.join(dir, name))) return dir
    } catch (err) {
      /* 继续找下一个 */
    }
  }
  return templateDir()
}
/**
 * 打开模板文件夹（**真的唤起系统资源管理器**）。
 * Windows 上 explorer.exe 是"单实例"进程：直接反复调用有时只在任务栏闪一下就没了，
 * 所以这里交给 PowerShell 干两件事：
 *   ① 已经有一个停在同一个文件夹的资源管理器窗口 → 把它拉到前台，不再开新的；
 *   ② 没有 → 用 explorer.exe 打开这个文件夹（路径里有空格 / 全角括号也不会断）。
 * 另外再挂一条纯 explorer.exe 的兜底：PowerShell 被安全策略挡住时也还有反应。
 * 全程不抛错：打不开就把真实原因回给界面，让用户能手动打开这个路径。
 */
function openTemplateFolder(preferFile) {
  const dir = preferFile ? templateDirOf(preferFile) : templateDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    /* 目录已存在或没权限 */
  }
  const errors = []
  let action = ''
  if (process.platform === 'win32') {
    const script = [
      "try { $path = " + psQuote(dir) + " } catch { $path = \"\" }",
      "if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }",
      "$target = ((Resolve-Path -LiteralPath $path).Path.TrimEnd([char]92)).ToLower()",
      "$targetUrl = \"file:///\" + $target.Replace([char]92, [char]47)",
      "$shell = New-Object -ComObject Shell.Application",
      "$hit = $null",
      "foreach ($w in @($shell.Windows())) {",
      "  try { $p = $w.Document.Folder.Self.Path.TrimEnd([char]92).ToLower(); if ($p -eq $target) { $hit = $w; break } } catch {}",
      "  try { if ($w.LocationURL.ToLower() -eq $targetUrl) { $hit = $w; break } } catch {}",
      "}",
      "if ($hit) {",
      "  try { $hit.Visible = $true } catch {}",
      "  try { (New-Object -ComObject WScript.Shell).AppActivate($hit.HWND) | Out-Null } catch {}",
      "  Write-Output reused",
      "} else {",
      "  Start-Process -FilePath explorer.exe -ArgumentList $target",
      "  Write-Output opened",
      "}",
    ].join('\r\n')
    // 同步跑一下：拿到 reused / opened 才知道该不该兜底（不能让 explorer 再开一个窗口）
    const done = runPowerShell(script)
    if (done.ok) {
      action = done.output.includes('reused') ? 'reused' : 'opened'
    } else {
      errors.push("powershell: " + done.error)
      // PowerShell 真的起不来才兜底：直接 explorer.exe 打开（单实例，不会开一堆）
      const viaExplorer = runDetached('explorer.exe', [dir])
      if (viaExplorer.ok) action = 'opened'
      else errors.push("explorer: " + viaExplorer.error)
    }
  } else if (process.platform === 'darwin') {
    const opened = runDetached('open', [dir])
    if (opened.ok) action = 'opened'
    else errors.push("open: " + opened.error)
  } else {
    const opened = runDetached('xdg-open', [dir])
    if (opened.ok) action = 'opened'
    else errors.push("xdg-open: " + opened.error)
  }
  if (!action) {
    appendLog("封面标签：打开模板文件夹失败（" + errors.join("；") + "），路径：" + dir)
    return { opened: false, dir, action: "", error: errors.join("；") }
  }
  appendLog("封面标签：模板文件夹 " + (action === "reused" ? "已在资源管理器里（拉到前台）" : "已打开") + " " + dir)
  return { opened: true, dir, action, error: errors.join("；") }
}

/** 拼一段 PowerShell 单引号字符串（路径里的单引号要翻倍） */
function psQuote(value) {
  return "'" + String(value || '').split("'").join("''") + "'"
}

/**
 * 起一个"跟本进程无关"的子进程（detached + 忽略 stdio）。
 * 只报"系统能不能起这个进程"：spawn 到就算成功（GUI 起没起由系统管）。
 */
function runDetached(command, args) {
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
    let error = ''
    if (child && typeof child.on === 'function') child.on('error', (err) => { error = (err && err.message) || String(err) })
    if (child && typeof child.unref === 'function') child.unref()
    return { ok: !error, error }
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) }
  }
}

/**
 * 跑一段 PowerShell 并把输出拿回来（同步等一小会儿）。
 * 只用来判断"要不要再兜底"：超时/报错都按失败处理。
 */
function runPowerShell(script) {
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
      encoding: 'utf8',
      timeout: 12000,
      windowsHide: true,
    })
    if (result.error) return { ok: false, error: (result.error && result.error.message) || String(result.error), output: '' }
    return { ok: true, error: '', output: String(result.stdout || '') }
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err), output: '' }
  }
}

/**
 * 「⑤ 封面标签」：把某一张模板设为当前使用。
 * 只认模板文件夹里的文件名，挡掉路径穿越；顺手把宽高清一次（界面按它算贴字位置）。
 */
function actionUseTemplate(payload) {
  const file = String((payload && payload.file) || "").trim()
  if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes("..")) {
    return { ok: false, error: "模板文件名不合法" }
  }
  let buffer
  try {
    buffer = fs.readFileSync(path.join(templateDirOf(file), file))
  } catch (err) {
    return { ok: false, error: "模板图片不存在（把自己做的模板放进模板文件夹再试）" }
  }
  const size = readImageSize(buffer, file)
  const settings = saveSettings(
    Object.assign({}, loadSettings(), {
      layoutTemplate: {
        file,
        name: file,
        width: size.width || 0,
        height: size.height || 0,
        updatedAt: new Date().toISOString(),
      },
    }),
  )
  appendLog("封面标签：当前模板切换为 " + file)
  return { ok: true, data: { template: templateInfoOf(settings), templates: listTemplateFiles() } }
}

/**
 * 从图片字节里读出宽高（PNG / JPEG / GIF / WEBP 都只读文件头，不引任何图形库）。
 * 读不出来就返回 0（界面对 0 有兜底：按 1080×1440 的默认比例贴字）。
 */
function readImageSize(buffer, file) {
  const buf = buffer || Buffer.alloc(0)
  const ext = String(file || "").split(".").pop().toLowerCase()
  try {
    if (ext === "png" && buf.length > 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    if (ext === "gif" && buf.length > 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    if (ext === "jpg" || ext === "jpeg") {
      let offset = 2
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset++
          continue
        }
        const marker = buf[offset + 1]
        const length = buf.readUInt16BE(offset + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) }
        }
        offset += 2 + length
      }
    }
    if (ext === "webp" && buf.length > 30) {
      const kind = buf.toString("ascii", 12, 16)
      if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
      if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      if (kind === "VP8L") {
        const bits = buf.readUInt32LE(21)
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
      }
    }
  } catch (err) {
    /* 读不出来就用 0，界面有兜底 */
  }
  return { width: 0, height: 0 }
}

/** 把模板原图吐回浏览器（界面侧 Canvas 需要它当底图） */
function sendTemplateImage(res, file) {
  const name = String(file || '').trim()
  // 只认文件名（不许带路径），挡掉 ../ 之类的路径穿越
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) {
    sendJson(res, 400, { ok: false, error: '模板文件名不合法' })
    return
  }
  const full = path.join(templateDirOf(name), name)
  let buffer
  try {
    buffer = fs.readFileSync(full)
  } catch (err) {
    sendJson(res, 404, { ok: false, error: '模板图片不存在（重新上传一张）' })
    return
  }
  const ext = (name.split('.').pop() || '').toLowerCase()
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
  try {
    res.statusCode = 200
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'no-store')
    res.end(buffer)
  } catch (err) {
    /* 连接可能已经断了 */
  }
}

/**
 * 模块5：「封面标签」（界面右上角那个「刷新」按钮走这里）。
 * ⚠ 按需求：这一步**只是把"可以做图的帖子"重新读一遍**（源 = 「④ 写文案」里点过「保存」的）。
 *   真正的出图在浏览器里用 Canvas 画（模板来自"模板文件夹"，这里只管列表与当前模板元数据）。
 */
function actionLayout() {
  const settings = loadSettings()
  const drafts = loadDrafts()
  const copies = layoutSourceCopies(drafts)
  const template = templateInfoOf(settings)
  if (!copies.length) {
    saveStatus({ module5: '等待文案' })
    return {
      ok: false,
      error: (drafts.copies || []).length
        ? '「封面标签」只认「④ 写文案」里点过「保存」的帖子。请先去那里点一下「保存」。'
        : '还没有文案。请先完成模块4。',
    }
  }
  saveStatus({ module5: '完成', module6: '未开始', stage: 'laid' })
  appendLog(`=== 封面标签：读取可做图的帖子 ${copies.length} 篇（模板：${template.file || '未选'}）===`)
  return {
    ok: true,
    data: {
      layoutItems: copies.map((copy) => ({
        id: copy.id,
        title: String((copy.titles || [])[0] || copy.sourceTitle || ''),
        body: String(copy.bodyAfterDeAi || copy.body || ''),
        sourceTitle: String(copy.sourceTitle || ''),
        sourceLink: String(copy.sourceLink || ''),
      })),
      layouts: drafts.layouts || [],
      template,
      local: true,
      llm: false,
      note: '模板生图是纯本地 Canvas 绘制（把标题/正文贴到你上传的模板上），不调用任何大模型。',
    },
  }
}


/** 去 AI 味（本地替换表，可手动再跑一次） */
function actionDeAi(payload) {
  const settings = loadSettings()
  const text = String((payload && payload.text) || '')
  return { ok: true, data: { before: text, after: deAiFlavorLocal(text, settings.bannedWords), local: true } }
}

/** 控制室：读全流程状态 */
async function actionStatus(ctx) {
  const settings = loadSettings()
  const topics = loadTopics()
  const cache = loadFetchCache()
  const drafts = loadDrafts()
  const status = loadStatus()
  const browser = await browserAvailable(settings.browserCdpUrl)
  // 「② 扫源抓取」列表的实时条数要用到两个"已经被拿走"的名单：
  //   · 已存进「① 选题库」的（saveTopic 之后扫源界面就把它移走了）
  //   · 已「核实通过」的（筛选核实的确认也会从扫源里扣掉，见界面侧 m2 的过滤规则）
  const topicKeys = new Set(topics.map((topic) => copyKeyOf({ link: topic.link, title: topic.title })))
  const confirmedKeys = new Set(
    (drafts.candidates || [])
      .filter((candidate) => candidate && candidate.confirmed)
      .map((candidate) => copyKeyOf({ link: candidate.link, title: candidate.title })),
  )
  return {
    ok: true,
    data: {
      status,
      counts: {
        // 选题库的"真实存量"：已经被「写文案」拿走的（usedForCopy）不再计入。
        // 界面上这些条目也看不到，所以数字必须跟列表一致
        // （数据还完整留在 topic-library.json 里，一个字没删）。
        topics: topics.filter((topic) => !topic.usedForCopy).length,
        // fetched = "本次抓取的有效条数"（不是"今日新增"）。
        // 口径说明：它是最近一次抓取**成功入库**的条数 =
        //   A) 本次抓到的原始条数
        //   − 站内重复链接（去重）
        //   − 设置里"抓取最近几天"过滤掉的旧日期条目
        //   （列表页没给日期的条目保留，界面显示"最新"）
        // 所以它既不是"今天新增"（新不新要跟上一次缓存比，那个数字在界面上单独提示），
        // 也不是"过滤前抓到多少"。界面上的文案统一叫「本次有效 N 条」。
        fetched: cache.items.length,
        // 「② 扫源抓取」列表的**实时条数**（用户反馈：抓了 28 条却显示 30 条、
        // 存进选题库 / 核实通过之后数字也不减）。
        // 口径 = 本次抓到的条数 − 已经存进「① 选题库」的 − 已经「核实通过」的；
        // 这两批在扫源界面本来就已经被过滤掉不显示了，所以数字必须跟着一起扣。
        // 界面侧每存一次 / 核实一次都会重新拉一次 status，所以数字是立刻更新的。
        fetchedPending: cache.items.filter((item) => {
          const key = copyKeyOf({ link: item && item.link, title: item && item.title })
          if (!key) return true
          if (topicKeys.has(key)) return false
          return !confirmedKeys.has(key)
        }).length,
        fetchFailures: cache.failures.length,
        // 筛选核实的"待办数量"：已经核实通过的（confirmed）不再计入。
        // 界面上这些条目已经从列表消失，所以数字必须跟列表一致
        // （数据还完整留在 drafts.json 里，一个字没删）。
        candidates: (drafts.candidates || []).filter((candidate) => !candidate.confirmed).length,
        candidatesTotal: (drafts.candidates || []).length,
        // 「④ 写文案」里等着写的条数：已经核实通过、但还没在写文案里生成稿子的那些。
        // 界面上的模块卡片用它显示"已核实 N 条 · 待写"，这样点完「核实通过」数字立刻就是对的
        // （以前卡片上只有一个"X 篇"= 已经写好的稿子数，刚核实完当然还是 0）。
        confirmedPending: (drafts.candidates || []).filter((candidate) => {
          if (!candidate || !candidate.confirmed) return false
          const link = String(candidate.link || '')
          if (!link) return true
          return !(drafts.copies || []).some((copy) => String(copy && copy.sourceLink) === link)
        }).length,
        selected: (drafts.candidates || []).filter((candidate) => candidate.selected !== false).length,
        copies: (drafts.copies || []).length,
        // 「④ 写文案」卡片上那个数字 = **还没进做图排版的稿子数**。
        // 帖子点过「保存」就归「⑤ 做图排版」了、写文案界面也不再展示它，
        // 所以这里必须只数"还没保存的"，否则保存一篇数字还挂着（用户反馈的第 2 个问题）。
        copiesPending: (drafts.copies || []).filter((copy) => copy && !copy.savedByUser).length,
        layouts: (drafts.layouts || []).length,
      },
      lastFetchDate: cache.lastFetchDate,
      lastFetchAt: cache.fetchedAt,
      browserAvailable: browser.ok,
      browserError: browser.ok ? '' : browser.error,
      dataDir: DATA_DIR,
      files: FILES,
      localOnly: true,
    },
  }
}

/** 读列表类数据 */
function actionLoad(payload) {
  const what = String((payload && payload.what) || '')
  if (what === 'topics') {
    const topics = loadTopics()
    return { ok: true, data: { topics, total: topics.length } }
  }
  if (what === 'fetch') {
    const cache = loadFetchCache()
    return {
      ok: true,
      data: {
        items: cache.items,
        groups: groupBySource(cache.items),
        failures: decorateFailures(cache.failures),
        lastFetchDate: cache.lastFetchDate,
        fetchedAt: cache.fetchedAt,
        sites: cache.sites,
      },
    }
  }
  if (what === 'candidates') {
    const drafts = loadDrafts()
    // 已经存进「① 选题库」的：不再作为候选返回（按需求：存过的不在筛选核实里重复出现）
    const topicKeys = new Set(loadTopics().map((topic) => String(topic.link || topic.title || '')))
    const list = (drafts.candidates || []).filter((candidate) => !topicKeys.has(String(candidate.link || candidate.title || '')))
    return { ok: true, data: { candidates: list.map(decorateCandidate), items: FILTER_ITEMS } }
  }
  if (what === 'copies') {
    const drafts = loadDrafts()
    return { ok: true, data: { copies: (drafts.copies || []).map(decorateCopy), checklist: QUALITY_CHECKLIST, model: modelInfo(loadSettings()) } }
  }
  if (what === 'layouts') {
    const drafts = loadDrafts()
    // 做图排版现在只剩两件事：可以做图的帖子列表 + 模板图片信息（出图在浏览器里画）
    return {
      ok: true,
      data: {
        layouts: drafts.layouts || [],
        template: templateInfoOf(loadSettings()),
        layoutItems: layoutSourceCopies(drafts).map((copy) => ({
          id: copy.id,
          title: String((copy.titles || [])[0] || copy.sourceTitle || ''),
          body: String(copy.bodyAfterDeAi || copy.body || ''),
          sourceTitle: String(copy.sourceTitle || ''),
          sourceLink: String(copy.sourceLink || ''),
        })),
      },
    }
  }
  if (what === 'log') {
    return { ok: true, data: { log: tailLog(160), dir: DATA_DIR } }
  }
  if (what === 'sop') {
    return { ok: true, data: parseSop() }
  }
  return { ok: false, error: `不认识的读取类型：${what}` }
}

/** 冷启动 SOP / 选题判断表 / 对标拆解方法（文档第七、九、十章，内置给用户随时查看） */
function parseSop() {
  return {
    coldStart: {
      title: '冷启动 SOP（新号前两周发什么）',
      week1: [
        { day: 'Day 1', type: '自我介绍 + 账号定位', goal: '让人知道你是谁、发什么' },
        { day: 'Day 2', type: '一条"AI圈今日大事"资讯', goal: '测试资讯类反响' },
        { day: 'Day 3', type: '一条"AI工具实测"', goal: '测试工具类反响' },
        { day: 'Day 4', type: '一条"AI圈冷知识/信息差"', goal: '测试信息差类反响' },
        { day: 'Day 5', type: '一条"避坑/踩雷"', goal: '测试情绪类反响' },
        { day: 'Day 6', type: '数据最好的那条，换个角度再发', goal: '验证爆款可复制性' },
        { day: 'Day 7', type: '一周总结 + 引导关注', goal: '建立追更习惯' },
      ],
      week2: ['把第一周数据最好的内容类型固定下来，占 60%', '剩余 40% 继续测试新角度', '每天固定时间发（建议晚 7~9 点）', '每条发布后 1 小时内回评论'],
      mindset: '前两周不看点赞数，只看哪种类型评论最多、收藏最多。收藏代表"有用"，评论代表"有共鸣"。',
    },
    topicScore: {
      title: '选题判断表（每次选题必过）',
      items: [
        { dimension: '匹配度', rule: '跟你的账号定位一致吗？' },
        { dimension: '情绪', rule: '能让人"哇""气""笑""学到了"吗？' },
        { dimension: '信息差', rule: '多数人还不知道吗？' },
        { dimension: '可延展', rule: '能写成 3 张以上卡片吗？' },
      ],
      rule: '四项平均分 ≥ 3.5 才值得做。低于 3 分的，放弃。',
    },
    positioning: {
      title: '账号定位与对标拆解',
      three: ['你是谁：一句话说清身份（如"3年AI产品经理，每天帮你筛AI圈大事"）', '为谁服务：你的目标读者是谁，他们的痛点是什么', '凭什么是你：你的独特视角、经验或信息源'],
      benchmark: ['账号定位与人设', '内容方向与选题策略', '爆款内容模型', '封面与标题规律', '评论区运营', '增长路径'],
      sixLayers: ['目标人群', '具体场景', '核心承诺', '标题机制', '封面信息', '正文证据'],
      training: [
        '建一个"爆款拆解库"，每周拆解 3~5 条同赛道爆款',
        '刷内容时不只是看，要想"这条为什么会被推给我"',
        '看最高赞的评论在夸什么/骂什么，找选题的线索',
        '追问细节："这个XX在哪里买？""XX步骤能再详细点吗？"——这些就是下一篇的选题',
      ],
    },
    compliance: {
      title: '发布前检查清单（每次发布必过）',
      quantity: QUALITY_CHECKLIST.map((item) => item.item),
      aiLabel: '平台要求 AI 生成内容及转载内容必须标注来源：发布时勾选"高级选项-内容类型声明-已自主标注"，并在标题/正文注明"AI辅助生成"或"转载自@XXX"。',
      banned: '绝对化用语（全网最好、第一、顶级、根治）出现即限流；违规营销词（免费领、引流、私域）易判定硬广；诱导互动词（一键三连、求点赞、求收藏、求关注、互关互赞）也在禁用之列。',
      copy: '平台加强实名认证，站外搬运、站内抄袭均不可行；纯 AI 水文、刻意摆拍虚假种草、无干货泛蹭热点会被淘汰。',
    },
    risks: [
      '生成内容是本地规则拼的，语气一定还要你自己顺一遍',
      '反爬方案可能遇到新变化，失败时按兜底处理（手动打开查看）',
      '数字核实永远以原文为准，界面上标红的数字要重点核对',
      '生图插件需自备 API Key，会产生费用',
      '本插件不调用大模型，所以不会影响你的聊天会话',
      '平台规则会变，合规清单基于 2026 年规则编写',
    ],
  }
}

// ---------------------------------------------------------------------------
// 路由分发
// ---------------------------------------------------------------------------

async function dispatch(ctx, action, payload) {
  switch (action) {
    case 'status':
      return await actionStatus(ctx)
    case 'settings':
      // filterDefaults：六项判断标准的**出厂默认关键词**，给设置页的"恢复默认"用
      // （界面侧不重复写一份，省得两边不一致）
      return {
        ok: true,
        data: {
          settings: loadSettings(),
          model: modelInfo(loadSettings()),
          template: templateInfoOf(loadSettings()),
          filterDefaults: { keywords: DEFAULT_FILTER_KEYWORDS, extend: DEFAULT_FILTER_EXTEND },
        },
      }
    case 'saveSettings': {
      const settings = saveSettings((payload && payload.settings) || {})
      appendLog('设置已保存')
      return { ok: true, data: { settings } }
    }
    case 'load':
      return actionLoad(payload)
    case 'saveTopic': {
      // 兼容两种字段名：界面侧发 item，旧代码/测试发 topic（历史上对不上导致存进空记录）
      const source = (payload && (payload.item || payload.topic)) || {}
      const result = saveTopic(source)
      appendLog(`存入选题库：${String(source.title || '').slice(0, 60)}${result.added ? '' : '（已存在，跳过）'}`)
      return { ok: true, data: Object.assign({}, result, { topics: loadTopics() }) }
    }
    case 'deleteTopic': {
      const result = deleteTopic((payload && payload.id) || '')
      appendLog(`删除选题：剩 ${result.total} 条`)
      return { ok: true, data: Object.assign({}, result, { topics: loadTopics() }) }
    }
    case 'fetchProgress':
      return { ok: true, data: readProgress() }
    case 'fetch':
      return await actionFetch(ctx)
    case 'filter':
      return actionFilter(payload)
    case 'confirm':
      return actionConfirm(payload)
    case 'writeCopy':
      return await actionWriteCopy(payload)
    case 'writeFromTopics':
      return await actionWriteFromTopics(payload)
    case 'polish':
      return await actionPolish(payload)
    case 'updateCopy':
      return actionUpdateCopy(payload)
    case 'deleteCopy':
      return actionDeleteCopy(payload)
    case 'deAi':
      return actionDeAi(payload)
    case 'layout':
      return actionLayout()
    case 'listTemplates': {
      const active = templateInfoOf(loadSettings())
      return { ok: true, data: { dir: templateDirOf(active.file || ''), templates: listTemplateFiles(), active: active.file, template: active } }
    }
    case 'openTemplateFolder': {
      const active = templateInfoOf(loadSettings())
      const opened = openTemplateFolder(active.file || (payload && payload.file) || '')
      return { ok: true, data: Object.assign({ templates: listTemplateFiles(), active: active.file, template: active }, opened) }
    }
    case 'useTemplate':
      return actionUseTemplate(payload)
    case 'storage':
      return { ok: true, data: { info: storageInfo(), dir: DATA_DIR } }
    default:
      return { ok: false, error: `不认识的接口动作：${action}` }
  }
}

function createHandler(ctx) {
  return async (req, res) => {
    try {
      if (rejected(ctx, req, res)) return
      if (req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const action = url.searchParams.get('action') || 'status'
        // 模板原图（做图排版的底图）走这里直接吐字节流，不套 JSON
        if (action === 'templateImage') {
          sendTemplateImage(res, url.searchParams.get('file') || '')
          return
        }
        sendJson(res, 200, await dispatch(ctx, action, {}))
        return
      }
      if (req.method === 'POST') {
        let body = {}
        try {
          const text = await readBody(req)
          body = text ? JSON.parse(text) : {}
        } catch (err) {
          sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
          return
        }
        const action = String(body.action || 'status')
        sendJson(res, 200, await dispatch(ctx, action, body.payload || {}))
        return
      }
      sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
    } catch (err) {
      const message = (err && err.message) || String(err)
      logError('接口出错：', message)
      appendLog(`接口出错：${message}`)
      sendJson(res, 500, { ok: false, error: message })
    }
  }
}

// ---------------------------------------------------------------------------
// 插件定义
// ---------------------------------------------------------------------------

export const name = 'ai-news-workbench'

/**
 * 主机侧只声明真正需要的服务。
 * 注意：**不再声明 llm** —— 本插件不调用大模型，避免触发 DeepSeek 请求扩展链路。
 */
export const inject = ['webServer']

/**
 * 幂等注册标记。
 * 如果 profile 的配置里不小心把本插件列了两次（比如既在 bundles 里、又有一条 insert），
 * 平台会对同一个包执行两次 apply；路由是"同一路径只能注册一次"的，
 * 第二次会抛 duplicate prefix route，导致插件被标记失败。
 * 这里用模块级标记兜住：第二次直接跳过，绝不让它变成加载错误。
 */
let routeRegistered = false
let disposer = null

export async function apply(ctx) {
  try {
    appendLog('插件加载中…')
  } catch (err) {
    /* 日志失败不影响加载 */
  }
  try {
    if (routeRegistered) {
      // 已经注册过：说明是重复加载，直接返回（不算失败）
      log('检测到重复加载，跳过接口注册（这不是错误）')
      return
    }
    const webServer = ctx.get ? ctx.get('webServer') : ctx.webServer
    if (!webServer || typeof webServer.register !== 'function') {
      logError('webServer 服务不可用，工作台接口没有注册（界面会提示"主机侧未就绪"）')
      return
    }
    const handler = createHandler(ctx)
    disposer = webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
    routeRegistered = true
    ctx.on('dispose', () => {
      try {
        if (typeof disposer === 'function') disposer()
      } catch (err) {
        /* 忽略 */
      }
      routeRegistered = false
      disposer = null
    })
    log(`已注册接口 ${API_PREFIX}（数据目录：${DATA_DIR}）`)
    appendLog(`插件加载完成，接口路径 ${API_PREFIX}`)
  } catch (err) {
    // 关键：初始化失败也不许把 Harness 启动搞挂
    logError('初始化失败（工作台不可用，但 Harness 正常）：', (err && err.message) || err)
  }
}

export default { name, inject, apply }

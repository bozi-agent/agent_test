/**
 * AI 资讯工作台 —— 本地生成器（**不调用大模型**）
 *
 * 为什么不用大模型：
 *  之前版本用 `ctx.llm.stream()` 从插件里直接打模型，会走进 DeepSeek 适配器的
 *  "请求扩展准备/接受"链路；在没有会话上下文的情况下调用会让主聊天界面报
 *  `DeepSeek request extension preparation failed REQUEST_EXTENSION` 并崩溃。
 *  这个风险不可接受，所以这里改成**纯本地、确定性的规则生成**：
 *  所有事实都来自抓取到的原文，一个字都不编。
 *
 * 生成内容的来源约定（每条都可追溯）：
 *  - 标题句式：把候选的标题套进几种经过验证的小红书句式
 *  - 正文：筛选时写好的 3 句话总结（它已经保留了原文数字/人名/时间/版本号）
 *  - 标签：#账号定位 + 从标题里抽出的实体（产品名/版本号/公司名）+ 一个通用标签
 *  - 卡片：把总结按句子拆开，一句一张卡片
 *
 * 所以界面上会明确提示"这一步是本地规则生成，不是 AI 写的"，用户自己再润色。
 */

import { FILTER_ITEMS, COPY_CHECKLIST, judgeCopy, deAiTells, scanBanned, HIGHLIGHT_PATTERNS, buildPersonaText } from './rules.js'

/** 把总结按句子拆开（保留标点） */
export function splitSentences(text) {
  const source = String(text || '').trim()
  if (!source) return []
  const parts = source
    .split(/(?<=[。！？!?；;])/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length ? parts : [source]
}

/** 从文本里抽实体（产品名/版本号/公司名/数字），用来做标签 */
export function extractEntities(text, limit = 6) {
  const source = String(text || '')
  const found = []
  const seen = new Set()
  for (const pattern of HIGHLIGHT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    let match
    while ((match = re.exec(source)) !== null) {
      const value = String(match[0] || '').trim()
      if (!value || value.length < 2 || value.length > 18) continue
      if (seen.has(value)) continue
      seen.add(value)
      found.push(value)
      if (found.length >= limit) return found
    }
  }
  return found
}

/** 标题句式模板：{title} 是候选原标题 */
const TITLE_TEMPLATES = [
  '{title}',
  '我刚发现：{title}',
  '{title}，这次是真的',
  '{title}（说人话版）',
  '{title}｜普通人也能用上',
]

/** 生成 5 个标题候选（本地规则，不调模型） */
export function buildTitles(candidate) {
  const title = String((candidate && candidate.title) || '').trim() || '（没有标题）'
  const entities = extractEntities(`${title} ${(candidate && candidate.summary) || ''}`, 2)
  const out = []
  for (const template of TITLE_TEMPLATES) {
    let next = template.replace('{title}', title)
    if (out.includes(next)) next = `${next}（${out.length + 1}）`
    out.push(next)
  }
  // 如果原文带具体数字/版本号，再补一个"信息前置"的写法
  if (entities.length && out.length < 5) out.unshift(`${entities[0]}：${title}`)
  const banned = scanBanned(out.join(' '))
  return {
    titles: out.slice(0, 5),
    banned,
    warning: banned.hasAbsolute ? '标题里有绝对化用语，发之前自己改一下' : '',
  }
}

/** 生成正文草稿（本地规则：原文总结 + 人设化的开头结尾骨架） */
export function buildBody(candidate, settings) {
  const summary = String((candidate && candidate.summary) || '').trim()
  const sentences = splitSentences(summary)
  const persona = buildPersonaText(settings)
  const checked = FILTER_ITEMS.filter((item) => candidate && candidate.checks && candidate.checks[item.key]).map((item) => item.label)
  const link = String((candidate && candidate.link) || '').trim()

  const lines = []
  lines.push('我刷到一条消息，分享一下👇')
  lines.push('')
  for (const sentence of sentences) lines.push(sentence)
  lines.push('')
  if (checked.length) lines.push(`为什么值得看：${checked.join('、')}`)
  if (link) lines.push(`原文我放这儿了：${link}`)
  lines.push('')
  lines.push(`（我的说话习惯：${persona}。上面这段是照着原文总结整理的，大家自己再顺一遍。）`)

  const raw = lines.join('\n')
  const after = deAiTells(raw)
  return { body: raw, bodyAfterDeAi: after, sentences }
}

/** 生成标签（本地规则：#定位 + 实体 + 通用） */
export function buildTags(candidate, settings) {
  const positioning = String((settings && settings.accountPositioning) || 'AI圈资讯').replace(/\s+/g, '')
  const entities = extractEntities(`${(candidate && candidate.title) || ''} ${(candidate && candidate.summary) || ''}`, 4)
  const tags = []
  const push = (value) => {
    const tag = String(value || '').replace(/^#/, '').replace(/[｜|，,、\s]/g, '').trim()
    if (!tag || tag.length > 12) return
    if (!tags.includes(tag)) tags.push(tag)
  }
  push(positioning)
  for (const entity of entities) push(entity)
  push('AI')
  push('AI资讯')
  return tags.slice(0, 5)
}

/** 生成一篇完整文案（模块4 用） */
export function buildCopy(candidate, settings) {
  const titleInfo = buildTitles(candidate)
  const bodyInfo = buildBody(candidate, settings)
  const tags = buildTags(candidate, settings)
  const copy = {
    id: `copy_${Math.random().toString(36).slice(2, 10)}`,
    candidateId: String((candidate && candidate.id) || ''),
    sourceTitle: String((candidate && candidate.title) || ''),
    sourceLink: String((candidate && candidate.link) || ''),
    titles: titleInfo.titles,
    body: bodyInfo.body,
    bodyAfterDeAi: bodyInfo.bodyAfterDeAi,
    tags,
    sentences: bodyInfo.sentences,
    generatedBy: '本地规则生成（待润色）',
    // 按需求：写文案这一步只摆正文，标"待润色"；用户点「✨ AI 润色」时才调大模型
    polished: false,
    needsPolish: true,
  }
  const judged = judgeCopy(Object.assign({}, copy, { body: copy.bodyAfterDeAi }))
  copy.checklist = judged.checklist
  copy.allPass = judged.allPass
  copy.banned = judged.banned
  copy.needsManualFix = judged.checklist.filter((item) => !item.pass).map((item) => `${item.item}：${item.reason}`)
  copy.titleWarning = titleInfo.warning
  return copy
}

/** 模块4：给一批候选生成文案 */
export function generateCopies(candidates, settings) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((item) => item && item.selected !== false)
  return list.map((candidate) => buildCopy(candidate, settings))
}

/** 去 AI 味（本地替换表，作用于任意文本） */
export function deAiFlavorLocal(text, bannedWords = []) {
  let out = deAiTells(String(text || ''))
  for (const word of Array.isArray(bannedWords) ? bannedWords : []) {
    const clean = String(word || '').trim()
    if (!clean) continue
    out = out.split(clean).join('')
  }
  return out
}

/** 模块5：本地排版（封面 + 卡片，全部来自文案句子） */
export function generateLayout(copy) {
  const sentences = Array.isArray(copy.sentences) && copy.sentences.length ? copy.sentences : splitSentences(copy.bodyAfterDeAi || copy.body)
  const entities = extractEntities(`${copy.sourceTitle} ${copy.body || ''}`, 3)
  const bigTitle = String(copy.sourceTitle || '').slice(0, 14) || '（标题待定）'
  const subTitle = entities.length ? entities.slice(0, 2).join(' · ').slice(0, 20) : '原文要点整理'
  const cards = sentences.slice(0, 5).map((sentence, index) => ({
    index: index + 1,
    text: sentence.replace(/\s+/g, ' ').slice(0, 60),
    layoutAdvice: index === 0 ? '放大一号字，放卡片中间' : '常规字号，左对齐，一行别超过 16 个字',
  }))
  while (cards.length < 3) {
    cards.push({
      index: cards.length + 1,
      text: cards.length === 1 ? '这条为什么值得看' : '原文链接放在最后一张',
      layoutAdvice: '常规字号，左对齐',
    })
  }
  return {
    id: `layout_${Math.random().toString(36).slice(2, 10)}`,
    copyId: copy.id,
    sourceTitle: copy.sourceTitle,
    cover: {
      bigTitle,
      subTitle,
      styleAdvice: '大字不超过 14 字，一屏能看清；底下留一条小字放副标题',
    },
    cards,
    canvaAdvice: 'Canva / 美图秀秀搜"小红书封面"，把大字换成封面标题，内页用"多图卡片"模板，一张一个要点。',
    imagePrompt: `封面：深色科技风背景，中间一行白色大字"${bigTitle}"，右下角小字"${subTitle}"`,
    generatedBy: '本地规则生成',
  }
}

/** 模块5：给一批文案排版 */
export function generateLayouts(copies) {
  return (Array.isArray(copies) ? copies : []).map((copy) => generateLayout(copy))
}

/** 给界面用的"本地生成"说明文案 */
export const LOCAL_GENERATION_NOTE =
  '这一步是**本地规则生成**（不是 AI 写的）：标题是套句式、正文来自筛选时保留原文数字的总结。请你自己再顺一遍语气，事实以原文为准。'

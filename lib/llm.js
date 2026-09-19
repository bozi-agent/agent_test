/**
 * AI 资讯工作台 —— 大模型调用（模块4 写文案 / 模块5 做图 / 润色）
 *
 * 走的是 OpenAI 兼容的 /chat/completions 接口，所以：
 *   - DeepSeek：API 地址填 https://api.deepseek.com/v1
 *   - 其它兼容服务：填到 /v1 为止，或者直接填完整的 .../chat/completions
 * 没配 API Key / 地址时**一律不调用**，调用方会退回原来的本地规则生成。
 *
 * 提示词里必须带开发文档 6.3/6.8 的「人设注入模板」（见 rules.js 的 buildPersonaBlock）。
 */

import { buildPersonaBlock } from './rules.js'

/**
 * 默认模型名。
 * ⚠ 2026-09 查过 DeepSeek 官方文档：现在只有 `deepseek-flash`（DeepSeek-V4.1-Flash）
 *   和 `deepseek-v4-pro` 两个正式名字。旧的 `deepseek-chat` 实测还能调，但服务端会
 *   把它映射成 deepseek-flash（返回体里的 model 就是 deepseek-flash），已经属于旧名。
 *   所以这里默认用 deepseek-flash，并且把服务端返回的真实模型名显示出来。
 */
export const DEFAULT_MODEL = 'deepseek-flash'

/** 是否配好了模型（写文案 / 做图 要不要走大模型看这个） */
export function llmConfigured(settings) {
  const model = (settings && settings.model) || {}
  return !!(String(model.apiKey || '').trim() && String(model.baseUrl || '').trim())
}

/**
 * 做图模块用哪套模型配置。
 * settings.modelLayout 填了就用它，没填就沿用写文案那套（这样不填也能跑）。
 * 注意：DeepSeek 只出文字，**不能生图**（生图得另配生图服务），
 * 所以这里只是"排版文案用哪个模型"，不是"用哪个模型画图"。
 */
export function layoutModelSettings(settings) {
  const base = settings || {}
  const layout = base.modelLayout || {}
  const hasOwn = !!(String(layout.apiKey || '').trim() && String(layout.baseUrl || '').trim())
  if (!hasOwn) return base
  return Object.assign({}, base, {
    model: {
      model: String(layout.model || '').trim() || DEFAULT_MODEL,
      apiKey: layout.apiKey,
      baseUrl: layout.baseUrl,
    },
  })
}

/** 组装 chat/completions 的 URL（用户填 /v1 或填全路径都能用） */
export function chatUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  if (/\/chat\/completions$/.test(base)) return base
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

/**
 * 调一次大模型。
 * @param {object} settings 插件设置（读 settings.model）
 * @param {Array<{role:string, content:string}>} messages 对话
 * @param {object} [options] { temperature, timeoutMs, thinking }
 * @returns {Promise<{text:string, model:string, usage:object|null}>} 连"实际用到的模型名"一起返回
 */
export async function chatDetailed(settings, messages, options = {}) {
  const model = (settings && settings.model) || {}
  const apiKey = String(model.apiKey || '').trim()
  const url = chatUrl(model.baseUrl)
  if (!apiKey || !url) throw new Error('还没有配置模型：请在「设置」里填 API Key 和 API 地址')
  const modelName = String(model.model || '').trim() || DEFAULT_MODEL
  const body = {
    model: modelName,
    messages: Array.isArray(messages) ? messages : [],
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.8,
    stream: false,
  }
  // DeepSeek 官方接口默认是"思考模式"，写文案这种活用不上：
  // 关掉思考 = 推理等级最低（更快也更便宜）。别的 OpenAI 兼容服务不加这个参数。
  if (/deepseek\.com/i.test(url) && options.thinking !== true) body.thinking = { type: 'disabled' }
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(options.timeoutMs) || 90000),
    })
  } catch (err) {
    throw new Error(`连不上模型接口（${url}）：${(err && err.message) || err}`)
  }
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (err) {
    data = null
  }
  if (!response.ok) {
    const detail = (data && (data.error?.message || data.message)) || text.slice(0, 200)
    throw new Error(`模型接口返回 HTTP ${response.status}：${detail}`)
  }
  const content =
    (data && data.choices && data.choices[0] && ((data.choices[0].message && data.choices[0].message.content) || data.choices[0].text)) || ''
  const out = String(content || '').trim()
  if (!out) throw new Error('模型返回了空内容')
  // 服务端会回它真正用的是哪个模型（比如填 deepseek-chat 其实被映射成 deepseek-flash），照实回报
  return { text: out, model: String((data && data.model) || modelName), usage: (data && data.usage) || null }
}

/** 只要文本的便捷版 */
export async function chat(settings, messages, options = {}) {
  const result = await chatDetailed(settings, messages, options)
  return result.text
}

/** 从模型回复里抠出 JSON（允许 ```json 包裹、前后带解释） */
export function parseJsonLoose(text) {
  const source = String(text || '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source)
  const candidate = fenced ? fenced[1] : source
  const start = candidate.search(/[[{]/)
  if (start === -1) return null
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
  if (end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch (err) {
    return null
  }
}

/** 拼「人设注入」那一段（开发文档 6.3 / 6.8 的模板，直接复用 rules.js） */
export function personaBlock(settings) {
  return buildPersonaBlock(settings || {})
}

/** 把一段"技能指令"文本拼进提示词（写文案 / 做图各有一套） */
function skillBlockOf(text) {
  const skill = String(text || '').trim()
  if (!skill) return ''
  return `\n\n【本次必须遵守的额外技能指令】\n${skill}\n（以上技能指令优先级高于默认写作习惯，但不能违反硬规则：不许编造事实、不许用绝对化/诱导互动词。）`
}

/** 用户在界面上填的「Skill 技能指令」（写文案模块，选填） */
export function skillBlock(settings) {
  return skillBlockOf(settings && settings.skillText)
}

/** 做图排版模块的「Skill 技能指令」（settings.skillTextLayout，跟写文案那套分开存） */
export function skillBlockLayout(settings) {
  return skillBlockOf(settings && settings.skillTextLayout)
}

/** 不允许出现的词（拼进提示词，双保险） */
export function bannedBlock(settings) {
  const banned = Array.isArray(settings && settings.bannedWords) ? settings.bannedWords.filter(Boolean) : []
  return banned.length ? `\n绝对不要出现这些词：${banned.join('、')}。` : ''
}

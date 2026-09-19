/**
 * AI 资讯工作台 —— 主机侧 Excel 解析（模块7 用）
 *
 * 策略（按开发文档 6.3 ④ 的降级思路）：
 *  1) 优先用 Harness 的表格工具（dsh-daily-documents 的 spreadsheet_read）——它带 A1 区域语法。
 *     注意：该插件标注为 developer preview，可能没装或调用失败。
 *  2) 降级：主机侧自己解析 .xlsx（xlsx 本质是 zip + XML，用 node:zlib 解压，不用第三方库）。
 *  3) 再降级：.csv / .tsv 直接按文本解析。
 *  4) 全失败：返回明确提示，引导用户手动整理成 CSV（不编数据）。
 *
 * 表头做了中英文模糊匹配，用户的小红书报表列名不一样也能读。
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// ---------------------------------------------------------------------------
// 表头识别
// ---------------------------------------------------------------------------

/** 列名 → 内部字段（模糊匹配，越靠前越优先） */
const COLUMN_RULES = [
  { field: 'title', words: ['笔记标题', '标题', '作品名称', '内容标题', 'note title', 'title', '笔记名称'] },
  { field: 'reads', words: ['阅读量', '曝光量', '浏览量', '观看量', '展现量', '阅读数', 'impressions', 'views', 'reads'] },
  { field: 'likes', words: ['点赞量', '点赞数', '点赞', 'likes'] },
  { field: 'collects', words: ['收藏量', '收藏数', '收藏', 'collects', 'favorites'] },
  { field: 'comments', words: ['评论量', '评论数', '评论', 'comments'] },
  { field: 'shares', words: ['分享量', '分享数', '分享', '转发量', '分享', 'shares'] },
  { field: 'newFollows', words: ['新增关注', '粉丝增量', '涨粉', '新增粉丝', '关注数', 'follows'] },
  { field: 'effectiveComments', words: ['有效评论', '有效讨论', '有效评论数'] },
  { field: 'publishedAt', words: ['发布时间', '发布日期', '时间', '日期', 'publish', 'date'] },
  { field: 'engagementAfter72h', words: ['72小时', '72h', '发布后互动', '长尾互动'] },
  { field: 'body', words: ['正文', '内容', '文案', 'body'] },
]

/** 找到某个表头文字对应的字段 */
export function matchColumn(header) {
  const text = String(header || '').trim().toLowerCase()
  if (!text) return ''
  for (const rule of COLUMN_RULES) {
    for (const word of rule.words) {
      if (text.includes(String(word).toLowerCase())) return rule.field
    }
  }
  return ''
}

function toNumber(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value).trim()
  if (!text) return 0
  if (/%|％/.test(text)) {
    const percent = Number(text.replace(/[,，\s%％]/g, ''))
    return Number.isFinite(percent) ? percent : 0
  }
  let multiplier = 1
  if (/万/.test(text)) multiplier = 10000
  else if (/亿/.test(text)) multiplier = 100000000
  else if (/k/i.test(text)) multiplier = 1000
  const n = Number(text.replace(/[,，\s万kK亿]/g, ''))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * multiplier * 100) / 100
}

// ---------------------------------------------------------------------------
// XLSX（zip + XML）最小解析器
// ---------------------------------------------------------------------------

function unzipEntries(filePath) {
  const buffer = fs.readFileSync(filePath)
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd === -1) throw new Error('不是有效的 xlsx 文件（找不到 zip 结尾标记）')
  const total = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.set(name, { method, compressedSize, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return {
    read(name) {
      const entry = entries.get(name)
      if (!entry) return null
      const local = entry.localOffset
      if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`zip 条目 ${name} 头损坏`)
      const nameLength = buffer.readUInt16LE(local + 26)
      const extraLength = buffer.readUInt16LE(local + 28)
      const dataStart = local + 30 + nameLength + extraLength
      const data = buffer.slice(dataStart, dataStart + entry.compressedSize)
      if (entry.method === 0) return data
      if (entry.method === 8) return zlib.inflateRawSync(data)
      throw new Error(`不支持的压缩方式（${entry.method}）`)
    },
    names: Array.from(entries.keys()),
  }
}

function unescapeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16))
      } catch (err) {
        return ''
      }
    })
    .replace(/&#(\d+);/g, (m, dec) => {
      try {
        return String.fromCodePoint(Number(dec))
      } catch (err) {
        return ''
      }
    })
    .replace(/&amp;/g, '&')
}

function parseSharedStrings(xml) {
  const list = []
  if (!xml) return list
  const siRe = /<si>([\s\S]*?)<\/si>/g
  let m
  while ((m = siRe.exec(xml)) !== null) {
    const texts = []
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let t
    while ((t = tRe.exec(m[1])) !== null) texts.push(unescapeXml(t[1]))
    list.push(texts.join(''))
  }
  return list
}

function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(String(ref || '').toUpperCase())
  if (!letters) return 0
  let index = 0
  for (const ch of letters[1]) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

function parseSheet(xml, sharedStrings) {
  const rows = []
  if (!xml) return rows
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const cells = []
    const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g
    let cellMatch
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1] || cellMatch[3] || ''
      const body = cellMatch[2] || ''
      const refMatch = /r="([A-Z]+\d+)"/i.exec(attrs)
      const index = refMatch ? columnIndex(refMatch[1]) : cells.length
      const typeMatch = /t="([^"]+)"/i.exec(attrs)
      const type = typeMatch ? typeMatch[1] : ''
      let value = ''
      if (type === 'inlineStr') {
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
        const texts = []
        let t
        while ((t = tRe.exec(body)) !== null) texts.push(unescapeXml(t[1]))
        value = texts.join('')
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body)
        const raw = vMatch ? unescapeXml(vMatch[1]) : ''
        if (type === 's') {
          const shared = sharedStrings[Number(raw)]
          value = shared === undefined ? '' : shared
        } else {
          value = raw
        }
      }
      while (cells.length < index) cells.push('')
      cells[index] = value
    }
    rows.push(cells)
  }
  return rows
}

/** 自己解析 xlsx，返回二维数组 */
export function readXlsxRows(filePath) {
  const zip = unzipEntries(filePath)
  const sharedStrings = parseSharedStrings(zip.read('xl/sharedStrings.xml') ? zip.read('xl/sharedStrings.xml').toString('utf8') : '')
  // 找第一个工作表（排掉 chartsheet）
  const sheetNames = zip.names
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)/.exec(a)[1]) - Number(/(\d+)/.exec(b)[1]))
  if (!sheetNames.length) throw new Error('xlsx 里没有找到工作表')
  const rows = parseSheet(zip.read(sheetNames[0]).toString('utf8'), sharedStrings)
  return { rows, sheetName: sheetNames[0] }
}

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

/** 解析 CSV 文本（支持引号包裹、双引号转义） */
export function parseCsv(text, delimiter = ',') {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const source = String(text || '').replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    if (ch === '\r') continue
    field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => String(cell || '').trim() !== ''))
}

// ---------------------------------------------------------------------------
// 表格 → 结构化笔记数据
// ---------------------------------------------------------------------------

/**
 * 把二维表转成复盘数据
 * @param {string[][]} rows 第一行是表头
 * @returns {object} ReviewData
 */
export function rowsToReviewData(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error('表格里没有数据行（第一行应当是表头，第二行开始是笔记）')
  }
  const header = rows[0].map((cell) => String(cell || '').trim())
  const mapping = header.map((name) => matchColumn(name))
  if (!mapping.includes('title')) {
    throw new Error(`没找到"标题"列。当前表头是：${header.join(' | ')}`)
  }
  const notes = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue
    const note = { title: '', body: '' }
    for (let c = 0; c < mapping.length; c++) {
      const field = mapping[c]
      if (!field) continue
      const raw = row[c]
      if (field === 'title' || field === 'body' || field === 'publishedAt') {
        note[field] = String(raw === undefined || raw === null ? '' : raw).trim()
      } else {
        note[field] = toNumber(raw)
      }
    }
    if (!note.title) continue
    notes.push(note)
  }
  const mapped = mapping.filter(Boolean)
  const missing = COLUMN_RULES.map((rule) => rule.field).filter((field) => !mapped.includes(field))
  return {
    columns: header,
    mapping: header.map((name, index) => ({ column: name, field: mapping[index] || '' })),
    missingFields: missing,
    notes,
  }
}

// ---------------------------------------------------------------------------
// 优先用 Harness 的表格工具（存在就用）
// ---------------------------------------------------------------------------

/**
 * 尝试用 dsh-daily-documents 的 spreadsheet_read 读表（存在才用）
 * @returns {Promise<{ok:boolean, rows?:string[][], error?:string, tool?:string}>}
 */
export async function tryHarnessSpreadsheet(ctx, filePath) {
  try {
    const tools = ctx && ctx.tools
    if (!tools) return { ok: false, error: '主机侧没有 tools 服务' }
    // 不同版本的工具注册表 API 不一样，逐个探测；探测不到就降级
    const registry = typeof tools.get === 'function' ? tools.get('spreadsheet_read') : null
    if (!registry) {
      const list = typeof tools.list === 'function' ? tools.list() : null
      const has = Array.isArray(list) && list.some((t) => t && (t.name === 'spreadsheet_read' || t.id === 'spreadsheet_read'))
      if (!has) return { ok: false, error: '没有安装 spreadsheet_read 工具（dsh-daily-documents）' }
      return { ok: false, error: '检测到表格工具但无法直接调用，请改用文件解析' }
    }
    if (typeof registry.execute === 'function') {
      const result = await registry.execute({ path: filePath, range: 'A1:Z2000' })
      return { ok: true, rows: normalizeToolRows(result), tool: 'spreadsheet_read' }
    }
    return { ok: false, error: '表格工具接口形态不认识，请改用文件解析' }
  } catch (err) {
    return { ok: false, error: `表格工具调用失败：${(err && err.message) || err}` }
  }
}

function normalizeToolRows(result) {
  if (Array.isArray(result)) return result.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)]))
  if (result && Array.isArray(result.rows)) {
    return result.rows.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)]))
  }
  if (result && typeof result.text === 'string') return parseCsv(result.text, result.text.includes('\t') ? '\t' : ',')
  return []
}

// ---------------------------------------------------------------------------
// 对外主函数
// ---------------------------------------------------------------------------

/**
 * 解析一份数据报表
 * @param {string} filePath 主机侧的文件路径
 * @param {object} [options] { ctx }
 * @returns {Promise<{ok:boolean, data?:object, error?:string, method?:string}>}
 */
export async function parseReport(filePath, options = {}) {
  const target = String(filePath || '').trim()
  if (!target) return { ok: false, error: '没有传文件路径' }
  let stat
  try {
    stat = fs.statSync(target)
  } catch (err) {
    return { ok: false, error: `找不到文件：${target}` }
  }
  if (!stat.isFile()) return { ok: false, error: `这不是一个文件：${target}` }

  const ext = path.extname(target).toLowerCase()
  const notes = []

  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') {
    try {
      const text = fs.readFileSync(target, 'utf8')
      const rows = parseCsv(text, ext === '.tsv' ? '\t' : text.includes('\t') && !text.includes(',') ? '\t' : ',')
      const data = rowsToReviewData(rows)
      return { ok: true, data, method: 'CSV 文本解析' }
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) }
    }
  }

  if (ext === '.xls') {
    notes.push('旧版 .xls 二进制格式不支持，请在 Excel / WPS 里"另存为 .xlsx 或 .csv"后再上传')
    return { ok: false, error: notes.join('；') }
  }

  if (ext === '.xlsx' || ext === '.xlsm') {
    // ① 先试 Harness 的表格工具
    if (options.ctx) {
      const viaTool = await tryHarnessSpreadsheet(options.ctx, target)
      if (viaTool.ok && viaTool.rows && viaTool.rows.length) {
        try {
          const data = rowsToReviewData(viaTool.rows)
          return { ok: true, data, method: `Harness 表格工具（${viaTool.tool}）` }
        } catch (err) {
          notes.push(`表格工具读到了数据但列名不匹配：${(err && err.message) || err}`)
        }
      } else if (viaTool.error) {
        notes.push(viaTool.error)
      }
    }
    // ② 自己解析 xlsx
    try {
      const { rows } = readXlsxRows(target)
      const data = rowsToReviewData(rows)
      return { ok: true, data, method: notes.length ? `主机侧 xlsx 解析（表格工具不可用：${notes.join('；')}）` : '主机侧 xlsx 解析' }
    } catch (err) {
      return {
        ok: false,
        error: `解析失败：${(err && err.message) || err}${notes.length ? `（另外：${notes.join('；')}）` : ''}。可以把表格另存为 CSV 再上传。`,
      }
    }
  }

  return { ok: false, error: `不支持的文件类型（${ext || '无扩展名'}），请上传 .xlsx 或 .csv` }
}

/** 生成一份示例 CSV，方便用户照着填 */
export function sampleCsv() {
  const header = ['笔记标题', '阅读量', '点赞量', '收藏量', '评论量', '分享量', '新增关注', '有效评论数', '发布时间']
  const rows = [
    ['示例：OpenAI 发布 GPT-5.2，免费额度翻倍', '12000', '900', '450', '120', '60', '40', '35', '2026-09-10'],
    ['示例：这个开源工具能一键总结长文', '3200', '80', '60', '12', '5', '3', '8', '2026-09-12'],
    ['示例：AI 圈今日三件大事', '8000', '300', '90', '60', '20', '10', '20', '2026-09-14'],
  ]
  return [header, ...rows].map((row) => row.join(',')).join('\n')
}

/**
 * 生成一个最小的 .xlsx 测试报表（不依赖任何第三方库，也用到 Excel）。
 *
 * 用法：node test/make-sample-xlsx.mjs [输出路径]
 * 默认输出：<临时目录>/xmt-report-sample.xlsx
 *
 * xlsx 本质是一个 zip，里面放 [Content_Types].xml + _rels + xl/worksheets/sheet1.xml。
 * 这里手写 zip（含正确 CRC32），用来验证插件自己的 xlsx 解析器。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

/** CRC32 查表 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function zipEntry(name, content) {
  const nameBytes = Buffer.from(name, 'utf8')
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  const compressed = zlib.deflateRawSync(data, { level: 9 })
  return { nameBytes, data, compressed, crc: crc32(data) }
}

function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 flag
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x2100, 12) // date (2026-01-01 左右，随便给个合法值)
    local.writeUInt32LE(file.crc, 14)
    local.writeUInt32LE(file.compressed.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(file.nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, file.nameBytes, file.compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x2100, 14)
    central.writeUInt32LE(file.crc, 16)
    central.writeUInt32LE(file.compressed.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(file.nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, file.nameBytes)
    offset += 30 + file.nameBytes.length + file.compressed.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuffer, eocd])
}

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function colName(index) {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function sheetXml(rows) {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`
          if (value === null || value === undefined || value === '') return `<c r="${ref}"/>`
          if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

export function writeXlsx(target, rows) {
  const files = [
    zipEntry(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    zipEntry(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    zipEntry(
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="数据" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    zipEntry(
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    zipEntry('xl/worksheets/sheet1.xml', sheetXml(rows)),
  ]
  fs.writeFileSync(target, buildZip(files))
  return target
}

/** 示例数据：8 条笔记，含 1 条明显爆款 + 1 条伪爆文，方便看复盘效果 */
export const SAMPLE_ROWS = [
  ['笔记标题', '阅读量', '点赞量', '收藏量', '评论量', '分享量', '新增关注', '有效评论数', '发布时间'],
  ['OpenAI 发布 GPT-5.2，免费额度翻倍', 12000, 900, 450, 120, 60, 40, 90, '2026-09-10'],
  ['这个开源工具能一键总结长文', 3200, 80, 60, 12, 5, 3, 8, '2026-09-12'],
  ['AI 圈今日三件大事', 8000, 300, 90, 60, 20, 10, 30, '2026-09-14'],
  ['小模型本地跑起来了', 3000, 90, 30, 10, 4, 2, 6, '2026-09-14'],
  ['某明星代言 AI 产品冲上热搜', 9000, 500, 100, 200, 80, 20, 10, '2026-09-15'],
  ['关注抽奖送 100 个会员', 8500, 400, 60, 150, 60, 15, 5, '2026-09-16'],
  ['实测：本地跑 7B 模型的真实速度', 3000, 70, 25, 8, 3, 1, 5, '2026-09-16'],
  ['我把常用 AI 工具整理成一张表', 26000, 1500, 900, 200, 100, 50, 150, '2026-09-01'],
]

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('make-sample-xlsx.mjs')) {
  const target = process.argv[2] || path.join(os.tmpdir(), 'xmt-report-sample.xlsx')
  writeXlsx(target, SAMPLE_ROWS)
  console.log(`已生成示例报表：${target}`)
  console.log('可以直接拿去模块7 测试："上传数据报表"里手工填这个路径。')
}

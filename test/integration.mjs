/**
 * 主机侧接口端到端测试（不需要启动 Harness）
 *
 * 做法：用假的 ctx（假的 webServer / llm / agentDefaultModel）加载插件，
 * 起一个真的 HTTP 服务，然后把界面侧会调用的动作全跑一遍。
 * 抓取部分用一个本地假新闻站，验证"真实 HTTP 抓取 + 解析 + 入库"这条链路。
 *
 * 跑法：node test/integration.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const TEMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'xmt-kf-int-'))
process.env.DSH_HOME = TEMP_HOME

let pass = 0
let fail = 0
const failures = []
function check(label, condition, detail = '') {
  if (condition) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    failures.push(`${label}${detail ? ` —— ${detail}` : ''}`)
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}
function section(title) {
  console.log(`\n== ${title} ==`)
}

// ---------------------------------------------------------------------------
// 假新闻站（给抓取用）
// ---------------------------------------------------------------------------

const SITE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>假 AI 资讯站</title></head><body>
<div class="feed">
  <div class="card"><h3><a href="/p/1">OpenAI 把 GPT-5.2 的免费额度翻倍了</a></h3><time datetime="2026-09-17">2026-09-17</time><p>OpenAI 官方博客说，额度从 10 美元涨到 20 美元，覆盖所有个人开发者。</p></div>
  <div class="card"><h3><a href="/p/2">这个开源工具能一键把长文总结成卡片</a></h3><span class="date">2天前</span><p>GitHub 上 3 天涨了 8000 星，作者是个大学生。</p></div>
  <div class="card"><h3><a href="/p/3">英伟达市值又创新高，超过 5 万亿美元</a></h3><p>财报显示数据中心业务同比增长 120%。</p></div>
  <div class="card"><h3><a href="/p/4">国内某团队开源 7B 中文模型，可商用</a></h3><p>权重已放到 Hugging Face，训练用了 2T token。</p></div>
</div></body></html>`

// 详情页正文里刻意放几个数字：模块3 的"高亮数字/总结保留数字"这些检查要有东西可判
const ARTICLE_HTML = (n) => `<!doctype html><html><head><meta charset="utf-8"><meta property="og:title" content="文章 ${n}"><meta property="article:published_time" content="2026-09-17T09:00:00Z"></head><body><article><h1>文章 ${n}</h1><p>${'正文内容第 1 段，共 20 个要点，涨幅 120%。'.repeat(12)}</p></article></body></html>`

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(SITE_HTML)
    return
  }
  // 第二个站：列表页没有日期，详情页也刻意 404 —— 用来验证"识别不出日期标最新"
  if (url === '/nodate') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>没有日期的站</title></head><body>
      <div class="card"><a href="/missing/1">这是一条超过十个字但没有日期的资讯标题</a></div>
      <div class="card"><a href="/missing/2">另一条超过十个字也找不到日期的资讯</a></div>
      <div class="card"><a href="/missing/3">第三条同样没有日期信息的资讯标题</a></div>
    </body></html>`)
    return
  }
  // 第三个站：永远超时/报错 —— 用来验证单个网站失败不影响其他网站
  if (url === '/broken') {
    res.writeHead(500, { 'Content-Type': 'text/html' })
    res.end('boom')
    return
  }
  if (/^\/p\/\d+$/.test(url)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(ARTICLE_HTML(url.slice(3)))
    return
  }
  res.writeHead(404)
  res.end('not found')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const sitePort = server.address().port
const siteUrl = `http://127.0.0.1:${sitePort}`
console.log(`假新闻站已启动：${siteUrl}`)

// ---------------------------------------------------------------------------
// 假的 Harness 上下文
// ---------------------------------------------------------------------------

const routes = []
// 说明：本插件**不调用大模型**，所以这里故意不给 llm 服务 —— 正好验证
// "没有模型适配器也照样能跑"（筛选/文案/排版都是本地规则）。
// 这同时也防止回归：一旦有代码又去调 ctx.llm，这里会直接抛错。

const fakeCtx = {
  get(service) {
    if (service === 'webServer') return fakeCtx.webServer
    if (service === 'connection') return null
    return undefined
  },
  on() {
    return () => {}
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

// 加载插件（走真正的 apply）
const plugin = await import('../lib/index.js')
await plugin.apply(fakeCtx)
check('插件 apply 成功且注册了接口路由', routes.length === 1 && routes[0].path === '/xmt-kf/api')

// 把路由包进一个真 HTTP 服务，模拟浏览器调用
const apiServer = http.createServer((req, res) => {
  const route = routes[0]
  if (route && (req.url || '').startsWith(route.path)) {
    Promise.resolve(route.handler(req, res)).catch((err) => {
      res.statusCode = 500
      res.end(String(err && err.message))
    })
    return
  }
  res.statusCode = 404
  res.end('no route')
})
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))
const apiBase = `http://127.0.0.1:${apiServer.address().port}/xmt-kf/api`

async function call(action, payload) {
  const response = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload: payload || {} }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  if (data.ok === false) throw new Error(data.error || '未知错误')
  return data.data
}
async function callRaw(action, payload) {
  const response = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload: payload || {} }),
  })
  return { status: response.status, data: await response.json() }
}

// ---------------------------------------------------------------------------
section('A) 设置与状态')
{
  const { settings } = await call('settings')
  check('能读到默认设置', !!settings && settings.accountPositioning === 'AI圈资讯')

  // 站点说明：
  //   · 假 AI 资讯站：列表里 4 条，详情页都能读到发布日期 2026-09-17
  //   · 没有日期的站：列表页不给日期、详情页 404 → 按需求这些条目**会被丢掉**
  //   · 抓不到内容的站：永远 500，用来验证"单站失败不影响其他站"
  await call('saveSettings', {
    settings: {
      websites: [
        { name: '假 AI 资讯站', url: siteUrl, difficulty: '普通', selectors: { listSelector: '.card', titleSelector: 'h3 a', linkSelector: 'h3 a', dateSelector: 'time, .date' } },
        { name: '没有日期的站', url: `${siteUrl}/nodate`, difficulty: '普通', selectors: { listSelector: '.card', titleSelector: 'a', linkSelector: 'a', dateSelector: '' } },
        { name: '抓不到内容的站', url: `${siteUrl}/broken`, difficulty: '普通', selectors: {} },
      ],
      // days: 7 让"有日期的站"整批留下来，后面几节（筛选 / 文案 / 排版）才有稳定的数据。
      // 「只留今天」的严格过滤在 B2) 那个小节单独验。
      fetch: { timeoutMs: 3000, retries: 2, minDelayMs: 10, maxDelayMs: 20, maxItemsPerSite: 8, days: 7 },
      accountPositioning: 'AI圈资讯',
      pastViralSamples: ['上次那条"免费额度翻倍"的数据最好'],
    },
  })
  const after = await call('settings')
  check('保存设置生效', after.settings.websites[0].url === siteUrl && after.settings.fetch.retries === 2)

  const status = await call('status')
  check('状态接口能返回本地模式标记（本插件不调大模型）', status.localOnly === true && status.ready === undefined)
  check('状态接口报出数据目录', typeof status.dataDir === 'string' && status.dataDir.length > 0)
  check('状态接口给出了各模块计数', !!status.counts && typeof status.counts.fetched === 'number')
}

// ---------------------------------------------------------------------------
section('B) 模块2 抓取到真实本地站点')
{
  const data = await call('fetch')
  check('抓到 4 条资讯（有日期的站；没日期的 3 条按需求丢掉）', data.total === 4, `实际 ${data.total}`)
  check('按网站分组（只剩有日期的那个站）', data.groups.length === 1, `实际分组 ${data.groups.length}`)
  check('日期识别正确（详情页读到的真实发布时间）', data.items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date)), JSON.stringify(data.items.map((i) => [i.title.slice(0, 8), i.date])))
  check('不再有"最新"这种假日期标注', data.items.every((item) => item.dateLabel !== '最新'))
  check('抓不到的站不影响其他站（其他站照样有结果）', data.failures.length >= 1 && data.items.length >= 4, JSON.stringify(data.failures))
  check('失败项带"手动打开查看"提示', data.failures.every((failure) => /手动打开查看/.test(failure.tip || '')))
  const again = await call('fetch')
  check('第二次抓取仍正常（覆盖缓存）', again.total === data.total)

  const log = await call('load', { what: 'log' })
  check('抓取行为写入了日志', /抓取成功|抓取完成/.test(log.log), log.log.slice(0, 120))
}

// ---------------------------------------------------------------------------
section('B2) 时间过滤：读不到日期 / 超出"最近几天"的条目一律丢掉（本轮修复重点）')
{
  const before = await call('settings')
  await call('saveSettings', {
    settings: Object.assign({}, before.settings, { fetch: Object.assign({}, before.settings.fetch, { days: 1 }) }),
  })
  const strict = await call('fetch')
  // 假站详情页写的是固定日期 2026-09-17（测试环境里是"过去"的日期），
  // 设置只留 1 天时它们应该整批被丢掉 —— 这正是用户报的"选今天却抓出 2 天前的内容"。
  check('"只留今天"时旧日期条目被丢掉（不再兜底保留全站）', strict.total === 0, `实际 ${strict.total}`)
  check('时间过滤写进了日志（丢掉多少条一眼能看到）', /时间过滤/.test((await call('load', { what: 'log' })).log))
  // 换回 7 天，后面几节继续用这批数据
  await call('saveSettings', {
    settings: Object.assign({}, before.settings, { fetch: Object.assign({}, before.settings.fetch, { days: 7 }) }),
  })
  const back = await call('fetch')
  check('放宽到 7 天后条目回来了', back.total === 4, `实际 ${back.total}`)
}

// ---------------------------------------------------------------------------
section('C) 模块1 选题库')
{
  const fetchData = await call('load', { what: 'fetch' })
  const first = fetchData.items[0]
  const saved = await call('saveTopic', { topic: first })
  check('存入选题库成功', saved.added === true)
  const dup = await call('saveTopic', { topic: first })
  check('重复存入被挡住', dup.added === false)
  const topics = await call('load', { what: 'topics' })
  check('选题库能读回来', topics.total === 1 && topics.topics[0].title === first.title)
  await call('deleteTopic', { id: topics.topics[0].id })
  const empty = await call('load', { what: 'topics' })
  check('删除生效', empty.total === 0)
}

// ---------------------------------------------------------------------------
section('D) 模块3 筛选（本地规则，硬规则：6 项标准勾中 ≥ 1 项进候选）')
{
  const data = await call('filter')
  check('筛出 4 条候选（勾中 1 项就进候选，本轮修复后正文能抽到，第 4 条也够了）', data.candidates.length === 4, `实际 ${data.candidates.length}`)
  check('每条候选都勾中 ≥ 1 项（硬规则）', data.candidates.every((item) => item.checksCount >= 1), JSON.stringify(data.candidates.map((c) => [c.title.slice(0, 10), c.checksCount])))
  check('明确标注是本地规则判定', data.local === true && /本地规则/.test(data.note || ''))
  check('每条候选都有勾选项与理由', data.candidates.every((item) => item.checkList.length === 6 && item.checkList.some((c) => c.checked && c.reason)))
  check('候选带高亮分段（数字/人名）', data.candidates.every((item) => Array.isArray(item.summarySegments) && item.summarySegments.length > 0))
  check('高亮里确实有命中的数字', data.candidates.some((item) => item.summarySegments.some((seg) => seg.highlight)))
  check('总结里保留了原文数字（正文不再抽成空）', data.candidates.some((item) => /\d/.test(item.summary)))
  check('候选正文不是空摘要', data.candidates.every((item) => item.summary && item.summary.length >= 20), JSON.stringify(data.candidates.map((c) => c.summary.slice(0, 20))))
  check('淘汰的条目写了原因', Array.isArray(data.rejected) && data.rejected.every((item) => item.title && item.reason))

  const beforeConfirm = await callRaw('writeCopy', {})
  check('没核实就写文案会被挡住', beforeConfirm.data.ok === false && /核实/.test(beforeConfirm.data.error), beforeConfirm.data.error)
  // 一、日期标注不再出现"最新"这种假日期
  check('候选里的日期是真实发布日期（读不到时写"原文未标注日期"）', data.candidates.every((item) => item.date === '原文未标注日期' || /^\d{4}-\d{2}-\d{2}/.test(item.date)), JSON.stringify(data.candidates.map((c) => c.date)))
  // 二、一条一条「核实通过」（界面就是这么调的：每次只带一个 id）
  const confirmOne = await call('confirm', { ids: [data.candidates[0].id] })
  check('一条一条核实通过生效', confirmOne.confirmed === 1, `实际 ${confirmOne.confirmed}`)
  // 三、核实通过之后，扫源抓取那个"本次有效"的数字要跟着减（用户报的第 10 个问题）
  const statusAfterConfirm = await call('status')
  check('核实通过后「扫源抓取」的待处理条数跟着减（本次有效 −1）', statusAfterConfirm.counts.fetchedPending === 3, `实际 ${statusAfterConfirm.counts.fetchedPending}`)
  check('「扫源抓取」待处理数 ≤ 抓到的总数', statusAfterConfirm.counts.fetchedPending < statusAfterConfirm.counts.fetched, `${statusAfterConfirm.counts.fetchedPending} / ${statusAfterConfirm.counts.fetched}`)
  // 四、存进选题库之后同样要扣（也是用户报的问题）
  const fetchForSave = await call('load', { what: 'fetch' })
  await call('saveTopic', { topic: fetchForSave.items[1] })
  const statusAfterSave = await call('status')
  check('存进选题库后「扫源抓取」的待处理条数也扣掉了', statusAfterSave.counts.fetchedPending === 2, `实际 ${statusAfterSave.counts.fetchedPending}`)
  await call('deleteTopic', { id: (await call('load', { what: 'topics' })).topics[0].id })
  // 后面几节需要 4 条都进"已核实"状态
  const rest = (await call('load', { what: 'candidates' })).candidates.filter((item) => !item.confirmed).map((item) => item.id)
  const confirmed = await call('confirm', { ids: rest })
  check('其余条目也一条条核实通过', confirmed.confirmed === 4, `实际 ${confirmed.confirmed}`)
}

// ---------------------------------------------------------------------------
section('E) 模块4 写文案（原文原封不动搬进来，一个字不改）')
{
  const data = await call('writeCopy', {})
  check('每篇一个标题（原文标题原样搬过来，不多写 5 个）', data.copies.every((copy) => copy.titles.length === 1 && copy.titles[0] === copy.sourceTitle))
  check('正文就是原文正文（不是本地生成的）', data.copies.every((copy) => copy.body === copy.bodyAfterDeAi))
  check('去 AI 味生效（正文里的"值得注意的是"被换掉）', data.copies.every((copy) => !String(copy.bodyAfterDeAi).includes('值得注意的是')), String(data.copies[0].bodyAfterDeAi).slice(0, 80))
  check('检查清单 6 项齐全', data.copies.every((copy) => copy.checklist.length === 6))
  check('检查清单逐项打勾', data.copies.every((copy) => copy.checklist.every((item) => typeof item.pass === 'boolean' && item.reason)))
  check('标注了"原文原封不动粘贴"（没走大模型）', data.local === true && data.llm === false && data.copies.every((copy) => copy.generatedBy === '原文原封不动粘贴'), JSON.stringify(data.copies.map((c) => c.generatedBy)))
  check('每篇都带原文链接（返回列表里能看到）', data.copies.every((copy) => !!copy.sourceLink))
  check('正文保留了原文里的数字（逐篇都能对上原文）', data.copies.every((copy) => /\d/.test(copy.bodyAfterDeAi || copy.body)), JSON.stringify(data.copies.map((c) => String(c.bodyAfterDeAi).slice(0, 60))))
  // 按需求：只有点过「保存」的帖子才进「⑤ 做图排版」，这里先保存一条
  const firstCopy = (await call('load', { what: 'copies' })).copies[0]
  const savedOne = await call('updateCopy', { id: firstCopy.id, title: firstCopy.titles[0], body: firstCopy.body })
  const savedList = (await call('load', { what: 'copies' })).copies
  check('点「保存」后这条被打上 savedByUser（做图排版的唯一数据源）', savedList.find((copy) => copy.id === firstCopy.id).savedByUser === true, JSON.stringify(savedOne.copies.map((c) => [c.id.slice(0, 8), !!c.savedByUser])))
}

// ---------------------------------------------------------------------------
section('F) 模块5 封面标签（模板文件夹，不调模型）')
{
  const data = await call('layout', {})
  check('只给"保存过"的帖子做图（没保存的不进来）', data.layoutItems.length === 1, `实际 ${data.layoutItems.length}`)
  check('每条都带标题 + 正文（界面只是展示，不画进图片）', data.layoutItems.every((item) => !!item.title && !!item.body))
  check('返回里明确写了"纯本地、不调大模型"', data.local === true && data.llm === false && /不调用任何大模型/.test(data.note || ''), data.note)
  check('还没选模板时 template.file 是空的', data.template && data.template.file === '', JSON.stringify(data.template))

  // 主机侧给出模板文件夹（默认就是插件自己的 assets/templates）
  const listed = await call('listTemplates', {})
  check('给得出模板文件夹路径', typeof listed.dir === 'string' && listed.dir.includes('templates'), listed.dir)
  check('默认用插件自带的 assets/templates（跟插件在一起，好找）', /assets[\\/]templates$/.test(listed.dir), listed.dir)
  const dirOnDisk = listed.dir
  check('模板文件夹会被自动创建（用户找得到该往哪放）', fs.existsSync(dirOnDisk))
  // ⚠ 这里**不能**断言"清单是空的"：这个文件夹就是用户平时放模板的地方，
  //    里面很可能已经有他自己的模板图（以前就因为这条误报失败过）。只断言返回的是个数组。
  check('清单返回一个数组（空文件夹时就是空数组）', Array.isArray(listed.templates), JSON.stringify(listed.templates))

  // 用户往文件夹里放两张图（一张 1×1 PNG、一张假 jpg），界面就该列出两张
  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
  fs.writeFileSync(path.join(dirOnDisk, 'tpl-a.png'), onePixelPng)
  fs.writeFileSync(path.join(dirOnDisk, 'tpl-b.jpg'), Buffer.from('ffd8ffe000104a464946', 'hex'))
  fs.writeFileSync(path.join(dirOnDisk, 'readme.txt'), '不是图片，不该出现在清单里')
  const listed2 = await call('listTemplates', {})
  // 同上：只断言"我们放进去的两张被列出来了、非图片被忽略"，不断言总数
  const names2 = listed2.templates.map((t) => t.file)
  check('文件夹里的图片都被列出来了（非图片被忽略）', names2.includes('tpl-a.png') && names2.includes('tpl-b.jpg') && !names2.includes('readme.txt'), JSON.stringify(names2))

  // 点哪张用哪张：useTemplate 会把文件名写进配置，并读出宽高
  const used = await call('useTemplate', { file: 'tpl-a.png' })
  check('应用模板成功并写入配置', used.template.file === 'tpl-a.png', JSON.stringify(used.template))
  check('顺手读出了图片宽高（1×1 的 PNG）', used.template.width === 1 && used.template.height === 1, `${used.template.width}×${used.template.height}`)
  check('应用之后 template.exists 为 true', used.template.exists === true)
  const switched = await call('useTemplate', { file: 'tpl-b.jpg' })
  check('可以切到另一张模板', switched.template.file === 'tpl-b.jpg', JSON.stringify(switched.template))

  // 模板原图能按名字取回来（界面 Canvas 的底图）
  const imageRes = await fetch(`${apiBase}?action=templateImage&file=${encodeURIComponent('tpl-a.png')}`)
  check('模板原图能按名字取回来（GET templateImage）', imageRes.ok && /image\/png/.test(imageRes.headers.get('content-type') || ''), `${imageRes.status} ${imageRes.headers.get('content-type')}`)
  const badRes = await fetch(`${apiBase}?action=templateImage&file=${encodeURIComponent('../package.json')}`)
  check('模板文件名不许带路径（挡路径穿越）', badRes.status === 400 || badRes.status === 404, String(badRes.status))
  const badUse = await callRaw('useTemplate', { file: '../package.json' })
  check('应用不存在的模板会被挡住（且带路径的也不许）', badUse.data.ok === false)
  const missing = await callRaw('useTemplate', { file: 'nope.png' })
  check('文件夹里没有这张时给友好提示', missing.data.ok === false && /不存在/.test(missing.data.error), missing.data.error)

  // 打开模板文件夹：真的去唤起资源管理器（测试环境能不能起来另说，接口不能报错、必须回真实路径）
  const opened = await call('openTemplateFolder', {})
  check('打开模板文件夹会回一个真实存在的路径', typeof opened.dir === 'string' && fs.existsSync(opened.dir), JSON.stringify(opened))
  check('打不开时会把原因写清楚（而不是静默什么都不发生）', opened.opened === true || (typeof opened.error === 'string' && opened.error.length > 0), JSON.stringify({ opened: opened.opened, error: opened.error }))

  // 再进一次封面标签：模板信息 + 帖子列表都跟着回来
  const again = await call('layout', {})
  check('刷新时把模板信息一起带回界面', again.template.file === 'tpl-b.jpg' && again.template.exists === true, JSON.stringify(again.template))
  check('刷新时可以做图的帖子也在', again.layoutItems.length === 1)

  // ⚠ 收尾：这个文件夹是用户真实在用的，测试造的文件必须自己清掉，
  //    否则会以"坏缩略图"的样子出现在用户的模板选择里（以前就留过垃圾）。
  for (const name of ['tpl-a.png', 'tpl-b.jpg', 'readme.txt']) {
    try {
      fs.unlinkSync(path.join(dirOnDisk, name))
    } catch (err) {
      /* 本来就不在就算了 */
    }
  }
}
// ---------------------------------------------------------------------------
section('G) 持久化与防崩')
{
  const settingsFile = path.join(TEMP_HOME, 'ai-news-workbench', 'settings.json')
  const topicFile = path.join(TEMP_HOME, 'ai-news-workbench', 'topic-library.json')
  check('设置落盘成 JSON', fs.existsSync(settingsFile))
  check('选题库文件存在', fs.existsSync(topicFile))
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  check('落盘的设置内容正确', saved.websites[0].url === siteUrl)

  // 故意让 apply 抛错：webServer.register 抛异常
  const brokenCtx = Object.assign({}, fakeCtx, {
    webServer: {
      register() {
        throw new Error('故意炸一下')
      },
    },
  })
  let threw = false
  try {
    await plugin.apply(brokenCtx)
  } catch (err) {
    threw = true
  }
  check('接口注册失败时 apply 不往外抛错（Harness 仍能启动）', threw === false)

  // 坏掉的 JSON 文件不能让插件崩
  fs.writeFileSync(path.join(TEMP_HOME, 'ai-news-workbench', 'settings.json'), '{ 这不是 JSON')
  const recovered = await call('settings')
  check('数据文件损坏时自动回落到默认值', !!recovered.settings && recovered.settings.accountIp === undefined && !!recovered.settings.accountPositioning)

  const storage = await call('storage')
  check('能报出各数据文件位置', storage.info.files.length >= 6 && storage.dir.includes('ai-news-workbench'))
}

// ---------------------------------------------------------------------------
server.close()
apiServer.close()
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
if (fail) {
  console.log('失败明细：')
  for (const line of failures) console.log(`  - ${line}`)
}
console.log(`（测试数据目录：${TEMP_HOME}）`)
process.exit(fail ? 1 : 0)

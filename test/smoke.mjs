/**
 * 主机侧冒烟测试（不需要启动 Harness）
 *
 * 跑法：
 *   node test/smoke.mjs
 *   node test/smoke.mjs "C:\某个\真实的报表.xlsx"     # 顺带验证 xlsx 解析
 *
 * 验证内容：
 *  1) 存储层读写（设置 / 选题库 / 抓取缓存 / 状态）
 *  2) 列表页解析（配置选择器 / article 降级 / 兜底扫描）+ 日期识别
 *  3) 复盘引擎（指标 / 爆款判定 / 伪爆文剔除 / 改词建议）
 *  4) 提示词硬规则（违禁词扫描 / 检查清单打勾 / 去 AI 味）
 *  5) Excel/CSV 解析
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 数据目录指向临时目录，绝不动用户的真实数据
const TEMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'xmt-kf-test-'))
process.env.DSH_HOME = TEMP_HOME

const store = await import('../lib/store.js')
const { parseList, detectDate, normalizeDate, cleanTitle, resolveUrl, decodeEntities, queryAll } = await import('../lib/crawl.js')
const { judgeCopy, scanBanned, highlightFacts, countChecks, ensureAiLabel, deAiTells, runComplianceCheck } = await import('../lib/rules.js')
const { selectCandidates, judgeItem } = await import('../lib/filter.js')
const { generateCopies, generateLayouts, buildTitles, buildTags, extractEntities, splitSentences } = await import('../lib/generate.js')
const { parseCsv, rowsToReviewData, parseReport } = await import('../lib/xlsx.js')

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
section('1) 存储层')
{
  const settings = store.loadSettings()
  check('默认设置有网站清单', Array.isArray(settings.websites) && settings.websites.length >= 2)
  check('默认抓取配置：超时 10 秒 / 重试 3 次', settings.fetch.timeoutMs === 10000 && settings.fetch.retries === 3)

  const saved = store.saveSettings({ accountPositioning: 'AI工具测评', personaDescription: '直给，不客套' })
  check('保存设置后再读能读到', store.loadSettings().accountPositioning === 'AI工具测评')
  check('保存设置不会丢掉其他字段', saved.websites.length >= 2)

  const first = store.saveTopic({ title: '量子位：某模型发布', source: '量子位', link: 'https://example.com/a', date: '2026-09-17' })
  check('存入选题库', first.added === true && first.total === 1)
  const dup = store.saveTopic({ title: '量子位：某模型发布', source: '量子位', link: 'https://example.com/a' })
  check('同链接不会重复存', dup.added === false && dup.total === 1)
  check('读选题库', store.loadTopics().length === 1)
  const removed = store.deleteTopic(store.loadTopics()[0].id)
  check('删除选题', removed.removed === 1 && store.loadTopics().length === 0)

  store.saveStatus({ module2: '完成' })
  check('状态能存能读', store.loadStatus().module2 === '完成' && store.loadStatus().module3 === '等待模块2')
  store.appendLog('测试日志一行')
  check('日志能写能读', store.tailLog(10).includes('测试日志一行'))
  check('文件不存在时用默认结构（不抛错）', store.loadFetchCache().items.length === 0)
}

// ---------------------------------------------------------------------------
section('2) 列表页解析')
{
  const html = `
  <html><head><meta property="article:published_time" content="2026-09-17T08:00:00Z"></head>
  <body>
    <div class="post-list">
      <div class="post-item"><a class="title" href="/p/1">OpenAI 发布 GPT-5.2，免费额度翻倍</a><time datetime="2026-09-17">2026-09-17</time></div>
      <div class="post-item"><a class="title" href="https://example.com/p/2">开源神器：一个命令总结长文</a><span class="date">3小时前</span></div>
      <div class="post-item"><a class="title" href="/p/3">英伟达市值又创新高</a></div>
    </div>
    <article><a href="/p/4">这是一篇用 article 标签包着的文章标题</a></article>
    <nav><a href="/tag/ai">AI</a></nav>
  </body></html>`

  // 用户规则抓到的条数 < min(5, limit) 时会被忽略 → 这里把 limit 设成 3 以便观察规则本身的效果
  const items = parseList(html, 'https://example.com/blog', {
    listSelector: '.post-item',
    titleSelector: '.title',
    linkSelector: 'a',
    dateSelector: 'time, .date',
  }, 3)
  check('配置选择器能抓到条目', items.length === 3, `实际 ${items.length}`)
  check('相对链接补成绝对链接', items[0] && items[0].link === 'https://example.com/p/1', items[0] && items[0].link)
  check('日期识别出 2026-09-17', items[0] && items[0].date === '2026-09-17', items[0] && items[0].date)
  check('"3小时前"能换算成日期', items[1] && /^\d{4}-\d{2}-\d{2}$/.test(items[1].date), items[1] && items[1].date)

  const fallback = parseList('<html><body><article><a href="/x/1">这是一条超过十个字的文章标题啦</a></article><article><a href="/x/2">第二条超过十个字的标题在这里</a></article><article><a href="/x/3">第三条超过十个字的标题在这里</a></article></body></html>', 'https://example.com', {}, 3)
  check('选择器抓不到时降级到 <article>', fallback.length === 3 && fallback[0].from === 'article 标签', JSON.stringify(fallback[0] || {}))

  // 不再"无脑扫全页长链接"：只有零散链接时宁可返回空
  const bottom = parseList('<html><body><div><a href="/y/1">页面上文字超过十个字的链接会被兜底扫到</a></div><div><a href="/tag/x">标签页</a></div><a href="/y/2">很短</a></body></html>', 'https://example.com', {}, 8)
  check('零散长链接不再兜底抓取（宁可少抓也不抓垃圾）', bottom.length === 0, JSON.stringify(bottom))
  check('标题超过 50 字直接截断加"……"（列表里绝不允许出现大段摘要）', (() => {
    const long = 'OpenAI在旧金山正式发布了新一代多模态推理模型并同步开放了免费额度' + '同时还宣布与多家云厂商合作把这套模型的推理成本压到原来的三分之一'
    const parsed = parseList(`<html><body><div class="post"><a href="/z/1">${long}</a></div><a href="/z/2">另一条也超过十个字的标题</a></body></html>`, 'https://example.com', { listSelector: '.post', linkSelector: 'a' }, 1)
    return parsed.length === 1 && parsed[0].title.length <= 52 && parsed[0].title.endsWith('……')
  })())
  check('标题被站点重复拼两遍时（"标题 标题+摘要"）只保留一份', (() => {
    const dup = '千问APP升级未成年人保护模式 千问APP升级未成年人保护模式，保留拍照答疑等功能'
    const parsed = parseList(`<html><body><div class="post"><a href="/z/9">${dup}</a></div><a href="/z/8">另一条超过十个字的标题在这</a></body></html>`, 'https://example.com', { listSelector: '.post', linkSelector: 'a' }, 1)
    return parsed.length === 1 && parsed[0].title === '千问APP升级未成年人保护模式'
  })())
  check('成段的摘要/正文（带句末标点）不当作标题', parseList('<html><body><div><a href="/y/3">这段其实是一整段正文摘要，里面有句号。还有第二句内容，而且后面还接着写了很多细节，长度早就超过标题该有的样子了，不应该被当成标题抓进列表里来。再加上一些补充说明：作者、发布时间、来源、标签、栏目、专题、相关推荐等等，都在这段文字里。</a></div></body></html>', 'https://example.com', {}, 5).length === 0)
  check('cleanTitle 会把标题收成一行并去掉首尾装饰符', cleanTitle('  -  OpenAI 发布新模型  ') === 'OpenAI 发布新模型', cleanTitle('  -  OpenAI 发布新模型  '))

  // 按需求已取消"标题黑名单"：页脚/备案这类文字不再靠关键词过滤，
  // 改为靠"打分挑真正像文章列表的那一块 + 链接结构一致 + 跳过导航容器"来排除
  check('标题黑名单已取消（备案、Hugging Face 这类标题不再被关键词丢弃）', cleanTitle('粤ICP备12345678号') === '粤ICP备12345678号' && cleanTitle('Hugging Face Blog') === 'Hugging Face Blog')
  check('导航菜单不会被当成文章列表（跳过导航容器、挑链接结构一致的那块）', (() => {
    const page = `<html><body>
      <nav class="nav-menu"><ul>
        <li><a href="/">首页</a></li><li><a href="/tool">腾讯音乐人AI Studio音创计划</a></li>
        <li><a href="/a">Hugging Face 模型广场入口</a></li><li><a href="/b">DeepSeek V4 Pro 在线体验</a></li>
        <li><a href="/c">Gemini 3.5 Pro 最新消息</a></li><li><a href="/d">千问Qwen-Image-3.0图像模型</a></li>
      </ul></nav>
      <div class="news-list">
        <div class="item"><a href="/news/1">OpenAI 发布新一代多模态推理模型</a><span class="time">2026-09-17</span></div>
        <div class="item"><a href="/news/2">英伟达市值再创新高逼近五万亿</a><span class="time">2026-09-17</span></div>
        <div class="item"><a href="/news/3">开源神器：一个命令总结长文</a><span class="time">2026-09-16</span></div>
        <div class="item"><a href="/news/4">本地跑 7B 模型的真实速度实测</a><span class="time">2026-09-16</span></div>
        <div class="item"><a href="/news/5">AI 圈今日三件大事盘点</a><span class="time">2026-09-15</span></div>
        <div class="item"><a href="/news/6">某公司发布新一代语音合成模型</a><span class="time">2026-09-15</span></div>
      </div></body></html>`
    const parsed = parseList(page, 'https://example.com', {}, 8)
    return parsed.length >= 5 && parsed.every((it) => it.link.includes('/news/')) && parsed[0].link === 'https://example.com/news/1'
  })())

  // 量子位那种"配置的是列表容器（div.article_list）"的情况：必须遍历容器里的重复子块，而不是只抓外层
  check('listSelector 指的是列表容器时，逐个遍历它的子块（不是把容器当一篇文章）', (() => {
    const blocks = Array.from({ length: 8 }, (_, i) => `<div class="picture_text"><div class="picture"><a href="/2026/09/${i + 1}.html"><img src="${i}.png"></a></div><h4><a href="/2026/09/${i + 1}.html">第 ${i + 1} 条资讯标题超过十个字啦</a></h4><span class="time">2026-09-1${i % 9}</span></div>`).join('')
    const qbit = `<html><body><div class="article_list">${blocks}</div></body></html>`
    const parsed = parseList(qbit, 'https://www.qbitai.com', { listSelector: 'div.article_list' }, 12)
    return parsed.length === 8 && parsed[0].link === 'https://www.qbitai.com/2026/09/1.html' && parsed[7].link === 'https://www.qbitai.com/2026/09/8.html'
  })())
  check('用户规则抓不够 5 条时自动忽略该规则（示例：写死了错误选择器）', (() => {
    const page = `<html><body><div class="news-list">
      <div class="item"><a href="/n/1">第一条标题超过十个字的信息</a></div>
      <div class="item"><a href="/n/2">第二条标题超过十个字的信息</a></div>
      <div class="item"><a href="/n/3">第三条标题超过十个字的信息</a></div>
      <div class="item"><a href="/n/4">第四条标题超过十个字的信息</a></div>
      <div class="item"><a href="/n/5">第五条标题超过十个字的信息</a></div>
      <div class="item"><a href="/n/6">第六条标题超过十个字的信息</a></div>
    </div></body></html>`
    const wrong = parseList(page, 'https://example.com', { listSelector: '.不存在的容器', linkSelector: 'a' }, 12)
    const good = parseList(page, 'https://example.com', {}, 12)
    return wrong.length >= 5 && good.length >= 5
  })())

  check('meta 日期优先识别', detectDate(html) === '2026-09-17')
  check('识别不出日期返回空串（界面显示"最新"）', detectDate('<html><body>没有日期</body></html>') === '')
  check('日期归一化：中文写法', normalizeDate('2026年9月17日') === '2026-09-17')

  // 日期解析加固（本轮 bug：日期全是"最新"，其实站点上都写着）
  check('normalizeDate 只传一个参数时仍然只返回日期（兼容老用法）', normalizeDate('2026-09-17 14:07:33') === '2026-09-17')
  check('normalizeDate 打开 withTime 后带时分', normalizeDate('2026-09-17 14:07:33', true) === '2026-09-17 14:07')
  check('中文"号"+"时:分"也认（aibase 的写法）', normalizeDate('2026年9月17号 14:07', true) === '2026-09-17 14:07')
  check('ISO 带时区也认（<time datetime> / meta 的写法）', normalizeDate('2026-09-17T14:07:33+08:00', true) === '2026-09-17 14:07')
  check('读不到时分就只返回日期（不硬编 00:00）', normalizeDate('2026年9月17号', true) === '2026-09-17')
  check(
    '中文标签定位："发布时间 : 2026年9月17号 14:07"（aibase 的写法）能读到日期',
    detectDate('<div class="flex"><i class="iconfont"></i><span>发布时间 :</span><span>2026年9月17号 14:07</span></div>') === '2026-09-17',
  )
  check(
    '图片里带的"Generator: Adobe Illustrator 2029.2.1"不会被当成发布日期',
    detectDate('<img src="data:image/svg+xml;utf8,%3c!--%20Generator:%20Adobe%20Illustrator%202029.2.1,%20SVG%20Export%20Plug-In%20.%20SVG%20Version:%202.0" /><p>正文没有日期</p>') === '',
  )
  check(
    '站点写法一：<span class="date">2026-09-17</span>（量子位详情页）',
    detectDate('<div class="author"><span class="date">2026-09-17</span></div>', '', false) === '2026-09-17',
  )
  check(
    '站点写法二：meta og:release_date（AItop100 详情页）',
    detectDate('<html><head><meta property="og:release_date" content="2026-09-17T17:46:26+08:00"></head><body></body></html>') === '2026-09-17',
  )
  check(
    '站点写法三：content 写在 property 前面的 meta 也要认',
    detectDate('<html><head><meta content="2026-09-17T08:00:00Z" property="article:published_time"></head></html>') === '2026-09-17',
  )
  check(
    '站点写法四：只有正文里写着日期时的兜底（不标"最新"）',
    detectDate('<html><body><div class="art"><p>发布时间：2026-09-17 14:07</p></div></body></html>') === '2026-09-17',
  )
  check('兜底扫描不会把 URL / 图片名里的数字当日期', detectDate('<html><body><a href="https://x.com/2026/09/491091.html">标题超过十个字的一条链接</a><img src="/uploads/2026/09/583fe8525bb150bb.png"></body></html>') === '')
  check(
    '列表项里只在自己这块找日期（不开全文兜底，免得串到别的文章）',
    detectDate('<div class="post"><a href="/p/1">标题</a></div>', '', false) === '' &&
      detectDate('<div class="post"><a href="/p/1">标题</a><span class="date">2026-09-17</span></div>', '', false) === '2026-09-17',
  )

  check('实体解码', decodeEntities('A&amp;B &lt;tag&gt; &#x4e2d;') === 'A&B <tag> 中')
  check('相对地址解析', resolveUrl('/a/b', 'https://x.com/c/') === 'https://x.com/a/b')
  check('选择器支持后代写法', queryAll('<div class="a"><span class="b">x</span></div>', '.a .b', 0).length === 1)
}

// ---------------------------------------------------------------------------
section('4) 硬规则（违禁词 / 检查清单 / 去 AI 味 / 合规）')
{
  const banner = 'OpenAI 发布 GPT-5.2，免费额度翻倍，我试了下真的免费，你用的是哪个版本？'
  const copy = {
    titles: ['OpenAI 把 GPT-5.2 的免费额度翻倍了', '我试了下 GPT-5.2 免费额度', '免费额度翻倍这件事', 'GPT-5.2 上线', '说说 GPT-5.2'],
    body: banner,
    tags: ['AI', 'GPT5', '免费工具'],
    aiChecklist: [],
  }
  const judged = judgeCopy(copy)
  check('检查清单 6 项齐全', judged.checklist.length === 6)
  check('正常文案全部通过', judged.allPass, JSON.stringify(judged.checklist.filter((i) => !i.pass)))
  check('"我"的视角能被识别', judged.checklist.find((i) => i.key === 'firstPerson').pass === true)

  const bad = judgeCopy({ titles: ['震惊！史上最强的免费神器'], body: '赶紧求关注，互关互赞，加微信免费领资料。', tags: ['a'], aiChecklist: [] })
  check('夸张标题被判不通过', bad.checklist.find((i) => i.key === 'titleCalm').pass === false)
  check('诱导互动/营销词被判不通过', bad.checklist.find((i) => i.key === 'noSensitive').pass === false)
  check('标签数量不合规被判不通过', bad.checklist.find((i) => i.key === 'tagsExact').pass === false)
  check('整体不通过', bad.allPass === false)

  const scanned = scanBanned('全网最好的产品，求点赞，加微信，稳赚不赔')
  check('违禁词分类命中：绝对化', scanned.hasAbsolute === true)
  check('违禁词分类命中：诱导互动', scanned.hasInduce === true)
  check('违禁词分类命中：金融承诺', scanned.hasMedicalFinance === true)
  check('干净文本不误报绝对化', scanBanned('OpenAI 发布了 GPT-5.2').hasAbsolute === false)

  const before = '值得注意的是，综上所述，这个工具极大地提升了效率。'
  const after = deAiTells(before)
  check('去 AI 味：套话被替换', !after.includes('值得注意的是') && !after.includes('综上所述') && !after.includes('极大地'), after)

  const segments = highlightFacts('OpenAI 发布了 GPT-5.2，免费额度从 10 美元涨到 20 美元')
  check('数字/人名能高亮出分段', segments.some((s) => s.highlight === true))
  check('高亮分段拼回去等于原文', segments.map((s) => s.text).join('') === 'OpenAI 发布了 GPT-5.2，免费额度从 10 美元涨到 20 美元')

  check('勾选计数正确', countChecks({ bigTech: true, infoGap: true, weird: false }) === 2)
  check('AI 标注能自动补上', ensureAiLabel('正文').includes('AI 辅助'))
  check('已有 AI 标注不重复加', ensureAiLabel('（本文由 AI 辅助整理）').match(/AI 辅助/g).length === 1)

  const compliance = runComplianceCheck('全网最好的工具，求点赞\n（本文由 AI 辅助整理）')
  check('合规检查：AI 标注项通过', compliance.find((item) => item.key === 'aiLabel').pass === true)
  check('合规检查：绝对化用语被抓出来', compliance.find((item) => item.key === 'noAbsolute').pass === false)
  check('合规检查：诱导互动被抓出来', compliance.find((item) => item.key === 'noInduce').pass === false)
}

// ---------------------------------------------------------------------------
section('5) 本地筛选与本地生成（不调大模型）')
{
  const settings = store.loadSettings()
  const items = [
    {
      title: 'OpenAI 把 GPT-5.2 的免费额度翻倍了',
      link: 'https://example.com/a',
      source: '假站',
      dateLabel: '2026-09-17',
      description: 'OpenAI 官方博客说，额度从 10 美元涨到 20 美元，覆盖所有个人开发者，开源权重也放出来了。',
      bodyText: 'OpenAI 官方博客说，额度从 10 美元涨到 20 美元，覆盖所有个人开发者。'.repeat(3),
    },
    {
      title: '一条很平的新闻',
      link: 'https://example.com/b',
      source: '假站',
      description: '某公司开了个会。',
      bodyText: '某公司开了个会。',
    },
    {
      title: '英伟达市值又创新高，超过 5 万亿美元',
      link: 'https://example.com/c',
      source: '假站',
      dateLabel: '最新',
      description: '财报显示数据中心业务同比增长 120%，市值超过 5 万亿美元。',
      bodyText: '财报显示数据中心业务同比增长 120%。'.repeat(2),
    },
  ]

  const judge = judgeItem(items[0])
  check('本地判定：大厂发布勾上了', judge.checks.bigTech === true)
  check('本地判定：免费/降价勾上了', judge.checks.freeOrCheap === true)
  check('本地判定：给了每项理由', Object.keys(judge.reasons).length === 6 && judge.reasons.bigTech.length > 0)
  check('本地判定：算出具体信息数量', judge.facts > 0, String(judge.facts))

  const picked = selectCandidates(items, settings, 3)
  check('筛选：至少挑出 2 条候选', picked.candidates.length >= 2, JSON.stringify(picked.candidates.map((c) => c.title)))
  check('筛选：把太平的淘汰了', picked.rejected.some((item) => item.title.includes('很平')))
  check('筛选：候选每条的勾中项 ≥ 2', picked.candidates.every((item) => countChecks(item.checks) >= 2))
  check('筛选：总结里保留了原文数字', picked.candidates.some((item) => /\d/.test(item.summary)))
  // 本轮修复：候选的日期就是**详情页读到的真实发布日期**，
  // 界面不再出现「最新」那种假日期（读不到时统一写"原文未标注日期"，而且抓取阶段就会丢掉）
  check('筛选：候选日期不再是"最新"（用真实发布日期，读不到写"原文未标注日期"）', picked.candidates.every((item) => item.date !== '最新' && !!item.date), JSON.stringify(picked.candidates.map((c) => c.date)))
  // 本轮修复：正文抽得出来时摘要不能是空的那句兜底话
  check('筛选：正文抽得到时不会出现"原文没有摘要"', picked.candidates.every((item) => item.summary !== '原文没有摘要，细节请点链接看。'), JSON.stringify(picked.candidates.map((c) => c.summary.slice(0, 20))))

  const copies = generateCopies(picked.candidates, settings)
  check('生成文案：每篇 5 个标题', copies.length > 0 && copies.every((copy) => copy.titles.length === 5))
  check('生成文案：每篇 3~5 个标签', copies.every((copy) => copy.tags.length >= 3 && copy.tags.length <= 5))
  check('生成文案：正文有"我"的视角', copies.every((copy) => copy.body.includes('我')))
  check('生成文案：过去了 AI 套话', copies.every((copy) => !copy.bodyAfterDeAi.includes('值得注意的是')))
  check('生成文案：逐项检查清单齐全', copies.every((copy) => copy.checklist.length === 6))
  // 说明：generateCopies 是"本地规则生成"那条老链路（模块4 现在搬原文、不调它了），
  // 它的 generatedBy 字样一直是「本地规则生成（待润色）」，这里跟着实际值断言。
  check('生成文案：标了"本地规则生成"', copies.every((copy) => /本地规则生成/.test(copy.generatedBy)), JSON.stringify(copies.map((c) => c.generatedBy)))
  check('生成文案：正文提到了原文链接', copies.every((copy) => String(copy.body).includes('http')))

  const layouts = generateLayouts(copies)
  check('排版：每篇都有封面大字', layouts.every((layout) => !!layout.cover.bigTitle))
  check('排版：每篇 3~5 张卡片', layouts.every((layout) => layout.cards.length >= 3 && layout.cards.length <= 5))
  check('排版：带 Canva 建议', layouts.every((layout) => layout.canvaAdvice.length > 0))


  check('小工具：拆句', splitSentences('第一句。第二句！第三句？').length === 3)
  check('小工具：抽实体', extractEntities('OpenAI 发布了 GPT-5.2，免费额度 20 美元').length >= 2, JSON.stringify(extractEntities('OpenAI 发布了 GPT-5.2，免费额度 20 美元')))
  check('小工具：标题候选里有原文实体', buildTitles(picked.candidates[0]).titles.some((title) => /\d|OpenAI|GPT/.test(title)))
  check('小工具：标签带账号定位', buildTags(picked.candidates[0], settings).includes(String(settings.accountPositioning).replace(/\s+/g, '')))
}

// ---------------------------------------------------------------------------
section('6) 报表解析')
{
  const csv = '笔记标题,阅读量,点赞量,收藏量,评论量,分享量,新增关注,有效评论数,发布时间\nOpenAI 发布 GPT-5.2,1.2万,900,450,120,60,40,90,2026-09-10\n某个开源工具,3200,80,60,12,5,3,8,2026-09-12'
  const rows = parseCsv(csv)
  check('CSV 解析出行数', rows.length === 3, String(rows.length))
  const data = rowsToReviewData(rows)
  check('表头映射到内部字段', data.mapping.some((m) => m.field === 'reads') && data.mapping.some((m) => m.field === 'title'))
  check('"1.2万"换算成 12000', data.notes[0].reads === 12000, String(data.notes[0].reads))
  check('笔记条数正确', data.notes.length === 2)

  const csvPath = path.join(TEMP_HOME, 'report.csv')
  fs.writeFileSync(csvPath, `\uFEFF${csv}`, 'utf8')
  const parsed = await parseReport(csvPath)
  check('parseReport 能读 CSV 文件（含 BOM）', parsed.ok === true && parsed.data.notes.length === 2, JSON.stringify(parsed.error || ''))

  const xlsxPath = process.argv[2]
  if (xlsxPath) {
    const result = await parseReport(xlsxPath)
    check(`parseReport 能读真实 xlsx（${path.basename(xlsxPath)}）`, result.ok === true, result.error || '')
    if (result.ok) console.log(`     解析方式：${result.method}；笔记数：${result.data.notes.length}`)
  } else {
    console.log('  - 跳过真实 xlsx 测试（想看就把 xlsx 路径当第一个参数传进来）')
  }

  const missing = await parseReport(path.join(TEMP_HOME, '不存在.xlsx'))
  check('文件不存在时给友好提示', missing.ok === false && /找不到文件/.test(missing.error))
  const wrong = await parseReport(path.join(TEMP_HOME, 'report.txt.bak'))
  check('不支持的类型给提示', wrong.ok === false)
}

// ---------------------------------------------------------------------------
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
if (fail) {
  console.log('失败明细：')
  for (const line of failures) console.log(`  - ${line}`)
}
console.log(`（测试数据目录：${TEMP_HOME}）`)
process.exit(fail ? 1 : 0)

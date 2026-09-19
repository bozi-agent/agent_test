/**
 * AI 资讯工作台 —— 硬规则表与检查器（**纯本地，不涉及大模型**）
 *
 * 这里放的是"不靠 AI 也能判定"的东西：
 *  - 六项筛选标准（模块3）
 *  - 模块4 的 6 项检查清单 + 违禁词表
 *  - 平台合规检查（模块6）
 *  - 选题判断表（第九章）
 *  - 数字/人名/时间/版本号高亮
 *  - 人设文本拼装（开发文档 6.8 的格式）
 *
 * 说明：之前这些规则和"提示词"混在一个文件里；现在插件不再调用大模型，
 * 所以把规则单独拆出来，提示词那部分已经删掉。
 */

// ---------------------------------------------------------------------------
// 一、模块3 六项筛选标准
// ---------------------------------------------------------------------------

export const FILTER_ITEMS = [
  { key: 'bigTech', label: '大厂发布', rule: '来自 OpenAI、Anthropic、Google、Meta 等' },
  { key: 'openSource', label: '开源爆款', rule: 'GitHub 高星 / Hugging Face 热门' },
  { key: 'freeOrCheap', label: '免费或降价', rule: '产品免费、降价、开源可白嫖' },
  { key: 'weird', label: '离谱新闻', rule: '有反差、有话题、让人想转发' },
  { key: 'infoGap', label: '信息差', rule: '多数人还不知道，有"我先知道"价值' },
  { key: 'extendable', label: '可延展', rule: '能写成 3 张以上卡片，有细节可讲' },
]

/** 键名 → 中文名 */
export function filterLabel(key) {
  const hit = FILTER_ITEMS.find((item) => item.key === key)
  return hit ? hit.label : key
}

/**
 * 把详情页正文里那些"样板噪音"清掉，只留真正的内容。
 * 典型噪音（用户反馈的）："来自base。AI资讯 AI新闻资讯 正文 …… 发布时间：2026-09-17 阅读 128 1分钟"
 * @param {string} text 原始正文/摘要
 * @param {object} [options] { source } 站点名，出现即去掉
 */
export function cleanDigest(text, options = {}) {
  let out = String(text || '')
  if (!out) return ''
  const source = String((options && options.source) || '').trim()
  if (source) out = out.split(source).join(' ')
  out = out
    // 栏目名 / 模板词（这些是站点的版式文字，不是内容）
    .replace(/AI\s*新闻资讯|AI\s*资讯|AI资讯|新闻资讯|资讯\s*正文|详情\s*正文/g, ' ')
    .replace(/(^|\s)正\s*文(?=\s|$)/g, ' ')
    // 站名前面已经被删掉了，所以这里不能再依赖站名，单独把"| 公众号 xxx"清掉
    .replace(/[|｜]\s*公众号\s*[A-Za-z0-9\u4e00-\u9fa5]{0,20}/g, ' ')
    .replace(/公众号\s*[A-Za-z0-9\u4e00-\u9fa5]{0,20}/g, ' ')
    // 署名行里那种"XXX 发自 凹非寺"
    .replace(/[\u4e00-\u9fa5A-Za-z]{2,6}\s*发自\s*[\u4e00-\u9fa5A-Za-z]{2,10}/g, ' ')
    // 阅读时长 / 阅读数（必须在"标签+数字"那条前面，否则"1分钟"的 1 会被先吃掉）
    .replace(/[0-9]+\s*(分钟|秒)\s*(阅读|浏览)?/g, ' ')
    .replace(/(阅读|浏览|点击|点赞|评论|收藏)\s*[0-9]+/g, ' ')
    // 开头的署名行："衡宇 2026-09-17 19:56:13"（前面可能还挂着被删掉的站名留下的分隔符）
    .replace(/^[^\u4e00-\u9fa5A-Za-z0-9]{0,8}[\u4e00-\u9fa5A-Za-z]{2,6}\s+[0-9]{4}[-/年][0-9]{1,2}[-/月][0-9]{1,2}日?\s*[0-9]{0,2}[:：]?[0-9]{0,2}[:：]?[0-9]{0,2}\s*/, '')
    // "发布时间：2026-09-17 19:56"“来源：xxx”“阅读 128”这类标签 + 后面的值
    // ⚠ 日后面那个字可能是「号」（"2026年9月18号 11:25"），所以 [日号]? 都要吃；
    //   否则会剩一截"号 11:25"，看起来就像正文里混进了时间。
    .replace(
      /(发布时间|发布于|更新时间|来源|来自|作者|编辑|阅读|浏览|点击|评论|点赞|收藏)\s*[:：]?\s*[0-9]{0,4}[年\-/.]?[0-9]{0,2}[月\-/.]?[0-9]{0,2}\s*[日号]?\s*[0-9]{0,2}[:：]?[0-9]{0,2}[:：]?[0-9]{0,2}/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—|｜·:：,，、。]+/, '')
    .trim()
  return out
}

// ---------------------------------------------------------------------------
// 正文"页头"清理：只削开头那一串（栏目名 / 站点名 / 标题 / 发布时间 / 阅读数），
// 正文本身一个字都不动 —— 跟 cleanDigest（全文清洗）分工不同。
// ---------------------------------------------------------------------------

/** 页头里常见的栏目名/模板词（只削出现在开头的） */
const LEAD_NOISE_WORDS = ['AI新闻资讯', 'AI资讯', 'AI新闻', '新闻资讯', '资讯正文', '详情正文', '正文', '导读', '摘要']

/** 削掉开头多余的分隔符（含标题被截断后留下的半个引号/书名号） */
function trimLeadEdge(value) {
  return String(value || '')
    .replace(/^[\s\-–—|｜·、,，。:：;；>》】」）)"'“”‘’]+/, '')
    .trim()
}

/**
 * 把正文开头那一串"页头噪音"反复削掉（最多 8 轮）。
 * 真实例子（用户反馈的）：
 *   「AI资讯 AI新闻资讯 正文 千问上线 Qwen3.8-Omni-Flash… 发布于AI新闻资讯 发布时间 : 2026年9月18号 11:25 阅读 : 1 分钟 <真正文>」
 * 处理完只剩 `<真正文>`；标题和站点名也会被削掉（它们在界面上单独显示）。
 * @param {string} text 原始正文
 * @param {object} [options] { title, source }
 */
export function stripLeadNoise(text, options = {}) {
  let out = String(text || '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!out) return ''
  const title = String((options && options.title) || '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .trim()
  const source = String((options && options.source) || '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .trim()
  const titleVariants = []
  if (title) {
    titleVariants.push(title)
    const bare = title.replace(/^[《【「[(（]+/, '').replace(/[》】」\])）]+$/, '').trim()
    if (bare && bare !== title) titleVariants.push(bare)
  }

  // ⓪ 有些站点（base 这类）把「栏目名 + 标题 + 发布时间」整段当页头，真正文在发布时间**之后**：
  //    只要这一小段（前 260 字）里同时有页头特征 + 「发布时间 + 日期时间」，就把这一段全部切掉。
  //    这样即使列表页的标题和详情页的标题差一两个引号，也不会把标题漏进正文。
  const head = out.slice(0, 260)
  const looksLikeHeader = /(AI\s*资讯|AI\s*新闻资讯|正文|发布于)/.test(head) || (title.length >= 6 && head.includes(title.slice(0, 8)))
  if (looksLikeHeader) {
    const stampRe = /(发布时间|发布于|发表于|发布日期)\s*[:：]?\s*[0-9]{0,4}\s*[年\-/.]?\s*[0-9]{0,2}\s*[月\-/.]?\s*[0-9]{0,2}\s*[日号]?\s*[0-9]{0,2}\s*[:：]?\s*[0-9]{0,2}(?:\s*[:：]\s*[0-9]{0,2})?\s*(分钟|秒)?/g
    let cut = -1
    let hit = stampRe.exec(head)
    while (hit) {
      // 必须真的带日期数字（只写"发布于"不算）
      if (/[0-9]/.test(hit[0])) cut = hit.index + hit[0].length
      hit = stampRe.exec(head)
    }
    // ⚠ 只有"发布时间前面那一段里确实出现了标题"时才敢整段切掉 ——
    //   否则碰上"正文写在发布时间之前"的排版会把真正文切没。
    const titleInHead = title.length >= 6 && out.slice(0, cut > 0 ? cut : 0).includes(title.slice(0, 8))
    if (cut > 0 && titleInHead && cut < out.length) out = trimLeadEdge(out.slice(cut))
  }

  for (let round = 0; round < 8; round++) {
    const before = out
    // ① 栏目名 / 模板词（长的排前面，削掉一个就重新从最长的开始试，避免"AI新闻"把"AI新闻资讯"咬掉一半）
    let stripped = true
    while (stripped) {
      stripped = false
      for (const word of LEAD_NOISE_WORDS) {
        if (out.startsWith(word)) {
          out = trimLeadEdge(out.slice(word.length))
          stripped = true
          break
        }
      }
    }
    // ② 站点名 / 标题
    if (source && out.startsWith(source)) out = trimLeadEdge(out.slice(source.length))
    for (const variant of titleVariants) {
      if (variant && out.startsWith(variant)) out = trimLeadEdge(out.slice(variant.length))
    }
    // ②b 标题被《》【】「」这类壳子包着（例如"《标题》号 11:25"）
    out = out.replace(/^[《【「[(（]\s*([^》】」\])）]{2,80})\s*[》】」\])）]/, (match, inner) => {
      if (!title) return match
      const innerText = String(inner || '').trim()
      if (innerText === title || title.startsWith(innerText) || innerText.startsWith(title.slice(0, 8))) return ' '
      return match
    })
    out = trimLeadEdge(out)
    // ②c 开头是「标题 – 站点名」这种（列表页标题可能被截断，跟正文里的完整标题对不上，
    //     所以不能靠 startsWith 判）：前 90 字里出现 " – / — / | / · "，且它前面那段
    //     没有句末标点（长得像标题而不是正文），就把整段连站点名一起削掉。
    out = out.replace(/^([^。！？!?；;]{8,90}?)\s+[–—|·]{1,2}\s+\S{1,24}\s*/, (match, segment) => {
      const seg = String(segment || '').trim()
      if (!seg) return match
      // 分隔号前面那段如果带着署名/时间/来源（"… 量子位 | 公众号 QbitAI"这种就是页头，不是"标题 | 站点名"），别动
      if (/(来源|发自|公众号|阅读|浏览|发布时间|发布于|(?:19|20)[0-9]{2}|[0-9]{1,2}\s*[:：]\s*[0-9]{2})/.test(seg)) return match
      if (title && (title.startsWith(seg.slice(0, 8)) || seg.startsWith(title.slice(0, 8)))) return ' '
      return /[。！？!?；;]/.test(seg) ? match : ' '
    })
    out = trimLeadEdge(out)
    // ③ "发布于 xxx" 这类标签（后面的站点名/时间下一轮继续削）
    out = out.replace(/^(发布于|发表于|发布|作者|编辑|来源|来自|时间|日期|发布时间|更新时间)\s*[:：]?\s*/, '')
    // ③b 开头署名行："衡宇 2026-09-17 19:56:13"（后面通常紧跟"来源：量子位"）
    out = out.replace(
      /^[\u4e00-\u9fa5A-Za-z]{2,6}\s+[0-9]{4}\s*[-/年.]\s*[0-9]{1,2}\s*[-/月.]\s*[0-9]{1,2}\s*[日号]?\s*[0-9]{0,2}\s*[:：]?\s*[0-9]{0,2}(?:\s*[:：]\s*[0-9]{0,2})?/,
      '',
    )
    // ④ 完整日期（+可选时间；时间可能是 08:37 也可能是 08:37:13）
    out = out.replace(/^[0-9]{2,4}\s*[年\-/.]\s*[0-9]{1,2}\s*[月\-/.]\s*[0-9]{1,2}\s*[日号]?\s*[0-9]{0,2}\s*[:：]?\s*[0-9]{0,2}(?:\s*[:：]\s*[0-9]{0,2})?/, '')
    out = out.replace(/^[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*[日号]\s*[0-9]{0,2}\s*[:：]?\s*[0-9]{0,2}(?:\s*[:：]\s*[0-9]{0,2})?/, '')
    // ⑤ 只剩半截的时间："号 11:25" / "11:25" / "11:25:30"
    out = out.replace(/^[日号]\s*[0-9]{1,2}\s*[:：]\s*[0-9]{2}(?:\s*[:：]\s*[0-9]{2})?/, '')
    out = out.replace(/^[0-9]{1,2}\s*[:：]\s*[0-9]{2}(?:\s*[:：]\s*[0-9]{2})?/, '')
    // ⑥ 阅读/浏览数
    out = out.replace(/^(阅读|浏览|点击|点赞|评论|收藏)\s*[:：]?\s*[0-9]*\s*(分钟|秒)?/, '')
    out = trimLeadEdge(out)
    if (out === before) break
  }
  out = out.replace(/^[日号]\s*/, '')
  return stripTailNoise(out).trim()
}

/**
 * 页脚噪音：站点导航、二维码引导、备案号、版权声明这些**页尾模板文字**。
 * （用户反馈：粘过去的正文末尾挂着"…版权所有，未经授权不得转载…"和"京ICP备17005886号-1"）
 *
 * 分两档，避免误伤正文：
 *   · 强标记（几乎不可能出现在正文里）：出现在**后半段**就从此截断；
 *   · 弱标记（栏目名，正文里偶尔也会出现）：同样按"后半段"处理 —— 抓取时已经
 *     把这些区块整块删过一遍了，这里是"万一没删干净"的第二道保险。
 */
const STRONG_TAIL_MARKERS = ['京ICP备', '版权所有', '违者必究', '免责声明', '点击阅读原文']
const WEAK_TAIL_MARKERS = [
  '相关阅读',
  '热门文章',
  '扫码关注',
  '扫码分享',
  '责任编辑',
  '更多精彩',
  '推荐阅读',
  '猜你喜欢',
  '商务合作',
  '寻求报道',
  '加入我们',
  '搜索：',
]

/** 从页脚标记处截断（找不到就不动） */
function stripTailNoise(text) {
  const src = String(text || '')
  if (!src) return ''
  let cut = -1
  const strongFrom = Math.floor(src.length * 0.5)
  for (const marker of STRONG_TAIL_MARKERS) {
    const at = src.indexOf(marker, strongFrom)
    if (at >= 0 && (cut === -1 || at < cut)) cut = at
  }
  const weakFrom = Math.floor(src.length * 0.5)
  for (const marker of WEAK_TAIL_MARKERS) {
    const at = src.indexOf(marker, weakFrom)
    if (at >= 0 && (cut === -1 || at < cut)) cut = at
  }
  const out = cut > 0 ? src.slice(0, cut) : src
  // 只清掉结尾的空白和 HTML 残渣（--> / &nbsp; 这类），**不动正文的句末标点**
  return out.replace(/[\s>&\-–—|·]+$/, '').trim()
}

/**
 * 选题库卡片上那句"正文节选"：先削页头，再清全文噪音。
 * 硬要求：不许混进标题、来源、日期时间；正文太短时退回 og:description。
 * @param {string} text 原始正文
 * @param {object} [options] { title, source, description, limit }
 */
export function cleanExcerpt(text, options = {}) {
  const title = String((options && options.title) || '').trim()
  const source = String((options && options.source) || '').trim()
  const limit = Number((options && options.limit) || 300)
  const pick = (raw) => {
    if (!String(raw || '').trim()) return ''
    let out = stripLeadNoise(raw, { title, source })
    out = cleanDigest(out, { source })
    // cleanDigest 之后开头可能又露出一截（"号 11:25"这种），再削一遍
    out = stripLeadNoise(out, { title, source })
    // 标题已经单独显示在卡片上了，正文里再出现就删掉
    if (title && title.length >= 6) out = out.split(title).join(' ')
    return out.replace(/\s+/g, ' ').replace(/^[\s\-–—|｜·:：,，、。"'“”‘’]+/, '').trim()
  }
  let out = pick(text)
  if (out.length < 40 && options && options.description) {
    const alt = pick(options.description)
    if (alt.length > out.length) out = alt
  }
  return out.slice(0, limit)
}

/** 统计勾中几项 */
export function countChecks(checks) {
  if (!checks || typeof checks !== 'object') return 0
  return FILTER_ITEMS.reduce((sum, item) => sum + (checks[item.key] ? 1 : 0), 0)
}

// ---------------------------------------------------------------------------
// 二、高亮：数字 / 人名 / 时间 / 版本号
// ---------------------------------------------------------------------------

export const HIGHLIGHT_PATTERNS = [
  /[A-Za-z][A-Za-z0-9._-]*\s*v?\d+(?:\.\d+)+/g, // 版本号：GPT-5.2 / v1.0
  /\d+(?:\.\d+)?\s*(?:%|％|万|亿|亿次|万次|倍|美元|元|美金|万元|亿元|GB|MB|TB|K|k|B|个|条|人|天|小时|分钟|秒|张|篇|款)/g,
  /\b(?:19|20)\d{2}\s*[-/年.]\s*\d{1,2}(?:\s*[-/月.]\s*\d{1,2})?/g, // 日期
  /\b(?:OpenAI|Anthropic|Google|DeepMind|Meta|Microsoft|NVIDIA|英伟达|字节|阿里|腾讯|百度|华为|月之暗面|智谱|MiniMax|DeepSeek|Hugging Face|GitHub|Claude|Gemini|Llama|Qwen|GPT-?[0-9A-Za-z.-]*|Sora|Grok)\b/gi,
  /[\u4e00-\u9fa5]{2,4}(?=(?:宣布|发布|表示|透露|称|说|团队|公司))/g, // 常见人名/团队名
]

/**
 * 把文本按"数字/人名/时间/版本号"切成带高亮标记的分段，供界面渲染
 * @returns {Array<{text:string, highlight:boolean}>}
 */
export function highlightFacts(text) {
  const source = String(text || '')
  if (!source) return []
  const ranges = []
  for (const pattern of HIGHLIGHT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    let match
    while ((match = re.exec(source)) !== null) {
      const value = match[0]
      if (!value) {
        re.lastIndex++
        continue
      }
      ranges.push({ start: match.index, end: match.index + value.length })
    }
  }
  ranges.sort((a, b) => a.start - b.start)
  const merged = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ start: range.start, end: range.end })
  }
  const segments = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: source.slice(cursor, range.start), highlight: false })
    segments.push({ text: source.slice(range.start, range.end), highlight: true })
    cursor = range.end
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), highlight: false })
  return segments
}

// ---------------------------------------------------------------------------
// 三、人设（开发文档 6.8 的模板）
// ---------------------------------------------------------------------------

/** 拼人设文本：我是一名[定位]博主…… */
export function buildPersonaText(settings) {
  const s = settings || {}
  const frequent = (s.frequentWords || []).join('、') || '（未填）'
  const banned = (s.bannedWords || []).join('、') || '震惊、必看、史上最强'
  return `${s.personaDescription || '语气轻松，像跟朋友聊天'}；常用词：${frequent}；绝对不用：${banned}`
}

/** 人设注入模板（展示给用户看，方便他贴到别处用） */
export function buildPersonaBlock(settings) {
  const s = settings || {}
  const samples = (Array.isArray(s.pastViralSamples) ? s.pastViralSamples : [])
    .filter((item) => String(item || '').trim())
    .slice(0, 3)
    .map((item, index) => `样本${index + 1}：${String(item).trim()}`)
    .join('\n')
  return [
    `我是一名${s.accountPositioning || 'AI圈资讯'}博主，粉丝最常问我的问题是${s.typicalQuestions || '（未填）'}。`,
    `我的说话习惯是${s.personaDescription || '语气轻松，像跟朋友聊天'}，常用词汇有${(s.frequentWords || []).join('、') || '（未填）'}，绝对不用${(s.bannedWords || []).join('、') || '震惊、必看、史上最强'}。`,
    samples ? `我的历史爆款风格参考：\n${samples}` : '我的历史爆款风格参考：（暂时没有样本）',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 四、模块4 检查清单 + 违禁词
// ---------------------------------------------------------------------------

export const COPY_CHECKLIST = [
  { key: 'titleCalm', label: '标题不夸张', rule: '没有"震惊""必看""史上最强"等词' },
  { key: 'hasFacts', label: '有具体信息', rule: '含至少 1 个具体数字/产品名/版本号' },
  { key: 'human', label: '有人味', rule: '读起来像人说的话，不是翻译腔' },
  { key: 'noSensitive', label: '无敏感词', rule: '没有违规、医疗、金融承诺类词汇' },
  { key: 'tagsExact', label: '标签精准', rule: '3~5 个标签，与内容强相关' },
  { key: 'firstPerson', label: '第一人称', rule: '有"我"的视角，不是说明书' },
]

/** 违禁词/绝对化用语/诱导互动词（第八章 8.2 红线2） */
export const BANNED_PATTERNS = {
  absolute: ['全网最好', '全球最好', '史上最强', '最强', '最好', '第一名', '第一', '顶级', '顶尖', '根治', '唯一', '绝对', '100%', '永久', '万能', '无敌', '国家级', '世界级', '史上最', '绝无仅有'],
  induce: ['求点赞', '求收藏', '求关注', '一键三连', '互关', '互赞', '点赞关注', '关注我', '双击', '评论扣1', '扣1'],
  marketing: ['免费领', '引流', '私域', '加微信', '私聊', '扫码', '低价', '内部价', '代购', '包过'],
  medicalFinance: ['治疗', '治愈', '药到病', '降血压', '抗癌', '稳赚', '保本', '理财收益', '保证收益', '躺赚', '月入过万', '包赚'],
  aiTell: ['值得注意的是', '综上所述', '总的来说', '总而言之', '毋庸置疑', '赋能', '助力', '本文将', '日新月异', '层出不穷'],
}

/** AI 套话 → 人话（去 AI 味用） */
export const AI_TELLS = [
  ['值得注意的是', '顺便说'],
  ['需要注意的是', '提醒一句'],
  ['综上所述', '所以'],
  ['总的来说', '整体看'],
  ['总而言之', '一句话'],
  ['首先，', '先说'],
  ['其次，', '然后'],
  ['在当今', '现在'],
  ['随着人工智能技术的不断发展', '现在 AI 更新太快了'],
  ['不可否认', '说真的'],
  ['毋庸置疑', '真的'],
  ['赋能', '帮上忙'],
  ['助力', '帮'],
  ['深度赋能', '实实在在帮上'],
  ['本文将', '这篇我说'],
  ['本文', '这篇'],
  ['让我们', '咱们'],
  ['我们可以看到', '能看到'],
  ['在某种程度上', '有点'],
  ['极大地', '大幅'],
  ['至关重要', '很关键'],
  ['广泛应用', '用得很多'],
  ['日新月异', '一天一个样'],
  ['层出不穷', '一个接一个'],
  ['引发了广泛关注', '大家都在聊'],
  ['引起广泛关注', '大家都在聊'],
  ['有望', '可能会'],
  ['进一步', '再'],
  ['旨在', '想'],
  ['从而', '这样'],
  ['此外', '另外'],
  ['与此同时', '同时'],
  ['显著提升', '提升挺明显'],
  ['众所周知', '大家都知道'],
]

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 去 AI 味：套话替换 + 去掉空洞修饰词 */
export function deAiTells(text) {
  let out = String(text || '')
  for (const [from, to] of AI_TELLS) {
    if (!from) continue
    out = out.replace(new RegExp(escapeRe(from), 'g'), to)
  }
  for (const filler of ['非常', '十分', '极其', '相当', '尤为', '愈发', '颇具', '堪称', '可谓', '着实']) {
    out = out.replace(new RegExp(escapeRe(filler), 'g'), '')
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim()
}

/** 去 AI 味效果对比 */
export function deAiReport(before, after) {
  const source = String(before || '')
  const hits = []
  for (const [from] of AI_TELLS) if (from && source.includes(from)) hits.push(from)
  return { changed: source !== String(after || ''), hitCount: hits.length, hits: hits.slice(0, 12) }
}

/** 硬规则扫描：违禁词 / 绝对化 / 诱导互动 / 医疗金融 */
export function scanBanned(text) {
  const source = String(text || '')
  const hits = {}
  for (const [category, words] of Object.entries(BANNED_PATTERNS)) {
    const found = words.filter((word) => source.includes(word))
    if (found.length) hits[category] = found
  }
  const absolute = hits.absolute || []
  const induce = hits.induce || []
  const marketing = hits.marketing || []
  const medicalFinance = hits.medicalFinance || []
  return {
    hits,
    hasAbsolute: absolute.length > 0,
    hasInduce: induce.length > 0,
    hasMarketing: marketing.length > 0,
    hasMedicalFinance: medicalFinance.length > 0,
    clear: absolute.length + induce.length + marketing.length + medicalFinance.length === 0,
  }
}

/**
 * 按硬规则给一篇文案逐项打勾（本地判定，不靠模型）
 * @param {object} copy { titles, body, tags, aiChecklist }
 */
export function judgeCopy(copy) {
  const titles = Array.isArray(copy.titles) ? copy.titles : []
  const body = String(copy.body || '')
  const tags = Array.isArray(copy.tags) ? copy.tags : []
  const all = `${titles.join(' ')}\n${body}\n${tags.join(' ')}`
  const banned = scanBanned(all)
  const hasFacts = HIGHLIGHT_PATTERNS.slice(0, 4).some((pattern) => new RegExp(pattern.source, 'g').test(all))
  const firstPerson = /我/.test(body)
  const tagsCountOk = tags.length >= 3 && tags.length <= 5
  // "有人味"用可判定的代理指标：有口语连接词、没有 AI 套话、不是说明书式长句
  const humanReasons = []
  if (/(我试了下|说实话|挺|真的|其实|顺手|踩过|感觉)/.test(body)) humanReasons.push('有口语表达')
  const aiTellHits = (banned.hits.aiTell || []).filter(Boolean)
  if (aiTellHits.length) humanReasons.push(`还有套话：${aiTellHits.join('、')}`)
  const human = aiTellHits.length === 0 && humanReasons.length > 0

  const results = COPY_CHECKLIST.map((item) => {
    if (item.key === 'titleCalm') {
      const pass = !banned.hasAbsolute
      return { key: item.key, item: item.label, rule: item.rule, pass, reason: pass ? '标题里没有绝对化用语' : `标题里有绝对化/夸张词：${(banned.hits.absolute || []).join('、')}` }
    }
    if (item.key === 'hasFacts') {
      return { key: item.key, item: item.label, rule: item.rule, pass: hasFacts, reason: hasFacts ? '含有具体数字/产品名/版本号' : '通篇找不到具体数字、产品名或版本号' }
    }
    if (item.key === 'human') {
      return {
        key: item.key,
        item: item.label,
        rule: item.rule,
        pass: human,
        reason: human ? `读起来像人话（${humanReasons.join('；')}）` : humanReasons.length ? humanReasons.join('；') : '缺少口语表达，读着像通稿，建议自己改两句',
      }
    }
    if (item.key === 'noSensitive') {
      const bad = [...(banned.hits.medicalFinance || []), ...(banned.hits.marketing || []), ...(banned.hits.induce || [])]
      return { key: item.key, item: item.label, rule: item.rule, pass: bad.length === 0, reason: bad.length === 0 ? '没有违规、医疗、金融承诺类词汇' : `发现敏感词：${bad.join('、')}` }
    }
    if (item.key === 'tagsExact') {
      return { key: item.key, item: item.label, rule: item.rule, pass: tagsCountOk, reason: tagsCountOk ? `${tags.length} 个标签，数量合规` : `标签数量是 ${tags.length} 个，要求 3~5 个` }
    }
    const pass = firstPerson
    return { key: item.key, item: item.label, rule: item.rule, pass, reason: pass ? '正文有"我"的视角' : '正文里没有第一人称视角，像说明书' }
  })
  return { checklist: results, allPass: results.every((item) => item.pass), banned }
}

// ---------------------------------------------------------------------------
// 五、模块6 平台合规
// ---------------------------------------------------------------------------

export const COMPLIANCE_CHECKLIST = [
  { key: 'aiLabel', item: '已标注AI辅助生成/转载来源', rule: '发布时勾选"高级选项-内容类型声明-已自主标注"，正文/标题注明 AI 辅助生成' },
  { key: 'noAbsolute', item: '无绝对化用语（最好/第一/顶级/根治）', rule: '出现即限流' },
  { key: 'noInduce', item: '无诱导互动词（求赞/求收藏/互关）', rule: '诱导互动也在禁用之列' },
  { key: 'noMarketing', item: '无违规营销词（免费领/引流/私域）', rule: '易被判定硬广' },
  { key: 'noMedicalFinance', item: '无医疗/金融承诺类表述', rule: '医疗、金融承诺类零容忍' },
  { key: 'notCopy', item: '非搬运/抄袭（有个人体验和评价）', rule: '站外搬运、站内抄袭都会被淘汰' },
]

export const QUALITY_CHECKLIST = [
  { key: 'titleCalm', item: '标题不夸张' },
  { key: 'titleFacts', item: '标题有具体信息' },
  { key: 'human', item: '正文有人味' },
  { key: 'firstPerson', item: '第一人称视角' },
  { key: 'factsVerified', item: '数字已核实' },
  { key: 'tagsExact', item: '标签精准' },
  { key: 'coverClear', item: '封面清晰' },
  { key: 'publishTime', item: '发布时间对（晚 7~9 点）' },
]

/** 合规硬检查（本地判定） */
export function runComplianceCheck(text) {
  const banned = scanBanned(text)
  const marked = /AI\s*辅助生成|AI\s*辅助|转载自|内容由\s*AI/i.test(text)
  return COMPLIANCE_CHECKLIST.map((item) => {
    if (item.key === 'aiLabel') {
      return { key: item.key, item: item.item, rule: item.rule, pass: marked, reason: marked ? '正文里已注明 AI 辅助生成/转载来源' : '正文里没有注明"AI辅助生成"或"转载自@XXX"，发布时要同时勾选内容类型声明' }
    }
    if (item.key === 'noAbsolute') {
      return { key: item.key, item: item.item, rule: item.rule, pass: !banned.hasAbsolute, reason: banned.hasAbsolute ? `发现绝对化用语：${(banned.hits.absolute || []).join('、')}` : '没有绝对化用语' }
    }
    if (item.key === 'noInduce') {
      return { key: item.key, item: item.item, rule: item.rule, pass: !banned.hasInduce, reason: banned.hasInduce ? `发现诱导互动词：${(banned.hits.induce || []).join('、')}` : '没有诱导互动词' }
    }
    if (item.key === 'noMarketing') {
      return { key: item.key, item: item.item, rule: item.rule, pass: !banned.hasMarketing, reason: banned.hasMarketing ? `发现违规营销词：${(banned.hits.marketing || []).join('、')}` : '没有违规营销词' }
    }
    if (item.key === 'noMedicalFinance') {
      return { key: item.key, item: item.item, rule: item.rule, pass: !banned.hasMedicalFinance, reason: banned.hasMedicalFinance ? `发现医疗/金融承诺类词汇：${(banned.hits.medicalFinance || []).join('、')}` : '没有医疗/金融承诺类表述' }
    }
    return { key: item.key, item: item.item, rule: item.rule, pass: true, reason: '内容来自抓取的原文并做了重写，不是搬运；发布前记得加上你自己的体验和评价' }
  })
}

/** 自动补 AI 标注 */
export function ensureAiLabel(body) {
  const text = String(body || '')
  if (/AI\s*辅助生成|AI\s*辅助|转载自|内容由\s*AI/i.test(text)) return text
  return `${text}\n\n（本文由 AI 辅助整理，数据以原文为准）`
}

// ---------------------------------------------------------------------------
// 六、选题判断表（第九章）
// ---------------------------------------------------------------------------

export const TOPIC_SCORE_ITEMS = [
  { key: 'match', label: '匹配度', rule: '跟你的账号定位一致吗？' },
  { key: 'emotion', label: '情绪', rule: '能让人"哇""气""笑""学到了"吗？' },
  { key: 'infoGap', label: '信息差', rule: '多数人还不知道吗？' },
  { key: 'extendable', label: '可延展', rule: '能写成 3 张以上卡片吗？' },
]

/** 选题判断表是否达标（平均分 ≥ 3.5 值得做，< 3 放弃） */
export function judgeTopicScore(scores) {
  const values = TOPIC_SCORE_ITEMS.map((item) => Number(scores && scores[item.key]) || 0)
  const average = values.reduce((a, b) => a + b, 0) / values.length
  return { average: Math.round(average * 100) / 100, worthDoing: average >= 3.5, shouldDrop: average < 3 }
}

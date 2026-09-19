/**
 * AI 资讯工作台 —— 弹窗里的工作台界面
 *
 * 结构（按需求）：
 *   一级：工作台主页 —— 5 个模块卡片（只显示模块名 / 简短状态 / 进入按钮）
 *   二级：模块详情页 —— 该模块的按钮、状态、结果区、复制按钮、检查清单 + 返回工作台主页
 *   另外：设置页、SOP 页、日志页
 *
 * 视觉（本次改造）：
 *   深色玻璃拟态 + 霓虹状态发光。所有颜色/间距/圆角走 ui.js 里的 CSS 变量，
 *   hover / :active / 动画走 ui.js 注入的样式表；这里只负责结构与 class。
 *
 * 防崩：
 *  - 所有会失败的活都包在 try/catch 里，只把错误显示在页面上
 *  - 不主动调用任何 Harness 服务（只用 fetch 打自己的主机侧接口），
 *    所以这个界面出问题不会影响聊天主界面
 */

import { api, CLS, copyText, cx, ensureStyles, formatTime, markAll, percent, rate, renderSegments, ST, TONE, toneStyle } from './ui.js'
import { getSnapshot, subscribe } from './store.js'




/** 模块3 时间筛选档位（跟主机侧 filter.js 的 TIME_RANGES 一一对应，默认"全部"） */
const TIME_RANGE_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: '3d', label: '近 3 天' },
  { key: '7d', label: '近 7 天' },
]

/** 模块2：每个网站一页显示几条（跟「筛选核实」的分页风格一致） */
const SITE_PAGE_SIZE = 6

/** 「抓取最近几天」可选值（设置页 → 抓取参数） */
const FETCH_DAY_OPTIONS = [1, 3, 5, 7]

/**
 * 设置页「筛选规则关键词」里**可编辑的五项**（第 6 项「可延展」不是关键词，
 * 用的是两个门槛：具体信息条数 / 正文字数）。出厂默认值由主机侧下发（filterDefaults）。
 */
const FILTER_KEYWORD_FIELDS = [
  { key: 'bigTech', label: '① 大厂发布', hint: '公司名 / 产品名', placeholder: 'openai，anthropic，google，英伟达，字节，腾讯' },
  { key: 'openSource', label: '② 开源爆款', hint: '开源信号', placeholder: 'github，开源，star，权重，可商用' },
  { key: 'freeOrCheap', label: '③ 免费或降价', hint: '能白嫖的信号', placeholder: '免费，降价，白嫖，限免，零成本' },
  { key: 'weird', label: '④ 离谱新闻', hint: '有反差、有话题', placeholder: '居然，离谱，反转，翻车，被罚' },
  { key: 'infoGap', label: '⑤ 信息差', hint: '多数人还不知道', placeholder: '内测，灰度，冷门，少有人知，彩蛋' },
]

/** 5 个模块的静态定义（模块名 + 状态读取方式 + 主要动作；原 ⑥⑦ 已移除） */
export const MODULES = [
  { id: 'm1', no: '①', name: '选题库', icon: '📚', getStatus: (s, c) => `已存 ${c.topics || 0} 条` },
  // 模块2 状态里那个数字 = **当前还能处理的条数**（列表里真实看得见的条数）：
  // 本次抓到的总条数 − 已经存进「① 选题库」的 − 已经「核实通过」的。
  // 存一条 / 核实一条，这个数字立刻减 1（用户反馈"顶部数量不减"就是这个）。
  { id: 'm2', no: '②', name: '扫源抓取', icon: '📡', getStatus: (s, c) => `${s.module2 || '未开始'} · 本次有效 ${c.fetchedPending !== undefined ? c.fetchedPending : (c.fetched || 0)} 条` },
  // 模块3：状态栏按需求**只显示候选条数**（不再有"等待模块2 / 正在筛选 / 等待确认 / 已确认"
  // 那四种状态），颜色也固定走绿色，跟「④ 写文案」那条保持一致的观感。
  { id: 'm3', no: '③', name: '筛选核实', icon: '🔍', getStatus: (s, c) => `候选 ${c.candidates || 0} 条` },
  // 模块4：写文案这一步现在只是"把原文原封不动搬进来"，不再有"待润色"这个说法；
  // 老数据里存的状态就是「待润色」，这里统一显示成「已就绪」，免得残留一个已经取消的标识。
  //
  // ⚠ 按需求：这条状态栏**固定显示成「已就绪 · N 篇」**，而 N = **还没进「⑤ 封面标签」的稿子数**：
  //   帖子在「④ 写文案」里点过「保存」之后，就归「⑤ 封面标签」了、也不再在写文案里展示，
  //   所以这里必须只数"还没保存的"，不然保存一篇数字还挂着；0 篇时卡片也不发光。
  {
    id: 'm4',
    no: '④',
    name: '写文案',
    icon: '✍️',
    getStatus: (s, c) => `已就绪 · ${c.copiesPending !== undefined ? c.copiesPending : (c.copies || 0)} 篇`,
  },
  // 模块5（「封面标签」）：模板来自"模板文件夹"，点哪张缩略图就用哪张；
  // 标题/正文由浏览器本地 Canvas 贴到模板上（不调模型）。数字 = 可以做图的帖子数。
  { id: 'm5', no: '⑤', name: '封面标签', icon: '🏷️', getStatus: (s, c) => `${s.module5 || '等待文案'} · ${(c.copies || 0) - (c.copiesPending || 0)} 篇` },
]

/** 主组件工厂 */
export function createWorkbench(react) {
  const h = react.createElement
  const { useCallback, useEffect, useMemo, useRef, useState } = react

  // 样式表只注入一次；注入不了也不影响功能（只丢视觉）
  try {
    ensureStyles(typeof document !== 'undefined' ? document : null)
  } catch (err) {
    /* 忽略 */
  }

  /**
   * 订阅界面侧小仓。
   * 优先用 useSyncExternalStore（React 18），没有就退回 useState + subscribe（React 17 也能跑）。
   * 这里必须容错：某些运行环境里 react 上可能没有 useSyncExternalStore，
   * 直接调用会让整个 bundle 在执行期抛错、连累后面的插件。
   */
  function useSharedStore() {
    if (typeof react.useSyncExternalStore === 'function') {
      return react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }
    const [snap, setSnap] = useState(getSnapshot)
    useEffect(() => {
      if (typeof subscribe !== 'function') return undefined
      const unsub = subscribe(() => setSnap(getSnapshot()))
      setSnap(getSnapshot())
      return typeof unsub === 'function' ? unsub : undefined
    }, [])
    return snap
  }

  /**
   * 本地话题标签提取（做图排版用，**纯本地、不调大模型**）：
   *   ① 先认一批 AI 圈常见主题词（命中就往标签里放）；
   *   ② 再挑标题/正文里的英文专名（OpenAI / GPT-5.2 / Qwen…）；
   *   ③ 最后按词频补几个正文里的 2~4 字中文高频词（开头结尾的虚词不算）。
   * 返回 4~6 个（不够就补通用标签，多了截断）。
   */
  function buildTagsLocal(title, body) {
    const text = `${title || ''} ${body || ''}`
    const tags = []
    const push = (value) => {
      const tag = String(value || '').replace(/^#/, '').replace(/[｜|，,、。；;：:\s"'（）()【】\[\]]/g, '').trim()
      if (!tag || tag.length > 12) return
      if (!tags.includes(tag)) tags.push(tag)
    }
    // ① 主题词表（命中顺序固定，保证同一篇内容每次生成的标签一样）
    const THEMES = [
      ['大模型', /大模型|模型|LLM/i],
      ['AI Agent', /agent|智能体/i],
      ['开源', /开源|github|权重|apache|可商用/i],
      ['免费', /免费|限免|白嫖|零成本|试用/i],
      ['降价', /降价|便宜|价格|成本|费用/i],
      ['编程助手', /编程|代码|coding|程序员|开发/i],
      ['多模态', /多模态|图像|视频|语音|音频|生图/i],
      ['机器人', /机器人|具身|自动驾驶/i],
      ['算力芯片', /芯片|英伟达|算力|GPU/i],
      ['融资商业', /融资|估值|收购|上市|营收|盈利/i],
      ['产品更新', /发布|上线|更新|升级|内测|灰度/i],
      ['效率工具', /工具|插件|工作流|效率|自动化/i],
      ['安全合规', /安全|合规|泄露|封禁|诉讼|监管/i],
      ['行业观察', /报告|数据|调研|榜单|趋势/i],
    ]
    for (const [tag, pattern] of THEMES) {
      if (pattern.test(text)) push(tag)
    }
    // ② 英文专名 / 版本号
    const en = text.match(/[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*/g) || []
    const skip = new Set(['AI', 'ai', 'the', 'and', 'for', 'with', 'from', 'this', 'that', 'API', 'APP', 'com', 'http', 'https', 'www'])
    const enCount = new Map()
    for (const word of en) {
      if (word.length < 2 || word.length > 18) continue
      if (skip.has(word)) continue
      enCount.set(word, (enCount.get(word) || 0) + 1)
    }
    for (const [word] of [...enCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      push(word)
      if (tags.length >= 6) break
    }
    // ③ 中文高频词（2~4 字，纯本地滑窗统计；只当补充）
    const STOP = /^(这个|那个|我们|他们|你们|可以|已经|就是|而且|但是|因为|所以|如果|这样|那样|什么|怎么|非常|真的|一个|一下|现在|目前|今天|昨天|刚刚|表示|认为|对于|关于|以及|还有|没有|不是|这种|其中|同时|另外|根据|通过|进行|实现|提供|支持|包括|例如|比如)$/
    const counts = new Map()
    const chunks = String(body || '').split(/[。！？；，、\s]+/)
    for (const chunk of chunks) {
      const clean = chunk.replace(/[^\u4e00-\u9fa5]/g, '')
      for (let size = 4; size >= 2; size--) {
        for (let i = 0; i + size <= clean.length; i++) {
          const word = clean.slice(i, i + size)
          if (STOP.test(word)) continue
          counts.set(word, (counts.get(word) || 0) + 1)
        }
      }
    }
    const sorted = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    for (const [word] of sorted) {
      if (tags.length >= 6) break
      let covered = false
      for (const tag of tags) {
        if (tag.includes(word) || word.includes(tag)) {
          covered = true
          break
        }
      }
      if (!covered) push(word)
    }
    // 兜底：标签太少时补通用标签（保证总是 4~6 个）
    for (const fallback of ['AI资讯', 'AI', '人工智能', '科技', '数码', '效率工具', '新知']) {
      if (tags.length >= 4) break
      push(fallback)
    }
    return tags.slice(0, 6)
  }

  // -------------------------------------------------------------------------
  // 小组件
  // -------------------------------------------------------------------------

  /**
   * 按钮：三种变体 + 点击反馈 + 异步加载态
   * 支持两种用法（旧代码继续可用）：
   *   h(Btn, { primary: true }, '开始抓取')
   *   h(Btn, { variant: 'primary', loading: !!busy, loadingText: '抓取中…' }, '开始抓取')
   */
  function Btn(props) {
    const { primary, tiny, ghost, ok, bad, danger, variant, loading, loadingText, disabled, onClick, children, title, size, className } = props
    const picked = variant || (primary ? 'primary' : ghost ? 'ghost' : ok ? 'ok' : bad ? 'bad' : danger ? 'danger' : '')
    const classes = cx(CLS.btn, picked && `is-${picked}`, tiny || size === 'tiny' ? 'is-tiny' : '', className)
    const isDisabled = !!disabled || !!loading
    return h(
      'button',
      {
        type: 'button',
        title: title || '',
        className: classes,
        disabled: isDisabled,
        'aria-busy': loading ? 'true' : undefined,
        onClick: isDisabled ? undefined : onClick,
      },
      loading ? h('span', { className: CLS.spinner }) : null,
      h('span', null, loading ? loadingText || children : children),
    )
  }

  /**
   * 标签编辑器（「⑤ 封面标签」用）：每个标签一个输入框，右边一个 × 删掉它。
   * ⚠ 草稿放在组件内部，打字时只重渲染这一小块；**每次改动都立刻提交**给父级
   *   （父级把标签记下来，并按新标签重画"话题标签"那张卡）。
   *   onChange + onBlur 都提交一次：万一输入框被重挂载，用户敲的值也不会丢。
   */
  function TagEditor({ tags, disabled, onChange, onCommit }) {
    /**
     * ⚠ 这里**不能拿 tags 的引用当"变没变"的判据**。
     *   父级传下来的 tags 可能是渲染时现算出来的新数组（buildTagsLocal 返回的就是新数组），
     *   引用每次渲染都不同 → useEffect 每次都 setDraft → 副作用/渲染风暴，
     *   表现就是"切模板或刷新时页面卡死、点什么都没反应、得刷新浏览器"。
     *   所以这里把标签内容拼成一个字符串当钥匙：只有内容真的变了才重置草稿。
     */
    const draftKey = Array.isArray(tags)
      ? tags.map((item) => String(item === undefined || item === null ? '' : item)).join('\u0000')
      : ''
    const [draft, setDraft] = useState(() => (tags || []).slice())
    const lastKey = useRef(draftKey)
    useEffect(() => {
      if (lastKey.current === draftKey) return
      lastKey.current = draftKey
      setDraft((tags || []).slice())
    }, [draftKey])
    const push = (next) => {
      setDraft(next)
      if (typeof onChange === 'function') onChange(next)
    }
    return h(
      'div',
      { className: CLS.tagEditor },
      draft.map((tag, index) =>
        h(
          'span',
          { key: `tag_${index}`, className: CLS.tagEditItem },
          h('span', { className: CLS.tagHash }, '#'),
          h('input', {
            className: CLS.tagInput,
            value: tag,
            title: '可以直接改这个标签（改完点别处或按回车）',
            disabled: !!disabled,
            onChange: (event) => {
              const next = draft.slice()
              next[index] = event.target.value
              push(next)
            },
            onBlur: () => {
              // onChange 已经逐字提交过了；这里只兜"父级还没跟上"的情况，
              // 绝不能拿旧草稿再提交一次（会把用户刚改的值顶掉）
              const parent = (tags || []).map((item) => String(item === undefined || item === null ? '' : item))
              const mine = draft.map((item) => String(item === undefined || item === null ? '' : item))
              const same = parent.length === mine.length && parent.every((value, i) => value === mine[i])
              if (!same && typeof onCommit === 'function') onCommit(draft)
            },
            onKeyDown: (event) => {
              if (event && event.key === 'Enter' && typeof onCommit === 'function') onCommit(draft)
            },
          }),
          h('button', { type: 'button', className: CLS.tagDel, title: '删掉这个标签', disabled: !!disabled, onClick: () => push(draft.filter((item, i) => i !== index)) }, '×'),
        ),
      ),
    )
  }
  /** 复制按钮：复制成功后短暂变绿显示"已复制" */
  function CopyButton({ text, label }) {
    const [done, setDone] = useState(false)
    return h(
      Btn,
      {
        tiny: true,
        ok: done,
        onClick: async () => {
          const okResult = await copyText(text)
          setDone(okResult)
          setTimeout(() => setDone(false), 1400)
        },
      },
      done ? '✓ 已复制' : label || '复制',
    )
  }

  /**
   * 玻璃卡片。
   * head：卡片内第一行（比如二级页的"返回 + 图标 + 模块名 + 操作按钮"）
   * titleRight：卡片标题（如"操作与结果"）**右侧同一行**的位置（模块2 的状态信息放这儿）
   */
  function Card(props) {
    return h(
      'div',
      { className: cx(CLS.card, props.className) },
      props.head || null,
      props.title
        ? h(
            'div',
            { className: CLS.cardTitle },
            h('span', null, props.title),
            h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } }, props.titleRight || props.right || null),
          )
        : null,
      props.status ? h('div', { className: CLS.meta }, `状态：${props.status}`) : null,
      props.children,
      props.extra || null,
    )
  }

  /** 检查项一行：勾选框 + 检查项名 + 判断标准（灰）+ 未通过原因 */
  function CheckRow({ checked, label, rule, reason }) {
    return h(
      'div',
      { className: cx(CLS.check, checked && CLS.checkHit) },
      h('span', { className: cx(`${CLS.check}-x`, checked ? 'on' : 'off') }, '✓'),
      h(
        'span',
        null,
        h('span', { className: CLS.checkLabel }, label),
        rule ? h('span', { className: CLS.checkRule }, `（${rule}）`) : null,
        reason ? h('span', { className: checked ? CLS.checkReason : CLS.checkReasonBad }, ` —— ${reason}`) : null,
      ),
    )
  }

  /** 灰色小字提示 */
  function Hint({ children }) {
    if (!children) return null
    return h('div', { className: CLS.hint }, children)
  }

  /** 空数据占位（不留白） */
  function Empty({ children }) {
    return h('div', { className: CLS.empty }, children || '暂无数据')
  }

  /** 状态徽章（按色调发光） */
  function Badge({ tone, children }) {
    return h('span', { className: CLS.badge, style: toneStyle(tone) }, children)
  }

  /** 指标卡（模块7）：数值 + 判断色 */
  function Metric({ label, value, judge, tone }) {
    return h(
      'div',
      { className: CLS.metric, style: toneStyle(tone) },
      h('div', { className: CLS.metricNum }, value),
      h('div', { className: CLS.metricLabel }, label),
      judge ? h('div', { className: CLS.metricJudge }, judge) : null,
    )
  }

  // -------------------------------------------------------------------------
  // 主组件
  // -------------------------------------------------------------------------

  return function Workbench(props) {
    const shared = useSharedStore()
    const [screen, setScreen] = useState('main')
    const [moduleId, setModuleId] = useState('')
    const [busy, setBusy] = useState('')
    const [error, setError] = useState('')
    /** 失败提示的"第几次"：同一个错误连着报两次也要重新计时（见下面的自动消失 effect） */
    const [errorTick, setErrorTick] = useState(0)
    const [notice, setNotice] = useState('')
    const [settings, setSettings] = useState(null)
    /** 六项判断标准的出厂默认关键词（主机侧给，设置页「恢复默认」用） */
    const [filterDefaults, setFilterDefaults] = useState(null)
    const [statusData, setStatusData] = useState(null)
    const [topics, setTopics] = useState([])
    const [fetchData, setFetchData] = useState(null)
    const [candidates, setCandidates] = useState([])
    const [filterMeta, setFilterMeta] = useState(null)
    /** 模块3：时间筛选档位（全部 / 今天 / 近 3 天 / 近 7 天），默认"今天" */
    const [filterRange, setFilterRange] = useState('today')
    /** 模块3：候选分页（每页 5 条，能一页页翻到全部） */
    const [page, setPage] = useState(1)
    /** 模块2：每个网站各自的分页（每页 6 条） */
    const [sitePages, setSitePages] = useState({})
    /** 模块2：本次新增条目的标记（右下角红点），8 秒后自动清空 */
    const [newKeys, setNewKeys] = useState({})
    const newDotTimer = useRef(null)
    /** 模块4：手动改过的标题/正文（key = copy.id），失焦时存到主机侧 */
    const [copyDrafts, setCopyDrafts] = useState({})
    /** 模块4：Skill 技能指令草稿（null = 还没改过，用设置里存的那份） */
    const [skillDraft, setSkillDraft] = useState(null)
    const [copies, setCopies] = useState([])
    const [copiesNote, setCopiesNote] = useState('')
    const [layouts, setLayouts] = useState([])
    /** 模块5：上传的模板图片信息（主机侧存在设置的 layoutTemplate 里） */
    const [templateMeta, setTemplateMeta] = useState(null)
    /** 模块5：模板文件夹里的图片清单（点缩略图切换用） */
    const [templateList, setTemplateList] = useState([])
    /** 模块5：模板文件夹的绝对路径（界面上显示出来，方便用户自己去找） */
    const [templateDirPath, setTemplateDirPath] = useState('')
    /** 模块5：本地 Canvas 生成的成品图（key = 文案 id） */
    const [layoutMap, setLayoutMap] = useState({})
    const [sop, setSop] = useState(null)
    const [logText, setLogText] = useState('')
    const [settingsDraft, setSettingsDraft] = useState(null)
    /** 模块2：抓取进度（主机侧 GET fetchProgress 轮询来的） */
    const [progress, setProgress] = useState(null)
    /** 模块2：本次抓取相比上次新增的条目（{ count, titles }），抓完展示一次 */
    const [newInfo, setNewInfo] = useState(null)
    /** 模块2：这一屏里"已经存过"的条目（link / 标题 → true），存过的按钮变"已存入"并禁用。
     *  用 useState 是为了存成功后按钮能立刻变样；ref 只用来做去重判断。 */
    const [savedKeys, setSavedKeys] = useState({})
    const savedRef = useRef({})
    const mounted = useRef(true)
    /** 进度轮询的 setTimeout 句柄（卸载/结束时清掉，别留着空转） */
    const progressTimer = useRef(null)

    /** 一条条目的去重键（优先链接，没链接就用标题） */
    const keyOfSaves = useCallback((item) => {
      if (!item) return ''
      const link = String(item.link || '').trim()
      if (link) return `link:${link}`
      const title = String(item.title || '').trim()
      return title ? `title:${title}` : ''
    }, [])

    /** 记下"这条已经存过了"（ref 判重用，state 管按钮长相） */
    const rememberSaved = useCallback(
      (item) => {
        const key = keyOfSaves(item)
        if (!key) return
        if (savedRef.current[key]) return
        savedRef.current[key] = true
        if (mounted.current) setSavedKeys(Object.assign({}, savedRef.current))
      },
      [keyOfSaves],
    )

    /**
     * 已存过的条目：从主机侧的选题库列表重建一份映射（link 优先，没链接用标题）。
     * 每次都用完整列表**重建**（不是往旧的里合并），这样删掉的条目不会留下旧标记。
     */
    const syncSavedFromTopics = useCallback(
      (list) => {
        const next = {}
        for (const topic of Array.isArray(list) ? list : []) {
          const key = keyOfSaves(topic)
          if (key) next[key] = true
        }
        savedRef.current = next
        if (mounted.current) setSavedKeys(next)
      },
      [keyOfSaves],
    )

    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
        if (progressTimer.current) clearTimeout(progressTimer.current)
        progressTimer.current = null
        if (newDotTimer.current) clearTimeout(newDotTimer.current)
        newDotTimer.current = null
      }
    }, [])

    /**
     * 失败提示**3 秒后自动消失**。
     * 按需求：报错弹窗不许一直挂在顶上挡着 —— 它会盖住顶部那一块、还影响点别的按钮。
     * 依赖里带上 errorTick：同一个错误连着报两次时也能重新开始计时。
     */
    useEffect(() => {
      if (!error) return undefined
      const timer = setTimeout(() => {
        if (mounted.current) setError('')
      }, 3000)
      return () => clearTimeout(timer)
    }, [error, errorTick])

    /**
     * 模块2：切某个网站那一组的页码。
     * ⚠ 按需求：**不自动滚动** —— 翻页时保持当前滚动位置，用户自己在哪儿就还在哪儿。
     */
    const setGroupPage = (source, next, pageCount) => {
      const target = Math.min(Math.max(1, next), Math.max(1, pageCount))
      setSitePages((pages) => Object.assign({}, pages, { [source]: target }))
    }

    /** 模块3：切候选页码（同样不自动滚动，保持当前位置） */
    const goPage = (next, pageCount) => {
      setPage(Math.min(Math.max(1, next), Math.max(1, pageCount)))
    }

    const run = useCallback(async (label, fn) => {
      setBusy(label)
      setError('')
      try {
        return await fn()
      } catch (err) {
        const message = (err && err.message) || String(err)
        // 上一次还在跑：只给一句话，后面的解释全部去掉
        const busyMessage = /还在进行中|还没结束|进度条在转/.test(message)
        // 按需求：筛选核实这一屏的失败提示统一成一句「请稍后重试」
        // 按需求：筛选核实这一屏的失败提示统一成一句「请稍后重试」，
        // 写文案这一屏统一成「无信息」（不要长篇解释）
        const shortMap = { 筛选: '请稍后重试', 核实: '请稍后重试', 写文案: '无信息' }
        if (mounted.current) {
          setError(shortMap[label] || (busyMessage ? `${label}失败，请稍后重试` : `${label}失败：${message}`))
          // 让"3 秒自动消失"的计时重新开始（同一个错误连着报两次也要重新计时）
          setErrorTick((tick) => tick + 1)
        }
        return null
      } finally {
        if (mounted.current) setBusy('')
      }
    }, [])

    const flash = useCallback((text) => {
      setNotice(text)
      setTimeout(() => {
        if (mounted.current) setNotice('')
      }, 2400)
    }, [])

    const refreshAll = useCallback(
      () =>
        run('读取数据', async () => {
          let hostDownReason = ''
          const safeGet = (action) =>
            api.get(action).catch((err) => {
              if (!hostDownReason) hostDownReason = (err && err.message) || String(err)
              return null
            })
          const safePost = (action, payload) =>
            api.post(action, payload).catch((err) => {
              if (!hostDownReason) hostDownReason = (err && err.message) || String(err)
              return null
            })
          const [setRes, statusRes, topicRes, fetchRes, candRes, copyRes, layoutRes, sopRes] = await Promise.all([
            safeGet('settings'),
            safeGet('status'),
            safePost('load', { what: 'topics' }),
            safePost('load', { what: 'fetch' }),
            safePost('load', { what: 'candidates' }),
            safePost('load', { what: 'copies' }),
            safePost('load', { what: 'layouts' }),
            safePost('load', { what: 'sop' }),
          ])
          if (!mounted.current) return null
          if (!statusRes && !setRes) {
            throw new Error(`连不上主机侧接口（/xmt-kf/api）。请确认插件已启用并重启过 DSH。原始错误：${hostDownReason || '未知'}`)
          }
          if (setRes) setSettings(setRes.settings)
          if (setRes && setRes.filterDefaults) setFilterDefaults(setRes.filterDefaults)
          if (statusRes) setStatusData(statusRes)
          if (topicRes) setTopics(topicRes.topics || [])
          if (fetchRes) setFetchData(fetchRes)
          if (candRes) setCandidates(candRes.candidates || [])
          if (copyRes) setCopies(copyRes.copies || [])
          if (layoutRes) {
            setLayouts(layoutRes.layouts || [])
            // 做图排版的模板信息（主机侧存在设置里，刷新页面后也读得回来）
            if (layoutRes.template) setTemplateMeta(layoutRes.template)
          }
          if (sopRes) setSop(sopRes)
          return true
        }),
      [run],
    )

    useEffect(() => {
      refreshAll()
    }, [refreshAll])

    const refreshStatus = useCallback(async () => {
      try {
        const data = await api.get('status')
        if (mounted.current) setStatusData(data)
      } catch (err) {
        /* 状态读不到不影响用 */
      }
    }, [])

    // ---- 动作 -------------------------------------------------------------

    /**
     * 抓取进度轮询：抓取是"一次请求跑到底"，界面要知道进度就得问主机侧。
     * 每 800ms 拉一次 GET fetchProgress，直到它说 running=false。
     * 用 setTimeout 自递归（不用 setInterval），结束/卸载时都清得干净。
     */
    const stopProgressPoll = useCallback(() => {
      if (progressTimer.current) clearTimeout(progressTimer.current)
      progressTimer.current = null
    }, [])

    const pollProgress = useCallback(() => {
      // 已经在轮询里了就不再叠一条循环（连点两次「开始抓取」也不会出现两套计时器）
      if (progressTimer.current) return
      progressTimer.current = setTimeout(async () => {
        progressTimer.current = null
        if (!mounted.current) return
        try {
          const data = await api.get('fetchProgress')
          if (!mounted.current) return
          setProgress(data || null)
          if (data && data.running) {
            pollProgress()
            return
          }
        } catch (err) {
          /* 进度读不到不影响抓取本身，停掉轮询就行 */
        }
        if (mounted.current) setProgress((prev) => (prev && prev.running ? Object.assign({}, prev, { running: false, percent: 100, phase: 'done' }) : prev))
      }, 800)
    }, [stopProgressPoll])

    const doFetch = () =>
      run('抓取', async () => {
        // 抓之前先把"上一次"的链接记下来，抓完对比出本次新增
        const beforeItems = (fetchData && fetchData.items) || []
        const beforeKeys = new Set(beforeItems.map((item) => (item && item.link) || (item && item.title) || ''))
        // 先摆一个"刚开始"的进度条，第一帧就有反馈（不用等主机侧第一次轮询）
        const total = (settings && Array.isArray(settings.websites) ? settings.websites.length : 0) || (fetchData && fetchData.sites ? fetchData.sites.length : 0)
        setProgress({ running: true, done: 0, total, currentSite: settings && settings.websites && settings.websites[0] ? settings.websites[0].name : '', phase: 'site', items: 0, failures: 0, percent: 0 })
        setNewInfo(null)
        pollProgress()
        try {
          const data = await api.post('fetch', {})
          setFetchData(data)
          await refreshStatus()
          const items = (data && data.items) || []
          const count = data && data.groups ? data.groups.reduce((sum, g) => sum + g.items.length, 0) : 0
          const dated = items.filter((item) => item && item.date).length
          // 本次新增 = 这次的条目里，上一次没见过的（第一次抓取不算"新增"，只报总数）
          const fresh = beforeKeys.size ? items.filter((item) => !beforeKeys.has((item && item.link) || (item && item.title) || '')) : []
          setNewInfo(beforeKeys.size ? { count: fresh.length, titles: fresh.map((item) => item.title).filter(Boolean) } : null)
          // 每条新增的帖子右下角点亮一颗红点，8 秒后自动消失
          if (newDotTimer.current) clearTimeout(newDotTimer.current)
          newDotTimer.current = null
          if (fresh.length) {
            const marks = {}
            for (const item of fresh) {
              const key = keyOfSaves(item)
              if (key) marks[key] = true
            }
            setNewKeys(marks)
            newDotTimer.current = setTimeout(() => {
              newDotTimer.current = null
              if (mounted.current) setNewKeys({})
            }, 8000)
          } else {
            setNewKeys({})
          }
          // 抓完就把进度条收掉（只留「最近抓取」那行状态，别一直挂着 100% 的条）
          setProgress(null)
          // 提示词按需求统一简化成一句「抓取完成」（新增几条、共几条都不再往外报）
          flash('抓取完成')
        } finally {
          stopProgressPoll()
        }
      })

    /**
     * 筛选。range 传时间档位；不传就用当前选中的档位。
     * （直接当 onClick 用时 React 会把事件对象塞进来，所以这里判一下类型）
     */
    const doFilter = (range) =>
      run('筛选', async () => {
        const useRange = typeof range === 'string' ? range : filterRange
        const data = await api.post('filter', { range: useRange })
        setCandidates(data.candidates || [])
        setFilterMeta(data)
        setPage(1) // 重新筛选回到第 1 页
        await refreshStatus()
        flash('筛选完成')
      })

    /** 切换时间档位：立刻按新档位重新筛一次 */
    const changeFilterRange = (next) => {
      setFilterRange(next)
      doFilter(next)
    }

    /**
     * 核实通过（**一条一条来**）。
     * 确认后这条从列表里消失；数据还在主机侧 drafts.json 里，不删。
     */
    const doConfirmOne = (candidate) =>
      run('核实', async () => {
        if (!candidate || !candidate.id) throw new Error('这条没有 id，没法核实')
        const data = await api.post('confirm', { ids: [candidate.id] })
        // 主机侧会把 confirmed=true 一起回来；万一没带，这里也把它标上 ——
        // 总之点完这条必须立刻从列表里消失（数据还在主机侧）。
        const list = (data && data.candidates) || candidates
        setCandidates(list.map((item) => (item.id === candidate.id && !item.confirmed ? Object.assign({}, item, { confirmed: true }) : item)))
        await refreshStatus()
        flash('已核实')
      })

    /**
     * 选题库 → 写文案：先把正文摆好（不调大模型），并让这条从选题库列表里消失。
     * ⚠ 按需求：**不跳转**。写完留在当前这一页（通常是「① 选题库」），
     *   列表里的这条会自己消失（已写过文案的不再展示），想去写文案自己点进去。
     */
    const doWriteFromTopic = (topic) =>
      run('写文案', async () => {
        const data = await api.post('writeFromTopics', { ids: [topic && topic.id] })
        if (data && Array.isArray(data.copies)) setCopies(data.copies)
        // 已写过的选题不再展示：重新拉一遍选题库
        const list = await api.post('load', { what: 'topics' }).catch(() => null)
        if (list && Array.isArray(list.topics)) setTopics(list.topics)
        await refreshStatus()
        flash('已写好')
      })

    /** AI 润色：调大模型把当前正文改得更像真人说话（写文案模块里唯一会调模型的地方） */
    const doPolish = (copy) =>
      run('AI 润色', async () => {
        const text = String((copyDrafts[copy.id] && copyDrafts[copy.id].body) || copy.bodyAfterDeAi || copy.body || '')
        if (!text.trim()) throw new Error('正文是空的')
        const data = await api.post('polish', { id: copy.id, text })
        if (data && typeof data.text === 'string') {
          setCopyDrafts((drafts) => Object.assign({}, drafts, { [copy.id]: Object.assign({}, drafts[copy.id] || {}, { body: data.text, saved: true }) }))
          setCopies((list) => list.map((item) => (item.id === copy.id ? Object.assign({}, item, { body: data.text, bodyAfterDeAi: data.text, polished: true, needsPolish: false, generatedBy: `AI 润色（${data.model || '大模型'}）` }) : item)))
        }
        flash('润色完成')
      })

    /**
     * 保存手动改过的标题/正文（正文框失焦时也会自动调，那种情况传 silent=true）。
     * ⚠ silent 会一起发给主机侧：**只有用户真的点「保存」**才会把这标记成"可进做图排版"，
     *   失焦自动存只是别把内容丢了，不算"这篇我确认了"。
     */
    const doUpdateCopy = (id, patch, silent) =>
      run('保存文案', async () => {
        const data = await api.post('updateCopy', Object.assign({ id, silent: !!silent }, patch))
        if (data && Array.isArray(data.copies)) setCopies(data.copies)
        if (!silent) flash('已保存')
      })

    /** 读取上传的 Skill 技能指令文件（.txt / .md） */
    const readSkillFile = (event) => {
      const file = event && event.target && event.target.files && event.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => setSkillDraft(String(reader.result || '').slice(0, 4000))
      reader.onerror = () => flash('文件读取失败')
      reader.readAsText(file, 'utf-8')
    }

    /** 保存 Skill 技能指令到设置里 */
    const doSaveSkill = () =>
      run('保存技能指令', async () => {
        const next = Object.assign({}, settings || {}, { skillText: String(skillDraft || '').slice(0, 4000) })
        const data = await api.post('saveSettings', { settings: next })
        setSettings(data.settings || next)
        setSkillDraft(null)
        flash('技能指令已保存')
      })

    /** 模块5：可以做图的帖子 = 「④ 写文案」里点过「保存」的 */
    const layoutSourceCopies = copies.filter((copy) => copy && copy.savedByUser)

    /**
     * 进「① 选题库 / ③ 筛选核实 / ④ 写文案 / ⑤ 封面标签」时**自动刷一次**
     * （用户不用先点右上角的刷新）。
     * ⚠ 用 ref 记账：同一屏只在"这次进入"时刷一次，避免数据一变就反复刷（会打转）。
     */
    const autoRefreshedFor = useRef('')
    useEffect(() => {
      // ⚠ 离开模块（回主页 / 去设置页）要把账清掉，否则"同一屏只刷一次"会变成
      //   "这辈子只刷一次"：第二次进同一个模块就不再自动刷新了。
      if (screen !== 'module' || !moduleId) {
        autoRefreshedFor.current = ''
        return undefined
      }
      if (moduleId !== 'm1' && moduleId !== 'm3' && moduleId !== 'm4' && moduleId !== 'm5') {
        autoRefreshedFor.current = ''
        return undefined
      }
      if (autoRefreshedFor.current === moduleId) return undefined
      autoRefreshedFor.current = moduleId
      if (moduleId === 'm1') refreshAll()
      else if (moduleId === 'm3') doFilter(filterRange)
      else if (moduleId === 'm4') doWriteCopy()
      else {
        run('刷新封面标签', async () => {
          await reloadCopiesFromHost()
          return await doLayoutRefresh()
        })
      }
      return undefined
      // 只认"进了哪一屏"；其余依赖故意不写进依赖数组（写进去会在数据变化时反复触发）
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screen, moduleId])

    /**
     * busy 看门狗（防死锁）。
     * 所有按钮都写着 `disabled: !!busy`，只要有一个动作的 Promise 永远不返回
     * （主机侧卡住、请求挂起、图片请求把浏览器的连接数占满…），整页按钮就会一直锁死，
     * 表现就是"点什么都没反应，只能刷新浏览器"。
     * 这里兜一道：30 秒还没结束就强制解锁并给一句提示。
     * ⚠ 依赖里带上 `progress`：抓取是"一次请求跑到底"的长活，进度每 800ms 变一次，
     *   会把计时器顶掉重置 —— 也就是说**正在抓取时不会误判**，只有真的卡住（进度不动）才会触发。
     */
    useEffect(() => {
      if (!busy) return undefined
      const timer = setTimeout(() => {
        if (!mounted.current) return
        setBusy('')
        setError('上一个操作卡住了，已经自动解锁，请再点一次')
        setErrorTick((tick) => tick + 1)
      }, 30000)
      return () => clearTimeout(timer)
      // progress 故意放进依赖：进度一变就重新计时（抓取不会被打断）
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [busy, progress])

/**
 * 从主机侧重新读一遍「④ 写文案」的稿子。
 * 「⑤ 封面标签」刷新时必须先走这一步：这样"刚在写文案里点过保存"的帖子一定看得见
 * （用户反馈的第 5 个问题：写文案里保存的帖子，进封面标签点刷新刷不出来）。
 */
    const reloadCopiesFromHost = async () => {
      const fresh = await api.post('load', { what: 'copies' }).catch(() => null)
      if (fresh && Array.isArray(fresh.copies)) {
        if (mounted.current) setCopies(fresh.copies)
        return fresh.copies
      }
      return copies
    }
    /** 模块5：打开模板文件夹（真的唤起资源管理器），打开完顺手把清单刷新一遍 */
    const doOpenTemplateFolder = () =>
      run('打开模板文件夹', async () => {
        const data = await api.post('openTemplateFolder', {}).catch(() => null)
        if (!mounted.current) return null
        if (data && Array.isArray(data.templates)) setTemplateList(data.templates)
        if (data && data.dir) setTemplateDirPath(data.dir)
        if (!data || data.opened === false) flash('打不开文件夹，请手动打开这个路径')
        else flash(data.action === 'reused' ? '模板文件夹已经在资源管理器里了' : '已打开模板文件夹')
        return data
      })

    /**
     * 模块5：点缩略图选一张模板 → 它就是当前封面底图。
     * ⚠ 按需求：**不往图片上叠任何标题/正文**，所以这里只要把"选中哪张"记下来就行。
     */
    const doUseTemplate = (file) =>
      run('应用模板', async () => {
        if (!file) throw new Error('没有拿到模板文件名')
        const data = await api.post('useTemplate', { file })
        if (data && data.template) setTemplateMeta(data.template)
        if (data && Array.isArray(data.templates)) setTemplateList(data.templates)
        if (!mounted.current) return null
        flash(`已应用模板 ${file}`)
        return data
      })
    /**
     * 模块5：提交一批标签（TagEditor 改动时调）。
     * ⚠ 按需求：标签只是界面上的文案，不再画进图片里 —— 所以这里只把标签记下来。
     */
    const commitTags = (copy, tags) => {
      const clean = (tags || [])
        .map((tag) => String(tag === undefined || tag === null ? '' : tag).replace(/^#+/, ''))
        .slice(0, 20)
      const title = String((copy.titles || [])[0] || copy.sourceTitle || '').trim() || '（无标题）'
      setLayoutMap((state) => {
        const entry = state[copy.id] || {}
        return Object.assign({}, state, { [copy.id]: Object.assign({}, entry, { tags: clean, title }) })
      })
    }
    /** 模块5：加一个空标签（用户自己填） */
    const doAddTag = (copy, tags) => {
      commitTags(copy, (tags || []).concat(['新标签']).slice(0, 20))
    }
    /** 模块5：删掉这篇（文案一起删，来源放回「② 扫源抓取」，跟写文案那边一个口径） */
    const doDeleteLayout = (copy) =>
      run('删除文案', async () => {
        const goneId = copy && copy.id
        const data = await api.post('deleteCopy', { id: goneId })
        /**
         * ⚠ 不管主机侧有没有回一份完整列表，本地都要把这条"抠掉"。
         *   以前只在 `data.copies` 是数组时才更新，一旦返回体缺字段这条就留在界面上不动，
         *   帖子对应的封面也跟着一直显示（"删了帖子封面还在"就是这个）。
         */
        setCopies((list) => {
          const source = data && Array.isArray(data.copies) ? data.copies : list
          return source.filter((item) => item && String(item.id) !== String(goneId))
        })
        if (goneId) {
          setLayoutMap((state) => {
            const next = Object.assign({}, state)
            delete next[goneId]
            return next
          })
          setCopyDrafts((drafts) => {
            const next = Object.assign({}, drafts)
            delete next[goneId]
            return next
          })
        }
        const [candRes, topicRes] = await Promise.all([
          api.post('load', { what: 'candidates' }).catch(() => null),
          api.post('load', { what: 'topics' }).catch(() => null),
        ])
        if (candRes && Array.isArray(candRes.candidates)) setCandidates(candRes.candidates)
        if (topicRes && Array.isArray(topicRes.topics)) {
          setTopics(topicRes.topics)
          syncSavedFromTopics(topicRes.topics)
        }
        await refreshStatus()
        flash('已删除')
      })

    /** 模块4：删掉一条文案（来源退回上游；**按需求留在原地**，不再跳去「② 扫源抓取」） */
    const doDeleteCopy = (copy) =>
      run('删除文案', async () => {
        const data = await api.post('deleteCopy', { id: copy && copy.id })
        if (data && Array.isArray(data.copies)) setCopies(data.copies)
        else setCopies((list) => list.filter((item) => item.id !== (copy && copy.id)))
        // 顺带把这条的编辑草稿清掉，免得留着旧内容
        if (copy && copy.id) {
          setCopyDrafts((drafts) => {
            const next = Object.assign({}, drafts)
            delete next[copy.id]
            return next
          })
        }
        // 这条的来源被"退回上游"了：重新拉一遍候选和选题库，
        // 保证「③ 筛选核实」里**立刻**能看到它（未核实状态，可以再点一次核实通过）。
        const [candRes, topicRes] = await Promise.all([
          api.post('load', { what: 'candidates' }).catch(() => null),
          api.post('load', { what: 'topics' }).catch(() => null),
        ])
        if (candRes && Array.isArray(candRes.candidates)) setCandidates(candRes.candidates)
        if (topicRes && Array.isArray(topicRes.topics)) {
          setTopics(topicRes.topics)
          syncSavedFromTopics(topicRes.topics)
        }
        await refreshStatus()
        flash('已删除')
        // ⚠ 按需求：删除后**留在写文案这一页**（以前会跳回「② 扫源抓取」）
      })

    /**
     * 模块4：右上角那个「刷新」。
     * 主机侧只是把原文的完整标题 + 完整正文原封不动搬进来（不改写、不加链接、不调模型）。
     */
    const doWriteCopy = () =>
      run('写文案', async () => {
        const data = await api.post('writeCopy', {})
        setCopies(data.copies || [])
        setCopiesNote(data.note || '')
        await refreshStatus()
        flash(`已刷新 ${(data.copies || []).length} 篇`)
      })

    /**
     * 「⑤ 封面标签」的刷新主体（右上角「刷新」和"进模块自动刷"都走它）：
     *   ① 先从主机侧重读「④ 写文案」的稿子（保证刚保存的帖子一定在）；
     *   ② 拉模板文件夹清单；
     *   ③ 没选模板就自动用最新那张；
     *   ④ 用当前模板把所有帖子重画一遍（纯本地 Canvas，不调大模型）。
     */
    const doLayoutRefresh = async () => {
      await reloadCopiesFromHost()
      /**
       * ⚠ 这一步以前是直接 `await api.post('layout', {})`：没有保存过的帖子时主机侧返回
       *   ok:false，接口层会抛错，后面"拉模板清单"那段就整段跳过了 ——
       *   结果模板缩略图永远是空的，用户点哪张都没反应（"切换模板没反应"的一半原因）。
       *   现在改成"拿不到就当空列表"，模板清单无论如何都要拉。
       */
      const data = (await api.post('layout', {}).catch(() => null)) || null
      setLayouts((data && data.layouts) || [])
      if (data && data.template) setTemplateMeta(data.template)
      const savedPosts = ((data && data.layoutItems) || []).slice()
      // 帖子被删过的话，清掉它已经不存在的成品图缓存
      const alive = new Set(savedPosts.map((item) => item.id))
      setLayoutMap((state) => {
        const next = {}
        for (const key of Object.keys(state)) if (alive.has(key)) next[key] = state[key]
        return next
      })
      await refreshStatus()
      const listRes = await api.get('listTemplates').catch(() => null)
      const templates = (listRes && listRes.templates) || []
      setTemplateList(templates)
      if (listRes && listRes.dir) setTemplateDirPath(listRes.dir)
      if (!savedPosts.length) {
        flash('写文案里还没有点过「保存」的帖子')
        return { count: 0 }
      }
      let active = (data && data.template && data.template.file) || (listRes && listRes.active) || ''
      if (!active && templates.length) active = templates[0].file
      if (!active) return { count: savedPosts.length }
      if (active !== ((data && data.template && data.template.file) || '')) {
        // 自动选了最新那张模板：顺手设为当前使用（失败也不影响出图）
        const used = await api.post('useTemplate', { file: active }).catch(() => null)
        if (used && used.template) setTemplateMeta(used.template)
      }
      flash(`已刷新 ${savedPosts.length} 篇`)
      return { count: savedPosts.length }
    }

    /** 右上角「刷新」按钮 */
    const doLayout = () => run('排版', async () => doLayoutRefresh())

    /**
     * 存入选题库。
     * 主机侧按 link（没链接就用 title）判重：已存过会返回 added=false，
     * 这时候不能再喊"已存入"，要说清楚"没重复存"。
     * @param {object} item 条目
     * @param {boolean} [withCancel] 是否返回"撤销标记"的回调（模块2 的按钮用它做乐观更新：
     *        存失败时立刻把按钮恢复成可点的「存入选题库」）
     * 返回 true/false 给调用方判断成功与否。
     */
    const doSaveTopic = (item, withCancel) =>
      run('存入选题库', async () => {
        const key = keyOfSaves(item)
        // 先把按钮点掉（已存入 + 变灰），失败再恢复 —— 用户点了要立刻有反应
        if (withCancel) rememberSaved(item)
        const cancel = () => {
          if (!key) return
          if (savedRef.current[key]) {
            delete savedRef.current[key]
            if (mounted.current) setSavedKeys(Object.assign({}, savedRef.current))
          }
        }
        let data = null
        try {
          data = await api.post('saveTopic', { item })
        } catch (err) {
          cancel()
          throw err
        }
        if (data && Array.isArray(data.topics)) setTopics(data.topics)
        else {
          const list = await api.post('load', { what: 'topics' }).catch(() => null)
          if (list && Array.isArray(list.topics)) setTopics(list.topics)
        }
        await refreshStatus()
        rememberSaved(item)
        if (data && data.added === false) {
          flash('已存入')
          return withCancel ? cancel : false
        }
        // 提示词按需求统一简化成一句「已存入」（标题不再往外报）
        flash('已存入')
        return withCancel ? cancel : true
      })

    /**
     * 删除一条选题。
     * 主机侧现在会把删除后的完整列表一起返回，所以这里**局部更新** state，
     * 不再拿一个空数组去覆盖（之前就是这个把整页清空的）。
     * 删除后要把"已存过"的标记一起清掉：再回模块2，这条会恢复成可点的「存入选题库」。
     */
    const doDeleteTopic = (topic) =>
      run('删除选题', async () => {
        const data = await api.post('deleteTopic', { id: topic && topic.id })
        setTopics((list) => {
          if (data && Array.isArray(data.topics)) return data.topics
          return list.filter((item) => !topic || item.id !== topic.id)
        })
        // 从"已存过"里去掉（link 优先，没链接用标题）
        const key = keyOfSaves(topic)
        if (key && savedRef.current[key]) {
          delete savedRef.current[key]
          if (mounted.current) setSavedKeys(Object.assign({}, savedRef.current))
        }
        // 兜底：万一 key 对不上（老记录没有 link），按标题再匹配一遍
        const title = String((topic && topic.title) || '').trim()
        if (title) {
          const legacy = keyOfSaves({ title })
          if (legacy && savedRef.current[legacy]) {
            delete savedRef.current[legacy]
            if (mounted.current) setSavedKeys(Object.assign({}, savedRef.current))
          }
        }
        await refreshStatus()
        // 提示词按需求统一简化成一句「已删除」
        flash('已删除')
      })

    const doSaveSettings = (next) =>
      run('保存设置', async () => {
        const data = await api.post('saveSettings', { settings: next })
        setSettings(data.settings || next)
        setSettingsDraft(null)
        flash('设置已保存')
      })

    /**
     * 一键跑「抓取 → 筛选」（到核实处停下）。
     * ⚠ 目前**界面上没有按钮调它**：原控制室的「开始全部」和后来的底部一行都按需求删掉了。
     *   逻辑保留着，以后想在模块区补一个入口（比如放在入口卡里）直接接上就行。
     */
    const doStartAll = () =>
      run('一键开始全部', async () => {
        const fetched = await api.post('fetch', {})
        setFetchData(fetched)
        const filtered = await api.post('filter', {})
        setCandidates(filtered.candidates || [])
        setFilterMeta(filtered)
        await refreshStatus()
        flash('抓取 + 筛选完成，去「③ 筛选核实」确认')
      })

    const doLoadLog = () =>
      run('读取日志', async () => {
        const data = await api.get('log')
        setLogText((data && data.log) || '（日志是空的）')
      })

    // ---- 派生（展示用，不动数据模型） --------------------------------------

    /** Skill 技能指令：界面上改过就用草稿，否则用设置里存的那份 */
    const effectiveSkill = skillDraft !== null ? skillDraft : String((settings && settings.skillText) || '')
    /** 大模型有没有配好（没配就提示"请先配置模型"，并退回本地规则） */
    const modelConf = (settings && settings.model) || {}
    const modelReady = !!(String(modelConf.apiKey || '').trim() && String(modelConf.baseUrl || '').trim())

    const counts = (statusData && statusData.counts) || {}
    const stageText = useMemo(() => {
      const status = (statusData && statusData.status) || {}
      const labels = { idle: '还没开始', fetched: '已抓取', filtered: '已筛选', confirmed: '已核实', wrote: '已写文案', laid: '已排版', published: '已发布' }
      return labels[status.stage] || labels.idle
    }, [statusData])
    /**
     * 模块3 里"还没核实"的候选（核实通过的从界面消失，数据仍在主机侧）。
     * 分页：每页 5 条，翻页能看完所有候选（不通过也能往后翻）。
     * ⚠ 已经存进「① 选题库」的在这里也要滤掉（按需求：存过的别在筛选核实里重复出现）。
     *   用界面上的 topics 直接算，所以刚点完「存入选题库」回来看就已经没了，不用等重新筛选。
     */
    const topicKeys = new Set(topics.map((topic) => keyOfSaves(topic)))
    /**
     * 已经「核实通过」的条目（按 link/title 去重键）。
     * 用途：模块2（扫源抓取）也要把核实过的条目扣掉 —— 用户反馈"核实通过后扫源的数量没减"。
     * 用界面上的 candidates 现算，所以刚点完「✓ 核实通过」，回扫源抓取就已经看不到了。
     */
    const confirmedKeys = new Set(candidates.filter((item) => item && item.confirmed).map((item) => keyOfSaves(item)))
    /**
     * 模块2（扫源抓取）**当前列表的真实条数** —— 一次算好，列表和标题栏共用同一份，
     * 所以"顶部数字"和"实际看到的条数"永远不会对不上。
     */
    const m2VisibleGroups = (fetchData && fetchData.groups ? fetchData.groups : [])
      .map((group) => Object.assign({}, group, { items: (group.items || []).filter((item) => !savedKeys[keyOfSaves(item)] && !confirmedKeys.has(keyOfSaves(item))) }))
      .filter((group) => group.items.length)
    const m2VisibleCount = m2VisibleGroups.reduce((sum, group) => sum + group.items.length, 0)
    const pendingCandidates = candidates.filter((item) => !item.confirmed && !topicKeys.has(keyOfSaves(item)))
    const confirmedCount = candidates.length - pendingCandidates.length
    const PAGE_SIZE = 5
    const pageCount = Math.max(1, Math.ceil(pendingCandidates.length / PAGE_SIZE))
    const safePage = Math.min(Math.max(1, page), pageCount)
    const pageItems = pendingCandidates.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    const busyText = busy ? `正在${busy}…` : ''
    /**
     * 模块卡片的状态文字。
     * ⚠ 模块3 / 模块4 的数字要跟**二级页列表里真实看得到的条数**一致：
     *   · 模块3 = 还没核实的候选（核实通过的和已存选题库的都不算）
     *   · 模块4 = 还没点过「保存」的稿子（保存过的已经归做图排版了）
     *   这两个都用界面现有的数据现算，所以点完立刻就是对的，不用等主机侧刷新。
     */
    const statusOf = (module) => {
      try {
        const base = (statusData && statusData.status) || {}
        if (module.id === 'm3') return `候选 ${pendingCandidates.length} 条`
        if (module.id === 'm4') {
          const pending = copies.filter((copy) => copy && !copy.savedByUser).length
          return `已就绪 · ${pending} 篇`
        }
        return module.getStatus(base, counts)
      } catch (err) {
        return '状态读取失败'
      }
    }

    /** 模块状态 -> 色调（未开始灰 / 进行中蓝 / 已完成绿 / 等待确认·部分失败黄） */
    const toneOf = (module) => {
      try {
        const status = (statusData && statusData.status) || {}
        const raw = String(status[`module${module.id.slice(1)}`] || '')
        // 按需求：模块3（筛选核实）的状态栏固定走"已完成"绿（它只显示候选条数）；
        // 模块4（写文案）**只有真有内容（还没保存的稿子 ≥ 1 篇）才发绿光**，0 篇时不发光。
        if (module.id === 'm3') return TONE.done
        if (module.id === 'm4') {
          const pending = copies.filter((copy) => copy && !copy.savedByUser).length
          return pending > 0 ? TONE.done : TONE.idle
        }
        if (/失败|错误|待确认|等待确认|需确认/.test(raw)) return TONE.wait
        if (module.id === 'm1') return (counts.topics || 0) > 0 ? TONE.done : TONE.idle
        if (module.id === 'm2') return (counts.fetchedPending || counts.fetched || 0) > 0 ? TONE.done : TONE.run
        if (module.id === 'm5') return layoutSourceCopies.length > 0 ? TONE.done : TONE.idle
        return TONE.idle
      } catch (err) {
        return TONE.idle
      }
    }

    /**
     * 模块卡片右下角那个数字（该模块最关心的一件事）。
     * ⚠ 目前卡片上**不再单独显示数字**了（各位状态文字里已经带着"X 条/X 篇"，重复）；
     *   函数保留着，以后想再挂个角标直接用。
     */
    const numOf = (module) => {
      if (module.id === 'm1') return `${counts.topics || 0}`
      if (module.id === 'm2') return `${counts.fetched || 0}`
      if (module.id === 'm3') return `${counts.candidates || 0}`
      if (module.id === 'm4') return `${counts.copies || 0}`
      if (module.id === 'm5') return `${counts.layouts || 0}`
      return ''
    }

    /**
     * 模块的一句话说明（纯文案，没有业务逻辑）。
     * ⚠ 现在界面上**没有地方用它**：卡片上的说明文字、二级页标题下的副标题都按需求删掉了。
     *   留着是为了以后想在哪显示一句简介时直接取用（比如卡片 hover 提示、二级页卡片底部）。
     */
    const descOf = (module) => {
      const map = {
        m1: '顺手存下来的题目都在这儿，随时回来挑。',
        m2: '按设置里的网站清单抓最近几天的资讯，每条都会去详情页读真实发布时间。',
        m3: '6 条标准勾中 1 项就进候选（一条条核实，核实完不再显示）。',
        m4: '本地规则出标题 + 正文，语气还要自己顺一遍。',
        m5: '封面大字 + 卡片文案，拿去 Canva 套模板就能做图。',
      }
      return map[module.id] || ''
    }

    const enterModule = (id) => {
      setModuleId(id)
      setScreen('module')
    }

    /** 进模块2（或选题库刷新后）时，把"已存过"的标记跟主机侧的选题库对齐一次 */
    useEffect(() => {
      if (screen !== 'module' || moduleId !== 'm2') return
      syncSavedFromTopics(topics)
    }, [screen, moduleId, topics, syncSavedFromTopics])

    const goMain = () => setScreen('main')

    const openWorkbenchScreen = (screenName) => setScreen(screenName)

    // ---- 二级页的操作按钮（统一放在标题行右侧，同一行显示） ---------------

    /**
     * 每个模块的动作按钮。
     * 说明：以前这些按钮各自占一整行放在结果区上方，现在按需求挪到
     *       「返回 + 模块名 + 状态」那一行的右边，一行放得下就一行。
     */
    const actionsFor = (module) => {
      if (module.id === 'm1') return [h(Btn, { key: 'refresh', disabled: !!busy, onClick: refreshAll }, '刷新列表')]
      if (module.id === 'm2') return [h(Btn, { key: 'fetch', primary: true, loading: busy === '抓取', loadingText: '抓取中…', disabled: !!busy, onClick: doFetch }, '开始抓取')]
      if (module.id === 'm3') {
        // 按需求：不再有「换一批」，也不再批量核实（核实通过改成每条右上角一个小按钮）
        return [h(Btn, { key: 'filter', primary: true, loading: busy === '筛选', loadingText: '筛选中…', disabled: !!busy, onClick: doFilter }, '开始筛选')]
      }
      if (module.id === 'm4') {
        // 按需求：右上角只留一个「刷新」——
        // 点是"把原文的完整标题 + 完整正文原封不动搬进来"，这一步不调大模型
        return [h(Btn, { key: 'write', primary: true, loading: busy === '写文案', loadingText: '刷新中…', disabled: !!busy, onClick: doWriteCopy, title: '把原文的完整标题和正文原封不动搬进来（不调大模型）' }, '刷新')]
      }
      if (module.id === 'm5') {
        // 按需求：右上角只留「刷新」，原来的「X 篇」小胶囊取消；
        // 出图在浏览器里用 Canvas 本地画（没有 AI 生图、没有 Skill 指令）。
        return [
          h(Btn, { key: 'layout', primary: true, loading: busy === '排版' || busy === '刷新封面标签', loadingText: '刷新中…', disabled: !!busy, onClick: doLayout, title: '重新读取「④ 写文案」里点过「保存」的帖子' }, '刷新'),
        ].filter(Boolean)
      }
      // ⚠ 「⑥ 发布与互动」「⑦ 数据复盘」两个模块已按需求移除，这里不再有它们的按钮。
      return []
    }

    // ---- 一级：工作台主页 -------------------------------------------------

    const pageMain = () =>
      h(
        'div',
        { className: CLS.mainWrap, key: 'main' },
        h(
          'div',
          { className: CLS.grid },
          MODULES.map((module, index) =>
            // 整张卡就是"进入"入口（按钮语义，键盘也能按）
            h(
              'button',
              {
                key: module.id,
                type: 'button',
                className: CLS.mcard,
                // 每张卡呼吸相位错开 0.45s，整屏不会一起闪
                style: toneStyle(toneOf(module), index ? `-${(index * 0.45).toFixed(2)}s` : ''),
                title: `进入 ${module.name}`,
                onClick: () => enterModule(module.id),
              },
              // 卡片：顶部"图标 + 模块名"，紧跟下方就是状态文字（数字已经在状态文字里，不再单独显示）
              h('div', { className: CLS.mcardTop }, h('span', { className: CLS.mcardIcon }, module.icon), h('span', { className: CLS.mcardName }, module.name)),
              h('div', { className: CLS.mcardState }, statusOf(module)),
            ),
          ),
        ),
        // 主页也把提示做成浮层（同一个理由：出现/消失时不许把卡片网格挤动）
        error || notice
          ? h(
              'div',
              { className: CLS.toast },
              error ? h('div', { key: 'err', className: CLS.msgBad }, error) : null,
              notice ? h('div', { key: 'ok', className: CLS.msgOk }, notice) : null,
            )
          : null,
      )

    // ---- 二级：模块详情 ---------------------------------------------------

    const pageModule = () => {
      const module = MODULES.find((item) => item.id === moduleId) || MODULES[0]

      const bodyFor = () => {
        if (module.id === 'm1') {
          // 已经拿去「写文案」过的条目不再展示（usedForCopy，底层数据还在）
          const visibleTopics = topics.filter((topic) => !topic.usedForCopy)
          return h(
            'div',
            null,
            visibleTopics.length
              ? h(
                  // 双列：每张卡自己撑满一列，空白少很多
                  'div',
                  { className: CLS.gridTwo },
                  visibleTopics.map((topic) =>
                    h(
                      'div',
                      { key: topic.id, className: CLS.item },
                      h(
                        'div',
                        { style: ST.itemHead },
                        h(
                          'div',
                          { style: { minWidth: 0 } },
                          h('div', { className: cx(CLS.itemTitle, CLS.itemTitleClamp) }, topic.title || '(无标题)'),
                          // 按需求：卡片上只留「标题 + 部分正文」——
                          // 存入时间、原文日期这些元信息全部去掉；正文最多 3 行，超出省略号
                          topic.summary ? h('div', { className: CLS.itemBody }, topic.summary) : null,
                        ),
                        // 按需求：「删除」和「打开原文」的位置互换 —— 删除在右上角，打开原文挪到下面
                        h(Btn, { tiny: true, bad: true, disabled: !!busy, onClick: () => doDeleteTopic(topic) }, '删除'),
                      ),
                      h(
                        'div',
                        { style: Object.assign({}, ST.row, { marginTop: '10px' }) },
                        topic.link ? h('a', { className: CLS.link, href: topic.link, target: '_blank', rel: 'noreferrer', style: { fontSize: '12px' } }, '打开原文 ↗') : null,
                        // 选题库 → 写文案：直接把这条丢进模块4（配了大模型就用大模型写）
                        h(
                          Btn,
                          {
                            tiny: true,
                            ok: true,
                            disabled: !!busy,
                            title: '把这条的原文搬到「④ 写文案」（不会离开当前页）',
                            onClick: () => doWriteFromTopic(topic),
                          },
                          '✍ 写文案',
                        ),
                      ),
                    ),
                  ),
                )
              // 提示词按需求统一简化成「暂无数据」（不管是没存过、还是都写过文案了）
              : h(Empty),
          )
        }

        if (module.id === 'm2') {
          const running = !!(progress && progress.running)
          const total = progress && progress.total ? progress.total : 0
          const done = progress && progress.done ? progress.done : 0
          // 进度条平滑推进：整个进度 = (已完成的网站数 + 当前这个网站自己的进度) / 总网站数。
          // 当前网站正在读详情页时用 detailDone/detailTotal 补一个 0~0.9 的碎进度，
          // 所以不会出现"点一下直接跳到 100%"。
          const siteFraction =
            running && progress && progress.phase === 'detail' && progress.detailTotal
              ? Math.min(0.9, (progress.detailDone || 0) / progress.detailTotal)
              : 0
          const percentNow = running && total ? Math.min(100, Math.round(((done + siteFraction) / total) * 100)) : 0
          const siteNo = Math.min(done + 1, total || done + 1)
          // 已存入「① 选题库」的、以及已经「核实通过」的条目**都从列表里隐藏**。
          // ⚠ 核实通过也要隐藏（用户反馈：核实通过后扫源这边数量没减）。
          //   在选题库删掉它、或在模块3 把它退回未核实，这里就会重新出现。
          // （这份过滤在组件顶部算成 m2VisibleGroups / m2VisibleCount，标题栏那个数字跟它共用。）
          const visibleGroups = m2VisibleGroups
          const visibleCount = m2VisibleCount
          return h(
            'div',
            null,
            // 进度条：只在抓取过程中显示，抓完立刻收掉（不常驻）
            running
              ? h(
                  'div',
                  { className: CLS.progress },
                  h(
                    'div',
                    { className: CLS.progressHead },
                    h('span', { className: CLS.progressLabel }, progress.phase === 'detail' ? `正在抓取第 ${siteNo}/${total || '?'} 个网站：${progress.currentSite || ''}（读详情页 ${progress.detailDone || 0}/${progress.detailTotal || 0}）` : `正在抓取第 ${siteNo}/${total || '?'} 个网站：${progress.currentSite || ''}`),
                    h('span', { className: CLS.progressNum }, `${percentNow}%`),
                  ),
                  h('div', { className: CLS.progressTrack }, h('div', { className: CLS.progressFill, style: { width: `${percentNow}%` } })),
                )
              : null,
            // 本次新增提示：抓完和上一次比，多了哪些条目（最多列 5 个）
            newInfo && newInfo.count
              ? h(
                  'div',
                  { className: CLS.msgOk, style: { marginBottom: '12px' } },
                  h('div', null, `本次新增 ${newInfo.count} 条`),
                  newInfo.titles.length
                    ? h('div', { style: { marginTop: '4px', fontSize: '12px', opacity: 0.85 } }, newInfo.titles.slice(0, 5).map((title, index) => h('div', { key: index }, `· ${title}`)))
                    : null,
                )
              : null,
            visibleGroups.length
              ? h(
                  'div',
                  null,
                  visibleGroups.map((group) => {
                    // 每个网站一页 6 条（跟「筛选核实」一样的分页）
                    const groupTotal = group.items.length
                    const groupPages = Math.max(1, Math.ceil(groupTotal / SITE_PAGE_SIZE))
                    const groupPage = Math.min(Math.max(1, sitePages[group.source] || 1), groupPages)
                    const start = (groupPage - 1) * SITE_PAGE_SIZE
                    const shown = group.items.slice(start, start + SITE_PAGE_SIZE)
                    return h(
                      'div',
                      { key: group.source, className: CLS.item },
                      h(
                        'div',
                        { className: CLS.cardTitle, style: { marginBottom: '10px' } },
                        h('span', null, group.source),
                        h('span', { className: CLS.meta, style: { margin: 0 } }, `第 ${groupPage}/${groupPages} 页，共 ${groupTotal} 条`),
                      ),
                      // 双列：每条一行链接，不再一条占一整行
                      h(
                        'div',
                        { className: CLS.gridTwo },
                        shown.map((item, index) =>
                          h(
                            'div',
                            { key: `${group.source}_${start + index}`, className: CLS.subItem },
                            h(
                              'div',
                              { style: { flex: '1 1 auto', minWidth: 0 } },
                              h('div', { className: CLS.subItemTitle }, `【${item.title}】`),
                              h(
                                'div',
                                { className: CLS.meta },
                                `【${item.dateLabel || item.date || '日期未读到'}】 `,
                                item.link ? h('a', { className: CLS.link, href: item.link, target: '_blank', rel: 'noreferrer' }, '链接 ↗') : null,
                              ),
                            ),
                            h(
                              Btn,
                              {
                                tiny: true,
                                disabled: !!busy,
                                title: '存进「① 选题库」（存进去后会从这里的列表移走）',
                                onClick: () => doSaveTopic(item, true),
                              },
                              '存入选题库',
                            ),
                            // 本次新增的条目：右下角一颗红点，3 秒后自动消失
                            newKeys[keyOfSaves(item)] ? h('span', { className: CLS.newDot, 'aria-hidden': 'true' }) : null,
                          ),
                        ),
                      ),
                      // 分页：跟「筛选核实」一套风格；翻页自动滚回顶部
                      groupPages > 1
                        ? h(
                            'div',
                            { style: Object.assign({}, ST.row, { marginTop: '12px', justifyContent: 'center' }) },
                            h(Btn, { tiny: true, disabled: !!busy || groupPage <= 1, onClick: () => setGroupPage(group.source, groupPage - 1, groupPages) }, '← 上一页'),
                            h('span', { className: CLS.meta, style: { margin: 0 } }, `第 ${groupPage}/${groupPages} 页`),
                            h(Btn, { tiny: true, disabled: !!busy || groupPage >= groupPages, onClick: () => setGroupPage(group.source, groupPage + 1, groupPages) }, '下一页 →'),
                          )
                        : null,
                    )
                  }),
                )
              : h(
                  'div',
                  null,
                  // 按需求：空列表的文案统一简化成「暂无数据」；
                  // 下面那行灰字只说清"为什么是空的"，不再是失败弹窗。
                  h(Empty),
                  fetchData && fetchData.items && fetchData.items.length
                    ? h(Hint, null, '这一批条目都已经处理掉了（存进「① 选题库」，或者在「③ 筛选核实」里核实通过了）。在选题库里删掉它们、或把核实状态退回来，这里会重新出现。')
                    : h(Hint, null, '点右上角「开始抓取」按设置里的网站清单抓一遍：每条都会去详情页读真实发布时间，读不到日期、或不在「抓取最近几天」范围内的都会被丢掉（不会再标「最新」）。'),
                ),
            fetchData && fetchData.failures && fetchData.failures.length
              ? h(
                  'div',
                  { className: CLS.msgForm, style: { marginTop: '12px' } },
                  fetchData.failures.map((failure, index) => h('div', { key: index }, failure.tip || `⚠ ${failure.source} 暂时无法自动抓取，请手动打开查看`)),
                )
              : null,
          )
        }

        if (module.id === 'm3') {
          return h(
            'div',
            null,
            // 顶部：时间选择器 + 分页说明（第 X/Y 页，共 N 条）
            h(
              'div',
              { style: Object.assign({}, ST.row, { justifyContent: 'space-between' }), className: CLS.rangeBar },
              h(
                'div',
                { style: Object.assign({}, ST.row) },
                h('span', { className: CLS.label, style: { margin: 0, flex: 'none' } }, '按时间筛选'),
                h(
                  'select',
                  {
                    className: CLS.select,
                    style: { width: '120px', flex: 'none' },
                    value: filterRange,
                    disabled: !!busy,
                    title: '只看某个时间段内的资讯（判据是详情页读到的真实发布日期，读不到日期的条目不计入）',
                    onChange: (event) => changeFilterRange(event.target.value),
                  },
                  TIME_RANGE_OPTIONS.map((option) => h('option', { key: option.key, value: option.key }, option.label)),
                ),
              ),
              h('span', { className: CLS.meta, style: { margin: 0 } }, `第 ${safePage}/${pageCount} 页，共 ${pendingCandidates.length} 条`),
            ),
            pendingCandidates.length
              ? h(
                  'div',
                  null,
                  pageItems.map((candidate) =>
                    h(
                      'div',
                      { key: candidate.id, className: CLS.item },
                      h(
                        'div',
                        { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } },
                        h(
                          'div',
                          { style: { flex: '1 1 auto', minWidth: 0 } },
                          h('div', { className: CLS.itemTitle }, markAll(h, candidate.title, candidate.id)),
                          // 只留来源 + 日期（勾中项数/选题分这些放到折叠里，列表要干净）
                          h('div', { className: CLS.meta }, `${candidate.source || ''} · ${candidate.date || '原文未标注日期'}`),
                        ),
                        // 右上角：核实通过（小按钮）+ 勾中计数
                        h(
                          'div',
                          { style: { display: 'flex', gap: '8px', alignItems: 'center', flex: 'none' } },
                          h(
                            Btn,
                            {
                              tiny: true,
                              ok: true,
                              disabled: !!busy,
                              title: '这条没问题，进下一步（核实后从列表移走，数据保留）',
                              onClick: () => doConfirmOne(candidate),
                            },
                            '✓ 核实通过',
                          ),
                          h(Badge, { tone: (candidate.checksCount || 0) >= 2 ? TONE.done : TONE.wait }, `${candidate.checksCount || 0}/6`),
                        ),
                      ),
                      // 按需求：正文超出显示范围时用省略号截断（不硬切半句话）。
                      //
                      // ⚠ 这里踩过两次坑，两个保险都要留着：
                      //   ① `-webkit-line-clamp` 要求"被截断的盒子"自己就是 -webkit-box，
                      //      所以外层 div 当截断盒、高亮分段全包在内层 span 里；
                      //   ② 这个盒子外面套了两层 flex 容器，flex 子项默认 min-width:auto
                      //      会被长文本撑到不换行 —— 那样 line-clamp 就永远不触发（用户看到的
                      //      "正文还是没省略号"就是这个）。所以三层都补了 min-width:0。
                      h(
                        'div',
                        { className: cx(CLS.body, CLS.bodyClamp), style: { marginTop: '10px', maxWidth: '100%', minWidth: 0 } },
                        h('span', { style: { minWidth: 0 } }, renderSegments(h, candidate.summarySegments, candidate.id)),
                      ),
                      candidate.link ? h('div', { style: { marginTop: '10px' } }, h('a', { className: CLS.link, href: candidate.link, target: '_blank', rel: 'noreferrer', style: { fontSize: '12px' } }, '打开原文 ↗')) : null,
                      // 6 项判断依据折叠起来，默认不展开（太占地方）
                      h(
                        'details',
                        { className: CLS.collapsed, style: { marginTop: '10px' } },
                        h('summary', null, `判断依据（勾中 ${candidate.checksCount || 0}/6 项）`),
                        h(
                          'div',
                          { style: { marginTop: '8px' } },
                          (candidate.checkList || []).map((check) => h(CheckRow, { key: check.key, checked: check.checked, label: check.label, rule: check.rule, reason: check.reason })),
                        ),
                      ),
                    ),
                  ),
                  // 底部分页：不通过也能往后翻，看到后面的候选
                  pageCount > 1
                    ? h(
                        'div',
                        { style: Object.assign({}, ST.row, { marginTop: '12px', justifyContent: 'center' }) },
                        h(Btn, { tiny: true, disabled: !!busy || safePage <= 1, onClick: () => goPage(safePage - 1, pageCount) }, '← 上一页'),
                        h('span', { className: CLS.meta, style: { margin: 0 } }, `第 ${safePage}/${pageCount} 页`),
                        h(Btn, { tiny: true, disabled: !!busy || safePage >= pageCount, onClick: () => goPage(safePage + 1, pageCount) }, '下一页 →'),
                      )
                    : null,
                )
              : h(
                  'div',
                  null,
                  // 提示按需求统一成「暂无数据」；下面那行灰字说明"为什么是空的"
                  // （时间档位筛不到 / 这一档都不够劲 / 已经全部核实完了），不再是失败弹窗。
                  h(Empty),
                  filterMeta && filterMeta.emptyReason ? h(Hint, null, filterMeta.emptyReason) : null,
                ),
          )
        }

        if (module.id === 'm4') {
          // 按需求：**点过「保存」的帖子已经进「⑤ 做图排版」，这里不再展示。**
          // 还没保存的留在列表里，保存一条就少一条（都保存完就显示「暂无数据」）。
          const unsavedCopies = copies.filter((copy) => copy && !copy.savedByUser)
          return h(
            'div',
            null,
            // 没配模型就给一句提示（不占地方，一行）
            modelReady ? null : h('div', { className: CLS.hint, style: { marginTop: 0 } }, '请先配置模型（设置 → 模型：API 地址 + API Key）。没配之前「AI 润色」用不了，其它功能照常。'),
            // Skill 技能指令（选填）：输入或上传，写文案时会拼进提示词
            h(
              'details',
              { className: CLS.collapsed, style: { marginBottom: '12px' } },
              h('summary', null, String(effectiveSkill || '').trim() ? '✅ Skill 技能指令（已填）' : 'Skill 技能指令（选填：让 AI 按你的规则写）'),
              h(
                'div',
                { style: { marginTop: '8px' } },
                h('textarea', {
                  className: CLS.textarea,
                  style: { minHeight: '90px' },
                  placeholder: '例：开头必须是一句反问；每段不超过 2 行；结尾加一句「你觉得呢」；不许用「家人们」。',
                  value: effectiveSkill,
                  onChange: (event) => setSkillDraft(event.target.value),
                }),
                h(
                  'div',
                  { style: Object.assign({}, ST.row, { marginTop: '8px' }) },
                  h(Btn, { tiny: true, ok: true, disabled: !!busy, onClick: doSaveSkill }, '保存技能指令'),
                  h('label', { className: CLS.btn, style: { cursor: 'pointer' } }, '从文件导入（.txt/.md）', h('input', { type: 'file', accept: '.txt,.md,text/plain,text/markdown', style: { display: 'none' }, onChange: readSkillFile })),
                ),
              ),
            ),
            // 按需求：已经点过「保存」的帖子不再在写文案里展示（它已经进「⑤ 做图排版」了）；
            // 只显示还没保存的稿子，所以这个列表会随着"保存"一条条变短。
            unsavedCopies.length
              ? unsavedCopies.map((copy) => {
                  const draft = copyDrafts[copy.id] || {}
                  const titleValue = draft.title !== undefined ? draft.title : (copy.titles || [])[0] || copy.sourceTitle || ''
                  const bodyValue = draft.body !== undefined ? draft.body : copy.bodyAfterDeAi || copy.body || ''
                  return h(
                    'div',
                    { key: copy.id, className: CLS.item },
                    // 标题（可改）
                    h('input', {
                      className: CLS.input,
                      style: { fontSize: '15px', fontWeight: 700 },
                      value: titleValue,
                      placeholder: '标题',
                      onChange: (event) => {
                        const next = event.target.value
                        setCopyDrafts((drafts) => Object.assign({}, drafts, { [copy.id]: Object.assign({}, drafts[copy.id] || {}, { title: next }) }))
                      },
                      onBlur: () => doUpdateCopy(copy.id, { title: String((copyDrafts[copy.id] || {}).title !== undefined ? copyDrafts[copy.id].title : titleValue) }, true),
                    }),
                    // 正文（可改）
                    h('textarea', {
                      className: CLS.textarea,
                      style: { marginTop: '10px', minHeight: '220px', lineHeight: 1.7 },
                      value: bodyValue,
                      placeholder: '正文（可直接改）',
                      onChange: (event) => {
                        const next = event.target.value
                        setCopyDrafts((drafts) => Object.assign({}, drafts, { [copy.id]: Object.assign({}, drafts[copy.id] || {}, { body: next }) }))
                      },
                      onBlur: () => doUpdateCopy(copy.id, { body: String((copyDrafts[copy.id] || {}).body !== undefined ? copyDrafts[copy.id].body : bodyValue) }, true),
                    }),
                    h(
                      'div',
                      { style: Object.assign({}, ST.row, { marginTop: '10px' }) },
                      // 按需求：取消「待润色」标识（那个状态徽章整块去掉）；
                      // 「AI 润色」左边的小图标（✨）也去掉。
                      h(
                        Btn,
                        {
                          tiny: true,
                          ok: true,
                          disabled: !!busy || !modelReady,
                          title: modelReady ? '让大模型把这段正文润色得更像真人说话（写文案模块里唯一会调模型的地方）' : '请先配置模型（设置 → 模型）',
                          onClick: () => doPolish(copy),
                        },
                        'AI 润色',
                      ),
                      // 润过的话只在按钮右边留一句灰字说明（不再是"待润色/已润色"那种徽章）
                      copy.polished ? h('span', { className: CLS.meta, style: { margin: 0 } }, `已润色（${copy.polishedBy || '大模型'}）`) : null,
                      h(Btn, { tiny: true, disabled: !!busy, onClick: () => doUpdateCopy(copy.id, { title: titleValue, body: bodyValue }) }, '保存'),
                      // 按需求：「打开原文」往左挪 —— 紧跟在「保存」后面（原来是排到最后、贴着右下角）
                      copy.sourceLink
                        ? h('a', { className: CLS.link, href: copy.sourceLink, target: '_blank', rel: 'noreferrer', style: { fontSize: '12px' } }, '打开原文 ↗')
                        : null,
                      // 按需求：取消"还没保存（保存后才进做图排版）"这行字，不再显示保存状态说明
                      // 按需求：每条帖子右下角一个「删除」——删掉这条文案，来源放回「② 扫源抓取」
                      h(
                        'span',
                        { key: 'del', style: { marginLeft: 'auto', display: 'inline-flex' } },
                        h(
                          Btn,
                          {
                            tiny: true,
                            bad: true,
                            disabled: !!busy,
                            title: '删掉这条文案，来源放回「② 扫源抓取」（抓取数据保留）',
                            onClick: () => doDeleteCopy(copy),
                          },
                          '删除',
                        ),
                      ),
                    ),
                  )
                })
              : h(
                  'div',
                  null,
                  h(Empty),
                  // 两种情况分别说清楚：一稿都没写 / 写好的都保存进做图排版了
                  copies.length
                    ? h(Hint, null, `${copies.length} 篇都已保存、进「⑤ 做图排版」了，这里不再展示。想再挑一条就回「③ 筛选核实」核实通过。`)
                    : h(Hint, null, '点右上角「刷新」把原文的标题和正文原封不动搬进来（不调大模型）。'),
                ),
          )
        }

        if (module.id === 'm5') {
          // 「⑤ 封面标签」：只做两件事 ——
          //   ① 列出模板文件夹里的模板，点哪张就把哪张当封面底图；
          //   ② 把每条帖子（写文案里点过「保存」的）的标题 / 内容 / 标签摆出来。
          // ⚠ 按需求：**不往图片上叠标题和内容**，也不生成多张卡片 ——
          //   封面就是用户选中的那张模板本身；标题/内容/标签只是文案，留在界面上看。
          const savedCopies = layoutSourceCopies
          const templateFile = (templateMeta && templateMeta.file) || ''
          const coverStyle = { width: '100%', borderRadius: '10px', border: '1px solid var(--xmt-line)', display: 'block', marginTop: '8px' }
          const thumbStyle = { width: '100%', height: '92px', objectFit: 'cover', borderRadius: '8px', display: 'block' }
          return h(
            'div',
            null,
            // ---- 模板区：打开模板文件夹 + 模板缩略图（点哪张用哪张）----
            h(
              'div',
              { className: CLS.item, style: { marginBottom: '14px' } },
              h(
                'div',
                { style: Object.assign({}, ST.row, { justifyContent: 'space-between' }) },
                h('div', { style: { fontSize: '14px', fontWeight: 600 } }, '模板'),
                h(
                  Btn,
                  {
                    primary: true,
                    disabled: !!busy,
                    title: '在资源管理器里打开模板文件夹（把模板图片放进去，回来点一下刷新）',
                    onClick: doOpenTemplateFolder,
                  },
                  '打开模板文件夹',
                ),
              ),
              templateDirPath ? h('div', { className: CLS.meta, style: { margin: '4px 0 0', wordBreak: 'break-all' } }, templateDirPath) : null,
              templateList.length
                ? h(
                    'div',
                    { className: CLS.thumbStrip, style: { marginTop: '12px' } },
                    templateList.map((tpl) =>
                      h(
                        'button',
                        {
                          key: tpl.file,
                          type: 'button',
                          title: `点一下就用这张：${tpl.name || tpl.file}`,
                          disabled: !!busy,
                          onClick: () => doUseTemplate(tpl.file),
                          className: cx(CLS.templateCard, tpl.file === templateFile && CLS.templateCardActive),
                        },
                        h('img', { src: api.imageUrl('templateImage', { file: tpl.file }), alt: tpl.name || tpl.file, style: thumbStyle }),
                        h('div', { className: CLS.meta, style: { margin: 0, fontSize: '11px', wordBreak: 'break-all' } }, tpl.file === templateFile ? `✓ ${tpl.name || tpl.file}` : tpl.name || tpl.file),
                      ),
                    ),
                  )
                : null,
            ),
            /**
             * ⚠ 原来这里还有一块"封面（当前选中的模板）"的独立预览。
             *   它是脱离帖子单独画的，所以删掉帖子后那张大封面照样在屏幕上 ——
             *   用户反馈的"删除帖子后封面还显示"就是这个。
             *   现在封面改成**画在每条帖子自己的左栏里**，帖子没了封面自然一起没。
             */
            savedCopies.length
              ? savedCopies.map((copy) => {
                  const copyId = copy && copy.id
                  const title = String((copy.titles || [])[0] || copy.sourceTitle || '').trim() || '（无标题）'
                  const body = String(copy.bodyAfterDeAi || copy.body || '')
                  /**
                   * 标签：用户改过就用存下来的那份，没改过就现算（4~6 个）。
                   * ⚠ 这里每次渲染都会造一个新数组，所以 TagEditor 那边**绝不能**拿数组引用
                   *   判断"变没变"，否则每次渲染都会往回同步草稿 → 渲染风暴（页面卡死）。
                   *   那边已经改成按内容比对了。
                   */
                  const made = layoutMap[copyId] || null
                  const tags = (made && made.tags) || buildTagsLocal(title, body)
                  return h(
                    'div',
                    { key: copyId, className: CLS.item },
                    /**
                     * 按需求：一条帖子 = 左右两栏。
                     *   左栏：封面（用户选中的那张模板图，不往图上叠任何文字）
                     *   右栏：标题 / 正文 / 标签
                     * 窄屏（面板被拖窄）时 CSS 里会自己折成上下两段，不会挤成一团。
                     */
                    h(
                      'div',
                      { className: CLS.split },
                      // ---------- 左栏：封面 ----------
                      h(
                        'div',
                        { className: CLS.splitLeft },
                        h('div', { className: CLS.label, style: { margin: 0 } }, '封面'),
                        templateFile
                          ? h('img', {
                              src: api.imageUrl('templateImage', { file: templateFile }),
                              alt: '封面',
                              style: coverStyle,
                            })
                          : h('div', { className: CLS.emptyPreview }, '还没选模板：点上面的模板缩略图选一张'),
                      ),
                      // ---------- 右栏：标题 / 正文 / 标签 ----------
                      h(
                        'div',
                        { className: CLS.splitRight },
                        // 1) 标题（写文案里保存的那个标题，完整显示）
                        h('div', { className: CLS.itemTitle }, title),
                        // 2) 内容（写文案里保存的正文）—— 按需求**完整显示，不截断、不加省略号**
                        h('div', { className: cx(CLS.body, CLS.bodyFull), style: { marginTop: '8px' } }, body),
                        // 3) 标签（本地提 4~6 个，可手动改）
                        h(
                          'div',
                          { style: Object.assign({}, ST.row, { marginTop: '12px', justifyContent: 'space-between' }) },
                          h('span', { className: CLS.label, style: { margin: 0 } }, `标签（${tags.length} 个，可改）`),
                          h(Btn, { tiny: true, disabled: !!busy, title: '再加一个标签', onClick: () => doAddTag(copy, tags) }, '+ 加标签'),
                        ),
                        h(TagEditor, {
                          tags,
                          disabled: !!busy,
                          onChange: (next) => commitTags(copy, next),
                          onCommit: (next) => commitTags(copy, next),
                        }),
                      ),
                    ),
                    // 按需求：每条帖子的「删除」按钮放在**右下角**
                    h(
                      'div',
                      { className: CLS.itemFoot },
                      h(
                        Btn,
                        {
                          tiny: true,
                          bad: true,
                          disabled: !!busy,
                          title: '删掉这篇（回到「② 扫源抓取」，可以重新挑）',
                          onClick: () => doDeleteLayout(copy),
                        },
                        '删除',
                      ),
                    ),
                  )
                })
              : h(Empty),
          )
        }
        /**
         * 「⑥ 发布与互动」「⑦ 数据复盘」两个模块已按需求整体移除
         *（卡片、二级页、按钮、状态、请求全部删掉）。
         * 这里只是兜底：MODULES 里已经没有这两个 id，正常走不到这一行。
         */
        return h(Empty)
      }

      return h(
        'div',
        // 二级页不做位移/淡入动画：不做任何 padding/margin/transform 变化，避免"打开时把下面挤得抖一下"
        { key: `module_${module.id}` },
        // 顶部提示：做成**浮层**（position:fixed），不占文档流高度 ——
        // 以前它是页面里的第一个块，一出现就把下面的「操作与结果」整体往下推，看起来像"被挤了"。
        error || notice
          ? h(
              'div',
              { className: CLS.toast },
              error ? h('div', { key: 'err', className: CLS.msgBad }, error) : null,
              notice ? h('div', { key: 'ok', className: CLS.msgOk }, notice) : null,
            )
          : null,
        // 标题行：左边「返回 + 图标 + 模块名 + 状态徽章」，右边**同一行**放该模块的全部操作按钮；
        // 下面才是"操作与结果"这个卡片标题和结果区（按钮不再单独占一行）
        h(
          Card,
          {
            title: '操作与结果',
            // 模块2 的状态信息（最近抓取 / 条数）按需求挪到标题右侧，同一行显示
            titleRight: module.id === 'm2' ? m2StatusLine() : null,
            head: h(
              'div',
              { className: CLS.moduleHead },
              h(
                'div',
                { className: CLS.moduleHeadLeft },
                h(Btn, { danger: true, tiny: true, onClick: goMain, title: '返回工作台主页' }, '← 返回'),
                h('span', { className: CLS.mcardIcon }, module.icon),
                h('span', { className: CLS.moduleTitle }, `${module.no} ${module.name}`),
                h(Badge, { tone: toneOf(module) }, statusOf(module)),
              ),
              h('div', { className: CLS.moduleActions }, actionsFor(module)),
            ),
          },
          bodyFor(),
        ),
      )
    }

    /**
     * 模块2 那行状态（「最近抓取」+「本次有效 N 条」）—— 按需求放到「操作与结果」标题右侧。
     * ⚠ 这里的条数是**实时算出来**的：跟下面列表用的是同一份数据、同一套过滤
     *   （扣掉已存进选题库的、已核实通过的），所以存入 / 删除 / 核实之后立刻就对得上。
     */
    const m2StatusLine = () => {
      const lastAt = (fetchData && (formatTime(fetchData.fetchedAt) || fetchData.lastFetchDate)) || ''
      return [
        h('span', { key: 'count', className: CLS.pill }, `本次有效 ${m2VisibleCount} 条`),
        lastAt ? h('span', { key: 'last', className: CLS.pill }, `最近抓取：${lastAt}`) : null,
      ].filter(Boolean)
    }

    // ---- 设置页 -----------------------------------------------------------

    const pageSettings = () => {
      const draft = settingsDraft || settings
      if (!draft) {
        return h(
          'div',
          { className: CLS.fadeIn, key: 'settings' },
          h('div', { className: CLS.topbar }, h('div', { className: CLS.title }, '⚙ 设置'), h(Btn, { danger: true, onClick: goMain, title: '返回工作台主页' }, '← 返回')),
          h(Card, { title: '设置' }, h(Hint, null, '设置读取中…（一直不动说明连不上主机侧接口）'), error ? h('div', { className: CLS.msgBad }, error) : null),
        )
      }
      const patch = (next) => setSettingsDraft(Object.assign({}, draft, next))
      const sites = Array.isArray(draft.websites) ? draft.websites : []
      const setSite = (index, next) => patch({ websites: sites.map((site, i) => (i === index ? Object.assign({}, site, next) : site)) })

      // ---- 筛选规则关键词：设置里改过就用设置里的，没配过就显示主机侧下发的默认值 ----
      const defaultKeywords = (filterDefaults && filterDefaults.keywords) || {}
      const defaultExtend = (filterDefaults && filterDefaults.extend) || { minFacts: 2, minChars: 200 }
      /** 把设置对象里的关键词整理成"五项都齐全"的样子（缺的用默认补齐） */
      const keywordMapOf = (target) => {
        const out = {}
        for (const field of FILTER_KEYWORD_FIELDS) {
          const configured = target && target.filterKeywords && target.filterKeywords[field.key]
          out[field.key] = Array.isArray(configured) ? configured : (defaultKeywords[field.key] || []).slice()
        }
        return out
      }
      const keywordTextOf = (target, key) => keywordMapOf(target)[key].join('，')
      const extendOf = (target) => Object.assign({}, defaultExtend, (target && target.filterExtend) || {})

      return h(
        'div',
        { className: CLS.fadeIn, key: 'settings' },
        h(
          'div',
          { className: CLS.topbar },
          h('div', null, h('div', { className: CLS.title }, '⚙ 设置'), h('div', { className: CLS.subtitle }, '保存后立即生效（存在主机侧 JSON 里）')),
          h(
            'div',
            { style: ST.row },
            h(Btn, { primary: true, loading: busy === '保存设置', loadingText: '保存中…', disabled: !!busy, onClick: () => doSaveSettings(draft) }, '保存设置'),
            h(Btn, { danger: true, onClick: () => { setSettingsDraft(null); goMain() }, title: '返回工作台主页' }, '← 返回'),
          ),
        ),
        // 按需求：设置页里的「账号定位与人设」和「变现目标」两块**全部删掉**了，
        // 所以这里直接从模型配置开始编号（下面是 1) 模型 …）。
        h(
          Card,
          { title: '1) 模型（写文案 / AI 润色）' },
          h(
            'div',
            { className: CLS.fieldBox },
            h(
              'div',
              { className: CLS.field },
              h('span', { className: CLS.label }, 'API 地址'),
              h('input', {
                className: CLS.input,
                placeholder: 'https://api.deepseek.com/v1',
                value: (draft.model && draft.model.baseUrl) || '',
                onChange: (event) => patch({ model: Object.assign({}, draft.model || {}, { baseUrl: event.target.value }) }),
              }),
            ),
            h(
              'div',
              { className: CLS.field },
              h('span', { className: CLS.label }, 'API Key'),
              h('input', {
                className: CLS.input,
                type: 'password',
                placeholder: 'sk-...',
                value: (draft.model && draft.model.apiKey) || '',
                onChange: (event) => patch({ model: Object.assign({}, draft.model || {}, { apiKey: event.target.value }) }),
              }),
            ),
            h(
              'div',
              { className: CLS.field },
              h('span', { className: CLS.label }, '模型名（推荐 deepseek-flash）'),
              h('input', {
                className: CLS.input,
                placeholder: 'deepseek-flash',
                value: (draft.model && draft.model.model) || '',
                onChange: (event) => patch({ model: Object.assign({}, draft.model || {}, { model: event.target.value }) }),
              }),
            ),
          ),
        ),
        h(
          Card,
          { title: '2) 网站清单', right: h(Btn, { tiny: true, onClick: () => patch({ websites: [...sites, { name: '', url: '', difficulty: '普通', selectors: {} }] }) }, '+ 加一个') },
          sites.length
            ? sites.map((site, index) =>
                h(
                  'div',
                  { key: index, className: CLS.item },
                  /**
                   * 按需求：「删除这个网站」挪到**右上角、紧挨着「抓取难度」右边**。
                   * 做法：左边照旧是那格网格（名称 / 网址 / 抓取难度），右边单独一列放按钮，
                   * 外层用 flex 把它们排在同一行 —— 这样不管面板多宽、网格自己折成几列，
                   * 按钮都稳定停在右上角，不会跑到卡片中间去。
                   */
                  h(
                    'div',
                    { className: CLS.siteRow },
                    h(
                      'div',
                      { className: CLS.fieldBox, style: { flex: '1 1 auto', minWidth: 0 } },
                      h('div', { className: CLS.field }, h('span', { className: CLS.label }, '名称'), h('input', { className: CLS.input, placeholder: '量子位', value: site.name || '', onChange: (event) => setSite(index, { name: event.target.value }) })),
                      h('div', { className: CLS.field }, h('span', { className: CLS.label }, '网址'), h('input', { className: CLS.input, placeholder: 'https://...', value: site.url || '', onChange: (event) => setSite(index, { url: event.target.value }) })),
                      h('div', { className: CLS.field }, h('span', { className: CLS.label }, '抓取难度'), h('select', { className: CLS.select, value: site.difficulty || '普通', onChange: (event) => setSite(index, { difficulty: event.target.value }) }, h('option', { value: '普通' }, '普通'), h('option', { value: '困难' }, '困难（走浏览器）'))),
                    ),
                    h(
                      'div',
                      { className: CLS.siteRowAction },
                      h(Btn, { tiny: true, bad: true, title: '把这个网站从清单里删掉', onClick: () => patch({ websites: sites.filter((_, i) => i !== index) }) }, '删除这个网站'),
                    ),
                  ),
                  h(
                    'details',
                    { className: CLS.collapsed, style: { marginTop: '10px' } },
                    h('summary', null, '解析规则（网站改版抓不到内容时再来调）'),
                    h(
                      'div',
                      { className: CLS.fieldBox, style: { marginTop: '8px' } },
                      ['listSelector', 'titleSelector', 'linkSelector', 'dateSelector'].map((key) =>
                        h('input', {
                          key,
                          className: CLS.input,
                          placeholder: key,
                          value: (site.selectors && site.selectors[key]) || '',
                          onChange: (event) => setSite(index, { selectors: Object.assign({}, site.selectors || {}, { [key]: event.target.value }) }),
                        }),
                      ),
                    ),
                    h(Hint, null, '留空就用内置的智能识别（先试常见列表结构，再退回 <article>，最后扫长链接）。'),
                  ),
                )
              )
            : h(Empty, null, '还没有网站。点「加一个」添加，比如：量子位 https://www.qbitai.com。'),
        ),
        h(
          Card,
          { title: '3) 抓取参数' },
          h(
            'div',
            { className: CLS.fieldBox },
            // 抓取最近几天：只抓这个时间范围内的资讯（判据是详情页读到的真实发布日期；
            // 每条都会去详情页读一次，读不到日期的条目直接丢掉）
            h(
              'div',
              { className: CLS.field },
              h('span', { className: CLS.label }, '抓取最近几天'),
              h(
                'select',
                {
                  className: CLS.select,
                  value: String((draft.fetch && draft.fetch.days) || 1),
                  onChange: (event) => patch({ fetch: Object.assign({}, draft.fetch || {}, { days: Number(event.target.value) || 1 }) }),
                },
                FETCH_DAY_OPTIONS.map((days) => h('option', { key: days, value: String(days) }, `最近 ${days} 天`)),
              ),
            ),
            h('div', { className: CLS.field }, h('span', { className: CLS.label }, '超时（毫秒）'), h('input', { className: CLS.input, value: (draft.fetch && draft.fetch.timeoutMs) || 10000, onChange: (event) => patch({ fetch: Object.assign({}, draft.fetch || {}, { timeoutMs: Number(event.target.value) || 10000 }) }) })),
            h('div', { className: CLS.field }, h('span', { className: CLS.label }, '最多重试次数'), h('input', { className: CLS.input, value: (draft.fetch && draft.fetch.retries) || 3, onChange: (event) => patch({ fetch: Object.assign({}, draft.fetch || {}, { retries: Number(event.target.value) || 3 }) }) })),
            h('div', { className: CLS.field }, h('span', { className: CLS.label }, '每站最多抓几条'), h('input', { className: CLS.input, value: (draft.fetch && draft.fetch.maxItemsPerSite) || 8, onChange: (event) => patch({ fetch: Object.assign({}, draft.fetch || {}, { maxItemsPerSite: Number(event.target.value) || 8 }) }) })),
            h('div', { className: CLS.field }, h('span', { className: CLS.label }, '请求间隔下限（毫秒）'), h('input', { className: CLS.input, value: (draft.fetch && draft.fetch.minDelayMs) || 1500, onChange: (event) => patch({ fetch: Object.assign({}, draft.fetch || {}, { minDelayMs: Number(event.target.value) || 1500 }) }) })),
            h('div', { className: CLS.field }, h('span', { className: CLS.label }, '请求间隔上限（毫秒）'), h('input', { className: CLS.input, value: (draft.fetch && draft.fetch.maxDelayMs) || 3500, onChange: (event) => patch({ fetch: Object.assign({}, draft.fetch || {}, { maxDelayMs: Number(event.target.value) || 3500 }) }) })),
            h('div', { className: CLS.field }, h('span', { className: CLS.label }, 'Chrome 调试端口'), h('input', { className: CLS.input, value: draft.browserCdpUrl || 'http://127.0.0.1:9222', onChange: (event) => patch({ browserCdpUrl: event.target.value }) })),
          ),
        ),
        // -------- 4) 筛选规则关键词（模块3 那六项判断标准的关键词，用户可以自己改）--------
        h(
          Card,
          {
            title: '4) 筛选规则关键词',
            right: h(
              Btn,
              {
                tiny: true,
                disabled: !!busy,
                title: '把这六项恢复成出厂默认值',
                onClick: () => patch({ filterKeywords: null, filterExtend: { minFacts: 2, minChars: 200 } }),
              },
              '恢复默认',
            ),
          },
          h(
            Hint,
            null,
            '这六项就是「③ 筛选核实」里那 6 条判断标准：命中所填的任意一个关键词，这一项就算勾中；勾中 1 项就进候选。多个关键词用逗号或换行分隔。改完记得点上面的「保存设置」。',
          ),
          FILTER_KEYWORD_FIELDS.map((field) =>
            h(
              'div',
              { key: field.key, style: { marginTop: '12px' } },
              h('span', { className: CLS.label }, `${field.label}（${field.hint}）`),
              h('textarea', {
                className: CLS.textarea,
                style: { minHeight: '56px', fontFamily: 'var(--xmt-font-mono)', fontSize: '12px' },
                placeholder: field.placeholder,
                value: keywordTextOf(draft, field.key),
                onChange: (event) =>
                  patch({
                    filterKeywords: Object.assign({}, keywordMapOf(draft), {
                      [field.key]: event.target.value
                        .split(/[,，\n\r]+/)
                        .map((word) => word.trim())
                        .filter(Boolean),
                    }),
                  }),
              }),
            ),
          ),
          h(
            'div',
            { className: CLS.fieldBox, style: { marginTop: '12px' } },
            h(
              'div',
              { className: CLS.field },
              h('span', { className: CLS.label }, '可延展：最少"具体信息"条数（数字/版本号/日期）'),
              h('input', {
                className: CLS.input,
                value: extendOf(draft).minFacts,
                onChange: (event) => patch({ filterExtend: Object.assign({}, extendOf(draft), { minFacts: Number(event.target.value) || 1 }) }),
              }),
            ),
            h(
              'div',
              { className: CLS.field },
              h('span', { className: CLS.label }, '可延展：正文最少字数'),
              h('input', {
                className: CLS.input,
                value: extendOf(draft).minChars,
                onChange: (event) => patch({ filterExtend: Object.assign({}, extendOf(draft), { minChars: Number(event.target.value) || 50 }) }),
              }),
            ),
          ),
          h(Hint, null, '「可延展」这项不是靠关键词，而是靠上面两个门槛：原文里的具体信息够多、或者正文够长，就算可延展。'),
        ),
        /**
         * 按需求：页面底部那对「保存设置 / ← 返回」按钮**取消了**
         *（保存和返回都还在顶部那一条里，功能没少）。
         *
         * ⚠ 同时修掉了"保存成功看不到提示"：这里以前**只渲染 error、不渲染 notice**，
         *   而「设置已保存」那句话是走 notice 的 —— 所以在一级界面看得见、进了设置页就没了。
         *   现在跟一级页 / 二级页用同一个浮层（CLS.toast 是 position:fixed + z-index:30，
         *   比设置页顶部那条 sticky 的 z-index:5/6 高，不会被盖住）。
         */
        error || notice
          ? h(
              'div',
              { className: CLS.toast },
              error ? h('div', { key: 'err', className: CLS.msgBad }, error) : null,
              notice ? h('div', { key: 'ok', className: CLS.msgOk }, notice) : null,
            )
          : null,
      )
    }

    // ---- SOP 页 -----------------------------------------------------------

    const pageSop = () => {
      if (!sop) {
        return h(
          'div',
          { className: CLS.fadeIn, key: 'sop' },
          h('div', { className: CLS.topbar }, h('div', { className: CLS.title }, '📖 SOP'), h(Btn, { danger: true, onClick: goMain, title: '返回工作台主页' }, '← 返回')),
          h(Card, { title: 'SOP' }, h(Hint, null, 'SOP 读取中…')),
        )
      }
      const cold = sop.coldStart || {}
      const score = sop.topicScore || {}
      const position = sop.positioning || {}
      const compliance = sop.compliance || {}
      return h(
        'div',
        { className: CLS.fadeIn, key: 'sop' },
        h(
          'div',
          { className: CLS.topbar },
          h('div', null, h('div', { className: CLS.title }, '📖 SOP 与检查清单'), h('div', { className: CLS.subtitle }, '不用记住，随时来这儿翻')),
          h(Btn, { danger: true, onClick: goMain, title: '返回工作台主页' }, '← 返回'),
        ),
        h(
          Card,
          { title: '📖 冷启动 SOP' },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '第一周：建立人设，测试方向'),
          (cold.week1 || []).map((item, index) => h('div', { key: index, className: CLS.meta }, `${item.day}｜${item.type} —— ${item.goal}`)),
          h('div', { className: CLS.label, style: { marginTop: '12px' } }, '第二周：放大验证'),
          (cold.week2 || []).map((item, index) => h('div', { key: index, className: CLS.meta }, `· ${item}`)),
          cold.mindset ? h(Hint, null, cold.mindset) : null,
        ),
        h(
          Card,
          { title: '📊 选题判断表' },
          (score.items || []).map((item, index) => h('div', { key: index, className: CLS.meta }, `${item.dimension}：${item.rule}`)),
          score.rule ? h(Hint, null, score.rule) : null,
        ),
        h(
          Card,
          { title: '🎯 账号定位与对标拆解' },
          (position.three || []).map((item, index) => h('div', { key: index, className: CLS.meta }, `· ${item}`)),
          h('div', { className: CLS.label, style: { marginTop: '12px' } }, '对标账号拆解维度'),
          h('div', { className: CLS.tags }, (position.benchmark || []).map((item, index) => h('span', { key: index, className: CLS.tag }, item))),
          h('div', { className: CLS.label, style: { marginTop: '12px' } }, '把一篇爆文拆成六层'),
          h('div', { className: CLS.tags }, (position.sixLayers || []).map((item, index) => h('span', { key: index, className: CLS.tag }, item))),
          h('div', { className: CLS.label, style: { marginTop: '12px' } }, '网感训练'),
          (position.training || []).map((item, index) => h('div', { key: index, className: CLS.meta }, `· ${item}`)),
        ),
        h(
          Card,
          { title: '✅ 发布前检查清单（每次发布必过）' },
          h('div', { className: CLS.tags }, (compliance.quantity || []).map((item, index) => h('span', { key: index, className: CLS.tag }, item))),
          compliance.aiLabel ? h('div', { className: CLS.meta, style: { marginTop: '10px' } }, compliance.aiLabel) : null,
          compliance.banned ? h('div', { className: CLS.meta, style: { marginTop: '6px' } }, compliance.banned) : null,
          compliance.copy ? h('div', { className: CLS.meta, style: { marginTop: '6px' } }, compliance.copy) : null,
        ),
        h(Card, { title: '⚠️ 已知限制' }, (sop.risks || []).map((item, index) => h('div', { key: index, className: CLS.meta }, `${index + 1}. ${item}`))),
      )
    }

    // ---- 日志页 -----------------------------------------------------------

    const pageLog = () =>
      h(
        'div',
        { className: CLS.fadeIn, key: 'log' },
        h(
          'div',
          { className: CLS.topbar },
          h('div', null, h('div', { className: CLS.title }, '抓取与操作日志'), h('div', { className: CLS.subtitle }, statusData && statusData.dataDir ? `数据目录：${statusData.dataDir}` : '')),
          h('div', { style: ST.row }, h(Btn, { disabled: !!busy, onClick: doLoadLog }, '刷新日志'), h(Btn, { danger: true, onClick: goMain, title: '返回工作台主页' }, '← 返回')),
        ),
        h(Card, { title: '日志' }, h('div', { className: cx(CLS.result, CLS.body) }, logText || '（点「刷新日志」读取）')),
      )

    // ---- 组装（渲染失败也只坏自己） ---------------------------------------

    const body = (() => {
      try {
        if (screen === 'module') return pageModule()
        if (screen === 'settings') return pageSettings()
        if (screen === 'sop') return pageSop()
        if (screen === 'log') return pageLog()
        return pageMain()
      } catch (err) {
        return h(
          Card,
          { title: '工作台出错了' },
          h('div', { className: CLS.msgBad }, `界面渲染失败：${(err && err.message) || err}。这是工作台自己的问题，不影响聊天。`),
          h('div', { style: Object.assign({}, ST.row, { marginTop: '12px' }) }, h(Btn, { onClick: goMain }, '回到主页试试')),
        )
      }
    })()

    // 一级页：整块放进"舞台"里垂直+水平居中（不贴顶）；二级/设置/SOP/日志页正常顶对齐
    // （二级页不再有面包屑那一行：标题行已经挪进"操作与结果"卡片里，见 pageModule）
    const onMain = screen === 'main'
    const content = onMain ? h('div', { className: CLS.stage }, body) : h('div', null, body)

    // 背景（只在独立使用/没有外层弹窗背景时自己铺）+ 内容：
    //   ① .xmt-bg       渐变主体
    //   ② .xmt-bg-flow  会慢慢漂的柔光（轻微流动感）
    //   ③ .xmt-page     内容（外层 .xmt-panel-scroll 自带滚动条，能上下滑）
    // 一级页的 .xmt-page 走 display:contents，让舞台直接撑满滚动区，做到真正的上下左右居中。
    // ⚠ 在弹窗里时**不画这两层**：弹窗最外层已经有 fixed 的背景（.xmt-modal-bg），
    //   跟着内容高度的背景一旦滚到底就会露出断层。
    const inPanel = !!(props && props.inModal)
    return h(
      'div',
      { className: cx(CLS.root, inPanel && 'in-panel'), 'data-xmt-workbench': 'view' },
      inPanel ? null : h('div', { className: CLS.bg, 'aria-hidden': 'true' }),
      inPanel ? null : h('div', { className: CLS.bgFlow, 'aria-hidden': 'true' }),
      // 「⚙ 设置」钉在左上角：只在一级页显示，放在最外层容器里（绝对定位），不参与卡片网格的居中
      onMain
        ? h('div', { className: CLS.mainBar }, h(Btn, { className: CLS.settingsEntry, onClick: () => openWorkbenchScreen('settings'), title: '打开设置' }, '⚙ 设置'))
        : null,
      h('div', { className: cx(CLS.page, onMain && CLS.stagePage), style: ST.page }, content),
    )
  }
}

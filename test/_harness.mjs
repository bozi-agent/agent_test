/**
 * 测试公共脚手架：最小 react 替身 + 假接口 + 渲染器 + 断言
 *
 * 为什么要有这个文件：界面侧的测试需要"假装自己是 react"，如果每个测试各写一套，
 * 就会出现 A 测试说正常、B 测试说报错的情况（脚手架不一致，不是代码问题）。
 * 所以统一放这里，所有界面侧测试都用同一套。
 */

/** 建一个最小 react 替身 + 渲染器 */
export function createHarness() {
  const portals = []
  /**
   * hook 槽位按"组件在渲染树里的位置"存（key = 从根到它的组件名 + 每一步在父级里的第几个子节点），
   * 跟真 react 一样跨多次 render 保留。
   *
   * ⚠ 踩过的坑（三个版本才对）：
   *  1) 最早是"每次 render 重置一个全局数组"：事件回调里先 setBusy('抓取') 再 setBusy('')，
   *     中间那次状态更新会被下一次 render 擦掉 → 加载态测不出来（假绿）；
   *  2) 改成按"组件函数身份"存：Workbench 这种在 createWorkbench() 里定义的内层组件，
   *     每次 render 都是新函数对象，身份会变；
   *  3) 再改成"每个节点（含原生标签）都编号"：条件渲染（比如主页有 children、二级页没有）
   *     会让后面所有节点的序号整体错位，槽位读串。
   *  最终只按"组件在父级 children 里的下标"编号 —— 和 react 的 reconciler 假设一致。
   */
  const hookStore = new Map()
  let hooks = []
  let hookIndex = 0
  let path = []
  let childSeq = 0
  let depth = 0

  /** 进入一个组件的槽位（同一位置跨 render 复用） */
  function enterSlot(type, index) {
    const previous = { hooks, hookIndex, path, childSeq }
    const name = type.displayName || type.name || 'fn'
    path = path.concat(`${name}#${index}`)
    const key = path.join('/')
    if (process.env.XMT_DEBUG_HARNESS) console.log(`  [harness] 槽位 ${key}`)
    hooks = hookStore.get(key) || []
    hookStore.set(key, hooks)
    hookIndex = 0
    childSeq = 0
    return () => {
      hooks = previous.hooks
      hookIndex = previous.hookIndex
      path = previous.path
      childSeq = previous.childSeq
    }
  }

  /** 每次顶层 render 之前调用：重置路径分配（槽位内容保留） */
  function startRenderPass() {
    path = []
    childSeq = 0
  }

  /** 遍历 children，让每个函数组件拿到它在父级里的稳定下标 */
  function renderChildren(children) {
    const saved = childSeq
    childSeq = 0
    const result = renderNode(children)
    childSeq = saved
    return result
  }

  const React = {
    createElement(type, props, ...children) {
      const flat = []
      const push = (child) => {
        if (Array.isArray(child)) child.forEach(push)
        else if (child !== null && child !== undefined && child !== false && child !== true) flat.push(child)
      }
      children.forEach(push)
      return { type, props: Object.assign({}, props || {}, flat.length ? { children: flat.length === 1 ? flat[0] : flat } : {}) }
    },
    /** class 组件（错误边界用） */
    Component: class Component {
      constructor(props) {
        this.props = props || {}
        this.state = {}
      }
      setState(patch) {
        this.state = Object.assign({}, this.state, patch)
      }
      render() {
        return null
      }
    },
    useState(initial) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      // 注意：setter 要闭包住"当前的槽位数组"，和 react 一样 —— 事件回调里连续更新中间态才读得到
      const slotHooks = hooks
      const setter = (next) => {
        slotHooks[index] = typeof next === 'function' ? next(slotHooks[index]) : next
      }
      return [hooks[index], setter]
    },
    useRef(initial) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    /** 生产模式：登记 effect 并占一个槽位（和 render() 里的收集模式一致，否则状态会读错位） */
    useEffect() {
      hookIndex++
    },
    useMemo(fn) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = fn()
      return hooks[index]
    },
    useCallback(fn) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = fn
      return hooks[index]
    },
    /**
     * React 18 的 useSyncExternalStore 替身。
     * 真环境里界面侧走的就是它（client.js 里优先用它），所以脚手架必须提供，
     * 否则测的是一条生产不走的兜底分支（React 17 分支）。
     */
    useSyncExternalStore(subscribeFn, getSnapshotFn) {
      const index = hookIndex++
      if (!(index in hooks)) {
        hooks[index] = { value: getSnapshotFn(), bound: false }
      }
      const slot = hooks[index]
      slot.value = getSnapshotFn()
      if (!slot.bound && typeof subscribeFn === 'function') {
        slot.bound = true
        try {
          subscribeFn(() => {
            slot.value = getSnapshotFn()
          })
        } catch (err) {
          /* 忽略：替身不做重渲染，下一次 render 会读到新值 */
        }
      }
      return slot.value
    },
  }

  const reactDom = {
    createPortal(node, host) {
      portals.push({ node, host })
      return { __portal: true, node, host }
    },
  }

  const documentStub = {
    body: {
      appendChild(el) {
        el.__appended = true
      },
      removeChild(el) {
        el.__appended = false
      },
    },
    createElement(tag) {
      return { tagName: tag, attributes: {}, setAttribute(k, v) { this.attributes[k] = v } }
    },
    /** 弹窗定位要量 DOM，替身里返回空即可（会走兜底宽度） */
    querySelectorAll() {
      return []
    },
    querySelector() {
      return null
    },
  }

  /** 模拟 react 渲染（含 class 组件的错误边界语义；index 是它在父级 children 里的下标） */
  function renderNode(node, index) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) {
      childSeq = 0
      return node.map((child) => {
        const index = childSeq++
        return renderNode(child, index)
      })
    }
    if (typeof node.type === 'function') {
      depth++
      try {
        if (process.env.XMT_DEBUG_HARNESS) console.log(`  [harness] 渲染组件 ${node.type.name || '(匿名)'}`)
        if (node.type.prototype && typeof node.type.prototype.render === 'function') {
          const instance = new node.type(node.props || {})
          try {
            return renderNode(instance.render())
          } catch (err) {
            if (typeof node.type.getDerivedStateFromError === 'function') {
              instance.state = Object.assign({}, instance.state, node.type.getDerivedStateFromError(err))
              return renderNode(instance.render())
            }
            throw err
          }
        }
        // 函数组件：进入它所在的槽位（位置 = 父级里的第几个子节点）
        const leave = enterSlot(node.type, typeof index === 'number' ? index : childSeq++)
        try {
          return renderNode(node.type(node.props || {}))
        } finally {
          leave()
        }
      } finally {
        depth--
      }
    }
    if (node.type === undefined) {
      return node.props ? renderNode(node.props.children) : null
    }
    return { type: node.type, props: Object.assign({}, node.props, { children: renderChildren(node.props.children) }) }
  }

  /** 把渲染树拍平成可搜索的文字 */
  function flatten(node, out = []) {
    if (node === null || node === undefined || typeof node === 'boolean') return out
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node))
      return out
    }
    if (Array.isArray(node)) {
      node.forEach((child) => flatten(child, out))
      return out
    }
    if (node.props) {
      for (const key of ['title', 'placeholder', 'value']) {
        if (typeof node.props[key] === 'string') out.push(node.props[key])
      }
      flatten(node.props.children, out)
    }
    return out
  }

  /** 找出树里所有元素节点 */
  function flattenNodes(node, out = []) {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) {
      node.forEach((child) => flattenNodes(child, out))
      return out
    }
    if (node.type) out.push(node)
    if (node.props) flattenNodes(node.props.children, out)
    return out
  }

  /**
   * 渲染一次：跑组件 + 副作用 → 等异步状态落地 → 再渲染一次读新状态
   *
   * 关键两条（都踩过坑）：
   *  1) hooks 是在 createWorkbench() 时被"抓走"的，所以 useEffect 的实现必须在 apply() 之前换好
   *     （用 apply 的第二个参数 probe）；
   *  2) hook 状态要跨渲染保留（和真 react 一样），否则 setState 之后重新渲染就读不到新状态。
   *     需要重置状态时调 begin()。
   */
  const effectQueue = []

  /**
   * 重置组件状态。
   * 普通场景**不要**调它：hook 槽位按组件身份跨 render 保留（和真 react 一样），
   * 这样事件回调里连续的状态更新（setBusy('抓取') 后紧接 setBusy('')）的中间态才测得到。
   * 想在同一个测试文件里"重新来一遍"（相当于重新挂载）时，用 reset()。
   */
  function begin() {
    effectQueue.length = 0
  }

  /** 清掉所有组件的 hook 槽位 + 挂起的 effect（相当于全部重新挂载） */
  function reset() {
    hookStore.clear()
    hooks = []
    hookIndex = 0
    path = []
    childSeq = 0
    effectQueue.length = 0
  }

  async function render(Component, props = {}, waitMs = 40) {
    try {
      startRenderPass()
      const tree0 = renderNode(React.createElement(Component, props))
      const pending = effectQueue.splice(0)
      if (process.env.XMT_DEBUG_HARNESS) {
        console.log(`  [harness] 第一遍排到 ${pending.length} 个 effect；根节点=${tree0 ? tree0.type : tree0}`)
      }
      for (const fn of pending) {
        try {
          fn()
        } catch (err) {
          console.error('  [harness] effect 执行出错：', (err && err.message) || err)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      effectQueue.length = 0
      startRenderPass()
      const tree = renderNode(React.createElement(Component, props))
      if (process.env.XMT_DEBUG_HARNESS) {
        console.log(`  [harness] 第二遍渲染完成；文字长度=${flatten(tree).join(' | ').length}`)
      }
      return { tree, text: flatten(tree).join(' | ') }
    } catch (err) {
      return { error: err, text: '' }
    }
  }

  /** 只重渲染一次（不执行 effect，用来读 setState 之后的界面） */
  function rerender(Component, props = {}) {
    startRenderPass()
    const tree = renderNode(React.createElement(Component, props))
    return { tree, text: flatten(tree).join(' | ') }
  }

  /**
   * 测试探针：把 useEffect 换成"登记到队列"的版本。
   * client.js 里只有 globalThis.__XMT_TEST_HARNESS__ === true 时才会用它
   * （生产环境完全走不到这段）。
   */
  function probe(react) {
    effectQueue.length = 0
    react.useEffect = function queuedEffect(fn) {
      hookIndex++
      if (fn) effectQueue.push(fn)
    }
  }

  /** 打开探针开关（每个用 react 替身的测试都要先调一次） */
  function enableProbe() {
    globalThis.__XMT_TEST_HARNESS__ = true
    globalThis.__XMT_TEST_PROBE__ = probe
  }

  return { React, reactDom, documentStub, render, rerender, begin, reset, renderNode, flatten, flattenNodes, portals, probe, enableProbe }}

/** 建一个假的 fetch（假接口），返回 apiCalls 方便断言 */
export function createFakeFetch(options = {}) {
  const apiCalls = []
  const state = { offline: false, held: null, release: null, hold(action) {} }
  /**
   * 选题库的"真存"状态：让「存入 → 去重 → 删除」这条链路在界面侧能被真的测到。
   * 之前假接口对 saveTopic/deleteTopic 一律返回 {}，界面拿到 data.topics 就是 undefined，
   * 「删一条把整页清空」这种 bug 在测试里根本暴露不出来。
   */
  state.topics = Array.isArray(options.topics) ? options.topics.slice() : []
  let topicSeq = 0
  /** 做图排版的模板信息（上传后会被更新，跟主机侧行为对齐） */
  state.template = Object.assign({ file: '', name: '', width: 0, height: 0, exists: false }, options.template || {})
  /** 模板文件夹里的图片清单（listTemplates 用） */
  state.templateList = Array.isArray(options.templateList) ? options.templateList.slice() : []

  const keyOfTopic = (topic) => {
    const link = String((topic && topic.link) || '').trim()
    if (link) return `link:${link}`
    const title = String((topic && topic.title) || '').trim()
    return title ? `title:${title}` : ''
  }

  /**
   * 让某个接口暂时不返回（返回一个"放行"函数，调它请求才会完成）。
   * 用途：异步按钮点下去之后要停在"抓取中…"，这个假接口光靠同步 resolve 是测不出来的。
   */
  state.hold = (action) => {
    state.held = action
    return () => {
      state.held = null
      const fire = state.release
      state.release = null
      if (typeof fire === 'function') fire()
    }
  }

  globalThis.fetch = async (url, fetchOptions = {}) => {
    apiCalls.push({ url: String(url), options: fetchOptions || {} })
    if (state.offline) throw new Error('Failed to fetch')
    const isGet = !fetchOptions.method || fetchOptions.method === 'GET'
    const body = isGet ? {} : JSON.parse(fetchOptions.body || '{}')
    const action = isGet ? new URL(String(url), 'http://x').searchParams.get('action') : body.action
    const payload = isGet ? {} : body.payload || {}
    const respond = (data) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    // 被挂起的接口：挂在这儿不返回，等测试放行（验证加载态用）
    if (state.held && state.held === action) {
      await new Promise((resolve) => {
        state.release = resolve
      })
      // 放行后再让一个 tick，保证界面能停在加载态被断言到
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    if (action === 'settings') {
      return respond({
        settings: Object.assign(
          {
            accountPositioning: 'AI圈资讯',
            personaDescription: '语气轻松',
            typicalQuestions: '这个工具在哪下载？',
            frequentWords: ['我试了下'],
            bannedWords: ['震惊'],
            pastViralSamples: ['上次那条"免费额度翻倍"数据最好'],
            monetizationGoal: '暂不变现',
            websites: [{ name: '量子位', url: 'https://www.qbitai.com', difficulty: '普通', selectors: {} }],
            model: {},
            fetch: { timeoutMs: 10000, retries: 3, maxItemsPerSite: 8, minDelayMs: 1500, maxDelayMs: 3500 },
          },
          options.settings || {},
        ),
        template: state.template,
      })
    }
    if (action === 'status') {
      return respond({
        status: { stage: options.stage || 'idle', module2: '未开始', module3: '等待模块2', module4: '已就绪', module5: '等待文案', module6: '未开始', module7: '未开始' },
        ready: true,
        // counts 默认跟着假数据走（copies / topics 有多少就报多少），
        // 这样"写文案状态栏里的篇数"这类断言才验得到真东西；想写死就传 options.counts
        counts: options.counts || {
          topics: state.topics.length,
          fetched: ((options.fetchResult || state.fetchResult || {}).items || []).length,
          fetchedPending: ((options.fetchResult || state.fetchResult || {}).items || []).length,
          candidates: (options.candidates || []).length,
          copies: (options.copies || []).length,
          copiesPending: (options.copies || []).filter((copy) => copy && !copy.savedByUser).length,
          layouts: (options.layouts || []).length,
        },
        dataDir: 'C:\\Users\\x\\.dsh\\ai-news-workbench',
        browserAvailable: options.browserAvailable !== false,
        lastFetchDate: '2026-09-17',
      })
    }
    if (action === 'load') {
      const what = payload.what
      if (what === 'topics') return respond({ topics: state.topics, total: state.topics.length })
      if (what === 'fetch') return respond(options.fetchResult || state.fetchResult || {})
      if (what === 'candidates') return respond({ candidates: options.candidates || [], items: [] })
      if (what === 'copies') return respond({ copies: options.copies || [] })
      if (what === 'layouts') {
        // 跟主机侧一个口径：能做图的帖子 = 点过「保存」的稿子
        const savedCopies = (options.copies || []).filter((copy) => copy && copy.savedByUser)
        return respond({
          layouts: options.layouts || [],
          template: state.template,
          layoutItems: savedCopies.map((copy) => ({
            id: copy.id,
            title: String((copy.titles || [])[0] || copy.sourceTitle || ''),
            body: String(copy.bodyAfterDeAi || copy.body || ''),
            sourceTitle: String(copy.sourceTitle || ''),
            sourceLink: String(copy.sourceLink || ''),
          })),
        })
      }
      if (what === 'log') return respond({ log: '测试日志' })
      if (what === 'sop') {
        return respond({
          coldStart: { week1: [{ day: 'Day 1', type: '自我介绍', goal: '让人知道你是谁' }], week2: ['每天固定时间发'], mindset: '前两周只看收藏和评论' },
          topicScore: { items: [{ dimension: '匹配度', rule: '一致吗' }], rule: '平均分 >= 3.5' },
          positioning: { three: ['你是谁'], benchmark: ['账号定位'], sixLayers: ['目标人群'], training: ['每周拆 3 条'] },
          compliance: { quantity: ['标题不夸张'], aiLabel: '要标注', external: '', banned: '绝对化用语', copy: '别搬运' },
          risks: ['去 AI 味后要自己读一遍'],
        })
      }
      return respond({})
    }
    // 做图排版：上传模板（主机侧收 dataURL 落盘，这里只记元数据） + 取模板原图
    if (action === 'saveTemplate') {
      const dataUrl = String(payload.dataUrl || '')
      if (!/^data:image\//.test(dataUrl)) return respond({ ok: false })
      state.template = {
        file: 'template-fake.png',
        name: String(payload.name || ''),
        width: Number(payload.width) || 0,
        height: Number(payload.height) || 0,
        exists: true,
        dataUrl,
      }
      return respond({ template: state.template, size: dataUrl.length })
    }
    if (action === 'templateImage') {
      // 浏览器 fetch 拿的是图片字节流（api.getRawImage）
      return new Response(Buffer.from('89504e470d0a1a0a', 'hex'), { status: 200, headers: { 'Content-Type': 'image/png' } })
    }
    // 模板文件夹：列出 / 打开 / 应用某一张
    if (action === 'listTemplates') {
      return respond({ dir: 'C:\\x\\ai-news-workbench\\templates', templates: state.templateList || [], active: state.template.file || '' })
    }
    if (action === 'openTemplateFolder') {
      return respond({ dir: 'C:\\x\\ai-news-workbench\\templates', opened: true, templates: state.templateList || [] })
    }
    if (action === 'useTemplate') {
      const file = String(payload.file || '')
      const hit = (state.templateList || []).find((item) => item.file === file)
      if (!hit) return respond({ ok: false })
      state.template = Object.assign({}, hit, { exists: true })
      return respond({ template: state.template })
    }
    // 封面标签（模块5）的「刷新」：跟主机侧一样回 layoutItems + template
    if (action === 'layout') {
      const savedCopies = (options.copies || []).filter((copy) => copy && copy.savedByUser)
      if (!savedCopies.length) return respond({ ok: false, error: '做图排版只认「④ 写文案」里点过「保存」的帖子。' })
      return respond({
        layoutItems: savedCopies.map((copy) => ({
          id: copy.id,
          title: String((copy.titles || [])[0] || copy.sourceTitle || ''),
          body: String(copy.bodyAfterDeAi || copy.body || ''),
          sourceTitle: String(copy.sourceTitle || ''),
          sourceLink: String(copy.sourceLink || ''),
        })),
        layouts: options.layouts || [],
        template: state.template,
        local: true,
        llm: false,
      })
    }
    // 存入选题库：跟主机侧一样按 link（没链接用 title）去重，并把整张列表回给界面
    if (action === 'saveTopic') {
      const item = payload.item || payload.topic || {}
      const key = keyOfTopic(item)
      const exists = state.topics.find((topic) => keyOfTopic(topic) === key)
      if (exists) return respond({ added: false, topic: exists, total: state.topics.length, topics: state.topics })
      const saved = {
        id: `topic_${++topicSeq}`,
        title: String(item.title || '(无标题)'),
        source: String(item.source || ''),
        link: String(item.link || ''),
        date: String(item.date || ''),
        savedAt: new Date().toISOString(),
      }
      state.topics = [saved].concat(state.topics)
      return respond({ added: true, topic: saved, total: state.topics.length, topics: state.topics })
    }
    // 删除选题：删完把剩下的列表回给界面（界面要就地更新，不能整页清空）
    if (action === 'deleteTopic') {
      const before = state.topics.length
      state.topics = state.topics.filter((topic) => topic.id !== String(payload.id || ''))
      return respond({ removed: before - state.topics.length, total: state.topics.length, topics: state.topics })
    }
    // 抓取进度：默认"没在跑"。想测进度条就设 state.progress（可以动态改，模拟抓取进行中）
    if (action === 'fetchProgress') {
      return respond(state.progress || options.progress || { running: false, done: 0, total: 0, phase: 'idle', items: 0, failures: 0, percent: 0 })
    }
    // 抓取：默认给一个可被断言的结果
    if (action === 'fetch') {
      const result =
        options.fetchResult ||
        { items: [], groups: [], failures: [], sites: [], total: 0, lastFetchDate: '2026-09-17', fetchedAt: '2026-09-17T06:30:00.000Z' }
      // 抓完主机侧会把结果写进缓存：之后 load({what:'fetch'}) 也要能读回来
      //（界面第二次进「② 扫源抓取」看的就是缓存那份，不能还是空的）
      if (options.fetchResult) state.fetchResult = options.fetchResult
      return respond(result)
    }
    return respond({})
  }
  return { apiCalls, state }
}

/** 简单断言器 */
export function createAsserter() {
  let pass = 0
  let fail = 0
  const failures = []
  return {
    check(label, condition, detail = '') {
      if (condition) {
        pass++
        console.log(`  OK  ${label}`)
      } else {
        fail++
        failures.push(`${label}${detail ? ` —— ${detail}` : ''}`)
        console.log(`  NG  ${label}${detail ? ` —— ${detail}` : ''}`)
      }
    },
    finish() {
      console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
      if (fail) {
        console.log('失败明细：')
        for (const line of failures) console.log(`  - ${line}`)
      }
      return fail
    },
  }
}

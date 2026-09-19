/**
 * AI 资讯工作台 —— 客户端 bundle（自动生成，请勿手改）
 *
 * 源文件：lib/client/store.js + ui.js + sidebar-entry.js + workbench.js + client.js
 * 重新生成：node build/build-client.mjs
 *
 * 格式说明：DSH 的客户端插件必须是"注册工厂"形式 —— 平台把 require 传进来，
 * 这里注册自己，平台再调 apply(ctx) 把界面注册到槽位（主界面视图 + 侧边栏入口）。
 * 这里绝不能出现 import / export（那会让整个组合脚本语法报错、连累其他插件）。
 */
window.__ModuleLoader__.load({
  id: "dsh-ai-news-workbench",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    // ==================== store.js ====================
    /**
     * AI 资讯工作台 —— 界面侧小状态仓
     *
     * 为什么需要它：
     *  侧边栏按钮和"全屏弹窗"是两个互不相邻的组件，按钮点击后要通知弹窗打开。
     *  client 代码是同一个 bundle、同一个 JS 作用域，所以这里用一个极小的订阅式 store
     *  做通信（比再塞一个 cordis 服务简单、也更不容易崩）。
     *
     * ⚠ 关键点（踩过坑）：getSnapshot() 必须返回**稳定引用**。
     *  如果每次都 `Object.assign({}, state)` 造新对象，React 的 useSyncExternalStore
     *  会认为"状态一直在变"，进而无限重渲染 —— 也就是 React error #185。
     *  所以这里把快照冻结成一个对象，只在真正变化时替换它。
     */

    const listeners = new Set()

    /** 内部状态（不直接暴露出去） */
    const state = {
      /** 弹窗是否打开 */
      open: false,
      /** 最近一次界面错误（给用户看的一句话） */
      lastError: '',
    }

    /** 对外快照：只在变化时整体替换，保证引用稳定 */
    let snapshot = Object.freeze(Object.assign({}, state))

    function setState(patch) {
      let changed = false
      for (const key of Object.keys(patch)) {
        if (state[key] !== patch[key]) {
          state[key] = patch[key]
          changed = true
        }
      }
      if (!changed) return
      snapshot = Object.freeze(Object.assign({}, state))
      emit()
    }

    function emit() {
      for (const listener of Array.from(listeners)) {
        try {
          listener(snapshot)
        } catch (err) {
          try {
            console.error('[ai-news-workbench] store 订阅者出错：', err)
          } catch (logErr) {
            /* 忽略 */
          }
        }
      }
    }

    /** 订阅（返回退订函数） */
    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    /** 读快照（引用稳定，可以直接喂给 useSyncExternalStore） */
    function getSnapshot() {
      return snapshot
    }

    /** 打开工作台弹窗 */
    function openWorkbench() {
      setState({ open: true })
    }

    /** 关闭工作台弹窗（回到聊天界面） */
    function closeWorkbench() {
      setState({ open: false })
    }

    /** 切换开关 */
    function toggleWorkbench() {
      setState({ open: !state.open })
    }

    /** 记一条错误 */
    function setLastError(message) {
      setState({ lastError: String(message || '') })
    }

    // ==================== ui.js ====================
    /**
     * AI 资讯工作台 —— 界面侧公共零件（样式 + 小工具 + 接口调用）
     *
     * 说明：界面侧只负责显示按钮/卡片/结果区，真正的活都走主机侧接口（/xmt-kf/api）。
     *
     * 视觉规范：深色玻璃拟态（Dark Glassmorphism）+ 霓虹状态发光
     *  - 所有颜色/间距/圆角都是 CSS 变量（见 TOKENS），改一处全局跟着变
     *  - 需要 hover / :active / 关键帧的地方由 ensureStyles() 注入一段样式表
     *    （内联 style 写不了 :hover / :active，也写不了动画）
     *  - 注入失败不影响功能：只丢视觉效果，界面照常能点
     */

    /** CSS 变量名与取值（--xmt- 前缀，不与 Harness 主题变量冲突） */
    const TOKENS = {
      // 底色：原来的那套渐变 —— 135° 深蓝 → 墨绿主渐变（linear-gradient(135deg,#0a1628,#0d1f2d,#0a1f1a)）
      //  + 两块柔光（左上蓝 / 右下绿）。色值按设计规范原样保留，不许再改成纯蓝：
      //  改成纯蓝之后最下面那一截变成近黑的 #0c1b2c，滚到底看起来就是"黑屏断层"。
      '--xmt-bg': 'radial-gradient(1100px 620px at 16% 8%, rgba(59,130,246,0.14), rgba(59,130,246,0) 62%), radial-gradient(900px 560px at 88% 92%, rgba(34,197,94,0.12), rgba(34,197,94,0) 62%), linear-gradient(135deg, #0a1628 0%, #0d1f2d 52%, #0a1f1a 100%)',
      // 卡片底：深色半透明，能透出背后的渐变（不用 backdrop-filter，避免某些浏览器渲染成浅色不透明块）
      '--xmt-glass': 'rgba(255,255,255,0.05)',
      '--xmt-glass-2': 'rgba(255,255,255,0.08)',
      '--xmt-line': 'rgba(255,255,255,0.10)',
      '--xmt-line-2': 'rgba(255,255,255,0.16)',
      '--xmt-text': 'rgba(255,255,255,0.95)',
      '--xmt-text-2': 'rgba(255,255,255,0.72)',
      '--xmt-text-3': 'rgba(255,255,255,0.45)',
      '--xmt-text-4': 'rgba(255,255,255,0.30)',
      // 状态文字色：未开始用灰
      '--xmt-text-idle': 'rgba(255,255,255,0.4)',
      '--xmt-accent': '#3b82f6',
      '--xmt-ok': '#22c55e',
      '--xmt-warn': '#f59e0b',
      '--xmt-danger': '#f87171',
      '--xmt-hi': '#fbbf24',
      '--xmt-glow-accent': 'rgba(59,130,246,0.25)',
      '--xmt-glow-accent-strong': 'rgba(59,130,246,0.5)',
      '--xmt-glow-ok': 'rgba(34,197,94,0.25)',
      '--xmt-glow-ok-strong': 'rgba(34,197,94,0.5)',
      '--xmt-glow-warn': 'rgba(245,158,11,0.25)',
      '--xmt-glow-warn-strong': 'rgba(245,158,11,0.5)',
      '--xmt-inset-accent': 'rgba(59,130,246,0.05)',
      '--xmt-inset-ok': 'rgba(34,197,94,0.05)',
      '--xmt-inset-warn': 'rgba(245,158,11,0.05)',
      '--xmt-radius': '14px',
      // 顶部栏（二级页返回栏 / 模块标题行）的吸顶底色：跟下方背景同一套深蓝墨绿，
      // 不用纯黑 —— 纯黑会在顶部切出一条明显的黑带，跟下面的渐变对不上。
      '--xmt-head-bg': 'linear-gradient(180deg, rgba(15,36,53,0.94) 0%, rgba(10,24,40,0.88) 100%)',
      '--xmt-radius-sm': '8px',
      '--xmt-radius-pill': '999px',
      '--xmt-space': '16px',
      '--xmt-space-lg': '20px',
      '--xmt-space-sm': '8px',
      // 网格：3 列固定 150px 卡片、间距 12px、卡片 150×112、整体居中（比上一版更紧凑）
      '--xmt-grid-gap': '12px',
      '--xmt-card-pad': '12px',
      '--xmt-card-w': '150px',
      '--xmt-card-h': '112px',
      '--xmt-grid-max': '486px',
      // 一级界面居中：只留左右安全边距，上下靠 flex 居中，不再靠 padding 挤
      '--xmt-stage-pad': '20px',
      // 氛围动效的节奏（有意的慢，别抢眼）
      '--xmt-bg-drift': '26s',
      '--xmt-shimmer': '9s',
      '--xmt-font': "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', '微软雅黑', 'Helvetica Neue', Arial, sans-serif",
      '--xmt-font-mono': "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Cascadia Mono', 'Microsoft YaHei', monospace",
    }

    /** 拼成一段 :root 变量声明（样式表和内联容器共用） */
    function tokenCss() {
      return Object.keys(TOKENS)
        .map((key) => `${key}:${TOKENS[key]};`)
        .join('')
    }

    /** 常用 class 名（写错会静默没样式，所以集中在这里） */
    const CLS = {
      root: 'xmt-root',
      page: 'xmt-page',
      topbar: 'xmt-topbar',
      title: 'xmt-title',
      subtitle: 'xmt-subtitle',
      card: 'xmt-card',
      cardTitle: 'xmt-card-title',
      sec: 'xmt-sec',
      grid: 'xmt-grid',
      mcard: 'xmt-mcard',
      mcardTop: 'xmt-mcard-top',
      mcardIcon: 'xmt-mcard-icon',
      mcardName: 'xmt-mcard-name',
      mcardState: 'xmt-mcard-state',
      moduleHead: 'xmt-module-head',  moduleHeadLeft: 'xmt-module-head-left',
      moduleActions: 'xmt-module-actions',
      moduleTitle: 'xmt-module-title',
      stage: 'xmt-stage',
      mainWrap: 'xmt-main-wrap',
      mainBar: 'xmt-main-bar',
      settingsEntry: 'xmt-settings-entry',
      scroll: 'xmt-scroll',
      overlay: 'xmt-overlay',
      panel: 'xmt-panel',
      panelScroll: 'xmt-panel-scroll',
      /** 背景流动光（会飘会呼吸的那一层，永远在最底下，不接鼠标） */
      panelGlow: 'xmt-panel-glow',
      gridTwo: 'xmt-grid-2',
      subItem: 'xmt-subitem',
      subItemTitle: 'xmt-subitem-title',
      /** 本次新增帖子的右下角红点（8 秒后自动消失） */
      newDot: 'xmt-newdot',
      progress: 'xmt-progress',
      progressHead: 'xmt-progress-head',
      progressLabel: 'xmt-progress-label',
      progressNum: 'xmt-progress-num',
      progressTrack: 'xmt-progress-track',
      progressFill: 'xmt-progress-fill',
      progressFoot: 'xmt-progress-foot',
      bg: 'xmt-bg',
      bgFlow: 'xmt-bg-flow',
      modalBg: 'xmt-modal-bg',
      modalBgFlow: 'xmt-modal-bg-flow',
      stagePage: 'is-stage-page',
      mcardAdd: 'xmt-mcard-add',
      mcardAddNav: 'xmt-add-nav',
      dataStrip: 'xmt-datastrip',
      dataItem: 'xmt-data-item',
      dataIcon: 'xmt-data-icon',
      dataNum: 'xmt-data-num',
      dataLabel: 'xmt-data-label',
      btn: 'xmt-btn',
      spinner: 'xmt-spinner',
      badge: 'xmt-badge',
      pill: 'xmt-pill',
      tags: 'xmt-tags',
      tag: 'xmt-tag',
      result: 'xmt-result',
      item: 'xmt-item',
      itemTitle: 'xmt-item-title',
      itemTitleClamp: 'is-clamp2',
      /** 选题库卡片上的"正文节选"（最多 3 行，超出省略） */
      itemBody: 'xmt-item-body',
      /** 模块3 候选正文：超出显示范围时用省略号截断（不许硬切半句话） */
      bodyClamp: 'xmt-body-clamp',
      /** 封面标签：正文要**完整显示**（不截断、不加省略号），跟上面的 bodyClamp 正相反 */
      bodyFull: 'xmt-body-full',
      /** 封面标签：一条帖子 = 左右两栏（左放封面 / 右放标题、正文、标签） */
      split: 'xmt-split',
      splitLeft: 'xmt-split-left',
      splitRight: 'xmt-split-right',
      /** 帖子右下角的操作行（「删除」按钮放这儿） */
      itemFoot: 'xmt-item-foot',
      /** 设置页：一条网站 = 左边网格（名称/网址/难度）+ 右边右上角的「删除这个网站」 */
      siteRow: 'xmt-site-row',
      siteRowAction: 'xmt-site-row-action',
      meta: 'xmt-meta',
      link: 'xmt-link',
      check: 'xmt-check',
      checkHit: 'is-hit',
      checkLabel: 'xmt-check-label',
      checkRule: 'xmt-check-rule',
      checkReason: 'xmt-check-reason',
      checkReasonBad: 'xmt-check-reason-bad',
      hint: 'xmt-hint',
      empty: 'xmt-empty',
      /** 做图排版 / 封面标签：还没出图时的图片预览占位框 */
      emptyPreview: 'xmt-empty-preview',
      /** 封面标签：生成后的缩略图条 */
      thumbStrip: 'xmt-thumb-strip',
      thumbItem: 'xmt-thumb-item',
      /** 封面标签：模板缩略图卡片（选中那张带 is-active） */
      templateCard: 'xmt-template-card',
      templateCardActive: 'is-active',
      /** 封面标签：标签编辑器（可以手动改） */
      tagEditor: 'xmt-tag-editor',
      tagEditItem: 'xmt-tag-edit',
      tagHash: 'xmt-tag-hash',
      tagInput: 'xmt-tag-input',
      tagDel: 'xmt-tag-del',
      msgOk: 'xmt-msg-ok',
      msgBad: 'xmt-msg-bad',
      /** 顶部提示浮层（不占文档流高度，出现时不会把内容挤下去） */
      toast: 'xmt-toast',
      /** 模块3 顶部的时间筛选条 */
      rangeBar: 'xmt-range-bar',
      msgForm: 'xmt-msg-form',
      msgBar: 'xmt-msg-bar',
      mark: 'xmt-mark',
      metricGrid: 'xmt-metric-grid',
      metric: 'xmt-metric',
      metricNum: 'xmt-metric-num',
      metricLabel: 'xmt-metric-label',
      metricJudge: 'xmt-metric-judge',
      suggest: 'xmt-suggest',
      suggestWhere: 'xmt-suggest-where',
      suggestRow: 'xmt-suggest-row',
      suggestFrom: 'xmt-suggest-from',
      suggestTo: 'xmt-suggest-to',
      suggestWhy: 'xmt-suggest-why',
      copyCard: 'xmt-copycard',
      copyNo: 'xmt-copycard-no',
      body: 'xmt-body',
      collapsed: 'xmt-collapsed',
      field: 'xmt-field',
      label: 'xmt-label',
      input: 'xmt-input',
      select: 'xmt-select',
      textarea: 'xmt-textarea',
      row: 'xmt-row',
      fadeIn: 'xmt-fade-in',
      enterBtn: 'xmt-enter-entry',
      enterIcon: 'xmt-enter-icon',
      enterLabel: 'xmt-enter-label',
      fieldBox: 'xmt-field-box',
      on: 'is-on',
    }

    /** 按钮变体 / 尺寸 / 色调（避免各处写字符串写错） */
    const BTN = { primary: 'is-primary', ghost: 'is-ghost', ok: 'is-ok', bad: 'is-bad' }
    const SIZE = { tiny: 'is-tiny' }
    const TONE = { idle: 'idle', run: 'run', done: 'done', wait: 'wait' }

    /**
     * 色调 -> CSS 变量（卡片描边 / 外发光 / 内发光 / 状态大字 / 描边流光 / 外面那圈呼吸光共用）
     * halo：画在卡片边框**外面**的呼吸光（暗一档的柔和色，别太抢眼）
     * haloSoft：呼吸到最强时那一帧的光
     */
    const TONE_VARS = {
      idle: { main: 'var(--xmt-line)', glow: 'none', glowStrong: 'none', inset: 'transparent', text: 'var(--xmt-text-idle)', shine: 'xmt-shimmer', shineColor: 'rgba(255,255,255,0.55)', halo: 'none', haloSoft: 'none', haloInset: 'transparent', haloTint: 'transparent' },
      run: { main: 'var(--xmt-accent)', glow: 'var(--xmt-glow-accent)', glowStrong: 'var(--xmt-glow-accent-strong)', inset: 'var(--xmt-inset-accent)', text: 'var(--xmt-warn)', shine: 'xmt-shimmer-blue', shineColor: 'rgba(147,197,253,0.85)', halo: '0 0 9px 0 rgba(59,130,246,0.20)', haloSoft: '0 0 14px 1px rgba(59,130,246,0.36)', haloInset: 'rgba(59,130,246,0.60)', haloTint: 'rgba(59,130,246,0.45)' },
      done: { main: 'var(--xmt-ok)', glow: 'var(--xmt-glow-ok)', glowStrong: 'var(--xmt-glow-ok-strong)', inset: 'var(--xmt-inset-ok)', text: 'var(--xmt-ok)', shine: 'xmt-shimmer-green', shineColor: 'rgba(134,239,172,0.85)', halo: '0 0 9px 0 rgba(34,197,94,0.20)', haloSoft: '0 0 14px 1px rgba(34,197,94,0.36)', haloInset: 'rgba(34,197,94,0.60)', haloTint: 'rgba(34,197,94,0.45)' },
      wait: { main: 'var(--xmt-warn)', glow: 'var(--xmt-glow-warn)', glowStrong: 'var(--xmt-glow-warn-strong)', inset: 'var(--xmt-inset-warn)', text: 'var(--xmt-warn)', shine: 'xmt-shimmer-amber', shineColor: 'rgba(252,211,77,0.85)', halo: '0 0 9px 0 rgba(245,158,11,0.20)', haloSoft: '0 0 14px 1px rgba(245,158,11,0.36)', haloInset: 'rgba(245,158,11,0.60)', haloTint: 'rgba(245,158,11,0.45)' },
    }

    /**
     * 把色调写成内联 CSS 变量（卡片本体用 class，颜色随状态走这条）
     * breatheDelay：错开各卡片的呼吸相位，避免整屏一起闪（传 -0.6s / -1.2s … 这种负值即可）
     */
    function toneStyle(tone, breatheDelay) {
      const picked = TONE_VARS[tone] || TONE_VARS.idle
      return {
        '--xmt-tone': picked.main,
        '--xmt-tone-glow': picked.glow,
        '--xmt-tone-glow-strong': picked.glowStrong,
        '--xmt-tone-inset': picked.inset,
        '--xmt-tone-text': picked.text,
        '--xmt-tone-shine': picked.shine,
        '--xmt-tone-shine-color': picked.shineColor,
        '--xmt-halo': picked.halo,
        '--xmt-halo-soft': picked.haloSoft,
        '--xmt-halo-tint': picked.haloTint,
        ...(breatheDelay ? { '--xmt-breathe-delay': breatheDelay } : null),
      }
    }

    /** 把数字/人名/时间这类要盯紧的词包成高亮（模块3、模块7 用） */
    function markAll(h, text, keyPrefix = 'mark') {
      const raw = String(text === undefined || text === null ? '' : text)
      if (!raw) return null
      const re = /\d+(?:\.\d+)?%?|[A-Za-z][A-Za-z0-9.\-_]{1,}/g
      const out = []
      let last = 0
      let match = re.exec(raw)
      let index = 0
      while (match) {
        if (match.index > last) out.push(raw.slice(last, match.index))
        out.push(h('span', { key: `${keyPrefix}_m${index++}`, className: CLS.mark }, match[0]))
        last = match.index + match[0].length
        match = re.exec(raw)
      }
      if (!out.length) return raw
      if (last < raw.length) out.push(raw.slice(last))
      return out
    }

    // ---------------------------------------------------------------------------
    // 样式表：只注入一次，管 hover / :active / 动画 / 窄屏降列
    // ---------------------------------------------------------------------------

    const STYLE_ID = 'xmt-kf-style'
    let styleInjected = false

    /** 深色玻璃拟态样式表 */
    function stylesheet() {
      return `
    .${CLS.root}{
      ${tokenCss()}
      /* 兜底底色：渐变只画在一处 —— 二级弹窗的滚动容器 .xmt-panel-scroll（fixed 钉在视口，滚到底不断层） */
      background-color:#0b1727;
      color: var(--xmt-text);
      font-family: var(--xmt-font);
      font-size: 13px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      /* 整块工作台 = 一条 flex 列：背景层（绝对定位）+ 内容滚动区
         ⚠ 这里**不能**写 overflow:hidden —— 写了之后里面的滚动区滚不动，
           内容一超高就被裁掉（一级界面"滑不动"就是这个原因）。
         min-height:100%（不是 height）：父容器有确定高度（弹窗是固定高度）时刚好铺满，
           拿不到确定高度时也不会塌成 0 —— 之前写 min-height:0 导致工作台比弹窗矮，
           于是背景渐变只铺了上面一截、下面露出纯底色（"下面是空的"就是这个原因） */
      position:relative;
      display:flex;
      flex-direction:column;
      min-height:100%;
    }
    /* 弹窗里的工作台：父容器（.xmt-panel-scroll）有确定高度，用 height:100% 铺满；
       它自己**不铺背景**（背景统一由 .xmt-panel-scroll 那层 fixed 渐变负责，避免把背景切断）；
       z-index:1 = 压在背景流动光（.xmt-panel-glow，z-index:0）上面 */
    .${CLS.root}.in-panel{height:100%;background:transparent;position:relative;z-index:1}

    /* 背景只画在一处 —— 二级弹窗的滚动容器 .xmt-panel-scroll
       （用原来的渐变值 + background-attachment:fixed + background-size:cover，见下面那条规则）。
       原来那两层"跟着内容高度铺"的背景（.xmt-bg / .xmt-bg-flow）已删除：
       内容一长它们会被拉到几千像素高，滚到底就露底，出现黑断层。
       工作台自己（.xmt-root）、弹窗外壳（.xmt-overlay / .xmt-panel）、内容页（.xmt-page）
       一律不留任何背景，谁也不许把这一整块渐变切断。 */
    /* 内容层压在两层背景之上 */
    .${CLS.root} .${CLS.scroll}{position:relative;z-index:2}
    /* xmt-root-rule-end（给样式体检用的锚点：上面这一大段是 .xmt-root 的规则，token 里的大括号会干扰正则） */
    .${CLS.root} *{box-sizing:border-box}
    .${CLS.root} ::-webkit-scrollbar{width:10px;height:10px}
    .${CLS.root} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:999px;border:2px solid transparent;background-clip:content-box}
    .${CLS.root} ::-webkit-scrollbar-track{background:transparent}

    /* ---------- 顶部条（二级页/设置页/日志页的返回栏） ----------
       ⚠ 页面层不要再留上内边距：顶部条是 sticky 的，页面一旦有上内边距，
         顶部条吸上去之后下面就会多出一条空白（"顶部没置顶/有空隙"就是这个） */
    .${CLS.topbar}{
      display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
      padding:12px 18px;margin:0 0 var(--xmt-space-lg);
      /* 吸顶条的底色：**不自己画背景**，改成"毛玻璃"——
         背景完全透明 + backdrop-filter 把身后真正的那层（面板渐变 + 会流动的柔光 + 卡片自己的半透明底）
         取样模糊一下。这样它跟紧挨着的下方区域取的是同一块底色，中间不会再切出一条色差带。
         （之前是给吸顶条铺一张 background-image:var(--xmt-bg)：渐变本身对得上，
           可是背景光那一层在吸顶条下面、被它挡住了，所以条子还是比下面暗一截。） */
      background:transparent;
      -webkit-backdrop-filter:blur(14px) saturate(115%);
      backdrop-filter:blur(14px) saturate(115%);
      border-bottom:1px solid var(--xmt-line);
      position:sticky;top:0;z-index:5;
    }
    /* 万一浏览器不支持 backdrop-filter：退回"跟面板同一张图"的老做法（至少颜色也是背景色，不是另画一条） */
    @supports not ((backdrop-filter:blur(2px)) or (-webkit-backdrop-filter:blur(2px))){
      .${CLS.topbar},.${CLS.moduleHead}{
        background-image:var(--xmt-bg);
        background-repeat:no-repeat;
        background-size:cover;
        background-position:center;
        background-attachment:fixed;
        background-color:#0c1c2b;
      }
    }
    .${CLS.title}{font-size:16px;font-weight:700;color:var(--xmt-text)}
    .${CLS.subtitle}{font-size:12px;color:var(--xmt-text-3);margin-top:2px}
    .${CLS.page}{padding:0 0 40px;max-width:1400px;margin:0 auto;background:transparent}
    .${CLS.msgBar}{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}

    /* ---------- 卡片（深色半透明 + 细边框） ---------- */
    .${CLS.card}{
      position:relative;
      background:var(--xmt-glass);
      border:1px solid var(--xmt-line);
      border-radius:var(--xmt-radius);
      padding:var(--xmt-space-lg);
      margin-bottom:var(--xmt-space-lg);
      transition:transform .2s ease, border-color .2s ease, box-shadow .2s ease;
    }
    .${CLS.card}:hover{border-color:var(--xmt-line-2)}
    .${CLS.cardTitle}{
      display:flex;align-items:center;justify-content:space-between;gap:8px;
      font-size:14px;font-weight:700;color:var(--xmt-text);margin-bottom:12px;
    }
    /* ---------- 卡片内第一行：左边「返回 + 图标 + 模块名 + 状态」，右边同一行放操作按钮 ---------- */
    .${CLS.moduleHead}{
      display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
      padding:12px 4px;margin:0 0 14px;
      border-bottom:1px solid var(--xmt-line);
      /* 操作按钮钉在可视区顶部：往下滚的时候这一行（含「刷新」）不跟着跑 */
      position:sticky;top:0;z-index:6;
      /* 跟顶部栏一样改成"毛玻璃"：底色完全透明，用 backdrop-filter 取身后真正的底色
         （面板渐变 + 流动柔光 + 卡片自己的半透明底），这样它和下方不会再有颜色断层 */
      background:transparent;
      -webkit-backdrop-filter:blur(14px) saturate(115%);
      backdrop-filter:blur(14px) saturate(115%);
    }
    .${CLS.moduleHeadLeft}{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
    /* 操作按钮组：靠右、同一行、放不下才换行 */
    .${CLS.moduleActions}{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;min-width:0;flex:0 1 auto}
    .${CLS.moduleTitle}{font-size:16px;font-weight:700;color:var(--xmt-text);line-height:1.3;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .${CLS.sec}{font-size:13px;font-weight:600;color:var(--xmt-text-2);margin:var(--xmt-space) 0 10px;letter-spacing:.02em}

    /* ---------- 控制室数据条 ---------- */
    .${CLS.dataStrip}{
      display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));
      gap:10px;margin:12px 0 4px;
    }
    .${CLS.dataItem}{
      display:flex;flex-direction:column;gap:2px;
      padding:12px 14px;border-radius:var(--xmt-radius-sm);
      background:rgba(255,255,255,.04);border:1px solid var(--xmt-line);
      transition:transform .2s ease,border-color .2s ease;
    }
    .${CLS.dataItem}:hover{transform:translateY(-2px);border-color:var(--xmt-line-2)}
    .${CLS.dataIcon}{font-size:13px;line-height:1;color:var(--xmt-text-3)}
    .${CLS.dataNum}{font-family:var(--xmt-font-mono);font-size:18px;font-weight:700;line-height:1.3;color:var(--xmt-text)}
    .${CLS.dataLabel}{font-size:12px;color:var(--xmt-text-3)}

    /* ---------- 二级弹窗：**position:fixed 浮层**，绝对不挤占下方主界面 ----------
       为什么要 fixed：二级弹窗如果跟着文档流走（relative/static），一打开就把下面的主界面往下推，
       看起来就是"抖一下"。fixed + top/left 定位之后它彻底脱离文档流，下方内容位置一动不动。
       背景仍然保持 transparent：整块渐变统一由 .xmt-panel-scroll 那一层负责（见下面的注释）。 */
    .${CLS.overlay}{
      position:fixed;top:0;left:var(--xmt-modal-left,0px);right:0;bottom:0;
      z-index:2;
      display:flex;flex-direction:column;
      align-items:stretch;justify-content:stretch;
      padding:var(--xmt-panel-inset,0px);
      background:transparent;
      /* 滚动交给里面的 .xmt-panel-scroll，这一层自己不滚（避免出现两层滚动条） */
      overflow:hidden;
      /* 打开动画只保留 opacity 淡入：不用 margin / transform，位置永远不动 */
      animation:xmt-panel-fade-in .18s ease;
    }
    .${CLS.panel}{
      display:flex;flex-direction:column;
      width:100%;
      flex:1 1 auto;
      min-height:0;
      background:transparent;
      border:0;
      border-radius:var(--xmt-panel-radius,0px);
      /* 圆角这里要有：里面的背景层有溢出，靠它 + overflow:hidden 兜住（防止边角冒色块） */
      overflow:hidden;
    }
    /* 弹窗外壳不再单独铺背景：整块渐变只画在 .xmt-panel-scroll 那一层
       （fixed 钉在视口上，滚到底不断层）。这里留空是为了标明位置，不要在这里再加背景。 */
    /* 二级弹窗是浮层：定位已经在上面 .xmt-overlay 的规则里定死（position:fixed），
       这里不再覆盖成 relative —— 一旦回到文档流，打开时就会把下面的主界面往下挤。 */

    /* 打开动画：只做 opacity 淡入（不碰 margin / top / left / transform，位置从头到尾不动） */
    @keyframes xmt-panel-fade-in{
      from{opacity:0}
      to{opacity:1}
    }

    /* ---------- 滚动容器、页面、居中舞台 ----------
       布局链（一级界面）：
         .xmt-overlay（侧边栏右边那块）→ .xmt-panel（面板）→ .xmt-panel-scroll（唯一滚动条，**背景画在这一层**）
         → .xmt-page.is-stage-page（display:contents，不占高度）→ .xmt-stage（撑满面板，justify 居中）
         → .xmt-grid（卡片网格，自带上下安全边距） */
    .${CLS.root} .xmt-scroll{
      display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:auto;
    }
    /* 弹窗里的滚动区：背景**直接画在这一层**上（别的层一律 transparent，谁也不许盖）。
       界面上原来那套渐变（深蓝 → 墨绿）原样搬过来，并且用 background-attachment:fixed
       把它钉在视口上 —— 内容再长、滚到最底部，背景都是连续的一整块，不会出现断层/露黑底。 */
    .${CLS.root} .xmt-panel-scroll{
      flex:1 1 auto;
      /* 背景层不矮于视口：滚到底时下面依然有渐变铺着（不会再露出黑色底） */
      min-height:100vh;
      overflow-y:auto;overflow-x:hidden;
      border-radius:var(--xmt-panel-radius,0px);
      overscroll-behavior:contain;
      background-image:var(--xmt-bg);
      background-repeat:no-repeat;
      background-size:cover;
      background-position:center;
      background-attachment:fixed;
      background-color:#0b1727;
    }
    .${CLS.root} .${CLS.page}{
      display:flex;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;
    }
    /* ---------- 背景"流动感"：真的会动的 @keyframes 大柔光 ----------
       为什么要这么写：以前是把动画加在**主渐变**的 background-position 上，
       可是那张渐变是 background-attachment:fixed + cover 的 —— 它跟视口一样大，
       百分比位移能挪动的实际上只有十几像素，肉眼根本看不出来（用户反馈"看不到流动"就是这个原因）。

       现在改成：在主背景之上再放一层 .xmt-panel-glow（结构在 client.js 里），
       里面两个很大的柔光球用 transform + opacity 慢慢飘、慢慢明暗呼吸（26s / 34s 一轮）。
       硬要求都满足：
         · 是**真的 CSS @keyframes 动画**，动的是背景色块的位置和明暗；
         · 只挂在伪元素上、且这一层 pointer-events:none、永远在最底下（z-index:0），
           卡片的布局、hover、点击完全不受影响；
         · 两个伪元素的动画写在 ::before/::after 上，不会被
           @media (prefers-reduced-motion) 里那条「.xmt-root * 全部 animation:none」关掉
           （伪元素不是元素，那条选不中），所以系统开了"减少动效"也照样能动。 */
    .${CLS.panelGlow}{
      position:fixed;top:0;left:var(--xmt-modal-left,0px);right:0;bottom:0;
      z-index:0;pointer-events:none;overflow:hidden;
    }
    .${CLS.panelGlow}::before,
    .${CLS.panelGlow}::after{content:'';position:absolute;border-radius:50%}
    .${CLS.panelGlow}::before{
      width:78vw;height:78vh;left:-16vw;top:-24vh;
      background:radial-gradient(closest-side, rgba(59,130,246,.34), rgba(59,130,246,.10) 55%, rgba(59,130,246,0) 80%);
      animation:xmt-glow-a 26s ease-in-out infinite;
    }
    .${CLS.panelGlow}::after{
      width:74vw;height:74vh;right:-18vw;bottom:-28vh;
      background:radial-gradient(closest-side, rgba(34,197,94,.30), rgba(34,197,94,.09) 55%, rgba(34,197,94,0) 80%);
      animation:xmt-glow-b 34s ease-in-out infinite;
    }
    @keyframes xmt-glow-a{
      0%,100%{transform:translate3d(0,0,0) scale(1);opacity:.5}
      30%{transform:translate3d(26vw,16vh,0) scale(1.28);opacity:.9}
      60%{transform:translate3d(8vw,36vh,0) scale(.9);opacity:.45}
      80%{transform:translate3d(-8vw,14vh,0) scale(1.12);opacity:.75}
    }
    @keyframes xmt-glow-b{
      0%,100%{transform:translate3d(0,0,0) scale(1.06);opacity:.55}
      35%{transform:translate3d(-24vw,-18vh,0) scale(1.3);opacity:.95}
      65%{transform:translate3d(-6vw,-36vh,0) scale(.88);opacity:.4}
      85%{transform:translate3d(8vw,-12vh,0) scale(1.14);opacity:.8}
    }
    /* 一级界面：让 .xmt-page 这一层不参与布局，舞台直接撑满滚动区（真正的上下左右居中） */
    .${CLS.root} .${CLS.page}.is-stage-page{display:contents}

    /* ---------- 主界面舞台：卡片整体水平 + 垂直居中 ---------- */
    .${CLS.stage}{
      display:flex;flex-direction:column;
      /* ⚠ 用 stretch 不用 center：center 会把内容压成"内容宽度"，
         左侧的坐标原点就跟着变窄了，左上角的设置按钮会跑到中间去 */
      align-items:stretch;
      justify-content:center;
      flex:1 0 auto;
      min-height:100%;
      min-width:0;
      /* 上下 40px / 左右 20px 安全边距：卡片不贴面板边缘，也不会顶到最下面被裁 */
      padding:40px var(--xmt-stage-pad);
    }
    /* 舞台里的外壳撑满可用宽度（网格靠自己的 margin:auto + max-width 居中） */
    .${CLS.stage} > *{flex:0 0 auto;min-width:0;max-width:100%}

    /* ---------- 一级页外壳：网格仍然整体居中（设置按钮已挪到弹窗最外层，不在这里） ---------- */
    .${CLS.mainWrap}{
      display:flex;flex-direction:column;
      position:relative;width:100%;min-width:0;
    }
    /* 设置入口：钉在弹窗最外层容器的左上角（距左/上各 24px），不参与卡片网格的居中计算 */
    .${CLS.mainBar}{
      position:absolute;top:24px;left:24px;z-index:100;
      display:flex;align-items:center;gap:8px;
    }
    /* 设置按钮做大一点（一级页唯一的入口，别做成小字按钮） */
    .${CLS.settingsEntry}{
      padding:11px 22px;font-size:15px;font-weight:600;border-radius:10px;
      border:1px solid var(--xmt-line-2);background:rgba(255,255,255,.08);color:var(--xmt-text);
      box-shadow:0 2px 10px rgba(0,0,0,.25);
    }
    .${CLS.settingsEntry}:hover{filter:brightness(1.2);border-color:var(--xmt-accent);box-shadow:0 0 14px var(--xmt-glow-accent)}

    /* ---------- 模块网格：3 列固定 150px，整体居中 ---------- */
    .${CLS.grid}{
      display:grid;gap:var(--xmt-grid-gap);
      grid-template-columns:repeat(3,var(--xmt-card-w));
      justify-content:center;
      width:100%;
      min-width:0;
      max-width:var(--xmt-grid-max);
      margin:0 auto;
      /* 顶部 / 底部安全边距（左右由舞台的 20px 负责，这里避免重复留白） */
      padding:40px 0;
    }
    /* 结果列表：双列（每张卡自己撑满一列，空白少很多）。
       align-items:stretch → 同一行的两张卡**等高**，不会因为标题长短参差不齐 */
    .${CLS.gridTwo}{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
      gap:10px;align-items:stretch;
    }
    .${CLS.subItem}{
      display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
      padding:9px 12px;border-radius:var(--xmt-radius-sm);
      border:1px solid var(--xmt-line);background:rgba(255,255,255,.03);
      min-width:0;
      /* 给标题固定"两行"的高度：标题长短不再影响卡片高度，同一行的卡也就一样高 */
      min-height:64px;box-sizing:border-box;
      /* 右下角那个"新增红点"要靠它定位 */
      position:relative;
    }
    /* 本次新增的帖子：右下角一颗红点，8 秒后由界面自动移除 */
    .${CLS.newDot}{
      position:absolute;right:6px;bottom:6px;
      width:8px;height:8px;border-radius:50%;
      background:#ef4444;
      box-shadow:0 0 8px rgba(239,68,68,.95);
      animation:xmt-dot-pop .22s ease-out;
      pointer-events:none;
    }
    @keyframes xmt-dot-pop{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}
    .${CLS.subItemTitle}{
      font-size:13px;line-height:1.5;color:var(--xmt-text);overflow-wrap:anywhere;
      /* 最多两行，超出省略 —— 列表里只看标题，不铺正文 */
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
      min-height:39px;
    }
    /* 整张卡就是点击区（按钮语义，键盘也能按） */
    .${CLS.mcard}{
      position:relative;
      width:var(--xmt-card-w);
      height:var(--xmt-card-h);
      min-height:var(--xmt-card-h);
      box-sizing:border-box;
      display:flex;flex-direction:column;justify-content:flex-start;
      gap:8px;
      padding:var(--xmt-card-pad);
      /* 立体感：左上一点反光 + 上亮下暗的玻璃渐变（不用 backdrop-filter，不会翻白） */
      background-image:
        radial-gradient(120% 80% at 18% 0%, rgba(255,255,255,0.06), rgba(255,255,255,0) 55%),
        linear-gradient(160deg, rgba(255,255,255,0.085) 0%, rgba(255,255,255,0.03) 45%, rgba(255,255,255,0.055) 100%);
      /* 实底玻璃色：卡片内部永远是深色（外圈光晕只画在边框外面，绝不会从里面透出来） */
      background-color:#152734;
      border:1px solid var(--xmt-tone,var(--xmt-line));
      border-radius:var(--xmt-radius);
      /* 四层：状态外发光（很淡的底色光）+ 落影 + 状态内发光 + 玻璃厚度（顶部高光棱 / 底部暗棱） */
      box-shadow:
        var(--xmt-halo,none),
        0 0 3px 0 var(--xmt-halo-tint,transparent),
        0 6px 16px rgba(0,0,0,0.35),
        inset 0 0 12px var(--xmt-tone-inset,transparent),
        inset 0 1px 0 rgba(255,255,255,0.14),
        inset 0 -1px 0 rgba(0,0,0,0.28);  transition:transform .2s ease, border-color .2s ease, background .2s ease, filter .2s ease;
      /* 边框外面那圈彩色呼吸光（只动 box-shadow 的颜色/模糊，卡片位置大小不变） */
      animation:xmt-halo-breathe var(--xmt-halo-dur,5s) ease-in-out infinite;
      animation-delay:var(--xmt-breathe-delay,0s);
      /* 按钮元素当卡片用：抹掉浏览器默认按钮样式 */
      font-family:inherit;font-size:13px;color:var(--xmt-text);text-align:left;
      cursor:pointer;-webkit-appearance:none;appearance:none;
    }
    .${CLS.mcard}:hover{
      transform:translateY(-3px);
      border-color:var(--xmt-tone,var(--xmt-line-2));
      /* 注意：这里刻意不写 box-shadow —— 光晕由 xmt-halo-breathe 动画每帧给出，
         写在这里会被动画覆盖（之前 hover 看不到变化就是这个原因）。 */
      filter:brightness(1.06);
    }
    .${CLS.mcard}:active{transform:scale(.98)}
    .${CLS.mcard}:focus-visible{outline:2px solid var(--xmt-accent);outline-offset:2px}
    /* ---------- 卡片边缘：**画在边框外面的柔和彩色呼吸光** ----------
       ⚠ 故意不用 ::before / ::after 做光斑：伪元素一旦层叠上下文没算对，就会糊在卡片脸上
         （上一版"卡片内部发亮"就是这么来的）。这里改成给卡片本体加 box-shadow 的
         光晕那几层：
           · box-shadow 的绘制区域**在边框盒外面**，物理上不可能盖住卡片里的文字
           · 只改颜色和模糊半径（用 --xmt-halo / --xmt-halo-soft），**不动 transform**，卡片位置不变
           · 底色、玻璃渐变、内发光、高光棱都保留，所以卡片内部还是原来的深色玻璃效果 */
    .${CLS.mcard}{
      /* 光晕颜色：状态的柔和版（比描边色暗一档，不会糊成一团） */
      --xmt-halo:var(--xmt-tone-glow,none);
      --xmt-halo-soft:var(--xmt-tone-glow-strong,none);
    }

    /* 呼吸：光晕由弱到强、模糊半径略微放大（很轻，别抢眼） */
    @keyframes xmt-halo-breathe{
      0%,100%{
        box-shadow:
          var(--xmt-halo,none),
          0 0 3px 0 var(--xmt-halo-tint,transparent),
          0 6px 16px rgba(0,0,0,0.35),
          inset 0 0 12px var(--xmt-tone-inset,transparent),
          inset 0 1px 0 rgba(255,255,255,0.14),
          inset 0 -1px 0 rgba(0,0,0,0.28);
      }
      50%{
        box-shadow:
          var(--xmt-halo-soft,none),
          0 0 9px 1px var(--xmt-halo-tint,transparent),
          0 7px 18px rgba(0,0,0,0.36),
          inset 0 0 14px var(--xmt-tone-inset,transparent),
          inset 0 1px 0 rgba(255,255,255,0.16),
          inset 0 -1px 0 rgba(0,0,0,0.28);
      }
    }

    /* 另外保留一条贴在描边上的流动亮边（让光晕和卡片边缘更"咬合"）。

       卡片边缘的彩色流光（贴在卡片内侧的 1px 描边上）：
       - inset:0 + border-radius:inherit → 严丝合缝贴着卡片自己的圆角，不偏移、不溢出
       - padding+mask 把渐变裁成"框"，所以**永远不会盖到卡片里的文字**
       - 光靠 background-position 横向扫过（不做整体 rotate —— 旋转会让光的角跑到卡片外面） */
    .${CLS.mcard}::after{
      content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;
      background-image:linear-gradient(100deg, transparent 0%, transparent 18%, var(--xmt-tone-shine-color,var(--xmt-tone)) 50%, transparent 82%, transparent 100%);
      background-size:240% 100%;
      background-repeat:no-repeat;
      background-position:-140% 0;
      -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite:xor;
      mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      mask-composite:exclude;
      opacity:.6;pointer-events:none;will-change:background-position,opacity;
      animation:var(--xmt-tone-shine,xmt-shimmer) var(--xmt-shimmer,9s) linear infinite;
    }
    /* 流光：一条柔光横向扫过描边，同时整体明暗来回（只动 background-position 和 opacity，
       不动 transform，所以卡片位置、大小一律不变；mask 保证光只在描边上，不盖文字） */
    @keyframes xmt-shimmer{0%{background-position:-140% 0;opacity:.34}50%{opacity:.62}100%{background-position:240% 0;opacity:.34}}
    @keyframes xmt-shimmer-blue{0%{background-position:-140% 0;opacity:.38}50%{opacity:.85}100%{background-position:240% 0;opacity:.38}}
    @keyframes xmt-shimmer-green{0%{background-position:-140% 0;opacity:.38}50%{opacity:.85}100%{background-position:240% 0;opacity:.38}}
    @keyframes xmt-shimmer-amber{0%{background-position:-140% 0;opacity:.38}50%{opacity:.85}100%{background-position:240% 0;opacity:.38}}
    /* 背景的缓慢流动：小幅平移 + 明暗呼吸。
       ⚠ 只用 translate3d（像素）不用 scale：scale 会让这一层比容器大，边缘容易被切出"色块/断层" */
    @keyframes xmt-bg-drift{
      0%,100%{transform:translate3d(-10px,-6px,0);opacity:.72}
      35%{transform:translate3d(12px,8px,0);opacity:.92}
      70%{transform:translate3d(-6px,10px,0);opacity:.8}
    }
    /* 顶部：图标（16px）+ 模块名（14px / 600）—— 卡片变小了，字也跟着收一点 */
    .${CLS.mcardTop}{display:flex;align-items:center;gap:6px;flex:none;min-width:0}
    .${CLS.mcardIcon}{font-size:16px;line-height:1.1;flex:none}
    .${CLS.mcardName}{font-size:14px;font-weight:600;color:rgba(255,255,255,0.95);line-height:1.3;letter-spacing:.01em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    /* 状态文字：紧跟模块名下方（12px / 500，颜色随状态） */
    .${CLS.mcardState}{font-size:12px;font-weight:500;line-height:1.4;color:var(--xmt-tone-text,var(--xmt-text-idle));white-space:normal;word-break:break-word}
    /* 模块网格最后一格：虚线入口卡（竖向三行：设置 / SOP / 日志）—— 不参与"整卡点击进入" */
    .${CLS.mcardAdd}{
      width:var(--xmt-card-w);height:var(--xmt-card-h);min-height:var(--xmt-card-h);box-sizing:border-box;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
      padding:var(--xmt-card-pad);
      background:transparent;border:1px dashed rgba(255,255,255,0.12);
      border-radius:var(--xmt-radius);color:var(--xmt-text-3);
      font-family:inherit;font-size:12px;
      transition:transform .2s ease,border-color .2s ease,background .2s ease;
    }
    .${CLS.mcardAdd}:hover{transform:translateY(-2px);border-color:rgba(255,255,255,0.2);background:rgba(255,255,255,.02)}
    .${CLS.mcardAdd} .xmt-plus{font-size:15px;line-height:1.2;color:var(--xmt-text-4)}
    .${CLS.mcardAdd} .xmt-add-title{font-size:11px;color:var(--xmt-text-4);text-align:center;margin-bottom:2px}
    .${CLS.mcardAdd} .xmt-add-nav{display:flex;flex-direction:column;align-items:stretch;align-self:stretch}
    /* 每行入口：竖排、上下 8px、hover 变白 */
    .${CLS.mcardAdd} .xmt-add-nav .${CLS.btn}{
      display:flex;justify-content:center;
      padding:8px 0;font-size:12px;color:var(--xmt-text-3);
      border-radius:0;background:transparent;
    }
    .${CLS.mcardAdd} .xmt-add-nav .${CLS.btn}:hover{color:var(--xmt-text);background:transparent}

    /* ---------- 按钮 ---------- */
    .${CLS.btn}{
      display:inline-flex;align-items:center;justify-content:center;gap:6px;
      padding:6px 12px;border-radius:var(--xmt-radius-sm);
      font-family:inherit;font-size:12px;line-height:1.5;font-weight:500;
      border:1px solid var(--xmt-line-2);background:rgba(255,255,255,.04);color:var(--xmt-text);
      cursor:pointer;white-space:nowrap;
      transition:transform .12s ease, filter .12s ease, box-shadow .2s ease, background .2s ease, border-color .2s ease, color .2s ease;
    }
    .${CLS.btn}:hover{filter:brightness(1.15)}
    .${CLS.btn}:active{transform:scale(.96)}
    .${CLS.btn}:disabled{opacity:.4;cursor:not-allowed;transform:none!important;filter:none!important;box-shadow:none}
    .${CLS.btn}.is-primary{
      background:var(--xmt-accent);border-color:var(--xmt-accent);color:#fff;font-weight:600;
      box-shadow:0 0 12px var(--xmt-glow-accent);
    }
    .${CLS.btn}.is-primary:hover{box-shadow:0 0 18px var(--xmt-glow-accent-strong);filter:brightness(1.1)}
    .${CLS.btn}.is-ghost{background:transparent;border-color:transparent;color:var(--xmt-text-3);padding:4px 8px}
    .${CLS.btn}.is-ghost:hover{color:var(--xmt-text);background:rgba(255,255,255,.06)}
    .${CLS.btn}.is-tiny{padding:3px 9px;font-size:11px;border-radius:6px}
    .${CLS.btn}.is-ok{border-color:var(--xmt-ok);background:rgba(34,197,94,.16);color:#d7ffe7;box-shadow:0 0 12px var(--xmt-glow-ok)}
    .${CLS.btn}.is-bad{border-color:var(--xmt-danger);color:#ffe1e1;background:rgba(248,113,113,.12)}
    /* 返回按钮：标红 */
    .${CLS.btn}.is-danger{
      border-color:rgba(248,113,113,.55);color:#ffd9d9;background:rgba(248,113,113,.12);font-weight:600;
    }
    .${CLS.btn}.is-danger:hover{background:rgba(248,113,113,.2);border-color:var(--xmt-danger);box-shadow:0 0 12px rgba(248,113,113,.3)}

    /* 转圈（加载态） */
    .${CLS.spinner}{
      width:12px;height:12px;flex:none;border-radius:50%;
      border:2px solid rgba(255,255,255,.28);border-top-color:rgba(255,255,255,.95);
      animation:xmt-spin .7s linear infinite;
    }
    @keyframes xmt-spin{to{transform:rotate(360deg)}}

    /* ---------- 状态徽章 / 胶囊 ---------- */
    .${CLS.badge}{
      display:inline-flex;align-items:center;gap:5px;
      padding:3px 10px;border-radius:var(--xmt-radius-pill);
      font-size:12px;font-weight:600;
      color:var(--xmt-tone,var(--xmt-text-2));
      border:1px solid var(--xmt-tone,var(--xmt-line-2));
      background:rgba(255,255,255,.05);
      box-shadow:var(--xmt-tone-glow,none);
    }
    .${CLS.pill}{
      display:inline-flex;align-items:center;gap:4px;
      padding:3px 10px;border-radius:var(--xmt-radius-pill);
      font-size:11px;color:var(--xmt-text-2);
      border:1px solid var(--xmt-line);background:rgba(255,255,255,.05);
    }
    .${CLS.tags}{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}
    .${CLS.tag}{
      display:inline-flex;align-items:center;
      padding:3px 10px;border-radius:var(--xmt-radius-pill);
      font-size:11px;color:var(--xmt-text-2);
      background:rgba(255,255,255,.06);border:1px solid var(--xmt-line);
    }

    /* ---------- 结果区 / 条目 ---------- */
    .${CLS.result}{
      border:1px solid var(--xmt-line);border-radius:var(--xmt-radius-sm);
      background:rgba(0,0,0,.18);padding:14px 16px;margin-top:10px;
      font-size:12.5px;line-height:1.75;color:var(--xmt-text-2);
      white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto;
    }
    .${CLS.item}{
      border:1px solid var(--xmt-line);border-radius:var(--xmt-radius);
      background:rgba(255,255,255,.035);
      padding:14px 16px;margin-bottom:12px;
      transition:border-color .2s ease,box-shadow .2s ease;
    }
    /* 二级界面：鼠标悬停只提亮描边，不再上下晃动（一级卡片的悬停动效保留） */
    .${CLS.item}:hover{border-color:var(--xmt-line-2)}
    .${CLS.itemTitle}{font-size:14px;font-weight:600;color:var(--xmt-text);line-height:1.5}
    /* 选题库卡片上的"部分正文"：最多 3 行，超出用省略号（存的正文最多 300 字） */
    .${CLS.itemBody}{
      margin-top:6px;font-size:12.5px;line-height:1.6;color:var(--xmt-text-2);overflow-wrap:anywhere;
      display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
    }
    /* 标题最多两行、高度固定：卡片不会因为标题长短变得参差不齐 */
    .${CLS.itemTitle}.${CLS.itemTitleClamp}{
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
      min-height:42px;
    }
    /* 双列列表里的卡片：同一行等高（标题最多两行，长短不再影响卡片高度） */
    .${CLS.gridTwo} > .${CLS.item}{margin-bottom:0;min-height:132px;display:flex;flex-direction:column}
    .${CLS.gridTwo} > .${CLS.item} > *{min-width:0}
    .${CLS.meta}{font-size:12px;color:var(--xmt-text-3);margin-top:4px}
    .${CLS.link}{color:var(--xmt-accent);text-decoration:none;border-bottom:1px solid rgba(59,130,246,.35)}
    .${CLS.link}:hover{filter:brightness(1.2)}
    .${CLS.body}{font-family:var(--xmt-font-mono);font-size:12.5px;line-height:1.6;color:var(--xmt-text-2)}
    /*
     * 模块3 候选正文 / 模块5 保存的正文：超出显示范围一律用省略号截断。
     * 两条兜底一起上：
     *   · -webkit-line-clamp（主流浏览器都认，切得干净还带省略号）
     *   · max-height + overflow + text-overflow（万一 line-clamp 不生效，也不会把整篇铺出来）
     * 注意必须自成一个块级盒（display:-webkit-box 会覆盖父级 flex 的影响）。
     */
    .${CLS.body}.${CLS.bodyClamp}{
      display:-webkit-box;
      -webkit-line-clamp:4;
      line-clamp:4;
      -webkit-box-orient:vertical;
      box-orient:vertical;
      overflow:hidden;
      text-overflow:ellipsis;
      max-height:calc(12.5px * 1.6 * 4);
      overflow-wrap:anywhere;
      word-break:break-word;
      min-width:0;
      max-width:100%;
    }
    /*
     * 模块3 / 封面标签 的正文卡片：外面套了"行 + 左列"两层 flex，
     * flex 子项默认 min-width:auto（被长文本撑开、不换行）→ line-clamp 会永远不触发，
     * 所以这里显式让这两层里的直接子元素都能收缩。
     */
    .${CLS.item} > div,
    .${CLS.item} > div > div{min-width:0}
    /* ---------- 做图排版（模块5）：图片预览占位 + 缩略图条 ---------- */
    .${CLS.emptyPreview}{
      margin-top:6px;padding:28px 16px;border-radius:var(--xmt-radius-sm);
      border:1px dashed rgba(255,255,255,.16);background:rgba(255,255,255,.02);
      color:var(--xmt-text-3);font-size:12.5px;text-align:center;
    }
    .${CLS.thumbStrip}{
      display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;margin-top:8px;
    }
    .${CLS.thumbItem}{
      display:flex;flex-direction:column;align-items:center;gap:4px;
      padding:6px;border-radius:var(--xmt-radius-sm);
      border:1px solid var(--xmt-line);background:rgba(255,255,255,.03);
    }
    /* ---------- 封面标签（模块5）：模板缩略图卡片 + 可改的标签 ---------- */
    .${CLS.templateCard}{
      width:132px;box-sizing:border-box;padding:6px;border-radius:var(--xmt-radius-sm);
      border:1px solid var(--xmt-line);background:rgba(255,255,255,.03);
      cursor:pointer;font-family:inherit;color:var(--xmt-text);text-align:center;
      transition:border-color .2s ease, box-shadow .2s ease, filter .2s ease;
    }
    .${CLS.templateCard}:hover{border-color:var(--xmt-line-2);filter:brightness(1.08)}
    .${CLS.templateCard}.${CLS.templateCardActive}{
      border-color:var(--xmt-ok);
      box-shadow:0 0 12px rgba(34,197,94,.28), inset 0 0 8px rgba(34,197,94,.12);
    }
    .${CLS.templateCard}:disabled{opacity:.5;cursor:not-allowed}
    .${CLS.tagEditor}{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
    .${CLS.tagEditItem}{
      display:inline-flex;align-items:center;gap:2px;
      padding:2px 6px;border-radius:var(--xmt-radius-pill);
      border:1px solid var(--xmt-line);background:rgba(255,255,255,.04);
    }
    .${CLS.tagHash}{color:var(--xmt-accent);font-size:12px}
    .${CLS.tagInput}{
      width:76px;border:none;outline:none;background:transparent;
      color:var(--xmt-text);font-family:inherit;font-size:12px;padding:1px 0;
    }
    .${CLS.tagInput}:focus{background:rgba(255,255,255,.06);border-radius:4px}
    .${CLS.tagDel}{
      border:none;background:transparent;color:var(--xmt-text-3);cursor:pointer;
      font-size:13px;line-height:1;padding:0 2px;
    }
    .${CLS.tagDel}:hover{color:var(--xmt-danger)}
    .${CLS.tagDel}:disabled{opacity:.4;cursor:not-allowed}

    /* ---------- 封面标签（模块5）：正文完整显示 ----------
     * 按需求：这个模块的正文**不许截断、不许加省略号**，整篇铺出来。
     * 这里只保证长串（网址、连续英文）会换行，不会把右栏顶宽。
     */
    .${CLS.body}.${CLS.bodyFull}{
      display:block;
      white-space:pre-wrap;
      overflow-wrap:anywhere;
      word-break:break-word;
      min-width:0;
      max-width:100%;
      max-height:none;
      overflow:visible;
      text-overflow:clip;
    }

    /* ---------- 封面标签（模块5）：一条帖子 = 左右两栏 ----------
     * 左栏固定 300px 放封面，右栏吃掉剩下的宽度放标题/正文/标签。
     * flex-wrap:wrap = 面板被拖窄时自动折成上下两段，不会把两边都挤扁。
     */
    .${CLS.split}{
      display:flex;
      flex-wrap:wrap;
      gap:16px;
      align-items:flex-start;
    }
    .${CLS.splitLeft}{
      flex:0 0 300px;
      max-width:300px;
      min-width:0;
    }
    .${CLS.splitRight}{
      flex:1 1 320px;
      min-width:0;
    }
    /* 面板很窄时左栏不再强占 300px，直接占满一行 */
    @media (max-width:760px){
      .${CLS.splitLeft}{flex:1 1 100%;max-width:100%}
    }

    /* ---------- 封面标签（模块5）：帖子右下角的操作行 ----------
     * 按需求：「删除」按钮固定放在右下角。
     */
    .${CLS.itemFoot}{
      display:flex;
      justify-content:flex-end;
      align-items:center;
      margin-top:14px;
    }

    /* ---------- 设置页：网站清单的一条 ----------
     * 左边是「名称 / 网址 / 抓取难度」那格网格，右边单独一列放「删除这个网站」，
     * 于是按钮稳定停在**右上角、紧挨着「抓取难度」右边**（不管网格自己折成几列）。
     * 网格那格用 flex:1 吃掉剩余宽度；按钮列不参与拉伸。
     * padding-top 是为了让按钮跟「抓取难度」的输入框对齐（跳过上面那行 label 的高度）。
     */
    .${CLS.siteRow}{
      display:flex;
      gap:12px;
      align-items:flex-start;
    }
    .${CLS.siteRowAction}{
      flex:0 0 auto;
      padding-top:19px;
    }
    /* 面板很窄时不再硬挤一行：按钮换到下面去，也不会被压扁 */
    @media (max-width:620px){
      .${CLS.siteRow}{flex-wrap:wrap}
      .${CLS.siteRowAction}{padding-top:0}
    }

    /* ---------- 清单（模块3 / 模块4 / 模块6） ---------- */.${CLS.check}{
      display:flex;gap:8px;align-items:flex-start;line-height:1.6;
      padding:7px 10px;border-radius:var(--xmt-radius-sm);border:1px solid transparent;
      transition:background .2s ease,border-color .2s ease;
    }
    .${CLS.check}:hover{background:rgba(255,255,255,.03)}
    .${CLS.check}.${CLS.checkHit}{background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.25)}
    .${CLS.check}-x{flex:none;width:16px;height:16px;margin-top:2px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1}
    .${CLS.check}-x.on{background:rgba(34,197,94,.22);border:1px solid var(--xmt-ok);color:#b8f5cd}
    .${CLS.check}-x.off{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.18);color:transparent}
    .${CLS.checkLabel}{color:var(--xmt-text)}
    .${CLS.checkRule}{color:var(--xmt-text-3)}
    .${CLS.checkReason}{color:var(--xmt-text-3)}
    .${CLS.checkReasonBad}{color:var(--xmt-danger)}

    /* ---------- 文案卡片（模块4 标题候选） ---------- */
    .${CLS.copyCard}{
      display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;
      padding:11px 14px;margin-bottom:8px;border-radius:var(--xmt-radius-sm);
      border:1px solid var(--xmt-line);background:rgba(255,255,255,.035);
      color:var(--xmt-text);font-family:inherit;font-size:13px;line-height:1.6;cursor:pointer;
      transition:filter .12s ease,border-color .2s ease,box-shadow .2s ease,background .2s ease;
    }
    .${CLS.copyCard}:hover{filter:brightness(1.15);border-color:var(--xmt-line-2)}
    .${CLS.copyCard}:active{transform:scale(.98)}
    .${CLS.copyCard}.${CLS.on},.${CLS.copyCard}:focus-visible{
      border-color:var(--xmt-accent);background:rgba(59,130,246,.12);
      box-shadow:0 0 16px var(--xmt-glow-accent);outline:none;
    }
    .${CLS.copyNo}{font-family:var(--xmt-font-mono);color:var(--xmt-accent);flex:none;font-weight:700}

    /* ---------- 指标卡片（模块7） ---------- */
    .${CLS.metricGrid}{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0}
    .${CLS.metric}{
      padding:14px;border-radius:var(--xmt-radius-sm);
      border:1px solid var(--xmt-tone,var(--xmt-line));background:var(--xmt-glass);
      box-shadow:var(--xmt-tone-glow,none), inset 0 0 12px var(--xmt-tone-inset,transparent);
      transition:border-color .3s ease,box-shadow .3s ease;
    }
    .${CLS.metric}:hover{border-color:var(--xmt-line-2)}
    .${CLS.metricNum}{font-family:var(--xmt-font-mono);font-size:20px;font-weight:700;color:var(--xmt-tone,var(--xmt-text));line-height:1.3}
    .${CLS.metricLabel}{font-size:12px;color:var(--xmt-text-3);margin-top:2px}
    .${CLS.metricJudge}{font-size:11px;color:var(--xmt-tone,var(--xmt-text-3));margin-top:6px}

    /* ---------- 建议卡片（模块7） ---------- */
    .${CLS.suggest}{
      border:1px solid var(--xmt-line);border-radius:var(--xmt-radius-sm);
      background:rgba(255,255,255,.035);padding:14px 16px;margin-bottom:10px;
      transition:border-color .2s ease;
    }
    .${CLS.suggest}:hover{border-color:var(--xmt-line-2)}
    .${CLS.suggestWhere}{font-size:12px;color:var(--xmt-text-3);margin-bottom:8px}
    .${CLS.suggestRow}{font-size:12.5px;line-height:1.7;color:var(--xmt-text-2)}
    .${CLS.suggestFrom}{color:var(--xmt-text-3)}
    .${CLS.suggestTo}{color:var(--xmt-text);font-weight:600}
    .${CLS.suggestWhy}{font-size:12px;color:var(--xmt-text-3)}

    /* ---------- 抓取进度条（模块2）：和整体风格一致的玻璃 + 蓝色发光 ---------- */
    .${CLS.progress}{
      border:1px solid var(--xmt-line);border-radius:var(--xmt-radius-sm);
      background:rgba(255,255,255,.03);
      padding:12px 14px;margin-bottom:14px;
    }
    .${CLS.progressHead}{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .${CLS.progressLabel}{font-size:12px;color:var(--xmt-text-2);min-width:0;overflow:hidden;text-overflow:ellipsis}
    .${CLS.progressNum}{font-family:var(--xmt-font-mono);font-size:12px;font-weight:700;color:var(--xmt-accent);flex:none}
    .${CLS.progressTrack}{
      height:6px;border-radius:var(--xmt-radius-pill);
      background:rgba(255,255,255,.08);
      overflow:hidden;margin:9px 0 7px;
    }
    .${CLS.progressFill}{
      height:100%;border-radius:var(--xmt-radius-pill);
      background:linear-gradient(90deg, var(--xmt-accent), #22d3ee);
      box-shadow:0 0 10px var(--xmt-glow-accent);
      /* 进度平滑推进：宽度变化用过渡动画，不会一格一格跳 */
      transition:width .5s ease;
    }
    .${CLS.progressFill}.is-done{background:linear-gradient(90deg, var(--xmt-ok), #22d3ee);box-shadow:0 0 10px var(--xmt-glow-ok)}
    .${CLS.progressFoot}{font-size:11px;color:var(--xmt-text-3)}

    /* ---------- 文字 / 提示 / 空状态 ---------- */
    .${CLS.hint}{font-size:12px;color:var(--xmt-text-3);line-height:1.6;margin-top:8px}
    .${CLS.empty}{
      padding:26px 16px;text-align:center;font-size:12px;color:var(--xmt-text-4);
      border:1px dashed var(--xmt-line);border-radius:var(--xmt-radius-sm);background:rgba(255,255,255,.02);
    }
    .${CLS.msgOk}{font-size:12px;color:#86efac;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.3);border-radius:var(--xmt-radius-sm);padding:7px 12px}
    .${CLS.msgBad}{font-size:12px;color:#fecaca;background:rgba(248,113,113,.10);border:1px solid rgba(248,113,113,.32);border-radius:var(--xmt-radius-sm);padding:7px 12px;line-height:1.6;white-space:pre-wrap}
    .${CLS.msgForm}{font-size:12px;color:#fde68a;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.32);border-radius:var(--xmt-radius-sm);padding:7px 12px;line-height:1.6}
    /* 顶部提示浮层：固定在弹窗顶端、**不占文档流高度** ——
       出现/消失时下面的内容一动不动（以前它是页面第一个块，一出现就把整页往下推）。 */
    .${CLS.toast}{
      position:fixed;top:14px;left:var(--xmt-modal-left,0px);right:0;z-index:30;
      display:flex;flex-direction:column;align-items:center;gap:8px;
      padding:0 16px;pointer-events:none;
    }
    .${CLS.toast}>*{pointer-events:auto;max-width:min(760px,94%);box-shadow:0 10px 26px rgba(0,0,0,.45)}
    /* 模块3 顶部时间筛选条 */
    .${CLS.rangeBar}{
      margin-bottom:12px;padding:10px 12px;
      border:1px solid var(--xmt-line);border-radius:var(--xmt-radius-sm);background:rgba(255,255,255,.04);
    }
    .${CLS.mark}{color:var(--xmt-hi);font-weight:600}
    .${CLS.collapsed}{border:1px solid var(--xmt-line);border-radius:var(--xmt-radius-sm);padding:8px 12px;background:rgba(255,255,255,.02);font-size:12px;color:var(--xmt-text-3)}
    .${CLS.collapsed}>summary{cursor:pointer;color:var(--xmt-text-3);list-style:none}
    .${CLS.collapsed}>summary::-webkit-details-marker{display:none}
    .${CLS.collapsed}>summary:hover{color:var(--xmt-text-2)}
    .${CLS.collapsed}>summary::before{content:'▸ ';color:var(--xmt-text-4)}
    .${CLS.collapsed}[open]>summary::before{content:'▾ '}

    /* ---------- 表单 ---------- */
    .${CLS.field}{display:flex;flex-direction:column;gap:4px}
    .${CLS.fieldBox}{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
    .${CLS.label}{font-size:12px;color:var(--xmt-text-3);margin-bottom:2px;display:block}
    .${CLS.input},.${CLS.select},.${CLS.textarea}{
      width:100%;padding:7px 10px;border-radius:var(--xmt-radius-sm);
      border:1px solid var(--xmt-line);background:rgba(0,0,0,.22);color:var(--xmt-text);
      font-family:inherit;font-size:12px;line-height:1.5;
      transition:border-color .2s ease,box-shadow .2s ease;
    }
    .${CLS.input}:hover,.${CLS.select}:hover,.${CLS.textarea}:hover{border-color:var(--xmt-line-2)}
    .${CLS.input}:focus,.${CLS.select}:focus,.${CLS.textarea}:focus{
      outline:none;border-color:var(--xmt-accent);box-shadow:0 0 0 3px rgba(59,130,246,.18);
    }
    .${CLS.textarea}{min-height:76px;resize:vertical}
    .${CLS.root} input[type='checkbox']{width:15px;height:15px;accent-color:var(--xmt-accent);cursor:pointer}
    .${CLS.root} summary{cursor:pointer}
    .${CLS.root} option{background:#0d1f2d;color:rgba(255,255,255,.95)}

    /* ---------- 进入二级界面的动效（0.2s，不弹跳） ---------- */
    .${CLS.fadeIn}{animation:xmt-fade-in .2s ease}
    @keyframes xmt-fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

    /* ---------- 侧边栏入口（在「技能中心」下面那一行：无边框文字按钮） ----------
       长相和「技能中心」那一行完全一致：
         · 平时：淡灰字（label-secondary）、无底色、无边框
         · 鼠标悬停：一层灰底 + 字变黑（label-primary）
         · 点开工作台（aria-pressed=true）：保持黑字 + 一层底色；关掉后回到淡灰
       底色和字色都不写内联样式（内联会盖掉 :hover），所以这里用 !important 压过
       内联的"平时是淡灰字、透明底"兜底值 —— 万一样式表没注入成功，至少还是一颗
       正常的淡灰文字按钮。 */
    .${CLS.enterBtn}{
      transition:background .2s ease,color .2s ease,transform .12s ease;
    }
    .${CLS.enterBtn}:hover{
      background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))!important;
      color:var(--dsw-alias-label-primary,inherit)!important;
    }
    .${CLS.enterBtn}:active{transform:scale(.98)}
    .${CLS.enterBtn}[aria-pressed='true']{
      background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.14))!important;
      color:var(--dsw-alias-label-primary,inherit)!important;
    }
    .${CLS.enterIcon}{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center}
    .${CLS.enterIcon} svg{display:block}
    .${CLS.enterLabel}{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

    /* ---------- 窄屏 / 侧边栏展开时：模块卡片自动降列 ---------- */
    @media (max-width:1240px){
      /* 3 列挤不下时降成 2 列 */
      .${CLS.grid}{grid-template-columns:repeat(2,var(--xmt-card-w))}
    }
    @media (max-width:820px){
      /* 再窄就 1 列；卡片放开固定高度，靠内容撑（免得文字被压） */
      .${CLS.grid}{grid-template-columns:1fr}
      .${CLS.mcard},.${CLS.mcardAdd}{width:auto;height:auto;min-height:104px}
      /* 单列时不再强制撑满视口高（内容比屏高，居中反而会把开头顶出可视区），只留安全边距 */
      .${CLS.stage}{min-height:0;justify-content:flex-start;padding:16px}
      .${CLS.grid}{padding:16px 0}
      .${CLS.gridTwo}{grid-template-columns:1fr}
      .${CLS.page}{padding:16px 0 32px}
      .${CLS.topbar}{padding:10px 14px}
    }
    @media (prefers-reduced-motion:reduce){
      .${CLS.root} *{animation:none!important;transition:none!important}
    }
    `
    }

    /**
     * 注入样式表（幂等；环境不具备 DOM 能力时静默跳过，只丢视觉效果）
     * 返回：注入用的 style 元素（拿不到就返回 null）
     */
    function ensureStyles(doc) {
      if (styleInjected) return null
      try {
        const target = doc && doc.createElement ? doc : typeof document !== 'undefined' ? document : null
        if (!target || typeof target.createElement !== 'function') return null
        let head = target.head || target.documentElement || target.body || null
        if (!head || typeof head.appendChild !== 'function') head = target.body || target.documentElement || null
        if (!head || typeof head.appendChild !== 'function') return null
        let node = null
        try {
          node = typeof target.getElementById === 'function' ? target.getElementById(STYLE_ID) : null
        } catch (err) {
          node = null
        }
        if (!node) {
          node = target.createElement('style')
          if (!node) return null
          if (typeof node.setAttribute === 'function') node.setAttribute('id', STYLE_ID)
          else if ('id' in node) node.id = STYLE_ID
          node.textContent = stylesheet()
          head.appendChild(node)
        }
        styleInjected = true
        return node
      } catch (err) {
        return null
      }
    }

    // ---------------------------------------------------------------------------
    // 语义化样式（新界面优先用这些 + CLS 里的 class）
    // ---------------------------------------------------------------------------

    const ST = {
      /** 深色玻璃根容器 */
      root: { height: '100%', width: '100%', minHeight: '100%', boxSizing: 'border-box' },
      /** 根容器的内联兜底（样式表注入失败时也保住底色和字体）
       *  ⚠ 这里**不写 backgroundImage**：渐变由弹窗最外层的两层 fixed 背景负责
       *    （它们只在"侧边栏右边"铺），弹窗外壳自己再铺一层会重复、还可能盖到左侧导航栏 */
      rootVars: {
        backgroundColor: '#0b1727',
        color: 'rgba(255,255,255,.95)',
        fontFamily: "var(--xmt-font, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif)",
      },
      // 注意：一级页的 .xmt-page 走 display:contents，内联 padding 会把它重新变成"占位元素"，
      // 所以这里只留 max-width / 居中，内边距交给样式表里的 .xmt-stage / .xmt-grid 负责
      page: { maxWidth: '1400px', margin: '0 auto' },
      topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' },
      title: { fontSize: '16px', fontWeight: 700 },
      subtitle: { fontSize: '12px', color: 'var(--xmt-text-3)', marginTop: '2px' },
      row: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
      itemHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' },
      fieldBox: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px' },
      num: { fontFamily: 'var(--xmt-font-mono)' },
      mark: { color: 'var(--xmt-hi)', fontWeight: 600 },
    }

    /** 兼容层：旧的 `S.xxx` 内联样式（新界面请用 CLS + ST） */
    const S = {
      page: { minHeight: '100%', width: '100%', boxSizing: 'border-box' },
      topBar: ST.topbar,
      title: ST.title,
      subtitle: ST.subtitle,
      grid: { display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' },
      moduleCard: { border: '1px solid var(--xmt-line)', borderRadius: 'var(--xmt-radius)', padding: '16px', background: 'var(--xmt-glass)' },
      moduleName: { fontWeight: 600, fontSize: '13px', color: 'var(--xmt-text-2)' },
      card: {},
      cardTitle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontWeight: 700, fontSize: '14px', color: 'var(--xmt-text)', marginBottom: '12px' },
      row: ST.row,
      btn: {},
      btnPrimary: {},
      btnTiny: {},
      input: {},
      textarea: {},
      select: {},
      label: { fontSize: '12px', color: 'var(--xmt-text-3)', marginBottom: '3px', display: 'block' },
      status: { fontSize: '12px', color: 'var(--xmt-text-3)', lineHeight: 1.6 },
      result: {},
      item: {},
      tag: {},
      mark: ST.mark,
      hint: { fontSize: '12px', color: 'var(--xmt-text-3)', marginTop: '8px', lineHeight: 1.6 },
      err: { fontSize: '12px', color: 'var(--xmt-danger)', marginTop: '8px', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
      ok: { fontSize: '12px', color: '#86efac', marginTop: '8px' },
      checklist: { fontSize: '12.5px', lineHeight: 1.6 },
      notice: { fontSize: '12px', color: '#fde68a', marginTop: '8px', lineHeight: 1.6 },
      railButton: {},
    }

    /** 按条件拼接 class */
    function cx(...parts) {
      return parts.filter(Boolean).join(' ')
    }

    /** 把高亮分段渲染成 React 节点 */
    function renderSegments(h, segments, keyPrefix = 'seg') {
      if (!Array.isArray(segments) || !segments.length) return null
      return segments.map((seg, index) =>
        seg.highlight ? h('span', { key: `${keyPrefix}_${index}`, className: CLS.mark }, seg.text) : h('span', { key: `${keyPrefix}_${index}` }, seg.text),
      )
    }

    /** 简单的 SVG 图标（无外部依赖） */
    function icon(h, name, size = 16) {
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }
      if (name === 'spark') return h('svg', common, h('path', { d: 'M8 1.8l1.6 4 4 1.6-4 1.6L8 13l-1.6-4-4-1.6 4-1.6L8 1.8z' }))
      if (name === 'back') return h('svg', common, h('path', { d: 'M10 3L5 8l5 5' }))
      if (name === 'close') return h('svg', common, h('path', { d: 'M4 4l8 8M12 4l-8 8' }))
      if (name === 'refresh') return h('svg', common, h('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 2.5V6h-3.5' }))
      return h('svg', common, h('circle', { cx: 8, cy: 8, r: 5 }))
    }

    // ---------------------------------------------------------------------------
    // 接口调用（走主机侧）
    // ---------------------------------------------------------------------------

    const API = '/xmt-kf/api'

    async function request(path, options = {}) {
      const response = await fetch(path, Object.assign({ credentials: 'same-origin' }, options))
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch (err) {
        data = null
      }
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`)
      if (!data) throw new Error('主机侧返回了空内容')
      if (data.ok === false) throw new Error(data.error || '未知错误')
      return data.data
    }

    const api = {
      get(action) {
        return request(`${API}?action=${encodeURIComponent(action)}`)
      },
      post(action, payload) {
        return request(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, payload: payload || {} }),
        })
      },
      /**
       * 取一张原图的地址（给 <img src> 用，做图排版的模板缩略图走这里）。
       * 走自己的接口取图：不跨域、不受模板站点限制。
       */
      imageUrl(action, query = {}) {
        const search = Object.keys(query || {})
          .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
          .join('&')
        return `${API}?action=${encodeURIComponent(action)}${search ? `&${search}` : ''}`
      },
      /**
       * 取一张原图，转成 dataURL 给浏览器用（做图排版的模板底图走这里）。
       * 走自己的接口取图有两个好处：不会触发跨域污染 Canvas，也不占 localStorage 配额。
       */
      async getRawImage(action, query = {}) {
        const search = Object.keys(query || {})
          .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
          .join('&')
        const response = await fetch(`${API}?action=${encodeURIComponent(action)}${search ? `&${search}` : ''}`, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'image/*' },
        })
        if (!response.ok) {
          let message = `图片读取失败（HTTP ${response.status}）`
          try {
            const data = await response.json()
            if (data && data.error) message = data.error
          } catch (err) {
            /* 不是 JSON 就用默认提示 */
          }
          throw new Error(message)
        }
        const blob = await response.blob()
        return await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(new Error('图片读取失败'))
          reader.readAsDataURL(blob)
        })
      },
    }

    /** 复制到剪贴板（不支持时退回 execCommand） */
    async function copyText(text) {
      const value = String(text === undefined || text === null ? '' : text)
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value)
          return true
        }
      } catch (err) {
        /* 继续走兜底 */
      }
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok
      } catch (err) {
        return false
      }
    }

    /** 时间显示 */
    function formatTime(value) {
      if (!value) return ''
      const date = new Date(value)
      if (!Number.isFinite(date.getTime())) return String(value)
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** 百分比显示（拿不到数字就显示 ——，别显示 NaN%） */
    function percent(value, digits = 2) {
      if (value === null || value === undefined || value === '') return '—'
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      return `${(n * 100).toFixed(digits)}%`
    }

    /** 指标卡用：区分"真的没有数据"和"数据就是 0" */
    function rate(value, digits = 2) {
      if (value === null || value === undefined || value === '') return '—'
      return percent(value, digits)
    }

    // ==================== sidebar-entry.js ====================
    /**
     * AI 资讯工作台 —— 侧边栏入口的"落位"（纯 DOM，不碰 React 树）
     *
     * 为什么需要它：
     *   DSH 的侧边栏壳只开放了一个入口槽位 `sidebar.footer.action`，它的位置就是
     *   侧边栏**最底部**（"设置"上面那一行）。需求要把入口挪到「技能中心」正下方，
     *   而侧边栏上半部分没有任何槽位能注册（「技能中心」自己也是 skill-explorer 插件
     *   用 DOM 注入进去的一行）。
     *
     *   所以这里的做法是：**槽位注册方式完全不动**（还是 `sidebar.footer.action`，
     *   组件还是那个 React 组件），只把 React 渲染出来的那个按钮节点搬到
     *   「技能中心」下面。React 依旧管着它的属性、样式和点击。
     *
     * 安全边界（都做到了才搬）：
     *  1) 只"搬"节点，不改节点：不克隆、不重建，事件与样式都不受影响；
     *  2) 自愈：技能中心晚一步出现、或者 React 重渲染把它挤开了，会自动再摆一次；
     *  3) 卸载时先放回原位，再让 React 去删它（否则 React 删一个"已经不在自己名下的
     *     子节点"会抛 NotFoundError，可能连累整个侧边栏）；
     *  4) 任何一步拿不到 DOM、或者找不到侧边栏/锚点，就原样不动 —— 最差也只是留在
     *     底部，功能不受影响。
     */

    /** 「技能中心」那一行的标记（skill-explorer 插件注入时打的属性） */
    const SKILL_CENTER_ATTR = 'data-dsh-skill-explorer-entry'

    /** 「技能中心」行的选择器 */
    const SKILL_CENTER_SELECTOR = `[${SKILL_CENTER_ATTR}]`

    /** 兜底锚点：技能中心没装/被停用时，跟在"新会话"按钮后面（同一片区域） */
    const NEW_SESSION_SELECTOR = 'button[class*="newSession"]'

    /** 侧边栏：AppFrame 的 sidebarCol（class 名带 hash，用子串匹配） */
    const SIDEBAR_COLUMN_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'

    /** 侧边栏里品牌那一行，用它反推侧边栏根节点（skill-explorer 用的同一招） */
    const LOGO_ROW_SELECTOR = '[class*="logoRow"]'

    /** 取 MutationObserver（浏览器里有；测试/老环境里可能没有） */
    function observerCtor() {
      try {
        if (typeof MutationObserver === 'function') return MutationObserver
        if (typeof window !== 'undefined' && typeof window.MutationObserver === 'function') return window.MutationObserver
      } catch (err) {
        /* 忽略 */
      }
      return null
    }

    /**
     * 找侧边栏根节点：它是 `display:flex;flex-direction:column` 的那一列，
     * 里面依次是 品牌行 / 新会话 / 全局面板 / 工作区 / 底部（设置）。
     */
    function findRoot(doc) {
      try {
        if (!doc || typeof doc.querySelector !== 'function') return null
        const column = doc.querySelector(SIDEBAR_COLUMN_SELECTOR)
        if (!column) return null
        const logo = typeof column.querySelector === 'function' ? column.querySelector(LOGO_ROW_SELECTOR) : null
        return (logo && logo.parentElement) || column.firstElementChild || column
      } catch (err) {
        return null
      }
    }

    /** 锚点：优先「技能中心」那一行；没有就退回"新会话"按钮 */
    function findAnchor(root) {
      try {
        if (!root || typeof root.querySelector !== 'function') return null
        return root.querySelector(SKILL_CENTER_SELECTOR) || root.querySelector(NEW_SESSION_SELECTOR) || null
      } catch (err) {
        return null
      }
    }

    /**
     * 已经在正确位置了吗？
     * 这条判断要够便宜 —— MutationObserver 每次回调都会问一遍。
     */
    function alreadyPlaced(entry, root) {
      try {
        if (!entry || !root || entry.parentElement !== root) return false
        const prev = entry.previousElementSibling
        if (!prev) return false
        if (typeof prev.hasAttribute === 'function' && prev.hasAttribute(SKILL_CENTER_ATTR)) return true
        return !!(typeof prev.matches === 'function' && prev.matches(NEW_SESSION_SELECTOR))
      } catch (err) {
        return false
      }
    }

    /** 把入口节点插到锚点正下方（同一层、紧邻，左对齐与间距由按钮自身样式决定） */
    function place(entry, root) {
      try {
        const anchor = findAnchor(root)
        if (!anchor || anchor === entry) return false
        if (entry.parentElement === root && entry.previousElementSibling === anchor) return true
        anchor.insertAdjacentElement('afterend', entry)
        return true
      } catch (err) {
        return false
      }
    }

    /**
     * 把侧边栏入口搬到「技能中心」下面，并保持住。
     *
     * @param entry - React 渲染出来的那个入口按钮节点
     * @returns 清理函数：断开监听，并把按钮放回原位（React 卸载前必须调）
     */
    function mountSidebarEntry(entry) {
      const noop = () => {}
      try {
        if (!entry || typeof entry.insertAdjacentElement !== 'function') return noop
        const doc = entry.ownerDocument || (typeof document !== 'undefined' ? document : null)
        if (!doc || typeof doc.querySelector !== 'function') return noop

        /** React 给它的原位（底部 footerActions 里那层 display:contents 壳），卸载时要还回去 */
        const home = entry.parentElement || null
        const MO = observerCtor()
        let root = null
        let observer = null

        const tryPlace = () => {
          if (!root) root = findRoot(doc)
          if (!root) return false
          if (alreadyPlaced(entry, root)) return true
          return place(entry, root)
        }

        tryPlace()

        if (MO) {
          try {
            observer = new MO(() => {
              tryPlace()
            })
            observer.observe(root || doc.body || doc.documentElement, { childList: true, subtree: true })
          } catch (err) {
            observer = null
          }
        }

        return function dispose() {
          try {
            if (observer && typeof observer.disconnect === 'function') observer.disconnect()
          } catch (err) {
            /* 忽略 */
          }
          observer = null
          try {
            if (home && entry.parentElement !== home) home.appendChild(entry)
          } catch (err) {
            /* 忽略：放不回去也不要抛，交给 React 自己的兜底 */
          }
        }
      } catch (err) {
        return noop
      }
    }

    // ==================== workbench.js ====================
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
    const MODULES = [
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
    function createWorkbench(react) {
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

    // ==================== client.js ====================
    /**
     * AI 资讯工作台 —— 界面侧入口
     *
     * 交互（按需求）：
     *  1) 侧边栏只放**一个入口按钮**：注册在官方的 `sidebar.footer.action` 槽位上，
     *     渲染出来后由 `sidebar-entry.js` 搬到「技能中心」正下方（带自愈 + 卸载还原）
     *  2) 点它 → 弹出**全屏工作台弹窗**，覆盖在右侧聊天/内容区之上
     *     - 不占用会话标签页（不再挤在「对话」「轨迹」旁边）
     *     - **不盖住左侧侧边栏**：弹窗的左边界按侧边栏实际宽度算出来
     *  3) 弹窗右上角「×」关闭，回到正常聊天界面
     *
     * 防崩：
     *  - `inject: ['slots']`（必须声明，否则 apply 会在服务就绪前执行、注册全失效）
     *  - 所有注册、定位、渲染都包在 try/catch 里；组件套错误边界
     *  - 拿不到侧边栏宽度时退回"不盖住最左侧 260px"，最多盖住一点点，不会整个糊住
     */





    const name = 'ai-news-workbench-ui'

    /** 必须声明 slots：平台会等这个服务就绪之后才调用 apply */
    const inject = ['slots']

    /** 侧边栏槽位里的入口 id */
    const SLOT_ID = 'ai-news-workbench'

    /** 侧边栏宽度兜底值（量不到真实宽度时用它，保证不盖住左侧栏） */
    const SIDEBAR_FALLBACK_WIDTH = 300

    /**
     * ⚠ 弹窗左边界与导航栏之间**不再写死任何像素**：
     *   量到的导航栏右边缘写进 CSS 变量 --xmt-nav-edge，
     *   真正生效的 left 由样式表里的 calc(var(--xmt-nav-edge) + var(--xmt-nav-gap)) 算出来，
     *   --xmt-nav-gap 默认 0px（＝紧贴导航栏右边缘）。想留缝只改这一个变量。
     */

    /** 上一次量到的侧边栏宽度（量失败时优先沿用它，而不是退回 0） */
    let lastSidebarEdge = 0

    /** 没有 useSyncExternalStore 时的兜底订阅（React 17 也能跑） */
    function useSnapshotFallback(reactImpl) {
      const [snap, setSnap] = reactImpl.useState(getSnapshot)
      reactImpl.useEffect(() => {
        const unsub = subscribe(() => setSnap(getSnapshot()))
        setSnap(getSnapshot())
        return typeof unsub === 'function' ? unsub : undefined
      }, [])
      return snap
    }

    function apply(ctx) {
      // 平台注入的 require 只用来拿 react（不依赖别的客户端模块，加载顺序上最安全）
      const requireFn = typeof require === 'function' ? require : null
      if (!requireFn) throw new Error('客户端模块加载器没有提供 require，无法拿到 react')
      const react = requireFn('react')
      const h = react.createElement

      // 测试探针：只有测试脚手架打开开关时才生效（生产环境走不到）
      if (globalThis.__XMT_TEST_HARNESS__ === true && typeof globalThis.__XMT_TEST_PROBE__ === 'function') {
        try {
          globalThis.__XMT_TEST_PROBE__(react)
        } catch (err) {
          try {
            console.error('[ai-news-workbench] 测试探针执行失败：', err)
          } catch (logErr) {
            /* 忽略 */
          }
        }
      }

      // 深色玻璃拟态样式表（hook / :active / 动画都靠它；注入失败只丢视觉）
      try {
        ensureStyles(typeof document !== 'undefined' ? document : null)
      } catch (err) {
        /* 忽略 */
      }

      /** 出错时兜底显示的小卡片（避免整块区域空白，方便排查） */
      function FailCard(message) {
        return h(
          'div',
          {
            className: CLS.msgBad,
            style: { maxWidth: '460px', margin: '8px 0' },
            title: String(message || ''),
          },
          '⚠ AI 资讯工作台加载失败。点这里看详情；这不影响聊天，刷新页面可恢复。',
        )
      }

      /** 错误边界：任何渲染错误只替换这块内容，不拖垮整个页面 */
      class Boundary extends react.Component {
        constructor(props) {
          super(props)
          this.state = { error: null }
        }
        static getDerivedStateFromError(error) {
          return { error }
        }
        componentDidCatch(error) {
          try {
            console.error('[ai-news-workbench] 界面渲染出错：', error)
          } catch (err) {
            /* 忽略 */
          }
        }
        render() {
          if (this.state.error) return FailCard((this.state.error && this.state.error.message) || this.state.error)
          return this.props.children
        }
      }

      /** 用错误边界包一层 */
      function Guarded(props) {
        return h(Boundary, null, h(props.Comp, props.compProps || {}))
      }

      // 建工作台组件（失败也要能加载插件）
      let Workbench = null
      try {
        Workbench = createWorkbench(react)
      } catch (err) {
        try {
          console.error('[ai-news-workbench] 界面初始化失败：', err)
        } catch (logErr) {
          /* 忽略 */
        }
        const Broken = () => FailCard(`界面初始化失败：${(err && err.message) || err}`)
        Workbench = Broken
      }

      /**
       * 量"视口尺寸"（拿不到就退回 1280×800）
       *
       * ⚠ 这里刻意只算视口和侧边栏右边界，**不去量右侧内容区**。
       *  踩过的坑：之前按内容区 rect 算 right = 视口宽 - 内容区右边界，
       *  结果量到了一个贴右边的窄元素，弹窗被压成屏幕最右边 1 像素宽的一条缝，
       *  看起来就像"点了按钮没反应"。弹窗本来就是全屏浮层，
       *  左边让开侧边栏、其余铺满视口，最稳。
       */
      function viewportSize() {
        let width = 0
        let height = 0
        try {
          if (typeof window !== 'undefined') {
            width = Number(window.innerWidth) || 0
            height = Number(window.innerHeight) || 0
          }
        } catch (err) {
          /* 继续兜底 */
        }
        try {
          const de = typeof document !== 'undefined' ? document.documentElement : null
          if (!width && de && de.clientWidth) width = Number(de.clientWidth) || 0
          if (!height && de && de.clientHeight) height = Number(de.clientHeight) || 0
        } catch (err) {
          /* 继续兜底 */
        }
        return { width: width || 1280, height: height || 800 }
      }

      /**
       * 量"侧边栏右边界"：这就是弹窗的左边界，保证**永不盖住左侧栏**。
       *
       * 两条硬要求（都踩过坑）：
       *  1) **不许算出 0**：量不到时用记住的好值 / 兜底宽度，否则弹窗从视口最左边铺 → "变成全屏了"；
       *  2) **不许取到偏小的那个**：侧边栏常常是"外层留位 + 内层实际面板"两层，
       *     只按第一个命中的（比如外层的占位宽 206）算，弹窗还是压住侧边栏右半边。
       *     所以：把所有贴左边、够高的候选**都收集起来，取最右边的那条边界**（+ 一点余量），
       *     并且优先相信侧边栏那一侧的容器（不拿右边聊天区当侧边栏）。
       */
      function measureSidebarEdge() {
        const view = viewportSize()
        const apply = (edge) => {
          // 只有"彻底没量到"（0 / NaN / 小于一条边缝）才用记住的好值或兜底；
          // 量到的窄值（比如收起的细轨道 68px）是**真的**，照用，不算失败。
          const safe = Number.isFinite(edge) && edge >= 24 ? edge : Math.max(SIDEBAR_FALLBACK_WIDTH, lastSidebarEdge || 0)
          // 不再额外加余量：量到的就是导航栏右边缘，弹窗从这里开始（缝隙交给 CSS 的 --xmt-nav-gap）
          const capped = Math.min(safe, Math.max(0, view.width - 120))
          lastSidebarEdge = Math.min(safe, capped)
          return Math.round(capped)
        }
        try {
          const doc = typeof document !== 'undefined' ? document : null
          if (!doc || typeof doc.querySelectorAll !== 'function') return apply(0)

          const onLeft = (rect) => rect.left <= 8
          const tallEnough = (rect) => rect.height > Math.max(160, view.height * 0.4)
          // 侧边栏不可能超过视口宽的 45%（超过的肯定是右边的主内容区，别拿它当侧边栏）
          const sidebarMax = Math.max(260, view.width * 0.45)
          const wideEnough = (rect) => rect.width >= 24 && rect.width <= Math.min(460, sidebarMax)

          const rectOf = (el) => {
            try {
              const rect = el.getBoundingClientRect()
              return rect && rect.width > 0 ? rect : null
            } catch (err) {
              return null
            }
          }

          // 只要"最右边那条边界"，所以取最大值（而不是碰到第一个就收工）
          let edge = 0
          const take = (el, depth) => {
            let node = el
            for (let i = 0; node && i <= depth; i++) {
              const rect = rectOf(node)
              if (rect && onLeft(rect) && tallEnough(rect) && wideEnough(rect)) edge = Math.max(edge, rect.right)
              node = node && node.parentElement
            }
          }

          // ① 明确是侧边栏/侧栏轨道的元素（含它们的祖先，兼容"外层留位"结构）
          let stack = []
          try {
            stack = Array.from(doc.querySelectorAll('[class*="SidebarRoot"], [class*="sidebar"], [class*="SideBar"], [class*="side-nav"], [class*="sideNav"], aside, [class*="rail"]'))
          } catch (err) {
            stack = []
          }
          for (const el of stack) take(el, 4)

          // ② 没量到的话：不限 class 名，扫前 300 个里"贴左边 + 竖长条"的最宽边界
          if (edge < 24) {
            let list = []
            try {
              list = Array.from(doc.querySelectorAll('div, aside, nav, section'))
            } catch (err) {
              list = []
            }
            for (const el of list.slice(0, 300)) {
              const rect = rectOf(el)
              if (!rect || !onLeft(rect) || !tallEnough(rect) || !wideEnough(rect)) continue
              edge = Math.max(edge, rect.right)
            }
          }

          return apply(edge)
        } catch (err) {
          return apply(0)
        }
      }

      /**
       * 弹窗位置：左边让开侧边栏，上/右/下都贴视口边（= 覆盖右侧聊天/内容区）。
       * 只依赖侧边栏右边界，不会再被"量错内容区"压成一条缝。
       */
      function measureLayout() {
        try {
          const view = viewportSize()
          const sidebarEdge = Math.max(0, Math.min(measureSidebarEdge(), view.width - 120))
          return {
            left: sidebarEdge,
            top: 0,
            right: 0,
            bottom: 0,
            width: Math.max(0, view.width - sidebarEdge),
            height: view.height,
            sidebarWidth: sidebarEdge,
          }
        } catch (err) {
          return null
        }
      }

      /** 全屏工作台弹窗：固定定位，从侧边栏右边一直铺到视口四边（不盖左侧栏） */
      function WorkbenchModal(props) {
        const [layout, setLayout] = react.useState(() => measureLayout())

        react.useEffect(() => {
          let timer = null
          const remeasure = () => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
              try {
                setLayout(measureLayout())
              } catch (err) {
                /* 忽略 */
              }
            }, 120)
          }
          try {
            if (typeof window !== 'undefined' && window.addEventListener) {
              window.addEventListener('resize', remeasure)
              window.addEventListener('scroll', remeasure, true)
            }
          } catch (err) {
            /* 忽略 */
          }
          remeasure() // 打开瞬间再量一次（侧边栏可能刚展开/收起）

          // 侧边栏可能会在打开后一小会儿才落位（展开动画 / 异步渲染），
          // 这里的短轮询只在"量到的左边界变了"时才更新，避免弹窗位置卡在旧值上（"变成全屏"的另一种成因）。
          let probe = null
          let probeCount = 0
          try {
            probe = setInterval(() => {
              probeCount++
              try {
                const next = measureLayout()
                setLayout((prev) => {
                  const changed = !prev || Math.abs((prev.left || 0) - (next.left || 0)) > 1 || Math.abs((prev.width || 0) - (next.width || 0)) > 1
                  return changed ? next : prev
                })
              } catch (err) {
                /* 忽略 */
              }
              if (probeCount >= 8 && probe) {
                clearInterval(probe)
                probe = null
              }
            }, 500)
          } catch (err) {
            probe = null
          }

          // 滚动锁：弹窗铺满右侧时，别让底下的聊天区跟着一起滚（关掉弹窗会还原）
          let restoreScroll = null
          try {
            const body = typeof document !== 'undefined' ? document.body : null
            if (body && body.style) {
              const before = body.style.overflow
              body.style.overflow = 'hidden'
              restoreScroll = () => {
                try {
                  body.style.overflow = before || ''
                } catch (err) {
                  /* 忽略 */
                }
              }
            }
          } catch (err) {
            restoreScroll = null
          }

          return () => {
            if (timer) clearTimeout(timer)
            if (probe) {
              clearInterval(probe)
              probe = null
            }
            if (restoreScroll) restoreScroll()
            try {
              if (typeof window !== 'undefined' && window.removeEventListener) {
                window.removeEventListener('resize', remeasure)
                window.removeEventListener('scroll', remeasure, true)
              }
            } catch (err) {
              /* 忽略 */
            }
          }
        }, [])

        // Esc 关闭
        react.useEffect(() => {
          const onKey = (event) => {
            try {
              if (event && event.key === 'Escape') props.onClose()
            } catch (err) {
              /* 忽略 */
            }
          }
          try {
            if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', onKey)
          } catch (err) {
            /* 忽略 */
          }
          return () => {
            try {
              if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('keydown', onKey)
            } catch (err) {
              /* 忽略 */
            }
          }
        }, [props.onClose])

        // ⚠ 只认 left/top/height，不再用 right/bottom 反推 —— 免得又被算成一条缝
        const box = layout || { left: SIDEBAR_FALLBACK_WIDTH, top: 0, width: viewportSize().width - SIDEBAR_FALLBACK_WIDTH, height: viewportSize().height }
        return h(
          'div',
          {
            'data-xmt-workbench': 'modal',
            className: CLS.root,
            style: Object.assign(
              {
                position: 'fixed',
                // 弹窗左边界：**用 CSS 变量 + calc 算**，不写死像素 ——
                // 导航栏宽度是动态的（展开/收起不一样），所以由脚本量出来写进 --xmt-nav-edge；
                // --xmt-nav-gap 是"想让多少缝"，默认 0px（紧贴导航栏右边缘）。
                left: 'calc(var(--xmt-nav-edge, 0px) + var(--xmt-nav-gap, 0px))',
                top: `${box.top}px`,
                right: 0,
                height: `${box.height}px`,
                zIndex: 1400,
                // 面板尺寸、圆角、内边距、滚动都在样式表里（.xmt-panel / .xmt-overlay / .xmt-panel-scroll）：
                // 这里只给"必须内联"的定位
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                // 量到的导航栏右边缘（动态值，脚本每次重新测量都会更新）
                '--xmt-nav-edge': `${box.left}px`,
                // 弹窗与导航栏之间的缝：想留缝就改这一个数，别去动 left
                '--xmt-nav-gap': '0px',
                // 背景层/提示浮层的左边界都跟着这条走，保证它们和面板严丝合缝
                '--xmt-modal-left': 'calc(var(--xmt-nav-edge, 0px) + var(--xmt-nav-gap, 0px))',
              },
              // 兜底底色只染"右侧这块"（不是整个视口），样式表没注入也不会漏出后面的聊天
              ST.rootVars,
            ),
          },
          // 没有标题栏：直接铺内容（关闭方式是再点一次侧边栏入口，或按 Esc）
          // 背景只在 .xmt-panel-scroll 那一层画一次（fixed 钉在视口上，滚到底不断层）；
          // 弹窗外壳不再单独铺背景，免得把整块渐变切断。
          // .xmt-overlay：fixed 浮层（不挤下面主界面，左边让开侧边栏）
          // .xmt-panel-scroll：面板内部自己滚动（内容超高时能上下滑）
          // .xmt-panel-glow：背景上那层"会飘会呼吸"的柔光（真正的 CSS @keyframes 动画）。
          //   fixed 钉在视口上、永远在最底下、pointer-events:none —— 卡片布局和点击完全不受影响。
          h(
            'div',
            { className: CLS.overlay },
            h(
              'div',
              { className: CLS.panel },
              h(
                'div',
                { className: CLS.panelScroll },
                h('div', { className: CLS.panelGlow, 'aria-hidden': 'true' }),
                h(Guarded, { Comp: Workbench, compProps: { onClose: props.onClose, inModal: true } }),
              ),
            ),
          ),
        )
      }

      /** 侧边栏入口：按钮 + 弹窗（同一个组件实例，共享 open 状态） */
      function SidebarEntry(props) {
        const wide = !!(props && props.wide)
        const snap = typeof react.useSyncExternalStore === 'function' ? react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot) : useSnapshotFallback(react)
        const open = !!(snap && snap.open)

        /** 同一个按钮当开关：关着就打开，已经打开就关掉（弹窗没标题栏了，这是主要的关闭方式） */
        const onToggle = () => {
          try {
            if (open) closeWorkbench()
            else openWorkbench()
          } catch (err) {
            try {
              console.error('[ai-news-workbench] 切换工作台开关失败：', err)
            } catch (logErr) {
              /* 忽略 */
            }
          }
        }

        const spark = h(
          'svg',
          { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('path', { d: 'M8 1.8l1.6 4 4 1.6-4 1.6L8 13l-1.6-4-4-1.6 4-1.6L8 1.8z' }),
        )

        /** 图标外面套一层 24px 的盒子：这样图标和文字的左边界都和「技能中心」那一行对齐 */
        const icon = h('span', { className: CLS.enterIcon, 'aria-hidden': 'true' }, spark)

        /** 有 useLayoutEffect 就用它：卸载清理必须赶在 React 删节点之前跑（见 sidebar-entry.js） */
        const useIsoLayoutEffect = react.useLayoutEffect || react.useEffect
        const entryRef = react.useRef(null)

        /**
         * 落位：槽位（sidebar.footer.action）只能给到侧边栏最底部，
         * 这里把渲染出来的按钮搬到「技能中心」正下方；返回的清理函数会把它放回原位。
         * 拿不到真实 DOM（比如测试脚手架）时是空操作，不影响渲染。
         */
        useIsoLayoutEffect(() => {
          const node = entryRef.current
          if (!node) return undefined
          return mountSidebarEntry(node)
        }, [])

        // 需求：无边框 + 平时淡灰字 + 静态无底色
        // （hover / 点开后的"黑字 + 灰底"只能靠样式表，内联会盖掉 :hover）
        const baseStyle = {
          boxSizing: 'border-box',
          border: 'none',
          background: 'transparent',
          color: 'var(--dsw-alias-label-secondary, inherit)',
          fontFamily: 'inherit',
          cursor: 'pointer',
          flex: 'none',
        }

        const button = wide
          ? h(
              'button',
              {
                type: 'button',
                ref: entryRef,
                title: open ? '收起 AI 资讯工作台（回到聊天）' : '打开 AI 资讯工作台（全屏弹窗，不盖左侧栏）',
                'aria-pressed': open ? 'true' : 'false',
                onClick: onToggle,
                'data-xmt-workbench': 'entry',
                className: CLS.enterBtn,
                style: Object.assign({}, baseStyle, {
                  // 展开态：和「技能中心」一样是一整行文字按钮（36px 高、0 10px 内边距、8px 间距）
                  width: '100%',
                  height: '36px',
                  margin: '4px 0 0',
                  padding: '0 10px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  lineHeight: '1',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: '8px',
                }),
              },
              icon,
              h('span', { className: CLS.enterLabel }, 'AI 资讯工作台'),
            )
          : h(
              'button',
              {
                type: 'button',
                ref: entryRef,
                title: open ? '收起 AI 资讯工作台' : 'AI 资讯工作台',
                'aria-pressed': open ? 'true' : 'false',
                onClick: onToggle,
                'data-xmt-workbench': 'entry',
                className: CLS.enterBtn,
                style: Object.assign({}, baseStyle, {
                  // 折叠态：细轨道里就是一个圆形图标按钮，水平居中，间距和其他图标项一致
                  width: '36px',
                  height: '36px',
                  margin: '0 auto 12px',
                  padding: '0',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }),
              },
              icon,
            )

        // 关着也套一层 display:contents 的壳：按钮在 React 树里的位置必须**始终不变**。
        // 否则开/关会把它删掉重建，而它已经被搬到别处，React 会删不动（见 sidebar-entry.js 的说明）。
        // 壳是 display:contents，不占位、不影响侧边栏布局。
        return h('div', { style: { display: 'contents' } }, button, open ? h(WorkbenchModal, { onClose: () => closeWorkbench() }) : null)
      }

      // 取槽位服务（声明了 inject: ['slots']，正常一定拿得到）
      const slots = (() => {
        try {
          if (ctx && ctx.slots && typeof ctx.slots.inject === 'function') return ctx.slots
        } catch (err) {
          /* 继续尝试 */
        }
        try {
          return typeof ctx.get === 'function' ? ctx.get('slots') : null
        } catch (err) {
          return null
        }
      })()
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        try {
          console.warn('[ai-news-workbench] 槽位服务不可用，工作台界面没有注册（聊天功能不受影响）')
        } catch (err) {
          /* 忽略 */
        }
        return
      }

      try {
        slots.inject('sidebar.footer.action', () =>
          slots.register(
            {
              name: 'sidebar.footer.action',
              id: SLOT_ID,
              order: 20,
            },
            SidebarEntry,
          ),
        )
      } catch (err) {
        try {
          console.error('[ai-news-workbench] 注册侧边栏入口失败：', err)
        } catch (logErr) {
          /* 忽略 */
        }
      }
    }

    /* eslint-disable */ var __unusedDefault = { name, inject, apply }

    // ==================== 导出 ====================
    exports.name = name
    exports.inject = inject
    exports.apply = apply
    exports.default = { name: name, inject: inject, apply: apply }
    return module.exports
  },
})

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
export const TOKENS = {
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
export function tokenCss() {
  return Object.keys(TOKENS)
    .map((key) => `${key}:${TOKENS[key]};`)
    .join('')
}

/** 常用 class 名（写错会静默没样式，所以集中在这里） */
export const CLS = {
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
export const BTN = { primary: 'is-primary', ghost: 'is-ghost', ok: 'is-ok', bad: 'is-bad' }
export const SIZE = { tiny: 'is-tiny' }
export const TONE = { idle: 'idle', run: 'run', done: 'done', wait: 'wait' }

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
export function toneStyle(tone, breatheDelay) {
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
export function markAll(h, text, keyPrefix = 'mark') {
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
export function ensureStyles(doc) {
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

export const ST = {
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
export const S = {
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
export function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

/** 把高亮分段渲染成 React 节点 */
export function renderSegments(h, segments, keyPrefix = 'seg') {
  if (!Array.isArray(segments) || !segments.length) return null
  return segments.map((seg, index) =>
    seg.highlight ? h('span', { key: `${keyPrefix}_${index}`, className: CLS.mark }, seg.text) : h('span', { key: `${keyPrefix}_${index}` }, seg.text),
  )
}

/** 简单的 SVG 图标（无外部依赖） */
export function icon(h, name, size = 16) {
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

export const api = {
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
export async function copyText(text) {
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
export function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 百分比显示（拿不到数字就显示 ——，别显示 NaN%） */
export function percent(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

/** 指标卡用：区分"真的没有数据"和"数据就是 0" */
export function rate(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—'
  return percent(value, digits)
}

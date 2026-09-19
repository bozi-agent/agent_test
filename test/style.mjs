/**
 * 界面样式体检（深色玻璃拟态 + 霓虹状态发光）
 *
 * 为什么单独一个文件：弹窗的样式表是靠 ensureStyles() 往页面里注入的，
 * 内联 style 写不了 :hover / :active / 动画。这段注入逻辑最容易"静默失效"
 * （注入失败时功能照常、只是没样式），所以用假 DOM 专门测一遍。
 *
 * 跑法：node test/style.mjs
 */

import { createAsserter } from './_harness.mjs'

const { check, finish } = createAsserter()

console.log('== 界面样式体检（深色玻璃拟态）==')

const ui = await import('../lib/client/ui.js')

// ---------------------------------------------------------------------------
// 1) 设计令牌：颜色/间距/圆角全部走 CSS 变量
// ---------------------------------------------------------------------------
{
  const t = ui.TOKENS
  check('背景令牌是原来的深蓝→墨绿渐变（135°：#0a1628 → #0d1f2d → #0a1f1a，外加左上蓝/右下绿两块柔光）', String(t['--xmt-bg']).includes('linear-gradient(135deg, #0a1628 0%, #0d1f2d 52%, #0a1f1a 100%)') && String(t['--xmt-bg']).includes('rgba(59,130,246,0.14)') && String(t['--xmt-bg']).includes('rgba(34,197,94,0.12)') && !String(t['--xmt-bg']).includes('#0c1b2c'), t['--xmt-bg'])
  check('卡片底是深色半透明 + 细描边（允许透出背景）', t['--xmt-glass'] === 'rgba(255,255,255,0.05)' && t['--xmt-line'] === 'rgba(255,255,255,0.10)', `${t['--xmt-glass']} / ${t['--xmt-line']}`)
  check('文字是带透明度的白（禁止纯黑纯白）', ['--xmt-text', '--xmt-text-2', '--xmt-text-3', '--xmt-text-4'].every((k) => /^rgba\(255,255,255,0?\.\d+\)$/.test(String(t[k]))), `${t['--xmt-text']} / ${t['--xmt-text-3']}`)
  check('状态色齐（进行中蓝 / 已完成绿 / 等待黄 / 高亮黄）', t['--xmt-accent'] === '#3b82f6' && t['--xmt-ok'] === '#22c55e' && t['--xmt-warn'] === '#f59e0b' && t['--xmt-hi'] === '#fbbf24')
  check(
    '发光令牌齐（蓝/绿/黄各一条 + 外发光/内发光两套）',
    ['--xmt-glow-accent', '--xmt-glow-accent-strong', '--xmt-glow-ok', '--xmt-glow-warn', '--xmt-inset-accent', '--xmt-inset-ok', '--xmt-inset-warn'].every((k) => /^rgba\(/.test(String(t[k]))),
  )
  check('圆角/间距令牌齐（卡片 14px、按钮 8px、胶囊 999px、间距 16/20）', t['--xmt-radius'] === '14px' && t['--xmt-radius-sm'] === '8px' && t['--xmt-radius-pill'] === '999px' && t['--xmt-space'] === '16px' && t['--xmt-space-lg'] === '20px')
  // 本轮改动：卡片整体调小一圈，更紧凑（150×112 / 间距 12px / 内边距 12px / 网格上限 486px）
  check('网格 12px 间距 / 卡片 12px 内边距 / 卡片 150×112', t['--xmt-grid-gap'] === '12px' && t['--xmt-card-pad'] === '12px' && t['--xmt-card-w'] === '150px' && t['--xmt-card-h'] === '112px' && t['--xmt-grid-max'] === '486px', JSON.stringify({ gap: t['--xmt-grid-gap'], pad: t['--xmt-card-pad'], w: t['--xmt-card-w'], h: t['--xmt-card-h'], max: t['--xmt-grid-max'] }))
  check('卡片尺寸令牌（宽 150 / 高 112；不用正方形比例）', t['--xmt-card-ratio'] === undefined && t['--xmt-card-w'] === '150px' && t['--xmt-card-h'] === '112px')
  check('没有模糊令牌（卡片不再用 backdrop-filter）', t['--xmt-blur'] === undefined && t['--xmt-glass-shine'] === undefined && t['--xmt-glass-edge'] === undefined)
  check('氛围动效令牌（背景流动 26s / 描边流光 9s）', t['--xmt-bg-drift'] === '26s' && t['--xmt-shimmer'] === '9s', JSON.stringify({ drift: t['--xmt-bg-drift'], shimmer: t['--xmt-shimmer'] }))
  check('一级界面居中：舞台只留左右安全边距（上下交给 flex 居中）', t['--xmt-stage-pad'] === '20px')
  check('未开始的状态文字色是灰 rgba(255,255,255,0.4)', t['--xmt-text-idle'] === 'rgba(255,255,255,0.4)')
  check('系统无衬线字体（含苹方/微软雅黑）', String(t['--xmt-font']).includes('Segoe UI') && String(t['--xmt-font']).includes('PingFang SC') && String(t['--xmt-font']).includes('Microsoft YaHei'), t['--xmt-font'])
  check('数字用等宽字体令牌', String(t['--xmt-font-mono']).includes('mono') || String(t['--xmt-font-mono']).includes('Consolas'))

  const css = ui.tokenCss()
  check('tokenCss() 能把令牌拼成 CSS 声明', css.includes('--xmt-bg:') && css.includes('--xmt-radius:14px;') && (css.match(/--xmt-/g) || []).length >= 20)
}

// ---------------------------------------------------------------------------
// 2) 色调：状态 -> 描边色 + 外发光（核心视觉规则）
// ---------------------------------------------------------------------------
{
  const idle = ui.toneStyle(ui.TONE.idle)
  const run = ui.toneStyle(ui.TONE.run)
  const done = ui.toneStyle(ui.TONE.done)
  const wait = ui.toneStyle(ui.TONE.wait)
  check('未开始：灰边 + 无发光 + 灰字', idle['--xmt-tone'] === 'var(--xmt-line)' && idle['--xmt-tone-glow'] === 'none' && idle['--xmt-tone-text'] === 'var(--xmt-text-idle)', JSON.stringify(idle))
  check('进行中：蓝色边 + 蓝光 + 内发光 + 黄字', run['--xmt-tone'] === 'var(--xmt-accent)' && run['--xmt-tone-glow'] === 'var(--xmt-glow-accent)' && run['--xmt-tone-inset'] === 'var(--xmt-inset-accent)' && run['--xmt-tone-text'] === 'var(--xmt-warn)', JSON.stringify(run))
  check('已完成：绿色边 + 绿光 + 内发光 + 绿字', done['--xmt-tone'] === 'var(--xmt-ok)' && done['--xmt-tone-glow'] === 'var(--xmt-glow-ok)' && done['--xmt-tone-inset'] === 'var(--xmt-inset-ok)' && done['--xmt-tone-text'] === 'var(--xmt-ok)', JSON.stringify(done))
  check('等待确认：黄色边 + 黄光 + 内发光 + 黄字', wait['--xmt-tone'] === 'var(--xmt-warn)' && wait['--xmt-tone-glow'] === 'var(--xmt-glow-warn)' && wait['--xmt-tone-inset'] === 'var(--xmt-inset-warn)' && wait['--xmt-tone-text'] === 'var(--xmt-warn)', JSON.stringify(wait))
  check('未知色调退回"未开始"（不报错、不发光）', ui.toneStyle('不存在的状态')['--xmt-tone'] === 'var(--xmt-line)')
}

// ---------------------------------------------------------------------------
// 3) 样式表注入：一段 CSS 必须真的进到 <head>
// ---------------------------------------------------------------------------
{
  const injected = []
  const created = []
  const fakeDoc = {
    head: {
      appendChild(node) {
        injected.push(node)
      },
    },
    createElement(tag) {
      const el = { tagName: tag, textContent: '', setAttribute(k, v) { this[k] = v } }
      created.push(el)
      return el
    },
    getElementById: () => null,
  }
  const node = ui.ensureStyles(fakeDoc)
  check('ensureStyles 能注入 <style>', !!node && injected.length === 1, `注入 ${injected.length} 个节点`)
  const css = String((injected[0] && injected[0].textContent) || '')

  check('样式表带 id（幂等用，避免重复注入）', (injected[0] && injected[0].id) === 'xmt-kf-style', String(injected[0] && injected[0].id))
  // 背景：原来的深蓝→墨绿渐变，并且**直接画在滚动容器那一层** + background-attachment:fixed
  // （按可视区域铺 ⇒ 内容再长也不会被拉伸、不会色块割裂；少一层叠加就少一处断层）
  check(
    '背景是原来的深蓝→墨绿渐变，只画在滚动容器上且用 fixed 按可视区域铺（滚到底不断层、不露黑底）',
    css.includes('background-image:var(--xmt-bg)') &&
      /\.xmt-root \.xmt-panel-scroll\{[^}]*background-image:var\(--xmt-bg\)/.test(css) &&
      /\.xmt-root \.xmt-panel-scroll\{[^}]*background-attachment:fixed/.test(css) &&
      /\.xmt-root \.xmt-panel-scroll\{[^}]*background-size:cover/.test(css) &&
      /--xmt-bg:radial-gradient\(1100px 620px at 16% 8%[\s\S]*linear-gradient\(135deg, #0a1628 0%, #0d1f2d 52%, #0a1f1a 100%\)/.test(ui.tokenCss()),
    (/(\.xmt-root \.xmt-panel-scroll\{[^}]*\})/.exec(css) || [''])[0],
  )
  check('旧的"跟内容高度走"的背景层已彻底删掉（避免滚到底露底/黑断层）', !css.includes('.xmt-bg{') && !css.includes('.xmt-bg-flow{'))
  check('弹窗外壳不再自己铺渐变（避免重复，也避免盖到左侧导航栏）', ui.ST.rootVars.backgroundImage === undefined && ui.ST.rootVars.backgroundColor === '#0b1727')
  // 说明：.xmt-root 的规则里嵌了 tokenCss()（值里带大括号，正则切不出来），所以用代码里留的锚点注释切
  check('根节点不再用 overflow:hidden（内容超高时要能滚动，不能被裁）', (() => {
    const start = css.indexOf('.xmt-root{')
    const end = css.indexOf('xmt-root-rule-end')
    if (start === -1 || end <= start) return false
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, ' ')
    return !/overflow\s*:\s*hidden/.test(block)
  })(), (() => {
    const start = css.indexOf('.xmt-root{')
    const end = css.indexOf('xmt-root-rule-end')
    return start === -1 || end <= start ? '（没找到锚点）' : css.slice(start, end).slice(-260)
  })())
  // 高度链：工作台必须铺满面板高度，否则背景渐变只盖住上面一截、下面露出纯底色（"下面是空的"）
  check(
    '工作台铺满面板高度（根节点 min-height:100%，弹窗里补 height:100%）',
    (() => {
      const start = css.indexOf('.xmt-root{')
      const end = css.indexOf('xmt-root-rule-end')
      if (start === -1 || end <= start) return false
      return /min-height:100%/.test(css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, ' '))
    })() && /\.xmt-root\.in-panel\{height:100%;background:transparent\}/.test(css),
    (/(\.xmt-root\.in-panel\{[^}]*\})/.exec(css) || [''])[0],
  )
  check('弹窗区域有兜底底色（不漏出后面的聊天）', /\.xmt-root \.xmt-panel-scroll\{[^}]*background-color:#0b1727/.test(css) && !css.includes('.xmt-modal-bg{'))
  check('字体族写进了根容器', css.includes('-apple-system') && css.includes('Microsoft YaHei'))
  check('卡片：深色半透明底 + 1px 细边 + 14px 圆角，且不用 backdrop-filter', css.includes('background:var(--xmt-glass)') && css.includes('border:1px solid var(--xmt-tone,var(--xmt-line))') && css.includes('border-radius:var(--xmt-radius)'))
  // 先把注释去掉再判断，否则注释里写的"不用 backdrop-filter"会被误判
  const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '')
  check('卡片不用 backdrop-filter / 不用高光叠加层', !/\.xmt-mcard\{[^}]*backdrop-filter/.test(cssNoComment) && !css.includes('xmt-glass-shine'))
  // 本轮需求：卡片**外面**要有一圈柔和彩色发光（呼吸灯），但卡片内部必须还是原来的深色
  check(
    '卡片外面那圈呼吸光是画在边框外面的 box-shadow（不用伪元素，物理上不可能糊到卡片脸上）',
    /\.xmt-mcard\{[^}]*box-shadow:[\s\S]{0,120}var\(--xmt-halo,none\)/.test(css) &&
      /\.xmt-mcard\{[^}]*animation:xmt-halo-breathe var\(--xmt-halo-dur,5s\) ease-in-out infinite/.test(css) &&
      !css.includes('.xmt-mcard::before{'),
    (/(\.xmt-mcard\{[\s\S]{0,420})/.exec(css) || [''])[0],
  )
  check(
    '呼吸动画：只改 box-shadow 的颜色/模糊（不动 transform、不动 opacity），卡片位置与大小不变',
    (() => {
      const start = css.indexOf('@keyframes xmt-halo-breathe{')
      if (start === -1) return false
      let depth = 0
      let end = start
      for (let i = start + '@keyframes xmt-halo-breathe'.length; i < css.length; i++) {
        if (css[i] === '{') depth++
        else if (css[i] === '}') {
          depth--
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      const block = css.slice(start, end)
      return block.includes('var(--xmt-halo,none)') && block.includes('var(--xmt-halo-soft,none)') && !/transform/.test(block) && !/opacity/.test(block) && !/\bfilter\b/.test(block)
    })(),
    (/(@keyframes xmt-halo-breathe\{[\s\S]{0,360})/.exec(css) || [''])[0],
  )
  check('光晕颜色分状态（--xmt-halo / --xmt-halo-soft / --xmt-halo-tint，都是柔和的暗一档颜色）', (() => {
    const run = ui.toneStyle(ui.TONE.run)
    const idle = ui.toneStyle(ui.TONE.idle)
    return /rgba\(59,130,246/.test(String(run['--xmt-halo'])) &&
      /rgba\(59,130,246/.test(String(run['--xmt-halo-soft'])) &&
      run['--xmt-halo-tint'] === 'rgba(59,130,246,0.45)' &&
      idle['--xmt-halo'] === 'none' && idle['--xmt-halo-soft'] === 'none'
  })(), JSON.stringify(ui.toneStyle(ui.TONE.run)))
  check(
    '卡片内部还是实底深色（外圈光不会透进卡片里面）',
    css.includes('background-color:#152734') &&
      ui.toneStyle(ui.TONE.run)['--xmt-halo'] === '0 0 9px 0 rgba(59,130,246,0.20)' &&
      ui.toneStyle(ui.TONE.run)['--xmt-halo-soft'] === '0 0 14px 1px rgba(59,130,246,0.36)',
    String(ui.toneStyle(ui.TONE.done)['--xmt-halo']),
  )
  // hover 里不能再写 box-shadow：写了会把呼吸动画的 box-shadow 覆盖掉（用花括号配对切片，别用 [^}]*）
  check('hover 不再重复写 box-shadow（否则会把呼吸动画的 box-shadow 覆盖掉，hover 就看不到变化）', (() => {
    const start = css.indexOf('.xmt-mcard:hover{')
    if (start === -1) return false
    let depth = 0
    let end = start
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, ' ')
    return !/box-shadow/.test(block)
  })())
  check('呼吸相位沿用 --xmt-breathe-delay（八张卡错开，不会一起闪）', /\.xmt-mcard\{[^}]*animation-delay:var\(--xmt-breathe-delay,0s\)/.test(css))
  check('面板不裁剪背景层（overflow:hidden + 圆角，防止溢出层在边角冒色块）', (() => {
    const start = css.indexOf('.xmt-panel{')
    if (start === -1) return false
    let depth = 0
    let end = start
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, ' ')
    return /overflow\s*:\s*hidden/.test(block) && /border-radius:var\(--xmt-panel-radius,0px\)/.test(block) && css.includes('.xmt-root .xmt-panel-scroll{')
  })())
  // 边缘流光：::after + 渐变裁边，贴在卡片内侧 1px 描边上（不偏移、不溢出）
  check(
    '卡片边缘有微弱流光（::after + inset:0 + border-radius:inherit 裁成 1px 描边 + 慢速扫过）',
    css.includes('.xmt-mcard::after{') &&
      css.includes('position:absolute;inset:0;border-radius:inherit;padding:1px') &&
      css.includes('linear-gradient(100deg, transparent 0%') &&
      css.includes('-webkit-mask-composite:xor') &&
      css.includes('mask-composite:exclude') &&
      /animation:var\(--xmt-tone-shine,xmt-shimmer\) var\(--xmt-shimmer,9s\) linear infinite/.test(css),
  )
  check('流光层的圆角和卡片本体一致（border-radius:inherit），不会在圆角处露出边角', /\.xmt-mcard\{[^}]*border-radius:var\(--xmt-radius\)/.test(css) && css.includes('inset:0;border-radius:inherit;padding:1px'))
  check(
    '流光没有整体 rotate（旋转会让光的角跑到卡片外面）',
    !/xmt-shimmer[^{]*\{[^}]*rotate\(/.test(css) && !/@keyframes xmt-shimmer[\s\S]{0,200}rotate/.test(css),
    (/(@keyframes xmt-shimmer\{[^}]*\})/.exec(css) || [''])[0],
  )
  check(
    '流光有 4 套 keyframes（灰/蓝/绿/黄各一）：扫过描边 + 明暗呼吸',
    ['xmt-shimmer', 'xmt-shimmer-blue', 'xmt-shimmer-green', 'xmt-shimmer-amber'].every((name) => css.includes(`@keyframes ${name}{`)) &&
      /@keyframes xmt-shimmer\{0%\{background-position:-140% 0;opacity:\.34\}50%\{opacity:\.62\}100%\{background-position:240% 0;opacity:\.34\}\}/.test(css) &&
      /@keyframes xmt-shimmer-blue\{0%\{background-position:-140% 0;opacity:\.38\}50%\{opacity:\.85\}/.test(css),
  )
  check('流光只改 background-position / opacity（不改 transform，卡片位置和大小不会变）', !/\.xmt-mcard::after\{[^}]*transform/.test(css))
  check('流光被 mask 裁成描边框（不会盖住卡片里的文字）', /\.xmt-mcard::after\{[^}]*mask-composite:exclude/.test(css) && /\.xmt-mcard::after\{[^}]*inset:0;border-radius:inherit;padding:1px/.test(css))
  check('流光颜色随状态走（--xmt-tone-shine / --xmt-tone-shine-color）', String(ui.toneStyle(ui.TONE.done)['--xmt-tone-shine']).includes('xmt-shimmer-green') && String(ui.toneStyle(ui.TONE.idle)['--xmt-tone-shine-color']).includes('rgba(255,255,255'))
  // 背景只画一处：滚动容器上的 fixed 渐变（不再有单独的光斑层）
  check(
    '背景只画在滚动容器上（不再有跟着内容走的光斑层）+ 内容层压在它上面',
    !css.includes('.xmt-bg-flow{') &&
      !css.includes('.xmt-bg{') &&
      /\.xmt-root \.xmt-panel-scroll\{[^}]*background-attachment:fixed/.test(css) &&
      css.includes('.xmt-root .xmt-scroll{position:relative;z-index:2}'),
  )
  check('漂移动画不出容器（只用像素级平移，没有 scale 放大）', /@keyframes xmt-bg-drift\{[\s\S]{0,200}translate3d\(-10px/.test(css) && !/@keyframes xmt-bg-drift\{[\s\S]{0,400}scale/.test(css))
  check('整份样式表都不用 backdrop-filter（不会再有翻白风险）', !cssNoComment.includes('backdrop-filter'))
  check('卡片未开始时也有一圈内发光（inset 内发光保留）', css.includes('inset 0 0 12px var(--xmt-tone-inset,transparent)'))
  check('未开始不发光（halo 是 none / inset 是 transparent）', ui.toneStyle(ui.TONE.idle)['--xmt-halo'] === 'none' && ui.toneStyle(ui.TONE.idle)['--xmt-tone-inset'] === 'transparent')
  check('状态文字 12px / 500，颜色随状态色', css.includes('.xmt-mcard-state{font-size:12px;font-weight:500') && css.includes('color:var(--xmt-tone-text,var(--xmt-text-idle))'))
  check('内容整体靠上（justify-content:flex-start）+ 模块名与状态间距 8px', css.includes('justify-content:flex-start') && css.includes('gap:8px'))
  check('卡片里不再有"数字块"样式（xmt-mcard-mid / xmt-mcard-num 已删）', !css.includes('xmt-mcard-mid') && !css.includes('xmt-mcard-num'))
  check('模块名 14px / 600 / rgba(255,255,255,0.95)，图标 16px', css.includes('.xmt-mcard-name{font-size:14px;font-weight:600;color:rgba(255,255,255,0.95)') && css.includes('.xmt-mcard-icon{font-size:16px'))
  check('卡片里不再有说明文字样式（xmt-mcard-desc 已删）', !css.includes('xmt-mcard-desc'))
  check('卡片固定 150×112（width/height 令牌）', css.includes('width:var(--xmt-card-w)') && css.includes('height:var(--xmt-card-h)'))
  check('整卡可点：cursor:pointer + hover 上浮 3px + :active 缩放 0.98', css.includes('cursor:pointer;-webkit-appearance:none') && css.includes('.xmt-mcard:hover{') && css.includes('transform:translateY(-3px)') && css.includes('.xmt-mcard:active{transform:scale(.98)}'))
  check('整卡可点后不再有单独的"进入"按钮样式（xmt-mcard-foot 已删）', !css.includes('xmt-mcard-foot'))
  check('网格 12px 间距 + 固定 3 列 150px + 居中', css.includes('gap:var(--xmt-grid-gap)') && css.includes('grid-template-columns:repeat(3,var(--xmt-card-w))') && css.includes('justify-content:center') && css.includes('margin:0 auto'))
  check('卡片有立体感：左上反光 + 玻璃渐变 + 落影 + 顶部高光棱 + 底部暗棱', css.includes('radial-gradient(120% 80% at 18% 0%') && css.includes('background-image:linear-gradient(160deg, rgba(255,255,255,0.085)') === false && css.includes('linear-gradient(160deg, rgba(255,255,255,0.085)') && css.includes('0 6px 16px rgba(0,0,0,0.35)') && css.includes('inset 0 1px 0 rgba(255,255,255,0.14)') && css.includes('inset 0 -1px 0 rgba(0,0,0,0.28)'))
  check('卡片外圈呼吸光有 keyframes（未开始不发光）', css.includes('animation:xmt-halo-breathe var(--xmt-halo-dur,5s) ease-in-out infinite') && css.includes('@keyframes xmt-halo-breathe') && ui.toneStyle(ui.TONE.idle)['--xmt-halo-soft'] === 'none')
  check('呼吸相位可错开（--xmt-breathe-delay）', css.includes('animation-delay:var(--xmt-breathe-delay,0s)') && ui.toneStyle(ui.TONE.done, '-1.35s')['--xmt-breathe-delay'] === '-1.35s')
  check('缩小动效设置下呼吸也关掉（prefers-reduced-motion 全局关动画）', css.includes('@media (prefers-reduced-motion:reduce)') && css.includes('animation:none!important'))
  // 一级界面居中 + 可滚动（回归点）
  check(
    '主界面有居中舞台（min-height:100% + justify-content:center；横向用 stretch 让左上角坐标不失真）',
    css.includes('.xmt-stage{') &&
      css.includes('min-height:100%') &&
      /\.xmt-stage\{[^}]*justify-content:center/.test(css) &&
      /\.xmt-stage\{[^}]*align-items:stretch/.test(css),
    (/(\.xmt-stage\{[^}]*\})/.exec(css) || [''])[0],
  )
  check('设置按钮是大号样式（padding 11×22 / 15px / 圆角 10px）', /\.xmt-settings-entry\{[^}]*padding:11px 22px;font-size:15px/.test(css), (/(\.xmt-settings-entry\{[^}]*\})/.exec(css) || [''])[0])
  check('舞台内容纳不下时可以长高（flex:1 0 auto，不被压缩/裁掉）', /\.xmt-stage\{[^}]*flex:1 0 auto/.test(css))
  check('舞台有上下 40px / 左右安全边距（--xmt-stage-pad 20px）', /\.xmt-stage\{[^}]*padding:40px var\(--xmt-stage-pad\)/.test(css) && ui.TOKENS['--xmt-stage-pad'] === '20px', (/(\.xmt-stage\{[^}]*\})/.exec(css) || [''])[0])
  check('网格自带上下 40px 安全边距（卡片不贴边、底部不被裁）', /\.xmt-grid\{[^}]*padding:40px 0/.test(css), (/(\.xmt-grid\{[^}]*\})/.exec(css) || [''])[0])
  check('一级页的 .xmt-page 走 display:contents（舞台才能撑满滚动区、真正上下左右居中）', css.includes('.xmt-root .xmt-page.is-stage-page{display:contents}'))
  check('滚动容器的 overflow:auto 还在（内容超高时能上下滑）', /\.xmt-root \.xmt-scroll\{[^}]*overflow:auto/.test(css))
  check('弹窗里的滚动区有自己的类（.xmt-panel-scroll），不会被通用规则压住', /\.xmt-root \.xmt-panel-scroll\{[^}]*overflow-y:auto/.test(css) && /\.xmt-root \.xmt-panel-scroll\{[^}]*overflow-x:hidden/.test(css))
  check('滚动容器与页面用 flex 撑高（居中不依赖百分比高度）', css.includes('.xmt-root .xmt-scroll{') && css.includes('flex:1 1 auto') && css.includes('.xmt-root .xmt-page{'))
  // 弹窗：背景只画在滚动容器这一层（fixed 钉在视口），overlay / panel / 工作台根节点都不留底色
  check(
    '弹窗滚动容器上有 fixed 渐变背景（滚到底不断层）',
    /\.xmt-root \.xmt-panel-scroll\{[^}]*background-image:var\(--xmt-bg\)/.test(css) &&
      /\.xmt-root \.xmt-panel-scroll\{[^}]*background-attachment:fixed/.test(css) &&
      /\.xmt-root \.xmt-panel-scroll\{[^}]*background-size:cover/.test(css),
    (/(\.xmt-root \.xmt-panel-scroll\{[^}]*\})/.exec(css) || [''])[0],
  )
  check('overlay / panel / 工作台根节点 / 内容页都没有自己的背景（不会把背景切断）', /\.xmt-overlay\{[^}]*background:transparent/.test(css) && /\.xmt-panel\{[^}]*background:transparent/.test(css) && /\.xmt-root\.in-panel\{[^}]*background:transparent/.test(css) && /\.xmt-page\{[^}]*background:transparent/.test(css))
  check(
    '二级弹窗是 position:fixed 浮层（不挤下方主界面）',
    /\.xmt-overlay\{[^}]*position:fixed/.test(css) &&
      /\.xmt-overlay\{[^}]*top:0/.test(css) &&
      /\.xmt-overlay\{[^}]*left:var\(--xmt-modal-left,0px\)/.test(css) &&
      /\.xmt-overlay\{[^}]*right:0/.test(css) &&
      /\.xmt-overlay\{[^}]*bottom:0/.test(css),
    (/(\.xmt-overlay\{[^}]*\})/.exec(css) || [''])[0],
  )
  check(
    '弹窗打开动画只做 opacity 淡入（没有 margin / 位移）',
    /@keyframes xmt-panel-fade-in\{[^}]*from\{opacity:0\}[^}]*to\{opacity:1\}/.test(css) &&
      /\.xmt-overlay\{[^}]*animation:xmt-panel-fade-in/.test(css) &&
      !/@keyframes xmt-panel-fade-in\{[^}]*transform/.test(css) &&
      !/@keyframes xmt-panel-fade-in\{[^}]*margin/.test(css),
  )
  check('左上角设置入口钉在最外层：top:24px + left:24px + z-index:100', /\.xmt-main-bar\{[^}]*position:absolute;top:24px;left:24px;z-index:100/.test(css), (/(\.xmt-main-bar\{[^}]*\})/.exec(css) || [''])[0])
  // 工作台：铺满"侧边栏右边"那块区域（不铺满整个屏幕、不盖左侧导航栏）
  check(
    '工作台铺满侧边栏右边那块：.xmt-overlay 不留白 + stretch（panel 撑满）',
    /\.xmt-overlay\{[^}]*padding:var\(--xmt-panel-inset,0px\)/.test(css) &&
      /\.xmt-overlay\{[^}]*align-items:stretch/.test(css) &&
      /\.xmt-overlay\{[^}]*justify-content:stretch/.test(css),
    (/(\.xmt-overlay\{[^}]*\})/.exec(css) || [''])[0],
  )
  check(
    '面板撑满这块区域（width:100% + flex:1 1 auto，没有 max-width / max-height）',
    /\.xmt-panel\{[^}]*width:100%/.test(css) &&
      /\.xmt-panel\{[^}]*flex:1 1 auto/.test(css) &&
      !/\.xmt-panel\{[^}]*max-width:/.test(css) &&
      !/\.xmt-panel\{[^}]*max-height:/.test(css),
    (/(\.xmt-panel\{[^}]*\})/.exec(css) || [''])[0],
  )
  check('面板背景透明（渐变统一由滚动容器负责，滚到底不会断层）', /\.xmt-panel\{[^}]*background:transparent/.test(css) && /\.xmt-root \.xmt-panel-scroll\{[^}]*background-attachment:fixed/.test(css))
  check('不会再出现横向滚动条（面板滚动区 overflow-x:hidden + 舞台/网格 min-width:0）', /\.xmt-root \.xmt-panel-scroll\{[^}]*overflow-x:hidden/.test(css) && /\.xmt-stage\{[^}]*min-width:0/.test(css) && /\.xmt-grid\{[^}]*min-width:0/.test(css))
  check('返回按钮是红色变体（is-danger）', css.includes('.xmt-btn.is-danger{') && css.includes('border-color:rgba(248,113,113,.55)') && css.includes('.xmt-btn.is-danger:hover{'))
  check('二级页卡片内标题行（左边一组 + 右边同一行的操作按钮）', css.includes('.xmt-module-head{') && css.includes('justify-content:space-between') && css.includes('.xmt-module-head-left{') && css.includes('.xmt-module-actions{') && css.includes('.xmt-module-title{font-size:16px;font-weight:700'))
  check('面包屑样式已删除（xmt-crumb 不再存在）', !css.includes('xmt-crumb'))
  check('虚线入口卡：1px dashed rgba(255,255,255,0.12) + 每行 8px + hover 变白', css.includes('border:1px dashed rgba(255,255,255,0.12)') && css.includes('padding:8px 0') && css.includes('.xmt-mcard-add .xmt-add-nav .xmt-btn:hover{color:var(--xmt-text)'))
  check('虚线入口卡不是按钮（不参与整卡点击）', !/\.xmt-mcard-add\{[^}]*cursor:pointer/.test(css))
  check('按钮有 hover 提亮 + :active 缩放 0.96 + 0.12s 过渡', css.includes(`.xmt-btn:hover{filter:brightness(1.15)}`) && css.includes('.xmt-btn:active{transform:scale(.96)}') && css.includes('transition:transform .12s ease'))
  check('主按钮是蓝底 + 蓝色发光', css.includes('.xmt-btn.is-primary{') && css.includes('box-shadow:0 0 12px var(--xmt-glow-accent)'))
  check('禁用态 opacity .4 + 无 hover 效果', css.includes('opacity:.4;cursor:not-allowed') && css.includes('filter:none!important'))
  check('加载转圈有 keyframes（不是静止的圈）', css.includes('.xmt-spinner{') && css.includes('@keyframes xmt-spin'))
  check('卡片 hover 上浮（0.2s 过渡）', css.includes('.xmt-mcard:hover{') && css.includes('transform:translateY(-3px)') && css.includes('transition:transform .2s ease'))
  // 二级界面：所有条目/指标卡取消悬停晃动（一级卡片的 translateY(-3px) 保留）
  check(
    '二级界面的条目/指标卡/建议卡/标题卡都不再悬停晃动（只提亮描边）',
    css.includes('.xmt-item:hover{border-color:var(--xmt-line-2)}') &&
      css.includes('.xmt-metric:hover{border-color:var(--xmt-line-2)}') &&
      css.includes('.xmt-suggest:hover{border-color:var(--xmt-line-2)}') &&
      css.includes('.xmt-copycard:hover{filter:brightness(1.15);border-color:var(--xmt-line-2)}'),
  )
  check('状态色过渡不是突变（border-color/box-shadow 有 .3s）', css.includes('border-color .3s ease') && css.includes('box-shadow .3s ease'))
  check('二级界面淡入 + 轻微上移（0.2s，无弹跳）', css.includes('@keyframes xmt-fade-in') && css.includes('transform:translateY(6px)') && css.includes('.2s ease'))
  check('模块卡片高度用 150×112 令牌', css.includes('height:var(--xmt-card-h)') && css.includes('min-height:var(--xmt-card-h)'))
  check('虚线入口卡本体（虚线边 + 14px 圆角）', css.includes('.xmt-mcard-add{') && css.includes('border:1px dashed') && css.includes('border-radius:var(--xmt-radius)'))
  check('虚线卡里三行入口是竖排（flex-direction:column）', css.includes('.xmt-mcard-add .xmt-add-nav{display:flex;flex-direction:column'))
  check('窄屏自动降列（1240 两列 / 820 一列并放开固定高度）', css.includes('@media (max-width:1240px)') && css.includes('grid-template-columns:repeat(2,var(--xmt-card-w))') && css.includes('@media (max-width:820px)') && css.includes('.xmt-mcard,.xmt-mcardAdd{width:auto;height:auto;min-height:104px}'.replace('mcardAdd', 'mcard-add')))
  // 结果列表双列：模块1 / 模块2 共用一套双列样式
  check('结果列表双列样式（xmt-grid-2 两列 + 窄屏降一列）', css.includes('.xmt-grid-2{') && css.includes('grid-template-columns:repeat(2,minmax(0,1fr))') && css.includes('.xmt-grid-2{grid-template-columns:1fr}'))
  check('双列里每一条的样式（xmt-subitem 卡片 + 标题两行截断 + 固定高度）', css.includes('.xmt-subitem{') && css.includes('.xmt-subitem-title{') && /\.xmt-subitem\{[^}]*min-height:64px/.test(css) && /\.xmt-subitem-title\{[^}]*line-clamp:2/.test(css))
  check('双列同行等高（xmt-grid-2 用 align-items:stretch）', /\.xmt-grid-2\{[^}]*align-items:stretch/.test(css))
  check('选题库卡片也统一高度（标题两行截断 + is-clamp2）', /\.xmt-item-title\.is-clamp2\{[^}]*line-clamp:2/.test(css) && /\.xmt-grid-2 > \.xmt-item\{[^}]*min-height:132px/.test(css))
  // 模块2 抓取进度条
  check(
    '抓取进度条样式齐（轨道 6px + 蓝色发光填充 + 完成态变绿 + 宽度过渡）',
    css.includes('.xmt-progress{') &&
      css.includes('.xmt-progress-track{') &&
      css.includes('height:6px') &&
      css.includes('.xmt-progress-fill{') &&
      css.includes('background:linear-gradient(90deg, var(--xmt-accent), #22d3ee)') &&
      css.includes('.xmt-progress-fill.is-done{') &&
      css.includes('transition:width .3s ease'),
  )
  check('标签是胶囊（999px 圆角）', css.includes('.xmt-tag{') && css.includes('border-radius:var(--xmt-radius-pill)'))
  // 模块5「封面标签」：模板缩略图卡片 + 可改标签（图片预览/多张缩略图已按需求取消）
  check(
    '封面标签样式齐（预览占位虚框 + 模板缩略图条）',
    css.includes('.xmt-empty-preview{') &&
      css.includes('.xmt-thumb-strip{') &&
      /\.xmt-thumb-strip\{[^}]*display:flex/.test(css) &&
      /\.xmt-empty-preview\{[^}]*border:1px dashed/.test(css),
  )
  check(
    '封面标签样式齐（模板缩略图卡片 + 选中态 + 标签编辑器/输入框/删除）',
    css.includes('.xmt-template-card{') &&
      css.includes('.xmt-template-card.is-active{') &&
      css.includes('.xmt-tag-editor{') &&
      css.includes('.xmt-tag-edit{') &&
      css.includes('.xmt-tag-input{') &&
      css.includes('.xmt-tag-del{') &&
      /\.xmt-template-card\.is-active\{[^}]*var\(--xmt-ok\)/.test(css),
  )
  // 省略号那条：正文盒子必须能收缩（flex 子项 min-width:auto 会让 line-clamp 永不触发）
  check(
    '模块3/封面标签的正文盒子可以收缩（flex 子项 min-width:0，省略号才会生效）',
    /\.xmt-item > div,\s*\.xmt-item > div > div\{min-width:0\}/.test(css) &&
      /\.xmt-body\.xmt-body-clamp\{[^}]*min-width:0/.test(css),
  )
  // 正文省略号（模块3 候选 / 模块5 保存的正文）：line-clamp + max-height 双保险
  check(
    '正文超出显示范围用省略号截断（line-clamp + text-overflow + max-height 双保险）',
    css.includes('.xmt-body.xmt-body-clamp{') &&
      /\.xmt-body\.xmt-body-clamp\{[^}]*-webkit-line-clamp:4/.test(css) &&
      /\.xmt-body\.xmt-body-clamp\{[^}]*text-overflow:ellipsis/.test(css) &&
      /\.xmt-body\.xmt-body-clamp\{[^}]*max-height:/.test(css) &&
      /\.xmt-body\.xmt-body-clamp\{[^}]*overflow:hidden/.test(css),
  )
  check('空状态有占位样式（不留白）', css.includes('.xmt-empty{') && css.includes('border:1px dashed'))
  check('清单勾中项整行绿色高亮', css.includes('.xmt-check.is-hit{background:rgba(34,197,94,.08)'))
  check('关键数字高亮色 #fbbf24', css.includes('--xmt-hi:#fbbf24;') && css.includes('.xmt-mark{color:var(--xmt-hi)'))
  check('转圈是循环动画（加载态专用）', css.includes('animation:xmt-spin .7s linear infinite'))
  check(
    '循环动画：外圈光呼吸（5s）+ 加载转圈（0.7s）+ 描边流光（9s）；背景漂移已经没人用了；淡入是一次性的',
    css.includes('animation:xmt-halo-breathe var(--xmt-halo-dur,5s) ease-in-out infinite') &&
      css.includes('animation:xmt-spin .7s linear infinite') &&
      css.includes('animation:var(--xmt-tone-shine,xmt-shimmer) var(--xmt-shimmer,9s) linear infinite') &&
      !/animation:xmt-bg-drift/.test(css) &&
      css.includes('animation:xmt-fade-in .2s ease'),  )
  check(
    '过渡动效都不超过 0.3s（呼吸除外，它是有意放慢的氛围动效）',
    !/transition:[^;}]*?(?:^|[\s,(])(?:[1-9]\d*|\.[4-9]\d*)s/.test(css),
    (/(transition:[^;}]*)/.exec(css) || [''])[0],
  )
  check('尊重系统"减少动效"设置', css.includes('@media (prefers-reduced-motion:reduce)'))
  check('保持深色主题（浅色只允许主按钮上的白字）', !/background:#fff/i.test(css) && !/color:#000/i.test(css) && !/#f5f5f5|#fafafa|#eeeeee/i.test(css))
  check('样式表里没有未替换的模板占位（变量都拼好了）', !/\$\{/.test(css))

  // 幂等：第二次调用不再注入（styleInjected 已置位）
  ui.ensureStyles(fakeDoc)
  check('重复调用不会重复注入', injected.length === 1, `注入 ${injected.length} 个节点`)

  // 环境不具备 DOM 能力时静默跳过，不能抛错
  let threw = null
  try {
    ui.ensureStyles(null)
    ui.ensureStyles({})
  } catch (err) {
    threw = err
  }
  check('拿不到 DOM 时静默跳过（不抛错，只丢视觉）', !threw, threw && threw.message)
}

// ---------------------------------------------------------------------------
// 4) 高亮：数字 / 英文（模块3 的"标题里数字、人名高亮"）
// ---------------------------------------------------------------------------
{
  const h = (type, props, ...children) => ({ type, props: Object.assign({}, props || {}, { children }) })
  const segs = ui.markAll(h, 'OpenAI 发布 GPT-5，价格降 40%', 'k')
  const texts = (Array.isArray(segs) ? segs : []).map((node) => (typeof node === 'string' ? node : node.props && node.props.children))
  const marked = (Array.isArray(segs) ? segs : [])
    .filter((node) => node && node.props && node.props.className === 'xmt-mark')
    .map((node) => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children)))
  check('数字/英文被高亮包出来', marked.includes('OpenAI') && marked.includes('GPT-5') && marked.includes('40%'), JSON.stringify(marked))
  check('高亮不吞掉普通文字', texts.join('').includes('价格降'), JSON.stringify(texts))
  check('空文本返回 null（不报错）', ui.markAll(h, '', 'k') === null)
  check('没有数字/英文时原样返回', ui.markAll(h, '纯中文一句', 'k') === '纯中文一句')
}

process.exit(finish() ? 1 : 0)

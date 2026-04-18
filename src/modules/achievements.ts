import { fetchDashboardData } from './api-integration'
import { formatCompareText, getContentClampBounds } from './utils'

function escapeAchievementText(value: any): string {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function achievementNumber(value: any): number {
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  var parsed = parseFloat(String(value == null ? '' : value).replace(/,/g, ''))
  return isNaN(parsed) ? 0 : parsed
}

function achievementChangeClass(value: any, fallback?: string): string {
  if (fallback === 'up' || fallback === 'down' || fallback === 'flat') return fallback
  var text = String(value == null ? '' : value).trim()
  if (!text) return 'flat'
  if (/持平|暂无对比/.test(text)) return 'flat'
  if (/↓|-/.test(text)) return 'down'
  if (/↑|\+|增长|增加|🆕/.test(text)) return 'up'
  return 'flat'
}

function updateAchievementScrollState(bar: HTMLElement, wrap: HTMLElement) {
  const hasLeft = bar.scrollLeft > 2
  const hasRight = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2
  wrap.classList.toggle('has-scroll-left', hasLeft)
  wrap.classList.toggle('has-scroll-right', hasRight)
}

function ensureAchievementScrollWrap(bar: HTMLElement): HTMLElement {
  var wrap = bar.parentElement as HTMLElement | null

  if (!wrap || !wrap.classList.contains('achievement-scroll-wrap')) {
    var parent = bar.parentElement
    wrap = document.createElement('div')
    wrap.className = 'achievement-scroll-wrap'
    if (parent) {
      parent.insertBefore(wrap, bar)
    }
    wrap.appendChild(bar)
  }

  var leftBtn = wrap.querySelector('.achievement-scroll-btn.left') as HTMLButtonElement | null
  if (!leftBtn) {
    leftBtn = document.createElement('button')
    leftBtn.className = 'achievement-scroll-btn left'
    wrap.insertBefore(leftBtn, bar)
  }
  leftBtn.innerHTML = ''
  leftBtn.setAttribute('tabindex', '-1')
  leftBtn.setAttribute('aria-hidden', 'true')
  leftBtn.removeAttribute('aria-label')

  var rightBtn = wrap.querySelector('.achievement-scroll-btn.right') as HTMLButtonElement | null
  if (!rightBtn) {
    rightBtn = document.createElement('button')
    rightBtn.className = 'achievement-scroll-btn right'
    wrap.appendChild(rightBtn)
  }
  rightBtn.innerHTML = ''
  rightBtn.setAttribute('tabindex', '-1')
  rightBtn.setAttribute('aria-hidden', 'true')
  rightBtn.removeAttribute('aria-label')

  return wrap
}

function bindAchievementPopout(container: HTMLElement): void {
  if ((container as any).__popoutBound) return
  ;(container as any).__popoutBound = true
  let active: HTMLElement | null = null
  const show = (tag: HTMLElement) => {
    const src = tag.querySelector('[data-popout]') as HTMLElement | null
    if (!src) return
    if (!active) {
      active = src.cloneNode(true) as HTMLElement
      active.classList.add('achieve-popout-floating')
      document.body.appendChild(active)
    }
    active.innerHTML = src.innerHTML
    const r = tag.getBoundingClientRect()
    const W = active.offsetWidth || 280
    const bounds = getContentClampBounds()
    let left = r.left + r.width / 2 - W / 2
    left = Math.max(bounds.left, Math.min(left, bounds.right - W))
    active.style.left = left + 'px'
    active.style.top = (r.bottom + 8) + 'px'
    active.classList.add('visible')
  }
  const hide = () => { if (active) active.classList.remove('visible') }
  if (!(window as any).__achieveEscBound) {
    (window as any).__achieveEscBound = true
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && active && active.classList.contains('visible')) hide()
    })
  }
  container.addEventListener('mouseover', (e: Event) => {
    const tag = (e.target as HTMLElement).closest('.achievement-tag') as HTMLElement | null
    if (tag && container.contains(tag)) show(tag)
  })
  container.addEventListener('mouseout', (e: Event) => {
    const tag = (e.target as HTMLElement).closest('.achievement-tag') as HTMLElement | null
    if (tag) hide()
  })
  container.addEventListener('scroll', hide)
  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
}

export function computeAchievements(ctx) {
  void ctx
  return []
}

function renderAchievementItems(items: any[]) {
  var container = document.getElementById('achievementBar') as HTMLElement | null
  var wrap = container ? ensureAchievementScrollWrap(container) : null
  if (!container || !items || !items.length) {
    if (container) container.innerHTML = ''
    if (container && wrap) updateAchievementScrollState(container, wrap)
    return
  }
  container.innerHTML = items.map(function(it) {
    var headline = it && it.headline ? it.headline : ''
    var headlineFull = it && it.copy ? it.copy : headline
    var hasRawCompare = !!(it && it.current !== undefined && it.prev !== undefined)
    var compareMeta = hasRawCompare
      ? formatCompareText(achievementNumber(it.current), achievementNumber(it.prev), '', 'achievement')
      : null
    var change = compareMeta
      ? compareMeta.text
      : (it && it.text
        ? it.text
        : '')
    var changeCls = achievementChangeClass(change, compareMeta ? compareMeta.cls : (it && it.change_cls ? it.change_cls : ''))
    var detail = it && (it.compare || it.detail) ? (it.compare || it.detail) : ''
    return `
    <div class="achievement-tag">
      <div class="achieve-row1">
        <span class="achieve-emoji">${escapeAchievementText(it && it.emoji ? it.emoji : '✨')}</span>
        ${headline ? `<span class="achieve-headline" data-full="${escapeAchievementText(headlineFull)}">${escapeAchievementText(headline)}</span>` : ''}
        ${change ? `<span class="achieve-change${changeCls ? ' hl-change-inline ' + changeCls : ''}">${escapeAchievementText(change)}</span>` : ''}
        ${detail ? `<span class="achieve-detail" data-full="${escapeAchievementText(detail)}">${escapeAchievementText(detail)}</span>` : ''}
      </div>
      <div class="achieve-popout" data-popout>
        <div class="achieve-popout-head">
          <span class="achieve-popout-emoji">${escapeAchievementText(it && it.emoji ? it.emoji : '✨')}</span>
          <span class="achieve-popout-title">${escapeAchievementText(headlineFull)}</span>
        </div>
        ${change ? `<div class="achieve-popout-change ${changeCls}">${escapeAchievementText(change)}</div>` : ''}
        ${detail ? `<div class="achieve-popout-detail">${escapeAchievementText(detail)}</div>` : ''}
      </div>
    </div>
  `
  }).join('')

  if (!wrap) return

  bindAchievementPopout(container)

  var leftBtn = wrap.querySelector('.achievement-scroll-btn.left') as HTMLButtonElement | null
  var rightBtn = wrap.querySelector('.achievement-scroll-btn.right') as HTMLButtonElement | null

  if (!container.dataset.scrollBound && leftBtn && rightBtn) {
    container.addEventListener('scroll', function() {
      updateAchievementScrollState(container as HTMLElement, wrap as HTMLElement)
    })
    window.addEventListener('resize', function() {
      updateAchievementScrollState(container as HTMLElement, wrap as HTMLElement)
    })
    container.dataset.scrollBound = '1'
  }

  updateAchievementScrollState(container, wrap)
}

export function renderAchievements(itemsOrRange: any[] | string) {
  if (typeof itemsOrRange === 'string') {
    void fetchDashboardData(itemsOrRange).then(function(snap) {
      renderAchievementItems((snap && snap.achievements && snap.achievements.achievements) || [])
    }).catch(function() {
      renderAchievementItems([])
    })
    return
  }
  renderAchievementItems(itemsOrRange || [])
}

export function tiltAchieve(e, el) {
  var r = el.getBoundingClientRect();
  var x = (e.clientX - r.left) / r.width - 0.5;
  var y = (e.clientY - r.top) / r.height - 0.5;
  el.style.transform = 'perspective(400px) rotateY('+x*12+'deg) rotateX('+(-y*12)+'deg) scale(1.04)';
}

export function resetAchieve(el) {
  el.style.transition = 'transform 250ms cubic-bezier(0.4,0,0.2,1)';
  el.style.transform = '';
  setTimeout(function() { el.style.transition = ''; }, 250);
}

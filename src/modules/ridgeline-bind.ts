import { Ridgeline, type RidgelineSeries } from './ridgeline'

const PALETTE = ['#60a5fa', '#818cf8', '#a78bfa', '#c084fc', '#e879f9', '#f0abfc', '#67e8f9', '#22d3ee']

const SERIES_CONFIG = [
  { key: 'success', label: '完成' },
  { key: 'runtime_h', label: '运行时长' },
  { key: 'comments', label: '评论' },
  { key: 'likes', label: '点赞' },
  { key: 'saves', label: '收藏' },
  { key: 'dms', label: '私信' },
  { key: 'reach', label: '触达量' },
  { key: 'credits', label: '算力豆' },
]

function getSeriesLength(trend: any): number {
  return SERIES_CONFIG.reduce(function(maxLength, config) {
    var values = trend && Array.isArray(trend[config.key]) ? trend[config.key] : []
    return Math.max(maxLength, values.length)
  }, 0)
}

function normalizeValues(values: any[], pointCount: number): number[] {
  var normalized = Array.isArray(values) ? values.slice(0, pointCount) : []
  while (normalized.length < pointCount) normalized.push(0)
  return normalized.map(function(value) {
    var parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  })
}

function buildRidgelineSeries(trend: any, pointCount: number): RidgelineSeries[] {
  return SERIES_CONFIG.map(function(config, index) {
    return {
      key: config.key,
      label: config.label,
      color: PALETTE[index],
      values: normalizeValues(trend && trend[config.key], pointCount),
    }
  })
}

function getRidgeline() {
  var container = document.getElementById('opsRidgelineContainer') as HTMLElement | null
  if (!container) return null
  var ridgeline = (container as any).__ridgeline as Ridgeline | undefined
  if (!ridgeline) {
    ridgeline = new Ridgeline(container)
    ;(container as any).__ridgeline = ridgeline
  }
  return ridgeline
}

function renderRidgeline() {
  var container = document.getElementById('opsRidgelineContainer') as HTMLElement | null
  if (!container) return
  var ridgeline = getRidgeline()
  if (!ridgeline) return

  var lastSnap = (window as any).__lastSnap
  var trend = lastSnap && lastSnap.ops_trend ? lastSnap.ops_trend : {}
  var labels = Array.isArray(trend.labels) && trend.labels.length
    ? trend.labels
    : (Array.isArray(trend.dates) ? trend.dates : [])
  var pointCount = Math.max(labels.length, getSeriesLength(trend))

  ridgeline.setData(labels.slice(0, pointCount), buildRidgelineSeries(trend, pointCount))
}

function setChartView(view: string) {
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.chart-view-btn')) as HTMLButtonElement[]
  var chartCanvas = document.getElementById('opsTaskChart') as HTMLCanvasElement | null
  var chartWrapper = chartCanvas ? chartCanvas.parentElement as HTMLElement | null : null
  var toggles = document.querySelector('.chart-toggles') as HTMLElement | null
  var ridgelineContainer = document.getElementById('opsRidgelineContainer') as HTMLElement | null

  buttons.forEach(function(button) {
    button.classList.toggle('active', button.dataset.view === view)
  })

  if (!ridgelineContainer) return

  if (view === 'ridge') {
    if (chartWrapper) chartWrapper.style.display = 'none'
    if (toggles) toggles.style.display = 'none'
    ridgelineContainer.style.display = 'block'
    renderRidgeline()
    return
  }

  if (chartWrapper) chartWrapper.style.display = ''
  if (toggles) toggles.style.display = 'flex'
  ridgelineContainer.style.display = 'none'
}

export function bindRidgelineToggle() {
  if ((window as any).__ridgelineBound) return
  ;(window as any).__ridgelineBound = true

  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.chart-view-btn') as HTMLElement | null
    if (!target) return
    const view = target.dataset.view
    if (!view) return

    document.querySelectorAll('.chart-view-btn').forEach(b => b.classList.remove('active'))
    target.classList.add('active')

    const chart2d = document.getElementById('opsTaskChart')
    const ridgeCtn = document.getElementById('opsRidgelineContainer')
    const toggles = document.querySelector('.chart-toggles') as HTMLElement
    if (!chart2d || !ridgeCtn) return

    if (view === 'ridge') {
      chart2d.parentElement!.style.display = 'none'
      if (toggles) toggles.style.display = 'none'
      ridgeCtn.style.display = 'block'

      const snap = (window as any).__lastSnap
      if (!snap?.ops_trend) return
      const ot = snap.ops_trend
      const labels = ot.labels || []
      const seriesList = [
        { key: 'success',    label: '完成',    color: '#60a5fa', values: ot.success    || [] },
        { key: 'runtime_h',  label: '运行时长', color: '#818cf8', values: ot.runtime_h  || [] },
        { key: 'comments',   label: '评论',    color: '#a78bfa', values: ot.comments   || [] },
        { key: 'likes',      label: '点赞',    color: '#c084fc', values: ot.likes      || [] },
        { key: 'saves',      label: '收藏',    color: '#e879f9', values: ot.saves      || [] },
        { key: 'dms',        label: '私信',    color: '#f0abfc', values: ot.dms        || [] },
        { key: 'reach',      label: '触达量',  color: '#67e8f9', values: ot.reach      || [] },
        { key: 'credits',    label: '算力豆',  color: '#22d3ee', values: ot.credits    || [] }
      ]
      if (!(window as any).__ridge) (window as any).__ridge = new Ridgeline(ridgeCtn)
      ;(window as any).__ridge.setData(labels, seriesList)
    } else {
      chart2d.parentElement!.style.display = ''
      if (toggles) toggles.style.display = ''
      ridgeCtn.style.display = 'none'
    }
  })
}

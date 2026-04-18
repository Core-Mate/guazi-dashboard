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
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.chart-view-btn')) as HTMLButtonElement[]
  if (!buttons.length) return

  buttons.forEach(function(button) {
    if ((button as any).__ridgelineBound) return
    ;(button as any).__ridgelineBound = true
    button.addEventListener('click', function() {
      setChartView(button.dataset.view === 'ridge' ? 'ridge' : '2d')
    })
  })
}

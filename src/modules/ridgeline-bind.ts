import { Ridgeline, type RidgelineSeries } from './ridgeline'

const PALETTE = [
  '#1e3a8a',
  '#1e40af',
  '#2563eb',
  '#3b82f6',
  '#0ea5e9',
  '#38bdf8',
  '#7dd3fc',
  '#a5f3fc',
]

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function switchOpsChartView(oldView: HTMLElement, newView: HTMLElement, newViewDisplay = '') {
  if (oldView === newView) return
  oldView.classList.remove('entering')
  oldView.classList.add('leaving')
  await delay(220)
  oldView.style.display = 'none'
  oldView.classList.remove('leaving', 'entered')
  newView.style.display = newViewDisplay
  newView.classList.remove('leaving')
  newView.classList.add('ops-view-swap', 'entering')
  requestAnimationFrame(() => {
    newView.classList.remove('entering')
    newView.classList.add('entered')
  })
}

function buildRidgelineSeries(snap: any): { labels: string[]; seriesList: RidgelineSeries[] } {
  const ot = snap?.ops_trend || {}
  const labels = ot.labels || []
  const seriesList: RidgelineSeries[] = [
    { key: 'success', label: '完成', color: PALETTE[0], values: ot.success || [] },
    { key: 'runtime_h', label: '运行时长', color: PALETTE[1], values: ot.runtime_h || [] },
    { key: 'comments', label: '评论', color: PALETTE[2], values: ot.comments || [] },
    { key: 'likes', label: '点赞', color: PALETTE[3], values: ot.likes || [] },
    { key: 'saves', label: '收藏', color: PALETTE[4], values: ot.saves || [] },
    { key: 'dms', label: '私信', color: PALETTE[5], values: ot.dms || [] },
    { key: 'reach', label: '触达量', color: PALETTE[6], values: ot.reach || [] },
    { key: 'credits', label: '算力豆', color: PALETTE[7], values: ot.credits || [] },
  ]
  return { labels, seriesList }
}

export function refreshRidgeline(snap: any) {
  const ctn = document.getElementById('opsRidgelineContainer') as HTMLElement | null
  if (!ctn) return
  if (ctn.style.display !== 'block') return
  if (!snap?.ops_trend) return
  if (!(window as any).__ridge) (window as any).__ridge = new Ridgeline(ctn)
  const { labels, seriesList } = buildRidgelineSeries(snap)
  ;(window as any).__ridge.setData(labels, seriesList)
}

export function bindRidgelineToggle() {
  if ((window as any).__ridgelineBound) return
  ;(window as any).__ridgelineBound = true

  const initialChart = document.getElementById('opsTaskChart')
  const initialRidge = document.getElementById('opsRidgelineContainer') as HTMLElement | null
  const initialChartContainer = initialChart?.parentElement as HTMLElement | null
  if (initialChartContainer) {
    initialChartContainer.classList.add('ops-view-swap', 'entered')
  }
  if (initialRidge) {
    initialRidge.classList.add('ops-view-swap')
    if (initialRidge.style.display !== 'none') initialRidge.classList.add('entered')
  }

  document.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement).closest('.chart-view-btn') as HTMLElement | null
    if (!target) return
    const view = target.dataset.view
    if (!view) return

    document.querySelectorAll('.chart-view-btn').forEach(b => b.classList.remove('active'))
    target.classList.add('active')

    const chart2d = document.getElementById('opsTaskChart')
    const ridgeCtn = document.getElementById('opsRidgelineContainer')
    const chartContainer = chart2d?.parentElement as HTMLElement | null
    const toggles = document.querySelector('.chart-toggles') as HTMLElement
    if (!chart2d || !ridgeCtn || !chartContainer) return

    if (view === 'ridge') {
      if (toggles) toggles.style.display = 'none'
      if (ridgeCtn.style.display !== 'none') return
      await switchOpsChartView(chartContainer, ridgeCtn, 'block')
      refreshRidgeline((window as any).__lastSnap)
    } else {
      if (toggles) toggles.style.display = ''
      if (chartContainer.style.display !== 'none' && ridgeCtn.style.display === 'none') return
      await switchOpsChartView(ridgeCtn, chartContainer)
    }
  })
}

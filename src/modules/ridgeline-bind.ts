import { Ridgeline, type RidgelineSeries } from './ridgeline'

const PALETTE = ['#60a5fa', '#818cf8', '#a78bfa', '#c084fc', '#e879f9', '#f0abfc', '#67e8f9', '#22d3ee']

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
      refreshRidgeline((window as any).__lastSnap)
    } else {
      chart2d.parentElement!.style.display = ''
      if (toggles) toggles.style.display = ''
      ridgeCtn.style.display = 'none'
    }
  })
}

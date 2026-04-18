import { fmtHM } from '../data/helpers'
import { scenarioGroups, skillData, enabledScenarios } from '../data/scenarios'
import { downloadCSV } from './export-utils'
import type { TaskWeekSummary } from './api-integration'
import { fetchTaskWeekSummary } from './api-integration'
import { drawSparkline } from './charts'
import { getContentClampBounds, smoothToggleCollapse } from './utils'

var sortState: { col: string; dir: 'asc' | 'desc' } = { col: '', dir: 'asc' };
var searchQuery = '';
var scenarioInteractionSortKeys = ['comments', 'likes', 'favorites', 'dms', 'uniqueReach']
let skillNameTipEl: HTMLElement | null = null;
let skillNameTipTimer: number | null = null;
var taskDetailCardEl: HTMLElement | null = null
var taskDetailRow: HTMLElement | null = null
var taskDetailRowId = ''
var taskDetailCache: Record<string, TaskWeekSummary> = {}
var taskDetailErrorCache: Record<string, boolean> = {}
var taskDetailPending: Record<string, Promise<TaskWeekSummary>> = {}
var taskDetailGlobalsBound = false

var taskPlatformLabelMap: Record<string, string> = {
  xhs: '小红书',
  douyin: '抖音',
  kuaishou: '快手',
  wechat: '微信',
  lark: '飞书',
  zoom: 'Zoom',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  general_app: '其他',
}

function formatTaskMetricValue(value: number): string {
  return value > 0 ? value.toLocaleString() : '0'
}

function formatTaskRuntimeHours(value: any): string {
  var hours = num(value)
  return hours > 0 ? hours.toFixed(1) + 'h' : '0.0h'
}

function formatTaskCategory(category: any): string {
  var key = String(category || '').trim().toLowerCase()
  if (key === 'acquire') return '获客触达'
  if (key === 'ops') return '运营维护'
  if (key === 'other') return '其他'
  return key || ''
}

function formatTaskPlatforms(platforms: any): string {
  if (!Array.isArray(platforms) || !platforms.length) return '未设置平台'
  return platforms.map(function(platform) {
    var key = String(platform || '').trim().toLowerCase()
    return taskPlatformLabelMap[key] || String(platform || '')
  }).filter(Boolean).join(' / ')
}

function formatTaskCreatedAt(value: any): string {
  var text = String(value || '').trim()
  if (!text) return ''
  var date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  var year = date.getFullYear()
  var month = String(date.getMonth() + 1).padStart(2, '0')
  var day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function getTaskRowFallback(row: HTMLElement, taskId: string) {
  var nameEl = row.querySelector('.td-skill-name') as HTMLElement | null
  var name = String(
    row.getAttribute('data-task-name')
    || (nameEl && nameEl.textContent)
    || '任务详情'
  ).trim()
  var category = String(row.getAttribute('data-task-group') || '').trim()
  return {
    id: taskId,
    name: name || '任务详情',
    category: category,
    created_at: '',
    platforms: [],
  }
}

function ensureTaskDetailCard(): HTMLElement {
  if (taskDetailCardEl) return taskDetailCardEl
  var card = document.createElement('div')
  card.className = 'task-detail-card'
  card.id = 'task-detail-card'
  card.innerHTML =
    '<div class="task-detail-head">' +
      '<div class="task-detail-avatar"></div>' +
      '<div class="task-detail-identity">' +
        '<div class="task-detail-name"></div>' +
        '<div class="task-detail-meta"></div>' +
      '</div>' +
    '</div>' +
    '<div class="task-detail-metrics">' +
      '<div class="metric"><span class="v"></span><span class="k">完成</span></div>' +
      '<div class="metric"><span class="v"></span><span class="k">算力豆</span></div>' +
      '<div class="metric"><span class="v"></span><span class="k">时长</span></div>' +
      '<div class="metric"><span class="v"></span><span class="k">触达</span></div>' +
    '</div>' +
    '<canvas class="task-detail-spark"></canvas>' +
    '<div class="task-detail-caption">近 7 天完成数趋势</div>'
  document.body.appendChild(card)
  taskDetailCardEl = card
  if (!taskDetailGlobalsBound) {
    window.addEventListener('scroll', hideTaskDetailCard, true)
    window.addEventListener('resize', hideTaskDetailCard)
    document.addEventListener('click', function(e: Event) {
      var target = e.target as Node | null
      if (!target) {
        hideTaskDetailCard()
        return
      }
      if (taskDetailCardEl && taskDetailCardEl.contains(target)) return
      if (target instanceof Element) {
        var row = target.closest('tr[data-task-id]') as HTMLElement | null
        if (row && taskDetailRow === row && taskDetailCardEl && taskDetailCardEl.classList.contains('visible')) return
      }
      hideTaskDetailCard()
    })
    window.addEventListener('keydown', function(e: KeyboardEvent) {
      if (e.key === 'Escape') hideTaskDetailCard()
    })
    taskDetailGlobalsBound = true
  }
  return card
}

function positionTaskDetailCard(card: HTMLElement, row: HTMLElement) {
  var bounds = getContentClampBounds()
  var rowRect = row.getBoundingClientRect()
  var cardWidth = card.offsetWidth || 320
  var cardHeight = card.offsetHeight || 210
  var left = rowRect.right + 8
  if (left + cardWidth > bounds.right) left = rowRect.left - cardWidth - 8
  left = Math.max(bounds.left, Math.min(left, bounds.right - cardWidth))
  var top = rowRect.top + rowRect.height / 2 - cardHeight / 2
  top = Math.max(bounds.top, Math.min(top, bounds.bottom - cardHeight))
  card.style.left = left + 'px'
  card.style.top = top + 'px'
}

function applyTaskDetailIdentity(card: HTMLElement, taskInfo: any) {
  var name = String(taskInfo && taskInfo.name || '任务详情')
  var categoryText = formatTaskCategory(taskInfo && taskInfo.category)
  var createdText = formatTaskCreatedAt(taskInfo && taskInfo.created_at)
  var platformText = formatTaskPlatforms(taskInfo && taskInfo.platforms)
  var avatar = card.querySelector('.task-detail-avatar') as HTMLElement | null
  var nameEl = card.querySelector('.task-detail-name') as HTMLElement | null
  var metaEl = card.querySelector('.task-detail-meta') as HTMLElement | null
  if (avatar) avatar.textContent = name ? name.charAt(0) : '—'
  if (nameEl) nameEl.textContent = name
  if (metaEl) {
    metaEl.textContent = [categoryText, createdText ? ('创建于 ' + createdText) : '', platformText].filter(Boolean).join(' · ')
  }
}

function renderTaskDetailLoading(row: HTMLElement, taskId: string) {
  var card = ensureTaskDetailCard()
  applyTaskDetailIdentity(card, getTaskRowFallback(row, taskId))
  var metrics = card.querySelector('.task-detail-metrics') as HTMLElement | null
  var spark = card.querySelector('.task-detail-spark') as HTMLCanvasElement | null
  var caption = card.querySelector('.task-detail-caption') as HTMLElement | null
  if (metrics) metrics.innerHTML = '<div style="padding:12px 0;width:100%;text-align:center;color:var(--color-text-2);font-size:12px;">加载中...</div>'
  if (spark) spark.style.display = 'none'
  if (caption) caption.textContent = ''
  positionTaskDetailCard(card, row)
  card.classList.add('visible')
}

function renderTaskDetailError(row: HTMLElement, taskId: string) {
  var card = ensureTaskDetailCard()
  applyTaskDetailIdentity(card, getTaskRowFallback(row, taskId))
  var metrics = card.querySelector('.task-detail-metrics') as HTMLElement | null
  var spark = card.querySelector('.task-detail-spark') as HTMLCanvasElement | null
  var caption = card.querySelector('.task-detail-caption') as HTMLElement | null
  if (metrics) metrics.innerHTML = '<div style="padding:12px 0;width:100%;text-align:center;color:var(--color-text-2);font-size:12px;">加载失败</div>'
  if (spark) spark.style.display = 'none'
  if (caption) caption.textContent = ''
  positionTaskDetailCard(card, row)
  card.classList.add('visible')
}

function renderTaskDetailSummary(row: HTMLElement, data: TaskWeekSummary) {
  var card = ensureTaskDetailCard()
  applyTaskDetailIdentity(card, data.task_info || getTaskRowFallback(row, String(data.task_info && data.task_info.id || '')))
  var metrics = card.querySelector('.task-detail-metrics') as HTMLElement | null
  var spark = card.querySelector('.task-detail-spark') as HTMLCanvasElement | null
  var caption = card.querySelector('.task-detail-caption') as HTMLElement | null
  if (metrics) {
    metrics.innerHTML =
      '<div class="metric"><span class="v">' + formatTaskMetricValue(num(data.summary && data.summary.success_count)) + '</span><span class="k">完成</span></div>' +
      '<div class="metric"><span class="v">' + formatTaskMetricValue(num(data.summary && data.summary.total_credits)) + '</span><span class="k">算力豆</span></div>' +
      '<div class="metric"><span class="v">' + formatTaskRuntimeHours(data.summary && data.summary.runtime_h) + '</span><span class="k">时长</span></div>' +
      '<div class="metric"><span class="v">' + formatTaskMetricValue(num(data.summary && data.summary.reach)) + '</span><span class="k">触达</span></div>'
  }
  if (spark) spark.style.display = ''
  if (caption) caption.textContent = '近 7 天完成数趋势'
  positionTaskDetailCard(card, row)
  card.classList.add('visible')
  if (spark) {
    requestAnimationFrame(function() {
      if (taskDetailRow !== row || taskDetailRowId !== String(data.task_info && data.task_info.id || '')) return
      drawSparkline(spark, Array.isArray(data.success) ? data.success : [], '#2563eb')
    })
  }
}

function hideTaskDetailCard() {
  taskDetailRow = null
  taskDetailRowId = ''
  if (taskDetailCardEl) taskDetailCardEl.classList.remove('visible')
}

function loadTaskWeekSummary(taskId: string): Promise<TaskWeekSummary> {
  if (taskDetailCache[taskId]) return Promise.resolve(taskDetailCache[taskId])
  if (taskDetailPending[taskId]) return taskDetailPending[taskId]
  var pending = fetchTaskWeekSummary(taskId).then(function(data) {
    taskDetailCache[taskId] = data
    delete taskDetailPending[taskId]
    delete taskDetailErrorCache[taskId]
    return data
  }).catch(function(err) {
    delete taskDetailPending[taskId]
    taskDetailErrorCache[taskId] = true
    throw err
  })
  taskDetailPending[taskId] = pending
  return pending
}

function toggleTaskDetailCard(row: HTMLElement) {
  var taskId = String(row.getAttribute('data-task-id') || '').trim()
  if (!taskId) return
  if (taskDetailRow === row && taskDetailRowId === taskId && taskDetailCardEl && taskDetailCardEl.classList.contains('visible')) {
    hideTaskDetailCard()
    return
  }
  taskDetailRow = row
  taskDetailRowId = taskId
  if (taskDetailCache[taskId]) {
    renderTaskDetailSummary(row, taskDetailCache[taskId])
    return
  }
  if (taskDetailErrorCache[taskId]) {
    renderTaskDetailError(row, taskId)
    return
  }
  renderTaskDetailLoading(row, taskId)
  loadTaskWeekSummary(taskId).then(function(data) {
    if (taskDetailRow !== row || taskDetailRowId !== taskId) return
    renderTaskDetailSummary(row, data)
  }).catch(function() {
    if (taskDetailRow !== row || taskDetailRowId !== taskId) return
    renderTaskDetailError(row, taskId)
  })
}

function bindTaskDetailCard(container: HTMLElement) {
  var boundContainer = container as HTMLElement & { __taskDetailBound?: boolean }
  if (boundContainer.__taskDetailBound) return
  boundContainer.__taskDetailBound = true
  container.addEventListener('click', function(e: Event) {
    var target = e.target as HTMLElement | null
    if (!target) return
    var row = target.closest('tr[data-task-id]') as HTMLElement | null
    if (!row || !container.contains(row)) return
    toggleTaskDetailCard(row)
  })
}

function escapeSkillText(value: any): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getSkillNameTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  return target.closest('.td-skill-name') as HTMLElement | null
}

function clearSkillNameTipTimer(): void {
  if (skillNameTipTimer == null) return
  window.clearTimeout(skillNameTipTimer)
  skillNameTipTimer = null
}

function ensureSkillNameTip(): HTMLElement {
  clearSkillNameTipTimer()
  if (skillNameTipEl) return skillNameTipEl
  skillNameTipEl = document.createElement('div')
  skillNameTipEl.className = 'skill-name-tip'
  document.body.appendChild(skillNameTipEl)
  return skillNameTipEl
}

function updateSkillNameTipPosition(e: MouseEvent): void {
  if (!skillNameTipEl) return
  var bounds = getContentClampBounds()
  var left = e.clientX + 12
  var maxLeft = Math.max(bounds.left, bounds.right - skillNameTipEl.offsetWidth)
  if (left > maxLeft) left = maxLeft
  if (left < bounds.left) left = bounds.left
  var top = e.clientY - 40
  var maxTop = Math.max(bounds.top, bounds.bottom - skillNameTipEl.offsetHeight)
  if (top > maxTop) top = maxTop
  if (top < bounds.top) top = bounds.top
  skillNameTipEl.style.top = top + 'px'
  skillNameTipEl.style.left = left + 'px'
}

function showSkillNameTip(text: string, e: MouseEvent): void {
  var tip = ensureSkillNameTip()
  tip.textContent = text
  updateSkillNameTipPosition(e)
  tip.classList.add('visible')
}

function hideSkillNameTip(): void {
  if (!skillNameTipEl) return
  clearSkillNameTipTimer()
  skillNameTipEl.classList.remove('visible')
  skillNameTipTimer = window.setTimeout(function() {
    if (!skillNameTipEl || skillNameTipEl.classList.contains('visible')) return
    skillNameTipEl.remove()
    skillNameTipEl = null
    skillNameTipTimer = null
  }, 160)
}

function bindSkillNamePopout(container: HTMLElement): void {
  var tipContainer = container as HTMLElement & { __tipBound?: boolean }
  if (tipContainer.__tipBound) return
  tipContainer.__tipBound = true
  window.addEventListener('scroll', function() { hideSkillNameTip() }, true)
  window.addEventListener('resize', function() { hideSkillNameTip() })
  if (!(window as any).__skillTipEscBound) {
    (window as any).__skillTipEscBound = true
    document.addEventListener('keydown', function(e: KeyboardEvent) {
      if (e.key === 'Escape' && skillNameTipEl && skillNameTipEl.classList.contains('visible')) hideSkillNameTip()
    })
  }

  container.addEventListener('mouseover', function(e: MouseEvent) {
    var target = getSkillNameTarget(e.target)
    if (!target || !container.contains(target)) return
    var full = target.getAttribute('data-full') || target.textContent || ''
    if (!full.trim()) return
    if (target.scrollWidth <= target.clientWidth) return
    showSkillNameTip(full, e)
  })

  container.addEventListener('mouseout', function(e: MouseEvent) {
    var target = getSkillNameTarget(e.target)
    if (!target || !container.contains(target)) return
    hideSkillNameTip()
  })

  container.addEventListener('mousemove', function(e: MouseEvent) {
    var target = getSkillNameTarget(e.target)
    if (!target || !container.contains(target)) return
    if (target.scrollWidth <= target.clientWidth) return
    updateSkillNameTipPosition(e)
  })
}

function syncSkillNameTruncation(container: HTMLElement): void {
  requestAnimationFrame(function() {
    container.querySelectorAll('.td-skill-name').forEach(function(node) {
      var name = node as HTMLElement
      var truncated = name.scrollWidth > name.clientWidth
      var cell = name.closest('.td-skill')
      if (truncated) {
        name.setAttribute('data-truncated', 'true')
        if (cell) cell.classList.add('is-truncated')
      } else {
        name.removeAttribute('data-truncated')
        if (cell) cell.classList.remove('is-truncated')
      }
    })
  })
}

function parseScenarioDuration(value: any) {
  if (typeof value === 'number') return value
  var text = String(value || '').trim()
  if (!text || text === '—') return 0
  if (/^\d+:\d{1,2}$/.test(text)) {
    var parts = text.split(':')
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0)
  }
  var hours = text.match(/(\d+(?:\.\d+)?)\s*h/i)
  var minutes = text.match(/(\d+(?:\.\d+)?)\s*m/i)
  if (hours || minutes) {
    return Math.round((parseFloat(hours && hours[1] || '0') || 0) * 60 + (parseFloat(minutes && minutes[1] || '0') || 0))
  }
  return num(text)
}

function getScenarioCredits(row: any) {
  return num(row && (row.credits ?? row.totalCredits ?? row.tokenAvg))
}

function getScenarioFavorites(row: any) {
  return num(row && (row.saves ?? row.favorites))
}

function getScenarioUniqueReach(row: any) {
  return num(row && (row.uniqueReach ?? row.reach))
}

function getScenarioGroupKey(group: any) {
  return String(group && (group.category_group ?? group.group ?? group.key ?? group.id ?? group.name) || '').toLowerCase()
}

function getScenarioGroupSuccessCount(group: any) {
  return num(group && (
    group.success_count ??
    (group.totals && group.totals.success_count)
  ))
}

function getScenarioGroupTotalCredits(group: any) {
  return num(group && (
    group.total_credits ??
    (group.totals && group.totals.total_credits)
  ))
}

function renderScenarioHeader(label: string, key?: string) {
  if (!key) return '<th>' + label + '</th>'
  var cls = sortState.col === key ? (sortState.dir === 'asc' ? 'th-sort-asc' : 'th-sort-desc') : ''
  return '<th class="th-sortable ' + cls + '" onclick="sortScenario(\'' + key + '\')">' + label + '</th>'
}

function sortScenarioRows(rows) {
  if (!sortState.col) return rows;
  return rows.slice().sort(function(a, b) {
    var va;
    var vb;
    if (sortState.col === 'name' || sortState.col === 'id') {
      va = String(a.skillName || a.skill || '').toLowerCase();
      vb = String(b.skillName || b.skill || '').toLowerCase();
    } else if (sortState.col === 'success') {
      va = num(a.success);
      vb = num(b.success);
    } else if (sortState.col === 'credits') {
      va = getScenarioCredits(a);
      vb = getScenarioCredits(b);
    } else if (sortState.col === 'duration') {
      va = num(a.durationSec ?? parseScenarioDuration(a.avgDur));
      vb = num(b.durationSec ?? parseScenarioDuration(b.avgDur));
    } else if (sortState.col === 'comments') {
      va = num(a.comments)
      vb = num(b.comments)
    } else if (sortState.col === 'likes') {
      va = num(a.likes)
      vb = num(b.likes)
    } else if (sortState.col === 'favorites') {
      va = getScenarioFavorites(a)
      vb = getScenarioFavorites(b)
    } else if (sortState.col === 'dms') {
      va = num(a.dms)
      vb = num(b.dms)
    } else if (sortState.col === 'uniqueReach') {
      va = getScenarioUniqueReach(a)
      vb = getScenarioUniqueReach(b)
    } else {
      va = '';
      vb = '';
    }
    if (va === vb) return 0;
    if (sortState.dir === 'asc') return va > vb ? 1 : -1;
    return va < vb ? 1 : -1;
  });
}

export function renderScenarioCards() {
  var container = document.getElementById('scenarioCards');
  if (!container) return;
  hideTaskDetailCard()
  var enabled = scenarioGroups.filter(g => enabledScenarios.includes(g.id));
  if (!enabled.length) { container.innerHTML = '<div style="padding:20px;text-align:center;color:#a1a1aa;font-size:12px;">暂无场景数据</div>'; return; }

  container.innerHTML = enabled.map(g => {
    var rows = skillData[g.id] || [];
    rows = rows.filter(r => r.success > 0);
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      rows = rows.filter(function(r) { return r.skill.toLowerCase().indexOf(q) !== -1 || r.skillName.toLowerCase().indexOf(q) !== -1 || (r.description || '').toLowerCase().indexOf(q) !== -1; });
    }
    rows = sortScenarioRows(rows);
    var totalSuccess = getScenarioGroupSuccessCount(g);

    var extraCols = g.extraCols || [];
    var slimCols = ['单次任务', '完成', '算力豆', '时长 (h:m)'].concat(extraCols);
    var headHtml = slimCols.map((c, i) => {
      if (i === 0) return renderScenarioHeader('单次任务', 'name');
      if (i === 1) return renderScenarioHeader('完成', 'success');
      if (i === 2) return renderScenarioHeader('算力豆', 'credits');
      if (i === 3) return renderScenarioHeader('时长 (h:m)', 'duration');
      return renderScenarioHeader(c, scenarioInteractionSortKeys[i - 4]);
    }).join('');

    var bodyHtml = rows.map(r => {
      var extraVals = g.extraFn ? g.extraFn(r) : extraCols.map(() => 0);
      var skillName = escapeSkillText(r.skillName);
      var taskIdAttr = r.taskId ? ` data-task-id="${escapeSkillText(r.taskId)}"` : ''
      var taskNameAttr = ` data-task-name="${skillName}"`
      var taskGroupAttr = ` data-task-group="${escapeSkillText(r.taskGroup || g.id)}"`
      var html = `<td class="td-skill" data-desc="${(r.description || '').replace(/"/g, '&quot;')}"><span class="td-bold">${r.skill}</span> <span class="td-skill-name" data-full="${skillName}">${skillName}</span><span class="td-skill-chevron">▸</span></td>`;
      html += `<td class="td-mono">${r.success}</td>`;
      html += `<td class="td-mono">${getScenarioCredits(r)}</td>`;
      html += `<td class="td-mono">${r.avgDur || '—'}</td>`;
      html += extraVals.map(v => '<td class="td-mono">' + (v > 0 ? v.toLocaleString() : '<span class="text-na">暂无</span>') + '</td>').join('');
      return `<tr${taskIdAttr}${taskNameAttr}${taskGroupAttr}>${html}</tr>`;
    }).join('');

    return `<div class="scenario-card" id="sc-${g.id}">
      <div class="scenario-card-header" onclick="toggleScenario('${g.id}')">
        <div class="scenario-card-title"><span class="scenario-icon">${g.icon}</span>${g.name}</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="scenario-card-metrics">
            <span>技能数: <strong>${rows.length}</strong></span>
            <span>完成: <strong>${totalSuccess}</strong></span>
            <span>算力豆: <strong>${getScenarioGroupTotalCredits(g)}</strong></span>
          </div>
          <span class="scenario-chevron open" id="chev-${g.id}">▾</span>
        </div>
      </div>
      <div class="scenario-card-body" id="body-${g.id}">
        <div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>
      </div>
    </div>`;
  }).join('');

  bindSkillNamePopout(container)
  bindTaskDetailCard(container)
  syncSkillNameTruncation(container)
}

export function renderScenarioCardsFull(containerId?: string, idPrefix?: string) {
  var actualContainerId = containerId || 'scenarioCardsFull';
  var prefix = idPrefix || 'bodyf';
  var togglePrefix = prefix === 'bodyf' ? '' : prefix.replace(/^bodyf-?/, '') + '-';
  var chevPrefix = prefix === 'bodyf' ? 'chevf' : 'chevf-' + prefix.replace(/^bodyf-?/, '');
  var container = document.getElementById(actualContainerId);
  if (!container) return;
  hideTaskDetailCard()
  container.innerHTML = scenarioGroups.map(function(g) {
    var rows = skillData[g.id] || [];
    rows = rows.filter(r => r.success > 0);
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      rows = rows.filter(function(r) { return r.skill.toLowerCase().indexOf(q) !== -1 || r.skillName.toLowerCase().indexOf(q) !== -1 || (r.description || '').toLowerCase().indexOf(q) !== -1; });
    }
    rows = sortScenarioRows(rows);
    if (!rows.length) return '';
    var totalSuccess = getScenarioGroupSuccessCount(g);
    var commonCols = ['单次任务', '完成', '算力豆', '时长 (h:m)'];
    var allCols = commonCols.concat(g.extraCols || []);
    var headHtml = allCols.map(function(c, i){
      if (i === 0) return renderScenarioHeader('单次任务', 'name')
      if (i === 1) return renderScenarioHeader('完成', 'success')
      if (i === 2) return renderScenarioHeader('算力豆', 'credits')
      if (i === 3) return renderScenarioHeader('时长 (h:m)', 'duration')
      return renderScenarioHeader(c, scenarioInteractionSortKeys[i - 4])
    }).join('');
    var bodyHtml = rows.map(function(r) {
      var extraVals = g.extraFn ? g.extraFn(r) : (g.extraCols||[]).map(function(){ return 0; });
      var skillName = escapeSkillText(r.skillName);
      var taskIdAttr = r.taskId ? ' data-task-id="' + escapeSkillText(r.taskId) + '"' : ''
      var taskNameAttr = ' data-task-name="' + skillName + '"'
      var taskGroupAttr = ' data-task-group="' + escapeSkillText(r.taskGroup || g.id) + '"'
      var html = '<td class="td-skill" data-desc="'+(r.description || '').replace(/"/g, '&quot;')+'"><span class="td-bold">'+r.skill+'</span> <span class="td-skill-name" data-full="'+skillName+'">'+skillName+'</span><span class="td-skill-chevron">▸</span></td>' +
        '<td class="td-mono">'+r.success+'</td>' +
        '<td class="td-mono">'+getScenarioCredits(r)+'</td>' +
        '<td class="td-mono">'+(r.avgDur || '—')+'</td>';
      html += extraVals.map(function(v){ return '<td class="td-mono">' + (v > 0 ? v.toLocaleString() : '<span class="text-na">暂无</span>') + '</td>'; }).join('');
      return '<tr'+taskIdAttr+taskNameAttr+taskGroupAttr+'>'+html+'</tr>';
    }).join('');
    return '<div class="scenario-card">' +
      '<div class="scenario-card-header" onclick="toggleScenarioFull(\''+togglePrefix+g.id+'\')">' +
        '<div class="scenario-card-title"><span class="scenario-icon">'+g.icon+'</span>'+g.name+'</div>' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
          '<div class="scenario-card-metrics"><span>技能数: <strong>'+rows.length+'</strong></span><span>完成: <strong>'+totalSuccess+'</strong></span><span>算力豆: <strong>'+getScenarioGroupTotalCredits(g)+'</strong></span></div>' +
          '<span class="scenario-chevron open" id="'+chevPrefix+'-'+g.id+'">&#9662;</span>' +
        '</div>' +
      '</div>' +
      '<div class="scenario-card-body" id="'+prefix+'-'+g.id+'">' +
        '<div class="table-wrap" style="overflow-x:auto;"><table><thead><tr>'+headHtml+'</tr></thead><tbody>'+bodyHtml+'</tbody></table></div>' +
      '</div>' +
    '</div>';
  }).join('');
  if (!container.innerHTML.trim()) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#a1a1aa;font-size:12px;">暂无场景数据</div>';
  }

  bindSkillNamePopout(container)
  bindTaskDetailCard(container)
  syncSkillNameTruncation(container)
}

export function sortScenario(col: string) {
  if (sortState.col === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  else {
    sortState.col = col;
    sortState.dir = 'asc';
  }
  renderScenarioCards();
  renderScenarioCardsFull();
}

export function searchScenario(query: string) {
  searchQuery = query;
  renderScenarioCards();
  renderScenarioCardsFull();
}

export function toggleScenarioFull(id) {
  smoothToggleCollapse(document.getElementById('bodyf-'+id), document.getElementById('chevf-'+id));
}

export function toggleScenario(id) {
  smoothToggleCollapse(document.getElementById('body-'+id), document.getElementById('chev-'+id));
}

export function initScenarioDropdown() {
  var el = document.getElementById('scenarioDropdown');
  el.innerHTML = `<div class="scenario-config-dropdown-inner"><div class="toggle-grid">${
    scenarioGroups.map(g => {
      var on = enabledScenarios.includes(g.id);
      return `<button class="toggle-chip ${on?'on':''}" onclick="flipScenario('${g.id}',this)"><span class="chip-check">✓</span>${g.icon} ${g.name}</button>`;
    }).join('')
  }</div></div>`;
}

export function flipScenario(id, btn) {
  var idx = enabledScenarios.indexOf(id);
  if (idx >= 0) enabledScenarios.splice(idx, 1);
  else enabledScenarios.push(id);
  btn.classList.toggle('on');
  renderScenarioCards();
}

export function exportScenarioCSV() {
  var headers = ['单次任务', '指令名称', '完成', '算力豆', '时长 (h:m)', '评论', '点赞', '收藏', '私信', '触达量'];
  var rows = [];
  scenarioGroups.forEach(function(g) {
    var data = skillData[g.id];
    if (!data) return;
    data.forEach(function(r) {
      rows.push([r.skill, r.skillName, r.success, getScenarioCredits(r), r.avgDur || '—', r.comments || 0, r.likes || 0, getScenarioFavorites(r), r.dms || 0, r.uniqueReach || 0]);
    });
  });
  downloadCSV('任务完成_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

if (typeof window !== 'undefined') {
  Object.assign(window, { sortScenario, searchScenario });
}

function num(value: any) {
  var parsed = typeof value === 'number' ? value : parseFloat(String(value || '').replace(/[^\d.-]/g, ''))
  return isNaN(parsed) ? 0 : parsed
}

function groupMeta(group: any) {
  var rawId = getScenarioGroupKey(group) || 'acquire'
  if (rawId.indexOf('other') >= 0 || rawId.indexOf('其他') >= 0) {
    return {
      key: 'other',
      id: 'other',
      icon: group.icon || '📦',
      name: group.name || '其他',
      extraCols: [],
      extraFn: function() { return [] },
    }
  }
  if (rawId.indexOf('research') >= 0 || rawId.indexOf('调研') >= 0) {
    return {
      id: 'research',
      icon: group.icon || '🔎',
      name: group.name || '内容调研',
      extraCols: ['采集量', '点赞', '收藏', '私信', '触达量'],
      extraFn: function(row) { return [row.comments, row.likes, row.favorites, row.dms, row.uniqueReach] },
    }
  }
  if (rawId.indexOf('ops') >= 0 || rawId.indexOf('运维') >= 0 || rawId.indexOf('运营') >= 0) {
    return {
      id: 'ops',
      icon: group.icon || '🛠️',
      name: group.name || '运营维护',
      extraCols: ['处理量', '点赞', '收藏', '私信', '触达量'],
      extraFn: function(row) { return [row.comments, row.likes, row.favorites, row.dms, row.uniqueReach] },
    }
  }
  return {
    id: 'acquire',
    icon: group.icon || '🎯',
    name: group.name || '获客触达',
    extraCols: ['评论', '点赞', '收藏', '私信', '触达量'],
    extraFn: function(row) { return [row.comments, row.likes, row.favorites, row.dms, row.uniqueReach] },
  }
}

function getGroupItems(group: any) {
  var items = group && (group.items || group.skills || [])
  return Array.isArray(items) ? items : []
}

function mapSkillItems(items: any[], meta: any) {
  return items.map(function(item, index) {
    var success = num(item.success_count)
    var credits = num(item.total_credits)
    var durationSec = Math.round(num(item.runtime_h) * 3600)
    var taskId = item.skill_id ?? item.task_id ?? item.id ?? ''
    var skillLabel = String(item.skill_name ?? item.task_name ?? item.name ?? item.label ?? 'task').trim() || 'task'
    var skillFallback = skillLabel.replace(/\s+/g, '-').slice(0, 12) + '-' + (index + 1)
    return {
      taskId: taskId != null && taskId !== '' ? String(taskId) : '',
      taskGroup: item.task_group || meta.id,
      skill: item.skillCode || item.skill_code || item.skill || item.key || (taskId ? ('S' + taskId) : skillFallback),
      skillName: item.skillName || item.skill_name || item.name || item.label || '未命名指令',
      description: item.description || '',
      exec: num(item.exec ?? item.executions ?? item.total_executions ?? success),
      success: success,
      fail: num(item.fail ?? item.fail_count),
      avgDur: fmtHM(durationSec),
      durationSec: durationSec,
      credits: credits,
      totalCredits: credits,
      comments: num(item.comments ?? item.collected ?? item.records),
      likes: num(item.likes ?? item.opens),
      saves: num(item.saves ?? item.favorites ?? item.bookmarks),
      favorites: num(item.favorites ?? item.saves ?? item.bookmarks),
      dms: num(item.dms ?? item.private_messages ?? item.leads),
      profileViews: num(item.profileViews ?? item.profile_views),
      uniqueReach: num(item.reach),
    }
  })
}

export function renderSkillGroupsFromAggs(groups: any[]) {
  var sourceGroups = Array.isArray(groups) ? groups.slice() : []
  if (!sourceGroups.length) {
    scenarioGroups.length = 0
    enabledScenarios.length = 0
    Object.keys(skillData).forEach(function(key) { delete skillData[key] })
    hideTaskDetailCard()
    var container = document.getElementById('scenarioCards')
    if (container) container.innerHTML = ''
    var fullContainer = document.getElementById('scenarioCardsFull')
    if (fullContainer) fullContainer.innerHTML = ''
    return
  }

  var acquireGroup = sourceGroups.find(function(group) {
    return getScenarioGroupKey(group) === 'acquire'
  })
  var acquireSkills = getGroupItems(acquireGroup)

  var researchItems = sourceGroups.reduce(function(items, group) {
    if (getScenarioGroupKey(group) === 'research') {
      items.push.apply(items, getGroupItems(group))
    }
    return items
  }, [])
  var opsItems = sourceGroups.reduce(function(items, group) {
    if (getScenarioGroupKey(group) === 'ops') {
      items.push.apply(items, getGroupItems(group))
    }
    return items
  }, [])
  var otherItems = researchItems.concat(opsItems)
  var otherGroup = otherItems.length ? {
    key: 'other',
    id: 'other',
    name: '其他',
    icon: '📦',
    items: otherItems,
  } : null

  if (acquireSkills.length === 0 && !otherGroup) return

  scenarioGroups.length = 0
  enabledScenarios.length = 0
  Object.keys(skillData).forEach(function(key) { delete skillData[key] })

  ;[acquireGroup, otherGroup].forEach(function(group) {
    if (!group) return
    var meta = groupMeta(group)
    var items = getGroupItems(group)
    if (!items.length) return
    scenarioGroups.push({
      id: meta.id,
      icon: meta.icon,
      name: meta.name,
      color: group.color || '#6366f1',
      extraCols: meta.extraCols,
      extraFn: meta.extraFn,
      success_count: getScenarioGroupSuccessCount(group),
      total_credits: getScenarioGroupTotalCredits(group),
    })
    enabledScenarios.push(meta.id)
    skillData[meta.id] = mapSkillItems(items, meta)
  })

  renderScenarioCards()
  renderScenarioCardsFull()
}

import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

import './styles/index.css'
import './styles/transitions.css'

// Module imports
import { createCharts, ensureOpsCharts, updateCharts, renderHighlightCards, createDonutChart, createInteractionDonut, setCurrentRange, exportTrendCSV, exportTrendPNG, bindHighlightReflow } from './modules/charts'
import { switchPage, switchDashTab, switchEnterpriseTab, switchEntCard, switchOpsView } from './modules/navigation'
import { setRange, openDatePickerModal, setDatePreset, applyCustomRange, renderCalendar, calSelectDate, calPreset, calPrevMonth, calNextMonth, calApply } from './modules/date-range'
import { renderScenarioCards, renderScenarioCardsFull, toggleScenario, toggleScenarioFull, initScenarioDropdown, flipScenario, exportScenarioCSV, sortScenario, searchScenario, renderSkillGroupsFromAggs } from './modules/scenarios'
import { renderDeviceMonitor, toggleDeviceSection, updateDeviceBadge, renderDeviceMetricsTable, searchDevice, exportDeviceCSV, renderDevicesFromAggs } from './modules/devices'
import { renderAchievements, tiltAchieve, resetAchieve } from './modules/achievements'
import { switchRecordTab, renderTransactions, renderOplog, changePageSize, goPage, exportTransactions, exportOplog, paginationState, renderRecordTab, sortTransactions, sortOplog } from './modules/records'
import { openDrawer, closeDrawer, switchDrawerTab } from './modules/drawer'
import { openModal, closeModal, showToast } from './modules/modal-toast'
import { renderMembers, openAddMemberModal, addMember, openManageMemberModal, saveManageMember, confirmRemoveMember, removeMember, toggleMemberSelect, toggleSelectAllMembers, cancelBatchSelect, openBatchDistributeModal, confirmBatchDistribute, confirmBatchRemove, executeBatchRemove, sortMembers } from './modules/members'
import { openDistributeToMember, openDistributeModal, confirmDistribute, renderOverviewOplog } from './modules/wallet'
import { initROICard, generateReport, closeReportPreview, saveReportImage, switchReportDim, renderROIPlatformCard, renderRoiFromCharts } from './modules/reports'
import { renderAccountMetricsTable, searchAccount, exportAccountCSV, renderAccountsFromAggs } from './modules/accounts'
import { initCustomDropdowns } from './modules/dropdown'
import { hideLoader } from './modules/loader'
import { pTag, initFilters, renderTaskTable, animateAllNumbers, getToday, getStatNum, setStatNum, prependTransaction, formatCompareText } from './modules/utils'
import { tryLiveMembers, tryLiveWallet, tryLiveTransactions, tryLiveOpsData, populateMemberFilter, fetchDashboardData, applyBetaOverlays } from './modules/api-integration'
import { PLATFORM_BREAKDOWN } from './data/platforms'
import { INTERACTION_BREAKDOWN } from './data/charts'

function setText(id: string, value: string) {
  var el = document.getElementById(id)
  if (el) el.textContent = value
}

function parseMetricValue(val: any): number | null {
  if (val == null || val === '') return null
  if (typeof val === 'number') return isNaN(val) ? null : val
  var parsed = parseFloat(String(val).replace(/[^\d.-]/g, ''))
  return isNaN(parsed) ? null : parsed
}

function parseHours(val: any, fieldName?: string): number | null {
  var parsed = parseMetricValue(val)
  if (parsed == null) return null
  return fieldName && /_sec$/.test(fieldName) ? parsed / 3600 : parsed
}

function pickMetricValue(sources: Array<[string, any]>): number | null {
  for (var i = 0; i < sources.length; i++) {
    var parsed = parseMetricValue(sources[i][1])
    if (parsed != null) return parsed
  }
  return null
}

function pickHoursValue(sources: Array<[string, any]>): number | null {
  for (var i = 0; i < sources.length; i++) {
    var parsed = parseHours(sources[i][1], sources[i][0])
    if (parsed != null) return parsed
  }
  return null
}

function pickHighlightExecValue(highlights: any): number | null {
  var cards = Array.isArray(highlights)
    ? highlights
    : (highlights && Array.isArray(highlights.cards) ? highlights.cards : [])
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i]
    var key = String(card && card.key != null ? card.key : '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (key === 'complete' || key === 'success' || key === 'successcount') {
      return parseMetricValue(card && card.value)
    }
  }
  return null
}

function applyMiniStats(mini: any, range?: string, highlights?: any) {
  if (!mini) return
  var exec = mini.exec ?? mini.executions ?? mini.total_executions ?? 0
  var execHighlightValue = pickHighlightExecValue(highlights)
  var runtimeRaw = mini.runtime ?? mini.total_duration ?? mini.total_duration_hours ?? '0h'
  var runtime = typeof runtimeRaw === 'number' ? Math.round(runtimeRaw) + 'h' : String(runtimeRaw)
  var cost = mini.cost ?? mini.credits ?? mini.total_credits ?? 0
  var execCur = pickMetricValue([
    ['exec_raw', mini.exec_raw],
    ['exec', mini.exec],
    ['executions', mini.executions],
    ['total_executions', mini.total_executions],
  ])
  var execPrev = pickMetricValue([
    ['exec_prev', mini.exec_prev],
  ])
  var runtimeCurHours = pickHoursValue([
    ['runtime_raw', mini.runtime_raw],
    ['total_duration_hours', mini.total_duration_hours],
    ['runtime_sec', mini.runtime_sec],
    ['total_duration', mini.total_duration],
    ['runtime', mini.runtime],
  ])
  var runtimePrevHours = pickHoursValue([
    ['runtime_prev', mini.runtime_prev],
    ['runtime_prev_sec', mini.runtime_prev_sec],
  ])
  var costCur = pickMetricValue([
    ['cost_raw', mini.cost_raw],
    ['credits', mini.credits],
    ['total_credits', mini.total_credits],
    ['cost', mini.cost],
  ])
  var costPrev = pickMetricValue([
    ['cost_prev', mini.cost_prev],
  ])
  // sidebar mini stats
  setText('miniExec', String(execHighlightValue != null ? execHighlightValue : exec))
  setText('miniRuntime', runtime)
  setText('miniCost', String(cost))
  // dashTab-ops stats card
  setText('statExec', String(exec))
  setText('statRuntime', runtime)
  setText('statCost', String(cost))
  renderStatChange('statExecChange', execCur ?? 0, execPrev, range)
  renderStatChange('statRuntimeChange', runtimeCurHours ?? 0, runtimePrevHours, range)
  renderStatChange('statCostChange', costCur ?? 0, costPrev, range)
}

function getCompareLabelForRange(range?: string): string {
  if (range === 'today') return '较昨日'
  if (range === '7d') return '较上周'
  if (range === '30d') return '较上月'
  if (range === 'custom') return '较上期'
  return '环比'
}

function renderStatChange(id: string, cur: number, prev: number | null | undefined, range?: string) {
  var el = document.getElementById(id)
  if (!el) return
  var label = getCompareLabelForRange(range)
  var compare = formatCompareText(cur, prev, label)
  el.classList.remove('up', 'down', 'flat')
  el.classList.add(compare.cls)
  if (compare.cls === 'flat') {
    el.innerHTML = '<span class="stat-sub">' + compare.text + '</span>'
    return
  }
  el.textContent = compare.text
}

async function bootDashboardSnapshot(range = '7d', custom?: { start: string; end: string }) {
  var currentRange = range
  var snap = await fetchDashboardData(range, custom)
  renderHighlightCards(snap.highlights.cards, range)
  renderAchievements(snap.achievements.achievements)
  if (snap.charts?.mini_stats) applyMiniStats(snap.charts.mini_stats, range, snap.highlights)
  if (snap.charts?.platform_breakdown) {
    PLATFORM_BREAKDOWN[range] = snap.charts.platform_breakdown
    createDonutChart(range)
  }
  if (snap.charts?.interaction_breakdown) {
    INTERACTION_BREAKDOWN[range] = snap.charts.interaction_breakdown
    createInteractionDonut(range)
  }
  if (snap.aggs?.accounts) renderAccountsFromAggs(snap.aggs.accounts, snap.aggs.account_totals)
  if (snap.aggs?.skill_groups) {
    renderSkillGroupsFromAggs(snap.aggs.skill_groups)
  }
  if (snap.aggs?.devices) renderDevicesFromAggs(snap.aggs.devices, snap.aggs.device_heat)
  if (snap.charts?.roi) renderRoiFromCharts(snap.charts.roi)
  applyBetaOverlays()
  var opsData = await tryLiveOpsData(currentRange, custom)
  if (opsData) updateCharts(currentRange, opsData)
}

// Expose all functions to window for inline onclick handlers
Object.assign(window, {
  switchPage, switchDashTab, switchEnterpriseTab, switchEntCard, switchOpsView,
  setRange, openDatePickerModal, setDatePreset, applyCustomRange, renderCalendar, calSelectDate, calPreset, calPrevMonth, calNextMonth, calApply,
  renderScenarioCards, renderScenarioCardsFull, toggleScenario, toggleScenarioFull, initScenarioDropdown, flipScenario, exportScenarioCSV, sortScenario, searchScenario,
  renderDeviceMonitor, toggleDeviceSection, updateDeviceBadge, renderDeviceMetricsTable, searchDevice, exportDeviceCSV,
  renderAchievements, tiltAchieve, resetAchieve,
  createCharts, ensureOpsCharts, updateCharts, renderHighlightCards, createDonutChart, createInteractionDonut, setCurrentRange, exportTrendCSV, exportTrendPNG,
  switchRecordTab, renderTransactions, renderOplog, changePageSize, goPage, exportTransactions, exportOplog, paginationState, renderRecordTab, sortTransactions, sortOplog,
  openDrawer, closeDrawer, switchDrawerTab,
  openModal, closeModal, showToast,
  renderMembers, openAddMemberModal, addMember, openManageMemberModal, saveManageMember, confirmRemoveMember, removeMember, toggleMemberSelect, toggleSelectAllMembers, cancelBatchSelect, openBatchDistributeModal, confirmBatchDistribute, confirmBatchRemove, executeBatchRemove, sortMembers,
  openDistributeToMember, openDistributeModal, confirmDistribute, renderOverviewOplog,
  generateReport, closeReportPreview, saveReportImage, switchReportDim, renderROIPlatformCard,
  renderAccountMetricsTable, searchAccount, exportAccountCSV,
  pTag, initFilters, renderTaskTable, animateAllNumbers, getToday, getStatNum, setStatNum, prependTransaction,
  bootDashboardSnapshot,
})

// Escape key handler
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeDrawer(); closeReportPreview(); }
})

// Init
document.addEventListener('DOMContentLoaded', async function() {
  var initialRange = '7d'
  initROICard();
  renderROIPlatformCard();
  createCharts();
  if (document.getElementById('scenarioDropdown')) initScenarioDropdown();
  if (document.getElementById('scenarioCards')) renderScenarioCards();
  renderDeviceMonitor();
  renderAccountMetricsTable();
  updateDeviceBadge();
  initFilters();
  renderTransactions(1, 20);
  renderOplog(1, 20);
  renderMembers();
  var memberSearch = document.getElementById('entMemberSearch');
  if (memberSearch) {
    memberSearch.addEventListener('input', function() { renderMembers((this as HTMLInputElement).value); });
  }
  initCustomDropdowns();

  // Preloader: await all live data before revealing content
  await Promise.allSettled([
    bootDashboardSnapshot(initialRange),
    tryLiveMembers(),
    tryLiveWallet(),
    tryLiveTransactions(),
    renderTaskTable(),
  ]);

  bindHighlightReflow();

  // Populate member filter dropdown with live data
  populateMemberFilter();

  hideLoader();
  animateAllNumbers();
})

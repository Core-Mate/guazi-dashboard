import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

import './styles/index.css'
import './styles/transitions.css'

// Module imports
import { createCharts, ensureOpsCharts, updateCharts, renderHighlightCards, createDonutChart, createInteractionDonut, setCurrentRange, exportTrendCSV, exportTrendPNG, exportRidgelineCSV, exportRidgelinePNG, exportOpsCSV, exportOpsPNG, bindHighlightReflow } from './modules/charts'
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
import { showLoader, hideLoader } from './modules/loader'
import { bindRidgelineToggle, refreshRidgeline } from './modules/ridgeline-bind'
import { pTag, initFilters, renderTaskTable, animateAllNumbers, getToday, getStatNum, setStatNum, prependTransaction, formatCompareText } from './modules/utils'
import { tryLiveMembers, tryLiveWallet, tryLiveTransactions, populateMemberFilter, fetchDashboardData, applyBetaOverlays, clearDashboardSnapshotCache } from './modules/api-integration'
import { PLATFORM_BREAKDOWN } from './data/platforms'
import { INTERACTION_BREAKDOWN } from './data/charts'

type DashboardCustomRange = { start: string; end: string } | undefined

type DashboardRefreshOptions = {
  includeAncillary?: boolean
}

var dashboardViewState: { range: string; custom?: DashboardCustomRange } = {
  range: '7d',
  custom: undefined,
}

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

function pickHighlightMetricValue(highlights: any, keys: string[], fieldName: string = 'value'): number | null {
  var cards = Array.isArray(highlights)
    ? highlights
    : (highlights && Array.isArray(highlights.cards) ? highlights.cards : [])
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i]
    var key = String(card && card.key != null ? card.key : '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (keys.indexOf(key) >= 0) {
      return parseMetricValue(card && card[fieldName])
    }
  }
  return null
}

function applyMiniStats(mini: any, range?: string, highlights?: any) {
  if (!mini) return
  var successCur = pickMetricValue([
    ['success_count', mini.success_count],
  ])
  if (successCur == null) successCur = pickHighlightMetricValue(highlights, ['successcount'], 'value')
  var successPrev = pickMetricValue([
    ['success_count_prev', mini.success_count_prev],
  ])
  if (successPrev == null) successPrev = pickHighlightMetricValue(highlights, ['successcount'], 'prev')
  var runtimeCurHours = pickHoursValue([
    ['runtime_h', mini.runtime_h],
  ])
  var runtimePrevHours = pickHoursValue([
    ['runtime_h_prev', mini.runtime_h_prev],
  ])
  var runtime = (runtimeCurHours ?? 0).toFixed(1) + 'h'
  var totalCredits = pickMetricValue([
    ['total_credits', mini.total_credits],
  ]) ?? 0
  var costCur = pickMetricValue([
    ['total_credits', mini.total_credits],
  ])
  var costPrev = pickMetricValue([
    ['total_credits_prev', mini.total_credits_prev],
  ])
  applyMiniStatsRow(String(successCur ?? 0), runtime, String(totalCredits))
  // dashTab-ops stats card
  setText('statExec', String(successCur ?? 0))
  setText('statRuntime', runtime)
  setText('statCost', String(totalCredits))
  renderStatChange('statExecChange', successCur ?? 0, successPrev, range)
  renderStatChange('statRuntimeChange', runtimeCurHours ?? 0, runtimePrevHours, range)
  renderStatChange('statCostChange', costCur ?? 0, costPrev, range)
}

function applyMiniStatsRow(exec: string, runtime: string, cost: string) {
  var miniExec = document.getElementById('miniExec')
  if (!miniExec) return
  var miniRuntime = document.getElementById('miniRuntime')
  if (!miniRuntime) return
  var miniCost = document.getElementById('miniCost')
  if (!miniCost) return
  miniExec.textContent = exec
  miniRuntime.textContent = runtime
  miniCost.textContent = cost
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

function snapshotOpsToChartData(snap: any) {
  var trend = snap && snap.ops_trend
  if (!trend) return null
  return {
    labels: Array.isArray(trend.labels) ? trend.labels : [],
    dates: Array.isArray(trend.dates) && trend.dates.length
      ? trend.dates
      : (Array.isArray(trend.labels) ? trend.labels : []),
    success: Array.isArray(trend.success) ? trend.success : [],
    failed: Array.isArray(trend.failed) ? trend.failed : [],
    total: Array.isArray(trend.total) ? trend.total : (Array.isArray(trend.exec) ? trend.exec : []),
    comments: Array.isArray(trend.comments) ? trend.comments : [],
    likes: Array.isArray(trend.likes) ? trend.likes : [],
    dms: Array.isArray(trend.dms) ? trend.dms : [],
    reach: Array.isArray(trend.reach) ? trend.reach : [],
    credits: Array.isArray(trend.credits) ? trend.credits : [],
    runtime: Array.isArray(trend.runtime_h) ? trend.runtime_h : [],
    saves: Array.isArray(trend.saves) ? trend.saves : [],
  }
}

function setDashboardViewState(range: string, custom?: DashboardCustomRange) {
  dashboardViewState.range = range || '7d'
  dashboardViewState.custom = dashboardViewState.range === 'custom' && custom && custom.start
    ? { start: custom.start, end: custom.end }
    : undefined
}

export async function refreshDashboard(
  range?: string,
  custom?: DashboardCustomRange,
  options?: DashboardRefreshOptions,
) {
  var targetRange = range || dashboardViewState.range || '7d'
  var targetCustom = targetRange === 'custom'
    ? (custom || dashboardViewState.custom)
    : undefined
  setDashboardViewState(targetRange, targetCustom)
  clearDashboardSnapshotCache(targetRange, targetCustom)
  var snap = await fetchDashboardData(targetRange, targetCustom)
  ;(window as any).__lastSnap = snap
  refreshRidgeline((window as any).__lastSnap)
  renderHighlightCards(snap.highlights.cards, targetRange)
  renderAchievements(snap.achievements.achievements)
  if (snap.charts?.mini_stats) applyMiniStats(snap.charts.mini_stats, targetRange, snap.highlights)
  if (snap.charts?.platform_breakdown) {
    PLATFORM_BREAKDOWN[targetRange] = snap.charts.platform_breakdown
    createDonutChart(targetRange)
  }
  if (snap.charts?.interaction_breakdown) {
    INTERACTION_BREAKDOWN[targetRange] = snap.charts.interaction_breakdown
    createInteractionDonut(targetRange)
  }
  if (snap.aggs?.accounts) renderAccountsFromAggs(snap.aggs.accounts, snap.aggs.account_totals)
  if (snap.aggs?.skill_groups) {
    renderSkillGroupsFromAggs(snap.aggs.skill_groups)
  }
  if (snap.aggs?.devices) renderDevicesFromAggs(snap.aggs.devices, snap.aggs.device_heat, snap.aggs.device_alert_count)
  if (snap.charts?.roi) renderRoiFromCharts(snap.charts.roi)
  applyBetaOverlays()
  var opsData = snapshotOpsToChartData(snap)
  if (opsData) updateCharts(targetRange, opsData)
  if (options && options.includeAncillary === false) return snap
  await Promise.allSettled([
    tryLiveMembers(),
    tryLiveWallet(),
    renderTransactions(paginationState.transactions.page, paginationState.transactions.pageSize),
    renderOplog(paginationState.oplog.page, paginationState.oplog.pageSize),
    renderOverviewOplog(),
  ])
  return snap
}

async function bootDashboardSnapshot(range = '7d', custom?: { start: string; end: string }) {
  return refreshDashboard(range, custom, { includeAncillary: false })
}

// Expose all functions to window for inline onclick handlers
Object.assign(window, {
  switchPage, switchDashTab, switchEnterpriseTab, switchEntCard, switchOpsView,
  setRange, openDatePickerModal, setDatePreset, applyCustomRange, renderCalendar, calSelectDate, calPreset, calPrevMonth, calNextMonth, calApply,
  renderScenarioCards, renderScenarioCardsFull, toggleScenario, toggleScenarioFull, initScenarioDropdown, flipScenario, exportScenarioCSV, sortScenario, searchScenario,
  renderDeviceMonitor, toggleDeviceSection, updateDeviceBadge, renderDeviceMetricsTable, searchDevice, exportDeviceCSV,
  renderAchievements, tiltAchieve, resetAchieve,
  createCharts, ensureOpsCharts, updateCharts, renderHighlightCards, createDonutChart, createInteractionDonut, setCurrentRange, exportTrendCSV, exportTrendPNG, exportRidgelineCSV, exportRidgelinePNG, exportOpsCSV, exportOpsPNG,
  switchRecordTab, renderTransactions, renderOplog, changePageSize, goPage, exportTransactions, exportOplog, paginationState, renderRecordTab, sortTransactions, sortOplog,
  openDrawer, closeDrawer, switchDrawerTab,
  openModal, closeModal, showToast,
  renderMembers, openAddMemberModal, addMember, openManageMemberModal, saveManageMember, confirmRemoveMember, removeMember, toggleMemberSelect, toggleSelectAllMembers, cancelBatchSelect, openBatchDistributeModal, confirmBatchDistribute, confirmBatchRemove, executeBatchRemove, sortMembers,
  openDistributeToMember, openDistributeModal, confirmDistribute, renderOverviewOplog,
  generateReport, closeReportPreview, saveReportImage, switchReportDim, renderROIPlatformCard,
  renderAccountMetricsTable, searchAccount, exportAccountCSV,
  pTag, initFilters, renderTaskTable, animateAllNumbers, getToday, getStatNum, setStatNum, prependTransaction,
  refreshDashboard,
  bootDashboardSnapshot,
})

// Escape key handler
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeDrawer(); closeReportPreview(); }
})

// Init
document.addEventListener('DOMContentLoaded', async function() {
  showLoader({ immediate: true })
  var initialRange = '7d'
  // Safety net: always schedule loader hide even if init throws.
  // Actual hide happens after data render; this is the fallback.
  window.setTimeout(function() {
    var el = document.getElementById('globalLoader')
    if (el && !el.classList.contains('hidden')) el.classList.add('hidden')
  }, 4000);
  initROICard();
  renderROIPlatformCard();
  createCharts();
  if (document.getElementById('scenarioDropdown')) initScenarioDropdown();
  if (document.getElementById('scenarioCards')) renderScenarioCards();
  renderDeviceMonitor();
  renderAccountMetricsTable();
  updateDeviceBadge();
  initFilters();
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

  // Force-hide preloader regardless of pendingCount balance
  // (some setRange/boot paths can drift the counter; for the initial
  // boot we want a hard guarantee the overlay goes away)
  var __loaderEl = document.getElementById('globalLoader');
  if (__loaderEl) __loaderEl.classList.add('hidden');
  hideLoader();
  bindRidgelineToggle();
  animateAllNumbers();
})

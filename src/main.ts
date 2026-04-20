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
import { switchRecordTab, renderTransactions, renderOplog, changePageSize, goPage, exportTransactions, exportOplog, paginationState, renderRecordTab, sortTransactions, sortOplog, applyTransactionsSnapshot, applyOplogSnapshot } from './modules/records'
import { openDrawer, closeDrawer, switchDrawerTab } from './modules/drawer'
import { openModal, closeModal, showToast } from './modules/modal-toast'
import { renderMembers, openAddMemberModal, addMember, openManageMemberModal, saveManageMember, confirmRemoveMember, removeMember, toggleMemberSelect, toggleSelectAllMembers, cancelBatchSelect, openBatchDistributeModal, confirmBatchDistribute, confirmBatchRemove, executeBatchRemove, sortMembers } from './modules/members'
import { openDistributeToMember, openDistributeModal, confirmDistribute, renderOverviewOplog } from './modules/wallet'
import { initROICard, generateReport, closeReportPreview, saveReportImage, switchReportDim, renderROIPlatformCard, renderRoiFromCharts } from './modules/reports'
import { renderAccountMetricsTable, searchAccount, exportAccountCSV, renderAccountsFromAggs } from './modules/accounts'
import { initCustomDropdowns, rebuildCustomDropdown } from './modules/dropdown'
import { showLoader, hideLoader } from './modules/loader'
import { bindRidgelineToggle, refreshRidgeline } from './modules/ridgeline-bind'
import { pTag, initFilters, renderTaskTable, animateAllNumbers, getToday, getStatNum, setStatNum, prependTransaction, formatCompareText } from './modules/utils'
import { applyMembersData, applyWalletData, fetchDashboardData, applyBetaOverlays, clearDashboardSnapshotCache, normalizeTransactions, normalizeAuditLog, showDashboardError } from './modules/api-integration'
import { getAuthToken, getCurrentUser, login as loginWithOtp, logout as logoutFromDashboard, sendOtp, verifyToken, type AuthUser } from './modules/auth'
import { PLATFORM_BREAKDOWN } from './data/platforms'
import { INTERACTION_BREAKDOWN } from './data/charts'

type DashboardCustomRange = { start: string; end: string } | undefined

var dashboardViewState: { range: string; custom?: DashboardCustomRange } = {
  range: '7d',
  custom: undefined,
}
var runtimeErrorGuardInstalled = false
var runtimeErrorNotified = false
var dashboardBootstrapped = false
var loginBindingsReady = false
var sidebarMenuBindingsReady = false
var otpCooldownTimer: number | null = null
var otpCooldownRemaining = 0

function setText(id: string, value: string) {
  var el = document.getElementById(id)
  if (el) el.textContent = value
}

function setElementHidden(id: string, hidden: boolean) {
  var el = document.getElementById(id)
  if (!el) return
  if (hidden) el.setAttribute('hidden', '')
  else el.removeAttribute('hidden')
}

function setLoginError(message: string) {
  var el = document.getElementById('loginErrorMessage')
  if (el) el.textContent = message || ''
}

function formatUserRole(user: AuthUser | null) {
  if (!user) return ''
  if (user.role === 'admin') return '管理员'
  if (user.role === 'member') return '只读成员'
  return user.role || ''
}

function updateSidebarUser(user: AuthUser | null) {
  var nameEl = document.getElementById('sidebarUserName')
  var avatarEl = document.getElementById('sidebarAvatar')
  var roleEl = document.getElementById('sidebarUserRole')
  if (!user) {
    if (nameEl) nameEl.textContent = '未登录'
    if (avatarEl) avatarEl.textContent = '—'
    if (roleEl) roleEl.textContent = ''
    return
  }
  if (nameEl) nameEl.textContent = user.name || '未命名用户'
  if (avatarEl) avatarEl.textContent = (user.name || '用').charAt(0)
  if (roleEl) roleEl.textContent = formatUserRole(user)
}

function showLoginOverlay(errorMessage?: string) {
  setElementHidden('dashboardShell', true)
  setElementHidden('loginOverlay', false)
  updateSidebarUser(null)
  setLoginError(errorMessage || '')
  window.setTimeout(function() {
    var phoneInput = document.getElementById('loginPhoneInput') as HTMLInputElement | null
    if (phoneInput) phoneInput.focus()
  }, 0)
}

function showDashboardShell() {
  setElementHidden('loginOverlay', true)
  setElementHidden('dashboardShell', false)
  updateSidebarUser(getCurrentUser())
}

function renderOtpCooldown() {
  var btn = document.getElementById('sendOtpBtn') as HTMLButtonElement | null
  if (!btn) return
  if (otpCooldownRemaining > 0) {
    btn.disabled = true
    btn.textContent = otpCooldownRemaining + 's 后重试'
    return
  }
  btn.disabled = false
  btn.textContent = '获取验证码'
}

function startOtpCooldown(seconds: number) {
  if (otpCooldownTimer !== null) {
    window.clearInterval(otpCooldownTimer)
    otpCooldownTimer = null
  }
  otpCooldownRemaining = Math.max(0, seconds)
  renderOtpCooldown()
  if (otpCooldownRemaining <= 0) return
  otpCooldownTimer = window.setInterval(function() {
    otpCooldownRemaining = Math.max(0, otpCooldownRemaining - 1)
    renderOtpCooldown()
    if (otpCooldownRemaining <= 0 && otpCooldownTimer !== null) {
      window.clearInterval(otpCooldownTimer)
      otpCooldownTimer = null
    }
  }, 1000)
}

function bindLoginOverlay() {
  if (loginBindingsReady) return
  loginBindingsReady = true

  var phoneInput = document.getElementById('loginPhoneInput') as HTMLInputElement | null
  var codeInput = document.getElementById('loginCodeInput') as HTMLInputElement | null
  var sendOtpBtn = document.getElementById('sendOtpBtn') as HTMLButtonElement | null
  var loginSubmitBtn = document.getElementById('loginSubmitBtn') as HTMLButtonElement | null

  renderOtpCooldown()

  if (phoneInput) {
    phoneInput.addEventListener('input', function() {
      setLoginError('')
    })
  }
  if (codeInput) {
    codeInput.addEventListener('input', function() {
      setLoginError('')
    })
    codeInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault()
        if (loginSubmitBtn) loginSubmitBtn.click()
      }
    })
  }
  if (phoneInput) {
    phoneInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' && sendOtpBtn && otpCooldownRemaining <= 0) {
        event.preventDefault()
        sendOtpBtn.click()
      }
    })
  }

  if (sendOtpBtn) {
    sendOtpBtn.addEventListener('click', async function() {
      var phone = phoneInput ? phoneInput.value.trim() : ''
      if (!phone) {
        setLoginError('请输入手机号')
        if (phoneInput) phoneInput.focus()
        return
      }
      setLoginError('')
      sendOtpBtn.disabled = true
      sendOtpBtn.textContent = '发送中...'
      var result = await sendOtp(phone)
      if (!result.ok) {
        otpCooldownRemaining = 0
        renderOtpCooldown()
        setLoginError(result.error || '验证码发送失败')
        return
      }
      startOtpCooldown(60)
      if (codeInput) codeInput.focus()
    })
  }

  if (loginSubmitBtn) {
    loginSubmitBtn.addEventListener('click', async function() {
      var phone = phoneInput ? phoneInput.value.trim() : ''
      var code = codeInput ? codeInput.value.trim() : ''
      if (!phone) {
        setLoginError('请输入手机号')
        if (phoneInput) phoneInput.focus()
        return
      }
      if (!code) {
        setLoginError('请输入验证码')
        if (codeInput) codeInput.focus()
        return
      }
      setLoginError('')
      loginSubmitBtn.disabled = true
      loginSubmitBtn.textContent = '登录中...'
      var loginResult = await loginWithOtp(phone, code)
      if (!loginResult.ok) {
        loginSubmitBtn.disabled = false
        loginSubmitBtn.textContent = '登录'
        renderOtpCooldown()
        setLoginError(loginResult.error || '登录失败')
        return
      }
      updateSidebarUser(loginResult.user || getCurrentUser())
      showLoader({ immediate: true })
      window.location.reload()
    })
  }
}

function closeSidebarUserMenu() {
  var menu = document.getElementById('sidebarUserMenu')
  var button = document.getElementById('sidebarUserMenuBtn') as HTMLButtonElement | null
  if (menu) menu.setAttribute('hidden', '')
  if (button) button.setAttribute('aria-expanded', 'false')
}

function toggleSidebarUserMenu() {
  var menu = document.getElementById('sidebarUserMenu')
  var button = document.getElementById('sidebarUserMenuBtn') as HTMLButtonElement | null
  if (!menu || !button) return
  var isOpen = !menu.hasAttribute('hidden')
  if (isOpen) {
    closeSidebarUserMenu()
    return
  }
  menu.removeAttribute('hidden')
  button.setAttribute('aria-expanded', 'true')
}

function bindSidebarUserMenu() {
  if (sidebarMenuBindingsReady) return
  sidebarMenuBindingsReady = true

  var wrap = document.querySelector('.sidebar-user-menu-wrap') as HTMLElement | null
  var button = document.getElementById('sidebarUserMenuBtn') as HTMLButtonElement | null
  var logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement | null

  if (button) {
    button.addEventListener('click', function(event) {
      event.stopPropagation()
      toggleSidebarUserMenu()
    })
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function() {
      closeSidebarUserMenu()
      await logoutFromDashboard()
    })
  }

  document.addEventListener('click', function(event) {
    if (!wrap) return
    var target = event.target as Node | null
    if (target && wrap.contains(target)) return
    closeSidebarUserMenu()
  })
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

function surfaceRuntimeError(prefix: string, error?: unknown) {
  hideLoader()
  var detail = error instanceof Error
    ? error.message
    : String(error || '').trim()
  var message = prefix + (detail ? '：' + detail : '')
  showDashboardError(message)
  if (!runtimeErrorNotified) {
    runtimeErrorNotified = true
    showToast(message, 'error')
  }
}

function installRuntimeErrorHandlers() {
  if (runtimeErrorGuardInstalled) return
  runtimeErrorGuardInstalled = true
  window.addEventListener('error', function(event) {
    surfaceRuntimeError('页面运行异常', event.error || event.message)
  })
  window.addEventListener('unhandledrejection', function(event) {
    surfaceRuntimeError('页面运行异常', event.reason)
  })
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

function resetSnapshotRecordState() {
  paginationState.transactions.page = 1
  paginationState.transactions.pageSize = 20
  paginationState.transactions.dateStart = ''
  paginationState.transactions.dateEnd = ''
  paginationState.oplog.page = 1
  paginationState.oplog.pageSize = 20
  paginationState.oplog.dateStart = ''
  paginationState.oplog.dateEnd = ''

  var txTypeFilter = document.getElementById('transTypeFilter') as HTMLSelectElement | null
  if (txTypeFilter) {
    txTypeFilter.value = ''
    rebuildCustomDropdown('transTypeFilter')
  }
  var oplogTypeFilter = document.getElementById('oplogTypeFilter') as HTMLSelectElement | null
  if (oplogTypeFilter) {
    oplogTypeFilter.value = ''
    rebuildCustomDropdown('oplogTypeFilter')
  }
}

export async function refreshDashboard(
  range?: string,
  custom?: DashboardCustomRange,
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
  resetSnapshotRecordState()
  applyMembersData(snap.members, false)
  updateSidebarUser(getCurrentUser())
  applyWalletData(snap.wallet)
  applyTransactionsSnapshot(normalizeTransactions(snap.transactions), 1, 20)
  applyOplogSnapshot(normalizeAuditLog(snap.audit_log), 1, 20, 10)
  await renderTaskTable(snap.stats_tasks)
  return snap
}

async function bootDashboardSnapshot(range = '7d', custom?: { start: string; end: string }) {
  return refreshDashboard(range, custom)
}

async function initializeDashboardApp() {
  if (dashboardBootstrapped) return
  dashboardBootstrapped = true
  var initialRange = '7d'
  try {
    initROICard()
    renderROIPlatformCard()
    createCharts()
    if (document.getElementById('scenarioDropdown')) initScenarioDropdown()
    if (document.getElementById('scenarioCards')) renderScenarioCards()
    renderDeviceMonitor()
    renderAccountMetricsTable()
    updateDeviceBadge()
    initFilters()
    renderMembers()
    var memberSearch = document.getElementById('entMemberSearch')
    if (memberSearch) {
      memberSearch.addEventListener('input', function() { renderMembers((this as HTMLInputElement).value) })
    }
    initCustomDropdowns()
    await bootDashboardSnapshot(initialRange)
    bindHighlightReflow()
    bindRidgelineToggle()
    animateAllNumbers()
  } catch (error) {
    dashboardBootstrapped = false
    throw error
  }
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
  if (e.key === 'Escape') { closeDrawer(); closeReportPreview(); closeSidebarUserMenu(); }
})

installRuntimeErrorHandlers()

// Init
document.addEventListener('DOMContentLoaded', async function() {
  bindLoginOverlay()
  bindSidebarUserMenu()
  updateSidebarUser(getCurrentUser())
  showLoader({ immediate: true })
  // Safety net: always schedule loader hide even if init throws.
  // Actual hide happens after data render; this is the fallback.
  window.setTimeout(function() {
    var el = document.getElementById('globalLoader')
    if (el && !el.classList.contains('hidden')) el.classList.add('hidden')
  }, 4000)
  try {
    if (!getAuthToken()) {
      showLoginOverlay()
      return
    }

    var verified = await verifyToken()
    if (!verified) {
      showLoginOverlay('登录状态已失效，请重新登录')
      return
    }

    showDashboardShell()
    await initializeDashboardApp()
  } catch (error) {
    surfaceRuntimeError('页面初始化失败', error)
  } finally {
    // Force-hide preloader regardless of pendingCount balance
    // (some setRange/boot paths can drift the counter; for the initial
    // boot we want a hard guarantee the overlay goes away)
    var __loaderEl = document.getElementById('globalLoader')
    if (__loaderEl) __loaderEl.classList.add('hidden')
    hideLoader()
  }
})

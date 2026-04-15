import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

import './styles/index.css'

// Module imports
import { createCharts, ensureOpsCharts, updateCharts, renderHighlightCards, createDonutChart, createInteractionDonut, setCurrentRange, exportTrendCSV, exportTrendPNG } from './modules/charts'
import { switchPage, switchDashTab, switchEnterpriseTab, switchEntCard, switchOpsView } from './modules/navigation'
import { setRange, openDatePickerModal, setDatePreset, applyCustomRange } from './modules/date-range'
import { renderScenarioCards, renderScenarioCardsFull, toggleScenario, toggleScenarioFull, initScenarioDropdown, flipScenario, exportScenarioCSV } from './modules/scenarios'
import { renderDeviceMonitor, toggleDeviceSection, updateDeviceBadge, renderDeviceMetricsTable } from './modules/devices'
import { renderAchievements, tiltAchieve, resetAchieve } from './modules/achievements'
import { switchRecordTab, renderTransactions, renderOplog, changePageSize, goPage, exportTransactions, exportOplog, paginationState, renderRecordTab } from './modules/records'
import { openDrawer, closeDrawer, switchDrawerTab } from './modules/drawer'
import { openModal, closeModal, showToast } from './modules/modal-toast'
import { renderMembers, openAddMemberModal, addMember, openManageMemberModal, saveManageMember, confirmRemoveMember, removeMember } from './modules/members'
import { openDistributeToMember, openDistributeModal, confirmDistribute, renderOverviewOplog } from './modules/wallet'
import { initROICard, generateReport, closeReportPreview, saveReportImage, switchReportDim, renderROIPlatformCard } from './modules/reports'
import { renderAccountMetricsTable } from './modules/accounts'
import { initCustomDropdowns } from './modules/dropdown'
import { pTag, initFilters, renderTaskTable, animateAllNumbers, getToday, getStatNum, setStatNum, prependTransaction } from './modules/utils'
import { tryLiveMembers, tryLiveWallet, tryLiveTransactions, tryLiveAccounts, tryLiveSkills, applyBetaOverlays } from './modules/api-integration'

// Expose all functions to window for inline onclick handlers
Object.assign(window, {
  switchPage, switchDashTab, switchEnterpriseTab, switchEntCard, switchOpsView,
  setRange, openDatePickerModal, setDatePreset, applyCustomRange,
  renderScenarioCards, renderScenarioCardsFull, toggleScenario, toggleScenarioFull, initScenarioDropdown, flipScenario, exportScenarioCSV,
  renderDeviceMonitor, toggleDeviceSection, updateDeviceBadge, renderDeviceMetricsTable,
  renderAchievements, tiltAchieve, resetAchieve,
  createCharts, ensureOpsCharts, updateCharts, renderHighlightCards, createDonutChart, createInteractionDonut, setCurrentRange, exportTrendCSV, exportTrendPNG,
  switchRecordTab, renderTransactions, renderOplog, changePageSize, goPage, exportTransactions, exportOplog, paginationState, renderRecordTab,
  openDrawer, closeDrawer, switchDrawerTab,
  openModal, closeModal, showToast,
  renderMembers, openAddMemberModal, addMember, openManageMemberModal, saveManageMember, confirmRemoveMember, removeMember,
  openDistributeToMember, openDistributeModal, confirmDistribute, renderOverviewOplog,
  generateReport, closeReportPreview, saveReportImage, switchReportDim, renderROIPlatformCard,
  renderAccountMetricsTable,
  pTag, initFilters, renderTaskTable, animateAllNumbers, getToday, getStatNum, setStatNum, prependTransaction,
})

// Escape key handler
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeDrawer(); closeReportPreview(); }
})

// Init
document.addEventListener('DOMContentLoaded', function() {
  initROICard();
  renderROIPlatformCard();
  createCharts();
  if (document.getElementById('scenarioDropdown')) initScenarioDropdown();
  if (document.getElementById('scenarioCards')) renderScenarioCards();
  renderDeviceMonitor();
  renderDeviceMetricsTable();
  renderAccountMetricsTable();
  updateDeviceBadge();
  initFilters();
  renderTaskTable();
  renderTransactions(1, 20);
  renderOplog(1, 20);
  renderMembers();
  var memberSearch = document.getElementById('entMemberSearch');
  if (memberSearch) {
    memberSearch.addEventListener('input', function() { renderMembers((this as HTMLInputElement).value); });
  }
  initCustomDropdowns();
  applyBetaOverlays();
  tryLiveMembers();
  tryLiveWallet();
  tryLiveTransactions();
  tryLiveAccounts();
  tryLiveSkills();
})

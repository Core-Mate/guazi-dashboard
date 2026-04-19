import { updateCharts, createDonutChart, renderHighlightCards, createInteractionDonut, setCurrentRange, setHighlightLoading } from './charts'
import { renderAchievements } from './achievements'
import { showLoader, hideLoader } from './loader'
import { openModal, closeModal, showToast } from './modal-toast'
import { INTERACTION_BREAKDOWN } from '../data/charts'
import { PLATFORM_BREAKDOWN } from '../data/platforms'
import { fetchDashboardData, showDashboardError } from './api-integration'

function emptyOpsTrend(): any {
  return {
    dates: [],
    success: [],
    failed: [],
    total: [],
    comments: [],
    likes: [],
    dms: [],
    reach: [],
    runtime: [],
    saves: [],
    credits: [],
  }
}

function getLocalDateStr(d?: Date): string {
  var date = d || new Date()
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
}

async function triggerSnapshotBoot(range: string, custom?: { start: string; end: string }) {
  var boot = (window as any).bootDashboardSnapshot
  showLoader()
  try {
    if (typeof boot === 'function') {
      return await Promise.resolve(boot(range, custom))
    }
    var snap = await fetchDashboardData(range, custom)
    renderHighlightCards((snap && snap.highlights && snap.highlights.cards) || [], range)
    if (typeof renderAchievements === 'function') {
      renderAchievements((snap && snap.achievements && snap.achievements.achievements) || [])
    }
    PLATFORM_BREAKDOWN[range] = snap && snap.charts && Array.isArray(snap.charts.platform_breakdown)
      ? snap.charts.platform_breakdown
      : []
    INTERACTION_BREAKDOWN[range] = snap && snap.charts && Array.isArray(snap.charts.interaction_breakdown)
      ? snap.charts.interaction_breakdown
      : []
    if (typeof createDonutChart === 'function') createDonutChart(range)
    if (typeof createInteractionDonut === 'function') createInteractionDonut(range)
    var trend = snap && snap.ops_trend
      ? {
          dates: Array.isArray(snap.ops_trend.dates) && snap.ops_trend.dates.length
            ? snap.ops_trend.dates
            : (Array.isArray(snap.ops_trend.labels) ? snap.ops_trend.labels : []),
          success: Array.isArray(snap.ops_trend.success) ? snap.ops_trend.success : [],
          failed: Array.isArray(snap.ops_trend.failed) ? snap.ops_trend.failed : [],
          total: Array.isArray(snap.ops_trend.total) ? snap.ops_trend.total : (Array.isArray(snap.ops_trend.exec) ? snap.ops_trend.exec : []),
          comments: Array.isArray(snap.ops_trend.comments) ? snap.ops_trend.comments : [],
          likes: Array.isArray(snap.ops_trend.likes) ? snap.ops_trend.likes : [],
          dms: Array.isArray(snap.ops_trend.dms) ? snap.ops_trend.dms : [],
          reach: Array.isArray(snap.ops_trend.reach) ? snap.ops_trend.reach : [],
          runtime: Array.isArray(snap.ops_trend.runtime_h) ? snap.ops_trend.runtime_h : [],
          saves: Array.isArray(snap.ops_trend.saves) ? snap.ops_trend.saves : [],
          credits: Array.isArray(snap.ops_trend.credits) ? snap.ops_trend.credits : [],
        }
      : emptyOpsTrend()
    updateCharts(range, trend)
    return snap
  } catch (error) {
    var message = error instanceof Error ? error.message : '数据加载失败'
    showDashboardError('数据加载失败：' + message)
    showToast('数据加载失败：' + message, 'error')
    return null
  } finally {
    hideLoader()
  }
}

export function setRange(range, btn) {
  if (range === 'custom') { openDatePickerModal(btn); return; }
  btn.parentElement.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  var allBtns = btn.parentElement.querySelectorAll('.toolbar-btn');
  var customBtn = allBtns[allBtns.length - 1];
  if (customBtn && customBtn !== btn) customBtn.textContent = '自定义';
  setHighlightLoading();
  setCurrentRange(range);
  void triggerSnapshotBoot(range);
}

var calState = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  startDate: '',
  endDate: '',
  pickStep: 0,
};

function fmtCal(d) { return d ? d.replace(/-/g, '/') : '----/--/--'; }

export function openDatePickerModal(_anchor?) {
  var today = new Date();
  calState.viewYear = today.getFullYear();
  calState.viewMonth = today.getMonth();
  calState.startDate = getLocalDateStr(new Date(Date.now() - 7 * 86400000));
  calState.endDate = getLocalDateStr(today);
  calState.pickStep = 0;

  var body = '<div class="cal-picker">' +
    '<div class="cal-inputs">' +
    '<div class="cal-input-box" id="calStartBox">' + fmtCal(calState.startDate) + '</div>' +
    '<span class="cal-separator">至</span>' +
    '<div class="cal-input-box" id="calEndBox">' + fmtCal(calState.endDate) + '</div>' +
    '</div>' +
    '<div class="datepicker-presets">' +
    '<button class="datepicker-preset-btn" onclick="calPreset(7)">近 7 天</button>' +
    '<button class="datepicker-preset-btn" onclick="calPreset(14)">近 14 天</button>' +
    '<button class="datepicker-preset-btn" onclick="calPreset(30)">近 30 天</button>' +
    '<button class="datepicker-preset-btn" onclick="calPreset(90)">近 90 天</button>' +
    '</div>' +
    '<div class="cal-nav">' +
    '<button class="cal-nav-btn" onclick="calPrevMonth()">◀</button>' +
    '<span class="cal-nav-title" id="calNavTitle"></span>' +
    '<button class="cal-nav-btn" onclick="calNextMonth()">▶</button>' +
    '</div>' +
    '<div class="cal-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>' +
    '<div class="cal-grid" id="calGrid"></div>' +
    '</div>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn modal-btn-primary" onclick="calApply()">确定</button>';
  openModal('自定义时间范围', body, footer);
  renderCalendar();
}

function calCell(day, dateStr, todayStr, extra) {
  var cls = 'cal-cell';
  if (extra) cls += ' ' + extra;
  if (dateStr > todayStr) cls += ' disabled';
  if (dateStr === todayStr) cls += ' today';
  if (dateStr === calState.startDate || dateStr === calState.endDate) cls += ' selected';
  if (calState.startDate && calState.endDate && dateStr > calState.startDate && dateStr < calState.endDate) cls += ' in-range';
  var onclick = dateStr > todayStr ? '' : ' onclick="calSelectDate(\'' + dateStr + '\')"';
  return '<div class="' + cls + '"' + onclick + '>' + day + '</div>';
}

export function renderCalendar() {
  var y = calState.viewYear, mo = calState.viewMonth;
  var titleEl = document.getElementById('calNavTitle');
  if (titleEl) titleEl.textContent = y + '年' + (mo + 1) + '月';
  var grid = document.getElementById('calGrid');
  if (!grid) return;
  var todayStr = getLocalDateStr();
  var firstDay = new Date(y, mo, 1).getDay();
  var daysInMonth = new Date(y, mo + 1, 0).getDate();
  var daysInPrev = new Date(y, mo, 0).getDate();
  var cells = '';
  for (var i = firstDay - 1; i >= 0; i--) {
    var d = daysInPrev - i;
    var pm = mo === 0 ? 11 : mo - 1, py = mo === 0 ? y - 1 : y;
    cells += calCell(d, py + '-' + String(pm + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'), todayStr, 'other-month');
  }
  for (var d = 1; d <= daysInMonth; d++) {
    cells += calCell(d, y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'), todayStr, '');
  }
  var total = firstDay + daysInMonth;
  var rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (var d = 1; d <= rem; d++) {
    var nm = mo === 11 ? 0 : mo + 1, ny = mo === 11 ? y + 1 : y;
    cells += calCell(d, ny + '-' + String(nm + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'), todayStr, 'other-month');
  }
  grid.innerHTML = cells;
  var startBox = document.getElementById('calStartBox');
  var endBox = document.getElementById('calEndBox');
  if (startBox) startBox.textContent = fmtCal(calState.startDate);
  if (endBox) endBox.textContent = fmtCal(calState.endDate);
}

export function calSelectDate(dateStr) {
  if (calState.pickStep === 0) {
    calState.startDate = dateStr;
    calState.endDate = '';
    calState.pickStep = 1;
  } else {
    if (dateStr < calState.startDate) {
      calState.endDate = calState.startDate;
      calState.startDate = dateStr;
    } else {
      calState.endDate = dateStr;
    }
    calState.pickStep = 0;
  }
  renderCalendar();
}

export function calPreset(days) {
  var todayStr = getLocalDateStr();
  calState.startDate = getLocalDateStr(new Date(Date.now() - days * 86400000));
  calState.endDate = todayStr;
  calState.pickStep = 0;
  var ed = new Date(todayStr);
  calState.viewYear = ed.getFullYear();
  calState.viewMonth = ed.getMonth();
  renderCalendar();
}

export function calPrevMonth() {
  if (calState.viewMonth === 0) { calState.viewMonth = 11; calState.viewYear--; }
  else calState.viewMonth--;
  renderCalendar();
}

export function calNextMonth() {
  var now = new Date();
  if (calState.viewYear === now.getFullYear() && calState.viewMonth >= now.getMonth()) return;
  if (calState.viewMonth === 11) { calState.viewMonth = 0; calState.viewYear++; }
  else calState.viewMonth++;
  renderCalendar();
}

export function calApply() {
  if (!calState.startDate || !calState.endDate) { showToast('请选择完整的时间范围', 'error'); return; }
  closeModal();
  var btns = document.querySelectorAll('#page-dashboard .toolbar .toolbar-btn');
  btns.forEach(function(b) { b.classList.remove('active'); });
  var customBtn = btns[btns.length - 1];
  customBtn.classList.add('active');
  customBtn.textContent = calState.startDate.slice(5).replace('-', '/') + ' ~ ' + calState.endDate.slice(5).replace('-', '/');
  setCurrentRange('custom');
  setHighlightLoading();
  void triggerSnapshotBoot('custom', { start: calState.startDate, end: calState.endDate });
}

export function setDatePreset(days) {
  var today = getLocalDateStr();
  var start = getLocalDateStr(new Date(Date.now() - days * 86400000));
  var startEl = document.getElementById('dpStart') as HTMLInputElement | null;
  var endEl = document.getElementById('dpEnd') as HTMLInputElement | null;
  if (startEl) startEl.value = start;
  if (endEl) endEl.value = today;
}

export function applyCustomRange() {
  var startEl = document.getElementById('dpStart') as HTMLInputElement;
  var endEl = document.getElementById('dpEnd') as HTMLInputElement;
  var start = startEl ? startEl.value : '';
  var end = endEl ? endEl.value : '';
  if (!start || !end || start > end) { showToast('请选择有效的时间范围', 'error'); return; }
  closeModal();
  var btns = document.querySelectorAll('#page-dashboard .toolbar .toolbar-btn');
  btns.forEach(function(b) { b.classList.remove('active'); });
  var customBtn = btns[btns.length - 1];
  customBtn.classList.add('active');
  customBtn.textContent = start.slice(5).replace('-','/') + ' ~ ' + end.slice(5).replace('-','/');
  setCurrentRange('custom');
  setHighlightLoading();
  void triggerSnapshotBoot('custom', { start: start, end: end });
}

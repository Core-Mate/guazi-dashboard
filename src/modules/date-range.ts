import { updateCharts, createDonutChart, renderHighlightCards, createInteractionDonut, setCurrentRange } from './charts'
import { renderAchievements } from './achievements'
import { initROICard, renderROIPlatformCard } from './reports'
import { animateAllNumbers } from './utils'
import { openModal, closeModal, showToast } from './modal-toast'
import { HIGHLIGHT_DATA } from '../data/highlights'
import { mockData, INTERACTION_BREAKDOWN } from '../data/charts'
import { PLATFORM_BREAKDOWN } from '../data/platforms'
import { tryLiveHighlights } from './api-integration'

export function setRange(range, btn) {
  if (range === 'custom') { openDatePickerModal(btn); return; }
  btn.parentElement.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // 重置自定义按钮文字
  var allBtns = btn.parentElement.querySelectorAll('.toolbar-btn');
  var customBtn = allBtns[allBtns.length - 1];
  if (customBtn && customBtn !== btn) customBtn.textContent = '自定义';
  setCurrentRange(range);
  updateCharts(range);
  renderHighlightCards(HIGHLIGHT_DATA[range] || HIGHLIGHT_DATA['7d'], range);
  if (typeof renderAchievements === 'function') renderAchievements(range);
  if (typeof createDonutChart === 'function') createDonutChart(range);
  if (typeof createInteractionDonut === 'function') createInteractionDonut(range);
  if (typeof animateAllNumbers === 'function') animateAllNumbers();
  initROICard(range);
  renderROIPlatformCard(range);
  tryLiveHighlights(range);
}

export function openDatePickerModal() {
  var today = new Date().toISOString().slice(0,10);
  var weekAgo = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
  var body =
    '<div class="modal-field"><label class="modal-label">时间范围</label>' +
    '<div class="datepicker-row">' +
    '<input type="date" id="dpStart" value="'+weekAgo+'" max="'+today+'">' +
    '<span style="color:#a1a1aa;flex-shrink:0;">至</span>' +
    '<input type="date" id="dpEnd" value="'+today+'" max="'+today+'">' +
    '</div>' +
    '<div class="datepicker-presets">' +
    '<button class="datepicker-preset-btn" onclick="setDatePreset(7)">近 7 天</button>' +
    '<button class="datepicker-preset-btn" onclick="setDatePreset(14)">近 14 天</button>' +
    '<button class="datepicker-preset-btn" onclick="setDatePreset(30)">近 30 天</button>' +
    '<button class="datepicker-preset-btn" onclick="setDatePreset(90)">近 90 天</button>' +
    '</div></div>';
  var footer =
    '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn modal-btn-primary" onclick="applyCustomRange()">确定</button>';
  openModal('自定义时间范围', body, footer);
}

export function setDatePreset(days) {
  var today = new Date().toISOString().slice(0,10);
  var start = new Date(Date.now() - days*86400000).toISOString().slice(0,10);
  document.getElementById('dpStart').value = start;
  document.getElementById('dpEnd').value = today;
}

function populateCustomRange(days) {
  var base = days <= 1 ? mockData.today : days <= 14 ? mockData['7d'] : mockData['30d'];
  var labels = [];
  var now = new Date();
  for (var i = days - 1; i >= 0; i--) {
    var dt = new Date(now.getTime() - i * 86400000);
    labels.push(String(dt.getMonth()+1).padStart(2,'0') + '/' + String(dt.getDate()).padStart(2,'0'));
  }
  function extend(arr) {
    var result = [];
    for (var i = 0; i < days; i++) {
      var v = arr[i % arr.length];
      var trend = 0.7 + (i / Math.max(1, days - 1)) * 0.6;
      var wave = 1 + 0.12 * Math.sin(i * 0.4);
      result.push(Math.max(0, Math.round(v * trend * wave)));
    }
    return result;
  }
  function extendFloat(arr) {
    var result = [];
    for (var i = 0; i < days; i++) {
      var v = arr[i % arr.length];
      var trend = 0.7 + (i / Math.max(1, days - 1)) * 0.6;
      var wave = 1 + 0.12 * Math.sin(i * 0.4);
      result.push(parseFloat((Math.max(0, v * trend * wave)).toFixed(1)));
    }
    return result;
  }
  var exec = extend(base.exec), success = extend(base.success), cost = extend(base.cost), reach = extend(base.reach);
  var totalExec = exec.reduce(function(a,b){return a+b;},0);
  var totalSuccess = success.reduce(function(a,b){return a+b;},0);
  var totalCost = cost.reduce(function(a,b){return a+b;},0);
  var totalReach = reach.reduce(function(a,b){return a+b;},0);
  var scale = days / 30;
  mockData.custom = {
    labels: labels, exec: exec, success: success, cost: cost,
    data: extend(base.data || base.success), reach: reach,
    comments: extend(base.comments), likes: extend(base.likes),
    dms: extend(base.dms), runtime: extendFloat(base.runtime),
    statExec: totalExec.toLocaleString(),
    statRate: (totalExec > 0 ? Math.round(totalSuccess/totalExec*100) : 0) + '%',
    statRateSub: totalSuccess + ' 成功 / ' + totalExec + ' 总计',
    statCost: totalCost.toLocaleString(),
    execChange: '+' + Math.round(scale * 5 + 10) + '%',
    costChange: '-' + Math.round(scale * 3 + 5) + '%',
    statReach: totalReach.toLocaleString(),
    reachChange: '+' + Math.round(scale * 5 + 12) + '%',
    costAvg: Math.round(totalCost / Math.max(1, days)) + ' 算力豆',
    costPer: '10 算力豆', costWow: '-' + Math.round(scale * 3 + 5) + '%',
    trendDesc: '多维度数据对比', costDesc: '自定义时段算力豆消耗', reachDesc: '自定义时段触达量',
  };
  var h30 = HIGHLIGHT_DATA['30d'];
  (HIGHLIGHT_DATA as any).custom = h30.map(function(h) {
    var scaled = Math.round(h.value * scale);
    var prevScaled = Math.round(h.prev * scale * (0.85 + Math.random() * 0.1));
    return { key: h.key, label: h.label, value: scaled, prev: prevScaled, unit: h.unit || '', sparkline: h.sparkline };
  });
  var ib30 = INTERACTION_BREAKDOWN['30d'];
  (INTERACTION_BREAKDOWN as any).custom = ib30.map(function(item) {
    return { name: item.name, value: Math.round(item.value * scale), color: item.color };
  });
  var pb30 = PLATFORM_BREAKDOWN['30d'];
  PLATFORM_BREAKDOWN.custom = pb30.map(function(item) {
    return { name: item.name, value: Math.round(item.value * scale), color: item.color };
  });
}

export function applyCustomRange() {
  var startEl = document.getElementById('dpStart') as HTMLInputElement;
  var endEl = document.getElementById('dpEnd') as HTMLInputElement;
  var start = startEl ? startEl.value : '';
  var end = endEl ? endEl.value : '';
  if (!start || !end || start > end) { showToast('请选择有效的时间范围', 'error'); return; }
  closeModal();
  var days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
  populateCustomRange(days);
  var btns = document.querySelectorAll('#page-dashboard .toolbar .toolbar-btn');
  btns.forEach(function(b) { b.classList.remove('active'); });
  var customBtn = btns[btns.length - 1];
  customBtn.classList.add('active');
  customBtn.textContent = start.slice(5).replace('-','/') + ' ~ ' + end.slice(5).replace('-','/');
  setCurrentRange('custom');
  updateCharts('custom');
  renderHighlightCards(HIGHLIGHT_DATA['custom'] || HIGHLIGHT_DATA['7d'], 'custom');
  if (typeof renderAchievements === 'function') renderAchievements('custom');
  if (typeof createDonutChart === 'function') createDonutChart('custom');
  if (typeof createInteractionDonut === 'function') createInteractionDonut('custom');
  if (typeof animateAllNumbers === 'function') animateAllNumbers();
  initROICard('custom');
  renderROIPlatformCard('custom');
}

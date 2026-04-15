import { transactionData, oplogData } from '../data/records'
import { downloadCSV } from './export-utils'
import { pTag } from './utils'

export let paginationState = { transactions: {page:1,pageSize:20,dateStart:'',dateEnd:''}, oplog: {page:1,pageSize:20,dateStart:'',dateEnd:''} }

export function switchRecordTab(tab, btn) {
  document.querySelectorAll('#page-records .tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('#page-records .tab-content').forEach(function(c) { c.classList.remove('active', 'tab-slide-in'); });
  btn.classList.add('active');
  var el = document.getElementById('recordTab-' + tab);
  if (el) { el.classList.add('active', 'tab-slide-in'); setTimeout(function() { el.classList.remove('tab-slide-in'); }, 250); }
  renderRecordTab(tab);
}

export function clampRecordPage(tab, totalItems) {
  var state = paginationState[tab];
  var totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  if (state.page < 1) state.page = 1;
  if (state.page > totalPages) state.page = totalPages;
}

function normalizeDate(timeStr) {
  var datePart = timeStr.split(' ')[0];
  var parts = datePart.split('/');
  return '2026-' + parts[0].padStart(2,'0') + '-' + parts[1].padStart(2,'0');
}

function filterByDate(items, tab, timeField) {
  var state = paginationState[tab];
  if (!state || (!state.dateStart && !state.dateEnd)) return items;
  return items.filter(function(item) {
    var normalized = normalizeDate(item[timeField]);
    if (state.dateStart && normalized < state.dateStart) return false;
    if (state.dateEnd && normalized > state.dateEnd) return false;
    return true;
  });
}

function renderDateFilter(tab) {
  var panel = document.getElementById('recordTab-' + tab);
  if (!panel) return;
  var toolbar = panel.querySelector('.toolbar');
  if (!toolbar || toolbar.querySelector('.date-filter-group')) return;
  var group = document.createElement('div');
  var state = paginationState[tab];
  group.className = 'date-filter-group';
  group.setAttribute('style', 'display:flex;align-items:center;gap:6px;margin-left:8px;');
  group.innerHTML =
    '<input type="date" class="filter-select date-start" style="padding:5px 8px;font-size:12px;">' +
    '<span style="color:#a1a1aa;font-size:12px;">至</span>' +
    '<input type="date" class="filter-select date-end" style="padding:5px 8px;font-size:12px;">' +
    '<button class="btn-action" style="padding:5px 12px;font-size:12px;" onclick="applyDateFilter(\'' + tab + '\')">筛选</button>';
  var toolbarRight = toolbar.querySelector('.toolbar-right');
  if (toolbarRight) toolbar.insertBefore(group, toolbarRight);
  else toolbar.appendChild(group);
  var startInput = group.querySelector('.date-start') as any;
  var endInput = group.querySelector('.date-end') as any;
  if (startInput) startInput.value = state.dateStart;
  if (endInput) endInput.value = state.dateEnd;
}

export function updatePagination(tab, totalItems) {
  var state = paginationState[tab];
  var totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  var panel = document.getElementById('recordTab-' + tab);
  if (!panel) return;
  var info = panel.querySelector('.pagi-info') as any;
  var prevBtn = panel.querySelector('.pagination-btn[data-direction="-1"]') as any;
  var nextBtn = panel.querySelector('.pagination-btn[data-direction="1"]') as any;
  var sizeSelect = panel.querySelector('.page-size-select select') as any;
  if (sizeSelect) sizeSelect.value = String(state.pageSize);
  if (info) info.textContent = '第 ' + state.page + ' 页，共 ' + totalPages + ' 页（' + totalItems + ' 条记录）';
  if (prevBtn) prevBtn.disabled = state.page <= 1;
  if (nextBtn) nextBtn.disabled = state.page >= totalPages;
  var btnsDiv = panel.querySelector('.pagination-btns') as any;
  if (btnsDiv && !btnsDiv.querySelector('.page-jump')) {
    var pageJump = document.createElement('div');
    pageJump.className = 'page-jump';
    pageJump.setAttribute('style', 'display:inline-flex;align-items:center;gap:4px;margin:0 8px;');
    pageJump.innerHTML =
      '<input type="number" min="1" class="page-jump-input" style="width:52px;padding:4px 6px;border:1px solid #e4e4e7;border-radius:6px;font-size:12px;text-align:center;">' +
      '<button class="pagination-btn" onclick="jumpToPage(\'' + tab + '\')">跳转</button>';
    if (nextBtn && nextBtn.parentNode === btnsDiv) btnsDiv.insertBefore(pageJump, nextBtn);
    else btnsDiv.appendChild(pageJump);
  }
  var jumpInput = panel.querySelector('.page-jump-input') as any;
  if (jumpInput) {
    jumpInput.max = String(totalPages);
    jumpInput.placeholder = String(state.page);
  }
}

export function renderTransactions(page, pageSize) {
  renderDateFilter('transactions');
  var body = document.getElementById('transactions-tbody');
  var state = paginationState.transactions;
  if (!body) return;
  if (typeof page === 'number') state.page = page;
  if (typeof pageSize === 'number') state.pageSize = pageSize;
  var filtered = filterByDate(transactionData, 'transactions', 'time');
  var typeFilter = document.getElementById('transTypeFilter') as HTMLSelectElement;
  if (typeFilter && typeFilter.value !== '全部类型') {
    filtered = filtered.filter(function(item) { return item.type === typeFilter.value; });
  }
  clampRecordPage('transactions', filtered.length);
  var start = (state.page - 1) * state.pageSize;
  var rows = filtered.slice(start, start + state.pageSize);
  body.innerHTML = rows.map(function(item) {
    var changeClass = item.change > 0 ? 'text-green' : 'text-red';
    var changeText = item.change > 0 ? '+' + item.change.toLocaleString() : item.change.toLocaleString();
    return '<tr><td class="text-muted">' + item.time + '</td><td>' + item.member + '</td><td>' + item.type + '</td><td>' + item.desc + '</td><td class="' + changeClass + '">' + changeText + '</td><td class="td-mono">' + item.balance.toLocaleString() + '</td></tr>';
  }).join('');
  updatePagination('transactions', filtered.length);
}

export function renderOplog(page, pageSize) {
  renderDateFilter('oplog');
  var body = document.getElementById('oplog-tbody');
  var state = paginationState.oplog;
  if (!body) return;
  if (typeof page === 'number') state.page = page;
  if (typeof pageSize === 'number') state.pageSize = pageSize;
  var filtered = filterByDate(oplogData, 'oplog', 'time');
  var typeFilter = document.getElementById('oplogTypeFilter') as HTMLSelectElement;
  if (typeFilter && typeFilter.value !== '全部类型') {
    filtered = filtered.filter(function(item) { return item.action === typeFilter.value; });
  }
  clampRecordPage('oplog', filtered.length);
  var start = (state.page - 1) * state.pageSize;
  var rows = filtered.slice(start, start + state.pageSize);
  body.innerHTML = rows.map(function(item) {
    return '<tr><td class="text-muted">' + item.time + '</td><td>' + item.operator + '</td><td>' + pTag(item.action) + '</td><td>' + item.target + '<span class="text-muted"> · ' + item.result + '</span></td></tr>';
  }).join('');
  updatePagination('oplog', filtered.length);
}

export function changePageSize(tab, size) {
  paginationState[tab].pageSize = parseInt(size, 10);
  paginationState[tab].page = 1;
  renderRecordTab(tab);
}

export function goPage(tab, direction) {
  paginationState[tab].page += direction;
  renderRecordTab(tab);
}

export function applyDateFilter(tab) {
  var panel = document.getElementById('recordTab-' + tab);
  var state = paginationState[tab];
  if (!panel || !state) return;
  var startInput = panel.querySelector('.date-start') as any;
  var endInput = panel.querySelector('.date-end') as any;
  state.dateStart = startInput ? startInput.value : '';
  state.dateEnd = endInput ? endInput.value : '';
  state.page = 1;
  renderRecordTab(tab);
}

export function jumpToPage(tab) {
  var panel = document.getElementById('recordTab-' + tab);
  var input = panel ? panel.querySelector('.page-jump-input') as any : null;
  if (!input || !input.value) return;
  var pageNum = parseInt(input.value, 10);
  if (isNaN(pageNum) || pageNum < 1) return;
  paginationState[tab].page = pageNum;
  input.value = '';
  renderRecordTab(tab);
}

export function renderRecordTab(tab) {
  var state = paginationState[tab];
  if (!state) return;
  if (tab === 'transactions') renderTransactions(state.page, state.pageSize);
  else if (tab === 'oplog') renderOplog(state.page, state.pageSize);
}

function csvVal(v) { return (v === undefined || v === null || v === '') ? 'N/A' : v; }

export function exportTransactions() {
  var filtered = filterByDate(transactionData, 'transactions', 'time');
  var headers = ['时间', '成员', '类型', '说明', '变动', '余额'];
  var rows = filtered.map(function(item) {
    return [csvVal(item.time), csvVal(item.member), csvVal(item.type), csvVal(item.desc), csvVal(item.change), csvVal(item.balance)];
  });
  downloadCSV('交易历史_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

export function exportOplog() {
  var filtered = filterByDate(oplogData, 'oplog', 'time');
  var typeFilter = document.getElementById('oplogTypeFilter') as HTMLSelectElement;
  if (typeFilter && typeFilter.value !== '全部类型') {
    filtered = filtered.filter(function(item) { return item.action === typeFilter.value; });
  }
  var headers = ['时间', '操作人', '操作类型', '详情', '结果'];
  var rows = filtered.map(function(item) {
    return [csvVal(item.time), csvVal(item.operator), csvVal(item.action), csvVal(item.target), csvVal(item.result)];
  });
  downloadCSV('操作日志_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

(window as any).jumpToPage = jumpToPage;
(window as any).applyDateFilter = applyDateFilter;

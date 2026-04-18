import {
  registerRecordOptimisticHandlers,
  replaceOplogData,
  replaceTransactionData,
} from '../data/records'
import { membersData } from '../data/members'
import { fetchAuditLog, fetchTransactions } from './api-integration'
import { downloadCSV } from './export-utils'
import { pTag } from './utils'

export let paginationState = { transactions: {page:1,pageSize:20,dateStart:'',dateEnd:''}, oplog: {page:1,pageSize:20,dateStart:'',dateEnd:''} }
export var txSortKey: 'time' | 'member' | 'type' = 'time'
export var txSortDir: 'asc' | 'desc' = 'desc'
export var oplogSortKey: 'time' | 'operator' | 'action' = 'time'
export var oplogSortDir: 'asc' | 'desc' = 'desc'

let oplogState = { items: [] as any[], total: 0, loaded: false }
let transactionState = { items: [] as any[], total: 0, loaded: false }
let overviewOplogLimit = 5
let _oplogLoaded = false
let _transactionsLoaded = false

function compareRecordText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-CN')
}

function toRecordTime(value) {
  var text = String(value || '').trim()
  if (!text) return 0
  var normalized = /^\d{4}/.test(text) ? text : '2026/' + text
  var parsed = Number(new Date(normalized))
  return isNaN(parsed) ? 0 : parsed
}

function syncRecordSortHeaders(group, key, dir) {
  document.querySelectorAll('th[data-sort-group="' + group + '"]').forEach(function(node) {
    var th = node as HTMLElement
    var headerKey = th.getAttribute('data-sort-key') || ''
    var arrow = th.querySelector('.sort-arrow') as HTMLElement | null
    th.classList.remove('th-sort-asc', 'th-sort-desc')
    if (headerKey === key) {
      th.classList.add(dir === 'asc' ? 'th-sort-asc' : 'th-sort-desc')
      if (arrow) {
        arrow.textContent = dir === 'asc' ? '▲' : '▼'
        arrow.style.opacity = '1'
      }
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending')
    } else {
      if (arrow) {
        arrow.textContent = '▼'
        arrow.style.opacity = '0.45'
      }
      th.setAttribute('aria-sort', 'none')
    }
  })
}

function sortTransactionRows(rows) {
  return rows.slice().sort(function(a, b) {
    var result = 0
    if (txSortKey === 'time') result = toRecordTime(a.time) - toRecordTime(b.time)
    else if (txSortKey === 'member') result = compareRecordText(a.member, b.member)
    else if (txSortKey === 'type') result = compareRecordText(a.type, b.type)
    if (result === 0) return 0
    return txSortDir === 'asc' ? result : -result
  })
}

function sortOplogRows(rows) {
  return rows.slice().sort(function(a, b) {
    var result = 0
    if (oplogSortKey === 'time') result = toRecordTime(a.time) - toRecordTime(b.time)
    else if (oplogSortKey === 'operator') result = compareRecordText(a.operator, b.operator)
    else if (oplogSortKey === 'action') result = compareRecordText(a.action, b.action)
    if (result === 0) return 0
    return oplogSortDir === 'asc' ? result : -result
  })
}

function renderOplogBody(body, rows) {
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" style="padding:24px 12px;text-align:center;color:#94a3b8;">暂无操作日志</td></tr>'
    return
  }
  body.innerHTML = rows.map(function(item) {
    return '<tr><td class="text-muted">' + item.time + '</td><td>' + item.operator + '</td><td>' + pTag(item.action) + '</td><td>' + item.target + '<span class="text-muted"> · ' + item.result + '</span></td></tr>'
  }).join('')
}

function renderOverviewOplogBody(body, rows) {
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" style="padding:24px 12px;text-align:center;color:#94a3b8;">暂无操作日志</td></tr>'
    return
  }
  body.innerHTML = rows.map(function(item) {
    return '<tr><td class="text-muted">' + item.time + '</td><td>' + item.operator + '</td><td>' + item.action + '</td><td>' + item.target + '<span class="text-muted"> · ' + item.result + '</span></td></tr>'
  }).join('')
}

function injectTableSkeletonRows(body, rowCount) {
  body.innerHTML = ''
  var table = body.closest('table') as HTMLTableElement | null
  var headRow = table ? table.querySelector('thead tr') : null
  var colCount = headRow ? headRow.children.length : 6
  if (!colCount) colCount = 6
  for (var rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    var row = document.createElement('tr')
    row.className = 'skeleton-row'
    for (var colIndex = 0; colIndex < colCount; colIndex += 1) {
      var cell = document.createElement('td')
      cell.innerHTML = '<span class="skeleton-cell"></span>'
      row.appendChild(cell)
    }
    body.appendChild(row)
  }
}

function hasOptimisticRows(items) {
  return items.some(function(item) { return Boolean(item && item.__optimistic) })
}

function applyTransactionState(data) {
  if (!data.items.length && !data.total && hasOptimisticRows(transactionState.items)) return
  transactionState.items = data.items.slice()
  transactionState.total = data.total
  transactionState.loaded = true
  replaceTransactionData(transactionState.items)
}

function applyOplogState(data) {
  if (!data.items.length && !data.total && hasOptimisticRows(oplogState.items)) return
  oplogState.items = data.items.slice()
  oplogState.total = data.total
  oplogState.loaded = true
  replaceOplogData(oplogState.items)
}

function prependOptimisticTransaction(item) {
  transactionState.items = [item].concat(transactionState.items)
  transactionState.total = Math.max(transactionState.total + 1, transactionState.items.length)
  transactionState.loaded = true
  replaceTransactionData(transactionState.items)
}

function prependOptimisticOplog(item) {
  oplogState.items = [item].concat(oplogState.items)
  oplogState.total = Math.max(oplogState.total + 1, oplogState.items.length)
  oplogState.loaded = true
  replaceOplogData(oplogState.items)
}

function clampRecordPage(tab, totalItems) {
  var state = paginationState[tab]
  var totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize))
  if (state.page < 1) state.page = 1
  if (state.page > totalPages) state.page = totalPages
}

function padDate(value) {
  return String(value).padStart(2, '0')
}

function normalizeDate(timeStr) {
  var text = String(timeStr || '').trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  if (/^\d{4}\//.test(text)) {
    var parsedYear = new Date(text)
    if (!isNaN(parsedYear.getTime())) {
      return parsedYear.getFullYear() + '-' + padDate(parsedYear.getMonth() + 1) + '-' + padDate(parsedYear.getDate())
    }
  }
  var parsed = new Date('2026/' + text)
  if (!isNaN(parsed.getTime())) {
    return parsed.getFullYear() + '-' + padDate(parsed.getMonth() + 1) + '-' + padDate(parsed.getDate())
  }
  var datePart = text.split(' ')[0]
  var parts = datePart.split('/')
  if (parts.length === 2) return '2026-' + parts[0].padStart(2,'0') + '-' + parts[1].padStart(2,'0')
  return ''
}

function filterByDate(items, tab, timeField) {
  var state = paginationState[tab]
  if (!state || (!state.dateStart && !state.dateEnd)) return items
  return items.filter(function(item) {
    var normalized = normalizeDate(item[timeField])
    if (!normalized) return true
    if (state.dateStart && normalized < state.dateStart) return false
    if (state.dateEnd && normalized > state.dateEnd) return false
    return true
  })
}

function normalizeOplogAction(value) {
  return value === '分发积分' ? '分发算力豆' : value
}

function filterTransactionsForView(items) {
  var filtered = filterByDate(items, 'transactions', 'time')
  var typeFilter = document.getElementById('transTypeFilter') as HTMLSelectElement
  if (typeFilter && typeFilter.value !== '全部类型') {
    filtered = filtered.filter(function(item) { return item.type === typeFilter.value })
  }
  var memberFilter = document.getElementById('txMemberFilter') as HTMLSelectElement
  if (memberFilter && memberFilter.value) {
    filtered = filtered.filter(function(item) { return item.member === memberFilter.value })
  }
  return sortTransactionRows(filtered)
}

function filterOplogForView(items) {
  var filtered = filterByDate(items, 'oplog', 'time')
  var typeFilter = document.getElementById('oplogTypeFilter') as HTMLSelectElement
  if (typeFilter && typeFilter.value !== '全部类型') {
    var normalizedType = normalizeOplogAction(typeFilter.value)
    filtered = filtered.filter(function(item) { return normalizeOplogAction(item.action) === normalizedType })
  }
  return sortOplogRows(filtered)
}

var recCalState = { tab:'', field:'', viewYear:2026, viewMonth:3, open:false }
let _recCalOpen = false
let _recCalDocClickBound = false

function bindRecCalDocClick() {
  if (_recCalDocClickBound) return
  _recCalDocClickBound = true
  document.addEventListener('click', function(e) {
    if (!_recCalOpen) return
    recCalOutside(e)
  })
}

function fmtDate(y,m,d) { return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0') }
function displayDate(iso) { if(!iso) return '选择日期'; var p=iso.split('-'); return p[1]+'/'+p[2] }

function renderRecCal() {
  var drop = document.getElementById('recCalDrop')
  if(!drop) return
  var y=recCalState.viewYear, m=recCalState.viewMonth
  var first=new Date(y,m,1).getDay(), days=new Date(y,m+1,0).getDate()
  var today=new Date(); var todayStr=fmtDate(today.getFullYear(),today.getMonth(),today.getDate())
  var state=paginationState[recCalState.tab]
  var cells=''
  for(var i=0;i<first;i++) cells+='<div class="cal-cell other-month"></div>'
  for(var d=1;d<=days;d++){
    var iso=fmtDate(y,m,d)
    var cls='cal-cell'
    if(iso===todayStr) cls+=' today'
    if(recCalState.field==='start'&&state.dateStart===iso) cls+=' selected'
    if(recCalState.field==='end'&&state.dateEnd===iso) cls+=' selected'
    if(state.dateStart&&state.dateEnd&&iso>=state.dateStart&&iso<=state.dateEnd) cls+=' in-range'
    cells+='<div class="'+cls+'" onclick="recCalPick(\''+iso+'\')">'+d+'</div>'
  }
  var monthNames=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
  drop.innerHTML=
    '<div class="cal-nav"><button class="cal-nav-btn" onclick="recCalNav(-1)">‹</button><span class="cal-nav-title">'+y+'年 '+monthNames[m]+'</span><button class="cal-nav-btn" onclick="recCalNav(1)">›</button></div>'+
    '<div class="cal-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>'+
    '<div class="cal-grid">'+cells+'</div>'
}

function openRecCal(tab, field, anchorEl) {
  var existing=document.getElementById('recCalDrop')
  if(existing&&_recCalOpen&&recCalState.tab===tab&&recCalState.field===field){closeRecCal();return}
  if(existing) existing.remove()
  _recCalOpen=true
  bindRecCalDocClick()
  recCalState.tab=tab; recCalState.field=field; recCalState.open=true
  var now=new Date(); recCalState.viewYear=now.getFullYear(); recCalState.viewMonth=now.getMonth()
  var drop=document.createElement('div')
  drop.id='recCalDrop'; drop.className='record-cal-dropdown'
  anchorEl.parentElement.style.position='relative'
  anchorEl.parentElement.appendChild(drop)
  renderRecCal()
}

function closeRecCal(){
  _recCalOpen=false
  recCalState.open=false
  var d=document.getElementById('recCalDrop');if(d)d.remove()
}

function recCalOutside(e){
  var d=document.getElementById('recCalDrop')
  if(d&&!d.contains(e.target)&&!e.target.closest('.rec-date-box')){closeRecCal()}
}

function recCalPick(iso){
  var state=paginationState[recCalState.tab]
  if(recCalState.field==='start') state.dateStart=iso
  else state.dateEnd=iso
  if(state.dateStart&&state.dateEnd&&state.dateStart>state.dateEnd){
    var tmp=state.dateStart;state.dateStart=state.dateEnd;state.dateEnd=tmp
  }
  state.page=1
  closeRecCal()
  updateDateDisplay(recCalState.tab)
  renderRecordTab(recCalState.tab)
}

function recCalNav(dir){
  recCalState.viewMonth+=dir
  if(recCalState.viewMonth<0){recCalState.viewMonth=11;recCalState.viewYear--}
  if(recCalState.viewMonth>11){recCalState.viewMonth=0;recCalState.viewYear++}
  renderRecCal()
}

function updateDateDisplay(tab) {
  var panel=document.getElementById('recordTab-'+tab);if(!panel)return
  var state=paginationState[tab]
  var startBox=panel.querySelector('.rec-date-start')
  var endBox=panel.querySelector('.rec-date-end')
  if(startBox) startBox.textContent=displayDate(state.dateStart)
  if(endBox) endBox.textContent=displayDate(state.dateEnd)
}

function renderDateFilter(tab) {
  var panel = document.getElementById('recordTab-' + tab)
  if (!panel) return
  var toolbar = panel.querySelector('.toolbar')
  if (!toolbar || toolbar.querySelector('.date-filter-group')) return
  var group = document.createElement('div')
  var state = paginationState[tab]
  group.className = 'date-filter-group'
  group.setAttribute('style', 'display:flex;align-items:center;gap:6px;margin-left:8px;')
  group.innerHTML =
    '<div class="rec-date-box" onclick="openRecCal(\''+tab+'\',\'start\',this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span class="rec-date-start">'+displayDate(state.dateStart)+'</span></div>' +
    '<span style="color:#a1a1aa;font-size:12px;">至</span>' +
    '<div class="rec-date-box" onclick="openRecCal(\''+tab+'\',\'end\',this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span class="rec-date-end">'+displayDate(state.dateEnd)+'</span></div>'
  var toolbarRight = toolbar.querySelector('.toolbar-right')
  if (toolbarRight) toolbar.insertBefore(group, toolbarRight)
  else toolbar.appendChild(group)
}

function updatePagination(tab, totalItems) {
  var state = paginationState[tab]
  var totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize))
  var panel = document.getElementById('recordTab-' + tab)
  if (!panel) return
  var info = panel.querySelector('.pagi-info') as any
  var prevBtn = panel.querySelector('.pagination-btn[data-direction="-1"]') as any
  var nextBtn = panel.querySelector('.pagination-btn[data-direction="1"]') as any
  var sizeSelect = panel.querySelector('.page-size-select select') as any
  if (sizeSelect) sizeSelect.value = String(state.pageSize)
  if (info) info.textContent = '第 ' + state.page + ' 页，共 ' + totalPages + ' 页（' + totalItems + ' 条记录）'
  if (prevBtn) prevBtn.disabled = state.page <= 1
  if (nextBtn) nextBtn.disabled = state.page >= totalPages
  var btnsDiv = panel.querySelector('.pagination-btns') as any
  if (btnsDiv && !btnsDiv.querySelector('.page-jump')) {
    var pageJump = document.createElement('div')
    pageJump.className = 'page-jump'
    pageJump.setAttribute('style', 'display:inline-flex;align-items:center;gap:4px;margin:0 8px;')
    pageJump.innerHTML =
      '<input type="number" min="1" class="page-jump-input" style="width:52px;padding:4px 6px;border:1px solid #e4e4e7;border-radius:6px;font-size:12px;text-align:center;">' +
      '<button class="pagination-btn" onclick="jumpToPage(\'' + tab + '\')">跳转</button>'
    if (nextBtn && nextBtn.parentNode === btnsDiv) btnsDiv.insertBefore(pageJump, nextBtn)
    else btnsDiv.appendChild(pageJump)
  }
  var jumpInput = panel.querySelector('.page-jump-input') as any
  if (jumpInput) {
    jumpInput.max = String(totalPages)
    jumpInput.placeholder = String(state.page)
  }
}

function ensureMemberFilter() {
  var select = document.getElementById('txMemberFilter') as HTMLSelectElement
  if (!select || select.options.length > 1) return
  membersData.forEach(function(m) {
    var opt = document.createElement('option')
    opt.value = m.name
    opt.textContent = m.name
    select.appendChild(opt)
  })
  select.onchange = function() { renderTransactions(1, 20) }
}

function paintTransactions() {
  ensureMemberFilter()
  renderDateFilter('transactions')
  var body = document.getElementById('transactions-tbody')
  if (!body) {
    syncRecordSortHeaders('transactions', txSortKey, txSortDir)
    return
  }
  clampRecordPage('transactions', transactionState.total)
  var rows = filterTransactionsForView(transactionState.items)
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" style="padding:24px 12px;text-align:center;color:#94a3b8;">暂无交易记录</td></tr>'
    syncRecordSortHeaders('transactions', txSortKey, txSortDir)
    updatePagination('transactions', transactionState.total)
    return
  }
  body.innerHTML = rows.map(function(item) {
    var changeClass = item.change > 0 ? 'text-green' : 'text-red'
    var changeText = item.change > 0 ? '+' + item.change.toLocaleString() : item.change.toLocaleString()
    return '<tr><td class="text-muted">' + item.time + '</td><td>' + item.member + '</td><td>' + item.type + '</td><td>' + item.desc + '</td><td class="' + changeClass + '">' + changeText + '</td><td class="td-mono">' + item.balance.toLocaleString() + '</td></tr>'
  }).join('')
  syncRecordSortHeaders('transactions', txSortKey, txSortDir)
  updatePagination('transactions', transactionState.total)
}

function paintOplog() {
  renderDateFilter('oplog')
  var body = document.getElementById('oplog-tbody')
  if (!body) {
    syncRecordSortHeaders('oplog', oplogSortKey, oplogSortDir)
    return
  }
  clampRecordPage('oplog', oplogState.total)
  renderOplogBody(body, filterOplogForView(oplogState.items))
  syncRecordSortHeaders('oplog', oplogSortKey, oplogSortDir)
  updatePagination('oplog', oplogState.total)
}

function paintOverviewOplog(items, limit) {
  var body = document.getElementById('overviewOplogTbody')
  if (!body) {
    syncRecordSortHeaders('oplog', oplogSortKey, oplogSortDir)
    return
  }
  var rows = sortOplogRows(items).slice(0, limit)
  renderOverviewOplogBody(body, rows)
  syncRecordSortHeaders('oplog', oplogSortKey, oplogSortDir)
}

registerRecordOptimisticHandlers({
  onTransactionRecord: function(item) {
    prependOptimisticTransaction(item)
    paintTransactions()
  },
  onOplogRecord: function(item) {
    prependOptimisticOplog(item)
    paintOplog()
    paintOverviewOplog(oplogState.items, overviewOplogLimit)
  },
})

export async function renderOverviewOplogTable(limit?) {
  var body = document.getElementById('overviewOplogTbody')
  if (!body) {
    syncRecordSortHeaders('oplog', oplogSortKey, oplogSortDir)
    return
  }
  var count = typeof limit === 'number' ? Math.min(limit, 5) : overviewOplogLimit
  overviewOplogLimit = count
  var data = await fetchAuditLog(1, count)
  var items = data.items.length || data.total ? data.items : (hasOptimisticRows(oplogState.items) ? oplogState.items : [])
  paintOverviewOplog(items, count)
}

export function sortTransactions(key: 'time' | 'member' | 'type') {
  if (txSortKey === key) txSortDir = txSortDir === 'asc' ? 'desc' : 'asc'
  else {
    txSortKey = key
    txSortDir = 'desc'
  }
  renderRecordTab('transactions')
}

export function sortOplog(key: 'time' | 'operator' | 'action') {
  if (oplogSortKey === key) oplogSortDir = oplogSortDir === 'asc' ? 'desc' : 'asc'
  else {
    oplogSortKey = key
    oplogSortDir = 'desc'
  }
  renderRecordTab('oplog')
  renderOverviewOplogTable(overviewOplogLimit)
}

export function switchRecordTab(tab, btn) {
  document.querySelectorAll('#page-records .tab-btn').forEach(function(b) { b.classList.remove('active') })
  document.querySelectorAll('#page-records .tab-content').forEach(function(c) { c.classList.remove('active', 'tab-slide-in') })
  btn.classList.add('active')
  var el = document.getElementById('recordTab-' + tab)
  if (el) { el.classList.add('active', 'tab-slide-in'); setTimeout(function() { el.classList.remove('tab-slide-in') }, 250) }
  if (tab === 'oplog') {
    if (_oplogLoaded) return
    return renderOplog(1, 20)
  }
  if (tab === 'transactions') {
    if (_transactionsLoaded) return
    return renderTransactions(1, 20)
  }
  renderRecordTab(tab)
}

export async function renderTransactions(page, pageSize) {
  _transactionsLoaded = false
  ensureMemberFilter()
  renderDateFilter('transactions')
  var body = document.getElementById('transactions-tbody')
  var state = paginationState.transactions
  if (!body) {
    syncRecordSortHeaders('transactions', txSortKey, txSortDir)
    return
  }
  var wrap = body.closest('.table-wrap')
  var overlay: HTMLElement | null = null
  if (typeof page === 'number') state.page = page
  if (typeof pageSize === 'number') state.pageSize = pageSize
  var showTimer = setTimeout(function() {
    if (!wrap) return
    injectTableSkeletonRows(body, 20)
    overlay = document.createElement('div')
    overlay.className = 'table-loader-overlay'
    overlay.innerHTML = '<div class="loader-spinner"></div><div class="loader-text">加载中...</div>'
    wrap.appendChild(overlay)
    body.classList.add('is-loading')
  }, 150)
  try {
    var data = await fetchTransactions(state.page, state.pageSize)
    applyTransactionState(data)
    _transactionsLoaded = true
    var totalPages = Math.max(1, Math.ceil(Math.max(transactionState.total, 1) / state.pageSize))
    if (state.page > totalPages) {
      state.page = totalPages
      return renderTransactions(state.page, state.pageSize)
    }
    paintTransactions()
  } finally {
    clearTimeout(showTimer)
    if (overlay) overlay.remove()
    body.classList.remove('is-loading')
  }
}

export async function renderOplog(page, pageSize) {
  _oplogLoaded = false
  renderDateFilter('oplog')
  var body = document.getElementById('oplog-tbody')
  var state = paginationState.oplog
  if (!body) {
    syncRecordSortHeaders('oplog', oplogSortKey, oplogSortDir)
    return
  }
  var wrap = body.closest('.table-wrap')
  var overlay: HTMLElement | null = null
  if (typeof page === 'number') state.page = page
  if (typeof pageSize === 'number') state.pageSize = pageSize
  var showTimer = setTimeout(function() {
    if (!wrap) return
    injectTableSkeletonRows(body, 20)
    overlay = document.createElement('div')
    overlay.className = 'table-loader-overlay'
    overlay.innerHTML = '<div class="loader-spinner"></div><div class="loader-text">加载中...</div>'
    wrap.appendChild(overlay)
    body.classList.add('is-loading')
  }, 150)
  try {
    var data = await fetchAuditLog(state.page, state.pageSize)
    applyOplogState(data)
    _oplogLoaded = true
    var totalPages = Math.max(1, Math.ceil(Math.max(oplogState.total, 1) / state.pageSize))
    if (state.page > totalPages) {
      state.page = totalPages
      return renderOplog(state.page, state.pageSize)
    }
    paintOplog()
  } finally {
    clearTimeout(showTimer)
    if (overlay) overlay.remove()
    body.classList.remove('is-loading')
  }
}

export function changePageSize(tab, size) {
  paginationState[tab].pageSize = parseInt(size, 10)
  paginationState[tab].page = 1
  renderRecordTab(tab)
}

export function goPage(tab, direction) {
  paginationState[tab].page += direction
  renderRecordTab(tab)
}

function jumpToPage(tab) {
  var panel = document.getElementById('recordTab-' + tab)
  var input = panel ? panel.querySelector('.page-jump-input') as any : null
  if (!input || !input.value) return
  var pageNum = parseInt(input.value, 10)
  if (isNaN(pageNum) || pageNum < 1) return
  paginationState[tab].page = pageNum
  input.value = ''
  renderRecordTab(tab)
}

export function renderRecordTab(tab) {
  var state = paginationState[tab]
  if (!state) return
  if (tab === 'transactions') return renderTransactions(state.page, state.pageSize)
  if (tab === 'oplog') return renderOplog(state.page, state.pageSize)
}

function csvVal(v) { return (v === undefined || v === null || v === '') ? 'N/A' : v }

async function fetchAllTransactionItems() {
  var firstPageSize = 100
  var first = await fetchTransactions(1, firstPageSize)
  if (!first.items.length && !first.total && transactionState.items.length) {
    return { items: transactionState.items.slice(), total: transactionState.total || transactionState.items.length }
  }
  var items = first.items.slice()
  var total = first.total
  var totalPages = Math.max(1, Math.ceil(Math.max(total, items.length) / firstPageSize))
  for (var page = 2; page <= totalPages; page += 1) {
    var next = await fetchTransactions(page, firstPageSize)
    if (!next.items.length) break
    items = items.concat(next.items)
  }
  return { items: items, total: total }
}

async function fetchAllOplogItems() {
  var firstPageSize = 100
  var first = await fetchAuditLog(1, firstPageSize)
  if (!first.items.length && !first.total && oplogState.items.length) {
    return { items: oplogState.items.slice(), total: oplogState.total || oplogState.items.length }
  }
  var items = first.items.slice()
  var total = first.total
  var totalPages = Math.max(1, Math.ceil(Math.max(total, items.length) / firstPageSize))
  for (var page = 2; page <= totalPages; page += 1) {
    var next = await fetchAuditLog(page, firstPageSize)
    if (!next.items.length) break
    items = items.concat(next.items)
  }
  return { items: items, total: total }
}

export async function exportTransactions() {
  var data = await fetchAllTransactionItems()
  var filtered = filterByDate(data.items, 'transactions', 'time')
  var headers = ['时间', '成员', '类型', '说明', '变动', '余额']
  var rows = filtered.map(function(item) {
    return [csvVal(item.time), csvVal(item.member), csvVal(item.type), csvVal(item.desc), csvVal(item.change), csvVal(item.balance)]
  })
  downloadCSV('交易历史_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows)
}

export async function exportOplog() {
  var data = await fetchAllOplogItems()
  var filtered = filterByDate(data.items, 'oplog', 'time')
  var typeFilter = document.getElementById('oplogTypeFilter') as HTMLSelectElement
  if (typeFilter && typeFilter.value !== '全部类型') {
    var normalizedType = normalizeOplogAction(typeFilter.value)
    filtered = filtered.filter(function(item) { return normalizeOplogAction(item.action) === normalizedType })
  }
  var headers = ['时间', '操作人', '操作类型', '详情', '结果']
  var rows = filtered.map(function(item) {
    return [csvVal(item.time), csvVal(item.operator), csvVal(item.action), csvVal(item.target), csvVal(item.result)]
  })
  downloadCSV('操作日志_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows)
}

Object.assign(window as any, {
  jumpToPage,
  openRecCal,
  recCalPick,
  recCalNav,
  sortTransactions,
  sortOplog,
})

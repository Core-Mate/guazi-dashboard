import { accountList } from '../data/accounts'
import { fmtHM } from '../data/helpers'
import { downloadCSV } from './export-utils'
import type { AccountWeekSummary } from './api-integration'
import { fetchAccountWeekSummary, getDashboardTenantId } from './api-integration'
import { drawSparkline } from './charts'
import { getContentClampBounds, smoothToggleCollapse } from './utils'

var accountSortState: { col: string; dir: 'asc' | 'desc' } = { col: '', dir: 'asc' }
var accountSearchQuery = '';
var accountSummarySuccessCount = 0;
var accountHoverCardEl: HTMLElement | null = null
var accountHoverTimer: number | null = null
var accountHoverRow: HTMLElement | null = null
var accountHoverRowId = ''
var accountHoverCache: Record<string, AccountWeekSummary> = {}
var accountHoverErrorCache: Record<string, boolean> = {}
var accountHoverPending: Record<string, Promise<AccountWeekSummary>> = {}
var accountHoverGlobalsBound = false

var platformLabelMap: Record<string, string> = {
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

function normalizeAccountSortKey(col: string) {
  if (col === 'saves') return 'favorites'
  if (col === 'reach') return 'uniqueReach'
  return col
}

function getAccountFavorites(row: any) {
  return toNumber(row && (row.favorites ?? row.saves))
}

function getAccountUniqueReach(row: any) {
  return toNumber(row && (row.uniqueReach ?? row.reach))
}

function getAccountById(accountId: string) {
  for (var i = 0; i < accountList.length; i++) {
    if (String(accountList[i] && accountList[i].id || '') === String(accountId || '')) return accountList[i]
  }
  return null
}

function formatAccountRole(role: any): string {
  var key = String(role || '').trim().toLowerCase()
  if (!key) return '未设置角色'
  if (key === 'admin') return '管理员'
  if (key === 'user' || key === 'member') return '成员'
  return String(role)
}

function formatAccountPlatforms(platforms: any): string {
  if (!Array.isArray(platforms) || !platforms.length) return '未设置平台'
  return platforms.map(function(platform) {
    var key = String(platform || '').trim().toLowerCase()
    return platformLabelMap[key] || String(platform || '')
  }).filter(Boolean).join(' / ')
}

function formatMetricValue(value: number): string {
  return value > 0 ? value.toLocaleString() : '0'
}

function formatRuntimeHours(value: any): string {
  var hours = toNumber(value)
  return hours > 0 ? hours.toFixed(1) + 'h' : '0.0h'
}

function clearAccountHoverTimer() {
  if (accountHoverTimer == null) return
  window.clearTimeout(accountHoverTimer)
  accountHoverTimer = null
}

function ensureAccountHoverCard(): HTMLElement {
  if (accountHoverCardEl) return accountHoverCardEl
  var card = document.createElement('div')
  card.className = 'account-hover-card'
  card.id = 'account-hover-card'
  card.innerHTML =
    '<div class="account-hover-head">' +
      '<div class="account-hover-avatar"></div>' +
      '<div class="account-hover-identity">' +
        '<div class="account-hover-name"></div>' +
        '<div class="account-hover-meta"></div>' +
      '</div>' +
    '</div>' +
    '<div class="account-hover-metrics">' +
      '<div class="metric"><span class="v"></span><span class="k">完成</span></div>' +
      '<div class="metric"><span class="v"></span><span class="k">算力豆</span></div>' +
      '<div class="metric"><span class="v"></span><span class="k">时长</span></div>' +
      '<div class="metric"><span class="v"></span><span class="k">触达</span></div>' +
    '</div>' +
    '<canvas class="account-hover-spark"></canvas>' +
    '<div class="account-hover-caption">近 7 天完成数趋势</div>'
  document.body.appendChild(card)
  accountHoverCardEl = card
  if (!accountHoverGlobalsBound) {
    window.addEventListener('scroll', hideAccountHoverCard, true)
    window.addEventListener('resize', hideAccountHoverCard)
    accountHoverGlobalsBound = true
  }
  return card
}

function positionAccountHoverCard(card: HTMLElement, row: HTMLElement) {
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

function applyAccountHoverIdentity(card: HTMLElement, summary?: AccountWeekSummary | null, fallback?: any) {
  var account = summary && summary.account ? summary.account : null
  var name = account && account.name ? account.name : String(fallback && fallback.name || fallback && fallback.username || '账号详情')
  var roleText = account ? formatAccountRole(account.role) : formatAccountRole(fallback && fallback.role)
  var deptText = account && account.dept ? account.dept : '未设置部门'
  var platformText = account ? formatAccountPlatforms(account.platforms) : '加载中'
  var avatar = card.querySelector('.account-hover-avatar') as HTMLElement | null
  var nameEl = card.querySelector('.account-hover-name') as HTMLElement | null
  var metaEl = card.querySelector('.account-hover-meta') as HTMLElement | null
  if (avatar) avatar.textContent = name ? name.charAt(0) : '—'
  if (nameEl) nameEl.textContent = name
  if (metaEl) metaEl.textContent = [roleText, deptText, platformText].filter(Boolean).join(' · ')
}

function renderAccountHoverLoading(row: HTMLElement, accountId: string) {
  var card = ensureAccountHoverCard()
  var fallback = getAccountById(accountId)
  applyAccountHoverIdentity(card, null, fallback)
  var metrics = card.querySelector('.account-hover-metrics') as HTMLElement | null
  var spark = card.querySelector('.account-hover-spark') as HTMLCanvasElement | null
  var caption = card.querySelector('.account-hover-caption') as HTMLElement | null
  if (metrics) metrics.innerHTML = '<div style="padding:12px 0;width:100%;text-align:center;color:var(--color-text-2);font-size:12px;">加载中...</div>'
  if (spark) spark.style.display = 'none'
  if (caption) caption.textContent = ''
  positionAccountHoverCard(card, row)
  card.classList.add('visible')
}

function renderAccountHoverError(row: HTMLElement, accountId: string) {
  var card = ensureAccountHoverCard()
  var fallback = getAccountById(accountId)
  applyAccountHoverIdentity(card, null, fallback)
  var metrics = card.querySelector('.account-hover-metrics') as HTMLElement | null
  var spark = card.querySelector('.account-hover-spark') as HTMLCanvasElement | null
  var caption = card.querySelector('.account-hover-caption') as HTMLElement | null
  if (metrics) metrics.innerHTML = '<div style="padding:12px 0;width:100%;text-align:center;color:var(--color-text-2);font-size:12px;">加载失败</div>'
  if (spark) spark.style.display = 'none'
  if (caption) caption.textContent = ''
  positionAccountHoverCard(card, row)
  card.classList.add('visible')
}

function renderAccountHoverSummary(row: HTMLElement, data: AccountWeekSummary) {
  var card = ensureAccountHoverCard()
  applyAccountHoverIdentity(card, data, getAccountById(String(data.account && data.account.id || '')))
  var metrics = card.querySelector('.account-hover-metrics') as HTMLElement | null
  var spark = card.querySelector('.account-hover-spark') as HTMLCanvasElement | null
  var caption = card.querySelector('.account-hover-caption') as HTMLElement | null
  if (metrics) {
    metrics.innerHTML =
      '<div class="metric"><span class="v">' + formatMetricValue(toNumber(data.summary && data.summary.complete)) + '</span><span class="k">完成</span></div>' +
      '<div class="metric"><span class="v">' + formatMetricValue(toNumber(data.summary && data.summary.credits)) + '</span><span class="k">算力豆</span></div>' +
      '<div class="metric"><span class="v">' + formatRuntimeHours(data.summary && data.summary.runtime_h) + '</span><span class="k">时长</span></div>' +
      '<div class="metric"><span class="v">' + formatMetricValue(toNumber(data.summary && data.summary.reach)) + '</span><span class="k">触达</span></div>'
  }
  if (spark) {
    spark.style.display = ''
  }
  if (caption) caption.textContent = '近 7 天完成数趋势'
  positionAccountHoverCard(card, row)
  card.classList.add('visible')
  if (spark) {
    requestAnimationFrame(function() {
      if (accountHoverRow !== row || accountHoverRowId !== String(data.account && data.account.id || '')) return
      drawSparkline(spark, Array.isArray(data.complete_series) ? data.complete_series : [], '#2563eb')
    })
  }
}

function hideAccountHoverCard() {
  clearAccountHoverTimer()
  accountHoverRow = null
  accountHoverRowId = ''
  if (accountHoverCardEl) accountHoverCardEl.classList.remove('visible')
}

function loadAccountHoverSummary(accountId: string, tenantId: string): Promise<AccountWeekSummary> {
  if (accountHoverCache[accountId]) return Promise.resolve(accountHoverCache[accountId])
  if (accountHoverPending[accountId]) return accountHoverPending[accountId]
  var pending = fetchAccountWeekSummary(accountId, tenantId).then(function(data) {
    accountHoverCache[accountId] = data
    delete accountHoverPending[accountId]
    delete accountHoverErrorCache[accountId]
    return data
  }).catch(function(err) {
    delete accountHoverPending[accountId]
    accountHoverErrorCache[accountId] = true
    throw err
  })
  accountHoverPending[accountId] = pending
  return pending
}

function scheduleAccountHoverCard(row: HTMLElement) {
  var accountId = String(row.getAttribute('data-account-id') || '').trim()
  if (!accountId) return
  clearAccountHoverTimer()
  accountHoverRow = row
  accountHoverRowId = accountId
  accountHoverTimer = window.setTimeout(function() {
    accountHoverTimer = null
    if (accountHoverRow !== row || accountHoverRowId !== accountId) return
    if (accountHoverCache[accountId]) {
      renderAccountHoverSummary(row, accountHoverCache[accountId])
      return
    }
    if (accountHoverErrorCache[accountId]) {
      renderAccountHoverError(row, accountId)
      return
    }
    renderAccountHoverLoading(row, accountId)
    loadAccountHoverSummary(accountId, getDashboardTenantId()).then(function(data) {
      if (accountHoverRow !== row || accountHoverRowId !== accountId) return
      renderAccountHoverSummary(row, data)
    }).catch(function() {
      if (accountHoverRow !== row || accountHoverRowId !== accountId) return
      renderAccountHoverError(row, accountId)
    })
  }, 200)
}

function bindAccountHoverCard(tbody: HTMLElement) {
  var boundBody = tbody as HTMLElement & { __accountHoverBound?: boolean }
  if (boundBody.__accountHoverBound) return
  boundBody.__accountHoverBound = true
  tbody.addEventListener('mouseover', function(e: Event) {
    var target = e.target as HTMLElement | null
    if (!target) return
    var row = target.closest('tr[data-account-id]') as HTMLElement | null
    if (!row || !tbody.contains(row)) return
    if (accountHoverRow === row && accountHoverCardEl && accountHoverCardEl.classList.contains('visible')) return
    if (accountHoverRow && accountHoverRow !== row) {
      clearAccountHoverTimer()
      if (accountHoverCardEl) accountHoverCardEl.classList.remove('visible')
    }
    scheduleAccountHoverCard(row)
  })
  tbody.addEventListener('mouseleave', function() {
    hideAccountHoverCard()
  })
}

export function searchAccount(query) {
  accountSearchQuery = (query || '').toLowerCase();
  renderAccountAcquireGroup();
}

export function sortAccount(col: string) {
  var key = normalizeAccountSortKey(col)
  if (accountSortState.col === key) accountSortState.dir = accountSortState.dir === 'asc' ? 'desc' : 'asc'
  else {
    accountSortState.col = key
    accountSortState.dir = 'asc'
  }
  renderAccountAcquireGroup()
}

function parseAccountDuration(value: any) {
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
  return toNumber(text)
}

function sortAccounts(rows: any[]) {
  if (!accountSortState.col) return rows
  return rows.slice().sort(function(a, b) {
    var va: any = ''
    var vb: any = ''
    if (accountSortState.col === 'name') {
      va = String(a.name || '').toLowerCase()
      vb = String(b.name || '').toLowerCase()
    } else if (accountSortState.col === 'success') {
      va = toNumber(a.successCount)
      vb = toNumber(b.successCount)
    } else if (accountSortState.col === 'credits') {
      va = toNumber(a.tokenUsed)
      vb = toNumber(b.tokenUsed)
    } else if (accountSortState.col === 'duration') {
      va = toNumber(a.durationSec ?? parseAccountDuration(a.successDuration))
      vb = toNumber(b.durationSec ?? parseAccountDuration(b.successDuration))
    } else if (accountSortState.col === 'comments') {
      va = toNumber(a.comments)
      vb = toNumber(b.comments)
    } else if (accountSortState.col === 'likes') {
      va = toNumber(a.likes)
      vb = toNumber(b.likes)
    } else if (accountSortState.col === 'favorites' || accountSortState.col === 'saves') {
      va = getAccountFavorites(a)
      vb = getAccountFavorites(b)
    } else if (accountSortState.col === 'dms') {
      va = toNumber(a.dms)
      vb = toNumber(b.dms)
    } else if (accountSortState.col === 'uniqueReach' || accountSortState.col === 'reach') {
      va = getAccountUniqueReach(a)
      vb = getAccountUniqueReach(b)
    }
    if (va === vb) return 0
    if (accountSortState.dir === 'asc') return va > vb ? 1 : -1
    return va < vb ? 1 : -1
  })
}

function renderAccountHeader(label: string, key?: string) {
  if (!key) return '<th class="td-mono">' + label + '</th>'
  var cls = accountSortState.col === key ? (accountSortState.dir === 'asc' ? 'th-sort-asc' : 'th-sort-desc') : ''
  return '<th class="th-sortable td-mono ' + cls + '" onclick="sortAccount(\'' + key + '\')">' + label + '</th>'
}

export function exportAccountCSV() {
  var rows = accountList.map(function(acc) {
    return [acc.name, acc.successCount, acc.tokenUsed, acc.successDuration, acc.comments, acc.likes, getAccountFavorites(acc), acc.dms, getAccountUniqueReach(acc)];
  });
  downloadCSV('账号明细_' + new Date().toISOString().slice(0,10) + '.csv', ['账号', '完成', '算力豆', '时长 (h:m)', '评论', '点赞', '收藏', '私信', '触达量'], rows);
}

export function renderAccountAcquireGroup() {
  var container = document.getElementById('accountScenarioGroup');
  if (!container) return;
  hideAccountHoverCard()
  var filtered = accountList;
  if (accountSearchQuery) {
    filtered = accountList.filter(function(acc) {
      return (acc.name || '').toLowerCase().indexOf(accountSearchQuery) >= 0;
    });
  }
  filtered = sortAccounts(filtered);
  var totalAccounts = filtered.length;
  var totalCredits = filtered.reduce(function(a, x) { return a + (x.tokenUsed || 0); }, 0);
  var tableRows = filtered.length ? filtered.map(function(acc) {
    function displayVal(v) { return v > 0 ? v.toLocaleString() : '<span class="text-na">暂无</span>'; }
    return '<tr data-account-id="' + String(acc.id || '') + '">' +
      '<td class="td-bold">' + acc.name + '</td>' +
      '<td class="td-mono">' + acc.successCount + '</td>' +
      '<td class="td-mono">' + acc.tokenUsed.toLocaleString() + '</td>' +
      '<td class="td-mono">' + acc.successDuration + '</td>' +
      '<td class="td-mono">' + displayVal(acc.comments) + '</td>' +
      '<td class="td-mono">' + displayVal(acc.likes) + '</td>' +
      '<td class="td-mono">' + displayVal(getAccountFavorites(acc)) + '</td>' +
      '<td class="td-mono">' + displayVal(acc.dms) + '</td>' +
      '<td class="td-mono">' + displayVal(getAccountUniqueReach(acc)) + '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="9" style="padding:24px 12px;text-align:center;color:#94a3b8;">暂无账号数据</td></tr>';
  container.innerHTML =
    '<div class="scenario-card">' +
      '<div class="scenario-card-header" onclick="toggleAccountAcquire()">' +
        '<div class="scenario-card-title"><span class="scenario-icon">🎯</span>获客触达</div>' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
          '<div class="scenario-card-metrics">' +
            '<span>账号: <strong>' + totalAccounts + '</strong></span>' +
            '<span>完成: <strong>' + accountSummarySuccessCount.toLocaleString() + '</strong></span>' +
            '<span>算力豆: <strong>' + totalCredits.toLocaleString() + '</strong></span>' +
          '</div>' +
          '<span class="scenario-chevron open" id="chevAccountAcquire">&#9662;</span>' +
        '</div>' +
      '</div>' +
      '<div class="scenario-card-body" id="bodyAccountAcquire">' +
        '<div class="table-wrap" style="overflow-x:auto;">' +
          '<table>' +
            '<thead><tr>' +
              renderAccountHeader('账号', 'name') +
              renderAccountHeader('完成', 'success') +
              renderAccountHeader('算力豆', 'credits') +
              renderAccountHeader('时长 (h:m)', 'duration') +
              renderAccountHeader('评论', 'comments') +
              renderAccountHeader('点赞', 'likes') +
              renderAccountHeader('收藏', 'favorites') +
              renderAccountHeader('私信', 'dms') +
              renderAccountHeader('触达量', 'uniqueReach') +
            '</tr></thead>' +
            '<tbody>' + tableRows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
    '</div>';
  var tbody = container.querySelector('tbody') as HTMLElement | null
  if (tbody) bindAccountHoverCard(tbody)
}

export function renderAccountMetricsTable() {
  renderAccountAcquireGroup();
}

function toNumber(value: any) {
  var num = typeof value === 'number' ? value : parseFloat(String(value || '').replace(/[^\d.-]/g, ''))
  return isNaN(num) ? 0 : num
}

export function renderAccountsFromAggs(accounts: any[], totals: any) {
  if (!Array.isArray(accounts)) return
  accountList.length = 0
  accounts.forEach(function(account, index) {
    var durationSec = toNumber(account.duration_sec ?? account.durationSec ?? account.total_duration_sec ?? account.avg_duration_sec)
    var favorites = toNumber(account.favorites ?? account.saves)
    var uniqueReach = toNumber(account.uniqueReach ?? account.unique_reach ?? account.reach)
    var successDuration = account.duration_sec != null
      ? fmtHM(account.duration_sec)
      : (account.successDuration || account.success_duration || account.duration || '0h')
    accountList.push({
      id: account.id || account.account_id || 'account-' + (index + 1),
      name: account.name || account.username || account.label || ('账号 ' + (index + 1)),
      role: account.role || '',
      deviceId: account.deviceId || account.device_id || account.device_label || '',
      tokenUsed: toNumber(account.tokenUsed ?? account.token_used ?? account.total_credits ?? account.cost),
      successCount: toNumber(account.successCount ?? account.success_count),
      durationSec: durationSec,
      successDuration: successDuration,
      comments: toNumber(account.comments ?? account.comment_count),
      likes: toNumber(account.likes ?? account.like_count),
      favorites: favorites,
      saves: favorites,
      dms: toNumber(account.dms ?? account.private_messages),
      uniqueReach: uniqueReach,
      reach: uniqueReach,
    })
  })
  accountSummarySuccessCount = toNumber(totals && (totals.successCount ?? totals.success_count))
  renderAccountAcquireGroup()
}

(window as any).toggleAccountAcquire = function() {
  smoothToggleCollapse(document.getElementById('bodyAccountAcquire'), document.getElementById('chevAccountAcquire'));
};

(window as any).sortAccount = sortAccount;
(window as any).searchAccount = searchAccount;
(window as any).exportAccountCSV = exportAccountCSV;

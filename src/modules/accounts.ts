import { accountList } from '../data/accounts'
import { fmtHM } from '../data/helpers'
import { downloadCSV } from './export-utils'
import { smoothToggleCollapse } from './utils'

var accountSortState: { col: string; dir: 'asc' | 'desc' } = { col: '', dir: 'asc' }
var accountSearchQuery = '';

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
  downloadCSV('账号明细_' + new Date().toISOString().slice(0,10) + '.csv', ['账号', '完成数', '算力豆', '时长 (h:m)', '评论', '点赞', '收藏', '私信', '触达量'], rows);
}

export function renderAccountAcquireGroup() {
  var container = document.getElementById('accountScenarioGroup');
  if (!container) return;
  var filtered = accountList;
  if (accountSearchQuery) {
    filtered = accountList.filter(function(acc) {
      return (acc.name || '').toLowerCase().indexOf(accountSearchQuery) >= 0;
    });
  }
  filtered = sortAccounts(filtered);
  var totalAccounts = filtered.length;
  var totalSuccess = filtered.reduce(function(a, x) { return a + (x.successCount || 0); }, 0);
  var totalCredits = filtered.reduce(function(a, x) { return a + (x.tokenUsed || 0); }, 0);
  var tableRows = filtered.length ? filtered.map(function(acc) {
    function displayVal(v) { return v > 0 ? v.toLocaleString() : '<span class="text-na">暂无</span>'; }
    return '<tr>' +
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
            '<span>完成: <strong>' + totalSuccess.toLocaleString() + '</strong></span>' +
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
              renderAccountHeader('完成数', 'success') +
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
      deviceId: account.deviceId || account.device_id || account.device_label || '',
      tokenUsed: toNumber(account.tokenUsed ?? account.token_used ?? account.total_credits ?? account.cost),
      successCount: toNumber(account.successCount ?? account.success_count ?? account.exec_count ?? account.executions),
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
  renderAccountAcquireGroup()

  if (!totals) return
  var header = document.querySelector('#accountScenarioGroup .scenario-card-metrics')
  if (header) {
    var sumSuccess = accountList.reduce(function(a, x) { return a + (x.successCount || 0); }, 0)
    var sumCredits = accountList.reduce(function(a, x) { return a + (x.tokenUsed || 0); }, 0)
    header.innerHTML =
      '<span>账号: <strong>' + toNumber(totals.accounts || accountList.length) + '</strong></span>' +
      '<span>完成: <strong>' + toNumber(totals.success || totals.success_count || sumSuccess).toLocaleString() + '</strong></span>' +
      '<span>算力豆: <strong>' + toNumber(totals.credits || totals.total_credits || sumCredits).toLocaleString() + '</strong></span>'
  }
}

(window as any).toggleAccountAcquire = function() {
  smoothToggleCollapse(document.getElementById('bodyAccountAcquire'), document.getElementById('chevAccountAcquire'));
};

(window as any).sortAccount = sortAccount;
(window as any).searchAccount = searchAccount;
(window as any).exportAccountCSV = exportAccountCSV;

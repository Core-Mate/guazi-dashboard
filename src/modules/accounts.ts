import { accountList } from '../data/accounts'

export function renderAccountMetricsTable() {
  var container = document.getElementById('accountMetricsBody');
  if (!container) return;
  container.innerHTML = accountList.map(function(acc) {
    return '<tr>' +
      '<td class="td-bold">' + acc.name + '</td>' +
      '<td class="td-mono">' + acc.tokenUsed.toLocaleString() + '</td>' +
      '<td class="td-mono">' + acc.successCount + '</td>' +
      '<td class="td-mono">' + acc.successDuration + '</td>' +
      '<td class="td-mono td-beta">—</td>' +
      '<td class="td-mono td-beta">—</td>' +
      '<td class="td-mono td-beta">—</td>' +
      '<td class="td-mono td-beta">—</td>' +
      '<td class="td-mono td-beta">—</td>' +
    '</tr>';
  }).join('');
}

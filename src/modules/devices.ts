import { heatPlatforms, deviceHeat, deviceList, deviceMetrics } from '../data/devices'

const deviceStats = deviceHeat.map(d => {
  let exec=0, errors=0;
  Object.values(d.cells).forEach(c => { exec+=c.exec; errors+=c.fail; });
  return { id:d.id, exec, errors };
});

export function heatClass(exec, fail) {
  if (exec === 0) return 'h-mute';
  const r = fail / exec;
  if (r >= 0.4) return 'h-red';
  if (r >= 0.2) return 'h-amber';
  return 'h-green';
}

export function renderDeviceMonitor() {
  renderDeviceMetricsTable();
  const el = document.getElementById('deviceMonitor');
  if (!el) return;
  const head = `<tr><th>设备</th>${heatPlatforms.map(p=>`<th>${p}</th>`).join('')}<th>汇总</th></tr>`;
  const rows = deviceHeat.map(d => {
    let totalExec=0, totalFail=0;
    const cells = heatPlatforms.map(p => {
      const c = d.cells[p] || {exec:0,fail:0};
      totalExec += c.exec; totalFail += c.fail;
      if (c.exec === 0) return `<td><span class="heat-cell h-mute">–</span></td>`;
      const r = Math.round(c.fail/c.exec*100);
      const cls = heatClass(c.exec, c.fail);
      return `<td><span class="heat-cell ${cls}">${c.exec}次${c.fail>0?' · '+r+'%异常':''}</span></td>`;
    }).join('');
    const totR = totalExec>0 ? Math.round(totalFail/totalExec*100) : 0;
    const totCls = heatClass(totalExec, totalFail);
    return `<tr><td>${d.id}<span class="col-device-label">${d.label}</span></td>${cells}<td><span class="heat-cell ${totCls}">${totalExec}次${totalFail>0?' · '+totR+'%异常':''}</span></td></tr>`;
  }).join('');
  el.innerHTML = `<table class="heat-matrix"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

export function toggleDeviceSection() {
  const body = document.getElementById('deviceBody');
  const arrow = document.getElementById('deviceArrow');
  if (body.style.display === 'none') {
    body.style.display = '';
    arrow.style.transform = '';
  } else {
    body.style.display = 'none';
    arrow.style.transform = 'rotate(-90deg)';
  }
}

export function updateDeviceBadge() {
  const alertCount = deviceStats.filter(d => d.exec > 0 && d.errors / d.exec >= 0.2).length;
  const el = document.getElementById('deviceAlertBadge');
  if (!el) return;
  if (alertCount > 0) {
    el.innerHTML = `<span class="alert-count">${alertCount}</span>`;
  } else {
    el.innerHTML = '<span style="font-size:11px;color:#16a34a;font-weight:500;">全部正常</span>';
  }
}

export function renderDeviceMetricsTable() {
  var container = document.getElementById('deviceMetricsBody');
  if (!container) return;
  container.innerHTML = deviceList.map(function(dev) {
    var m = deviceMetrics[dev.id];
    if (!m) return '';
    var statusDot = m.status === 'online'
      ? '<span class="device-status-dot online"></span>'
      : '<span class="device-status-dot warning"></span>';
    return '<tr>' +
      '<td class="td-bold">' + statusDot + dev.label + '</td>' +
      '<td class="td-mono">' + m.tokenUsage.toLocaleString() + '</td>' +
      '<td class="td-mono">' + m.successCount + '</td>' +
      '<td class="td-mono">' + m.successDuration + '</td>' +
      '<td class="td-mono td-beta">—</td>' +
      '<td class="td-mono td-beta">—</td>' +
      '<td class="td-mono td-beta">—</td>' +
      '<td class="td-mono td-beta">—</td>' +
      '<td class="td-mono td-beta">—</td>' +
    '</tr>';
  }).join('');
}

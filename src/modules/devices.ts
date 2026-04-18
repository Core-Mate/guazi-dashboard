import { heatPlatforms, deviceHeat, deviceList, deviceMetrics } from '../data/devices'
import { fmtHM } from '../data/helpers'
import { downloadCSV } from './export-utils'

var deviceSearchQuery = '';

function currentDeviceStats() {
  return deviceHeat.map(function(d) {
    var exec = 0
    var errors = 0
    Object.values(d.cells || {}).forEach(function(c: any) {
      exec += c.exec || 0
      errors += c.fail || 0
    })
    return { id: d.id, exec: exec, errors: errors }
  })
}

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
  if (!deviceHeat.length) {
    el.innerHTML = '<div style="padding:24px 12px;text-align:center;color:#94a3b8;">暂无设备监控数据</div>';
    return;
  }
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
  const alertCount = currentDeviceStats().filter(d => d.exec > 0 && d.errors / d.exec >= 0.2).length;
  const el = document.getElementById('deviceAlertBadge');
  if (!el) return;
  if (alertCount > 0) {
    el.innerHTML = `<span class="alert-count">${alertCount}</span>`;
  } else {
    el.innerHTML = '<span style="font-size:11px;color:#16a34a;font-weight:500;">全部正常</span>';
  }
}

export function searchDevice(query) {
  deviceSearchQuery = (query || '').toLowerCase();
  renderDeviceMetricsTable();
}

export function exportDeviceCSV() {
  var headers = ['设备', '操作人', '算力豆', '完成', '时长', '评论', '点赞', '收藏', '私信', '触达量'];
  var rows = deviceList.map(function(dev) {
    var m = deviceMetrics[dev.id];
    if (!m) return null;
    return [dev.label, m.operator || '', m.tokenUsage, m.successCount, m.successDuration, m.comments, m.likes, m.saves, m.dms, m.reach];
  }).filter(Boolean);
  downloadCSV('设备明细_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

export function renderDeviceMetricsTable() {
  var container = document.getElementById('deviceMetricsBody');
  if (!container) return;
  var filtered = deviceList;
  if (deviceSearchQuery) {
    filtered = deviceList.filter(function(dev) {
      var m = deviceMetrics[dev.id];
      var label = (dev.label || '').toLowerCase();
      var op = (m && m.operator || '').toLowerCase();
      return label.indexOf(deviceSearchQuery) >= 0 || op.indexOf(deviceSearchQuery) >= 0;
    });
  }
  if (!filtered.length) {
    container.innerHTML = '<tr><td colspan="10" style="padding:24px 12px;text-align:center;color:#94a3b8;">暂无设备数据</td></tr>';
    return;
  }
  container.innerHTML = filtered.map(function(dev) {
    var m = deviceMetrics[dev.id];
    if (!m) return '';
    var statusDot = m.status === 'online'
      ? '<span class="device-status-dot online"></span>'
      : '<span class="device-status-dot warning"></span>';
    return '<tr>' +
      '<td class="td-bold">' + statusDot + dev.label + '</td>' +
      '<td class="text-muted">' + (m.operator || '—') + '</td>' +
      '<td class="td-mono">' + m.tokenUsage.toLocaleString() + '</td>' +
      '<td class="td-mono">' + m.successCount + '</td>' +
      '<td class="td-mono">' + m.successDuration + '</td>' +
      '<td class="td-mono td-beta">' + m.comments + '</td>' +
      '<td class="td-mono td-beta">' + m.likes + '</td>' +
      '<td class="td-mono td-beta">' + m.saves + '</td>' +
      '<td class="td-mono td-beta">' + m.dms + '</td>' +
      '<td class="td-mono td-beta">' + m.reach + '</td>' +
    '</tr>';
  }).join('');
  var allRows = container.querySelectorAll('tr');
  allRows.forEach(function(row, i) {
    var delay = Math.min(i, 20) * 30;
    (row as HTMLElement).style.opacity = '0';
    (row as HTMLElement).style.transform = 'translateY(4px)';
    (row as HTMLElement).style.transition = 'opacity 200ms cubic-bezier(0.4,0,0.2,1), transform 200ms cubic-bezier(0.4,0,0.2,1)';
    (row as HTMLElement).style.transitionDelay = delay + 'ms';
    setTimeout(function() { (row as HTMLElement).style.opacity = '1'; (row as HTMLElement).style.transform = 'translateY(0)'; }, 10);
  });
}

function toNumber(value: any) {
  var num = typeof value === 'number' ? value : parseFloat(String(value || '').replace(/[^\d.-]/g, ''))
  return isNaN(num) ? 0 : num
}

export function renderDevicesFromAggs(devices: any[], heat: any[]) {
  if (!Array.isArray(devices)) return

  var platforms = Array.isArray(heat) && heat.length
    ? Array.from(new Set(heat.flatMap(function(entry: any) { return Object.keys(entry.cells || {}) })))
    : heatPlatforms.slice()

  heatPlatforms.length = 0
  platforms.forEach(function(platform) { heatPlatforms.push(platform) })

  deviceList.length = 0
  deviceHeat.length = 0
  Object.keys(deviceMetrics).forEach(function(key) { delete deviceMetrics[key] })

  devices.forEach(function(device, index) {
    var id = device.id || device.device_id || 'device-' + (index + 1)
    deviceList.push({
      id: id,
      label: device.label || device.device_label || device.name || id,
      operator: device.operator || device.owner || '',
      accountId: device.account_id || '',
    })
    deviceMetrics[id] = {
      tokenUsage: toNumber(device.total_credits),
      successCount: toNumber(device.success_count),
      successDuration: fmtHM(Math.round(toNumber(device.runtime_h) * 3600)),
      comments: toNumber(device.comments),
      likes: toNumber(device.likes),
      saves: toNumber(device.saves ?? device.favorites),
      dms: toNumber(device.dms ?? device.private_messages),
      reach: toNumber(device.reach),
      status: device.status || 'online',
      operator: device.operator || device.owner || '',
    }
  })

  ;(heat || []).forEach(function(entry: any, index: number) {
    deviceHeat.push({
      id: entry.id || entry.device_id || 'device-' + (index + 1),
      label: entry.label || entry.device_label || entry.name || ('设备 ' + (index + 1)),
      cells: entry.cells || {},
    })
  })

  renderDeviceMonitor()
  renderDeviceMetricsTable()
  updateDeviceBadge()
}

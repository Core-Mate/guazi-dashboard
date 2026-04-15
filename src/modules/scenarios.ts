import { scenarioGroups, skillData, enabledScenarios } from '../data/scenarios'
import { downloadCSV } from './export-utils'

export function renderScenarioCards() {
  const container = document.getElementById('scenarioCards');
  if (!container) return;
  const enabled = scenarioGroups.filter(g => enabledScenarios.includes(g.id));
  if (!enabled.length) { container.innerHTML = '<div style="padding:20px;text-align:center;color:#a1a1aa;font-size:12px;">暂无开启的场景，点击「筛选场景」添加</div>'; return; }

  container.innerHTML = enabled.map(g => {
    const rows = skillData[g.id] || [];
    const totalExec = rows.reduce((a,r) => a + r.exec, 0);
    const totalSuccess = rows.reduce((a,r) => a + r.success, 0);

    const slimCols = ['指令集','完成数', ...g.extraCols];
    const headHtml = slimCols.map((c, i) => i >= 2 ? `<th class="th-beta">${c}</th>` : `<th>${c}</th>`).join('');

    const bodyHtml = rows.map(r => {
      let html = `<td><span class="td-bold">${r.skill}</span><span style="font-size:10px;color:#a1a1aa;margin-left:4px;">${r.skillName}</span></td>`;
      html += `<td class="td-mono">${r.success}</td>`;
      html += g.extraCols.map(() => '<td class="td-mono td-beta">—</td>').join('');
      return `<tr>${html}</tr>`;
    }).join('');

    return `<div class="scenario-card" id="sc-${g.id}">
      <div class="scenario-card-header" onclick="toggleScenario('${g.id}')">
        <div class="scenario-card-title"><span class="scenario-icon">${g.icon}</span>${g.name}</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="scenario-card-metrics">
            <span>指令集: <strong>${rows.length}</strong></span>
            <span>完成: <strong>${totalSuccess}</strong></span>
          </div>
          <span class="scenario-chevron open" id="chev-${g.id}">▾</span>
        </div>
      </div>
      <div class="scenario-card-body" id="body-${g.id}">
        <div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>
      </div>
    </div>`;
  }).join('');
}

export function renderScenarioCardsFull() {
  var container = document.getElementById('scenarioCardsFull');
  if (!container) return;
  container.innerHTML = scenarioGroups.map(function(g) {
    var rows = skillData[g.id] || [];
    if (!rows.length) return '';
    var totalExec = rows.reduce(function(a,r){ return a+r.exec; }, 0);
    var totalSuccess = rows.reduce(function(a,r){ return a+r.success; }, 0);
    var commonCols = ['指令集','完成数'];
    var allCols = commonCols.concat(g.extraCols || []);
    var headHtml = allCols.map(function(c, i){ return i >= 2 ? '<th class="th-beta">'+c+'</th>' : '<th>'+c+'</th>'; }).join('');
    var bodyHtml = rows.map(function(r) {
      var html = '<td><span class="td-bold">'+r.skill+'</span> <span style="font-size:10px;color:#a1a1aa;">'+r.skillName+'</span></td>' +
        '<td class="td-mono">'+r.success+'</td>';
      html += (g.extraCols||[]).map(function(){ return '<td class="td-mono td-beta">—</td>'; }).join('');
      return '<tr>'+html+'</tr>';
    }).join('');
    return '<div class="scenario-card">' +
      '<div class="scenario-card-header" onclick="toggleScenarioFull(\''+g.id+'\')">' +
        '<div class="scenario-card-title"><span class="scenario-icon">'+g.icon+'</span>'+g.name+'</div>' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
          '<div class="scenario-card-metrics"><span>指令集: <strong>'+rows.length+'</strong></span><span>完成: <strong>'+totalSuccess+'</strong></span></div>' +
          '<span class="scenario-chevron open" id="chevf-'+g.id+'">&#9662;</span>' +
        '</div>' +
      '</div>' +
      '<div class="scenario-card-body" id="bodyf-'+g.id+'">' +
        '<div class="table-wrap" style="overflow-x:auto;"><table><thead><tr>'+headHtml+'</tr></thead><tbody>'+bodyHtml+'</tbody></table></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

export function toggleScenarioFull(id) {
  var body = document.getElementById('bodyf-'+id);
  var chev = document.getElementById('chevf-'+id);
  if (body) body.classList.toggle('collapsed');
  if (chev) chev.classList.toggle('open');
}

export function toggleScenario(id) {
  const body = document.getElementById('body-'+id);
  const chev = document.getElementById('chev-'+id);
  body.classList.toggle('collapsed');
  chev.classList.toggle('open');
}

export function initScenarioDropdown() {
  const el = document.getElementById('scenarioDropdown');
  el.innerHTML = `<div class="scenario-config-dropdown-inner"><div class="toggle-grid">${
    scenarioGroups.map(g => {
      const on = enabledScenarios.includes(g.id);
      return `<button class="toggle-chip ${on?'on':''}" onclick="flipScenario('${g.id}',this)"><span class="chip-check">✓</span>${g.icon} ${g.name}</button>`;
    }).join('')
  }</div></div>`;
}

export function flipScenario(id, btn) {
  const idx = enabledScenarios.indexOf(id);
  if (idx >= 0) enabledScenarios.splice(idx, 1);
  else enabledScenarios.push(id);
  btn.classList.toggle('on');
  renderScenarioCards();
}

export function exportScenarioCSV() {
  var headers = ['指令集', '指令名称', '完成数', '评论', '点赞', '收藏', '私信', '触达量(去重)'];
  var rows = [];
  scenarioGroups.forEach(function(g) {
    var data = skillData[g.id];
    if (!data) return;
    data.forEach(function(r) {
      rows.push([r.skill, r.skillName, r.success, 'N/A', 'N/A', 'N/A', 'N/A', 'N/A']);
    });
  });
  downloadCSV('指令集产出_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

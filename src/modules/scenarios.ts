import { fmtHM } from '../data/helpers'
import { scenarioGroups, skillData, enabledScenarios } from '../data/scenarios'
import { downloadCSV } from './export-utils'
import { smoothToggleCollapse } from './utils'

var sortState: { col: string; dir: 'asc' | 'desc' } = { col: '', dir: 'asc' };
var searchQuery = '';
var scenarioInteractionSortKeys = ['comments', 'likes', 'favorites', 'dms', 'uniqueReach']
let skillTooltipEl: HTMLElement | null = null;

function escapeSkillText(value: any): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function showSkillTooltip(anchor: HTMLElement, text: string): void {
  hideSkillTooltip();
  const el = document.createElement("div");
  el.className = "skill-tooltip";
  el.textContent = text;
  document.body.appendChild(el);
  const rect = anchor.getBoundingClientRect();
  let top = rect.bottom + 6;
  let left = rect.left;
  const maxW = 380;
  if (left + maxW > window.innerWidth - 8) left = window.innerWidth - maxW - 8;
  if (left < 8) left = 8;
  el.style.top = top + "px";
  el.style.left = left + "px";
  skillTooltipEl = el;
}

function hideSkillTooltip(): void {
  if (skillTooltipEl) { skillTooltipEl.remove(); skillTooltipEl = null; }
}

if (typeof window !== 'undefined' && !(window as any).__skillTooltipBound) {
  (window as any).__skillTooltipBound = true;
  document.addEventListener("mouseenter", function(e: Event) {
    const target = e.target as HTMLElement;
    if (!target || !target.classList || !target.classList.contains("td-skill-name")) return;
    const full = target.getAttribute("data-full") || target.textContent || "";
    if (!full.trim()) return;
    if (target.scrollWidth <= target.clientWidth) return;
    showSkillTooltip(target, full);
  }, true);
  document.addEventListener("mouseleave", function(e: Event) {
    const target = e.target as HTMLElement;
    if (!target || !target.classList || !target.classList.contains("td-skill-name")) return;
    hideSkillTooltip();
  }, true);
}

function parseScenarioDuration(value: any) {
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
  return num(text)
}

function getScenarioCredits(row: any) {
  return num(row && (row.credits ?? row.totalCredits ?? row.tokenAvg))
}

function getScenarioFavorites(row: any) {
  return num(row && (row.saves ?? row.favorites))
}

function getScenarioUniqueReach(row: any) {
  return num(row && (row.uniqueReach ?? row.reach))
}

function getScenarioGroupKey(group: any) {
  return String(group && (group.category_group ?? group.group ?? group.key ?? group.id ?? group.name) || '').toLowerCase()
}

function renderScenarioHeader(label: string, key?: string) {
  if (!key) return '<th>' + label + '</th>'
  var cls = sortState.col === key ? (sortState.dir === 'asc' ? 'th-sort-asc' : 'th-sort-desc') : ''
  return '<th class="th-sortable ' + cls + '" onclick="sortScenario(\'' + key + '\')">' + label + '</th>'
}

function sortScenarioRows(rows) {
  if (!sortState.col) return rows;
  return rows.slice().sort(function(a, b) {
    var va;
    var vb;
    if (sortState.col === 'name' || sortState.col === 'id') {
      va = String(a.skillName || a.skill || '').toLowerCase();
      vb = String(b.skillName || b.skill || '').toLowerCase();
    } else if (sortState.col === 'success') {
      va = num(a.success);
      vb = num(b.success);
    } else if (sortState.col === 'credits') {
      va = getScenarioCredits(a);
      vb = getScenarioCredits(b);
    } else if (sortState.col === 'duration') {
      va = num(a.durationSec ?? parseScenarioDuration(a.avgDur));
      vb = num(b.durationSec ?? parseScenarioDuration(b.avgDur));
    } else if (sortState.col === 'comments') {
      va = num(a.comments)
      vb = num(b.comments)
    } else if (sortState.col === 'likes') {
      va = num(a.likes)
      vb = num(b.likes)
    } else if (sortState.col === 'favorites') {
      va = getScenarioFavorites(a)
      vb = getScenarioFavorites(b)
    } else if (sortState.col === 'dms') {
      va = num(a.dms)
      vb = num(b.dms)
    } else if (sortState.col === 'uniqueReach') {
      va = getScenarioUniqueReach(a)
      vb = getScenarioUniqueReach(b)
    } else {
      va = '';
      vb = '';
    }
    if (va === vb) return 0;
    if (sortState.dir === 'asc') return va > vb ? 1 : -1;
    return va < vb ? 1 : -1;
  });
}

export function renderScenarioCards() {
  var container = document.getElementById('scenarioCards');
  if (!container) return;
  var enabled = scenarioGroups.filter(g => enabledScenarios.includes(g.id));
  if (!enabled.length) { container.innerHTML = '<div style="padding:20px;text-align:center;color:#a1a1aa;font-size:12px;">暂无场景数据</div>'; return; }

  container.innerHTML = enabled.map(g => {
    var rows = skillData[g.id] || [];
    rows = rows.filter(r => r.success > 0);
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      rows = rows.filter(function(r) { return r.skill.toLowerCase().indexOf(q) !== -1 || r.skillName.toLowerCase().indexOf(q) !== -1 || (r.description || '').toLowerCase().indexOf(q) !== -1; });
    }
    rows = sortScenarioRows(rows);
    var totalSuccess = rows.reduce((a,r) => a + r.success, 0);
    var totalExec = rows.reduce((a: number, r: any) => a + (r.exec || 0), 0);

    var extraCols = g.extraCols || [];
    var slimCols = ['单次任务', '完成数', '算力豆', '时长 (h:m)'].concat(extraCols);
    var headHtml = slimCols.map((c, i) => {
      if (i === 0) return renderScenarioHeader('单次任务', 'name');
      if (i === 1) return renderScenarioHeader('完成数', 'success');
      if (i === 2) return renderScenarioHeader('算力豆', 'credits');
      if (i === 3) return renderScenarioHeader('时长 (h:m)', 'duration');
      return renderScenarioHeader(c, scenarioInteractionSortKeys[i - 4]);
    }).join('');

    var bodyHtml = rows.map(r => {
      var extraVals = g.extraFn ? g.extraFn(r) : extraCols.map(() => 0);
      var skillName = escapeSkillText(r.skillName);
      var html = `<td class="td-skill" data-desc="${(r.description || '').replace(/"/g, '&quot;')}"><span class="td-bold">${r.skill}</span> <span class="td-skill-name" data-full="${skillName}">${skillName}</span><span class="td-skill-chevron">▸</span></td>`;
      html += `<td class="td-mono">${r.success}</td>`;
      html += `<td class="td-mono">${getScenarioCredits(r)}</td>`;
      html += `<td class="td-mono">${r.avgDur || '—'}</td>`;
      html += extraVals.map(v => '<td class="td-mono">' + (v > 0 ? v.toLocaleString() : '<span class="text-na">暂无</span>') + '</td>').join('');
      return `<tr>${html}</tr>`;
    }).join('');

    return `<div class="scenario-card" id="sc-${g.id}">
      <div class="scenario-card-header" onclick="toggleScenario('${g.id}')">
        <div class="scenario-card-title"><span class="scenario-icon">${g.icon}</span>${g.name}</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="scenario-card-metrics">
            <span>技能数: <strong>${rows.length}</strong></span>
            <span>执行: <strong>${totalExec}</strong></span>
            <span>成功: <strong>${totalSuccess}</strong></span>
            <span>算力豆: <strong>${rows.reduce((a,r) => a + getScenarioCredits(r), 0)}</strong></span>
          </div>
          <span class="scenario-chevron open" id="chev-${g.id}">▾</span>
        </div>
      </div>
      <div class="scenario-card-body" id="body-${g.id}">
        <div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>
      </div>
    </div>`;
  }).join('');

  requestAnimationFrame(function() {
    var nodes = container.querySelectorAll('.td-skill');
    nodes.forEach(function(td) {
      var name = td.querySelector('.td-skill-name') as HTMLElement | null;
      if (!name) return;
      if (name.scrollWidth > name.offsetWidth + 1) {
        td.classList.add('is-truncated');
      } else {
        td.classList.remove('is-truncated');
      }
    });
  });
}

export function renderScenarioCardsFull(containerId?: string, idPrefix?: string) {
  var actualContainerId = containerId || 'scenarioCardsFull';
  var prefix = idPrefix || 'bodyf';
  var togglePrefix = prefix === 'bodyf' ? '' : prefix.replace(/^bodyf-?/, '') + '-';
  var chevPrefix = prefix === 'bodyf' ? 'chevf' : 'chevf-' + prefix.replace(/^bodyf-?/, '');
  var container = document.getElementById(actualContainerId);
  if (!container) return;
  container.innerHTML = scenarioGroups.map(function(g) {
    var rows = skillData[g.id] || [];
    rows = rows.filter(r => r.success > 0);
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      rows = rows.filter(function(r) { return r.skill.toLowerCase().indexOf(q) !== -1 || r.skillName.toLowerCase().indexOf(q) !== -1 || (r.description || '').toLowerCase().indexOf(q) !== -1; });
    }
    rows = sortScenarioRows(rows);
    if (!rows.length) return '';
    var totalSuccess = rows.reduce(function(a,r){ return a+r.success; }, 0);
    var totalExec = rows.reduce(function(a: number, r: any){ return a + (r.exec || 0); }, 0);
    var commonCols = ['单次任务', '完成数', '算力豆', '时长 (h:m)'];
    var allCols = commonCols.concat(g.extraCols || []);
    var headHtml = allCols.map(function(c, i){
      if (i === 0) return renderScenarioHeader('单次任务', 'name')
      if (i === 1) return renderScenarioHeader('完成数', 'success')
      if (i === 2) return renderScenarioHeader('算力豆', 'credits')
      if (i === 3) return renderScenarioHeader('时长 (h:m)', 'duration')
      return renderScenarioHeader(c, scenarioInteractionSortKeys[i - 4])
    }).join('');
    var bodyHtml = rows.map(function(r) {
      var extraVals = g.extraFn ? g.extraFn(r) : (g.extraCols||[]).map(function(){ return 0; });
      var skillName = escapeSkillText(r.skillName);
      var html = '<td class="td-skill" data-desc="'+(r.description || '').replace(/"/g, '&quot;')+'"><span class="td-bold">'+r.skill+'</span> <span class="td-skill-name" data-full="'+skillName+'">'+skillName+'</span><span class="td-skill-chevron">▸</span></td>' +
        '<td class="td-mono">'+r.success+'</td>' +
        '<td class="td-mono">'+getScenarioCredits(r)+'</td>' +
        '<td class="td-mono">'+(r.avgDur || '—')+'</td>';
      html += extraVals.map(function(v){ return '<td class="td-mono">' + (v > 0 ? v.toLocaleString() : '<span class="text-na">暂无</span>') + '</td>'; }).join('');
      return '<tr>'+html+'</tr>';
    }).join('');
    return '<div class="scenario-card">' +
      '<div class="scenario-card-header" onclick="toggleScenarioFull(\''+togglePrefix+g.id+'\')">' +
        '<div class="scenario-card-title"><span class="scenario-icon">'+g.icon+'</span>'+g.name+'</div>' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
          '<div class="scenario-card-metrics"><span>技能数: <strong>'+rows.length+'</strong></span><span>执行: <strong>'+totalExec+'</strong></span><span>成功: <strong>'+totalSuccess+'</strong></span><span>算力豆: <strong>'+rows.reduce((a,r) => a + getScenarioCredits(r), 0)+'</strong></span></div>' +
          '<span class="scenario-chevron open" id="'+chevPrefix+'-'+g.id+'">&#9662;</span>' +
        '</div>' +
      '</div>' +
      '<div class="scenario-card-body" id="'+prefix+'-'+g.id+'">' +
        '<div class="table-wrap" style="overflow-x:auto;"><table><thead><tr>'+headHtml+'</tr></thead><tbody>'+bodyHtml+'</tbody></table></div>' +
      '</div>' +
    '</div>';
  }).join('');
  if (!container.innerHTML.trim()) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#a1a1aa;font-size:12px;">暂无场景数据</div>';
  }

  requestAnimationFrame(function() {
    var nodes = container.querySelectorAll('.td-skill');
    nodes.forEach(function(td) {
      var name = td.querySelector('.td-skill-name') as HTMLElement | null;
      if (!name) return;
      if (name.scrollWidth > name.offsetWidth + 1) {
        td.classList.add('is-truncated');
      } else {
        td.classList.remove('is-truncated');
      }
    });
  });
}

export function sortScenario(col: string) {
  if (sortState.col === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  else {
    sortState.col = col;
    sortState.dir = 'asc';
  }
  renderScenarioCards();
  renderScenarioCardsFull();
}

export function searchScenario(query: string) {
  searchQuery = query;
  renderScenarioCards();
  renderScenarioCardsFull();
}

export function toggleScenarioFull(id) {
  smoothToggleCollapse(document.getElementById('bodyf-'+id), document.getElementById('chevf-'+id));
}

export function toggleScenario(id) {
  smoothToggleCollapse(document.getElementById('body-'+id), document.getElementById('chev-'+id));
}

export function initScenarioDropdown() {
  var el = document.getElementById('scenarioDropdown');
  el.innerHTML = `<div class="scenario-config-dropdown-inner"><div class="toggle-grid">${
    scenarioGroups.map(g => {
      var on = enabledScenarios.includes(g.id);
      return `<button class="toggle-chip ${on?'on':''}" onclick="flipScenario('${g.id}',this)"><span class="chip-check">✓</span>${g.icon} ${g.name}</button>`;
    }).join('')
  }</div></div>`;
}

export function flipScenario(id, btn) {
  var idx = enabledScenarios.indexOf(id);
  if (idx >= 0) enabledScenarios.splice(idx, 1);
  else enabledScenarios.push(id);
  btn.classList.toggle('on');
  renderScenarioCards();
}

export function exportScenarioCSV() {
  var headers = ['单次任务', '指令名称', '完成数', '算力豆', '时长 (h:m)', '评论', '点赞', '收藏', '私信', '触达量'];
  var rows = [];
  scenarioGroups.forEach(function(g) {
    var data = skillData[g.id];
    if (!data) return;
    data.forEach(function(r) {
      rows.push([r.skill, r.skillName, r.success, getScenarioCredits(r), r.avgDur || '—', r.comments || 0, r.likes || 0, getScenarioFavorites(r), r.dms || 0, r.uniqueReach || 0]);
    });
  });
  downloadCSV('任务产出_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

if (typeof window !== 'undefined') {
  Object.assign(window, { sortScenario, searchScenario });
}

function num(value: any) {
  var parsed = typeof value === 'number' ? value : parseFloat(String(value || '').replace(/[^\d.-]/g, ''))
  return isNaN(parsed) ? 0 : parsed
}

function groupMeta(group: any) {
  var rawId = getScenarioGroupKey(group) || 'acquire'
  if (rawId.indexOf('other') >= 0 || rawId.indexOf('其他') >= 0) {
    return {
      key: 'other',
      id: 'other',
      icon: group.icon || '📦',
      name: group.name || '其他',
      extraCols: [],
      extraFn: function() { return [] },
    }
  }
  if (rawId.indexOf('research') >= 0 || rawId.indexOf('调研') >= 0) {
    return {
      id: 'research',
      icon: group.icon || '🔎',
      name: group.name || '内容调研',
      extraCols: ['采集量', '点赞', '收藏', '私信', '触达量'],
      extraFn: function(row) { return [row.comments, row.likes, row.favorites, row.dms, row.uniqueReach] },
    }
  }
  if (rawId.indexOf('ops') >= 0 || rawId.indexOf('运维') >= 0 || rawId.indexOf('运营') >= 0) {
    return {
      id: 'ops',
      icon: group.icon || '🛠️',
      name: group.name || '运营维护',
      extraCols: ['处理量', '点赞', '收藏', '私信', '触达量'],
      extraFn: function(row) { return [row.comments, row.likes, row.favorites, row.dms, row.uniqueReach] },
    }
  }
  return {
    id: 'acquire',
    icon: group.icon || '🎯',
    name: group.name || '获客触达',
    extraCols: ['评论', '点赞', '收藏', '私信', '触达量'],
    extraFn: function(row) { return [row.comments, row.likes, row.favorites, row.dms, row.uniqueReach] },
  }
}

function getGroupItems(group: any) {
  var items = group && (group.items || group.skills || [])
  return Array.isArray(items) ? items : []
}

function mapSkillItems(items: any[], meta: any) {
  return items.map(function(item, index) {
    var success = num(item.success ?? item.success_count ?? item.completed ?? item.exec_count)
    var credits = num(item.total_credits ?? item.totalCredits ?? item.token_avg ?? 0)
    var tokenAvg = num(item.tokenAvg ?? item.token_avg ?? item.avg_cost ?? item.credits_avg)
    var totalCredits = num(item.totalCredits ?? item.total_credits ?? item.token_total ?? credits ?? tokenAvg * success)
    var durationSec = num(item.duration_sec ?? item.durationSec ?? item.total_duration_sec ?? item.avg_duration_sec)
    return {
      skill: item.skill || item.key || item.id || meta.id.toUpperCase() + '-' + (index + 1),
      skillName: item.skillName || item.skill_name || item.name || item.label || '未命名指令',
      description: item.description || '',
      exec: num(item.exec ?? item.executions ?? item.total_executions ?? success),
      success: success,
      fail: num(item.fail ?? item.fail_count),
      avgDur: item.duration_sec != null ? fmtHM(item.duration_sec) : (item.avgDur || item.avg_duration || '—'),
      durationSec: durationSec,
      tokenAvg: tokenAvg,
      credits: credits,
      totalCredits: totalCredits,
      comments: num(item.comments ?? item.collected ?? item.records),
      likes: num(item.likes ?? item.opens),
      saves: num(item.saves ?? item.favorites ?? item.bookmarks),
      favorites: num(item.favorites ?? item.saves ?? item.bookmarks),
      dms: num(item.dms ?? item.private_messages ?? item.leads),
      profileViews: num(item.profileViews ?? item.profile_views),
      uniqueReach: num(item.uniqueReach ?? item.reach ?? item.touchpoints),
    }
  })
}

export function renderSkillGroupsFromAggs(groups: any[]) {
  var sourceGroups = Array.isArray(groups) ? groups.slice() : []
  if (!sourceGroups.length) {
    scenarioGroups.length = 0
    enabledScenarios.length = 0
    Object.keys(skillData).forEach(function(key) { delete skillData[key] })
    var container = document.getElementById('scenarioCards')
    if (container) container.innerHTML = ''
    var fullContainer = document.getElementById('scenarioCardsFull')
    if (fullContainer) fullContainer.innerHTML = ''
    return
  }

  var acquireGroup = sourceGroups.find(function(group) {
    return getScenarioGroupKey(group) === 'acquire'
  })
  var acquireSkills = getGroupItems(acquireGroup)

  var researchItems = sourceGroups.reduce(function(items, group) {
    if (getScenarioGroupKey(group) === 'research') {
      items.push.apply(items, getGroupItems(group))
    }
    return items
  }, [])
  var opsItems = sourceGroups.reduce(function(items, group) {
    if (getScenarioGroupKey(group) === 'ops') {
      items.push.apply(items, getGroupItems(group))
    }
    return items
  }, [])
  var otherItems = researchItems.concat(opsItems)
  var otherGroup = otherItems.length ? {
    key: 'other',
    id: 'other',
    name: '其他',
    icon: '📦',
    items: otherItems,
  } : null

  if (acquireSkills.length === 0 && !otherGroup) return

  scenarioGroups.length = 0
  enabledScenarios.length = 0
  Object.keys(skillData).forEach(function(key) { delete skillData[key] })

  ;[acquireGroup, otherGroup].forEach(function(group) {
    if (!group) return
    var meta = groupMeta(group)
    var items = getGroupItems(group)
    if (!items.length) return
    scenarioGroups.push({
      id: meta.id,
      icon: meta.icon,
      name: meta.name,
      color: group.color || '#6366f1',
      extraCols: meta.extraCols,
      extraFn: meta.extraFn,
    })
    enabledScenarios.push(meta.id)
    skillData[meta.id] = mapSkillItems(items, meta)
  })

  renderScenarioCards()
  renderScenarioCardsFull()
}

import { platformMap, platformList } from '../data/platforms'
import { deviceList } from '../data/devices'
import { fetchTaskSummaries } from './api-integration'

var taskRowsCache: any[] = []

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseTaskPlatforms(value: any) {
  return String(value || '')
    .split(/[、,，/]/)
    .map(function(item) { return item.trim() })
    .filter(Boolean)
}

export function pTag(name) {
  const cls = platformMap[name] || 'tag-default';
  return `<span class="tag ${cls}">${name}</span>`;
}

export function initFilters() {
  const pSel = document.getElementById('platformFilter');
  if (pSel) {
    platformList.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      pSel.appendChild(opt);
    });
    const other = document.createElement('option');
    other.value = '__other__'; other.textContent = '其他平台';
    pSel.appendChild(other);
  }
  const dSel = document.getElementById('deviceFilter');
  if (dSel) {
    deviceList.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id; opt.textContent = d.label;
      dSel.appendChild(opt);
    });
  }
}

export function renderTaskTable() {
  const tbody = document.getElementById('taskTableBody');
  const paginationInfo = document.getElementById('taskPaginationInfo');
  if (!tbody) return Promise.resolve()
  return fetchTaskSummaries().then(function(items) {
    taskRowsCache = Array.isArray(items) ? items.slice() : []
    if (!taskRowsCache.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="padding:24px 12px;text-align:center;color:#94a3b8;">暂无任务数据</td></tr>'
      if (paginationInfo) paginationInfo.textContent = '暂无任务数据'
      return
    }
    if (paginationInfo) paginationInfo.textContent = '第 1 页，共 1 页（' + taskRowsCache.length + ' 条记录）'
    tbody.innerHTML = taskRowsCache.map(function(task, i) {
      var platforms = parseTaskPlatforms(task.related_platforms)
      var platformHtml = platforms.length
        ? platforms.map(function(name) { return pTag(name) }).join(' ')
        : '<span class="text-na">未提供</span>'
      var taskDisplayName = task.task_name || '未命名任务'
      var taskDetailName = task.task_detail_name || '<span class="text-na">未提供</span>'
      var successCount = Number(task.success_count || 0)
      var totalExecutions = Number(task.total_executions || 0)
      var failCount = Number(task.fail_count || 0)
      var statusText = '完成 ' + successCount + ' / 总计 ' + totalExecutions + (failCount > 0 ? ' · 失败 ' + failCount : '')
      return '<tr onclick="openDrawer(' + i + ')">' +
        '<td class="td-bold">' + escapeHtml(taskDisplayName) + '</td>' +
        '<td>' + (task.task_detail_name ? escapeHtml(taskDetailName) : taskDetailName) + '</td>' +
        '<td>' + platformHtml + '</td>' +
        '<td class="td-mono"><span class="text-na">未提供</span></td>' +
        '<td><span class="badge-status badge-cancel">' + escapeHtml(statusText) + '</span></td>' +
        '<td><span class="text-na">未提供</span></td>' +
        '<td class="td-mono"><span class="text-na">未提供</span></td>' +
        '<td class="text-muted"><span class="text-na">未提供</span></td>' +
      '</tr>'
    }).join('')
  })
}

export function getTaskSummaryAt(index: number) {
  return taskRowsCache[index] || null
}

export function animateAllNumbers() {
  document.querySelectorAll('.highlight-value').forEach(function(el) {
    var text = el.textContent;
    var num = parseFloat(text.replace(/[^0-9.]/g, '')) || 0;
    var suffix = text.replace(/[\d,.\s]/g, '');
    if (num > 0) {
      var origText = text;
      el.textContent = '0';
      var startTime = performance.now();
      function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
      function update(now) {
        var progress = Math.min((now - startTime) / 800, 1);
        var eased = easeOutQuart(progress);
        var current = Math.round(num * eased);
        el.textContent = current.toLocaleString() + suffix;
        if (progress < 1) requestAnimationFrame(update);
        else el.textContent = origText;
      }
      requestAnimationFrame(update);
    }
  });
}

export function getToday(){
  var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

export function getStatNum(id){
  var el=document.getElementById(id);
  if(!el)return 0;
  return parseInt(el.textContent.replace(/,/g,''))||0;
}

export function setStatNum(id,num){
  var el=document.getElementById(id);
  if(!el)return;
  el.textContent=num.toLocaleString('en-US');
}

export function prependTransaction(date,type,amount,operator,status){
  var tbody=document.getElementById('transactionTbody');
  if(!tbody)return;
  var tr=document.createElement('tr');
  tr.innerHTML='<td class="text-muted">'+date+'</td><td>'+type+'</td><td>'+operator+'</td><td class="'+(amount.charAt(0)==='-'?'text-red':'text-green')+'">'+amount+'</td><td class="td-mono">-</td>';
  tbody.insertBefore(tr,tbody.firstChild);
}

const EXTREME_RATIO_THRESHOLD = 3

export function formatCompareText(
  cur: number,
  prev: number | null | undefined,
  label: string,
  mode?: 'normal' | 'achievement'
): { cls: string; text: string } {
  if (prev == null) return { cls: 'flat', text: label + ' 暂无对比' };
  if (prev === 0 && cur === 0) return { cls: 'flat', text: label + ' 持平' };
  if (prev === 0 && cur > 0) {
    if (mode === 'achievement') return { cls: 'up', text: '🆕 +' + Math.round(cur).toLocaleString() };
    return { cls: 'up', text: '↑ ' + (label ? label + '增加 ' : '增加 ') + Math.round(cur).toLocaleString() };
  }
  if (prev === 0) {
    if (mode === 'achievement') return { cls: 'down', text: '↓ -' + Math.round(Math.abs(cur)).toLocaleString() };
    return { cls: 'down', text: '↓ ' + (label ? label + '减少 ' : '减少 ') + Math.round(Math.abs(cur)).toLocaleString() };
  }
  var delta = cur - prev;
  var ratio = delta / prev;
  if (Math.abs(ratio) > EXTREME_RATIO_THRESHOLD || ratio < -0.95) {
    var absDelta = Math.round(Math.abs(delta)).toLocaleString();
    if (mode === 'achievement') return { cls: ratio > 0 ? 'up' : 'down', text: ratio > 0 ? '🆕 +' + absDelta : '↓ -' + absDelta };
    return {
      cls: ratio > 0 ? 'up' : 'down',
      text: (ratio > 0 ? '↑ ' : '↓ ') + (label ? label : '') + (ratio > 0 ? '增加 ' : '减少 ') + absDelta
    };
  }
  var pct = Math.round(ratio * 100);
  if (pct === 0) return { cls: 'flat', text: label + ' 持平' };
  if (pct > 0) return { cls: 'up', text: '↑ ' + label + '增长 +' + pct + '%' };
  return { cls: 'down', text: '↓ ' + label + ' ' + pct + '%' };
}

export function computeChange(value: number, prev: number): { pct: number; up: boolean; text: string } {
  var compare = formatCompareText(value, prev, '', 'normal');
  var pctMatch = compare.text.match(/([+-]?\d+)%/);
  var pct = pctMatch ? parseInt(pctMatch[1], 10) : 0;
  return { pct: isNaN(pct) ? 0 : pct, up: compare.cls !== 'down', text: compare.text };
}

// Smooth collapse/expand based on real scrollHeight. Avoids max-height:3000px snap.
export function smoothToggleCollapse(body: HTMLElement | null, chev?: HTMLElement | null) {
  if (!body) return;
  var collapsed = body.classList.contains('collapsed');
  // Clear any pending transitionend listener from a previous toggle
  var prev = (body as any).__collapseHandler;
  if (prev) { body.removeEventListener('transitionend', prev); (body as any).__collapseHandler = null; }
  if (collapsed) {
    // Expanding: 0 -> scrollHeight, then release to natural height
    body.classList.remove('collapsed');
    body.style.maxHeight = '';
    var target = body.scrollHeight;
    body.style.maxHeight = '0px';
    void body.offsetHeight;
    body.style.maxHeight = target + 'px';
    var onEnd = function(e: TransitionEvent) {
      if (e.propertyName !== 'max-height' || e.target !== body) return;
      body.style.maxHeight = '';
      body.removeEventListener('transitionend', onEnd);
      (body as any).__collapseHandler = null;
    };
    (body as any).__collapseHandler = onEnd;
    body.addEventListener('transitionend', onEnd);
  } else {
    // Collapsing: pin current height, then transition inline to 0
    body.style.maxHeight = body.scrollHeight + 'px';
    void body.offsetHeight;
    body.classList.add('collapsed');
    body.style.maxHeight = '0px';
  }
  if (chev) chev.classList.toggle('open');
}

export function getContentClampBounds(): { left: number; right: number; top: number; bottom: number } {
  const content = document.querySelector('.content') as HTMLElement | null
  const margin = 12
  if (!content) {
    return {
      left: margin,
      right: window.innerWidth - margin,
      top: margin,
      bottom: window.innerHeight - margin,
    }
  }
  const r = content.getBoundingClientRect()
  return {
    left: r.left + margin,
    right: r.right - margin,
    top: r.top + margin,
    bottom: r.bottom - margin,
  }
}

export async function runWithButtonLoading<T>(
  btn: HTMLButtonElement | null,
  loadingText: string,
  action: () => Promise<T>
): Promise<T | undefined> {
  if (!btn) return action()
  if (btn.classList.contains('btn-loading')) return
  const orig = btn.textContent || ''
  const origHtml = btn.innerHTML
  btn.disabled = true
  btn.classList.add('btn-loading')
  btn.textContent = loadingText
  try { return await action() }
  finally {
    btn.disabled = false
    btn.classList.remove('btn-loading')
    if (origHtml) btn.innerHTML = origHtml
    else btn.textContent = orig
  }
}

import { showDashboardError } from './api-integration'
import { getTaskSummaryAt } from './utils'

var DRAWER_EXIT_DURATION = 200

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function openDrawer(i) {
  const task = getTaskSummaryAt(i);
  if (!task) {
    showDashboardError('任务详情加载失败：未找到任务数据');
    return;
  }
  var platforms = String(task.related_platforms || '').trim() || '未提供'
  var summary = '总执行 ' + Number(task.total_executions || 0) + ' 次，成功 ' + Number(task.success_count || 0) + ' 次，失败 ' + Number(task.fail_count || 0) + ' 次'
  document.getElementById('drawerTitle').textContent = task.task_name || '未命名任务';
  document.getElementById('drawerSub').textContent = task.category || '任务聚合';
  document.getElementById('drawerKV').innerHTML =
    '<dt>平台</dt><dd>' + escapeHtml(platforms) + '</dd>' +
    '<dt>分类</dt><dd>' + escapeHtml(task.category || '未提供') + '</dd>' +
    '<dt>统计</dt><dd>' + escapeHtml(summary) + '</dd>' +
    '<dt>详情状态</dt><dd>后端未提供单任务详情接口</dd>';
  document.getElementById('drawerReport').innerHTML =
    '<div style="padding:12px 0;color:#94a3b8;line-height:1.7;">任务详情功能暂不可用</div>';
  showDashboardError('该功能后端未就绪，请联系管理员');
  var overlay = document.getElementById('drawerOverlay') as HTMLElement | null
  if (!overlay) return
  var closeTimer = Number(overlay.dataset.closeTimer || 0)
  if (closeTimer) {
    clearTimeout(closeTimer)
    delete overlay.dataset.closeTimer
  }
  overlay.classList.remove('open', 'is-open', 'is-leaving')
  overlay.style.display = 'block'
  void overlay.offsetHeight
  requestAnimationFrame(function() {
    overlay.classList.add('is-open')
  })
}

export function closeDrawer() {
  var overlay = document.getElementById('drawerOverlay') as HTMLElement | null
  if (!overlay) return
  if (overlay.style.display === 'none' && !overlay.classList.contains('is-open')) return
  var closeTimer = Number(overlay.dataset.closeTimer || 0)
  if (closeTimer) clearTimeout(closeTimer)
  overlay.classList.remove('open', 'is-open')
  overlay.classList.add('is-leaving')
  overlay.dataset.closeTimer = String(window.setTimeout(function() {
    overlay.style.display = 'none'
    overlay.classList.remove('is-leaving')
    delete overlay.dataset.closeTimer
  }, DRAWER_EXIT_DURATION))
}

export function switchDrawerTab(tab, btn) {
  document.querySelectorAll('.drawer-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.drawer-tab-content').forEach(function(c) { c.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('drawerTab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  var activeContent = document.querySelector('.drawer-tab-content.active') as any;
  if (activeContent) {
    activeContent.style.opacity = '0';
    activeContent.style.transition = 'opacity 200ms cubic-bezier(0.4,0,0.2,1)';
    setTimeout(function() { activeContent.style.opacity = '1'; }, 10);
  }
}

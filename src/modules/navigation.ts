import { ensureOpsCharts } from './charts'
import { renderScenarioCardsFull } from './scenarios'
import { renderOverviewOplog } from './wallet'
import { populateMemberFilter } from './api-integration'
import { renderAccountAcquireGroup } from './accounts'

var PAGE_EXIT_DURATION = 120
var PAGE_ENTER_DURATION = 160

function runTabSlideIn(el, duration) {
  if (!el) return
  el.classList.remove('tab-slide-in')
  void (el as HTMLElement).offsetWidth
  el.classList.add('tab-slide-in')
  setTimeout(function() { el.classList.remove('tab-slide-in') }, duration)
}

function clearTransitionTimer(el: HTMLElement | null) {
  if (!el) return
  var timer = Number(el.dataset.transitionTimer || 0)
  if (!timer) return
  clearTimeout(timer)
  delete el.dataset.transitionTimer
}

function startEnterTransition(el: HTMLElement) {
  clearTransitionTimer(el)
  el.classList.remove('is-leaving')
  el.classList.add('active', 'is-entering')
  void el.offsetHeight
  requestAnimationFrame(function() {
    el.classList.remove('is-entering')
  })
  el.dataset.transitionTimer = String(window.setTimeout(function() {
    el.classList.remove('is-entering')
    delete el.dataset.transitionTimer
  }, PAGE_ENTER_DURATION))
}

function transitionPanels(currentEl: HTMLElement | null, nextEl: HTMLElement | null, onEnter?: () => void) {
  if (!nextEl) return
  clearTransitionTimer(currentEl)
  clearTransitionTimer(nextEl)
  if (currentEl && currentEl !== nextEl) {
    currentEl.classList.remove('is-entering')
    currentEl.classList.add('is-leaving')
    currentEl.dataset.transitionTimer = String(window.setTimeout(function() {
      currentEl.classList.remove('active', 'is-leaving')
      delete currentEl.dataset.transitionTimer
      startEnterTransition(nextEl)
      if (onEnter) onEnter()
    }, PAGE_EXIT_DURATION))
    return
  }
  if (!nextEl.classList.contains('active')) {
    startEnterTransition(nextEl)
  }
  if (onEnter) onEnter()
}

export function switchPage(page) {
  var currentPage = document.querySelector('.page.active') as HTMLElement;
  var navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  var pageConfig = {
    dashboard: { title:'运营看板', desc:'自动化获客运营效果总览' },
    enterprise: { title:'企业管理', desc:'企业概览与成员管理' },
    records: { title:'操作记录', desc:'交易历史与操作日志' },
  };
  var cfg = pageConfig[page] || pageConfig.dashboard;
  document.getElementById('pageTitle').textContent = cfg.title;
  document.getElementById('pageDesc').textContent = cfg.desc;
  navItems.forEach(function(n) { n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + page);
  if (navEl) navEl.classList.add('active');
  var fab = document.getElementById('reportFab');
  if (fab) fab.style.display = (page === 'dashboard') ? 'flex' : 'none';

  if (page === 'records') populateMemberFilter();

  var nextPage = document.getElementById('page-' + page);
  transitionPanels(currentPage, nextPage as HTMLElement | null, function() {
    var content = document.querySelector('.content') as HTMLElement | null
    if (content) content.scrollTop = 0
  })
}

export function switchDashTab(tab, btn) {
  document.querySelectorAll('#page-dashboard .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  var currentTab = document.querySelector('#page-dashboard .tab-content.active') as HTMLElement | null
  var el = document.getElementById('dashTab-'+tab) as HTMLElement | null
  transitionPanels(currentTab, el)
  if (tab === 'ops') { ensureOpsCharts(); renderScenarioCardsFull(); }
}

export function switchEnterpriseTab(tab, btn) {
  document.querySelectorAll('#page-enterprise .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  var currentTab = document.querySelector('#page-enterprise .tab-content.active') as HTMLElement | null
  var el = document.getElementById('entTab-' + tab) as HTMLElement | null
  transitionPanels(currentTab, el)
}

export function switchEntCard(tab, btn) {
  var header = btn.closest('.card-header');
  if (header) {
    header.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  }
  btn.classList.add('active');
  var membersPanel = document.getElementById('entCard-members');
  var oplogPanel = document.getElementById('entCard-oplog');
  var searchInput = document.getElementById('entMemberSearch') as HTMLElement;
  var actionBtns = searchInput ? searchInput.parentElement.querySelectorAll('.btn-action') : [];
  var showPanel = tab === 'members' ? membersPanel : oplogPanel;
  var hidePanel = tab === 'members' ? oplogPanel : membersPanel;
  if (hidePanel && hidePanel.style.display !== 'none') {
    (hidePanel as HTMLElement).style.transition = 'opacity 150ms cubic-bezier(0.4,0,0.2,1)';
    (hidePanel as HTMLElement).style.opacity = '0';
    setTimeout(function() {
      (hidePanel as HTMLElement).style.display = 'none';
      (hidePanel as HTMLElement).style.transition = '';
      (hidePanel as HTMLElement).style.opacity = '';
      if (showPanel) {
        (showPanel as HTMLElement).style.display = '';
        (showPanel as HTMLElement).style.opacity = '0';
        (showPanel as HTMLElement).style.transition = 'opacity 200ms cubic-bezier(0.4,0,0.2,1)';
        setTimeout(function() { (showPanel as HTMLElement).style.opacity = '1'; }, 10);
      }
    }, 150);
  } else if (showPanel) {
    (showPanel as HTMLElement).style.display = '';
    (showPanel as HTMLElement).style.opacity = '0';
    (showPanel as HTMLElement).style.transition = 'opacity 200ms cubic-bezier(0.4,0,0.2,1)';
    setTimeout(function() { (showPanel as HTMLElement).style.opacity = '1'; }, 10);
  }
  if (tab === 'members') {
    if (searchInput) searchInput.style.display = '';
    actionBtns.forEach(function(b: HTMLElement) { b.style.display = ''; });
  } else {
    if (searchInput) searchInput.style.display = 'none';
    actionBtns.forEach(function(b: HTMLElement) { b.style.display = 'none'; });
    renderOverviewOplog();
  }
}

export function switchOpsView(view, btn) {
  var parent = btn.closest('.ops-view-switcher');
  var targetView = null;
  if (parent) {
    parent.querySelectorAll('.seg-btn, .toolbar-btn').forEach(function(b) { b.classList.remove('active'); });
  }
  btn.classList.add('active');
  var scenariosPanel = document.getElementById('opsView-scenarios');
  var accountsPanel = document.getElementById('opsView-accounts');
  if (scenariosPanel) scenariosPanel.style.display = view === 'scenarios' ? '' : 'none';
  if (accountsPanel) accountsPanel.style.display = view === 'accounts' ? '' : 'none';
  if (view === 'scenarios') targetView = scenariosPanel;
  else if (view === 'accounts') {
    targetView = accountsPanel;
    renderAccountAcquireGroup();
  }
  runTabSlideIn(targetView, 300);
}

Object.assign(window, { switchOpsView })

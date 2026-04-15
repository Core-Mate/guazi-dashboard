import { ensureOpsCharts } from './charts'
import { renderScenarioCardsFull } from './scenarios'
import { renderOverviewOplog } from './wallet'

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

  var nextPage = document.getElementById('page-' + page);
  if (currentPage && currentPage !== nextPage) {
    currentPage.classList.add('page-exit');
    currentPage.classList.remove('active');
    setTimeout(function() {
      currentPage.classList.remove('page-exit');
      if (nextPage) {
        nextPage.classList.add('active', 'page-enter');
        document.querySelector('.content').scrollTop = 0;
        setTimeout(function() { nextPage.classList.remove('page-enter'); }, 350);
      }
    }, 200);
  } else if (nextPage && !nextPage.classList.contains('active')) {
    nextPage.classList.add('active', 'page-enter');
    document.querySelector('.content').scrollTop = 0;
    setTimeout(function() { nextPage.classList.remove('page-enter'); }, 350);
  }
}

export function switchDashTab(tab, btn) {
  document.querySelectorAll('#page-dashboard .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#page-dashboard .tab-content').forEach(c => { c.classList.remove('active', 'tab-slide-in'); });
  btn.classList.add('active');
  var el = document.getElementById('dashTab-'+tab);
  if (el) { el.classList.add('active', 'tab-slide-in'); setTimeout(function() { el.classList.remove('tab-slide-in'); }, 250); }
  if (tab === 'ops') { ensureOpsCharts(); renderScenarioCardsFull(); }
}

export function switchEnterpriseTab(tab, btn) {
  document.querySelectorAll('#page-enterprise .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#page-enterprise .tab-content').forEach(c => { c.classList.remove('active', 'tab-slide-in'); });
  btn.classList.add('active');
  var el = document.getElementById('entTab-' + tab);
  if (el) { el.classList.add('active', 'tab-slide-in'); setTimeout(function() { el.classList.remove('tab-slide-in'); }, 250); }
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
  if (tab === 'members') {
    if (membersPanel) membersPanel.style.display = '';
    if (oplogPanel) oplogPanel.style.display = 'none';
    if (searchInput) searchInput.style.display = '';
    actionBtns.forEach(function(b: HTMLElement) { b.style.display = ''; });
  } else {
    if (membersPanel) membersPanel.style.display = 'none';
    if (oplogPanel) oplogPanel.style.display = '';
    if (searchInput) searchInput.style.display = 'none';
    actionBtns.forEach(function(b: HTMLElement) { b.style.display = 'none'; });
    renderOverviewOplog();
  }
}

export function switchOpsView(view, btn) {
  var parent = btn.closest('.ops-view-switcher');
  if (parent) {
    parent.querySelectorAll('.seg-btn, .toolbar-btn').forEach(function(b) { b.classList.remove('active'); });
  }
  btn.classList.add('active');
  var scenariosPanel = document.getElementById('opsView-scenarios');
  var devicesPanel = document.getElementById('opsView-devices');
  var accountsPanel = document.getElementById('opsView-accounts');
  if (scenariosPanel) scenariosPanel.style.display = view === 'scenarios' ? '' : 'none';
  if (devicesPanel) devicesPanel.style.display = view === 'devices' ? '' : 'none';
  if (accountsPanel) accountsPanel.style.display = view === 'accounts' ? '' : 'none';
}

Object.assign(window, { switchOpsView })

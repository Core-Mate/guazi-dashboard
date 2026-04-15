import { fetchOverview, fetchTrend, fetchCredits, fetchMembers, fetchWallet, fetchTransactions, fetchAccounts, fetchSkills, isApiAvailable } from '../data/api'
import { renderHighlightCards } from './charts'
import { renderMembers } from './members'
import { renderTransactions } from './records'
import { renderAccountMetricsTable } from './accounts'
import { renderScenarioCards, renderScenarioCardsFull } from './scenarios'
import { membersData } from '../data/members'
import { replaceTransactionData } from '../data/records'
import { replaceSkillData } from '../data/scenarios'
import { accountList } from '../data/accounts'
import { animateAllNumbers } from './utils'

function rangeToDays(range: string): number {
  if (range === 'today') return 1;
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  return 7;
}

function showLiveBadge(live: boolean) {
  var el = document.getElementById('dataBadge');
  if (!el) {
    var toolbar = document.querySelector('#page-dashboard .toolbar');
    if (!toolbar) return;
    el = document.createElement('span');
    el.id = 'dataBadge';
    el.className = 'data-badge';
    toolbar.appendChild(el);
  }
  el.textContent = live ? '● Live Data' : '● Demo';
  el.className = 'data-badge ' + (live ? 'data-badge-live' : 'data-badge-demo');
}

export async function tryLiveHighlights(range: string) {
  var available = await isApiAvailable();
  showLiveBadge(available);
  if (!available) return;

  var days = rangeToDays(range);
  var [overview, trend, credits] = await Promise.all([
    fetchOverview(days),
    fetchTrend(days),
    fetchCredits(days),
  ]);
  if (!overview) return;

  var trendSparkline = trend ? trend.total : [];
  var successSparkline = trend ? trend.success : [];
  var creditSparkline = credits ? credits.consumed.map(v => Math.abs(v)) : [];

  var successRate = overview.total_executions > 0
    ? Math.round(overview.success_count / overview.total_executions * 100)
    : 0;

  var cards = [
    {
      key: 'tasks',
      label: '执行数量',
      value: overview.total_executions,
      prev: Math.round(overview.total_executions * 0.85),
      unit: '',
      sparkline: trendSparkline,
    },
    {
      key: 'runtime',
      label: '执行时长',
      value: trend ? trend.total.reduce((a, b) => a + b, 0) * 0.8 : 0,
      prev: trend ? trend.total.reduce((a, b) => a + b, 0) * 0.7 : 0,
      unit: 'h',
      sparkline: trendSparkline,
    },
    {
      key: 'credits',
      label: '算力豆消耗',
      value: Math.round(Math.abs(overview.total_credits_consumed)),
      prev: Math.round(Math.abs(overview.total_credits_consumed) * 0.9),
      unit: '',
      sparkline: creditSparkline,
    },
  ];

  renderHighlightCards(cards, range);
  animateAllNumbers();
}

export async function tryLiveOpsData(range: string) {
  var available = await isApiAvailable();
  if (!available) return null;

  var days = rangeToDays(range);
  var trend = await fetchTrend(days);
  if (!trend) return null;

  return {
    labels: trend.dates.map(d => d.slice(5).replace('-', '/')),
    success: trend.success,
    failed: trend.failed,
    total: trend.total,
  };
}

export async function tryLiveMembers() {
  var available = await isApiAvailable();
  if (!available) return;

  var data = await fetchMembers();
  if (!data || !data.length) return;

  membersData.length = 0;
  data.forEach(function(m) {
    membersData.push({
      id: m.id,
      name: m.username || '未知',
      phone: m.phone || '',
      role: m.role === 'admin' ? 'admin' : 'member',
      balance: Math.round(m.balance),
      joinDate: m.join_date ? m.join_date.slice(0, 10) : '',
    });
  });
  renderMembers();

  var countEl = document.getElementById('statMemberCount');
  if (countEl) countEl.textContent = data.length + '人';

  var admin = membersData.find(function(m) { return m.role === 'admin'; });
  if (admin) {
    var nameEl = document.getElementById('sidebarUserName');
    var avatarEl = document.getElementById('sidebarAvatar');
    var roleEl = document.getElementById('sidebarUserRole');
    if (nameEl) nameEl.textContent = admin.name;
    if (avatarEl) avatarEl.textContent = admin.name.charAt(0);
    if (roleEl) roleEl.textContent = '管理员';
  }
}

export async function tryLiveWallet() {
  var available = await isApiAvailable();
  if (!available) return;

  var data = await fetchWallet();
  if (!data) return;

  var setIf = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  setIf('statWallet', Math.round(data.total_balance).toLocaleString());
  setIf('statTopup', Math.round(data.total_recharged).toLocaleString());
  setIf('statConsumed', Math.round(data.total_consumed).toLocaleString());
  setIf('statMemberCount', data.member_count + '人');
}

export async function tryLiveTransactions() {
  var available = await isApiAvailable();
  if (!available) return;

  var data = await fetchTransactions(1, 50);
  if (!data || !data.items || !data.items.length) return;

  var typeMap = { CONSUME: '消耗', RECHARGE: '充值', DISTRIBUTE: '分发', DEDUCT: '扣减', GIFT: '赠送' };
  var newItems = data.items.map(function(item) {
    var d = item.ended_at ? new Date(item.ended_at) : new Date();
    var timeStr = (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0') + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    return {
      time: timeStr,
      member: item.username || '系统',
      type: typeMap[item.change_type] || item.change_type || '消耗',
      desc: item.task_name
        ? item.task_name + '（' + item.call_count + '次调用）'
        : item.change_type || '—',
      change: item.total_change,
      balance: item.balance_after || 0,
    };
  });

  try {
    replaceTransactionData(newItems);
    renderTransactions(1, 20);
  } catch (e) {
    console.error('[tryLiveTransactions] render failed:', e);
  }
}

export async function tryLiveAccounts() {
  var available = await isApiAvailable();
  if (!available) return;

  var data = await fetchAccounts();
  if (!data || !data.length) return;

  accountList.length = 0;
  data.forEach(function(a) {
    accountList.push({
      id: 'user-' + a.id,
      name: a.username || '未知',
      tokenUsed: a.total_tokens,
      successCount: a.exec_count,
      successDuration: a.duration || '0h',
      comments: 0,
      likes: 0,
      saves: 0,
      dms: 0,
      reach: 0,
    });
  });
  renderAccountMetricsTable();
}

export async function tryLiveSkills() {
  var available = await isApiAvailable();
  if (!available) return;

  var data = await fetchSkills();
  if (!data || !data.length) return;

  var newSkillData = data.map(function(s) {
    return {
      skill: 'S' + s.id,
      skillName: s.skill_name,
      exec: s.total_executions,
      success: s.success_count,
      fail: s.total_executions - s.success_count,
      avgDur: '—',
      tokenAvg: 0,
      comments: 0, likes: 0, favorites: 0, dms: 0,
      profileViews: 0, uniqueReach: 0,
    };
  });

  replaceSkillData('acquire', newSkillData);
  renderScenarioCards();
  renderScenarioCardsFull();
}

function injectBetaOverlay(containerId: string, text?: string) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.classList.add('beta-overlay-wrap');
  var overlay = document.createElement('div');
  overlay.className = 'beta-overlay';
  overlay.innerHTML = '<div class="beta-badge">Beta</div><div class="beta-sub">' + (text || '数据即将上线') + '</div>';
  el.appendChild(overlay);
}

export function applyBetaOverlays() {
  injectBetaOverlay('roiHero', '互动数据即将上线');
  injectBetaOverlay('roiPlatformCard', '平台对比即将上线');
  injectBetaOverlay('achievementBar', '成就系统即将上线');
  injectBetaOverlay('donutSection', '平台触达数据即将上线');
  injectBetaOverlay('interactionSection', '互动分布数据即将上线');
  injectBetaOverlay('deviceMetricsSection', '设备数据即将上线');
}

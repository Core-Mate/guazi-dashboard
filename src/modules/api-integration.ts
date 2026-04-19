import {
  fetchTrend as apiFetchTrend,
  fetchWallet as apiFetchWallet,
  fetchAccounts as apiFetchAccounts,
} from '../data/api'
import { renderHighlightCards } from './charts'
import { renderMembers } from './members'
import { paginationState, renderTransactions } from './records'
import { renderAccountAcquireGroup } from './accounts'
import { renderScenarioCards, renderScenarioCardsFull } from './scenarios'
import { membersData } from '../data/members'
import { accountList } from '../data/accounts'
import { fmtHM } from '../data/helpers'
import { rebuildCustomDropdown } from './dropdown'
import { showToast } from './modal-toast'

export interface HighlightCard {
  key: string;
  label: string;
  value: number;
  prev: number;
  change_pct: number;
  unit: string;
  series: { labels: string[]; values: number[] };
  stats: { avg: number; peak: number; avg_label?: string; peak_label?: string };
  sparkline?: number[];
}

interface DashboardMiniStats {
  exec: number | string;
  exec_raw?: number;
  exec_prev?: number;
  success_count?: number;
  success_count_prev?: number;
  runtime_h: number;
  runtime_h_prev?: number;
  total_credits: number;
  total_credits_prev?: number;
}

export interface AccountTotals {
  success_count: number;
  total_credits: number;
  runtime_h: number;
  reach: number;
}

export interface SkillTotals {
  success_count: number;
  total_credits: number;
}

export interface DashboardSnapshot {
  range: string;
  highlights: { range: string; compare_label: string; cards: HighlightCard[] };
  achievements: { range: string; compare_label: string; achievements: any[] };
  aggs: {
    accounts: any[];
    account_totals?: AccountTotals;
    skill_totals?: SkillTotals;
    skill_groups: any[];
    devices: any[];
    device_heat?: any[];
    device_alert_count?: number;
    totals?: any;
  };
  charts: {
    platform_breakdown: any[];
    interaction_breakdown: any[];
    mini_stats: DashboardMiniStats;
    roi: any;
  };
  ops_trend?: {
    labels: any[];
    dates?: any[];
    exec: any[];
    success: any[];
    failed?: any[];
    total?: any[];
    credits: number[];
    reach: any[];
    comments: any[];
    likes: any[];
    saves: any[];
    dms: any[];
    runtime_h: any[];
  };
  aggregations?: {
    accounts: any[];
    skill_groups: any[];
    devices: any[];
    totals: any;
  };
  members: any[];
  wallet: {
    total_balance: number;
    total_recharged: number;
    total_consumed: number;
    member_count: number;
  };
  transactions: {
    items: any[];
    total: number;
  };
  stats_tasks: any[];
  audit_log: {
    items: any[];
    total: number;
  };
}

var SNAPSHOT_CACHE_TTL = 30000;
var snapshotCache: Record<string, { expiresAt: number; data?: DashboardSnapshot; pending?: Promise<DashboardSnapshot> }> = {};
var MISSING_API_KEY_MESSAGE = '未配置 API Key，请联系管理员';
var API_KEY_WARNING_FLAG = '__dashboardApiKeyMissingWarned__';
var EMPTY_OPS_DATA = {
  labels: [],
  dates: [],
  success: [],
  failed: [],
  total: [],
  comments: [],
  likes: [],
  dms: [],
  reach: [],
  runtime: [],
  saves: [],
  credits: [],
};

export const EMPTY_SNAPSHOT: DashboardSnapshot = {
  range: '',
  highlights: {
    range: '',
    compare_label: '',
    cards: [],
  },
  achievements: {
    range: '',
    compare_label: '较上周',
    achievements: [],
  },
  aggs: {
    accounts: [],
    account_totals: { success_count: 0, total_credits: 0, runtime_h: 0, reach: 0 },
    skill_totals: { success_count: 0, total_credits: 0 },
    skill_groups: [],
    devices: [],
    device_heat: [],
    device_alert_count: 0,
    totals: {},
  },
  charts: {
    platform_breakdown: [],
    interaction_breakdown: [],
    mini_stats: { exec: 0, success_count: 0, success_count_prev: 0, runtime_h: 0, total_credits: 0 },
    roi: { value: 0, cost: 0, roi: 0, saved: 0, saved_pct: 0, breakdown: [] },
  },
  ops_trend: {
    labels: [],
    dates: [],
    exec: [],
    success: [],
    failed: [],
    total: [],
    credits: [],
    reach: [],
    comments: [],
    likes: [],
    saves: [],
    dms: [],
    runtime_h: [],
  },
  aggregations: {
    accounts: [],
    skill_groups: [],
    devices: [],
    totals: {},
  },
  members: [],
  wallet: {
    total_balance: 0,
    total_recharged: 0,
    total_consumed: 0,
    member_count: 0,
  },
  transactions: {
    items: [],
    total: 0,
  },
  stats_tasks: [],
  audit_log: {
    items: [],
    total: 0,
  },
};

function cloneSnapshot(snapshot: DashboardSnapshot): DashboardSnapshot {
  return JSON.parse(JSON.stringify(snapshot));
}

function normalizeDashboardSnapshot(data: any, range: string): DashboardSnapshot {
  var base = cloneSnapshot(EMPTY_SNAPSHOT);
  return {
    range: typeof (data && data.range) === 'string' ? data.range : range,
    highlights: data && data.highlights ? data.highlights : base.highlights,
    achievements: data && data.achievements ? data.achievements : base.achievements,
    aggs: data && data.aggs ? data.aggs : base.aggs,
    charts: data && data.charts ? data.charts : base.charts,
    ops_trend: data && data.ops_trend ? data.ops_trend : base.ops_trend,
    aggregations: data && data.aggregations ? data.aggregations : base.aggregations,
    members: Array.isArray(data && data.members) ? data.members : base.members,
    wallet: data && data.wallet ? {
      total_balance: Number(data.wallet.total_balance) || 0,
      total_recharged: Number(data.wallet.total_recharged) || 0,
      total_consumed: Number(data.wallet.total_consumed) || 0,
      member_count: Number(data.wallet.member_count) || 0,
    } : base.wallet,
    transactions: data && data.transactions ? {
      items: Array.isArray(data.transactions.items) ? data.transactions.items : [],
      total: Number(data.transactions.total) || 0,
    } : base.transactions,
    stats_tasks: Array.isArray(data && data.stats_tasks) ? data.stats_tasks : base.stats_tasks,
    audit_log: data && data.audit_log ? {
      items: Array.isArray(data.audit_log.items) ? data.audit_log.items : [],
      total: Number(data.audit_log.total) || 0,
    } : base.audit_log,
  };
}

function snapshotCacheKey(range: string, custom?: { start?: string; end?: string }, tenantId?: string) {
  var resolvedTenantId = resolveTenantId(tenantId)
  return resolvedTenantId + '|' + range + '|' + (custom && custom.start || '') + '|' + (custom && custom.end || '');
}

export function clearDashboardSnapshotCache(range?: string, custom?: { start?: string; end?: string }) {
  if (range) {
    delete snapshotCache[snapshotCacheKey(range, custom)]
    return
  }
  snapshotCache = {}
}

function clearDashboardError() {
  var banner = document.querySelector('.dashboard-error-banner');
  if (banner) banner.remove();
}

export function showDashboardError(msg: string) {
  var banner = document.querySelector('.dashboard-error-banner') as HTMLDivElement | null;
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'dashboard-error-banner';
    var text = document.createElement('span');
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = '重试';
    button.onclick = function() {
      location.reload();
    };
    banner.appendChild(text);
    banner.appendChild(button);
    var host = document.querySelector('.main') || document.querySelector('main') || document.body;
    host.prepend(banner);
  }
  var textEl = banner.querySelector('span');
  if (textEl) textEl.textContent = msg;
}

function getDashboardApiKey() {
  try {
    var stored = localStorage.getItem('dashboardApiKey')
    if (stored && stored.trim()) return stored.trim()
  } catch {
  }
  var envValue = ((import.meta as any).env && (import.meta as any).env.VITE_API_KEY) || ''
  if (typeof envValue === 'string' && envValue.trim()) return envValue.trim()
  var globalState = globalThis as any
  if (!globalState[API_KEY_WARNING_FLAG]) {
    globalState[API_KEY_WARNING_FLAG] = true
    console.error(MISSING_API_KEY_MESSAGE)
    try {
      showToast(MISSING_API_KEY_MESSAGE, 'error')
    } catch {}
  }
  return ''
}

getDashboardApiKey()

function getDashboardApiHeaders() {
  var apiKey = getDashboardApiKey()
  return apiKey ? { 'X-API-Key': apiKey } : null
}

export function getDashboardTenantId() {
  var keys = ['dashboardTenantId', 'tenant_id', 'tenantId']
  for (var i = 0; i < keys.length; i++) {
    try {
      var localValue = localStorage.getItem(keys[i])
      if (localValue) return localValue
    } catch {}
    try {
      var sessionValue = sessionStorage.getItem(keys[i])
      if (sessionValue) return sessionValue
    } catch {}
  }
  return ''
}

function resolveTenantId(tenantId?: string) {
  return String(tenantId || getDashboardTenantId() || '').trim()
}

function withTenantQuery(query?: URLSearchParams, tenantId?: string) {
  var params = query || new URLSearchParams()
  var resolvedTenantId = resolveTenantId(tenantId)
  if (resolvedTenantId) params.set('tenant_id', resolvedTenantId)
  return params
}

function buildDashboardUrl(path: string, query?: URLSearchParams, tenantId?: string) {
  var params = withTenantQuery(query, tenantId)
  var text = params.toString()
  return text ? path + '?' + text : path
}

async function fetchDashboardJSON<T>(
  path: string,
  errorPrefix: string,
  query?: URLSearchParams,
  tenantId?: string
): Promise<T | null> {
  var headers = getDashboardApiHeaders()
  if (!headers) {
    showDashboardError(errorPrefix + '：' + MISSING_API_KEY_MESSAGE)
    return null
  }
  try {
    var resp = await fetch(buildDashboardUrl(path, query, tenantId), {
      headers: headers,
    })
    if (!resp.ok) {
      var msg = 'HTTP ' + resp.status
      try {
        var body = await resp.json()
        msg = body.detail || body.error || msg
      } catch {}
      console.error('[fetchDashboardJSON] failed:', msg)
      showDashboardError(errorPrefix + '：' + msg)
      return null
    }
    clearDashboardError()
    return await resp.json()
  } catch {
    showDashboardError(errorPrefix + '：网络错误')
    return null
  }
}

function rangeToDays(range: string): number {
  if (range === 'today') return 1;
  if (range === 'yesterday') return 1;
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  return 7;
}

export async function fetchDashboardData(
  range: string,
  custom?: { start?: string; end?: string }
): Promise<DashboardSnapshot> {
  var resolvedTenantId = resolveTenantId();
  var key = snapshotCacheKey(range, custom, resolvedTenantId);
  var now = Date.now();
  var cached = snapshotCache[key];
  if (cached && cached.data && cached.expiresAt > now) {
    return cloneSnapshot(cached.data);
  }
  if (cached && cached.pending) {
    return cached.pending.then(cloneSnapshot);
  }

  var pending = (async function() {
    try {
      var query = withTenantQuery(new URLSearchParams({ range: range }), resolvedTenantId)
      if (custom && custom.start) {
        query.set('start', custom.start)
        query.set('end', custom.end || '')
      }
      var rawData = await fetchDashboardJSON<any>('/api/dashboard/snapshot', '数据加载失败', query, resolvedTenantId);
      if (!rawData) {
        delete snapshotCache[key];
        return cloneSnapshot(EMPTY_SNAPSHOT);
      }
      var data = normalizeDashboardSnapshot(rawData, range);
      clearDashboardError();
      snapshotCache[key] = { expiresAt: Date.now() + SNAPSHOT_CACHE_TTL, data: data };
      return cloneSnapshot(data);
    } catch {
      delete snapshotCache[key];
      showDashboardError('数据加载失败：网络错误');
      return cloneSnapshot(EMPTY_SNAPSHOT);
    }
  })();

  snapshotCache[key] = { expiresAt: 0, pending: pending };
  return pending;
}

function padRecordNumber(value: number) {
  return String(value).padStart(2, '0');
}

function formatRecordTime(value?: string | null) {
  if (!value) return '';
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return padRecordNumber(date.getMonth() + 1) + '/' + padRecordNumber(date.getDate()) + ' '
    + padRecordNumber(date.getHours()) + ':' + padRecordNumber(date.getMinutes());
}

function buildRecordQuery(page: number, pageSize: number, filters?: URLSearchParams) {
  var query = filters ? new URLSearchParams(filters.toString()) : new URLSearchParams()
  query.set('page', String(Math.max(1, page || 1)))
  query.set('page_size', String(Math.max(1, Math.min(pageSize || 20, 100))))
  return query
}

function appendAuditRemark(base: string, remark: any) {
  var text = String(remark || '').trim();
  return text ? base + '（' + text + '）' : base;
}

function normalizeTransactionType(changeType: any) {
  var type = String(changeType || '').toUpperCase();
  if (type === 'CONSUME') return '消耗';
  if (type === 'RECHARGE') return '充值';
  if (type === 'DISTRIBUTE') return '分发';
  if (type === 'DEDUCT') return '扣减';
  if (type === 'GIFT') return '赠送';
  if (type === 'CHECKIN' || type === 'SIGNIN') return '签到';
  return String(changeType || '未知');
}

function normalizeTransactionDesc(item: any) {
  if (item.change_type === 'CONSUME') {
    var taskName = item.task_name || '任务消耗';
    var callCount = Number(item.call_count || 0);
    return callCount > 1 ? taskName + '（' + callCount + '次调用）' : taskName;
  }
  if (item.task_name) return String(item.task_name);
  if (item.change_type === 'RECHARGE') return '账户充值';
  if (item.change_type === 'DISTRIBUTE') return '分发算力豆';
  if (item.change_type === 'DEDUCT') return '扣减算力豆';
  return String(item.change_type || '—');
}

export function normalizeTransactions(data: any): { items: any[]; total: number } {
  var rawItems = Array.isArray(data && data.items) ? data.items : [];
  return {
    items: rawItems.map(function(item) {
      return {
        id: item.task_exec_id || [item.username, item.change_type, item.ended_at, item.total_change].join('_'),
        time: formatRecordTime(item.ended_at || item.started_at),
        member: item.username || '系统',
        type: normalizeTransactionType(item.change_type),
        desc: normalizeTransactionDesc(item),
        change: Number(item.total_change || 0),
        balance: Number(item.balance_after || 0),
        raw: item,
      };
    }),
    total: Number(data && data.total) || rawItems.length,
  };
}

function normalizeAuditAction(action: any) {
  var value = String(action || '').toUpperCase();
  if (value === 'TRANSFER_CREDITS') return '分发算力豆';
  if (value === 'MEMBER_UPDATE') return '编辑成员';
  if (value === 'REMOVE_MEMBER') return '删除成员';
  if (value === 'ADD_MEMBER') return '新增成员';
  return String(action || '操作记录');
}

function normalizeAuditTarget(item: any, action: string) {
  var targetName = item.target_user_name || '未知成员';
  var creditsAmount = Math.round(Number(item.credits_amount || 0));
  if (action === '分发算力豆') {
    var base = '分发 ' + creditsAmount.toLocaleString() + ' 算力豆给 ' + targetName;
    return appendAuditRemark(base, item.remark);
  }
  if (action === '新增成员') {
    var addText = '添加成员 ' + targetName;
    if (creditsAmount > 0) addText += '，初始余额 ' + creditsAmount.toLocaleString() + ' 算力豆';
    return appendAuditRemark(addText, item.remark);
  }
  if (action === '删除成员') return appendAuditRemark('移除成员 ' + targetName, item.remark);
  if (action === '编辑成员') return appendAuditRemark('编辑成员 ' + targetName, item.remark);
  return appendAuditRemark(targetName, item.remark);
}

function normalizeAuditResult(action: string) {
  if (action === '新增成员') return '已加入团队';
  if (action === '删除成员') return '已移除';
  if (action === '编辑成员') return '已更新';
  return '已完成';
}

export function normalizeAuditLog(data: any): { items: any[]; total: number } {
  var rawItems = Array.isArray(data && data.items) ? data.items : [];
  return {
    items: rawItems.map(function(item) {
      var action = normalizeAuditAction(item.action);
      return {
        id: item.id,
        time: formatRecordTime(item.created_at),
        operator: item.operator_name || '系统',
        action: action,
        target: normalizeAuditTarget(item, action),
        result: normalizeAuditResult(action),
        raw: item,
      };
    }),
    total: Number(data && data.total) || rawItems.length,
  };
}

export async function fetchAuditLog(page: number, pageSize: number, filters?: URLSearchParams, tenantId?: string): Promise<{ items: any[]; total: number }> {
  var query = buildRecordQuery(page, pageSize, filters)
  var data = await fetchDashboardJSON<any>('/api/audit-log', '操作日志加载失败', query, tenantId)
  return data ? normalizeAuditLog(data) : { items: [], total: 0 }
}

export async function fetchTransactions(page: number, pageSize: number, filters?: URLSearchParams, tenantId?: string): Promise<{ items: any[]; total: number }> {
  var query = buildRecordQuery(page, pageSize, filters)
  var data = await fetchDashboardJSON<any>('/api/transactions', '交易记录加载失败', query, tenantId)
  return data ? normalizeTransactions(data) : { items: [], total: 0 }
}

export async function fetchMembers(tenantId?: string): Promise<any[]> {
  var data = await fetchDashboardJSON<any[]>('/api/members', '成员数据加载失败', undefined, tenantId)
  return Array.isArray(data) ? data : []
}

export async function fetchTaskSummaries(tenantId?: string): Promise<any[]> {
  var data = await fetchDashboardJSON<any[]>('/api/stats/tasks', '任务数据加载失败', undefined, tenantId)
  return Array.isArray(data) ? data : []
}

export interface AccountWeekSummary {
  account: {
    id: string;
    name: string;
    role: string;
    platforms: string[];
  };
  summary: {
    success_count: number;
    total_credits: number;
    runtime_h: number;
    reach: number;
    comments: number;
    likes: number;
    saves: number;
    dms: number;
  };
  success: number[];
}

export interface TaskWeekSummary {
  task_info: {
    id: number;
    name: string;
    category: 'acquire' | 'ops' | string;
    created_at: string;
    platforms: string[];
  };
  summary: {
    success_count: number;
    total_credits: number;
    runtime_h: number;
    reach: number;
  };
  success: number[];
}

export async function fetchAccountWeekSummary(accountId: string, tenantId: string): Promise<AccountWeekSummary> {
  var headers = getDashboardApiHeaders()
  if (!headers) throw new Error(MISSING_API_KEY_MESSAGE)
  var url = buildDashboardUrl('/api/accounts/' + encodeURIComponent(accountId) + '/week-summary', undefined, tenantId)
  var resp = await fetch(url, {
    headers: headers,
  })
  if (!resp.ok) {
    throw new Error('HTTP ' + resp.status)
  }
  return await resp.json()
}

export async function fetchTaskWeekSummary(taskId: string): Promise<TaskWeekSummary> {
  var headers = getDashboardApiHeaders()
  if (!headers) throw new Error(MISSING_API_KEY_MESSAGE)
  var url = buildDashboardUrl('/api/tasks/' + encodeURIComponent(taskId) + '/week-summary')
  var resp = await fetch(url, {
    headers: headers,
  })
  if (!resp.ok) {
    throw new Error('HTTP ' + resp.status)
  }
  return await resp.json()
}

export async function tryLiveHighlights(range: string) {
  var snap = await fetchDashboardData(range);
  renderHighlightCards(snap.highlights.cards, range);
}

export async function tryLiveOpsData(range: string, custom?: { start: string; end: string }) {
  var snap = await fetchDashboardData(range, custom);
  var snapshotTrend = snap && snap.ops_trend;
  if (snapshotTrend) {
    var snapshotLabels = Array.isArray(snapshotTrend.labels) ? snapshotTrend.labels : [];
    var snapshotDates = Array.isArray(snapshotTrend.dates) && snapshotTrend.dates.length
      ? snapshotTrend.dates
      : snapshotLabels;
    var snapshotSuccess = Array.isArray(snapshotTrend.success) ? snapshotTrend.success : [];
    var snapshotFailed = Array.isArray(snapshotTrend.failed) ? snapshotTrend.failed : [];
    var snapshotTotal = Array.isArray(snapshotTrend.total)
      ? snapshotTrend.total
      : (Array.isArray(snapshotTrend.exec) ? snapshotTrend.exec : []);
    var snapshotComments = Array.isArray(snapshotTrend.comments) ? snapshotTrend.comments : [];
    var snapshotLikes = Array.isArray(snapshotTrend.likes) ? snapshotTrend.likes : [];
    var snapshotDms = Array.isArray(snapshotTrend.dms) ? snapshotTrend.dms : [];
    var snapshotReach = Array.isArray(snapshotTrend.reach) ? snapshotTrend.reach : [];
    var snapshotRuntime = Array.isArray(snapshotTrend.runtime_h) ? snapshotTrend.runtime_h : [];
    var snapshotCredits = Array.isArray(snapshotTrend.credits) ? snapshotTrend.credits : [];
    if (
      snapshotLabels.length
      || snapshotDates.length
      || snapshotSuccess.length
      || snapshotFailed.length
      || snapshotTotal.length
      || snapshotComments.length
      || snapshotLikes.length
      || snapshotDms.length
      || snapshotReach.length
      || snapshotRuntime.length
      || snapshotCredits.length
    ) {
      return {
        labels: snapshotLabels,
        dates: snapshotDates,
        success: snapshotSuccess,
        failed: snapshotFailed,
        total: snapshotTotal,
        comments: snapshotComments,
        likes: snapshotLikes,
        dms: snapshotDms,
        reach: snapshotReach,
        credits: snapshotCredits,
        runtime: snapshotRuntime,
      };
    }
  }

  var days = rangeToDays(range);
  if (range === 'custom' && custom) {
    var start = new Date(custom.start);
    var end = new Date(custom.end);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      days = Math.max(1, Math.min(90, days));
    }
  }
  var trend = await apiFetchTrend(days);
  if (!trend) {
    return Object.assign({}, EMPTY_OPS_DATA);
  }
  var dates = trend.dates && trend.dates.length ? trend.dates : [];
  var success = trend.success && trend.success.length ? trend.success : [];
  var failed = trend.failed && trend.failed.length ? trend.failed : [];
  var total = trend.total && trend.total.length ? trend.total : [];
  var comments = trend.comments && trend.comments.length ? trend.comments : [];
  var likes = trend.likes && trend.likes.length ? trend.likes : [];
  var dms = trend.dms && trend.dms.length ? trend.dms : [];
  var reach = trend.reach && trend.reach.length ? trend.reach : [];
  var runtime = trend.runtime_h && trend.runtime_h.length ? trend.runtime_h : [];
  var credits = trend.credits && trend.credits.length ? trend.credits : [];

  return {
    labels: dates,
    dates: dates,
    success: success,
    failed: failed,
    total: total,
    comments: comments,
    likes: likes,
    dms: dms,
    reach: reach,
    credits: credits,
    runtime: runtime,
  };
}

export function applyMembersData(data: any[], preserveSelection: boolean = true) {
  var rows = Array.isArray(data) ? data : [];
  membersData.length = 0;
  rows.forEach(function(m) {
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
  populateMemberFilter(preserveSelection);

  var countEl = document.getElementById('statMemberCount');
  if (countEl) countEl.textContent = membersData.length + '人';

  var admin = membersData.find(function(m) { return m.role === 'admin'; });
  var nameEl = document.getElementById('sidebarUserName');
  var avatarEl = document.getElementById('sidebarAvatar');
  var roleEl = document.getElementById('sidebarUserRole');
  if (admin) {
    if (nameEl) nameEl.textContent = admin.name;
    if (avatarEl) avatarEl.textContent = admin.name.charAt(0);
    if (roleEl) roleEl.textContent = '管理员';
  } else {
    if (nameEl) nameEl.textContent = '未加载成员';
    if (avatarEl) avatarEl.textContent = '—';
    if (roleEl) roleEl.textContent = '';
  }
}

export async function tryLiveMembers() {
  applyMembersData(await fetchMembers());
}

export function applyWalletData(data: any) {
  var setIf = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  setIf('statWallet', Math.round(Number(data && data.total_balance) || 0).toLocaleString());
  setIf('statTopup', Math.round(Number(data && data.total_recharged) || 0).toLocaleString());
  setIf('statConsumed', Math.round(Number(data && data.total_consumed) || 0).toLocaleString());
}

export async function tryLiveWallet() {
  var data = await apiFetchWallet();
  if (!data) return;
  applyWalletData(data);
}

export async function tryLiveTransactions() {
  await renderTransactions(1, 20);
}

export async function tryLiveAccounts() {
  var data = await apiFetchAccounts();
  if (!data || !data.length) return;

  accountList.length = 0;
  data.forEach(function(a) {
    var runtimeH = Number(a.runtime_h || 0)
    accountList.push({
      id: 'user-' + a.id,
      name: a.username || '未知',
      deviceId: '',
      tokenUsed: Math.round(a.total_credits || 0),
      successCount: a.success_count ?? 0,
      successDuration: fmtHM(Math.round(runtimeH * 3600)),
      comments: 0,
      likes: 0,
      saves: 0,
      dms: 0,
      reach: 0,
    });
  });
  renderAccountAcquireGroup();
}

export function populateMemberFilter(preserveSelection: boolean = true) {
  var selectId = 'txMemberFilter'
  var select = document.getElementById(selectId) as HTMLSelectElement;
  if (!select) return;
  var existing = select.value;
  select.innerHTML = '<option value="">全部成员</option>';
  membersData.forEach(function(m) {
    var opt = document.createElement('option');
    opt.value = String(m.id);
    opt.textContent = m.name;
    opt.dataset.phone = m.phone || '';
    select.appendChild(opt);
  });
  if (preserveSelection && existing) select.value = existing;
  rebuildCustomDropdown(selectId, {
    searchable: true,
    placeholder: '搜索成员...',
    subtitleKey: 'phone',
  })
  select.onchange = function() {
    renderTransactions(1, paginationState.transactions.pageSize);
  };
}

export function injectBetaOverlay(containerId: string, text?: string) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var existing = el.querySelector('.beta-overlay');
  if (existing) existing.remove();
  el.classList.add('beta-overlay-wrap');
  var overlay = document.createElement('div');
  overlay.className = 'beta-overlay';
  overlay.innerHTML = '<div class="beta-badge">Beta</div><div class="beta-sub">' + (text || '数据即将上线') + '</div>';
  el.appendChild(overlay);
}

export function applyBetaOverlays() {
  injectBetaOverlay('roiHero', 'ROI 即将到来');
  injectBetaOverlay('roiPlatformCard', 'ROI 即将到来');
}

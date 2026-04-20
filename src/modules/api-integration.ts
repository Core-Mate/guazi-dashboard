import {
  fetchTrend as apiFetchTrend,
  fetchWallet as apiFetchWallet,
  fetchAccounts as apiFetchAccounts,
} from '../data/api'
import { getAuthHeaders, getCurrentUser } from './auth'
import { renderHighlightCards } from './charts'
import { renderMembers } from './members'
import { paginationState, renderTransactions } from './records'
import { renderAccountAcquireGroup } from './accounts'
import { renderScenarioCards, renderScenarioCardsFull } from './scenarios'
import { membersData } from '../data/members'
import { accountList } from '../data/accounts'
import { fmtHM } from '../data/helpers'
import { rebuildCustomDropdown } from './dropdown'
import {
  readLocalMockAccountWeekSummary,
  readLocalMockJson,
  readLocalMockTaskWeekSummary,
  shouldUseLocalMockApi,
} from './dev-local-api'

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
    admin_remaining?: number;
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
var DASHBOARD_API_TIMEOUT_MS = 10000;
var DASHBOARD_DETAIL_TIMEOUT_MS = 8000;
var snapshotCache: Record<string, { expiresAt: number; data?: DashboardSnapshot; pending?: Promise<DashboardSnapshot> }> = {};
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

interface DashboardApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: {
    message?: string;
  } | string;
  detail?: string | unknown;
}

function roundMetric(value: number, digits: number): number {
  var factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
}

function toNumber(value: any): number {
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  var parsed = parseFloat(String(value == null ? '' : value).replace(/[^\d.-]/g, ''))
  return isNaN(parsed) ? 0 : parsed
}

function unwrapDashboardEnvelope<T>(payload: DashboardApiEnvelope<T> | T | null): T | null {
  if (!payload) return null
  if (typeof payload === 'object' && 'data' in (payload as DashboardApiEnvelope<T>)) {
    var envelope = payload as DashboardApiEnvelope<T>
    if (envelope.success === false) return null
    if (envelope.data !== undefined) return envelope.data as T
  }
  return payload as T
}

function readDashboardErrorMessage<T>(payload: DashboardApiEnvelope<T> | T | null, fallback: string): string {
  if (!payload) return fallback
  if (typeof payload === 'object' && 'error' in (payload as DashboardApiEnvelope<T>)) {
    var envelope = payload as DashboardApiEnvelope<T>
    if (typeof envelope.error === 'string' && envelope.error) return envelope.error
    if (envelope.error && typeof envelope.error === 'object' && typeof envelope.error.message === 'string') {
      return envelope.error.message
    }
    if (typeof envelope.detail === 'string' && envelope.detail) return envelope.detail
  }
  return fallback
}

function compareLabelForRange(range: string, fallback?: string): string {
  if (fallback) return fallback
  if (range === 'today') return '较昨日'
  if (range === '30d') return '较上月'
  return '较上期'
}

function inferHighlightUnit(key: string): string {
  var normalized = String(key || '').toLowerCase()
  if (normalized === 'runtimehours' || normalized === 'runtime_h') return 'h'
  if (normalized === 'credits' || normalized === 'totalcredits') return '颗'
  if (normalized === 'reach') return '人'
  return '次'
}

function inferTaskGroup(task: any): 'acquire' | 'ops' {
  var text = [
    task && task.taskName,
    task && task.platform,
    task && task.category,
  ].join(' ').toLowerCase()
  if (/获客|触达|引流|私信|留资|reach|lead|comment|dm/.test(text)) return 'acquire'
  return 'ops'
}

function normalizePlatformKey(value: any): string {
  var text = String(value || '').trim().toLowerCase()
  if (!text) return 'general_app'
  if (text === '小红书' || text === 'xhs') return 'xhs'
  if (text === '抖音' || text === 'douyin') return 'douyin'
  if (text === '快手' || text === 'kuaishou') return 'kuaishou'
  if (text === '微信' || text === 'wechat') return 'wechat'
  if (text === '微博' || text === 'weibo') return 'weibo'
  if (text === 'linkedin') return 'linkedin'
  if (text === 'instagram') return 'instagram'
  if (text === 'tiktok') return 'tiktok'
  if (text === 'reddit') return 'reddit'
  if (text === 'pinterest') return 'pinterest'
  return text.replace(/\s+/g, '_') || 'general_app'
}

function buildSyntheticWeeklySeries(total: number): number[] {
  var resolved = Math.max(0, Math.round(Number(total) || 0))
  if (!resolved) return [0, 0, 0, 0, 0, 0, 0]
  var base = Math.floor(resolved / 7)
  var extra = resolved % 7
  var values = [] as number[]
  for (var i = 0; i < 7; i += 1) {
    values.push(base + (i >= 7 - extra ? 1 : 0))
  }
  return values
}

function mapCoremateAchievements(items: any[]): any[] {
  return (Array.isArray(items) ? items : []).map(function(item) {
    return {
      emoji: item && item.tone === 'emerald'
        ? '🌟'
        : item && item.tone === 'amber'
          ? '🔥'
          : item && item.tone === 'violet'
            ? '💬'
            : '✨',
      headline: String(item && item.title || '成就'),
      copy: String(item && item.title || '成就'),
      text: String(item && item.badge || ''),
      detail: String(item && item.description || ''),
    }
  })
}

function mapCoremateAccounts(accounts: any[]): any[] {
  return (Array.isArray(accounts) ? accounts : []).map(function(account, index) {
    return {
      id: 'user-' + String(account && account.userId != null ? account.userId : (index + 1)),
      account_id: 'user-' + String(account && account.userId != null ? account.userId : (index + 1)),
      user_id: Number(account && account.userId) || 0,
      username: String(account && account.userName || '未知成员'),
      name: String(account && account.userName || '未知成员'),
      phone: String(account && account.phoneNumber || ''),
      role: 'member',
      platforms: Array.isArray(account && account.platforms) ? account.platforms.map(normalizePlatformKey) : [],
      device_label: '',
      total_credits: Math.round(toNumber(account && account.credits)),
      success_count: Math.round(toNumber(account && account.successCount)),
      runtime_h: roundMetric(toNumber(account && account.runtimeHours), 1),
      comments: Math.round(toNumber(account && account.comments)),
      likes: 0,
      saves: 0,
      favorites: 0,
      dms: Math.round(toNumber(account && account.dms)),
      reach: Math.round(toNumber(account && account.reach)),
    }
  })
}

function mapCoremateTaskGroups(tasks: any[]): any[] {
  var grouped: Record<string, { id: string; name: string; items: any[]; success_count: number; total_credits: number }> = {}
  ;(Array.isArray(tasks) ? tasks : []).forEach(function(task) {
    var groupId = inferTaskGroup(task)
    if (!grouped[groupId]) {
      grouped[groupId] = {
        id: groupId,
        name: groupId === 'acquire' ? '获客触达' : '运营维护',
        items: [],
        success_count: 0,
        total_credits: 0,
      }
    }
    grouped[groupId].items.push({
      id: Number(task && task.id) || 0,
      task_id: Number(task && task.id) || 0,
      task_name: String(task && task.taskName || '未命名任务'),
      skill_name: String(task && task.taskName || '未命名任务'),
      related_platforms: String(task && task.platform || ''),
      total_executions: Math.round(toNumber(task && task.totalCount)),
      success_count: Math.round(toNumber(task && task.successCount)),
      fail_count: Math.max(0, Math.round(toNumber(task && task.totalCount) - toNumber(task && task.successCount))),
      category: groupId,
      runtime_h: roundMetric(toNumber(task && task.runtimeHours), 1),
      total_credits: Math.round(toNumber(task && task.credits)),
      comments: Math.round(toNumber(task && task.comments)),
      likes: Math.round(toNumber(task && task.likes)),
      saves: Math.round(toNumber(task && task.saves)),
      favorites: Math.round(toNumber(task && task.saves)),
      dms: Math.round(toNumber(task && task.dms)),
      reach: Math.round(toNumber(task && task.reach)),
    })
    grouped[groupId].success_count += Math.round(toNumber(task && task.successCount))
    grouped[groupId].total_credits += Math.round(toNumber(task && task.credits))
  })
  return Object.keys(grouped).map(function(key) { return grouped[key] })
}

function mapCoremateDevices(devices: any[]): any[] {
  return (Array.isArray(devices) ? devices : []).map(function(device) {
    return {
      device_id: String(device && device.deviceId || '未上报设备'),
      total_executions: Math.round(toNumber(device && device.totalCount)),
      success_count: Math.round(toNumber(device && device.successCount)),
      fail_count: Math.round(toNumber(device && device.failCount)),
      runtime_h: roundMetric(toNumber(device && device.runtimeHours), 1),
      reach: Math.round(toNumber(device && device.reach)),
      alert_level: String(device && device.alertLevel || 'stable'),
    }
  })
}

function mapCoremateMembers(rawMembers: any[], walletBalance: number): any[] {
  var members = (Array.isArray(rawMembers) ? rawMembers : []).map(function(member) {
    return {
      id: Number(member && member.id) || 0,
      username: String(member && member.name || '未知成员'),
      name: String(member && member.name || '未知成员'),
      phone: String(member && member.phoneNumber || ''),
      role: String(member && member.role || '') === 'admin' ? 'admin' : 'member',
      balance: Math.round(toNumber(member && member.remaining)),
      join_date: String(member && member.createdAt || ''),
      exec_count: 0,
      total_tokens: 0,
    }
  })

  var currentUser = getCurrentUser()
  if (currentUser && currentUser.id > 0) {
    var exists = members.some(function(member) { return Number(member.id) === Number(currentUser.id) })
    if (!exists) {
      var currentRole = (currentUser.role === 'admin' || currentUser.role === 'enterprise_admin') ? 'admin' : 'member'
      members.unshift({
        id: currentUser.id,
        username: currentUser.name || '管理员',
        name: currentUser.name || '管理员',
        phone: currentUser.phoneNumber || '',
        role: currentRole,
        balance: Math.round(walletBalance || 0),
        join_date: '',
        exec_count: 0,
        total_tokens: 0,
      })
    }
  }
  return members
}

function buildAccountTotals(accounts: any[]): AccountTotals {
  var totals = { success_count: 0, total_credits: 0, runtime_h: 0, reach: 0 }
  ;(Array.isArray(accounts) ? accounts : []).forEach(function(account) {
    totals.success_count += Math.round(toNumber(account && account.success_count))
    totals.total_credits += Math.round(toNumber(account && account.total_credits))
    totals.runtime_h += toNumber(account && account.runtime_h)
    totals.reach += Math.round(toNumber(account && account.reach))
  })
  return {
    success_count: totals.success_count,
    total_credits: totals.total_credits,
    runtime_h: roundMetric(totals.runtime_h, 1),
    reach: totals.reach,
  }
}

function buildSkillTotals(groups: any[]): SkillTotals {
  var totals = { success_count: 0, total_credits: 0 }
  ;(Array.isArray(groups) ? groups : []).forEach(function(group) {
    totals.success_count += Math.round(toNumber(group && group.success_count))
    totals.total_credits += Math.round(toNumber(group && group.total_credits))
  })
  return totals
}

function getHighlightTrendKeys(key: string): string[] {
  var normalized = String(key || '').trim().toLowerCase()
  if (normalized === 'successcount') return ['successCount']
  if (normalized === 'runtimehours' || normalized === 'runtime_h') return ['runtimeHours']
  if (normalized === 'credits' || normalized === 'creditscost' || normalized === 'totalcredits') return ['credits']
  if (normalized === 'reach') return ['reach']
  if (normalized === 'comments') return ['comments']
  if (normalized === 'likes') return ['likes']
  if (normalized === 'saves') return ['saves']
  if (normalized === 'dms') return ['dms']
  return [String(key || '')]
}

function findCoremateTrendSeries(trend: any, key: string): any | null {
  var series = Array.isArray(trend && trend.series) ? trend.series : []
  var keys = getHighlightTrendKeys(key)
  for (var i = 0; i < keys.length; i += 1) {
    var match = series.find(function(item: any) {
      return String(item && item.key || '') === keys[i]
    })
    if (match && Array.isArray(match.values)) return match
  }
  return null
}

function roundHighlightStat(key: string, value: number): number {
  var normalized = String(key || '').trim().toLowerCase()
  if (normalized === 'runtimehours' || normalized === 'runtime_h') return roundMetric(value, 1)
  if (Math.abs(value - Math.round(value)) < 0.05) return Math.round(value)
  return roundMetric(value, 1)
}

function buildHighlightSeriesMeta(key: string, trend: any) {
  var labels = Array.isArray(trend && trend.labels) ? trend.labels.map(function(label: any) {
    return String(label || '')
  }) : []
  var matched = findCoremateTrendSeries(trend, key)
  var values = matched && Array.isArray(matched.values)
    ? matched.values.map(function(value: any) { return toNumber(value) })
    : []
  var peak = values.length ? Math.max.apply(null, values) : 0
  var peakIndex = values.indexOf(peak)
  return {
    unit: String(matched && matched.unit || ''),
    series: {
      labels: labels.slice(0, values.length),
      values: values.slice(),
    },
    stats: {
      avg: roundHighlightStat(key, values.length ? values.reduce(function(sum, value) { return sum + value }, 0) / values.length : 0),
      peak: roundHighlightStat(key, peak),
      avg_label: '日均',
      peak_label: peakIndex >= 0 && labels[peakIndex] ? ('峰值 ' + labels[peakIndex]) : '峰值',
    },
  }
}

function mapCoremateBreakdown(items: any[], fallbackPrefix: string): any[] {
  return (Array.isArray(items) ? items : []).map(function(item, index) {
    var name = String(item && (item.name || item.label || item.key) || (fallbackPrefix + String(index + 1)))
    return {
      key: String(item && item.key || name),
      name: name,
      label: name,
      value: Math.max(0, Math.round(toNumber(item && item.value))),
      percentage: roundMetric(toNumber(item && item.percentage), 1),
      color: String(item && item.color || ''),
    }
  })
}

function mapCoremateTrend(trend: any): DashboardSnapshot['ops_trend'] {
  var labels = Array.isArray(trend && trend.labels) ? trend.labels : []
  function pickSeries(key: string) {
    var match = findCoremateTrendSeries(trend, key)
    return Array.isArray(match && match.values)
      ? match.values.map(function(value: any) { return toNumber(value) })
      : []
  }
  var success = pickSeries('successCount')
  return {
    labels: labels.slice(),
    dates: labels.slice(),
    exec: success.slice(),
    success: success.slice(),
    failed: labels.map(function() { return 0 }),
    total: success.slice(),
    credits: pickSeries('credits'),
    reach: pickSeries('reach'),
    comments: pickSeries('comments'),
    likes: pickSeries('likes'),
    saves: pickSeries('saves'),
    dms: pickSeries('dms'),
    runtime_h: pickSeries('runtimeHours'),
  }
}

function mapCoremateOverviewToSnapshot(data: any, range: string, extra?: {
  members?: any[];
  wallet?: any;
  transactions?: any;
  auditLog?: any;
}): DashboardSnapshot {
  var base = cloneSnapshot(EMPTY_SNAPSHOT)
  var accounts = mapCoremateAccounts(data && data.accountSummaries)
  var skillGroups = mapCoremateTaskGroups(data && data.taskSummaries)
  var devices = mapCoremateDevices(data && data.deviceSummaries)
  var trend = data && data.trend
  var wallet = extra && extra.wallet ? extra.wallet : {
    remaining: data && data.walletBalance,
    totalPurchased: data && data.totalDistributed,
    totalUsed: data && data.totalConsumed,
  }
  var adminWalletBalance = toNumber(wallet && wallet.remaining)
  var enterpriseWalletBalance = toNumber(wallet && (wallet.enterpriseRemaining != null ? wallet.enterpriseRemaining : wallet.remaining))
  var enterpriseTotalPurchased = toNumber(wallet && (wallet.enterpriseTotalPurchased != null ? wallet.enterpriseTotalPurchased : wallet.totalPurchased))
  var enterpriseTotalUsed = toNumber(wallet && (wallet.enterpriseTotalUsed != null ? wallet.enterpriseTotalUsed : wallet.totalUsed))
  var memberRows = mapCoremateMembers(extra && extra.members, adminWalletBalance)
  return {
    range: String(data && data.range || range || '7d'),
    highlights: {
      range: String(data && data.range || range || '7d'),
      compare_label: compareLabelForRange(range, String(data && data.compareLabel || '')),
      cards: (Array.isArray(data && data.highlights) ? data.highlights : []).map(function(item: any) {
        var current = toNumber(item && item.value)
        var previous = item && item.previousValue == null ? 0 : toNumber(item && item.previousValue)
        var changePct = previous > 0 ? ((current - previous) / previous) * 100 : 0
        var highlightMeta = buildHighlightSeriesMeta(String(item && item.key || ''), trend)
        return {
          key: String(item && item.key || ''),
          label: String(item && item.label || ''),
          value: current,
          prev: previous,
          change_pct: roundMetric(changePct, 1),
          unit: String(highlightMeta.unit || inferHighlightUnit(String(item && item.key || ''))),
          series: highlightMeta.series,
          stats: highlightMeta.stats,
        }
      }),
    },
    achievements: {
      range: String(data && data.range || range || '7d'),
      compare_label: compareLabelForRange(range, String(data && data.compareLabel || '')),
      achievements: mapCoremateAchievements(data && data.achievements),
    },
    aggs: {
      accounts: accounts,
      account_totals: buildAccountTotals(accounts),
      skill_totals: buildSkillTotals(skillGroups),
      skill_groups: skillGroups,
      devices: devices,
      device_heat: [],
      device_alert_count: devices.filter(function(device) {
        return String(device && device.alert_level || '') !== 'stable'
      }).length,
      totals: {},
    },
    charts: {
      platform_breakdown: mapCoremateBreakdown(data && data.platformBreakdown, '平台'),
      interaction_breakdown: mapCoremateBreakdown(data && data.interactionBreakdown, '互动'),
      mini_stats: {
        exec: (Array.isArray(data && data.highlights) ? data.highlights : []).find(function(item: any) {
          return String(item && item.key || '') === 'successCount'
        })?.value || 0,
        success_count: (Array.isArray(data && data.highlights) ? data.highlights : []).find(function(item: any) {
          return String(item && item.key || '') === 'successCount'
        })?.value || 0,
        success_count_prev: (Array.isArray(data && data.highlights) ? data.highlights : []).find(function(item: any) {
          return String(item && item.key || '') === 'successCount'
        })?.previousValue || 0,
        runtime_h: (Array.isArray(data && data.highlights) ? data.highlights : []).find(function(item: any) {
          return String(item && item.key || '') === 'runtimeHours'
        })?.value || 0,
        runtime_h_prev: (Array.isArray(data && data.highlights) ? data.highlights : []).find(function(item: any) {
          return String(item && item.key || '') === 'runtimeHours'
        })?.previousValue || 0,
        total_credits: Math.round(toNumber(data && data.totalConsumed)),
        total_credits_prev: (Array.isArray(data && data.highlights) ? data.highlights : []).find(function(item: any) {
          return String(item && item.key || '') === 'credits'
        })?.previousValue || 0,
      },
      roi: data && data.roi ? {
        value: toNumber(data.roi.value),
        cost: toNumber(data.roi.cost),
        roi: toNumber(data.roi.roi),
        saved: toNumber(data.roi.saved),
        saved_pct: toNumber(data.roi.savedPct),
        breakdown: Array.isArray(data.roi.breakdown) ? data.roi.breakdown : [],
      } : base.charts.roi,
    },
    ops_trend: mapCoremateTrend(data && data.trend),
    aggregations: {
      accounts: accounts,
      skill_groups: skillGroups,
      devices: devices,
      totals: {},
    },
    members: memberRows,
    wallet: {
      total_balance: Math.round(enterpriseWalletBalance),
      total_recharged: Math.round(enterpriseTotalPurchased),
      total_consumed: Math.round(enterpriseTotalUsed),
      admin_remaining: Math.round(adminWalletBalance),
      member_count: Number(data && data.memberCount) || Math.max(0, memberRows.length - 1),
    },
    transactions: extra && extra.transactions ? extra.transactions : {
      items: Array.isArray(data && data.recentTransactions) ? data.recentTransactions : [],
      total: Array.isArray(data && data.recentTransactions) ? data.recentTransactions.length : 0,
    },
    stats_tasks: Array.isArray(data && data.taskSummaries) ? (data.taskSummaries || []).map(function(task: any) {
      return {
        id: Number(task && task.id) || 0,
        task_id: Number(task && task.id) || 0,
        task_name: String(task && task.taskName || '未命名任务'),
        task_detail_name: String(task && task.taskName || '未命名任务'),
        related_platforms: String(task && task.platform || ''),
        total_executions: Math.round(toNumber(task && task.totalCount)),
        success_count: Math.round(toNumber(task && task.successCount)),
        fail_count: Math.max(0, Math.round(toNumber(task && task.totalCount) - toNumber(task && task.successCount))),
        category: inferTaskGroup(task),
        platforms: String(task && task.platform || '').split('/').map(function(part: string) {
          return normalizePlatformKey(part)
        }).filter(Boolean),
        runtime_h: roundMetric(toNumber(task && task.runtimeHours), 1),
        total_credits: Math.round(toNumber(task && task.credits)),
        comments: Math.round(toNumber(task && task.comments)),
        likes: Math.round(toNumber(task && task.likes)),
        saves: Math.round(toNumber(task && task.saves)),
        dms: Math.round(toNumber(task && task.dms)),
        reach: Math.round(toNumber(task && task.reach)),
      }
    }) : [],
    audit_log: extra && extra.auditLog ? extra.auditLog : base.audit_log,
  }
}

function withRequestTimeout(timeoutMs: number) {
  if (typeof AbortController === 'undefined' || timeoutMs <= 0) {
    return {
      signal: undefined as AbortSignal | undefined,
      clear: function() {},
      didTimeout: function() { return false },
    }
  }
  var controller = new AbortController()
  var timedOut = false
  var timer = window.setTimeout(function() {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    clear: function() {
      window.clearTimeout(timer)
    },
    didTimeout: function() {
      return timedOut
    },
  }
}

function cloneSnapshot(snapshot: DashboardSnapshot): DashboardSnapshot {
  return JSON.parse(JSON.stringify(snapshot));
}

function normalizeDashboardSnapshot(data: any, range: string): DashboardSnapshot {
  if (data && !data.aggs && Array.isArray(data.highlights) && Array.isArray(data.accountSummaries)) {
    return mapCoremateOverviewToSnapshot(data, range)
  }
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
      admin_remaining: Number(data.wallet.admin_remaining) || 0,
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

function getDashboardApiHeaders() {
  return Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders())
}

export function getDashboardTenantId() {
  var user = getCurrentUser()
  if (!user || !user.tenant_id) return ''
  return String(user.tenant_id)
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
  var url = buildDashboardUrl(path, query, tenantId)
  if (await shouldUseLocalMockApi()) {
    var mockData = await readLocalMockJson(url)
    if (mockData != null) {
      clearDashboardError()
      return mockData as T
    }
  }
  var headers = getDashboardApiHeaders()
  var timeout = withRequestTimeout(DASHBOARD_API_TIMEOUT_MS)
  try {
    var resp = await fetch(url, {
      headers: headers,
      signal: timeout.signal,
      credentials: 'include',
    })
    if (!resp.ok) {
      var msg = 'HTTP ' + resp.status
      try {
        var body = await resp.json()
        msg = readDashboardErrorMessage(body, msg)
      } catch {}
      console.error('[fetchDashboardJSON] failed:', msg)
      showDashboardError(errorPrefix + '：' + msg)
      return null
    }
    clearDashboardError()
    return unwrapDashboardEnvelope<T>(await resp.json())
  } catch {
    showDashboardError(errorPrefix + '：' + (timeout.didTimeout() ? '请求超时' : '网络错误'))
    return null
  } finally {
    timeout.clear()
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
        query.set('startDate', custom.start)
        query.set('endDate', custom.end || '')
      }
      var transactionsQuery = new URLSearchParams()
      transactionsQuery.set('page', '1')
      transactionsQuery.set('pageSize', String(paginationState.transactions.pageSize || 20))
      var auditLogQuery = new URLSearchParams()
      auditLogQuery.set('page', '1')
      auditLogQuery.set('pageSize', String(paginationState.oplog.pageSize || 20))
      var membersQuery = new URLSearchParams()
      membersQuery.set('page', '1')
      membersQuery.set('pageSize', '100')
      var responses = await Promise.all([
        fetchDashboardJSON<any>('/api/dashboard', '数据加载失败', query, resolvedTenantId),
        fetchDashboardJSON<any>('/api/members', '成员数据加载失败', membersQuery, resolvedTenantId),
        fetchDashboardJSON<any>('/api/wallet', '钱包数据加载失败', undefined, resolvedTenantId),
        fetchDashboardJSON<any>('/api/transactions', '交易记录加载失败', transactionsQuery, resolvedTenantId),
        fetchDashboardJSON<any>('/api/audit-log', '操作日志加载失败', auditLogQuery, resolvedTenantId),
      ])
      var rawData = responses[0]
      if (!rawData) {
        delete snapshotCache[key];
        return cloneSnapshot(EMPTY_SNAPSHOT);
      }
      var membersResponse = responses[1]
      var walletResponse = responses[2]
      var transactionsResponse = responses[3]
      var auditLogResponse = responses[4]
      var normalizedSource = rawData && !rawData.aggs && Array.isArray(rawData.highlights) && Array.isArray(rawData.accountSummaries)
        ? mapCoremateOverviewToSnapshot(rawData, range, {
            members: membersResponse && Array.isArray(membersResponse.members) ? membersResponse.members : [],
            wallet: walletResponse || undefined,
            transactions: transactionsResponse ? {
              items: Array.isArray(transactionsResponse.items) ? transactionsResponse.items : [],
              total: Number(transactionsResponse.total) || 0,
            } : undefined,
            auditLog: auditLogResponse ? {
              items: Array.isArray(auditLogResponse.items) ? auditLogResponse.items : [],
              total: Number(auditLogResponse.total) || 0,
            } : undefined,
          })
        : rawData
      var data = normalizeDashboardSnapshot(normalizedSource, range);
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

function remapQueryParams(query: URLSearchParams, mapping: Record<string, string>) {
  var next = new URLSearchParams()
  query.forEach(function(value, key) {
    next.set(mapping[key] || key, value)
  })
  return next
}

function appendAuditRemark(base: string, remark: any) {
  var text = String(remark || '').trim();
  return text ? base + '（' + text + '）' : base;
}

function normalizeTransactionType(changeType: any, changeAmount?: any) {
  var type = String(changeType || '').toUpperCase();
  if (type === 'CONSUME') return '消耗';
  if (type === 'RECHARGE') return '充值';
  if (type === 'DISTRIBUTE') return Number(changeAmount || 0) < 0 ? '扣减' : '分发';
  if (type === 'DEDUCT') return '扣减';
  if (type === 'GIFT') return '赠送';
  if (type === 'CHECKIN' || type === 'SIGNIN') return '签到';
  return String(changeType || '未知');
}

function normalizeTransactionDesc(item: any) {
  var changeType = item.change_type || item.changeType
  if (changeType === 'CONSUME') {
    var taskName = item.task_name || item.taskName || item.remark || '任务消耗';
    var callCount = Number(item.call_count || item.callCount || 0);
    return callCount > 1 ? taskName + '（' + callCount + '次调用）' : taskName;
  }
  if (item.remark) return String(item.remark);
  if (item.task_name) return String(item.task_name);
  if (changeType === 'RECHARGE') return '账户充值';
  if (changeType === 'DISTRIBUTE') {
    var changeAmount = item.total_change != null ? item.total_change : item.changeAmount
    return Number(changeAmount || 0) < 0 ? '扣减算力豆' : '分发算力豆';
  }
  if (changeType === 'DEDUCT') return '扣减算力豆';
  return String(changeType || '—');
}

export function normalizeTransactions(data: any): { items: any[]; total: number } {
  var rawItems = Array.isArray(data && data.items) ? data.items : [];
  return {
    items: rawItems.map(function(item) {
      var changeType = item.change_type || item.changeType
      var changeAmount = item.total_change != null ? item.total_change : item.changeAmount
      var balanceAfter = item.balance_after != null ? item.balance_after : item.balanceAfter
      var endedAt = item.ended_at || item.createdAt || item.started_at
      return {
        id: item.id || item.task_exec_id || [item.username || item.userName, changeType, endedAt, changeAmount].join('_'),
        time: formatRecordTime(endedAt),
        member: item.username || item.userName || '系统',
        type: normalizeTransactionType(changeType, changeAmount),
        desc: normalizeTransactionDesc(item),
        change: Number(changeAmount || 0),
        balance: Number(balanceAfter || 0),
        raw: item,
      };
    }),
    total: Number(data && data.total) || rawItems.length,
  };
}

function normalizeAuditAction(action: any) {
  var value = String(action || '').toUpperCase();
  if (value === 'TRANSFER_CREDITS' || value === 'CREDIT_DISTRIBUTE') return '分发算力豆';
  if (value === 'CREDIT_DEDUCT') return '扣减算力豆';
  if (value === 'MEMBER_UPDATE') return '编辑成员';
  if (value === 'REMOVE_MEMBER' || value === 'MEMBER_DELETE') return '删除成员';
  if (value === 'ADD_MEMBER' || value === 'MEMBER_CREATE') return '新增成员';
  if (value === 'MEMBER_BAN') return '封禁成员';
  return String(action || '操作记录');
}

function normalizeAuditTarget(item: any, action: string) {
  var targetName = item.target_user_name || item.targetUserName || '未知成员';
  var creditsAmount = Math.round(Number(item.credits_amount != null ? item.credits_amount : item.creditsAmount || 0));
  if (action === '分发算力豆') {
    var base = '分发 ' + creditsAmount.toLocaleString() + ' 算力豆给 ' + targetName;
    return appendAuditRemark(base, item.remark);
  }
  if (action === '扣减算力豆') {
    return appendAuditRemark('扣减 ' + creditsAmount.toLocaleString() + ' 算力豆自 ' + targetName, item.remark);
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
  if (action === '封禁成员') return '已封禁';
  if (action === '扣减算力豆') return '已扣减';
  return '已完成';
}

export function normalizeAuditLog(data: any): { items: any[]; total: number } {
  var rawItems = Array.isArray(data && data.items) ? data.items : [];
  return {
    items: rawItems.map(function(item) {
      var action = normalizeAuditAction(item.action);
      return {
        id: item.id,
        time: formatRecordTime(item.created_at || item.createdAt),
        operator: item.operator_name || item.operatorName || '系统',
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
  var query = remapQueryParams(buildRecordQuery(page, pageSize, filters), {
    page_size: 'pageSize',
    start_date: 'startDate',
    end_date: 'endDate',
  })
  var data = await fetchDashboardJSON<any>('/api/audit-log', '操作日志加载失败', query, tenantId)
  return data ? normalizeAuditLog(data) : { items: [], total: 0 }
}

export async function fetchTransactions(page: number, pageSize: number, filters?: URLSearchParams, tenantId?: string): Promise<{ items: any[]; total: number }> {
  var query = remapQueryParams(buildRecordQuery(page, pageSize, filters), {
    page_size: 'pageSize',
    member_id: 'userId',
    tx_type: 'changeType',
    start_date: 'startDate',
    end_date: 'endDate',
  })
  var data = await fetchDashboardJSON<any>('/api/transactions', '交易记录加载失败', query, tenantId)
  return data ? normalizeTransactions(data) : { items: [], total: 0 }
}

export async function fetchMembers(tenantId?: string): Promise<any[]> {
  var query = new URLSearchParams()
  query.set('page', '1')
  query.set('pageSize', '100')
  var data = await fetchDashboardJSON<any>('/api/members', '成员数据加载失败', query, tenantId)
  return data && Array.isArray(data.members) ? mapCoremateMembers(data.members, 0) : []
}

export async function fetchTaskSummaries(tenantId?: string): Promise<any[]> {
  var query = new URLSearchParams()
  query.set('range', '7d')
  var data = await fetchDashboardJSON<any>('/api/dashboard', '任务数据加载失败', query, tenantId)
  return data && Array.isArray(data.taskSummaries) ? data.taskSummaries : []
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
  if (await shouldUseLocalMockApi()) {
    var mockData = await readLocalMockAccountWeekSummary(accountId)
    if (mockData) return mockData
  }
  var keys = Object.keys(snapshotCache)
  for (var i = 0; i < keys.length; i += 1) {
    var snapshot = snapshotCache[keys[i]] && snapshotCache[keys[i]].data
    var account = snapshot && snapshot.aggs && Array.isArray(snapshot.aggs.accounts)
      ? snapshot.aggs.accounts.find(function(item: any) {
          return String(item && item.id || '') === String(accountId || '')
        })
      : null
    if (account) {
      return {
        account: {
          id: String(account.id || accountId),
          name: String(account.name || account.username || '账号详情'),
          role: String(account.role || 'member'),
          platforms: Array.isArray(account.platforms) ? account.platforms : [],
        },
        summary: {
          success_count: Math.round(toNumber(account.success_count)),
          total_credits: Math.round(toNumber(account.total_credits)),
          runtime_h: roundMetric(toNumber(account.runtime_h), 1),
          reach: Math.round(toNumber(account.reach)),
          comments: Math.round(toNumber(account.comments)),
          likes: Math.round(toNumber(account.likes)),
          saves: Math.round(toNumber(account.saves)),
          dms: Math.round(toNumber(account.dms)),
        },
        success: buildSyntheticWeeklySeries(toNumber(account.success_count)),
      }
    }
  }
  var fallback = await readLocalMockAccountWeekSummary(accountId)
  if (fallback) return fallback
  throw new Error('账号周汇总暂不可用')
}

export async function fetchTaskWeekSummary(taskId: string): Promise<TaskWeekSummary> {
  if (await shouldUseLocalMockApi()) {
    var mockData = await readLocalMockTaskWeekSummary(taskId)
    if (mockData) return mockData
  }
  var cachedKeys = Object.keys(snapshotCache)
  for (var i = 0; i < cachedKeys.length; i += 1) {
    var entry = snapshotCache[cachedKeys[i]]
    var snapshot = entry && entry.data
    var task = snapshot && Array.isArray(snapshot.stats_tasks)
      ? snapshot.stats_tasks.find(function(item: any) { return String(item && item.id || item && item.task_id || '') === String(taskId || '') })
      : null
    if (task) {
      return {
        task_info: {
          id: Number(task.id || task.task_id) || 0,
          name: String(task.task_name || task.task_detail_name || '任务详情'),
          category: String(task.category || inferTaskGroup(task)),
          created_at: String(task.created_at || ''),
          platforms: Array.isArray(task.platforms) ? task.platforms : String(task.related_platforms || '').split('/').map(function(part) {
            return normalizePlatformKey(part)
          }).filter(Boolean),
        },
        summary: {
          success_count: Math.round(toNumber(task.success_count)),
          total_credits: Math.round(toNumber(task.total_credits)),
          runtime_h: roundMetric(toNumber(task.runtime_h), 1),
          reach: Math.round(toNumber(task.reach)),
        },
        success: buildSyntheticWeeklySeries(toNumber(task.success_count)),
      }
    }
  }
  var fallback = await readLocalMockTaskWeekSummary(taskId)
  if (fallback) return fallback
  throw new Error('任务周汇总暂不可用')
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
  var rows = Array.isArray(data) ? data.slice() : [];
  var currentUser = getCurrentUser();
  if (currentUser && currentUser.id > 0) {
    var hasAdmin = rows.some(function(m) { return Number(m && m.id) === Number(currentUser.id) })
    if (!hasAdmin) {
      var currentRole = (currentUser.role === 'admin' || currentUser.role === 'enterprise_admin') ? 'admin' : 'member'
      rows.unshift({
        id: currentUser.id,
        username: currentUser.name || '管理员',
        phone: currentUser.phoneNumber || '',
        role: currentRole,
        balance: 0,
        join_date: '',
      })
    }
  }
  membersData.length = 0;
  rows.forEach(function(m) {
    membersData.push({
      id: m.id,
      name: m.username || m.name || '未知',
      phone: m.phone || m.phoneNumber || '',
      role: (m.role === 'admin' || m.role === 'enterprise_admin') ? 'admin' : 'member',
      balance: Math.round(toNumber(m.balance != null ? m.balance : m.remaining)),
      joinDate: (m.join_date || m.createdAt || '').slice(0, 10),
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
  if (currentUser) {
    if (nameEl) nameEl.textContent = currentUser.name || '未命名用户';
    if (avatarEl) avatarEl.textContent = (currentUser.name || '用').charAt(0);
    if (roleEl) roleEl.textContent = currentUser.role === 'admin' ? '管理员' : '成员';
  } else if (admin) {
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
  var totalBalance = Math.round(Number(data && (data.total_balance != null ? data.total_balance : (data.enterpriseRemaining != null ? data.enterpriseRemaining : data.remaining))) || 0)
  var totalRecharged = Math.round(Number(data && (data.total_recharged != null ? data.total_recharged : (data.enterpriseTotalPurchased != null ? data.enterpriseTotalPurchased : data.totalPurchased))) || 0)
  var totalConsumed = Math.round(Number(data && (data.total_consumed != null ? data.total_consumed : (data.enterpriseTotalUsed != null ? data.enterpriseTotalUsed : data.totalUsed))) || 0)
  var adminRemaining = Math.round(Number(data && (data.admin_remaining != null ? data.admin_remaining : data.remaining)) || 0)
  setIf('statWallet', totalBalance.toLocaleString());
  setIf('statTopup', totalRecharged.toLocaleString());
  setIf('statConsumed', totalConsumed.toLocaleString());
  var currentUser = getCurrentUser()
  if (currentUser) {
    var admin = membersData.find(function(member) { return Number(member.id) === Number(currentUser.id) })
    if (admin && admin.balance !== adminRemaining) {
      admin.balance = adminRemaining
      renderMembers()
    }
  }
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

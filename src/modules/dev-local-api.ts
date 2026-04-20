type MockRangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

type ApiMode = 'live' | 'mock'

type HighlightCardFixture = {
  key: string
  label: string
  value: number
  prev: number
  unit: string
  series: { labels: string[]; values: number[] }
  stats: { avg: number; peak: number; avg_label: string; peak_label: string }
}

type TrendFixture = {
  labels: string[]
  dates: string[]
  success: number[]
  failed: number[]
  comments: number[]
  likes: number[]
  saves: number[]
  dms: number[]
  reach: number[]
  runtime_h: number[]
  credits: number[]
}

type RangeFixture = {
  highlights: HighlightCardFixture[]
  achievements: any[]
  platform_breakdown: any[]
  interaction_breakdown: any[]
  mini_stats: any
  ops_trend: TrendFixture
}

type MockMember = {
  id: number
  username: string
  phone: string
  role: string
  balance: number
  join_date: string
  exec_count: number
  total_tokens: number
}

type MockTransaction = {
  id: string
  user_id: number | null
  change_type: string
  task_exec_id: string | null
  task_name: string | null
  username: string
  call_count: number
  total_change: number
  balance_after: number
  started_at: string
  ended_at: string
}

type MockAuditLog = {
  id: number
  action: string
  operator_name: string
  target_user_name: string
  credits_amount: number
  remark: string
  created_at: string
}

type MockAccount = {
  id: string
  name: string
  role: string
  device_id: string
  device_label: string
  total_credits: number
  success_count: number
  runtime_h: number
  comments: number
  likes: number
  favorites: number
  dms: number
  reach: number
  platforms: string[]
  success: number[]
}

type MockTask = {
  id: string
  task_name: string
  task_detail_name: string
  related_platforms: string
  total_executions: number
  success_count: number
  fail_count: number
  category: string
  created_at: string
  platforms: string[]
  total_credits: number
  runtime_h: number
  reach: number
  success: number[]
}

var DEV_DIRECT_API_ORIGIN = ((import.meta as any).env && (import.meta as any).env.VITE_DEV_API_ORIGIN) || 'http://127.0.0.1:12306'
var DEV_FORCE_LOCAL_MOCK = String((((import.meta as any).env && (import.meta as any).env.VITE_USE_LOCAL_MOCK) || '')).trim().toLowerCase()
var DEV_DETECT_TIMEOUT_MS = 1200
var DEV_PROXY_HEALTH_PATH = '/api/health'
var apiModePromise: Promise<ApiMode> | null = null
var hasLoggedLocalMock = false

var mockMembers: MockMember[] = [
  {
    id: 101,
    username: '周岚',
    phone: '138****8801',
    role: 'admin',
    balance: 8600,
    join_date: '2026-03-06',
    exec_count: 126,
    total_tokens: 3820,
  },
  {
    id: 102,
    username: '陈果',
    phone: '139****1024',
    role: 'member',
    balance: 2400,
    join_date: '2026-03-19',
    exec_count: 88,
    total_tokens: 2140,
  },
  {
    id: 103,
    username: '林澈',
    phone: '137****6642',
    role: 'member',
    balance: 1800,
    join_date: '2026-03-27',
    exec_count: 74,
    total_tokens: 1830,
  },
  {
    id: 104,
    username: '徐舟',
    phone: '136****4308',
    role: 'member',
    balance: 1200,
    join_date: '2026-04-02',
    exec_count: 49,
    total_tokens: 1210,
  },
]

var mockAccounts: MockAccount[] = [
  {
    id: 'acc-xhs-hz',
    name: '小红书-杭州旗舰号',
    role: '获客主号',
    device_id: 'dev-ios-01',
    device_label: 'iPhone 15 Pro Max',
    total_credits: 2860,
    success_count: 128,
    runtime_h: 28.6,
    comments: 384,
    likes: 1135,
    favorites: 236,
    dms: 61,
    reach: 18200,
    platforms: ['xhs'],
    success: [14, 16, 17, 19, 20, 21, 21],
  },
  {
    id: 'acc-dy-sh',
    name: '抖音-华东运营号',
    role: '运营主号',
    device_id: 'dev-android-02',
    device_label: 'Xiaomi 14 Ultra',
    total_credits: 2140,
    success_count: 97,
    runtime_h: 21.4,
    comments: 256,
    likes: 892,
    favorites: 162,
    dms: 28,
    reach: 15400,
    platforms: ['douyin'],
    success: [10, 12, 14, 15, 15, 15, 16],
  },
  {
    id: 'acc-wx-gz',
    name: '微信-私域转化号',
    role: '转化号',
    device_id: 'dev-ios-03',
    device_label: 'iPhone 14',
    total_credits: 1680,
    success_count: 76,
    runtime_h: 18.9,
    comments: 148,
    likes: 402,
    favorites: 84,
    dms: 52,
    reach: 10800,
    platforms: ['wechat'],
    success: [8, 10, 11, 11, 12, 12, 12],
  },
  {
    id: 'acc-ks-sz',
    name: '快手-深圳测试号',
    role: '冷启动号',
    device_id: 'dev-android-04',
    device_label: 'OnePlus 12',
    total_credits: 1240,
    success_count: 58,
    runtime_h: 13.8,
    comments: 96,
    likes: 284,
    favorites: 58,
    dms: 18,
    reach: 7600,
    platforms: ['kuaishou'],
    success: [6, 7, 8, 8, 9, 10, 10],
  },
]

var mockTasks: MockTask[] = [
  {
    id: 'task-acquire-01',
    task_name: '小红书评论获客',
    task_detail_name: '按关键词评论并引导私信',
    related_platforms: '小红书',
    total_executions: 118,
    success_count: 92,
    fail_count: 26,
    category: '获客触达',
    created_at: '2026-04-11T10:00:00+08:00',
    platforms: ['xhs'],
    total_credits: 1680,
    runtime_h: 21.2,
    reach: 13200,
    success: [10, 11, 12, 13, 14, 15, 17],
  },
  {
    id: 'task-acquire-02',
    task_name: '抖音直播间引流',
    task_detail_name: '直播评论区引导关注',
    related_platforms: '抖音',
    total_executions: 104,
    success_count: 81,
    fail_count: 23,
    category: '获客触达',
    created_at: '2026-04-09T18:20:00+08:00',
    platforms: ['douyin'],
    total_credits: 1430,
    runtime_h: 17.6,
    reach: 11600,
    success: [8, 9, 11, 11, 12, 14, 16],
  },
  {
    id: 'task-ops-01',
    task_name: '私域老客唤醒',
    task_detail_name: '微信老客激活与跟进',
    related_platforms: '微信',
    total_executions: 76,
    success_count: 61,
    fail_count: 15,
    category: '运营维护',
    created_at: '2026-04-08T09:10:00+08:00',
    platforms: ['wechat'],
    total_credits: 960,
    runtime_h: 12.4,
    reach: 8200,
    success: [6, 7, 8, 9, 9, 10, 12],
  },
  {
    id: 'task-ops-02',
    task_name: '快手线索回访',
    task_detail_name: '沉默线索二次跟进',
    related_platforms: '快手',
    total_executions: 54,
    success_count: 43,
    fail_count: 11,
    category: '运营维护',
    created_at: '2026-04-05T14:30:00+08:00',
    platforms: ['kuaishou'],
    total_credits: 820,
    runtime_h: 9.8,
    reach: 6200,
    success: [4, 5, 5, 6, 7, 8, 8],
  },
]

var mockTransactions: MockTransaction[] = [
  {
    id: 'tx-01',
    user_id: null,
    change_type: 'RECHARGE',
    task_exec_id: null,
    task_name: '企业充值',
    username: '系统',
    call_count: 1,
    total_change: 30000,
    balance_after: 30000,
    started_at: '2026-04-11T09:00:00+08:00',
    ended_at: '2026-04-11T09:00:00+08:00',
  },
  {
    id: 'tx-02',
    user_id: 102,
    change_type: 'DISTRIBUTE',
    task_exec_id: null,
    task_name: '分发算力豆',
    username: '陈果',
    call_count: 1,
    total_change: 1500,
    balance_after: 2800,
    started_at: '2026-04-18T09:10:00+08:00',
    ended_at: '2026-04-18T09:10:00+08:00',
  },
  {
    id: 'tx-03',
    user_id: 102,
    change_type: 'CONSUME',
    task_exec_id: 'exec-240418-01',
    task_name: '小红书评论获客',
    username: '陈果',
    call_count: 12,
    total_change: -620,
    balance_after: 2180,
    started_at: '2026-04-18T11:10:00+08:00',
    ended_at: '2026-04-18T11:42:00+08:00',
  },
  {
    id: 'tx-04',
    user_id: 103,
    change_type: 'DISTRIBUTE',
    task_exec_id: null,
    task_name: '分发算力豆',
    username: '林澈',
    call_count: 1,
    total_change: 1200,
    balance_after: 2100,
    started_at: '2026-04-18T15:05:00+08:00',
    ended_at: '2026-04-18T15:05:00+08:00',
  },
  {
    id: 'tx-05',
    user_id: 103,
    change_type: 'CONSUME',
    task_exec_id: 'exec-240419-03',
    task_name: '私域老客唤醒',
    username: '林澈',
    call_count: 9,
    total_change: -410,
    balance_after: 1690,
    started_at: '2026-04-19T10:18:00+08:00',
    ended_at: '2026-04-19T10:52:00+08:00',
  },
  {
    id: 'tx-06',
    user_id: 104,
    change_type: 'DISTRIBUTE',
    task_exec_id: null,
    task_name: '分发算力豆',
    username: '徐舟',
    call_count: 1,
    total_change: 900,
    balance_after: 1300,
    started_at: '2026-04-19T13:32:00+08:00',
    ended_at: '2026-04-19T13:32:00+08:00',
  },
  {
    id: 'tx-07',
    user_id: 104,
    change_type: 'CONSUME',
    task_exec_id: 'exec-240419-06',
    task_name: '快手线索回访',
    username: '徐舟',
    call_count: 7,
    total_change: -250,
    balance_after: 1050,
    started_at: '2026-04-19T17:05:00+08:00',
    ended_at: '2026-04-19T17:22:00+08:00',
  },
]

var mockAuditLog: MockAuditLog[] = [
  {
    id: 401,
    action: 'TRANSFER_CREDITS',
    operator_name: '周岚',
    target_user_name: '陈果',
    credits_amount: 1500,
    remark: '周度投放预算',
    created_at: '2026-04-18T09:10:00+08:00',
  },
  {
    id: 402,
    action: 'TRANSFER_CREDITS',
    operator_name: '周岚',
    target_user_name: '林澈',
    credits_amount: 1200,
    remark: '私域维护补充',
    created_at: '2026-04-18T15:05:00+08:00',
  },
  {
    id: 403,
    action: 'TRANSFER_CREDITS',
    operator_name: '周岚',
    target_user_name: '徐舟',
    credits_amount: 900,
    remark: '测试账号冷启动',
    created_at: '2026-04-19T13:32:00+08:00',
  },
  {
    id: 404,
    action: 'MEMBER_UPDATE',
    operator_name: '周岚',
    target_user_name: '林澈',
    credits_amount: 0,
    remark: '更新手机号与职责',
    created_at: '2026-04-19T15:20:00+08:00',
  },
]

function withTimeout(timeoutMs: number) {
  if (typeof AbortController === 'undefined' || timeoutMs <= 0) {
    return {
      signal: undefined as AbortSignal | undefined,
      clear: function() {},
    }
  }
  var controller = new AbortController()
  var timer = window.setTimeout(function() {
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    clear: function() {
      window.clearTimeout(timer)
    },
  }
}

function sum(values: number[]) {
  return values.reduce(function(total, value) { return total + Number(value || 0) }, 0)
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0
}

function buildCard(key: string, label: string, unit: string, values: number[], prevValues: number[]): HighlightCardFixture {
  var peak = values.length ? Math.max.apply(null, values) : 0
  var peakIndex = values.indexOf(peak)
  return {
    key: key,
    label: label,
    value: sum(values),
    prev: sum(prevValues),
    unit: unit,
    series: {
      labels: values.map(function(_, index) { return String(index + 1) }),
      values: values.slice(),
    },
    stats: {
      avg: average(values),
      peak: peak,
      avg_label: '日均',
      peak_label: peakIndex >= 0 ? '峰值 Day ' + String(peakIndex + 1) : '峰值',
    },
  }
}

function buildHourlyLabels() {
  return Array.from({ length: 24 }, function(_, index) {
    return String(index).padStart(2, '0') + ':00'
  })
}

function buildDailyLabels(count: number, month: number, startDay: number) {
  return Array.from({ length: count }, function(_, index) {
    return String(month).padStart(2, '0') + '/' + String(startDay + index).padStart(2, '0')
  })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function buildTrendFixture(
  labels: string[],
  success: number[],
  failed: number[],
  comments: number[],
  likes: number[],
  saves: number[],
  dms: number[],
  reach: number[],
  runtime_h: number[],
  credits: number[]
): TrendFixture {
  return {
    labels: labels.slice(),
    dates: labels.slice(),
    success: success.slice(),
    failed: failed.slice(),
    comments: comments.slice(),
    likes: likes.slice(),
    saves: saves.slice(),
    dms: dms.slice(),
    reach: reach.slice(),
    runtime_h: runtime_h.slice(),
    credits: credits.slice(),
  }
}

function buildAchievements(headlines: Array<{ emoji: string; headline: string; current: number; prev: number; detail: string }>) {
  return headlines.map(function(item) {
    return {
      emoji: item.emoji,
      headline: item.headline,
      current: item.current,
      prev: item.prev,
      detail: item.detail,
      copy: item.headline,
    }
  })
}

function rangeFixture(
  trend: TrendFixture,
  achievements: any[],
  platformBreakdown: any[],
  interactionBreakdown: any[],
): RangeFixture {
  var success = trend.success.slice()
  var runtime = trend.runtime_h.map(function(value) { return Number(value.toFixed(1)) })
  var credits = trend.credits.slice()
  var reach = trend.reach.slice()
  return {
    highlights: [
      buildCard('successCount', '完成数', '', success, success.map(function(value) { return Math.max(0, Math.round(value * 0.82)) })),
      buildCard('runtimeHours', '运行时长', 'h', runtime, runtime.map(function(value) { return Math.max(0, Number((value * 0.86).toFixed(1))) })),
      buildCard('creditsCost', '算力豆', '', credits, credits.map(function(value) { return Math.max(0, Math.round(value * 0.84)) })),
      buildCard('reach', '触达量', '', reach, reach.map(function(value) { return Math.max(0, Math.round(value * 0.81)) })),
    ],
    achievements: achievements,
    platform_breakdown: platformBreakdown,
    interaction_breakdown: interactionBreakdown,
    mini_stats: {
      exec: sum(success),
      success_count: sum(success),
      success_count_prev: sum(success.map(function(value) { return Math.max(0, Math.round(value * 0.82)) })),
      runtime_h: Number(sum(runtime).toFixed(1)),
      runtime_h_prev: Number(sum(runtime.map(function(value) { return Number((value * 0.86).toFixed(1)) })).toFixed(1)),
      total_credits: sum(credits),
      total_credits_prev: sum(credits.map(function(value) { return Math.max(0, Math.round(value * 0.84)) })),
    },
    ops_trend: trend,
  }
}

var RANGE_FIXTURES: Record<MockRangeKey, RangeFixture> = {
  today: rangeFixture(
    buildTrendFixture(
      buildHourlyLabels(),
      [0, 0, 0, 0, 1, 1, 2, 3, 5, 7, 8, 8, 7, 9, 10, 8, 7, 6, 4, 3, 2, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 4, 3, 6, 8, 12, 16, 19, 18, 15, 17, 18, 16, 14, 10, 8, 5, 4, 2, 0, 0],
      [0, 0, 0, 0, 8, 12, 18, 26, 34, 48, 56, 60, 52, 58, 62, 54, 44, 36, 24, 16, 10, 4, 0, 0],
      [0, 0, 0, 0, 1, 2, 2, 4, 5, 8, 9, 10, 8, 8, 9, 8, 6, 4, 3, 2, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 1, 2, 4, 5, 6, 5, 5, 6, 6, 5, 4, 3, 2, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 40, 56, 86, 124, 180, 260, 310, 322, 298, 336, 362, 318, 290, 224, 160, 116, 74, 32, 0, 0],
      [0, 0, 0, 0, 0.2, 0.4, 0.8, 1.3, 1.8, 2.2, 2.7, 2.8, 2.6, 2.9, 3.0, 2.6, 2.3, 1.9, 1.4, 1.0, 0.6, 0.3, 0, 0],
      [0, 0, 0, 0, 22, 34, 48, 72, 98, 136, 158, 164, 152, 172, 180, 164, 142, 118, 86, 64, 42, 18, 0, 0],
    ),
    buildAchievements([
      { emoji: '🔥', headline: '午后转化峰值出现', current: 18, prev: 12, detail: '14:00-16:00 时段私信转化明显提升' },
      { emoji: '✨', headline: '小红书评论效率更高', current: 62, prev: 48, detail: '互动量较昨日同时间段增长明显' },
    ]),
    [
      { name: '小红书', value: 362, color: '#ef4444' },
      { name: '抖音', value: 244, color: '#111827' },
      { name: '微信', value: 196, color: '#16a34a' },
      { name: '快手', value: 118, color: '#f97316' },
    ],
    [
      { name: '评论', value: 181, color: '#2563eb' },
      { name: '点赞', value: 548, color: '#f59e0b' },
      { name: '收藏', value: 90, color: '#db2777' },
      { name: '私信', value: 57, color: '#7c3aed' },
    ],
  ),
  yesterday: rangeFixture(
    buildTrendFixture(
      buildHourlyLabels(),
      [0, 0, 0, 0, 0, 1, 1, 2, 4, 5, 6, 7, 7, 8, 8, 7, 6, 5, 3, 2, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 2, 3, 5, 7, 10, 12, 14, 15, 14, 15, 16, 15, 12, 9, 6, 4, 2, 1, 0, 0],
      [0, 0, 0, 0, 6, 10, 14, 18, 26, 34, 42, 45, 44, 48, 50, 44, 36, 28, 22, 14, 8, 4, 0, 0],
      [0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 7, 7, 7, 8, 8, 7, 5, 3, 2, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 1, 2, 2, 4, 4, 4, 4, 5, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 32, 42, 64, 88, 128, 166, 194, 206, 198, 214, 228, 212, 186, 144, 110, 72, 36, 18, 0, 0],
      [0, 0, 0, 0, 0.2, 0.3, 0.6, 0.9, 1.3, 1.6, 1.9, 2.1, 2.1, 2.3, 2.3, 2.0, 1.7, 1.4, 1.0, 0.7, 0.4, 0.2, 0, 0],
      [0, 0, 0, 0, 18, 26, 40, 56, 80, 102, 118, 124, 118, 132, 136, 126, 110, 88, 62, 40, 22, 10, 0, 0],
    ),
    buildAchievements([
      { emoji: '📈', headline: '互动节奏更稳定', current: 50, prev: 42, detail: '整体曲线更平滑，异常波动减少' },
      { emoji: '🤝', headline: '私域接待效率提升', current: 38, prev: 26, detail: '晚间响应速度明显更快' },
    ]),
    [
      { name: '小红书', value: 318, color: '#ef4444' },
      { name: '抖音', value: 212, color: '#111827' },
      { name: '微信', value: 174, color: '#16a34a' },
      { name: '快手', value: 96, color: '#f97316' },
    ],
    [
      { name: '评论', value: 132, color: '#2563eb' },
      { name: '点赞', value: 416, color: '#f59e0b' },
      { name: '收藏', value: 66, color: '#db2777' },
      { name: '私信', value: 44, color: '#7c3aed' },
    ],
  ),
  '7d': rangeFixture(
    buildTrendFixture(
      buildDailyLabels(7, 4, 14),
      [38, 44, 47, 53, 58, 62, 65],
      [8, 7, 9, 8, 7, 6, 5],
      [112, 126, 132, 148, 156, 171, 184],
      [308, 336, 362, 394, 428, 466, 512],
      [62, 68, 72, 80, 84, 90, 96],
      [24, 28, 31, 36, 39, 43, 48],
      [1680, 1820, 1940, 2120, 2280, 2440, 2610],
      [8.4, 9.1, 9.7, 10.6, 11.2, 11.9, 12.8],
      [420, 468, 492, 536, 584, 612, 658],
    ),
    buildAchievements([
      { emoji: '🚀', headline: '周完成数冲到新高', current: 367, prev: 302, detail: '较上周多完成 65 次，主增量来自获客任务' },
      { emoji: '💬', headline: '私信线索持续抬升', current: 249, prev: 188, detail: '微信与小红书私信量同步增长' },
      { emoji: '🎯', headline: '触达质量保持稳定', current: 14890, prev: 12100, detail: '高意向互动比例维持在较高水平' },
    ]),
    [
      { name: '小红书', value: 9620, color: '#ef4444' },
      { name: '抖音', value: 6840, color: '#111827' },
      { name: '微信', value: 4720, color: '#16a34a' },
      { name: '快手', value: 3180, color: '#f97316' },
    ],
    [
      { name: '评论', value: 1029, color: '#2563eb' },
      { name: '点赞', value: 2806, color: '#f59e0b' },
      { name: '收藏', value: 552, color: '#db2777' },
      { name: '私信', value: 249, color: '#7c3aed' },
    ],
  ),
  '30d': rangeFixture(
    buildTrendFixture(
      buildDailyLabels(30, 3, 22),
      [18, 21, 19, 22, 23, 24, 26, 28, 30, 32, 31, 33, 34, 36, 38, 37, 39, 40, 42, 41, 43, 45, 46, 47, 49, 52, 54, 56, 58, 60],
      [4, 5, 4, 5, 5, 6, 6, 5, 6, 6, 5, 6, 5, 6, 6, 5, 5, 6, 6, 5, 5, 5, 6, 5, 5, 6, 6, 5, 5, 4],
      [52, 60, 58, 64, 68, 72, 76, 82, 88, 94, 92, 98, 102, 108, 112, 110, 116, 122, 128, 126, 132, 138, 142, 146, 150, 158, 164, 170, 176, 182],
      [148, 162, 156, 170, 178, 184, 192, 206, 214, 226, 220, 232, 238, 248, 258, 252, 264, 272, 286, 280, 294, 308, 316, 324, 338, 352, 368, 384, 398, 416],
      [26, 28, 27, 30, 32, 33, 34, 38, 40, 41, 40, 42, 44, 46, 48, 47, 49, 50, 52, 51, 54, 55, 56, 58, 60, 62, 64, 67, 70, 72],
      [10, 11, 10, 12, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 19, 20, 21, 22, 22, 23, 24, 24, 25, 26, 28, 29, 30, 31, 32],
      [820, 910, 900, 980, 1020, 1060, 1120, 1180, 1260, 1340, 1320, 1400, 1460, 1520, 1600, 1580, 1660, 1740, 1820, 1790, 1880, 1960, 2010, 2080, 2160, 2280, 2380, 2460, 2540, 2680],
      [4.2, 4.8, 4.6, 5.0, 5.2, 5.4, 5.8, 6.1, 6.4, 6.8, 6.7, 7.0, 7.2, 7.5, 7.9, 7.7, 8.0, 8.3, 8.6, 8.5, 8.8, 9.1, 9.3, 9.5, 9.8, 10.2, 10.6, 10.9, 11.2, 11.6],
      [206, 224, 218, 240, 248, 256, 270, 284, 298, 312, 306, 324, 332, 346, 362, 358, 372, 386, 404, 398, 412, 428, 436, 448, 462, 488, 506, 522, 536, 554],
    ),
    buildAchievements([
      { emoji: '🏁', headline: '月度完成数稳步攀升', current: 1119, prev: 902, detail: '较上月提升 24%，增长趋势健康' },
      { emoji: '💎', headline: '高价值线索累计增加', current: 684, prev: 532, detail: '收藏与私信协同增长，转化面更宽' },
      { emoji: '🧭', headline: '渠道结构更均衡', current: 4, prev: 3, detail: '微信与快手占比提升，投放风险更分散' },
    ]),
    [
      { name: '小红书', value: 32840, color: '#ef4444' },
      { name: '抖音', value: 24860, color: '#111827' },
      { name: '微信', value: 17620, color: '#16a34a' },
      { name: '快手', value: 11240, color: '#f97316' },
    ],
    [
      { name: '评论', value: 3285, color: '#2563eb' },
      { name: '点赞', value: 8045, color: '#f59e0b' },
      { name: '收藏', value: 1425, color: '#db2777' },
      { name: '私信', value: 614, color: '#7c3aed' },
    ],
  ),
  custom: rangeFixture(
    buildTrendFixture(
      buildDailyLabels(7, 4, 14),
      [38, 44, 47, 53, 58, 62, 65],
      [8, 7, 9, 8, 7, 6, 5],
      [112, 126, 132, 148, 156, 171, 184],
      [308, 336, 362, 394, 428, 466, 512],
      [62, 68, 72, 80, 84, 90, 96],
      [24, 28, 31, 36, 39, 43, 48],
      [1680, 1820, 1940, 2120, 2280, 2440, 2610],
      [8.4, 9.1, 9.7, 10.6, 11.2, 11.9, 12.8],
      [420, 468, 492, 536, 584, 612, 658],
    ),
    buildAchievements([
      { emoji: '📌', headline: '自定义区间命中高效段', current: 367, prev: 302, detail: '当前自定义区间沿用最近一周演示数据' },
    ]),
    [
      { name: '小红书', value: 9620, color: '#ef4444' },
      { name: '抖音', value: 6840, color: '#111827' },
      { name: '微信', value: 4720, color: '#16a34a' },
      { name: '快手', value: 3180, color: '#f97316' },
    ],
    [
      { name: '评论', value: 1029, color: '#2563eb' },
      { name: '点赞', value: 2806, color: '#f59e0b' },
      { name: '收藏', value: 552, color: '#db2777' },
      { name: '私信', value: 249, color: '#7c3aed' },
    ],
  ),
}

function getMockSkillGroups() {
  return [
    {
      id: 'acquire',
      name: '获客触达',
      items: [
        {
          skill_id: 'task-acquire-01',
          task_group: 'acquire',
          skill_code: 'ACQ-01',
          skill_name: '小红书评论获客',
          description: '按关键词评论并引导私信',
          success_count: 92,
          total_executions: 118,
          fail_count: 26,
          total_credits: 1680,
          runtime_h: 21.2,
          comments: 286,
          likes: 742,
          favorites: 164,
          dms: 68,
          reach: 13200,
        },
        {
          skill_id: 'task-acquire-02',
          task_group: 'acquire',
          skill_code: 'ACQ-02',
          skill_name: '抖音直播间引流',
          description: '直播评论区引导关注与私聊',
          success_count: 81,
          total_executions: 104,
          fail_count: 23,
          total_credits: 1430,
          runtime_h: 17.6,
          comments: 214,
          likes: 612,
          favorites: 122,
          dms: 54,
          reach: 11600,
        },
      ],
    },
    {
      id: 'ops',
      name: '运营维护',
      items: [
        {
          skill_id: 'task-ops-01',
          task_group: 'ops',
          skill_code: 'OPS-01',
          skill_name: '私域老客唤醒',
          description: '微信老客激活与回访',
          success_count: 61,
          total_executions: 76,
          fail_count: 15,
          total_credits: 960,
          runtime_h: 12.4,
          comments: 162,
          likes: 284,
          favorites: 66,
          dms: 92,
          reach: 8200,
        },
        {
          skill_id: 'task-ops-02',
          task_group: 'ops',
          skill_code: 'OPS-02',
          skill_name: '快手线索回访',
          description: '沉默线索二次跟进',
          success_count: 43,
          total_executions: 54,
          fail_count: 11,
          total_credits: 820,
          runtime_h: 9.8,
          comments: 118,
          likes: 204,
          favorites: 48,
          dms: 35,
          reach: 6200,
        },
      ],
    },
  ]
}

function getMockDevices() {
  return [
    {
      id: 'dev-ios-01',
      label: 'iPhone 15 Pro Max',
      operator: '陈果',
      total_credits: 2860,
      success_count: 128,
      runtime_h: 28.6,
      comments: 384,
      likes: 1135,
      saves: 236,
      dms: 61,
      reach: 18200,
      status: 'online',
    },
    {
      id: 'dev-android-02',
      label: 'Xiaomi 14 Ultra',
      operator: '林澈',
      total_credits: 2140,
      success_count: 97,
      runtime_h: 21.4,
      comments: 256,
      likes: 892,
      saves: 162,
      dms: 28,
      reach: 15400,
      status: 'online',
    },
    {
      id: 'dev-ios-03',
      label: 'iPhone 14',
      operator: '徐舟',
      total_credits: 1680,
      success_count: 76,
      runtime_h: 18.9,
      comments: 148,
      likes: 402,
      saves: 84,
      dms: 52,
      reach: 10800,
      status: 'warning',
    },
  ]
}

function getMockDeviceHeat() {
  return [
    {
      id: 'dev-ios-01',
      label: 'iPhone 15 Pro Max',
      cells: {
        '小红书': { exec: 72, fail: 4 },
        '微信': { exec: 18, fail: 1 },
      },
    },
    {
      id: 'dev-android-02',
      label: 'Xiaomi 14 Ultra',
      cells: {
        '抖音': { exec: 64, fail: 3 },
        '快手': { exec: 16, fail: 2 },
      },
    },
    {
      id: 'dev-ios-03',
      label: 'iPhone 14',
      cells: {
        '微信': { exec: 48, fail: 6 },
        '小红书': { exec: 12, fail: 2 },
      },
    },
  ]
}

function getMockWallet() {
  var totalBalance = sum(mockMembers.map(function(member) { return member.balance }))
  var totalRecharged = 30000
  return {
    total_balance: totalBalance,
    total_recharged: totalRecharged,
    total_consumed: totalRecharged - totalBalance,
    member_count: mockMembers.length,
  }
}

function buildAccountsAggs() {
  var totals = mockAccounts.reduce(function(acc, account) {
    acc.success_count += account.success_count
    acc.total_credits += account.total_credits
    acc.runtime_h += account.runtime_h
    acc.reach += account.reach
    return acc
  }, {
    success_count: 0,
    total_credits: 0,
    runtime_h: 0,
    reach: 0,
  })

  return {
    accounts: mockAccounts.map(function(account) {
      return {
        id: account.id,
        name: account.name,
        role: account.role,
        device_id: account.device_id,
        device_label: account.device_label,
        total_credits: account.total_credits,
        success_count: account.success_count,
        runtime_h: Number(account.runtime_h.toFixed(1)),
        comments: account.comments,
        likes: account.likes,
        favorites: account.favorites,
        dms: account.dms,
        reach: account.reach,
      }
    }),
    account_totals: {
      success_count: totals.success_count,
      total_credits: totals.total_credits,
      runtime_h: Number(totals.runtime_h.toFixed(1)),
      reach: totals.reach,
    },
  }
}

function buildSkillsAggs() {
  var skillGroups = getMockSkillGroups()
  var skillTotals = skillGroups.reduce(function(acc, group) {
    var items = Array.isArray(group.items) ? group.items : []
    items.forEach(function(item) {
      acc.success_count += Number(item.success_count || 0)
      acc.total_credits += Number(item.total_credits || 0)
    })
    return acc
  }, {
    success_count: 0,
    total_credits: 0,
  })
  return {
    skill_groups: skillGroups,
    skill_totals: skillTotals,
  }
}

function buildTransactionsPayload(searchParams: URLSearchParams) {
  var page = Math.max(1, Number(searchParams.get('page') || 1))
  var pageSize = Math.max(1, Math.min(100, Number(searchParams.get('page_size') || 20)))
  var filtered = mockTransactions.slice()
  var memberId = searchParams.get('member_id')
  var txType = String(searchParams.get('tx_type') || '').toUpperCase()
  var startDate = searchParams.get('start_date')
  var endDate = searchParams.get('end_date')

  if (memberId) {
    filtered = filtered.filter(function(item) {
      return String(item.user_id || '') === String(memberId)
    })
  }
  if (txType) {
    filtered = filtered.filter(function(item) {
      return String(item.change_type || '').toUpperCase() === txType
    })
  }
  if (startDate) {
    filtered = filtered.filter(function(item) {
      return String(item.ended_at || item.started_at || '').slice(0, 10) >= startDate
    })
  }
  if (endDate) {
    filtered = filtered.filter(function(item) {
      return String(item.ended_at || item.started_at || '').slice(0, 10) <= endDate
    })
  }

  var startIndex = (page - 1) * pageSize
  return {
    items: clone(filtered.slice(startIndex, startIndex + pageSize)),
    total: filtered.length,
  }
}

function buildAuditPayload(searchParams: URLSearchParams) {
  var page = Math.max(1, Number(searchParams.get('page') || 1))
  var pageSize = Math.max(1, Math.min(100, Number(searchParams.get('page_size') || 20)))
  var filtered = mockAuditLog.slice()
  var action = String(searchParams.get('action') || '').toUpperCase()
  var startDate = searchParams.get('start_date')
  var endDate = searchParams.get('end_date')

  if (action) {
    filtered = filtered.filter(function(item) {
      return String(item.action || '').toUpperCase() === action
    })
  }
  if (startDate) {
    filtered = filtered.filter(function(item) {
      return String(item.created_at || '').slice(0, 10) >= startDate
    })
  }
  if (endDate) {
    filtered = filtered.filter(function(item) {
      return String(item.created_at || '').slice(0, 10) <= endDate
    })
  }

  var startIndex = (page - 1) * pageSize
  return {
    items: clone(filtered.slice(startIndex, startIndex + pageSize)),
    total: filtered.length,
  }
}

function buildStatsOverview(days: number) {
  var range = pickRangeKeyFromDays(days)
  var fixture = RANGE_FIXTURES[range]
  return {
    total_executions: sum(fixture.ops_trend.success) + sum(fixture.ops_trend.failed),
    success_count: sum(fixture.ops_trend.success),
    fail_count: sum(fixture.ops_trend.failed),
    total_credits: sum(fixture.ops_trend.credits),
    runtime_h: Number(sum(fixture.ops_trend.runtime_h).toFixed(1)),
    active_users: mockMembers.length,
  }
}

function buildStatsTrend(days: number) {
  var range = pickRangeKeyFromDays(days)
  var trend = RANGE_FIXTURES[range].ops_trend
  return {
    dates: trend.dates.slice(),
    success: trend.success.slice(),
    failed: trend.failed.slice(),
    total: trend.success.map(function(value, index) {
      return value + Number(trend.failed[index] || 0)
    }),
    comments: trend.comments.slice(),
    likes: trend.likes.slice(),
    saves: trend.saves.slice(),
    dms: trend.dms.slice(),
    reach: trend.reach.slice(),
    runtime_h: trend.runtime_h.slice(),
    credits: trend.credits.slice(),
  }
}

function buildCreditsTrend(days: number) {
  var range = pickRangeKeyFromDays(days)
  var trend = RANGE_FIXTURES[range].ops_trend
  return {
    dates: trend.dates.slice(),
    consumed: trend.credits.slice(),
    recharged: trend.credits.map(function(_, index) {
      if (range === 'today' || range === 'yesterday') return index === 8 ? 240 : 0
      if (range === '30d') return index === 12 ? 30000 : 0
      return index === 3 ? 3000 : 0
    }),
  }
}

function pickRangeKey(range: string | null | undefined): MockRangeKey {
  if (range === 'today' || range === 'yesterday' || range === '7d' || range === '30d' || range === 'custom') {
    return range
  }
  return '7d'
}

function pickRangeKeyFromDays(days: number): MockRangeKey {
  if (days <= 1) return 'today'
  if (days >= 30) return '30d'
  return '7d'
}

function buildSnapshot(range: MockRangeKey) {
  var fixture = RANGE_FIXTURES[range]
  var accountsAggs = buildAccountsAggs()
  var skillsAggs = buildSkillsAggs()
  var devices = getMockDevices()
  var deviceHeat = getMockDeviceHeat()
  var transactions = buildTransactionsPayload(new URLSearchParams('page=1&page_size=20'))
  var auditLog = buildAuditPayload(new URLSearchParams('page=1&page_size=20'))

  return {
    range: range,
    highlights: {
      range: range,
      compare_label: range === 'today' ? '较昨日' : (range === '30d' ? '较上月' : '较上期'),
      cards: clone(fixture.highlights),
    },
    achievements: {
      range: range,
      compare_label: range === 'today' ? '较昨日' : (range === '30d' ? '较上月' : '较上期'),
      achievements: clone(fixture.achievements),
    },
    aggs: {
      accounts: clone(accountsAggs.accounts),
      account_totals: clone(accountsAggs.account_totals),
      skill_totals: clone(skillsAggs.skill_totals),
      skill_groups: clone(skillsAggs.skill_groups),
      devices: clone(devices),
      device_heat: clone(deviceHeat),
      device_alert_count: 1,
      totals: {},
    },
    aggregations: {
      accounts: clone(accountsAggs.accounts),
      skill_groups: clone(skillsAggs.skill_groups),
      devices: clone(devices),
      totals: {},
    },
    charts: {
      platform_breakdown: clone(fixture.platform_breakdown),
      interaction_breakdown: clone(fixture.interaction_breakdown),
      mini_stats: clone(fixture.mini_stats),
      roi: { value: 0, cost: 0, roi: 0, saved: 0, saved_pct: 0, breakdown: [] },
    },
    ops_trend: Object.assign({
      exec: fixture.ops_trend.success.slice(),
      total: fixture.ops_trend.success.map(function(value, index) {
        return value + Number(fixture.ops_trend.failed[index] || 0)
      }),
    }, clone(fixture.ops_trend)),
    members: clone(mockMembers),
    wallet: clone(getMockWallet()),
    transactions: clone(transactions),
    stats_tasks: clone(mockTasks.map(function(task) {
      return {
        id: task.id,
        task_id: task.id,
        task_name: task.task_name,
        task_detail_name: task.task_detail_name,
        related_platforms: task.related_platforms,
        total_executions: task.total_executions,
        success_count: task.success_count,
        fail_count: task.fail_count,
        category: task.category,
      }
    })),
    audit_log: clone(auditLog),
  }
}

function buildAccountWeekSummary(accountId: string) {
  var account = mockAccounts.find(function(item) {
    return String(item.id) === String(accountId)
  })
  if (!account) return null
  return {
    account: {
      id: account.id,
      name: account.name,
      role: account.role,
      platforms: account.platforms.slice(),
    },
    summary: {
      success_count: account.success_count,
      total_credits: account.total_credits,
      runtime_h: Number(account.runtime_h.toFixed(1)),
      reach: account.reach,
      comments: account.comments,
      likes: account.likes,
      saves: account.favorites,
      dms: account.dms,
    },
    success: account.success.slice(),
  }
}

function buildTaskWeekSummary(taskId: string) {
  var task = mockTasks.find(function(item) {
    return String(item.id) === String(taskId)
  })
  if (!task) return null
  var numericId = parseInt(String(task.id).replace(/[^\d]/g, ''), 10)
  return {
    task_info: {
      id: isNaN(numericId) ? 0 : numericId,
      name: task.task_name,
      category: task.category,
      created_at: task.created_at,
      platforms: task.platforms.slice(),
    },
    summary: {
      success_count: task.success_count,
      total_credits: task.total_credits,
      runtime_h: Number(task.runtime_h.toFixed(1)),
      reach: task.reach,
    },
    success: task.success.slice(),
  }
}

function normalizeMockPath(path: string) {
  if (!path) return '/api/dashboard/snapshot?range=7d'
  if (/^https?:\/\//i.test(path)) return path
  if (path.charAt(0) === '/') return path
  return '/' + path
}

function logLocalMockOnce() {
  if (hasLoggedLocalMock) return
  hasLoggedLocalMock = true
  console.info('[dashboard] backend is unavailable, using local mock data in dev mode')
}

async function detectApiMode(): Promise<ApiMode> {
  if (!import.meta.env.DEV) return 'live'
  if (DEV_FORCE_LOCAL_MOCK === '1' || DEV_FORCE_LOCAL_MOCK === 'true') {
    logLocalMockOnce()
    return 'mock'
  }
  if (DEV_FORCE_LOCAL_MOCK === '0' || DEV_FORCE_LOCAL_MOCK === 'false') return 'live'

  var timeout = withTimeout(DEV_DETECT_TIMEOUT_MS)
  try {
    var response = await fetch(DEV_PROXY_HEALTH_PATH, {
      method: 'GET',
      cache: 'no-store',
      signal: timeout.signal,
    })
    if (response.ok) return 'live'
  } catch {}
  finally {
    timeout.clear()
  }

  timeout = withTimeout(DEV_DETECT_TIMEOUT_MS)
  try {
    var directResponse = await fetch(DEV_DIRECT_API_ORIGIN.replace(/\/$/, '') + '/api/health', {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: timeout.signal,
    })
    if (directResponse.ok) return 'live'
  } catch {}
  finally {
    timeout.clear()
  }

  logLocalMockOnce()
  return 'mock'
}

export async function shouldUseLocalMockApi(): Promise<boolean> {
  if (!apiModePromise) {
    apiModePromise = detectApiMode()
  }
  return (await apiModePromise) === 'mock'
}

export function resetLocalMockApiCache() {
  apiModePromise = null
}

export async function readLocalMockJson(path: string): Promise<any | null> {
  var resolved = normalizeMockPath(path)
  var url = new URL(resolved, 'http://local.mock')
  var pathname = url.pathname
  var searchParams = url.searchParams

  if (pathname === '/api/dashboard/snapshot' || pathname === '/api/dashboard') {
    return buildSnapshot(pickRangeKey(searchParams.get('range')))
  }
  if (pathname === '/api/audit-log') {
    return buildAuditPayload(searchParams)
  }
  if (pathname === '/api/transactions') {
    return buildTransactionsPayload(searchParams)
  }
  if (pathname === '/api/members') {
    var page = Math.max(1, Number(searchParams.get('page') || 1))
    var pageSize = Math.max(1, Math.min(100, Number(searchParams.get('pageSize') || 20)))
    var startIndex = (page - 1) * pageSize
    var rows = mockMembers.slice(startIndex, startIndex + pageSize).map(function(member) {
      return {
        id: member.id,
        name: member.username,
        email: String(member.phone).replace(/\*/g, '0') + '@mock.local',
        phoneNumber: member.phone,
        role: member.role === 'admin' ? 'admin' : 'user',
        isActive: true,
        banned: false,
        remaining: member.balance,
        createdAt: member.join_date + 'T00:00:00.000Z',
      }
    })
    return {
      members: clone(rows),
      page: page,
      pageSize: pageSize,
      total: mockMembers.length,
      totalPages: Math.max(1, Math.ceil(mockMembers.length / pageSize)),
      memberLimit: 100,
      currentCount: mockMembers.length,
    }
  }
  if (pathname === '/api/wallet') {
    var wallet = getMockWallet()
    return {
      userId: mockMembers[0] ? mockMembers[0].id : 0,
      remaining: mockMembers[0] ? mockMembers[0].balance : 0,
      totalPurchased: wallet.total_recharged,
      totalUsed: wallet.total_consumed,
      freeCredits: wallet.total_balance,
      updatedAt: new Date().toISOString(),
      enterpriseRemaining: wallet.total_balance,
      enterpriseTotalPurchased: wallet.total_recharged,
      enterpriseTotalUsed: wallet.total_consumed,
      enterpriseFreeCredits: wallet.total_balance,
      enterpriseMemberCount: mockMembers.filter(function(member) {
        return member.role !== 'admin'
      }).length,
      enterpriseAdminCount: mockMembers.filter(function(member) {
        return member.role === 'admin'
      }).length,
    }
  }
  if (pathname === '/api/stats/tasks') {
    return clone(mockTasks.map(function(task) {
      return {
        id: task.id,
        task_id: task.id,
        task_name: task.task_name,
        task_detail_name: task.task_detail_name,
        related_platforms: task.related_platforms,
        total_executions: task.total_executions,
        success_count: task.success_count,
        fail_count: task.fail_count,
        category: task.category,
      }
    }))
  }
  if (pathname === '/api/stats/overview') {
    return buildStatsOverview(Number(searchParams.get('days') || 7))
  }
  if (pathname === '/api/stats/trend') {
    return buildStatsTrend(Number(searchParams.get('days') || 7))
  }
  if (pathname === '/api/stats/credits') {
    return buildCreditsTrend(Number(searchParams.get('days') || 30))
  }
  if (pathname === '/api/skills') {
    return clone(getMockSkillGroups().flatMap(function(group) { return group.items }))
  }
  if (pathname === '/api/accounts') {
    return clone(mockAccounts.map(function(account, index) {
      return {
        id: index + 1,
        account_id: account.id,
        username: account.name,
        success_count: account.success_count,
        runtime_h: Number(account.runtime_h.toFixed(1)),
        total_credits: account.total_credits,
      }
    }))
  }

  return null
}

export async function readLocalMockAccountWeekSummary(accountId: string) {
  return buildAccountWeekSummary(accountId)
}

export async function readLocalMockTaskWeekSummary(taskId: string) {
  return buildTaskWeekSummary(taskId)
}

export async function mockMutationUnavailableResponse<T>() {
  return {
    ok: false,
    status: 503,
    data: null as T | null,
    error: '当前为本地演示模式，写操作需要先连接真实后端',
  }
}

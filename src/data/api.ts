import { getAuthHeaders, getCurrentUser } from '../modules/auth'

var API_BASE = ((import.meta as any).env && (import.meta as any).env.VITE_API_BASE) || '/api';
var API_REQUEST_TIMEOUT_MS = 8000;
var API_PROBE_TIMEOUT_MS = 3000;

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  } | string;
  message?: string;
  detail?: string | unknown;
}

function buildApiHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  var headers: Record<string, string> = Object.assign(
    { 'Content-Type': 'application/json' },
    getAuthHeaders(),
  );
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }
  return headers;
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

async function parseJSONResponse<T>(res: Response): Promise<T | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T> | T | null): T | null {
  if (!payload) return null
  if (typeof payload === 'object' && 'data' in (payload as ApiEnvelope<T>)) {
    var envelope = payload as ApiEnvelope<T>
    if (envelope.success === false) return null
    if (envelope.data !== undefined) return envelope.data as T
  }
  return payload as T
}

function readEnvelopeError<T>(payload: ApiEnvelope<T> | T | null, fallback: string): string {
  if (!payload) return fallback
  if (typeof payload === 'object' && 'error' in (payload as ApiEnvelope<T>)) {
    var envelope = payload as ApiEnvelope<T>
    if (typeof envelope.error === 'string' && envelope.error) return envelope.error
    if (envelope.error && typeof envelope.error === 'object' && typeof envelope.error.message === 'string') {
      return envelope.error.message
    }
    if (typeof envelope.message === 'string' && envelope.message) return envelope.message
    if (typeof envelope.detail === 'string' && envelope.detail) return envelope.detail
  }
  return fallback
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0
    var v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

export async function fetchJSON<T>(path: string): Promise<T | null> {
  var timeout = withRequestTimeout(API_REQUEST_TIMEOUT_MS)
  try {
    var res = await fetch(API_BASE + path, {
      headers: buildApiHeaders(),
      signal: timeout.signal,
      credentials: 'include',
    });
    if (!res.ok) return null;
    return unwrapEnvelope<T>(await parseJSONResponse<ApiEnvelope<T> | T>(res));
  } catch {
    return null;
  } finally {
    timeout.clear()
  }
}

export interface OverviewData {
  total_executions: number;
  success_count: number;
  fail_count: number;
  total_credits: number;
  runtime_h: number;
  active_users: number;
}

export interface TrendData {
  dates: string[];
  success: number[];
  failed: number[];
  total: number[];
  comments: number[];
  likes: number[];
  saves: number[];
  dms: number[];
  reach: number[];
  runtime_h: number[];
  credits: number[];
}

export interface CreditsData {
  dates: string[];
  consumed: number[];
  recharged: number[];
}

export async function fetchOverview(days: number = 7) {
  return fetchJSON<OverviewData>(`/stats/overview?days=${days}`);
}

export async function fetchTrend(days: number = 7) {
  return fetchJSON<TrendData>(`/stats/trend?days=${days}`);
}

export async function fetchCredits(days: number = 30) {
  return fetchJSON<CreditsData>(`/stats/credits?days=${days}`);
}

var _apiPromise: Promise<boolean> | null = null;

export function isApiAvailable(): Promise<boolean> {
  if (_apiPromise) return _apiPromise;
  _apiPromise = (async function() {
    var timeout = withRequestTimeout(API_PROBE_TIMEOUT_MS)
    try {
      var res = await fetch(API_BASE + '/health', {
        headers: buildApiHeaders(),
        signal: timeout.signal,
        credentials: 'include',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      timeout.clear()
    }
  })();
  return _apiPromise;
}

export function resetApiCache() {
  _apiPromise = null;
}

export interface MemberData {
  id: number;
  username: string;
  phone: string;
  role: string;
  balance: number;
  join_date: string;
  exec_count: number;
  total_tokens: number;
}

export interface WalletData {
  total_balance: number;
  total_recharged: number;
  total_consumed: number;
  member_count: number;
}

export interface TransactionItem {
  change_type: string;
  task_exec_id: string | null;
  task_name: string | null;
  username: string;
  call_count: number;
  total_change: number;
  balance_after: number;
  started_at: string;
  ended_at: string;
}

export interface TransactionsData {
  items: TransactionItem[];
  total: number;
}

export interface SkillData {
  id: number;
  skill_name: string;
  description: string;
  related_platforms: string;
  total_executions: number;
  success_count: number;
  total_duration_sec: number;
  total_credits: number;
}

export interface AccountData {
  id: number;
  username: string;
  exec_count: number;
  success_count?: number;
  runtime_h: number;
  total_credits: number;
}

export async function fetchMembers() {
  var data = await fetchJSON<{
    members: Array<{
      id: number;
      name: string;
      phoneNumber: string | null;
      role: string;
      remaining: number;
      createdAt: string;
    }>;
  }>('/members');
  if (!data || !Array.isArray(data.members)) return null
  return data.members.map(function(member) {
    return {
      id: member.id,
      username: member.name,
      phone: member.phoneNumber || '',
      role: member.role,
      balance: Number(member.remaining) || 0,
      join_date: member.createdAt,
      exec_count: 0,
      total_tokens: 0,
    }
  })
}

export async function fetchWallet() {
  var data = await fetchJSON<{
    remaining: number;
    totalPurchased: number;
    totalUsed: number;
    enterpriseRemaining?: number;
    enterpriseTotalPurchased?: number;
    enterpriseTotalUsed?: number;
  }>('/wallet');
  if (!data) return null
  return {
    total_balance: Number(data.enterpriseRemaining != null ? data.enterpriseRemaining : data.remaining) || 0,
    total_recharged: Number(data.enterpriseTotalPurchased != null ? data.enterpriseTotalPurchased : data.totalPurchased) || 0,
    total_consumed: Number(data.enterpriseTotalUsed != null ? data.enterpriseTotalUsed : data.totalUsed) || 0,
    admin_remaining: Number(data.remaining) || 0,
    member_count: 0,
  }
}

export async function fetchTransactions(page: number = 1, pageSize: number = 20) {
  var data = await fetchJSON<{
    items: Array<{
      changeType: string;
      userName: string;
      changeAmount: number;
      balanceAfter: number;
      createdAt: string;
      remark?: string | null;
    }>;
    total: number;
  }>(`/transactions?page=${page}&pageSize=${pageSize}`);
  if (!data) return null
  return {
    items: (data.items || []).map(function(item) {
      return {
        change_type: item.changeType,
        task_exec_id: null,
        task_name: item.remark || null,
        username: item.userName,
        call_count: 0,
        total_change: item.changeAmount,
        balance_after: item.balanceAfter,
        started_at: item.createdAt,
        ended_at: item.createdAt,
      }
    }),
    total: Number(data.total) || 0,
  }
}

export async function fetchSkills() {
  return fetchJSON<SkillData[]>('/skills');
}

export async function fetchAccounts() {
  var data = await fetchJSON<{
    accountSummaries: Array<{
      userId: number;
      userName: string;
      totalCount: number;
      successCount: number;
      runtimeHours: number;
      credits: number;
    }>;
  }>('/dashboard?range=7d');
  if (!data || !Array.isArray(data.accountSummaries)) return null
  return data.accountSummaries.map(function(account) {
    return {
      id: account.userId,
      username: account.userName,
      exec_count: Number(account.totalCount) || 0,
      success_count: Number(account.successCount) || 0,
      runtime_h: Number(account.runtimeHours) || 0,
      total_credits: Number(account.credits) || 0,
    }
  })
}

export async function mutateJSON<T>(method: string, path: string, body?: any): Promise<{ok: boolean; status: number; data: T | null; error?: string}> {
  var timeout = withRequestTimeout(API_REQUEST_TIMEOUT_MS)
  try {
    var opts: RequestInit = {
      method: method,
      headers: buildApiHeaders({ 'Idempotency-Key': newIdempotencyKey() }),
      signal: timeout.signal,
      credentials: 'include',
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(API_BASE + path, opts);
    var data = await parseJSONResponse<ApiEnvelope<T> | T>(res);
    if (!res.ok) {
      var errMsg = readEnvelopeError(data, '操作失败');
      return { ok: false, status: res.status, data: null, error: errMsg };
    }
    return { ok: true, status: res.status, data: unwrapEnvelope<T>(data) };
  } catch {
    return { ok: false, status: 0, data: null, error: timeout.didTimeout() ? '请求超时' : '网络错误' };
  } finally {
    timeout.clear()
  }
}

export async function apiAddMember(name: string, phone_number: string, initial_balance: number) {
  var created = await mutateJSON<{
    id: number;
    name: string;
    phoneNumber: string | null;
  }>('POST', '/members', { name: name, phoneNumber: phone_number });
  if (!created.ok || !created.data) return created
  if (initial_balance > 0) {
    var distribute = await apiDistributeCredits(0, created.data.id, initial_balance, '新增成员初始积分')
    if (!distribute.ok) return { ok: false, status: distribute.status, data: null, error: distribute.error || '初始积分发放失败' }
  }
  return created
}

export async function apiUpdateMember(user_id: number, updates: {name?: string; phone_number?: string; role?: string}) {
  return mutateJSON<{
    id: number;
    name: string;
    phoneNumber: string | null;
    role: string;
    remaining: number;
  }>('PATCH', '/members/' + user_id, {
    name: String(updates.name || '').trim(),
    phoneNumber: String(updates.phone_number || '').trim(),
  })
}

export function apiDeleteMember(user_id: number) {
  return mutateJSON<{success: boolean}>('DELETE', '/members/' + user_id);
}

export async function apiDistributeCredits(operator_id: number, target_user_id: number, amount: number, remark: string) {
  var currentUser = getCurrentUser()
  if (!currentUser || currentUser.id <= 0) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: '登录状态已失效，请重新登录',
    }
  }
  if (operator_id && operator_id !== currentUser.id) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'coremate 当前仅支持管理员向成员分发积分，不支持在此页面扣减成员余额',
    }
  }
  if (target_user_id === currentUser.id) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'coremate 当前仅支持管理员向成员分发积分，不支持向管理员账户回退积分',
    }
  }
  return mutateJSON<{success: boolean}>('POST', '/wallet/distribute', {
    targetUserId: target_user_id,
    credits: amount,
    remark: remark,
  });
}

export async function apiAdjustMemberCredits(target_user_id: number, delta: number, remark: string) {
  var currentUser = getCurrentUser()
  if (!currentUser || currentUser.id <= 0) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: '登录状态已失效，请重新登录',
    }
  }
  if (!Number.isInteger(delta) || delta === 0) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: '调整数量必须为非 0 整数',
    }
  }
  if (target_user_id === currentUser.id) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: '不能直接调整管理员自身余额',
    }
  }
  return mutateJSON<{
    adminRemainingAfter: number;
    memberRemainingAfter: number;
    delta: number;
  }>('POST', '/wallet/adjust', {
    targetUserId: target_user_id,
    delta: delta,
    remark: remark,
  })
}

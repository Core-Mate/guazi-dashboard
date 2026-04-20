import { getAuthHeaders } from '../modules/auth'

var API_BASE = ((import.meta as any).env && (import.meta as any).env.VITE_API_BASE) || '/api';
var API_REQUEST_TIMEOUT_MS = 8000;
var API_PROBE_TIMEOUT_MS = 3000;

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
    });
    if (!res.ok) return null;
    return await parseJSONResponse<T>(res);
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
      var res = await fetch(API_BASE + '/stats/overview?days=1', {
        headers: buildApiHeaders(),
        signal: timeout.signal,
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
  return fetchJSON<MemberData[]>('/members');
}

export async function fetchWallet() {
  return fetchJSON<WalletData>('/wallet');
}

export async function fetchTransactions(page: number = 1, pageSize: number = 20) {
  return fetchJSON<TransactionsData>(`/transactions?page=${page}&page_size=${pageSize}`);
}

export async function fetchSkills() {
  return fetchJSON<SkillData[]>('/skills');
}

export async function fetchAccounts() {
  return fetchJSON<AccountData[]>('/accounts');
}

export async function mutateJSON<T>(method: string, path: string, body?: any): Promise<{ok: boolean; status: number; data: T | null; error?: string}> {
  var timeout = withRequestTimeout(API_REQUEST_TIMEOUT_MS)
  try {
    var opts: RequestInit = {
      method: method,
      headers: buildApiHeaders({ 'Idempotency-Key': newIdempotencyKey() }),
      signal: timeout.signal,
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(API_BASE + path, opts);
    var data = await parseJSONResponse<T & { error?: string; detail?: string | unknown }>(res);
    if (!res.ok) {
      var errMsg = (data && data.error)
        || (data && data.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : '操作失败');
      return { ok: false, status: res.status, data: null, error: errMsg };
    }
    return { ok: true, status: res.status, data: data as T | null };
  } catch {
    return { ok: false, status: 0, data: null, error: timeout.didTimeout() ? '请求超时' : '网络错误' };
  } finally {
    timeout.clear()
  }
}

export function apiAddMember(name: string, phone_number: string, initial_balance: number) {
  return mutateJSON<{id: number; success: boolean}>('POST', '/members', { name, phone_number, initial_balance });
}

export function apiUpdateMember(user_id: number, updates: {name?: string; phone_number?: string; role?: string}) {
  return mutateJSON<{success: boolean}>('PUT', '/members/' + user_id, updates);
}

export function apiDeleteMember(user_id: number) {
  return mutateJSON<{success: boolean}>('DELETE', '/members/' + user_id);
}

export function apiDistributeCredits(operator_id: number, target_user_id: number, amount: number, remark: string) {
  return mutateJSON<{success: boolean}>('POST', '/credits/distribute', { operator_id, target_user_id, amount, remark });
}

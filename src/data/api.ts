var API_BASE = ((import.meta as any).env && (import.meta as any).env.VITE_API_BASE) || '/api';
var API_KEY = ((import.meta as any).env && (import.meta as any).env.VITE_API_KEY) || 'dev-key-guazi-2026';

export async function fetchJSON<T>(path: string): Promise<T | null> {
  try {
    var res = await fetch(API_BASE + path, {
      headers: { 'X-API-Key': API_KEY },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface OverviewData {
  total_executions: number;
  success_count: number;
  fail_count: number;
  total_credits_consumed: number;
  total_duration_hours: number;
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
  runtime: number[];
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
    try {
      var res = await fetch(API_BASE + '/stats/overview?days=1', {
        headers: { 'X-API-Key': API_KEY },
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
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
  duration_hours: number;
  duration: string;
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
  try {
    var opts: RequestInit = {
      method: method,
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(API_BASE + path, opts);
    var data = await res.json();
    if (!res.ok) {
      var errMsg = data.error || (data.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : '操作失败');
      return { ok: false, status: res.status, data: null, error: errMsg };
    }
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null, error: '网络错误' };
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

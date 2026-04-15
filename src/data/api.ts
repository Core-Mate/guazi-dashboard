var API_BASE = '/api';

export async function fetchJSON<T>(path: string): Promise<T | null> {
  try {
    var res = await fetch(API_BASE + path);
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
  active_users: number;
}

export interface TrendData {
  dates: string[];
  success: number[];
  failed: number[];
  total: number[];
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

var _apiAvailable: boolean | null = null;

export async function isApiAvailable(): Promise<boolean> {
  if (_apiAvailable !== null) return _apiAvailable;
  try {
    var res = await fetch(API_BASE + '/stats/overview?days=1', { signal: AbortSignal.timeout(5000) });
    _apiAvailable = res.ok;
  } catch {
    _apiAvailable = false;
  }
  return _apiAvailable;
}

export function resetApiCache() {
  _apiAvailable = null;
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
}

export interface AccountData {
  id: number;
  username: string;
  exec_count: number;
  duration_hours: number;
  duration: string;
  total_tokens: number;
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

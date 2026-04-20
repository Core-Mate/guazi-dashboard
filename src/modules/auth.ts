var API_BASE = ((import.meta as any).env && (import.meta as any).env.VITE_API_BASE) || '/api'
var AUTH_REQUEST_TIMEOUT_MS = 8000
var AUTH_TOKEN_KEY = 'authToken'
var CURRENT_USER_KEY = 'currentUser'
var AUTH_STORAGE_KEYS = [
  AUTH_TOKEN_KEY,
  CURRENT_USER_KEY,
]

export interface AuthUser {
  id: number;
  name: string;
  phoneNumber: string;
  role: string;
  tenant_id: number;
  tenant_name: string;
}

interface AuthEnvelope {
  token?: string;
  user?: AuthUser;
  devCode?: string;
  error?: string;
  detail?: string;
  message?: string;
  success?: boolean;
  data?: any;
}

function withRequestTimeout(timeoutMs: number) {
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

function clearStoredAuthState() {
  var storages = [localStorage, sessionStorage]
  for (var i = 0; i < storages.length; i++) {
    var storage = storages[i]
    for (var j = 0; j < AUTH_STORAGE_KEYS.length; j++) {
      try {
        storage.removeItem(AUTH_STORAGE_KEYS[j])
      } catch {}
    }
  }
}

function persistAuthSession(user: AuthUser) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, 'cookie-session')
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user))
  } catch {}
}

async function parseResponseEnvelope(res: Response): Promise<AuthEnvelope> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function normalizeErrorMessage(payload: AuthEnvelope, fallback: string) {
  if (payload.error) return payload.error
  if (payload.message) return payload.message
  if (typeof payload.detail === 'string' && payload.detail) return payload.detail
  if (payload.data && typeof payload.data.message === 'string' && payload.data.message) return payload.data.message
  return fallback
}

async function postAuth<T extends AuthEnvelope>(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  var timeout = withRequestTimeout(AUTH_REQUEST_TIMEOUT_MS)
  try {
    var response = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: timeout.signal,
      credentials: 'include',
    })
    var payload = await parseResponseEnvelope(response) as T
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: normalizeErrorMessage(payload, '请求失败'),
      }
    }
    return { ok: true, status: response.status, data: payload }
  } catch {
    return { ok: false, status: 0, error: '网络错误' }
  } finally {
    timeout.clear()
  }
}

export function getAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function getCurrentUser(): AuthUser | null {
  try {
    var raw = localStorage.getItem(CURRENT_USER_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function getAuthHeaders(): Record<string, string> {
  return {}
}

async function fetchTenantName(): Promise<string> {
  var timeout = withRequestTimeout(AUTH_REQUEST_TIMEOUT_MS)
  try {
    var response = await fetch(API_BASE + '/tenant', {
      signal: timeout.signal,
      credentials: 'include',
    })
    var payload = await parseResponseEnvelope(response)
    if (!response.ok) return ''
    var data = payload && payload.data ? payload.data : payload
    if (data && typeof data.tenantName === 'string') return data.tenantName
    return ''
  } catch {
    return ''
  } finally {
    timeout.clear()
  }
}

async function refreshCurrentUser(): Promise<AuthUser | null> {
  var timeout = withRequestTimeout(AUTH_REQUEST_TIMEOUT_MS)
  try {
    var response = await fetch(API_BASE + '/auth/get-session', {
      signal: timeout.signal,
      credentials: 'include',
    })
    var payload = await parseResponseEnvelope(response)
    if (!response.ok) {
      clearStoredAuthState()
      return null
    }

    var data = payload && payload.data ? payload.data : payload
    var session = data && data.session ? data.session : data
    var rawUser = session && session.user ? session.user : (data && data.user ? data.user : null)
    if (!rawUser) {
      clearStoredAuthState()
      return null
    }

    var tenantName = await fetchTenantName()
    var user: AuthUser = {
      id: Number(rawUser.id) || 0,
      name: String(rawUser.name || ''),
      phoneNumber: String(rawUser.phoneNumber || ''),
      role: String(rawUser.role || ''),
      tenant_id: Number(rawUser.tenant_id || 0),
      tenant_name: tenantName || String(rawUser.tenant_name || ''),
    }
    if (!user.id || !user.role) {
      clearStoredAuthState()
      return null
    }
    persistAuthSession(user)
    return user
  } catch {
    clearStoredAuthState()
    return null
  } finally {
    timeout.clear()
  }
}

export async function sendOtp(phone: string): Promise<{ ok: boolean; devCode?: string; error?: string }> {
  var result = await postAuth<AuthEnvelope>('/auth/phone-number/send-otp', { phoneNumber: phone })
  if (!result.ok) return { ok: false, error: result.error || '验证码发送失败' }
  return {
    ok: true,
    devCode: result.data && result.data.devCode ? result.data.devCode : '',
  }
}

export async function login(phone: string, code: string): Promise<{ ok: boolean; token?: string; user?: AuthUser; error?: string }> {
  var result = await postAuth<AuthEnvelope>('/auth/phone-number/verify', {
    phoneNumber: phone,
    code: code,
    disableSession: false,
  })
  if (!result.ok) {
    return { ok: false, error: result.error || '登录失败' }
  }
  var user = await refreshCurrentUser()
  if (!user) {
    return { ok: false, error: '登录成功，但无法读取会话信息' }
  }
  return {
    ok: true,
    token: getAuthToken(),
    user: user,
  }
}

export async function logout() {
  try {
    await postAuth<AuthEnvelope>('/auth/sign-out')
  } finally {
    clearStoredAuthState()
    window.location.reload()
  }
}

export async function verifyToken(): Promise<boolean> {
  return !!(await refreshCurrentUser())
}

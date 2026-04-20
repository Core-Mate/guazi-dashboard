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

function persistAuthSession(token: string, user: AuthUser) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
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
  if (typeof payload.detail === 'string' && payload.detail) return payload.detail
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
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: body ? JSON.stringify(body) : undefined,
      signal: timeout.signal,
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
  var headers: Record<string, string> = {}
  var token = getAuthToken()
  if (token) headers.Authorization = 'Bearer ' + token
  return headers
}

export async function sendOtp(phone: string): Promise<{ ok: boolean; devCode?: string; error?: string }> {
  var result = await postAuth<AuthEnvelope>('/auth/send-otp', { phone: phone })
  if (!result.ok) return { ok: false, error: result.error || '验证码发送失败' }
  return {
    ok: true,
    devCode: result.data && result.data.devCode ? result.data.devCode : '',
  }
}

export async function login(phone: string, code: string): Promise<{ ok: boolean; token?: string; user?: AuthUser; error?: string }> {
  var result = await postAuth<AuthEnvelope>('/auth/login', { phone: phone, code: code })
  if (!result.ok || !result.data || !result.data.token || !result.data.user) {
    return { ok: false, error: result.error || '登录失败' }
  }
  persistAuthSession(result.data.token, result.data.user)
  return {
    ok: true,
    token: result.data.token,
    user: result.data.user,
  }
}

export async function logout() {
  try {
    await postAuth<AuthEnvelope>('/auth/logout')
  } finally {
    clearStoredAuthState()
    window.location.reload()
  }
}

export async function verifyToken(): Promise<boolean> {
  var token = getAuthToken()
  if (!token) {
    clearStoredAuthState()
    return false
  }

  var timeout = withRequestTimeout(AUTH_REQUEST_TIMEOUT_MS)
  try {
    var response = await fetch(API_BASE + '/auth/me', {
      headers: getAuthHeaders(),
      signal: timeout.signal,
    })
    if (!response.ok) {
      clearStoredAuthState()
      return false
    }
    var payload = await parseResponseEnvelope(response)
    if (!payload.user) {
      clearStoredAuthState()
      return false
    }
    persistAuthSession(token, payload.user)
    return true
  } catch {
    clearStoredAuthState()
    return false
  } finally {
    timeout.clear()
  }
}

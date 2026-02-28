import axios from 'axios'
import { useAuthStore } from '../store/auth'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const api = axios.create({ baseURL: BASE_URL })

// Attach token on every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Single in-flight refresh promise so concurrent 401s share one refresh call
// instead of each independently racing to refresh (which can cause some to see
// a null refreshToken and trigger logout mid-race).
let refreshingPromise: Promise<void> | null = null

// Auto-refresh on 401
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        if (!refreshingPromise) {
          refreshingPromise = useAuthStore.getState().refresh().finally(() => {
            refreshingPromise = null
          })
        }
        await refreshingPromise
        const token = useAuthStore.getState().accessToken
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      } catch {
        useAuthStore.getState().logout()
      }
    }
    return Promise.reject(error)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (username: string, password: string, totp_code?: string) =>
    api.post('/auth/login', { username, password, totp_code }).then((r) => r.data),
  refresh: (refresh_token: string) =>
    api.post('/auth/refresh', { refresh_token }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  updateMe: (data: { current_password: string; new_password?: string; new_username?: string }) =>
    api.patch('/auth/me', data).then((r) => r.data),
  setupTotp: () => api.post('/auth/totp/setup').then((r) => r.data),
  enableTotp: (code: string) => api.post('/auth/totp/enable', { code }).then((r) => r.data),
  disableTotp: (password: string) => api.post('/auth/totp/disable', { password }).then((r) => r.data),
}

// ── Users ─────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => api.get('/users').then((r) => r.data),
  get: (username: string) => api.get(`/users/${username}`).then((r) => r.data),
  create: (data: unknown) => api.post('/users', data).then((r) => r.data),
  update: (username: string, data: unknown) =>
    api.patch(`/users/${username}`, data).then((r) => r.data),
  delete: (username: string) => api.delete(`/users/${username}`),
  disconnect: (username: string) => api.post(`/users/${username}/disconnect`),
  otpQr: (username: string) => api.get(`/users/${username}/otp-qr`).then((r) => r.data),
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const routesApi = {
  list: (username: string) => api.get(`/users/${username}/routes`).then((r) => r.data),
  set: (username: string, routes: unknown[]) =>
    api.put(`/users/${username}/routes`, { routes }).then((r) => r.data),
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export const sessionsApi = {
  active: () => api.get('/sessions/active').then((r) => r.data),
  history: (username: string, limit = 50) =>
    api.get(`/users/${username}/sessions?limit=${limit}`).then((r) => r.data),
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export const statsApi = {
  all: () => api.get('/stats/users').then((r) => r.data),
  user: (username: string) => api.get(`/stats/users/${username}`).then((r) => r.data),
}

// ── Groups ────────────────────────────────────────────────────────────────────

export const groupsApi = {
  list: () => api.get('/groups').then((r) => r.data),
  create: (data: unknown) => api.post('/groups', data).then((r) => r.data),
  update: (id: number, data: unknown) => api.patch(`/groups/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/groups/${id}`),
}

// ── Network ───────────────────────────────────────────────────────────────────

export const networkApi = {
  get: () => api.get('/network').then((r) => r.data),
  update: (data: unknown) => api.put('/network', data).then((r) => r.data),
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export const logsApi = {
  authLogs: (params?: Record<string, unknown>) =>
    api.get('/logs/auth', { params }).then((r) => r.data),
  exportAuthLogs: (format: 'csv' | 'json', params?: Record<string, unknown>) =>
    api.get('/logs/auth/export', { params: { ...params, format }, responseType: 'blob' }),
  sessionLogs: (params?: Record<string, unknown>) =>
    api.get('/logs/sessions', { params }).then((r) => r.data),
  exportSessionLogs: (format: 'csv' | 'json', params?: Record<string, unknown>) =>
    api.get('/logs/sessions/export', { params: { ...params, format }, responseType: 'blob' }),
  auditLogs: (params?: Record<string, unknown>) =>
    api.get('/logs/audit', { params }).then((r) => r.data),
  exportAuditLogs: (format: 'csv' | 'json', params?: Record<string, unknown>) =>
    api.get('/logs/audit/export', { params: { ...params, format }, responseType: 'blob' }),
}

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportsApi = {
  daily: (days = 30) =>
    api.get('/reports/daily', { params: { days } }).then((r) => r.data),
  monthly: (months = 12) =>
    api.get('/reports/monthly', { params: { months } }).then((r) => r.data),
  topUsers: (limit = 10, days = 30) =>
    api.get('/reports/top-users', { params: { limit, days } }).then((r) => r.data),
  loginFailures: (days = 30, limit = 10) =>
    api.get('/reports/login-failures', { params: { days, limit } }).then((r) => r.data),
  peakHours: (days = 30) =>
    api.get('/reports/peak-hours', { params: { days } }).then((r) => r.data),
  export: (report_type: string, format: 'csv' | 'json', params?: Record<string, unknown>) =>
    api.get('/reports/export', { params: { report_type, format, ...params }, responseType: 'blob' }),
}

// ── Service ───────────────────────────────────────────────────────────────────

export const serviceApi = {
  status: () => api.get('/service/status').then((r) => r.data),
  reload: () => api.post('/service/reload').then((r) => r.data),
  validate: () => api.get('/service/validate').then((r) => r.data),
  downloadConfig: () => api.get('/service/config/download', { responseType: 'blob' }),
  uploadConfig: (file: File, apply = false) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post(`/service/config/upload?apply=${apply}`, fd).then((r) => r.data)
  },
  backups: () => api.get('/service/config/backups').then((r) => r.data),
  createBackup: () => api.post('/service/config/backup').then((r) => r.data),
  restoreBackup: (filename: string) =>
    api.post(`/service/config/backups/${encodeURIComponent(filename)}/restore`).then((r) => r.data),
  getSyslog: () => api.get('/service/syslog').then((r) => r.data),
  putSyslog: (data: unknown) => api.put('/service/syslog', data).then((r) => r.data),
  getSiem: () => api.get('/service/siem').then((r) => r.data),
  putSiem: (data: unknown) => api.put('/service/siem', data).then((r) => r.data),
  testSiem: () => api.post('/service/siem/test').then((r) => r.data),
  getSmtp: () => api.get('/service/smtp').then((r) => r.data),
  putSmtp: (data: unknown) => api.put('/service/smtp', data).then((r) => r.data),
  testSmtp: (to: string) => api.post('/service/smtp/test', null, { params: { to } }).then((r) => r.data),
}

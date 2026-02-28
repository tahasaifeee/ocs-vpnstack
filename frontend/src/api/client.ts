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

// Auto-refresh on 401
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        await useAuthStore.getState().refresh()
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
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }).then((r) => r.data),
  refresh: (refresh_token: string) =>
    api.post('/auth/refresh', { refresh_token }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
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

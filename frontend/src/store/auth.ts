import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  adminUsername: string | null
  /** 'requires_totp' returned when credentials OK but 2FA code still needed */
  login: (username: string, password: string, totpCode?: string) => Promise<'ok' | 'requires_totp'>
  refresh: () => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      adminUsername: null,

      login: async (username, password, totpCode?) => {
        const { data } = await axios.post(`${BASE_URL}/auth/login`, {
          username,
          password,
          totp_code: totpCode ?? null,
        })
        if (data.requires_totp) return 'requires_totp'
        set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          adminUsername: username,
        })
        return 'ok'
      },

      refresh: async () => {
        const refreshToken = get().refreshToken
        if (!refreshToken) throw new Error('No refresh token')
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        })
        set({ accessToken: data.access_token, refreshToken: data.refresh_token })
      },

      logout: () => set({ accessToken: null, refreshToken: null, adminUsername: null }),
    }),
    { name: 'vpn-auth', partialize: (s) => ({ refreshToken: s.refreshToken, adminUsername: s.adminUsername }) }
  )
)

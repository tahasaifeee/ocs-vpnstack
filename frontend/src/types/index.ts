export interface VpnUser {
  id: number
  username: string
  email: string | null
  is_active: boolean
  otp_enabled: boolean
  quota_bytes: number | null
  notes: string | null
  created_at: string
}

export interface VpnUserWithOtp extends VpnUser {
  otp_secret?: string
  otp_uri?: string
}

export interface Route {
  id: number
  cidr: string
  is_excluded: boolean
}

export interface ActiveSession {
  username: string
  ip_real: string
  ip_local: string
  device: string
  connected_since: string
  rx_bytes: number
  tx_bytes: number
}

export interface SessionLog {
  id: number
  ip_real: string | null
  ip_local: string | null
  device: string | null
  connected_at: string
  disconnected_at: string | null
  bytes_in: number
  bytes_out: number
  duration_seconds: number
  disconnect_reason: string | null
}

export interface UserStats {
  username: string
  total_bytes_in: number
  total_bytes_out: number
  total_sessions: number
  last_seen: string | null
}

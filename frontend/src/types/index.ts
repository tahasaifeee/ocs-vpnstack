export interface Group {
  id: number
  name: string
  description: string | null
  max_sessions: number | null
  quota_bytes: number | null
  dns_servers: string | null
  split_tunnel: boolean
  session_timeout: number | null
  user_count: number
}

export interface VpnUser {
  id: number
  username: string
  email: string | null
  is_active: boolean
  otp_enabled: boolean
  quota_bytes: number | null
  notes: string | null
  created_at: string
  group_id: number | null
  static_ip: string | null
  max_sessions: number | null
  dns_servers: string | null
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
  geo_country: string | null
  geo_country_code: string | null
  geo_city: string | null
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

export interface NetworkConfig {
  ipv4_network: string
  ipv4_netmask: string
  dns_servers: string[]
  max_clients: number
  max_same_clients: number
  ipv6_network: string | null
  tunnel_all_dns: boolean
}

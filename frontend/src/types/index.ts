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

// ── Auth / Audit Logs ─────────────────────────────────────────────────────────

export interface AuthLog {
  id: number
  username: string
  ip_address: string | null
  success: boolean
  failure_reason: string | null
  created_at: string
}

export interface AuditLog {
  id: number
  admin_username: string
  action: string
  target: string | null
  detail: string | null
  created_at: string
}

export interface SessionLogWithUser extends SessionLog {
  username: string
}

// ── Reports ───────────────────────────────────────────────────────────────────

export interface DailyStat {
  date: string
  total_sessions: number
  total_bytes_in: number
  total_bytes_out: number
  unique_users: number
}

export interface MonthlyStat {
  month: string
  total_sessions: number
  total_bytes_in: number
  total_bytes_out: number
  unique_users: number
}

export interface TopUser {
  username: string
  total_bytes: number
  total_sessions: number
}

export interface LoginFailureStat {
  username: string
  failure_count: number
  last_attempt: string | null
}

export interface HourlyStat {
  hour: number
  session_count: number
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface ServiceStatus {
  ocserv_running: boolean
  active_connections: number
  version: string | null
  uptime: string | null
}

export interface ConfigValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface BackupInfo {
  filename: string
  size_bytes: number
  created_at: string
}

export interface SyslogConfig {
  enabled: boolean
  host: string
  port: number
  protocol: string
  facility: string
}

export interface SIEMConfig {
  enabled: boolean
  url: string
  format: string
  token: string
  verify_ssl: boolean
}

export interface SmtpConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
  from_email: string
  from_name: string
  use_tls: boolean
  use_ssl: boolean
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ShieldAlert, History, ClipboardList } from 'lucide-react'
import { logsApi } from '../api/client'
import type { AuthLog, AuditLog, SessionLogWithUser } from '../types'
import { formatDistanceToNow } from 'date-fns'

type Tab = 'auth' | 'sessions' | 'audit'

function formatBytes(b: number) {
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const inputCls =
  'bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-100'

// ── Auth Logs tab ─────────────────────────────────────────────────────────────

function AuthLogsTab() {
  const [username, setUsername] = useState('')
  const [successFilter, setSuccessFilter] = useState<'all' | 'true' | 'false'>('all')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  const params: Record<string, unknown> = { limit, offset }
  if (username) params.username = username
  if (successFilter !== 'all') params.success = successFilter === 'true'
  if (start) params.start = start
  if (end) params.end = end

  const { data: logs = [], isLoading } = useQuery<AuthLog[]>({
    queryKey: ['logs-auth', params],
    queryFn: () => logsApi.authLogs(params),
  })

  const handleExport = async (fmt: 'csv' | 'json') => {
    const r = await logsApi.exportAuthLogs(fmt, params)
    downloadBlob(r.data, `auth-logs.${fmt}`)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <p className="text-xs text-gray-400 mb-1">Username</p>
          <input
            className={inputCls}
            placeholder="filter by user"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setOffset(0) }}
          />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Result</p>
          <div className="flex gap-1">
            {(['all', 'true', 'false'] as const).map((v) => (
              <button
                key={v}
                onClick={() => { setSuccessFilter(v); setOffset(0) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  successFilter === v ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {v === 'all' ? 'All' : v === 'true' ? 'Success' : 'Failure'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">From</p>
          <input type="datetime-local" className={inputCls} value={start} onChange={(e) => { setStart(e.target.value); setOffset(0) }} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">To</p>
          <input type="datetime-local" className={inputCls} value={end} onChange={(e) => { setEnd(e.target.value); setOffset(0) }} />
        </div>
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => handleExport('csv')}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download size={13} /> CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download size={13} /> JSON
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-10 text-center text-gray-500 text-sm">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-gray-500 text-sm">No auth logs found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Username</th>
                <th className="text-left px-4 py-3">IP</th>
                <th className="text-left px-4 py-3">Result</th>
                <th className="text-left px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{l.username}</td>
                  <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{l.ip_address ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      l.success ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'
                    }`}>
                      {l.success ? 'Success' : 'Failure'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{l.failure_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex gap-2 justify-end">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
          className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg transition-colors"
        >
          Previous
        </button>
        <button
          disabled={logs.length < limit}
          onClick={() => setOffset(offset + limit)}
          className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  )
}

// ── Session Logs tab ──────────────────────────────────────────────────────────

function SessionLogsTab() {
  const [username, setUsername] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  const params: Record<string, unknown> = { limit, offset }
  if (username) params.username = username
  if (start) params.start = start
  if (end) params.end = end

  const { data: logs = [], isLoading } = useQuery<SessionLogWithUser[]>({
    queryKey: ['logs-sessions', params],
    queryFn: () => logsApi.sessionLogs(params),
  })

  const handleExport = async (fmt: 'csv' | 'json') => {
    const r = await logsApi.exportSessionLogs(fmt, params)
    downloadBlob(r.data, `session-logs.${fmt}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <p className="text-xs text-gray-400 mb-1">Username</p>
          <input
            className={inputCls}
            placeholder="filter by user"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setOffset(0) }}
          />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">From</p>
          <input type="datetime-local" className={inputCls} value={start} onChange={(e) => { setStart(e.target.value); setOffset(0) }} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">To</p>
          <input type="datetime-local" className={inputCls} value={end} onChange={(e) => { setEnd(e.target.value); setOffset(0) }} />
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => handleExport('csv')} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
            <Download size={13} /> CSV
          </button>
          <button onClick={() => handleExport('json')} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
            <Download size={13} /> JSON
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-10 text-center text-gray-500 text-sm">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-gray-500 text-sm">No session logs found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">IP (real)</th>
                <th className="text-left px-4 py-3">IP (vpn)</th>
                <th className="text-left px-4 py-3">Device</th>
                <th className="text-left px-4 py-3">Connected</th>
                <th className="text-right px-4 py-3">RX / TX</th>
                <th className="text-right px-4 py-3">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-2.5 font-medium">{l.username}</td>
                  <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{l.ip_real ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{l.ip_local ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{l.device ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(l.connected_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    <span className="text-blue-400">{formatBytes(l.bytes_in)}</span>
                    {' / '}
                    <span className="text-orange-400">{formatBytes(l.bytes_out)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-400 text-xs">
                    {l.duration_seconds > 0 ? `${Math.round(l.duration_seconds / 60)}m` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg transition-colors">Previous</button>
        <button disabled={logs.length < limit} onClick={() => setOffset(offset + limit)} className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg transition-colors">Next</button>
      </div>
    </div>
  )
}

// ── Audit Log tab ─────────────────────────────────────────────────────────────

function AuditLogTab() {
  const [adminUser, setAdminUser] = useState('')
  const [action, setAction] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  const params: Record<string, unknown> = { limit, offset }
  if (adminUser) params.admin_username = adminUser
  if (action) params.action = action

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ['logs-audit', params],
    queryFn: () => logsApi.auditLogs(params),
  })

  const handleExport = async (fmt: 'csv' | 'json') => {
    const r = await logsApi.exportAuditLogs(fmt, params)
    downloadBlob(r.data, `audit-logs.${fmt}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <p className="text-xs text-gray-400 mb-1">Admin</p>
          <input className={inputCls} placeholder="filter by admin" value={adminUser} onChange={(e) => { setAdminUser(e.target.value); setOffset(0) }} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Action</p>
          <input className={inputCls} placeholder="filter by action" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0) }} />
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => handleExport('csv')} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"><Download size={13} /> CSV</button>
          <button onClick={() => handleExport('json')} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"><Download size={13} /> JSON</button>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-10 text-center text-gray-500 text-sm">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-gray-500 text-sm">No audit logs found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Admin</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3">Target</th>
                <th className="text-left px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{l.admin_username}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded text-xs font-mono bg-gray-800 text-blue-300">{l.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{l.target ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs max-w-xs truncate">{l.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg transition-colors">Previous</button>
        <button disabled={logs.length < limit} onClick={() => setOffset(offset + limit)} className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg transition-colors">Next</button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'auth',     label: 'Auth Logs',     icon: ShieldAlert },
  { id: 'sessions', label: 'Session Logs',  icon: History },
  { id: 'audit',    label: 'Audit Trail',   icon: ClipboardList },
]

export default function Logs() {
  const [tab, setTab] = useState<Tab>('auth')

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Logs</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'auth'     && <AuthLogsTab />}
      {tab === 'sessions' && <SessionLogsTab />}
      {tab === 'audit'    && <AuditLogTab />}
    </div>
  )
}

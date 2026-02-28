import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { WifiOff, RefreshCw } from 'lucide-react'
import { sessionsApi, usersApi } from '../api/client'
import type { ActiveSession } from '../types'

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

export default function Sessions() {
  const qc = useQueryClient()
  const { data: sessions = [], isLoading, dataUpdatedAt } = useQuery<ActiveSession[]>({
    queryKey: ['sessions-active'],
    queryFn: sessionsApi.active,
    refetchInterval: 30_000,
  })

  const kickMut = useMutation({
    mutationFn: usersApi.disconnect,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions-active'] }),
  })

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Active Sessions</h1>
          <p className="text-xs text-gray-500 mt-0.5">Auto-refreshes every 30 s · last update {lastUpdated}</p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['sessions-active'] })}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-sm"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-500">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-16 text-gray-500">No active sessions</div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Public IP</th>
                <th className="text-left px-4 py-3">VPN IP</th>
                <th className="text-left px-4 py-3">Device</th>
                <th className="text-left px-4 py-3">Connected</th>
                <th className="text-left px-4 py-3">RX / TX</th>
                <th className="text-right px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {sessions.map((s, i) => (
                <tr key={i} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-green-400">{s.username}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs">{s.ip_real}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs">{s.ip_local}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{s.device}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{s.connected_since}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    <span className="text-blue-400">{formatBytes(s.rx_bytes)}</span>
                    {' / '}
                    <span className="text-orange-400">{formatBytes(s.tx_bytes)}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { if (confirm(`Disconnect ${s.username}?`)) kickMut.mutate(s.username) }}
                      className="flex items-center gap-1 ml-auto text-red-500 hover:text-red-400 text-xs"
                    >
                      <WifiOff size={12} /> Kick
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

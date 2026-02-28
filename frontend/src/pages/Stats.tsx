import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { statsApi } from '../api/client'
import type { UserStats } from '../types'
import { formatDistanceToNow } from 'date-fns'

function formatBytes(b: number) {
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}

export default function Stats() {
  const { data: stats = [], isLoading } = useQuery<UserStats[]>({
    queryKey: ['stats'],
    queryFn: statsApi.all,
    refetchInterval: 60_000,
  })

  const totalRx = stats.reduce((s, u) => s + u.total_bytes_in, 0)
  const totalTx = stats.reduce((s, u) => s + u.total_bytes_out, 0)
  const totalSessions = stats.reduce((s, u) => s + u.total_sessions, 0)

  const chartData = [...stats]
    .sort((a, b) => b.total_bytes_in + b.total_bytes_out - (a.total_bytes_in + a.total_bytes_out))
    .slice(0, 10)
    .map((u) => ({
      name: u.username,
      RX: +(u.total_bytes_in / 1024 ** 3).toFixed(2),
      TX: +(u.total_bytes_out / 1024 ** 3).toFixed(2),
    }))

  if (isLoading) return <div className="text-center py-16 text-gray-500">Loading…</div>

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Traffic Statistics</h1>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total RX" value={formatBytes(totalRx)} />
        <StatCard label="Total TX" value={formatBytes(totalTx)} />
        <StatCard label="Total Sessions" value={totalSessions} />
      </div>

      {chartData.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold mb-4 text-gray-300">Top 10 Users by Traffic (GB)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} unit=" GB" />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#f3f4f6' }}
              />
              <Legend />
              <Bar dataKey="RX" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="TX" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3">User</th>
              <th className="text-right px-4 py-3">RX</th>
              <th className="text-right px-4 py-3">TX</th>
              <th className="text-right px-4 py-3">Sessions</th>
              <th className="text-right px-4 py-3">Last Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {stats.map((u) => (
              <tr key={u.username} className="hover:bg-gray-800/50 transition-colors">
                <td className="px-4 py-3 font-medium">{u.username}</td>
                <td className="px-4 py-3 text-right text-blue-400">{formatBytes(u.total_bytes_in)}</td>
                <td className="px-4 py-3 text-right text-orange-400">{formatBytes(u.total_bytes_out)}</td>
                <td className="px-4 py-3 text-right text-gray-400">{u.total_sessions}</td>
                <td className="px-4 py-3 text-right text-gray-500 text-xs">
                  {u.last_seen ? formatDistanceToNow(new Date(u.last_seen), { addSuffix: true }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

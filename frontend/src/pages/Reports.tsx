import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Download } from 'lucide-react'
import { reportsApi } from '../api/client'
import type { DailyStat, HourlyStat, LoginFailureStat, MonthlyStat, TopUser } from '../types'

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

const tooltipStyle = {
  contentStyle: { background: '#111827', border: '1px solid #374151', borderRadius: 8 },
  labelStyle: { color: '#f3f4f6' },
}

const PERIOD_OPTIONS = [
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '180d', value: 180 },
  { label: '365d', value: 365 },
]

// ── Bandwidth section ─────────────────────────────────────────────────────────

function BandwidthSection({ days }: { days: number }) {
  const [mode, setMode] = useState<'daily' | 'monthly'>('daily')

  const { data: daily = [], isLoading: dailyLoading } = useQuery<DailyStat[]>({
    queryKey: ['reports-daily', days],
    queryFn: () => reportsApi.daily(days),
    enabled: mode === 'daily',
  })

  const { data: monthly = [], isLoading: monthlyLoading } = useQuery<MonthlyStat[]>({
    queryKey: ['reports-monthly', Math.ceil(days / 30)],
    queryFn: () => reportsApi.monthly(Math.ceil(days / 30)),
    enabled: mode === 'monthly',
  })

  const chartData = mode === 'daily'
    ? daily.map((d) => ({
        label: d.date,
        RX: +(d.total_bytes_in / 1024 ** 3).toFixed(3),
        TX: +(d.total_bytes_out / 1024 ** 3).toFixed(3),
        sessions: d.total_sessions,
      }))
    : monthly.map((d) => ({
        label: d.month,
        RX: +(d.total_bytes_in / 1024 ** 3).toFixed(3),
        TX: +(d.total_bytes_out / 1024 ** 3).toFixed(3),
        sessions: d.total_sessions,
      }))

  const loading = mode === 'daily' ? dailyLoading : monthlyLoading

  const handleExport = async (fmt: 'csv' | 'json') => {
    const type = mode === 'daily' ? 'daily' : 'monthly'
    const r = await reportsApi.export(type, fmt, { days })
    downloadBlob(r.data, `${type}-bandwidth.${fmt}`)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Bandwidth Usage (GB)</h2>
        <div className="flex gap-2 items-center">
          <div className="flex gap-1">
            {(['daily', 'monthly'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  mode === m ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <button onClick={() => handleExport('csv')} className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs px-2 py-1 rounded-lg transition-colors">
            <Download size={12} /> CSV
          </button>
        </div>
      </div>
      {loading ? (
        <div className="h-52 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
      ) : chartData.length === 0 ? (
        <div className="h-52 flex items-center justify-center text-gray-500 text-sm">No data for this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} unit=" GB" />
            <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} GB`]} />
            <Legend />
            <Bar dataKey="RX" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="TX" fill="#f97316" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Top users section ─────────────────────────────────────────────────────────

function TopUsersSection({ days }: { days: number }) {
  const { data: users = [], isLoading } = useQuery<TopUser[]>({
    queryKey: ['reports-top-users', days],
    queryFn: () => reportsApi.topUsers(10, days),
  })

  const handleExport = async (fmt: 'csv' | 'json') => {
    const r = await reportsApi.export('top-users', fmt, { days })
    downloadBlob(r.data, `top-users.${fmt}`)
  }

  const chartData = users.map((u) => ({
    name: u.username,
    GB: +(u.total_bytes / 1024 ** 3).toFixed(2),
  }))

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Top 10 Users by Traffic</h2>
        <button onClick={() => handleExport('csv')} className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs px-2 py-1 rounded-lg transition-colors">
          <Download size={12} /> CSV
        </button>
      </div>
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
      ) : chartData.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-500 text-sm">No data for this period</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} unit=" GB" />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} GB`]} />
              <Bar dataKey="GB" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-3 py-2">User</th>
                <th className="text-right px-3 py-2">Total Traffic</th>
                <th className="text-right px-3 py-2">Sessions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map((u) => (
                <tr key={u.username} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-3 py-2 font-medium">{u.username}</td>
                  <td className="px-3 py-2 text-right text-blue-400">{formatBytes(u.total_bytes)}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{u.total_sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

// ── Login failures section ────────────────────────────────────────────────────

function LoginFailuresSection({ days }: { days: number }) {
  const { data: failures = [], isLoading } = useQuery<LoginFailureStat[]>({
    queryKey: ['reports-login-failures', days],
    queryFn: () => reportsApi.loginFailures(days, 10),
  })

  const handleExport = async (fmt: 'csv' | 'json') => {
    const r = await reportsApi.export('login-failures', fmt, { days })
    downloadBlob(r.data, `login-failures.${fmt}`)
  }

  const chartData = failures.map((f) => ({
    name: f.username,
    Failures: f.failure_count,
  }))

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Top Login Failures</h2>
        <button onClick={() => handleExport('csv')} className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs px-2 py-1 rounded-lg transition-colors">
          <Download size={12} /> CSV
        </button>
      </div>
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
      ) : chartData.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-500 text-sm">No failures in this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="Failures" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Peak hours section ────────────────────────────────────────────────────────

function PeakHoursSection({ days }: { days: number }) {
  const { data: hours = [], isLoading } = useQuery<HourlyStat[]>({
    queryKey: ['reports-peak-hours', days],
    queryFn: () => reportsApi.peakHours(days),
  })

  // Zero-fill all 24 hours
  const chartData = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}:00`,
    Sessions: hours.find((d) => d.hour === h)?.session_count ?? 0,
  }))

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300">Peak Usage Hours (UTC)</h2>
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="hour" tick={{ fill: '#9ca3af', fontSize: 9 }} interval={1} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Line type="monotone" dataKey="Sessions" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Reports() {
  const [days, setDays] = useState(30)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Reports</h1>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
                days === value ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="xl:col-span-2">
          <BandwidthSection days={days} />
        </div>
        <TopUsersSection days={days} />
        <LoginFailuresSection days={days} />
        <div className="xl:col-span-2">
          <PeakHoursSection days={days} />
        </div>
      </div>
    </div>
  )
}

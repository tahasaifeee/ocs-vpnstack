import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { RefreshCw, Wifi, WifiOff, ArrowDown, ArrowUp, AlertCircle, Server } from 'lucide-react'
import { nodeApi } from '../api/client'
import type { IfaceInfo, TrafficRates } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(2)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

function fmtBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`
  return `${bps.toFixed(0)} bps`
}

const CHART_HISTORY = 60  // data points (~3 min at 3 s interval)

// ── Interface Card ────────────────────────────────────────────────────────────

function IfaceCard({ iface, selected, onSelect }: {
  iface: IfaceInfo
  selected: boolean
  onSelect: () => void
}) {
  const ipv4 = iface.addresses.filter((a) => a.family === 'IPv4')
  const ipv6 = iface.addresses.filter((a) => a.family === 'IPv6')
  const mac  = iface.addresses.find((a) => a.family === 'MAC')

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl border p-4 transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-900/20'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {iface.is_up
            ? <Wifi size={16} className="text-green-400" />
            : <WifiOff size={16} className="text-gray-600" />}
          <span className="font-mono font-semibold text-sm">{iface.name}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          iface.is_up ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
        }`}>
          {iface.is_up ? 'UP' : 'DOWN'}
        </span>
      </div>

      {/* Addresses */}
      <div className="space-y-1 mb-3">
        {ipv4.map((a, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span className="text-xs text-blue-400 w-10 flex-shrink-0">IPv4</span>
            <span className="font-mono text-xs text-gray-200">{a.address}</span>
            {a.netmask && <span className="text-xs text-gray-600">{a.netmask}</span>}
          </div>
        ))}
        {ipv6.map((a, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span className="text-xs text-purple-400 w-10 flex-shrink-0">IPv6</span>
            <span className="font-mono text-xs text-gray-400 truncate">{a.address}</span>
          </div>
        ))}
        {mac && (
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-gray-500 w-10 flex-shrink-0">MAC</span>
            <span className="font-mono text-xs text-gray-500">{mac.address}</span>
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex gap-3 text-xs text-gray-600 mb-3">
        {iface.speed_mbps > 0 && <span>{iface.speed_mbps} Mbps</span>}
        {iface.mtu > 0 && <span>MTU {iface.mtu}</span>}
        {iface.duplex && iface.duplex !== 'NIC_DUPLEX_UNKNOWN' && (
          <span>{iface.duplex.replace('NIC_DUPLEX_', '').toLowerCase()}</span>
        )}
      </div>

      {/* RX / TX totals */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-800/60 rounded-lg px-3 py-2">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
            <ArrowDown size={11} className="text-green-400" /> RX
          </div>
          <div className="font-mono text-xs text-gray-200">{fmtBytes(iface.rx_bytes)}</div>
          {(iface.rx_errors + iface.rx_drops) > 0 && (
            <div className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
              <AlertCircle size={10} /> {iface.rx_errors} err · {iface.rx_drops} drop
            </div>
          )}
        </div>
        <div className="bg-gray-800/60 rounded-lg px-3 py-2">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
            <ArrowUp size={11} className="text-blue-400" /> TX
          </div>
          <div className="font-mono text-xs text-gray-200">{fmtBytes(iface.tx_bytes)}</div>
          {(iface.tx_errors + iface.tx_drops) > 0 && (
            <div className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
              <AlertCircle size={10} /> {iface.tx_errors} err · {iface.tx_drops} drop
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

// ── Routes Table ─────────────────────────────────────────────────────────────

function RoutesTable({ ifaces }: { ifaces: IfaceInfo[] }) {
  const routes = ifaces.flatMap((i) => i.routes)
  if (routes.length === 0) {
    return <p className="text-gray-600 text-sm py-6 text-center">No routes found</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-2">Interface</th>
            <th className="text-left px-4 py-2">Destination</th>
            <th className="text-left px-4 py-2">Gateway</th>
            <th className="text-left px-4 py-2">Family</th>
            <th className="text-left px-4 py-2">Metric</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/60">
          {routes.map((r, i) => (
            <tr key={i} className={`hover:bg-gray-800/30 transition-colors ${r.is_default ? 'bg-blue-950/20' : ''}`}>
              <td className="px-4 py-2 font-mono text-xs text-gray-300">{r.interface}</td>
              <td className="px-4 py-2 font-mono text-xs">
                {r.is_default
                  ? <span className="text-yellow-400 font-semibold">default ({r.destination})</span>
                  : <span className="text-gray-200">{r.destination}</span>}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-gray-400">{r.gateway ?? '—'}</td>
              <td className="px-4 py-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  r.family === 'IPv4' ? 'bg-blue-900/40 text-blue-400' : 'bg-purple-900/40 text-purple-400'
                }`}>
                  {r.family}
                </span>
              </td>
              <td className="px-4 py-2 text-xs text-gray-500">{r.metric}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Live Traffic Chart ────────────────────────────────────────────────────────

type ChartPoint = { t: string; rx: number; tx: number }

function TrafficChart({ selectedIface }: { selectedIface: string }) {
  const [history, setHistory] = useState<ChartPoint[]>([])

  const tick = useCallback(() => {
    nodeApi.traffic().then((rates: TrafficRates) => {
      const r = rates[selectedIface]
      if (!r) return
      const now = new Date()
      const label = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
      setHistory((prev) => {
        const next = [...prev, { t: label, rx: r.rx_bps, tx: r.tx_bps }]
        return next.length > CHART_HISTORY ? next.slice(-CHART_HISTORY) : next
      })
    }).catch(() => {})
  }, [selectedIface])

  // Reset history when interface changes
  useEffect(() => { setHistory([]) }, [selectedIface])

  // Poll every 3 s
  useEffect(() => {
    tick() // immediate first sample
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [tick])

  if (history.length < 2) {
    return (
      <div className="h-52 flex items-center justify-center text-gray-600 text-sm">
        Collecting data…
      </div>
    )
  }

  const latest = history[history.length - 1]

  return (
    <div>
      {/* Live stats pills */}
      <div className="flex gap-4 mb-4">
        <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
          <ArrowDown size={13} className="text-green-400" />
          <span className="text-xs text-gray-400">RX</span>
          <span className="font-mono text-sm text-green-400">{fmtBps(latest.rx)}</span>
        </div>
        <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
          <ArrowUp size={13} className="text-blue-400" />
          <span className="text-xs text-gray-400">TX</span>
          <span className="font-mono text-sm text-blue-400">{fmtBps(latest.tx)}</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v) => fmtBps(v)}
            tick={{ fontSize: 10, fill: '#6b7280' }}
            width={72}
          />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#9ca3af', fontSize: 11 }}
            formatter={(val: number, name: string) => [fmtBps(val), name === 'rx' ? 'RX' : 'TX']}
          />
          <Legend
            formatter={(value) => value === 'rx' ? 'Receive' : 'Transmit'}
            wrapperStyle={{ fontSize: 12 }}
          />
          <Line type="monotone" dataKey="rx" stroke="#34d399" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="tx" stroke="#60a5fa" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Node() {
  const { data: ifaces = [], isLoading, refetch, isFetching } = useQuery<IfaceInfo[]>({
    queryKey: ['node-interfaces'],
    queryFn: nodeApi.interfaces,
    refetchInterval: 30_000,
  })

  // Default to first non-loopback UP interface
  const defaultIface = ifaces.find((i) => i.is_up && i.name !== 'lo')?.name
    ?? ifaces.find((i) => i.name !== 'lo')?.name
    ?? ifaces[0]?.name
    ?? ''

  const [selectedIface, setSelectedIface] = useState('')

  // Set default once data loads
  useEffect(() => {
    if (!selectedIface && defaultIface) setSelectedIface(defaultIface)
  }, [defaultIface]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Server size={22} className="text-blue-400" />
          <h1 className="text-xl font-bold">Node</h1>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-500">Loading…</div>
      ) : (
        <>
          {/* ── Network Interfaces ── */}
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Network Interfaces
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {ifaces.map((iface) => (
              <IfaceCard
                key={iface.name}
                iface={iface}
                selected={selectedIface === iface.name}
                onSelect={() => setSelectedIface(iface.name)}
              />
            ))}
          </div>

          {/* ── Live Traffic ── */}
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Live Traffic
          </h2>
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-8">
            {/* Interface selector */}
            <div className="flex items-center gap-3 mb-4">
              <label className="text-xs text-gray-500">Interface</label>
              <select
                value={selectedIface}
                onChange={(e) => setSelectedIface(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ifaces.map((i) => (
                  <option key={i.name} value={i.name}>
                    {i.name} {i.is_up ? '●' : '○'}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-600">polling every 3 s</span>
            </div>
            {selectedIface
              ? <TrafficChart key={selectedIface} selectedIface={selectedIface} />
              : <p className="text-gray-600 text-sm py-8 text-center">Select an interface above</p>
            }
          </div>

          {/* ── Routing Table ── */}
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Routing Table
          </h2>
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <RoutesTable ifaces={ifaces} />
          </div>
        </>
      )}
    </div>
  )
}

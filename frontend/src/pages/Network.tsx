import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Network as NetIcon, Plus, Trash2, Save, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { networkApi } from '../api/client'
import type { NetworkConfig } from '../types'

const inp    = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500'
const btnPrimary = 'flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50'

interface CardProps { title: string; icon: React.ElementType; children: React.ReactNode }
function Card({ title, icon: Icon, children }: CardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-800">
        <Icon size={16} className="text-blue-400" />
        <h2 className="font-semibold text-sm">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export default function Network() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<NetworkConfig>({
    queryKey: ['network-config'],
    queryFn: networkApi.get,
  })

  const [form, setForm] = useState<NetworkConfig>({
    ipv4_network: '172.16.0.0/16',
    ipv4_netmask: '255.255.0.0',
    dns_servers:  ['8.8.8.8', '1.1.1.1'],
    max_clients: 128,
    max_same_clients: 2,
    ipv6_network: null,
    tunnel_all_dns: true,
  })
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [newDns, setNewDns] = useState('')

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const saveMut = useMutation({
    mutationFn: () => networkApi.update(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-config'] })
      setFeedback({ ok: true, msg: 'Network settings saved and ocserv reloaded.' })
      setTimeout(() => setFeedback(null), 4000)
    },
    onError: () => setFeedback({ ok: false, msg: 'Failed to save settings.' }),
  })

  const addDns = () => {
    const ip = newDns.trim()
    if (!ip) return
    setForm(f => ({ ...f, dns_servers: [...f.dns_servers, ip] }))
    setNewDns('')
  }

  const removeDns = (i: number) =>
    setForm(f => ({ ...f, dns_servers: f.dns_servers.filter((_, j) => j !== i) }))

  if (isLoading) return (
    <div className="text-center py-16 text-gray-500 flex items-center justify-center gap-2">
      <Loader2 className="animate-spin" size={18} /> Loading network settings…
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Network Settings</h1>
          <p className="text-xs text-gray-500 mt-0.5">Global VPN pool and routing configuration</p>
        </div>
        <button className={btnPrimary} onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save & reload
        </button>
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 text-sm mb-5 p-3 rounded-lg border ${
          feedback.ok ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {feedback.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {feedback.msg}
        </div>
      )}

      {/* IP Pool */}
      <Card title="VPN IP Pool" icon={NetIcon}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Network (CIDR)</label>
            <input
              className={inp}
              value={form.ipv4_network}
              onChange={e => setForm(f => ({ ...f, ipv4_network: e.target.value }))}
              placeholder="172.16.0.0/16"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Netmask</label>
            <input
              className={inp}
              value={form.ipv4_netmask}
              onChange={e => setForm(f => ({ ...f, ipv4_netmask: e.target.value }))}
              placeholder="255.255.0.0"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Max total clients</label>
            <input
              className={inp}
              type="number"
              min="1"
              value={form.max_clients}
              onChange={e => setForm(f => ({ ...f, max_clients: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Max sessions per user</label>
            <input
              className={inp}
              type="number"
              min="1"
              value={form.max_same_clients}
              onChange={e => setForm(f => ({ ...f, max_same_clients: Number(e.target.value) }))}
            />
          </div>
        </div>
      </Card>

      {/* DNS */}
      <Card title="DNS Servers" icon={NetIcon}>
        <p className="text-xs text-gray-500 mb-3">Pushed to all connected VPN clients. Per-user and per-group overrides take precedence.</p>
        <div className="space-y-2 mb-3">
          {form.dns_servers.map((dns, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm font-mono text-gray-300">
                {dns}
              </span>
              <button
                onClick={() => removeDns(i)}
                className="p-1.5 rounded hover:bg-red-900/40 text-gray-500 hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className={`${inp} flex-1`}
            value={newDns}
            onChange={e => setNewDns(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDns()}
            placeholder="Add DNS server IP…"
          />
          <button
            onClick={addDns}
            className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm"
          >
            <Plus size={14} />
          </button>
        </div>
        <label className="flex items-center gap-3 mt-4 cursor-pointer select-none">
          <div
            onClick={() => setForm(f => ({ ...f, tunnel_all_dns: !f.tunnel_all_dns }))}
            className={`w-9 h-5 rounded-full transition-colors relative ${form.tunnel_all_dns ? 'bg-blue-600' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.tunnel_all_dns ? 'translate-x-4' : ''}`} />
          </div>
          <div>
            <p className="text-sm font-medium">Tunnel all DNS</p>
            <p className="text-xs text-gray-500">Force all DNS queries through the VPN</p>
          </div>
        </label>
      </Card>

      {/* IPv6 */}
      <Card title="IPv6" icon={NetIcon}>
        <label className="flex items-center gap-3 mb-4 cursor-pointer select-none">
          <div
            onClick={() => setForm(f => ({ ...f, ipv6_network: f.ipv6_network ? null : 'fd00::/48' }))}
            className={`w-9 h-5 rounded-full transition-colors relative ${form.ipv6_network ? 'bg-blue-600' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.ipv6_network ? 'translate-x-4' : ''}`} />
          </div>
          <div>
            <p className="text-sm font-medium">Enable IPv6</p>
            <p className="text-xs text-gray-500">Assign IPv6 addresses to VPN clients</p>
          </div>
        </label>
        {form.ipv6_network && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">IPv6 Network (CIDR)</label>
            <input
              className={inp}
              value={form.ipv6_network}
              onChange={e => setForm(f => ({ ...f, ipv6_network: e.target.value }))}
              placeholder="fd00::/48"
            />
          </div>
        )}
      </Card>
    </div>
  )
}

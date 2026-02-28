import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Pencil, Trash2, Shield, Loader2, X, ChevronDown } from 'lucide-react'
import { groupsApi } from '../api/client'
import type { Group } from '../types'

// ── styles ────────────────────────────────────────────────────────────────────
const inp = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500'
const btnPrimary = 'flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors'
const btnDanger  = 'flex items-center gap-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 px-4 py-2 rounded-lg text-sm font-medium transition-colors'
const btnGhost   = 'flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition-colors'

function formatBytes(b: number | null) {
  if (!b) return '∞'
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`
  if (b >= 1e9)  return `${(b / 1e9).toFixed(1)} GB`
  return `${(b / 1e6).toFixed(0)} MB`
}

// ── modal ─────────────────────────────────────────────────────────────────────
interface ModalProps {
  initial?: Group
  onClose: () => void
  onSave: (data: Record<string, unknown>) => void
  saving: boolean
}

function GroupModal({ initial, onClose, onSave, saving }: ModalProps) {
  const [name,    setName]    = useState(initial?.name ?? '')
  const [desc,    setDesc]    = useState(initial?.description ?? '')
  const [maxSess, setMaxSess] = useState(String(initial?.max_sessions ?? ''))
  const [quota,   setQuota]   = useState(initial?.quota_bytes ? String(initial.quota_bytes / 1e9) : '')
  const [dns,     setDns]     = useState(initial?.dns_servers ?? '')
  const [split,   setSplit]   = useState(initial?.split_tunnel ?? false)
  const [timeout, setTimeout2] = useState(String(initial?.session_timeout ?? ''))

  const submit = () => {
    const payload: Record<string, unknown> = { split_tunnel: split }
    if (!initial) payload.name = name
    if (desc)    payload.description    = desc    || null
    if (maxSess) payload.max_sessions   = Number(maxSess)  || null
    if (quota)   payload.quota_bytes    = Math.round(Number(quota) * 1e9) || null
    if (dns)     payload.dns_servers    = dns     || null
    if (timeout) payload.session_timeout = Number(timeout) || null
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold">{initial ? 'Edit Group' : 'Create Group'}</h2>
          <button onClick={onClose}><X size={18} className="text-gray-400 hover:text-white" /></button>
        </div>
        <div className="p-5 space-y-3">
          {!initial && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Group name *</label>
              <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. employees" />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <input className={inp} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max sessions / user</label>
              <input className={inp} type="number" min="1" value={maxSess} onChange={e => setMaxSess(e.target.value)} placeholder="e.g. 2" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Quota (GB)</label>
              <input className={inp} type="number" min="0" step="0.1" value={quota} onChange={e => setQuota(e.target.value)} placeholder="∞ = unlimited" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">DNS servers (comma-separated)</label>
            <input className={inp} value={dns} onChange={e => setDns(e.target.value)} placeholder="e.g. 8.8.8.8,1.1.1.1" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Session timeout (seconds)</label>
            <input className={inp} type="number" min="60" value={timeout} onChange={e => setTimeout2(e.target.value)} placeholder="e.g. 86400 (24 h)" />
          </div>
          <label className="flex items-center gap-3 cursor-pointer select-none pt-1">
            <div
              onClick={() => setSplit(!split)}
              className={`w-9 h-5 rounded-full transition-colors relative ${split ? 'bg-blue-600' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${split ? 'translate-x-4' : ''}`} />
            </div>
            <div>
              <p className="text-sm font-medium">Split tunnel</p>
              <p className="text-xs text-gray-500">Push only specific routes (not full tunnel)</p>
            </div>
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={saving || (!initial && !name)}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {initial ? 'Save changes' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function Groups() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editing,    setEditing]    = useState<Group | null>(null)
  const [deleting,   setDeleting]   = useState<Group | null>(null)

  const { data: groups = [], isLoading } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  })

  const createMut = useMutation({
    mutationFn: groupsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['groups'] }); setShowCreate(false) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) => groupsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['groups'] }); setEditing(null) },
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => groupsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['groups'] }); setDeleting(null) },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Groups</h1>
          <p className="text-xs text-gray-500 mt-0.5">Shared policy sets applied to VPN users</p>
        </div>
        <button className={btnPrimary} onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New group
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-500">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <Shield size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No groups yet. Create one to set shared policies for users.</p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Members</th>
                <th className="text-left px-4 py-3">Max sessions</th>
                <th className="text-left px-4 py-3">Quota</th>
                <th className="text-left px-4 py-3">DNS</th>
                <th className="text-left px-4 py-3">Tunnel</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {groups.map(g => (
                <tr key={g.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{g.name}</p>
                    {g.description && <p className="text-xs text-gray-500 mt-0.5">{g.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 text-gray-300">
                      <Users size={13} className="text-gray-500" />{g.user_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{g.max_sessions ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{formatBytes(g.quota_bytes)}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                    {g.dns_servers ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      g.split_tunnel
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {g.split_tunnel ? 'Split' : 'Full'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setEditing(g)}
                        className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setDeleting(g)}
                        className="p-1.5 rounded hover:bg-red-900/40 text-gray-400 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <GroupModal
          onClose={() => setShowCreate(false)}
          onSave={(data) => createMut.mutate(data)}
          saving={createMut.isPending}
        />
      )}

      {editing && (
        <GroupModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(data) => updateMut.mutate({ id: editing.id, data })}
          saving={updateMut.isPending}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm shadow-2xl p-6">
            <h2 className="font-semibold text-lg mb-2">Delete group "{deleting.name}"?</h2>
            <p className="text-sm text-gray-400 mb-6">
              {deleting.user_count > 0
                ? `${deleting.user_count} user(s) will be unassigned from this group. Their individual settings are kept.`
                : 'This group has no members.'}
            </p>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setDeleting(null)}>Cancel</button>
              <button
                className={btnDanger}
                onClick={() => deleteMut.mutate(deleting.id)}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending && <Loader2 size={14} className="animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

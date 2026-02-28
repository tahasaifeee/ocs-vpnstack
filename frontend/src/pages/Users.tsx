import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Power, Route, RefreshCw, Search } from 'lucide-react'
import { usersApi, routesApi, groupsApi } from '../api/client'
import type { VpnUser, VpnUserWithOtp, Route as VpnRoute, Group } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        active ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400' : 'bg-gray-600'}`} />
      {active ? 'Active' : 'Disabled'}
    </span>
  )
}

// ── OTP QR (fetched server-side — secret never leaves the API) ────────────────

function OtpQrImage({ username }: { username: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['otp-qr', username],
    queryFn: () => usersApi.otpQr(username),
  })
  if (isLoading) return <div className="w-48 h-48 mx-auto bg-gray-800 rounded animate-pulse" />
  if (!data) return null
  return (
    <img src={data.qr_data_url} alt="OTP QR Code" className="w-48 h-48 mx-auto rounded bg-white p-1" />
  )
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function UserModal({
  user,
  onClose,
}: {
  user?: VpnUser
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!user

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  })

  const [form, setForm] = useState({
    username: user?.username ?? '',
    password: '',
    email: user?.email ?? '',
    otp_enabled: user?.otp_enabled ?? false,
    quota_bytes: user?.quota_bytes?.toString() ?? '',
    notes: user?.notes ?? '',
    group_id: user?.group_id?.toString() ?? '',
    static_ip: user?.static_ip ?? '',
    max_sessions: user?.max_sessions?.toString() ?? '',
    dns_servers: user?.dns_servers ?? '',
  })
  const [created, setCreated] = useState<VpnUserWithOtp | null>(null)
  const [error, setError] = useState('')

  const createMut = useMutation({
    mutationFn: (data: typeof form) =>
      usersApi.create({
        ...data,
        quota_bytes: data.quota_bytes ? +data.quota_bytes : null,
        group_id: data.group_id ? +data.group_id : null,
        max_sessions: data.max_sessions ? +data.max_sessions : null,
        static_ip: data.static_ip || null,
        dns_servers: data.dns_servers || null,
      }),
    onSuccess: (data: VpnUserWithOtp) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setCreated(data)
    },
    onError: () => setError('Failed to create user'),
  })

  const updateMut = useMutation({
    mutationFn: (data: Partial<typeof form>) =>
      usersApi.update(user!.username, {
        password: data.password || undefined,
        email: data.email || null,
        quota_bytes: data.quota_bytes ? +data.quota_bytes : null,
        notes: data.notes || null,
        group_id: data.group_id ? +data.group_id : null,
        max_sessions: data.max_sessions ? +data.max_sessions : null,
        static_ip: data.static_ip || null,
        dns_servers: data.dns_servers || null,
        otp_enabled: data.otp_enabled,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: () => setError('Failed to update user'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (isEdit) updateMut.mutate(form)
    else createMut.mutate(form)
  }

  if (created) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 w-full max-w-sm">
          <h3 className="text-lg font-semibold mb-4 text-green-400">User created!</h3>
          {created.otp_uri && (
            <div className="mb-4">
              <p className="text-sm text-gray-300 mb-2">Scan this QR with your authenticator app:</p>
              <OtpQrImage username={created.username} />
              <p className="text-xs text-gray-500 mt-2 break-all text-center">{created.otp_secret}</p>
            </div>
          )}
          <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 rounded-lg py-2 text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-5">{isEdit ? 'Edit User' : 'Create User'}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          {!isEdit && (
            <Field label="Username">
              <input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className={inputCls}
                pattern="[a-zA-Z0-9._\-]+"
              />
            </Field>
          )}
          <Field label={isEdit ? 'New password (leave blank to keep)' : 'Password'}>
            <input
              type="password"
              required={!isEdit}
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Email (optional)">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Data quota (bytes, blank = unlimited)">
            <input
              type="number"
              value={form.quota_bytes}
              onChange={(e) => setForm({ ...form, quota_bytes: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Group (optional)">
            <select
              value={form.group_id}
              onChange={(e) => setForm({ ...form, group_id: e.target.value })}
              className={inputCls}
            >
              <option value="">— No group —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Static IP (optional, e.g. 172.16.1.10)">
            <input
              value={form.static_ip}
              onChange={(e) => setForm({ ...form, static_ip: e.target.value })}
              placeholder="blank = dynamic"
              className={inputCls}
            />
          </Field>
          <Field label="Max sessions override (blank = group/global default)">
            <input
              type="number"
              min={1}
              value={form.max_sessions}
              onChange={(e) => setForm({ ...form, max_sessions: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="DNS servers override (comma-separated, blank = group/global)">
            <input
              value={form.dns_servers}
              onChange={(e) => setForm({ ...form, dns_servers: e.target.value })}
              placeholder="8.8.8.8, 1.1.1.1"
              className={inputCls}
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className={inputCls + ' resize-none'}
            />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.otp_enabled}
              onChange={(e) => setForm({ ...form, otp_enabled: e.target.checked })}
              className="accent-blue-500"
            />
            Enable TOTP (2FA)
          </label>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 rounded-lg py-2 text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg py-2 text-sm font-medium"
            >
              {createMut.isPending || updateMut.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Routes modal ──────────────────────────────────────────────────────────────

function RoutesModal({ username, onClose }: { username: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: existing = [] } = useQuery<VpnRoute[]>({
    queryKey: ['routes', username],
    queryFn: () => routesApi.list(username),
  })

  const [routes, setRoutes] = useState<{ cidr: string; is_excluded: boolean }[]>([])

  useEffect(() => {
    if (existing.length > 0) {
      setRoutes(existing.map((r) => ({ cidr: r.cidr, is_excluded: r.is_excluded })))
    }
  }, [existing])

  const saveMut = useMutation({
    mutationFn: () => routesApi.set(username, routes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routes', username] })
      onClose()
    },
  })

  const addRoute = () => setRoutes([...routes, { cidr: '', is_excluded: false }])
  const removeRoute = (i: number) => setRoutes(routes.filter((_, idx) => idx !== i))

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 w-full max-w-lg">
        <h3 className="text-lg font-semibold mb-4">Routes — {username}</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {routes.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.cidr}
                onChange={(e) => setRoutes(routes.map((x, idx) => idx === i ? { ...x, cidr: e.target.value } : x))}
                placeholder="10.0.0.0/8"
                className={inputCls + ' flex-1'}
              />
              <label className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={r.is_excluded}
                  onChange={(e) => setRoutes(routes.map((x, idx) => idx === i ? { ...x, is_excluded: e.target.checked } : x))}
                  className="accent-orange-500"
                />
                exclude
              </label>
              <button onClick={() => removeRoute(i)} className="text-red-500 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addRoute} className="mt-3 text-sm text-blue-400 hover:text-blue-300">
          + Add route
        </button>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 rounded-lg py-2 text-sm">Cancel</button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg py-2 text-sm font-medium"
          >
            {saveMut.isPending ? 'Saving…' : 'Save routes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared ─────────────────────────────────────────────────────────────────────

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Users() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<VpnUser | null>(null)
  const [routeUser, setRouteUser] = useState<string | null>(null)

  const { data: users = [], isLoading } = useQuery<VpnUser[]>({
    queryKey: ['users'],
    queryFn: usersApi.list,
  })

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  })

  const groupById = (id?: number | null) => groups.find((g) => g.id === id)?.name

  const deleteMut = useMutation({
    mutationFn: usersApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const toggleMut = useMutation({
    mutationFn: ({ username, is_active }: { username: string; is_active: boolean }) =>
      usersApi.update(username, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const filtered = users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">VPN Users</h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> New User
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users…"
          className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">No users found</div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Username</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Group</th>
                <th className="text-left px-4 py-3">2FA</th>
                <th className="text-left px-4 py-3">Quota</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((u) => (
                <tr key={u.username} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <div>{u.username}</div>
                    {u.email && <div className="text-xs text-gray-500">{u.email}</div>}
                  </td>
                  <td className="px-4 py-3"><Badge active={u.is_active} /></td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {groupById(u.group_id) ?? <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {u.otp_enabled
                      ? <span className="text-green-400 text-xs font-medium">TOTP</span>
                      : <span className="text-gray-600 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {u.quota_bytes ? `${(u.quota_bytes / 1e9).toFixed(1)} GB` : '∞'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        title={u.is_active ? 'Disable' : 'Enable'}
                        onClick={() => toggleMut.mutate({ username: u.username, is_active: !u.is_active })}
                        className={`p-1.5 rounded-md transition-colors ${u.is_active ? 'text-green-400 hover:bg-green-900/30' : 'text-gray-500 hover:bg-gray-800'}`}
                      >
                        <Power size={14} />
                      </button>
                      <button
                        title="Manage routes"
                        onClick={() => setRouteUser(u.username)}
                        className="p-1.5 rounded-md text-blue-400 hover:bg-blue-900/30 transition-colors"
                      >
                        <Route size={14} />
                      </button>
                      <button
                        title="Edit"
                        onClick={() => setEditUser(u)}
                        className="p-1.5 rounded-md text-gray-400 hover:bg-gray-800 transition-colors"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => { if (confirm(`Delete ${u.username}?`)) deleteMut.mutate(u.username) }}
                        className="p-1.5 rounded-md text-red-500 hover:bg-red-900/30 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && <UserModal onClose={() => setCreateOpen(false)} />}
      {editUser && <UserModal user={editUser} onClose={() => setEditUser(null)} />}
      {routeUser && <RoutesModal username={routeUser} onClose={() => setRouteUser(null)} />}
    </div>
  )
}

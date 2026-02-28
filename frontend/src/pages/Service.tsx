import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Server, FileText, Archive, Radio, Send, Mail, Wifi,
  CheckCircle2, XCircle, Loader2, RefreshCw, Download, Upload, RotateCcw,
} from 'lucide-react'
import { serviceApi } from '../api/client'
import type {
  BackupInfo, ConfigValidationResult, ServiceStatus,
  SIEMConfig, SmtpConfig, SyslogConfig, VpnClientSettings,
} from '../types'
import { formatDistanceToNow } from 'date-fns'

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Card({ title, icon: Icon, children }: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <Icon className="text-blue-400" size={20} />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-11 h-6 rounded-full transition-colors relative ${value ? 'bg-blue-600' : 'bg-gray-700'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

const inputCls =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const btnPrimary =
  'bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors'
const btnSecondary =
  'bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors'

function Feedback({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${ok ? 'text-green-400' : 'text-red-400'}`}>
      {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
      {msg}
    </div>
  )
}

function ValidationResult({ result }: { result: ConfigValidationResult }) {
  return (
    <div className={`rounded-lg border p-3 text-sm space-y-1 ${result.valid ? 'border-green-700 bg-green-950/40' : 'border-red-700 bg-red-950/40'}`}>
      <p className={`font-medium ${result.valid ? 'text-green-400' : 'text-red-400'}`}>
        {result.valid ? '✓ Config is valid' : '✗ Config has errors'}
      </p>
      {result.errors.map((e, i) => (
        <p key={i} className="text-red-400 text-xs">Error: {e}</p>
      ))}
      {result.warnings.map((w, i) => (
        <p key={i} className="text-yellow-400 text-xs">Warning: {w}</p>
      ))}
    </div>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Service Status card ───────────────────────────────────────────────────────

function ServiceStatusCard() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery<ServiceStatus>({
    queryKey: ['service-status'],
    queryFn: serviceApi.status,
    refetchInterval: 30_000,
  })

  const reloadMut = useMutation({
    mutationFn: serviceApi.reload,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-status'] }),
  })

  return (
    <Card title="Service Status" icon={Server}>
      {isLoading ? (
        <Loader2 className="animate-spin text-gray-500" size={20} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${status?.ocserv_running ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-sm font-medium">{status?.ocserv_running ? 'Running' : 'Stopped'}</span>
            </div>
            <div className="text-sm text-gray-400">
              Active connections: <span className="text-gray-200 font-medium">{status?.active_connections ?? 0}</span>
            </div>
            {status?.version && (
              <div className="text-sm text-gray-400">
                Version: <span className="text-gray-300 font-mono text-xs">{status.version}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => reloadMut.mutate()}
              disabled={reloadMut.isPending}
              className={btnSecondary}
            >
              {reloadMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : <RefreshCw size={14} className="inline mr-1" />}
              Reload config
            </button>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['service-status'] })}
              className={btnSecondary}
            >
              Refresh
            </button>
          </div>
          {reloadMut.isSuccess && <Feedback ok msg="Config reloaded successfully" />}
          {reloadMut.isError && <Feedback ok={false} msg="Reload failed" />}
        </div>
      )}
    </Card>
  )
}

// ── Config File card ──────────────────────────────────────────────────────────

function ConfigFileCard() {
  const [validation, setValidation] = useState<ConfigValidationResult | null>(null)
  const [uploadResult, setUploadResult] = useState<ConfigValidationResult | null>(null)
  const [uploadFeedback, setUploadFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const validateMut = useMutation({
    mutationFn: serviceApi.validate,
    onSuccess: (r) => setValidation(r),
  })

  const handleDownload = async () => {
    const r = await serviceApi.downloadConfig()
    downloadBlob(r.data, 'ocserv.conf')
  }

  const handleUpload = async (apply: boolean) => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setUploadFeedback(null)
    setUploadResult(null)
    try {
      const result = await serviceApi.uploadConfig(file, apply)
      setUploadResult(result)
      setUploadFeedback({ ok: result.valid, msg: apply ? (result.valid ? 'Uploaded and applied' : 'Uploaded but config has errors') : 'Validation complete' })
    } catch (e: any) {
      setUploadFeedback({ ok: false, msg: e?.response?.data?.detail ?? 'Upload failed' })
    }
  }

  return (
    <Card title="Config File" icon={FileText}>
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => validateMut.mutate()} disabled={validateMut.isPending} className={btnSecondary}>
            {validateMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : null}
            Validate current
          </button>
          <button onClick={handleDownload} className={btnSecondary}>
            <Download size={14} className="inline mr-1" /> Download
          </button>
        </div>

        {validation && <ValidationResult result={validation} />}

        <div className="border-t border-gray-800 pt-4 space-y-3">
          <p className="text-sm text-gray-400">Upload a new config file:</p>
          <input ref={fileRef} type="file" accept=".conf,.txt" className="text-sm text-gray-300 file:mr-3 file:text-xs file:bg-gray-700 file:text-gray-300 file:border-0 file:rounded file:px-3 file:py-1" />
          <div className="flex gap-2">
            <button onClick={() => handleUpload(false)} className={btnSecondary}>
              <Upload size={14} className="inline mr-1" /> Validate only
            </button>
            <button onClick={() => handleUpload(true)} className={btnPrimary}>
              <Upload size={14} className="inline mr-1" /> Upload & Apply
            </button>
          </div>
          {uploadFeedback && <Feedback ok={uploadFeedback.ok} msg={uploadFeedback.msg} />}
          {uploadResult && <ValidationResult result={uploadResult} />}
        </div>
      </div>
    </Card>
  )
}

// ── Backups card ──────────────────────────────────────────────────────────────

function BackupsCard() {
  const qc = useQueryClient()
  const { data: backups = [], isLoading } = useQuery<BackupInfo[]>({
    queryKey: ['service-backups'],
    queryFn: serviceApi.backups,
  })

  const createMut = useMutation({
    mutationFn: serviceApi.createBackup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-backups'] }),
  })

  const restoreMut = useMutation({
    mutationFn: (filename: string) => serviceApi.restoreBackup(filename),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-backups'] })
      qc.invalidateQueries({ queryKey: ['service-status'] })
    },
  })

  return (
    <Card title="Config Backups" icon={Archive}>
      <div className="space-y-4">
        <button onClick={() => createMut.mutate()} disabled={createMut.isPending} className={btnSecondary}>
          {createMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : <Archive size={14} className="inline mr-1" />}
          Create backup now
        </button>
        {createMut.isSuccess && <Feedback ok msg={`Backup created: ${(createMut.data as any)?.filename}`} />}

        {isLoading ? (
          <Loader2 className="animate-spin text-gray-500" size={18} />
        ) : backups.length === 0 ? (
          <p className="text-sm text-gray-500">No backups found</p>
        ) : (
          <div className="bg-gray-800/50 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-2">Filename</th>
                  <th className="text-right px-4 py-2">Size</th>
                  <th className="text-right px-4 py-2">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {backups.map((b) => (
                  <tr key={b.filename} className="hover:bg-gray-700/40 transition-colors">
                    <td className="px-4 py-2 font-mono text-xs text-gray-300">{b.filename}</td>
                    <td className="px-4 py-2 text-right text-xs text-gray-400">{(b.size_bytes / 1024).toFixed(1)} KB</td>
                    <td className="px-4 py-2 text-right text-xs text-gray-400">
                      {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => {
                          if (confirm(`Restore ${b.filename}? This will overwrite the current ocserv.conf.`)) {
                            restoreMut.mutate(b.filename)
                          }
                        }}
                        disabled={restoreMut.isPending}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <RotateCcw size={13} className="inline mr-1" />
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {restoreMut.isSuccess && <Feedback ok msg="Config restored and reloaded" />}
        {restoreMut.isError && <Feedback ok={false} msg="Restore failed" />}
      </div>
    </Card>
  )
}

// ── Syslog card ───────────────────────────────────────────────────────────────

function SyslogCard() {
  const [form, setForm] = useState<SyslogConfig>({
    enabled: false, host: '127.0.0.1', port: 514, protocol: 'udp', facility: 'local0',
  })
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const { isLoading, data: syslogData } = useQuery<SyslogConfig>({
    queryKey: ['service-syslog'],
    queryFn: serviceApi.getSyslog,
  })

  useEffect(() => { if (syslogData) setForm(syslogData) }, [syslogData])

  const mut = useMutation({
    mutationFn: () => serviceApi.putSyslog(form),
    onSuccess: () => setFeedback({ ok: true, msg: 'Syslog settings saved' }),
    onError: (e: any) => setFeedback({ ok: false, msg: e?.response?.data?.detail ?? 'Save failed' }),
  })

  const set = (k: keyof SyslogConfig, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  if (isLoading) return <Card title="Syslog" icon={Radio}><Loader2 className="animate-spin text-gray-500" size={20} /></Card>

  return (
    <Card title="Syslog Forwarding" icon={Radio}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle value={form.enabled} onChange={(v) => set('enabled', v)} />
          <span className="text-sm text-gray-300">{form.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        {form.enabled && (
          <>
            <Field label="Host">
              <input className={inputCls} value={form.host} onChange={(e) => set('host', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Port">
                <input type="number" className={inputCls} value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
              </Field>
              <Field label="Protocol">
                <select className={inputCls} value={form.protocol} onChange={(e) => set('protocol', e.target.value)}>
                  <option value="udp">UDP</option>
                  <option value="tcp">TCP</option>
                </select>
              </Field>
            </div>
            <Field label="Facility">
              <input className={inputCls} value={form.facility} onChange={(e) => set('facility', e.target.value)} placeholder="local0" />
            </Field>
          </>
        )}
        {feedback && <Feedback ok={feedback.ok} msg={feedback.msg} />}
        <button onClick={() => { setFeedback(null); mut.mutate() }} disabled={mut.isPending} className={btnPrimary}>
          {mut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : null}
          Save
        </button>
      </div>
    </Card>
  )
}

// ── SIEM card ─────────────────────────────────────────────────────────────────

function SiemCard() {
  const [form, setForm] = useState<SIEMConfig>({
    enabled: false, url: '', format: 'json', token: '', verify_ssl: true,
  })
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const { isLoading, data: siemData } = useQuery<SIEMConfig>({
    queryKey: ['service-siem'],
    queryFn: serviceApi.getSiem,
  })

  useEffect(() => { if (siemData) setForm(siemData) }, [siemData])

  const saveMut = useMutation({
    mutationFn: () => serviceApi.putSiem(form),
    onSuccess: () => setFeedback({ ok: true, msg: 'SIEM settings saved' }),
    onError: (e: any) => setFeedback({ ok: false, msg: e?.response?.data?.detail ?? 'Save failed' }),
  })

  const testMut = useMutation({
    mutationFn: serviceApi.testSiem,
    onSuccess: () => setTestResult({ ok: true, msg: 'Test event sent successfully' }),
    onError: (e: any) => setTestResult({ ok: false, msg: e?.response?.data?.detail ?? 'Test failed' }),
  })

  const set = (k: keyof SIEMConfig, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  if (isLoading) return <Card title="SIEM Webhook" icon={Send}><Loader2 className="animate-spin text-gray-500" size={20} /></Card>

  return (
    <Card title="SIEM Webhook" icon={Send}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle value={form.enabled} onChange={(v) => set('enabled', v)} />
          <span className="text-sm text-gray-300">{form.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        {form.enabled && (
          <>
            <Field label="Webhook URL">
              <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="Format">
              <select className={inputCls} value={form.format} onChange={(e) => set('format', e.target.value)}>
                <option value="json">Generic JSON</option>
                <option value="gelf">GELF (Graylog)</option>
                <option value="splunk-hec">Splunk HEC</option>
              </select>
            </Field>
            <Field label="Auth token (optional)">
              <input type="password" className={inputCls} value={form.token} onChange={(e) => set('token', e.target.value)} placeholder="Bearer / Splunk token" />
            </Field>
            <div className="flex items-center gap-3">
              <Toggle value={form.verify_ssl} onChange={(v) => set('verify_ssl', v)} />
              <span className="text-sm text-gray-300">Verify SSL certificate</span>
            </div>
          </>
        )}
        {feedback && <Feedback ok={feedback.ok} msg={feedback.msg} />}
        <div className="flex gap-2">
          <button onClick={() => { setFeedback(null); saveMut.mutate() }} disabled={saveMut.isPending} className={btnPrimary}>
            {saveMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : null}
            Save
          </button>
          {form.enabled && (
            <button onClick={() => { setTestResult(null); testMut.mutate() }} disabled={testMut.isPending} className={btnSecondary}>
              {testMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : null}
              Send test event
            </button>
          )}
        </div>
        {testResult && <Feedback ok={testResult.ok} msg={testResult.msg} />}
      </div>
    </Card>
  )
}

// ── SMTP card ─────────────────────────────────────────────────────────────────

function SmtpCard() {
  const [form, setForm] = useState<SmtpConfig>({
    enabled: false, host: '', port: 587, username: '', password: '',
    from_email: '', from_name: 'VPN Dashboard', use_tls: true, use_ssl: false,
  })
  const [testEmail, setTestEmail] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const { isLoading, data: smtpData } = useQuery<SmtpConfig>({
    queryKey: ['service-smtp'],
    queryFn: serviceApi.getSmtp,
  })

  useEffect(() => { if (smtpData) setForm(smtpData) }, [smtpData])

  const saveMut = useMutation({
    mutationFn: () => serviceApi.putSmtp(form),
    onSuccess: () => setFeedback({ ok: true, msg: 'SMTP settings saved' }),
    onError: (e: any) => setFeedback({ ok: false, msg: e?.response?.data?.detail ?? 'Save failed' }),
  })

  const testMut = useMutation({
    mutationFn: () => serviceApi.testSmtp(testEmail),
    onSuccess: () => setTestResult({ ok: true, msg: `Test email sent to ${testEmail}` }),
    onError: (e: any) => setTestResult({ ok: false, msg: e?.response?.data?.detail ?? 'Send failed' }),
  })

  const set = (k: keyof SmtpConfig, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  // When use_ssl is toggled on, disable use_tls (they're mutually exclusive)
  const setSsl = (v: boolean) => setForm((f) => ({ ...f, use_ssl: v, use_tls: v ? false : f.use_tls }))
  const setTls = (v: boolean) => setForm((f) => ({ ...f, use_tls: v, use_ssl: v ? false : f.use_ssl }))

  if (isLoading) return <Card title="SMTP" icon={Mail}><Loader2 className="animate-spin text-gray-500" size={20} /></Card>

  return (
    <Card title="SMTP / Email" icon={Mail}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle value={form.enabled} onChange={(v) => set('enabled', v)} />
          <span className="text-sm text-gray-300">{form.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>

        {form.enabled && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="SMTP host">
                  <input
                    className={inputCls}
                    value={form.host}
                    onChange={(e) => set('host', e.target.value)}
                    placeholder="smtp.example.com"
                  />
                </Field>
              </div>
              <Field label="Port">
                <input
                  type="number"
                  className={inputCls}
                  value={form.port}
                  onChange={(e) => set('port', Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Encryption">
                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.use_tls}
                      onChange={(e) => setTls(e.target.checked)}
                      className="rounded"
                    />
                    STARTTLS (port 587)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.use_ssl}
                      onChange={(e) => setSsl(e.target.checked)}
                      className="rounded"
                    />
                    SSL/TLS (port 465)
                  </label>
                </div>
              </Field>
            </div>

            <Field label="Username (leave blank if no auth required)">
              <input
                className={inputCls}
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                placeholder="user@example.com"
                autoComplete="off"
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                className={inputCls}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                autoComplete="new-password"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="From email address">
                <input
                  className={inputCls}
                  value={form.from_email}
                  onChange={(e) => set('from_email', e.target.value)}
                  placeholder="vpn@example.com"
                />
              </Field>
              <Field label="From name">
                <input
                  className={inputCls}
                  value={form.from_name}
                  onChange={(e) => set('from_name', e.target.value)}
                  placeholder="VPN Dashboard"
                />
              </Field>
            </div>
          </>
        )}

        {feedback && <Feedback ok={feedback.ok} msg={feedback.msg} />}

        <button
          onClick={() => { setFeedback(null); saveMut.mutate() }}
          disabled={saveMut.isPending}
          className={btnPrimary}
        >
          {saveMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : null}
          Save
        </button>

        {form.enabled && (
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <p className="text-sm text-gray-400">Send a test email to verify your settings:</p>
            <div className="flex gap-2">
              <input
                className={`${inputCls} flex-1`}
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="recipient@example.com"
              />
              <button
                onClick={() => { setTestResult(null); testMut.mutate() }}
                disabled={testMut.isPending || !testEmail}
                className={btnSecondary}
              >
                {testMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : null}
                Send test
              </button>
            </div>
            {testResult && <Feedback ok={testResult.ok} msg={testResult.msg} />}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── VPN Client Settings card ──────────────────────────────────────────────────

function VpnClientCard() {
  const [form, setForm] = useState<VpnClientSettings>({ server_address: '', client_url: '' })
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const { isLoading, data } = useQuery<VpnClientSettings>({
    queryKey: ['service-vpn-client'],
    queryFn: serviceApi.getVpnClient,
  })

  useEffect(() => { if (data) setForm(data) }, [data])

  const mut = useMutation({
    mutationFn: () => serviceApi.putVpnClient(form),
    onSuccess: () => setFeedback({ ok: true, msg: 'Settings saved' }),
    onError: (e: any) => setFeedback({ ok: false, msg: e?.response?.data?.detail ?? 'Save failed' }),
  })

  if (isLoading) return <Card title="VPN Client Settings" icon={Wifi}><Loader2 className="animate-spin text-gray-500" size={20} /></Card>

  return (
    <Card title="VPN Client Settings" icon={Wifi}>
      <p className="text-sm text-gray-400 mb-4">
        These values are shown in the post-create credentials panel and included in credential emails.
      </p>
      <div className="space-y-4">
        <Field label="VPN Server Address">
          <input
            className={inputCls}
            value={form.server_address}
            onChange={(e) => setForm((f) => ({ ...f, server_address: e.target.value }))}
            placeholder="vpn.example.com"
          />
          <p className="text-xs text-gray-600 mt-1">Hostname or IP that users connect to (port 443).</p>
        </Field>
        <Field label="VPN Client Download URL">
          <input
            className={inputCls}
            value={form.client_url}
            onChange={(e) => setForm((f) => ({ ...f, client_url: e.target.value }))}
            placeholder="https://example.com/downloads/vpn-client.exe"
          />
          <p className="text-xs text-gray-600 mt-1">
            Link to the VPN client installer for your users (Cisco AnyConnect, OpenConnect, etc.)
          </p>
        </Field>
        {feedback && <Feedback ok={feedback.ok} msg={feedback.msg} />}
        <button
          onClick={() => { setFeedback(null); mut.mutate() }}
          disabled={mut.isPending}
          className={btnPrimary}
        >
          {mut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : null}
          Save
        </button>
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Service() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Service Management</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ServiceStatusCard />
        <ConfigFileCard />
        <div className="lg:col-span-2">
          <BackupsCard />
        </div>
        <SyslogCard />
        <SiemCard />
        <div className="lg:col-span-2">
          <SmtpCard />
        </div>
        <div className="lg:col-span-2">
          <VpnClientCard />
        </div>
      </div>
    </div>
  )
}

import { useState, FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck, ShieldOff, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { authApi } from '../api/client'
import { useAuthStore } from '../store/auth'

// ── tiny helpers ──────────────────────────────────────────────────────────────

function Card({ title, icon: Icon, children }: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-6">
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

const inputCls =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

const btnPrimary =
  'bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors'

const btnDanger =
  'bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors'

const btnGhost =
  'text-gray-400 hover:text-gray-200 text-sm px-4 py-2 transition-colors'

// ── Password change card ──────────────────────────────────────────────────────

function PasswordCard() {
  const { adminUsername, logout } = useAuthStore()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const mut = useMutation({
    mutationFn: authApi.updateMe,
    onSuccess: () => {
      setFeedback({ ok: true, msg: 'Changes saved. Please log in again.' })
      setCurrentPw(''); setNewPw(''); setConfirmPw(''); setNewUsername('')
      // If username changed, force re-login
      setTimeout(() => logout(), 1500)
    },
    onError: (e: any) => {
      setFeedback({ ok: false, msg: e?.response?.data?.detail ?? 'Failed to update credentials' })
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFeedback(null)
    if (newPw && newPw !== confirmPw) {
      setFeedback({ ok: false, msg: 'New passwords do not match' })
      return
    }
    mut.mutate({
      current_password: currentPw,
      ...(newPw ? { new_password: newPw } : {}),
      ...(newUsername && newUsername !== adminUsername ? { new_username: newUsername } : {}),
    })
  }

  return (
    <Card title="Account Credentials" icon={KeyRound}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="New username (leave blank to keep current)">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder={adminUsername ?? 'admin'}
            className={inputCls}
          />
        </Field>
        <Field label="Current password *">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            required
            className={inputCls}
          />
        </Field>
        <Field label="New password (leave blank to keep current)">
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            minLength={8}
            className={inputCls}
          />
        </Field>
        {newPw && (
          <Field label="Confirm new password">
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
              className={inputCls}
            />
          </Field>
        )}

        {feedback && (
          <div className={`flex items-center gap-2 text-sm ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>
            {feedback.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {feedback.msg}
          </div>
        )}

        <button type="submit" disabled={mut.isPending || !currentPw} className={btnPrimary}>
          {mut.isPending ? <Loader2 size={15} className="inline animate-spin mr-1" /> : null}
          Save changes
        </button>
      </form>
    </Card>
  )
}

// ── 2FA card ──────────────────────────────────────────────────────────────────

type TotpView = 'idle' | 'setup' | 'disable'

interface TotpSetup {
  totp_secret: string
  totp_uri: string
  qr_data_url: string
}

function TwoFactorCard() {
  const qc = useQueryClient()
  const { data: me, isLoading } = useQuery({ queryKey: ['admin-me'], queryFn: authApi.me })
  const totpEnabled: boolean = me?.totp_enabled ?? false

  const [view, setView] = useState<TotpView>('idle')
  const [setupData, setSetupData] = useState<TotpSetup | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [disablePw, setDisablePw] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const setupMut = useMutation({
    mutationFn: authApi.setupTotp,
    onSuccess: (data: TotpSetup) => { setSetupData(data); setView('setup') },
    onError: () => setFeedback({ ok: false, msg: 'Could not generate setup data' }),
  })

  const enableMut = useMutation({
    mutationFn: (code: string) => authApi.enableTotp(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-me'] })
      setView('idle'); setVerifyCode(''); setSetupData(null)
      setFeedback({ ok: true, msg: '2FA enabled successfully' })
    },
    onError: (e: any) => setFeedback({ ok: false, msg: e?.response?.data?.detail ?? 'Invalid code' }),
  })

  const disableMut = useMutation({
    mutationFn: (password: string) => authApi.disableTotp(password),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-me'] })
      setView('idle'); setDisablePw('')
      setFeedback({ ok: true, msg: '2FA disabled' })
    },
    onError: (e: any) => setFeedback({ ok: false, msg: e?.response?.data?.detail ?? 'Incorrect password' }),
  })

  if (isLoading) return (
    <Card title="Two-Factor Authentication" icon={ShieldCheck}>
      <Loader2 className="animate-spin text-gray-500" size={20} />
    </Card>
  )

  return (
    <Card title="Two-Factor Authentication" icon={ShieldCheck}>
      {/* Status badge */}
      <div className="flex items-center gap-3 mb-6">
        {totpEnabled ? (
          <span className="flex items-center gap-1.5 text-green-400 text-sm font-medium">
            <ShieldCheck size={16} /> Enabled
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-gray-500 text-sm font-medium">
            <ShieldOff size={16} /> Disabled
          </span>
        )}
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 text-sm mb-4 ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>
          {feedback.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {feedback.msg}
        </div>
      )}

      {/* ── Idle state ── */}
      {view === 'idle' && !totpEnabled && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Add an extra layer of security. After setup you'll need your authenticator app every time you log in.
          </p>
          <button
            className={btnPrimary}
            disabled={setupMut.isPending}
            onClick={() => { setFeedback(null); setupMut.mutate() }}
          >
            {setupMut.isPending ? <Loader2 size={15} className="inline animate-spin mr-1" /> : null}
            Set up 2FA
          </button>
        </div>
      )}

      {view === 'idle' && totpEnabled && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Your account is protected. You'll be asked for a TOTP code on every login.
          </p>
          <button
            className={btnDanger}
            onClick={() => { setFeedback(null); setView('disable') }}
          >
            Disable 2FA
          </button>
        </div>
      )}

      {/* ── Setup flow ── */}
      {view === 'setup' && setupData && (
        <div className="space-y-5">
          <p className="text-sm text-gray-400">
            Scan this QR code with <strong className="text-gray-200">Google Authenticator</strong>,{' '}
            <strong className="text-gray-200">Authy</strong>, or any TOTP app.
          </p>

          <div className="flex justify-center">
            <img
              src={setupData.qr_data_url}
              alt="TOTP QR code"
              className="rounded-xl border border-gray-700 bg-white p-2"
              width={200}
              height={200}
            />
          </div>

          <details className="text-xs">
            <summary className="text-gray-500 cursor-pointer hover:text-gray-300">
              Can't scan? Enter the code manually
            </summary>
            <code className="block mt-2 bg-gray-800 rounded-lg px-3 py-2 text-gray-300 break-all">
              {setupData.totp_secret}
            </code>
          </details>

          <div className="space-y-3">
            <Field label="Enter the 6-digit code from your app to confirm">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                className={`${inputCls} text-center tracking-[0.4em] font-mono`}
              />
            </Field>
            <div className="flex gap-2">
              <button
                className={btnPrimary}
                disabled={enableMut.isPending || verifyCode.length !== 6}
                onClick={() => { setFeedback(null); enableMut.mutate(verifyCode) }}
              >
                {enableMut.isPending ? <Loader2 size={15} className="inline animate-spin mr-1" /> : null}
                Verify & enable
              </button>
              <button className={btnGhost} onClick={() => { setView('idle'); setVerifyCode('') }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Disable flow ── */}
      {view === 'disable' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Enter your current password to confirm disabling 2FA.
          </p>
          <Field label="Password">
            <input
              type="password"
              value={disablePw}
              onChange={(e) => setDisablePw(e.target.value)}
              autoFocus
              className={inputCls}
            />
          </Field>
          <div className="flex gap-2">
            <button
              className={btnDanger}
              disabled={disableMut.isPending || !disablePw}
              onClick={() => { setFeedback(null); disableMut.mutate(disablePw) }}
            >
              {disableMut.isPending ? <Loader2 size={15} className="inline animate-spin mr-1" /> : null}
              Confirm disable
            </button>
            <button className={btnGhost} onClick={() => { setView('idle'); setDisablePw('') }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PasswordCard />
        <TwoFactorCard />
      </div>
    </div>
  )
}

import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, KeyRound, Loader2 } from 'lucide-react'
import { useAuthStore } from '../store/auth'

type Step = 'credentials' | 'totp'

const inputCls =
  'w-full bg-gray-900 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500/50 transition-all'

export default function Login() {
  const [step, setStep]         = useState<Step>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const { login }               = useAuthStore()
  const navigate                = useNavigate()

  const handleCredentials = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await login(username, password)
      if (result === 'requires_totp') {
        setStep('totp')
      } else {
        navigate('/')
      }
    } catch {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  const handleTotp = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password, totpCode)
      navigate('/')
    } catch {
      setError('Invalid 2FA code — try again')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center relative overflow-hidden">

      {/* Subtle background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-blue-600/[0.06] rounded-full blur-3xl" />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-[360px] mx-4">
        <div className="bg-[#0c1018] border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/60 p-8">

          {step === 'credentials' ? (
            <>
              {/* Header */}
              <div className="flex flex-col items-center mb-8">
                <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-4 shadow-lg shadow-blue-900/60">
                  <Shield size={22} className="text-white" />
                </div>
                <h1 className="text-xl font-bold tracking-tight">VPN Admin</h1>
                <p className="text-gray-500 text-sm mt-1">Sign in to your dashboard</p>
              </div>

              <form onSubmit={handleCredentials} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-400">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder="admin"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-400">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-lg transition-all duration-150 flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              {/* 2FA Header */}
              <div className="flex flex-col items-center mb-8">
                <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center mb-4 shadow-lg shadow-violet-900/60">
                  <KeyRound size={22} className="text-white" />
                </div>
                <h1 className="text-xl font-bold tracking-tight">Two-Factor Auth</h1>
                <p className="text-gray-500 text-sm mt-1 text-center">
                  Enter the code from your authenticator app
                </p>
              </div>

              <form onSubmit={handleTotp} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-400">
                    6-digit code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000 000"
                    required
                    autoFocus
                    className={`${inputCls} text-center tracking-[0.5em] font-mono text-lg`}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-lg transition-all duration-150 flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    'Verify code'
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setError(''); setTotpCode('') }}
                  className="w-full text-xs text-gray-600 hover:text-gray-300 transition-colors py-1"
                >
                  ← Back to login
                </button>
              </form>
            </>
          )}
        </div>

        {/* Footer label */}
        <p className="text-center text-[11px] text-gray-700 mt-5">
          Secure admin access only
        </p>
      </div>
    </div>
  )
}

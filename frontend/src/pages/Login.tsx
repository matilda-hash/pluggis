import { useState, FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { authApi } from '../services/api'
import { useAuth } from '../auth/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string })?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const token = await authApi.login(email, password)
      await login(token.access_token)
      navigate(from, { replace: true })
    } catch {
      setError('Fel e-post eller lösenord. Försök igen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-pink-50 via-rose-50 to-fuchsia-50 px-4">
      {/* Decorative blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-pink-200 rounded-full opacity-30 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-fuchsia-200 rounded-full opacity-30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm space-y-8">
        {/* Logo – big, no white box */}
        <div className="flex justify-center">
          <img
            src="/pluggislogo.png"
            alt="Pluggis"
            className="h-40 w-auto object-contain drop-shadow-lg"
          />
        </div>

        {/* Card */}
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl border border-pink-100 p-8 space-y-5">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">Välkommen tillbaka</h1>
            <p className="text-sm text-gray-500 mt-1">Logga in för att fortsätta studera</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">E-post</label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-300 outline-none transition-all"
                placeholder="din@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Lösenord</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-300 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg disabled:opacity-60"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              Logga in
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500">
          Inget konto?{' '}
          <Link to="/register" className="text-pink-600 hover:text-pink-700 font-semibold hover:underline">
            Registrera dig
          </Link>
        </p>
      </div>
    </div>
  )
}

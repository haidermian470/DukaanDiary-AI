import { useState } from 'react'
import { LogIn, UserPlus } from 'lucide-react'
import BrandLogo from '../components/layout/BrandLogo'
import FormField from '../components/ui/FormField'
import { useLive } from './context.js'

export default function LoginScreen() {
  const { signIn, signUp, authNotice } = useLive()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError(''); setNotice('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.')
    if (password.length < (mode === 'signup' ? 8 : 1)) return setError(mode === 'signup' ? 'Use a password of at least 8 characters.' : 'Enter your password.')
    setBusy(true)
    try {
      if (mode === 'signin') await signIn(email.trim(), password)
      else {
        const { needsConfirmation } = await signUp(email.trim(), password)
        if (needsConfirmation) { setNotice('Account created. Check your email to confirm it, then sign in.'); setMode('signin'); setPassword('') }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return <main id="main" tabIndex={-1} className="auth-page">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand"><BrandLogo className="auth-logo" /><span className="brand-subtitle">Hisab-kitab for your dukaan</span></div>
      <h1 id="auth-title">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
      <p className="subtitle">{mode === 'signin' ? 'Use your shop account to see your own records.' : 'Your shop is created automatically after you sign in.'}</p>
      {authNotice && <p role="status" className="warning-message">{authNotice}</p>}
      {notice && <p role="status" className="success-message">{notice}</p>}
      <form onSubmit={submit} noValidate className="auth-form">
        <FormField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <FormField label="Password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p role="alert" className="error-message">{error}</p>}
        <button className="button primary" type="submit" disabled={busy}>{mode === 'signin' ? <LogIn size={18} /> : <UserPlus size={18} />}{busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button type="button" className="link-button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice('') }}>{mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button>
    </section>
  </main>
}

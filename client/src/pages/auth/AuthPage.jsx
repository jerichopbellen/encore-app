import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import { register as registerAccount } from '../../services/authApi'

function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setNotice('')
    setIsSubmitting(true)

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email')
    const password = formData.get('password')

    try {
      if (isRegister) {
        const name = formData.get('name')
        await registerAccount({ name, email, password })
        setNotice('Your account is ready. Log in to continue.')
        form.reset()
      } else {
        await signIn({ email, password })
        navigate('/', { replace: true })
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page" aria-labelledby="auth-page-title">
      <aside className="auth-page__poster">
        <p className="auth-page__poster-label">ENCORE ACCOUNT</p>
        <div className="auth-page__poster-body">
          <p className="auth-page__poster-headline">
            Your next <span>night out</span> starts here
          </p>
          <ul className="auth-page__benefits">
            <li>Hold seats while you check out</li>
            <li>Reservations and bookings in one place</li>
            <li>Booking confirmations saved to your account</li>
          </ul>
        </div>
        <p className="auth-page__poster-stub" aria-hidden="true">ADMIT ONE · ENCORE</p>
      </aside>

      <div className="auth-page__panel">
        <h1 id="auth-page-title">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-page__intro">
          {isRegister ? 'Keep your event plans together in one place.' : 'Log in to pick up where you left off.'}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister && (
            <label>
              Name
              <input name="name" type="text" autoComplete="name" maxLength="100" required />
            </label>
          )}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" maxLength="255" required />
          </label>
          <div className="auth-form__field">
            <div className="auth-form__label-row">
              <label htmlFor="auth-password">Password</label>
              <button
                className="auth-form__toggle"
                type="button"
                aria-controls="auth-password"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="auth-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              minLength="8"
              required
              aria-describedby={isRegister ? 'auth-password-hint' : undefined}
            />
            {isRegister && <span className="auth-form__hint" id="auth-password-hint">Use at least 8 characters.</span>}
          </div>
          {error && <p className="auth-form__error" role="alert">{error}</p>}
          {notice && <p className="auth-form__notice" role="status">{notice}</p>}
          <button className="button-link auth-form__submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
          </button>
        </form>

        <p className="auth-page__switch">
          {isRegister ? 'Already have an account?' : 'New to Encore?'}{' '}
          <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Log in' : 'Create an account'}</Link>
        </p>
      </div>
    </section>
  )
}

export default AuthPage

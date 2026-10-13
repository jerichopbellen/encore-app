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
    <section className="auth-page">
      <p className="eyebrow">ENCORE ACCOUNT</p>
      <h1>{isRegister ? 'Join the encore.' : 'Welcome back.'}</h1>
      <p className="auth-page__intro">
        {isRegister ? 'Create an account to keep your event plans together.' : 'Log in to your Encore account.'}
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
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength="8"
            required
          />
          {isRegister && <span className="auth-form__hint">Use at least 8 characters.</span>}
        </label>
        {error && <p className="auth-form__error" role="alert">{error}</p>}
        {notice && <p className="auth-form__notice" role="status">{notice}</p>}
        <button className="button-link auth-form__submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
        </button>
      </form>

      <p className="auth-page__switch">
        {isRegister ? 'Already have an account?' : 'New to Encore?'}{' '}
        <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Log in' : 'Sign up'}</Link>
      </p>
    </section>
  )
}

export default AuthPage

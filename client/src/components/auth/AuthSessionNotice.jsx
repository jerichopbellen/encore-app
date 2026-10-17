import { useAuth } from '../../contexts/AuthContext'

function AuthSessionNotice({ compact = false }) {
  const { retrySession } = useAuth()

  return (
    <div className={`auth-session-notice${compact ? ' auth-session-notice--compact' : ''}`} role="alert">
      <span>Encore couldn’t check your session. Check your connection and try again.</span>
      <button className="auth-session-notice__retry" type="button" onClick={retrySession}>
        Retry
      </button>
    </div>
  )
}

export default AuthSessionNotice

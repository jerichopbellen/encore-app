import { Navigate, Link } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import AuthSessionNotice from '../auth/AuthSessionNotice'

function AdminRouteGuard({ children }) {
  const { user, authStatus, isLoading } = useAuth()

  if (isLoading) return <p className="admin-events-state" role="status">Checking your session…</p>
  if (authStatus === 'error') return <AuthSessionNotice />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') {
    return (
      <section className="admin-events-state" role="alert">
        <p className="eyebrow">ADMIN ACCESS</p>
        <h1>Administrator access is required.</h1>
        <p>Your account does not have permission to manage events.</p>
        <Link className="button-link" to="/">Back to events</Link>
      </section>
    )
  }

  return children
}

export default AdminRouteGuard

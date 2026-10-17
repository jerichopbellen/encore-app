import { Link, Navigate, NavLink, Outlet } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'
import AuthSessionNotice from '../../components/auth/AuthSessionNotice'

function AccountLayout() {
  const { user, authStatus, isLoading } = useAuth()

  if (isLoading) return <p className="account-state" role="status">Checking your account…</p>
  if (authStatus === 'error') return <AuthSessionNotice />
  if (!user) return <Navigate to="/login" replace />

  return (
    <section className="account-page" aria-labelledby="account-title">
      <header className="account-page__heading">
        <p className="eyebrow">YOUR ENCORE ACCOUNT</p>
        <h1 id="account-title">My Account</h1>
        <p>Manage your profile and keep track of the events you have reserved or booked.</p>
      </header>
      <div className="account-page__layout">
        <aside className="account-sidebar">
          <nav className="account-nav" aria-label="Account sections">
            <NavLink to="/account/profile" end>
              <span>Profile</span><small>Name and email</small>
            </NavLink>
            <NavLink to="/account/reservations">
              <span>Reservations</span><small>Ticket holds and status</small>
            </NavLink>
            <NavLink to="/account/bookings">
              <span>Bookings</span><small>Confirmed tickets</small>
            </NavLink>
          </nav>
          <Link className="account-page__discover" to="/">Explore events</Link>
        </aside>
        <div className="account-page__content"><Outlet /></div>
      </div>
    </section>
  )
}

export default AccountLayout

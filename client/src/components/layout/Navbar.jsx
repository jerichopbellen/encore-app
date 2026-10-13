
import { Link, NavLink } from 'react-router'
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'

function Navbar() {
  const { user, isLoading, signOut } = useAuth()
  const [logoutError, setLogoutError] = useState('')

  async function handleLogout() {
    setLogoutError('')
    try {
      await signOut()
    } catch (error) {
      setLogoutError(error.message)
    }
  }

  return (
    <header className="navbar">
      <div className="navbar__inner">
        <Link to="/" className="navbar__brand">
          encore<span>.</span>
        </Link>

        <nav className="navbar__links" aria-label="Main navigation">
          <Link to="/">Discover</Link>
          {isLoading ? <span className="navbar__session">Checking session…</span> : user ? (
            <>
              <span className="navbar__session">Hi, {user.name}</span>
              <NavLink
                to="/profile"
                end
                className={({ isActive }) => isActive ? 'navbar__profile navbar__profile--active' : 'navbar__profile'}
              >
                My Profile
              </NavLink>
              <NavLink
                to="/reservations"
                end
                className={({ isActive }) => isActive ? 'navbar__reservations navbar__reservations--active' : 'navbar__reservations'}
              >
                My reservations
              </NavLink>
              <button className="navbar__logout" type="button" onClick={handleLogout}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link>
              <Link to="/register" className="navbar__signup">Sign up</Link>
            </>
          )}
        </nav>
      </div>
      {logoutError && <p className="navbar__error" role="alert">{logoutError}</p>}
    </header>
  )
}

export default Navbar

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useAuth } from '../../contexts/AuthContext'

function Navbar({ onMobileMenuLayoutChange }) {
  const { user, isLoading, signOut } = useAuth()
  const location = useLocation()
  const [logoutError, setLogoutError] = useState('')
  const [mobileMenuPath, setMobileMenuPath] = useState(null)
  const [dropdownState, setDropdownState] = useState({ path: null, name: null })
  const [isScrolled, setIsScrolled] = useState(false)
  const navigationRef = useRef(null)
  const mobileToggleRef = useRef(null)
  const dropdownTriggerRefs = useRef({})

  // Keying the open state to the route closes navigation on links and browser back/forward.
  const isMenuOpen = mobileMenuPath === location.pathname
  const openDropdown = dropdownState.path === location.pathname ? dropdownState.name : null
  const isAccountRoute = location.pathname === '/account' || location.pathname.startsWith('/account/')
  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/')

  useLayoutEffect(() => {
    if (!isMenuOpen || window.innerWidth > 720) {
      onMobileMenuLayoutChange({ isOpen: false, height: 0 })
      return undefined
    }

    const navigation = navigationRef.current
    const updateMenuHeight = () => {
      onMobileMenuLayoutChange({ isOpen: true, height: navigation?.offsetHeight || 0 })
    }
    const observer = new ResizeObserver(updateMenuHeight)
    if (navigation) observer.observe(navigation)
    updateMenuHeight()

    return () => {
      observer.disconnect()
      onMobileMenuLayoutChange({ isOpen: false, height: 0 })
    }
  }, [isMenuOpen, onMobileMenuLayoutChange])

  useEffect(() => {
    function updateScrollState() {
      const nextIsScrolled = window.scrollY > 24
      setIsScrolled((current) => current === nextIsScrolled ? current : nextIsScrolled)
    }

    updateScrollState()
    window.addEventListener('scroll', updateScrollState, { passive: true })
    return () => window.removeEventListener('scroll', updateScrollState)
  }, [])

  function closeNavigation() {
    setMobileMenuPath(null)
    setDropdownState({ path: null, name: null })
  }

  function toggleDropdown(name) {
    setDropdownState((current) => (
      current.path === location.pathname && current.name === name
        ? { path: null, name: null }
        : { path: location.pathname, name }
    ))
  }

  useEffect(() => {
    if (!isMenuOpen && !openDropdown) return undefined

    function handlePointerDown(event) {
      if (
        !navigationRef.current?.contains(event.target)
        && !mobileToggleRef.current?.contains(event.target)
      ) {
        setMobileMenuPath(null)
        setDropdownState({ path: null, name: null })
      }
    }

    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      if (openDropdown) {
        setDropdownState({ path: null, name: null })
        dropdownTriggerRefs.current[openDropdown]?.focus()
      } else {
        setMobileMenuPath(null)
        mobileToggleRef.current?.focus()
      }
    }

    function handleHistoryNavigation() {
      setMobileMenuPath(null)
      setDropdownState({ path: null, name: null })
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('popstate', handleHistoryNavigation)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('popstate', handleHistoryNavigation)
    }
  }, [isMenuOpen, openDropdown])

  async function handleLogout() {
    setLogoutError('')
    try {
      await signOut()
      closeNavigation()
    } catch (error) {
      setLogoutError(error.message)
    }
  }

  function dropdownTrigger(name, label) {
    const isOpen = openDropdown === name
    const isActiveRoute = name === 'account' ? isAccountRoute : isAdminRoute
    const menuId = `navbar-${name}-dropdown`
    return (
      <button
        ref={(element) => { dropdownTriggerRefs.current[name] = element }}
        className={`navbar__dropdown-trigger${isOpen || isActiveRoute ? ' navbar__dropdown-trigger--active' : ''}`}
        type="button"
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-haspopup="true"
        onClick={() => toggleDropdown(name)}
      >
        {label}<span className="navbar__chevron" aria-hidden="true">⌄</span>
      </button>
    )
  }

  return (
    <header className={`navbar${isScrolled ? ' navbar--scrolled' : ''}${isMenuOpen ? ' navbar--menu-open' : ''}`}>
      <div className="navbar__inner">
        <Link to="/" className="navbar__brand" onClick={closeNavigation}>
          encore<span>.</span>
        </Link>

        <button
          ref={mobileToggleRef}
          className="navbar__toggle"
          type="button"
          aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={isMenuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileMenuPath(isMenuOpen ? null : location.pathname)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>

        <nav
          ref={navigationRef}
          id="primary-navigation"
          className={`navbar__links${isMenuOpen ? ' navbar__links--open' : ''}`}
          aria-label="Main navigation"
        >
          <NavLink to="/" end onClick={closeNavigation}>Discover</NavLink>
          {isLoading ? <span className="navbar__session">Checking session…</span> : user ? (
            <>
              <div className="navbar__dropdown">
                {dropdownTrigger('account', 'My Account')}
                <div id="navbar-account-dropdown" className="navbar-dropdown" hidden={openDropdown !== 'account'}>
                  <NavLink to="/account/profile" onClick={closeNavigation}>Profile</NavLink>
                  <NavLink to="/account/reservations" onClick={closeNavigation}>Reservations</NavLink>
                  <NavLink to="/account/bookings" onClick={closeNavigation}>Bookings</NavLink>
                  <button type="button" onClick={handleLogout}>Log out</button>
                </div>
              </div>
              {user.role === 'admin' && (
                <div className="navbar__dropdown">
                  {dropdownTrigger('admin', 'Admin')}
                  <div id="navbar-admin-dropdown" className="navbar-dropdown" hidden={openDropdown !== 'admin'}>
                    <NavLink to="/admin" end onClick={closeNavigation}>Admin dashboard</NavLink>
                    <NavLink to="/admin/events" onClick={closeNavigation}>Admin events</NavLink>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <Link className="navbar__login" to="/login" onClick={closeNavigation}>Log in</Link>
              <Link className="navbar__register" to="/register" onClick={closeNavigation}>Register</Link>
            </>
          )}
        </nav>
      </div>
      {logoutError && <p className="navbar__error" role="alert">{logoutError}</p>}
    </header>
  )
}

export default Navbar

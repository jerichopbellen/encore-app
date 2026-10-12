
import { Link } from 'react-router'

function Navbar() {
  return (
    <header className="navbar">
      <div className="navbar__inner">
        <Link to="/" className="navbar__brand">
          encore<span>.</span>
        </Link>

        <nav className="navbar__links" aria-label="Main navigation">
          <Link to="/">Discover</Link>
          <Link to="/login">Log in</Link>
          <Link to="/register" className="navbar__signup">
            Sign up
          </Link>
        </nav>
      </div>
    </header>
  )
}

export default Navbar

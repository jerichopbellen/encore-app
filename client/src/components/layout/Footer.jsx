
import { Link } from 'react-router'

function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div>
          <Link to="/" className="footer__brand">
            encore<span>.</span>
          </Link>

          <p>
            Discover experiences worth remembering.
          </p>
        </div>

        <div className="footer__links">
          <Link to="/">Discover events</Link>
          <a href="mailto:hello@encore.example">Contact</a>
        </div>
      </div>

      <div className="footer__bottom">
        <p>© {new Date().getFullYear()} Encore. All rights reserved.</p>
        <p>Made for unforgettable experiences.</p>
      </div>
    </footer>
  )
}

export default Footer


import { Routes, Route, Navigate, useLocation } from 'react-router'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'
import EventList from './pages/events/EventList'
import EventDetails from './pages/events/EventDetails'
import AuthPage from './pages/auth/AuthPage'
import ProfilePage from './pages/profile/ProfilePage'
import ReservationsPage from './pages/reservations/ReservationsPage'
import CheckoutPage from './pages/checkout/CheckoutPage'
import BookingConfirmationPage from './pages/bookings/BookingConfirmationPage'
import BookingsPage from './pages/bookings/BookingsPage'
import AdminEventsPage from './pages/admin/AdminEventsPage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import AccountLayout from './pages/account/AccountLayout'
import './App.css'

function App() {
  const location = useLocation()
  const isDiscoverPage = location.pathname === '/'

  return (
    <div className="app">
      <div className={`app__primary${isDiscoverPage ? ' app__primary--discover' : ''}`}>
        <Navbar />

        <main className="app__content">
          <Routes>
            <Route path="/" element={<EventList />} />
            <Route path="/events/:id" element={<EventDetails />} />
            <Route path="/login" element={<AuthPage key="login" mode="login" />} />
            <Route path="/register" element={<AuthPage key="register" mode="register" />} />
            <Route path="/account" element={<AccountLayout />}>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<ProfilePage embedded />} />
              <Route path="reservations" element={<ReservationsPage embedded />} />
              <Route path="bookings" element={<BookingsPage embedded />} />
            </Route>
            <Route path="/profile" element={<Navigate to="/account/profile" replace />} />
            <Route path="/reservations" element={<Navigate to="/account/reservations" replace />} />
            <Route path="/reservations/:reservationId/checkout" element={<CheckoutPage />} />
            <Route path="/bookings" element={<Navigate to="/account/bookings" replace />} />
            <Route path="/bookings/:bookingId" element={<BookingConfirmationPage />} />
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/events" element={<AdminEventsPage />} />

            {/* Temporary fallback until we add more routes. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <Footer />
    </div>
  )
}

export default App

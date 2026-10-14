
import { Routes, Route, Navigate } from 'react-router'
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
import './App.css'

function App() {
  return (
    <div className="app">
      <Navbar />

      <main className="app__content">
        <Routes>
          <Route path="/" element={<EventList />} />
          <Route path="/events/:id" element={<EventDetails />} />
          <Route path="/login" element={<AuthPage key="login" mode="login" />} />
          <Route path="/register" element={<AuthPage key="register" mode="register" />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/reservations" element={<ReservationsPage />} />
          <Route path="/reservations/:reservationId/checkout" element={<CheckoutPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/bookings/:bookingId" element={<BookingConfirmationPage />} />

          {/* Temporary fallback until we add more routes. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer />
    </div>
  )
}

export default App

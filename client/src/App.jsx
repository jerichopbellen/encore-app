
import { useState } from 'react'
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
import AdminEventCreatePage from './pages/admin/AdminEventCreatePage'
import AdminEventManagePage from './pages/admin/AdminEventManagePage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import AdminRouteGuard from './components/admin/AdminRouteGuard'
import AccountLayout from './pages/account/AccountLayout'
import './App.css'

function App() {
  const location = useLocation()
  const isDiscoverPage = location.pathname === '/'
  const [mobileMenuLayout, setMobileMenuLayout] = useState({ isOpen: false, height: 0 })

  return (
    <div className="app">
      <div
        className={`app__primary${isDiscoverPage ? ' app__primary--discover' : ''}${mobileMenuLayout.isOpen ? ' app__primary--mobile-menu-open' : ''}`}
        style={mobileMenuLayout.isOpen ? { '--mobile-menu-height': `${mobileMenuLayout.height}px` } : undefined}
      >
        <Navbar onMobileMenuLayoutChange={setMobileMenuLayout} />

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
            <Route path="/admin/events" element={<AdminRouteGuard><AdminEventsPage /></AdminRouteGuard>} />
            <Route path="/admin/events/new" element={<AdminRouteGuard><AdminEventCreatePage /></AdminRouteGuard>} />
            <Route path="/admin/events/:eventId" element={<AdminRouteGuard><AdminEventManagePage /></AdminRouteGuard>} />

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

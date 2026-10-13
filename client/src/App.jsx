
import { Routes, Route, Navigate } from 'react-router'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'
import EventList from './pages/events/EventList'
import EventDetails from './pages/events/EventDetails'
import AuthPage from './pages/auth/AuthPage'
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

          {/* Temporary fallback until we add more routes. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer />
    </div>
  )
}

export default App


import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  NavLink,
  useLocation,
  useNavigate,
} from 'react-router'
import type { User } from '@supabase/supabase-js'

import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Apply from './pages/Apply'
import Practice from './pages/Practice'
import Track from './pages/Track'
import Signup from './pages/Signup'
import Login from './pages/Login'
import ProtectedRoute from './components/ProtectedRoute'
import { supabase } from './lib/supabase'

import './App.css'

function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const featurePages = ['/profile', '/apply', '/practice', '/track']
  const showFeatureNav = featurePages.some(path => location.pathname === path || location.pathname.startsWith(path + '/'))

  useEffect(() => {
    let active = true

    supabase.auth.getUser()
      .then(({ data, error }) => {
        if (!active) return

        if (!error) {
          setUser(data.user)
        }

        setAuthLoading(false)
      })
      .catch(() => {
        if (active) setAuthLoading(false)
      })

    const { data: { subscription } } =
      supabase.auth.onAuthStateChange((_event, session) => {
        if (active) {
          setUser(session?.user ?? null)
        }
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    setErrorMessage('')
    setLogoutLoading(true)

    const { error } = await supabase.auth.signOut()

    setLogoutLoading(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setUser(null)
    navigate('/', { replace: true })
  }

  return (
    <div className="app">
      <header className="site-header">
        <div className="header-top">
          <Link to="/" className="site-logo">
            💼 JobSeeker
          </Link>

          <div className="header-auth">
            {authLoading ? (
              <span className="auth-status">Loading...</span>
            ) : user ? (
              <>
                <span className="header-email">
                  {user.email}
                </span>
                <button
                  type="button"
                  className="header-text-button"
                  onClick={handleLogout}
                  disabled={logoutLoading}
                >
                  {logoutLoading ? 'Logging Out...' : 'Log Out'}
                </button>
              </>
            ) : (
              <>
                <Link to="/signup" className="header-text-link">
                  Sign Up
                </Link>
                <Link to="/login" className="header-text-link">
                  Log In
                </Link>
              </>
            )}
          </div>
        </div>

        {showFeatureNav && (
          <nav className="feature-nav">
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `feature-nav-link ${isActive ? 'active' : ''}`
              }
            >
              Profile
            </NavLink>

            <NavLink
              to="/apply"
              className={({ isActive }) =>
                `feature-nav-link ${isActive ? 'active' : ''}`
              }
            >
              Apply
            </NavLink>

            <NavLink
              to="/practice"
              className={({ isActive }) =>
                `feature-nav-link ${isActive ? 'active' : ''}`
              }
            >
              Practice
            </NavLink>

            <NavLink
              to="/track"
              className={({ isActive }) =>
                `feature-nav-link ${isActive ? 'active' : ''}`
              }
            >
              Track
            </NavLink>
          </nav>
        )}
      </header>

      {errorMessage && (
        <p className="header-error" role="alert">
          {errorMessage}
        </p>
      )}

      <main className="main">
        <Routes>
          {/* Public pages */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />

          {/* Protected pages */}
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />

          <Route
            path="/apply"
            element={
              <ProtectedRoute>
                <Apply />
              </ProtectedRoute>
            }
          />

          <Route
            path="/practice/*"
            element={
              <ProtectedRoute>
                <Practice />
              </ProtectedRoute>
            }
          />

          <Route
            path="/track/*"
            element={
              <ProtectedRoute>
                <Track />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}

export default App

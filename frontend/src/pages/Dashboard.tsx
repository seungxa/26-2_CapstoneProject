
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true

    supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return

      if (!error) {
        setUser(data.user)
      }

      setAuthLoading(false)
    }).catch(() => {
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
    navigate('/login', { replace: true })
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome to JobSeeker!</p>

      <div className="auth-buttons">
        {authLoading ? (
          <span>Checking login status...</span>
        ) : user ? (
          <>
            <span>{user.email}</span>
            <button
              type="button"
              className="logout-btn"
              onClick={handleLogout}
              disabled={logoutLoading}
            >
              {logoutLoading ? 'Logging Out...' : 'Log Out'}
            </button>
          </>
        ) : (
          <>
            <Link to="/signup" className="signup-btn">
              Sign Up
            </Link>
            <Link to="/login" className="login-btn">
              Log In
            </Link>
          </>
        )}
      </div>

      {errorMessage && <p role="alert">{errorMessage}</p>}

      <div className="dashboard-grid">
        <Link to="/profile" className="dashboard-card">
          <h2>👤 My Profile</h2>
          <p>Manage your personal information.</p>
        </Link>

        <Link to="/apply" className="dashboard-card">
          <h2>📝 Apply</h2>
          <p>Autofill your job applications.</p>
        </Link>

        <Link to="/practice" className="dashboard-card">
          <h2>🎤 Practice</h2>
          <p>Practice AI interviews.</p>
        </Link>

        <Link to="/track" className="dashboard-card">
          <h2>📊 Track</h2>
          <p>Manage your application history.</p>
        </Link>
      </div>
    </div>
  )
}

export default Dashboard

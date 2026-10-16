
import { BrowserRouter, Routes, Route, Link } from 'react-router'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Apply from './pages/Apply'
import Practice from './pages/Practice'
import Track from './pages/Track'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <Link to="/" className="logo">💼 JobSeeker</Link>

          <nav className="nav">
            <Link to="/">Dashboard</Link>
            <Link to="/profile">Profile</Link>
            <Link to="/apply">Apply</Link>
            <Link to="/practice">Practice</Link>
            <Link to="/track">Track</Link>
          </nav>
        </header>

        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/apply" element={<Apply />} />
            <Route path="/practice" element={<Practice />} />
            <Route path="/track" element={<Track />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App

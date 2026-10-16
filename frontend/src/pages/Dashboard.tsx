import { Link } from 'react-router'

function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome to JobSeeker!</p>

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
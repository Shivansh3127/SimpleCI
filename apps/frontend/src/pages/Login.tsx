const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export default function Login() {
  return (
    <>
      <nav className="navbar">
        <div className="navbar-logo">Simple<span style={{ color: 'var(--blue)' }}>CI</span></div>
      </nav>

      <div className="page" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <div className="card" style={{ maxWidth: 400, width: '100%', padding: 40, textAlign: 'center' }}>

          {/* Logo */}
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
            Simple<span style={{ color: 'var(--blue)' }}>CI</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: 32, fontSize: 14 }}>
            Self-hosted CI/CD for your GitHub repos
          </p>

          {/* GitHub login button */}
          <a
            href={`${API}/auth/github`}
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            10,
              background:     '#238636',
              color:          '#fff',
              padding:        '12px 24px',
              borderRadius:   8,
              fontWeight:     600,
              fontSize:       15,
              textDecoration: 'none',
              transition:     'background 0.15s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = '#2ea043')}
            onMouseOut={(e)  => (e.currentTarget.style.background = '#238636')}
          >
            <svg height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign in with GitHub
          </a>

          {/* Switch account link */}
          <div style={{ marginTop: 16 }}>
            <a
              href={`${API}/auth/github/switch`}
              style={{
                display:        'inline-block',
                fontSize:       13,
                color:          'var(--text-muted)',
                textDecoration: 'none',
                padding:        '8px 16px',
                borderRadius:   6,
                border:         '1px solid var(--border)',
                transition:     'color 0.15s, border-color 0.15s',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = 'var(--text)';
                e.currentTarget.style.borderColor = 'var(--text-muted)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              🔄 Use a different GitHub account
            </a>
          </div>

          <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
            SimpleCI uses GitHub OAuth — no passwords stored.
          </p>
        </div>
      </div>
    </>
  );
}

import { useState } from 'react';
import { api, setToken } from '../api';
import { Banner, Field } from '../components/ui';

/**
 * The front door. An email and a password; what is behind it depends
 * on who signed in, and that is decided by the server, not here.
 */
export default function Login({ onSignedIn, ended }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/auth/login', { email: email.trim(), password });
      setToken(r.token);
      onSignedIn(r);
    } catch (err) {
      setError(err.status === 401 ? 'Wrong email or password'
        : err.status ? err.message : `Can't reach the API. Is it running on :4000? (${err.message})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="mark">AJ</div>
          <div>
            <b>AJ Power</b>
            <span>Solutions ERP</span>
          </div>
        </div>
        <h1>Sign in</h1>
        <p className="login-sub">Use the email your Management team set up for you.</p>

        {ended && !error && (
          <Banner kind="info" icon="i">Your session ended. Sign in again to carry on.</Banner>
        )}
        {error && <Banner kind="bad" icon="!">{error}</Banner>}

        <Field label="Email">
          <input className="inp" type="email" autoComplete="username" autoFocus required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="inp" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn pri login-go" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="login-foot">Forgotten your password? Ask Management to reset it.</p>
      </form>
    </div>
  );
}

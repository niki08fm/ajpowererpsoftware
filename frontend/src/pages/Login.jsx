import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setUserId, setDept, getUserId, getDept } from '../api';
import { useApi, Loading, ErrorNote } from '../components/ui';

const DEPT_ROUTE = {
  Planning: '/planning',
  Site: '/site',
  Store: '/store',
  Procurement: '/procure',
  Management: '/reports',
  Billing: '/billing',
};

export default function Login() {
  const nav = useNavigate();
  const { data: users, error, loading } = useApi('/users');

  // If already logged in, bounce to their department
  useEffect(() => {
    const id = getUserId();
    const d = getDept();
    if (id && d && DEPT_ROUTE[d]) nav(DEPT_ROUTE[d], { replace: true });
  }, [nav]);

  const pick = (user) => {
    setUserId(user.id);
    setDept(user.department);
    nav(DEPT_ROUTE[user.department] || '/store', { replace: true });
  };

  if (loading) return (
    <div className="login-page"><Loading /></div>
  );
  if (error) return (
    <div className="login-page">
      <div className="login-box">
        <ErrorNote error={{ message: `Can't reach the API. Is it running on :4000? (${error.message})` }}
          onRetry={() => window.location.reload()} />
      </div>
    </div>
  );

  const byDept = (users || []).reduce((acc, u) => {
    (acc[u.department] = acc[u.department] || []).push(u);
    return acc;
  }, {});

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-brand">
          <span className="mark" style={{ fontSize: 28, width: 52, height: 52, lineHeight: '52px' }}>AJ</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--ink)' }}>AJ Power Solutions</div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Select your profile to continue</div>
          </div>
        </div>

        {Object.entries(byDept).map(([dept, members]) => (
          <div key={dept} className="login-dept">
            <div className="login-dept-label">{dept}</div>
            <div className="login-user-grid">
              {members.map((u) => (
                <button key={u.id} className="login-user-card" onClick={() => pick(u)}>
                  <div className="login-avatar">{u.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
                  <div className="login-user-name">{u.name}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

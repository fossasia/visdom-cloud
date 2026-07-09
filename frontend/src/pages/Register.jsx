/* Copyright 2017-present, The Visdom Authors */
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Register = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  const { register, login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register(email, password);
      setSuccess('Account created! Logging you in...');
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail;
      let errorMsg = 'Registration failed. Please try again.';
      if (typeof detail === 'string') {
        errorMsg = detail;
      } else if (Array.isArray(detail)) {
        errorMsg = detail.map(d => {
          if (d.msg === 'String should have at least 6 characters') {
            return 'Password should have atleast 6 characters';
          }
          return d.msg;
        }).join(', ');
      }
      setError(errorMsg);
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="visdom-panel auth-panel">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h2 className="visdom-logo" style={{ fontSize: '24px', margin: '0 0 4px 0' }}>
            visdom
          </h2>
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Create your user account</div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(217, 83, 79, 0.1)',
            border: '1px solid var(--danger-bg)',
            borderRadius: '2px',
            padding: '10px',
            color: 'var(--danger-bg)',
            fontSize: '13px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            background: 'rgba(92, 184, 92, 0.1)',
            border: '1px solid var(--success-bg)',
            borderRadius: '2px',
            padding: '10px',
            color: 'var(--success-bg)',
            fontSize: '13px',
            marginBottom: '16px'
          }}>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Email Address
            </label>
            <input
              type="email"
              required
              className="visdom-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              required
              className="visdom-input"
              placeholder="Minimum 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Confirm Password
            </label>
            <input
              type="password"
              required
              className="visdom-input"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button type="submit" disabled={submitting} className="visdom-btn" style={{
            width: '100%',
            height: '32px',
            backgroundColor: '#3b5998',
            color: '#ffffff',
            borderColor: '#2f477a',
            marginTop: '6px'
          }}>
            {submitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#3b5998', textDecoration: 'none', fontWeight: '600' }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;

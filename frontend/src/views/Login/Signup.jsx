import React, { useState } from 'react';
import { Mail, Lock, User } from 'lucide-react';
import './Signup.css';

export default function Signup({ onSwitchToLogin, onRegisterSuccess }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const getPasswordStrength = (pwd) => {
    if (!pwd) return { score: 0, label: '', color: 'transparent', width: '0%' };
    if (pwd.length < 6) return { score: 1, label: 'Weak', color: '#ef4444', width: '33%' };
    
    let met = 0;
    if (/[a-z]/.test(pwd)) met++;
    if (/[A-Z]/.test(pwd)) met++;
    if (/[0-9]/.test(pwd)) met++;
    if (/[^a-zA-Z0-9]/.test(pwd)) met++;
    
    if (pwd.length >= 8 && met >= 3) {
      return { score: 3, label: 'Strong', color: '#10b981', width: '100%' };
    }
    if (met >= 2) {
      return { score: 2, label: 'Good', color: '#f59e0b', width: '66%' };
    }
    return { score: 1, label: 'Weak', color: '#ef4444', width: '33%' };
  };

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    // NOTE: Real password strength policy and complexity validation are enforced on the backend side.
    if (strength.score < 2) {
      setError('Please use a stronger password (at least Good).');
      return;
    }

    setLoading(true);

    try {
      // TODO: migrate to apiFetch
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Registration failed');
      }

      onRegisterSuccess();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-card">
      <div className="login-header" style={{ marginBottom: '20px' }}>
        <img src="/code_lens_logo_light.svg" alt="Code Lens Logo" className="theme-logo signup-logo-img" style={{ width: '180px', height: '80px', objectFit: 'contain', marginBottom: '4px', marginTop: '0px' }} />
        <h1 style={{ marginTop: '0px' }}>Create Account</h1>
        <p className="subtitle">Join Code Lens Git Analyzer</p>
      </div>

      {error && (
        <div className="auth-alert alert-error">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="login-form">
        <div className="form-group">
          <label className="form-label">Username</label>
          <div className="input-icon-wrapper">
            <User size={18} className="input-icon" />
            <input 
              type="text" 
              className="input-field icon-pad" 
              placeholder="Username" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Email Address</label>
          <div className="input-icon-wrapper">
            <Mail size={18} className="input-icon" />
            <input 
              type="email" 
              className="input-field icon-pad" 
              placeholder="Email address" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Password</label>
          <div className="input-icon-wrapper">
            <Lock size={18} className="input-icon" />
            <input 
              type="password" 
              className="input-field icon-pad" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </div>

        {password && (
          <div style={{ marginTop: '8px', textAlign: 'left', marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Password Strength:</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: strength.color }}>{strength.label}</span>
            </div>
            <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ width: strength.width, height: '100%', backgroundColor: strength.color, transition: 'all 0.3s ease' }}></div>
            </div>
          </div>
        )}

        <div className="form-group" style={{ marginTop: '12px' }}>
          <label className="form-label">Re-enter Password</label>
          <div className="input-icon-wrapper">
            <Lock size={18} className="input-icon" />
            <input 
              type="password" 
              className="input-field icon-pad" 
              placeholder="Re-enter password" 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary login-submit" style={{ marginTop: '16px' }} disabled={loading}>
          {loading ? 'Please wait...' : 'Register'}
        </button>
      </form>

      <div className="auth-toggle">
        <button 
          type="button" 
          className="toggle-link"
          onClick={onSwitchToLogin}
        >
          Already have an account? Sign In
        </button>
      </div>
    </div>
  );
}

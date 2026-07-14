import React, { useState } from 'react';
import { Mail, Lock } from 'lucide-react';
import Signup from './Signup';
import './Login.css';

export default function Login({ onLoginSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Authentication failed');
      }

      localStorage.setItem('token', data.access_token);
      
      const meRes = await fetch('/api/v1/users/me', {
        headers: {
          'Authorization': `Bearer ${data.access_token}`
        }
      });
      const meData = await meRes.json();
      
      onLoginSuccess(meData);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {isRegister ? (
        <Signup 
          onSwitchToLogin={() => {
            setIsRegister(false);
            setError('');
          }} 
          onRegisterSuccess={() => {
            setIsRegister(false);
            setError('Registration successful! Please login.');
          }}
        />
      ) : (
        <div className="login-card">
          <div className="login-header" style={{ marginBottom: '20px' }}>
            <img src="/code_lens_logo_light.svg" alt="Code Lens Logo" className="theme-logo login-logo-img" style={{ width: '180px', height: '80px', objectFit: 'contain', marginBottom: '4px', marginTop: '0px' }} />
            <h1 style={{ marginTop: '0px' }}>Welcome Back</h1>
            <p className="subtitle">Sign in to access your projects</p>
          </div>

          {error && (
            <div className={`auth-alert ${error.includes('successful') ? 'alert-success' : 'alert-error'}`}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
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

            <button type="submit" className="btn btn-primary login-submit" style={{ marginTop: '16px' }} disabled={loading}>
              {loading ? 'Please wait...' : 'Login'}
            </button>
          </form>

          <div className="auth-toggle">
            <button 
              type="button" 
              className="toggle-link"
              onClick={() => {
                setIsRegister(true);
                setError('');
              }}
            >
              Don't have an account? Register
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

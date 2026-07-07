import React, { useState } from 'react';
import { Mail, Lock, User, ShieldCheck } from 'lucide-react';
import './Login.css';

export default function Login({ onLoginSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
    const payload = isRegister 
      ? { username, email, password }
      : { email, password };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Authentication failed');
      }

      if (isRegister) {
        // Automatically switch to login or log them in after registration
        setIsRegister(false);
        setError('Registration successful! Please login.');
      } else {
        // Login success: save token and user info
        localStorage.setItem('token', data.access_token);
        
        // Fetch current user details
        const meRes = await fetch('/api/v1/users/me', {
          headers: {
            'Authorization': `Bearer ${data.access_token}`
          }
        });
        const meData = await meRes.json();
        
        onLoginSuccess(meData);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/code_lens_logo.svg" alt="Code Lens Logo" style={{ width: '72px', height: '72px', objectFit: 'contain', marginBottom: '16px' }} />
          <h1>{isRegister ? 'Create Account' : 'Welcome Back'}</h1>
          <p className="subtitle">
            {isRegister 
              ? 'Join Code Lens Git Analyzer' 
              : 'Sign in to access your dashboard'}
          </p>
        </div>

        {error && (
          <div className={`auth-alert ${error.includes('successful') ? 'alert-success' : 'alert-error'}`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          {isRegister && (
            <div className="form-group">
              <label className="form-label">Username</label>
              <div className="input-icon-wrapper">
                <User size={18} className="input-icon" />
                <input 
                  type="text" 
                  className="input-field icon-pad" 
                  placeholder="Enter username" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="input-icon-wrapper">
              <Mail size={18} className="input-icon" />
              <input 
                type="email" 
                className="input-field icon-pad" 
                placeholder="Enter email address" 
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
                placeholder="Enter password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
            {loading ? 'Please wait...' : (isRegister ? 'Register' : 'Login')}
          </button>
        </form>

        <div className="auth-toggle">
          <button 
            type="button" 
            className="toggle-link"
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
            }}
          >
            {isRegister 
              ? 'Already have an account? Sign In' 
              : "Don't have an account? Register"}
          </button>
        </div>
      </div>
    </div>
  );
}

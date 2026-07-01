import React, { useState } from 'react';
import { Database, AlertTriangle, ShieldCheck, Save, Settings as SettingsIcon } from 'lucide-react';
import './Settings.css';

export default function Settings() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleResetDB = async () => {
    if (!window.confirm('WARNING: This will delete all course history, projects, and author details from the database. Are you sure?')) {
      return;
    }

    setLoading(true);
    setMessage('');
    setError('');

    const token = localStorage.getItem('token');
    
    // Mock check
    if (token === 'mock-jwt-token') {
      setTimeout(() => {
        setLoading(false);
        setMessage('Mock database reset completed successfully.');
      }, 1000);
      return;
    }

    try {
      const response = await fetch('/api/v1/system/reset', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Reset failed');
      }

      setMessage(data.message || 'Database reset completed successfully.');
    } catch (err) {
      setError(err.message || 'Database connection error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="settings-view">
      <div className="view-header">
        <div>
          <h1>System Settings</h1>
          <p className="subtitle">Configure database targets, extraction parameters, and security policies.</p>
        </div>
      </div>

      {message && <div className="settings-alert alert-success">{message}</div>}
      {error && <div className="settings-alert alert-error">{error}</div>}

      <div className="settings-container-grid">
        {/* Extraction Parameters Card */}
        <div className="settings-card card">
          <div className="card-title-row">
            <SettingsIcon size={18} className="blue-text" />
            <h2>Extraction Parameters</h2>
          </div>
          <div className="card-body-form">
            <div className="form-group">
              <label className="form-label">Squash Suspect Limit (Insertions)</label>
              <input type="number" className="input-field" defaultValue={500} />
            </div>
            <div className="form-group checkbox-group">
              <input type="checkbox" id="no-merge" defaultChecked />
              <label htmlFor="no-merge">Filter Out Git Merge Commits (only_no_merge=True)</label>
            </div>
            <div className="form-group checkbox-group">
              <input type="checkbox" id="co-authored" defaultChecked />
              <label htmlFor="co-authored">Flag Co-authored commits as squash suspected</label>
            </div>
            <button className="btn btn-primary" onClick={() => alert('Settings saved!')}>
              <Save size={16} />
              <span>Save Parameters</span>
            </button>
          </div>
        </div>

        {/* Database Control Card */}
        <div className="settings-card card danger-border">
          <div className="card-title-row">
            <Database size={18} className="red-text" />
            <h2>Database Maintenance</h2>
          </div>
          <div className="card-body-form">
            <p className="danger-notice">
              Resetting the database clears all courses, project files, extracted commits, authors, and AST metric caches.
              The schemas and tables will remain intact, but all data rows will be truncated.
            </p>
            <button 
              className="btn btn-danger" 
              onClick={handleResetDB} 
              disabled={loading}
            >
              <AlertTriangle size={16} />
              <span>{loading ? 'Truncating tables...' : 'Reset System Database'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

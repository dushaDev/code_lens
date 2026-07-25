import React, { useState } from 'react';
import { Database, AlertTriangle, ShieldCheck, Save, Trash2, RotateCcw, Settings as SettingsIcon } from 'lucide-react';
import './Settings.css';

export default function Settings({ course, onCourseReset, onCourseDeleted }) {
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  const handleResetCourse = async (e) => {
    e.preventDefault();
    if (!password) return;

    if (!window.confirm(`WARNING: This will permanently delete all projects and git metrics under "${course?.name}". Are you sure?`)) {
      return;
    }

    setLoading(true);
    setMessage('');
    setError('');

    const token = localStorage.getItem('token');

    try {
      const response = await fetch(`/api/v1/courses/${course.id}/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          password: password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to verify password.');
      }

      setMessage(`Projects and Git history for "${course?.name}" cleared successfully.`);
      setPassword('');
      if (onCourseReset) onCourseReset();
    } catch (err) {
      setError(err.message || 'Database connection error.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCourse = async (e) => {
    e.preventDefault();
    if (!deletePassword) return;

    if (!window.confirm(`CRITICAL WARNING: This will permanently delete the course "${course?.name}" and ALL projects and git data belonging to it. This action is irreversible. Are you sure?`)) {
      return;
    }

    setDeleteLoading(true);
    setMessage('');
    setError('');

    const token = localStorage.getItem('token');

    try {
      const response = await fetch(`/api/v1/courses/${course.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          password: deletePassword
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to verify password.');
      }

      alert(`Course "${course?.name}" has been permanently deleted.`);
      setDeletePassword('');
      if (onCourseDeleted) onCourseDeleted();
    } catch (err) {
      setError(err.message || 'Database connection error.');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="settings-view">
      <div className="view-header">
        <div>
          <h1>Course Settings</h1>
          <p className="subtitle">Configure parsing parameters and maintain repository data for {course?.name}.</p>
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
            <button className="btn btn-primary btn-sm settings-action-btn" onClick={() => alert('Settings saved!')}>
              <Save size={16} />
              <span>Save Parameters</span>
            </button>
          </div>
        </div>

        {/* Course Database Control Card */}
        <div className="settings-card card danger-border">
          <div className="card-title-row">
            <RotateCcw size={18} className="red-text" />
            <h2>Clear Course Data</h2>
          </div>
          <form onSubmit={handleResetCourse} className="card-body-form">
            <p className="danger-notice">
              Resetting course data permanently deletes all projects, extracted commit logs, and student metrics under <strong>"{course?.name}"</strong>.
            </p>
            
            <div className="form-group">
              <label className="form-label">Verify Instructor Password</label>
              <input 
                type="password" 
                className="input-field" 
                placeholder="Enter password to clear data" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-danger btn-sm settings-action-btn" 
              disabled={loading}
              style={{ alignSelf: 'flex-start' }}
            >
              <RotateCcw size={16} />
              <span>{loading ? 'Clearing data...' : 'Clear Course Data'}</span>
            </button>
          </form>
        </div>

        {/* Delete Course Card */}
        <div className="settings-card card danger-border">
          <div className="card-title-row">
            <Trash2 size={18} className="red-text" />
            <h2>Delete Course</h2>
          </div>
          <form onSubmit={handleDeleteCourse} className="card-body-form">
            <p className="danger-notice">
              Deleting this course permanently removes <strong>"{course?.name}"</strong> and all related projects, commit history, and student metrics. This action cannot be undone.
            </p>
            
            <div className="form-group">
              <label className="form-label">Verify Instructor Password</label>
              <input 
                type="password" 
                className="input-field" 
                placeholder="Enter password to delete course" 
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                required
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-danger btn-sm settings-action-btn" 
              disabled={deleteLoading}
              style={{ alignSelf: 'flex-start' }}
            >
              <Trash2 size={16} />
              <span>{deleteLoading ? 'Deleting...' : 'Delete Course'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

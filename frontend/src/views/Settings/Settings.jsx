import React, { useState, useEffect, useRef } from 'react';
import { useNotification } from '../../contexts/NotificationContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { Database, AlertTriangle, ShieldCheck, Save, Trash2, RotateCcw, Settings as SettingsIcon, BookOpen, Calendar, Key, Lock, CheckCircle2, Plus, Check } from 'lucide-react';
import { buildDeadline, splitDeadline } from '../../utils/courseMeta';
import './Settings.css';

export default function Settings({ course, onCourseReset, onCourseDeleted, onCourseUpdated }) {
  const { addNotification } = useNotification();
  const { pendingSection, consumeSection } = useNavigation();
  const apiKeysRef = useRef(null);
  const [highlightApiKeys, setHighlightApiKeys] = useState(false);

  // Deep-link support: when navigated here via navigate({ section: 'api-keys' })
  // (e.g. the "Go to Settings" button on the Cloud AI report), scroll the
  // API-keys card into view and briefly highlight it, then clear the section
  // so it only fires once.
  useEffect(() => {
    if (pendingSection !== 'api-keys') return;
    const el = apiKeysRef.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightApiKeys(true);
      window.setTimeout(() => setHighlightApiKeys(false), 2200);
    }
    consumeSection();
  }, [pendingSection, consumeSection]);

  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  // ── Editable course metadata ──────────────────────────────────────────────
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [techRequirements, setTechRequirements] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [defaultSamplingMode, setDefaultSamplingMode] = useState('sample');

  // ── User API Keys (Multi-Key Management) ──────────────────────────────────
  const [apiKeys, setApiKeys] = useState([]);
  const [keyName, setKeyName] = useState('');
  const [keyProvider, setKeyProvider] = useState('Gemini');
  const [keyValue, setKeyValue] = useState('');
  const [apiKeysLoading, setApiKeysLoading] = useState(false);

  const fetchApiKeys = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      // TODO: migrate to apiFetch
      const res = await fetch('/api/v1/user/api-keys', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data);
      }
    } catch (err) {
      console.error('Failed to fetch user API keys', err);
    }
  };

  useEffect(() => {
    fetchApiKeys();
  }, []);

  // Re-seed the form whenever a different course is opened
  useEffect(() => {
    if (!course) return;
    const { date, time } = splitDeadline(course.deadline);
    setName(course.name || '');
    setDescription(course.description || '');
    setTechRequirements(course.tech_requirements || '');
    setDeadlineDate(date);
    setDeadlineTime(time || '00:00');
    setDefaultSamplingMode(course.default_sampling_mode || 'sample');
  }, [course?.id, course?.deadline, course?.tech_requirements, course?.name, course?.description, course?.default_sampling_mode]);

  const handleCreateApiKey = async (e) => {
    e.preventDefault();
    if (!keyName.trim() || !keyValue.trim()) return;

    setApiKeysLoading(true);
    setMessage('');
    setError('');

    const token = localStorage.getItem('token');
    try {
      // TODO: migrate to apiFetch
      const response = await fetch('/api/v1/user/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: keyName.trim(),
          provider: keyProvider,
          api_key: keyValue.trim()
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to save API key.');
      }
      setKeyName('');
      setKeyValue('');
      fetchApiKeys();
      addNotification({ type: 'success', title: 'API Key Saved', description: `Key "${data.name}" encrypted and saved successfully.` });
    } catch (err) {
      setError(err.message || 'Error saving API key.');
    } finally {
      setApiKeysLoading(false);
    }
  };

  const handleActivateApiKey = async (keyId) => {
    setApiKeysLoading(true);
    const token = localStorage.getItem('token');
    try {
      // TODO: migrate to apiFetch
      const response = await fetch(`/api/v1/user/api-keys/${keyId}/activate`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        throw new Error('Failed to activate API key.');
      }
      fetchApiKeys();
      addNotification({ type: 'success', title: 'Active Key Updated', description: 'Selected API key is now active.' });
    } catch (err) {
      setError(err.message);
    } finally {
      setApiKeysLoading(false);
    }
  };

  const handleDeleteApiKey = async (keyId, name) => {
    if (!window.confirm(`Delete API key "${name}"?`)) return;
    setApiKeysLoading(true);
    const token = localStorage.getItem('token');
    try {
      // TODO: migrate to apiFetch
      const response = await fetch(`/api/v1/user/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        throw new Error('Failed to delete API key.');
      }
      fetchApiKeys();
      addNotification({ type: 'info', title: 'API Key Deleted', description: `API Key "${name}" removed.` });
    } catch (err) {
      setError(err.message);
    } finally {
      setApiKeysLoading(false);
    }
  };

  const handleSaveDetails = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Course name cannot be empty.');
      return;
    }

    setDetailsLoading(true);
    setMessage('');
    setError('');

    const token = localStorage.getItem('token');

    try {
      // TODO: migrate to apiFetch
      const response = await fetch(`/api/v1/courses/${course.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          tech_requirements: techRequirements.trim() || null,
          deadline: buildDeadline(deadlineDate, deadlineTime),
          default_sampling_mode: defaultSamplingMode
        })
      });

      const data = await response.json();
      if (!response.ok) {
        let errorMsg = 'Failed to update course details.';
        if (data && data.detail) {
          if (Array.isArray(data.detail)) {
            errorMsg = data.detail.map(e => e.msg).join(', ');
          } else if (typeof data.detail === 'string') {
            errorMsg = data.detail;
          }
        }
        throw new Error(errorMsg);
      }

      addNotification({ type: 'success', title: 'Course Updated', description: 'Course details saved successfully.' });
      if (onCourseUpdated) onCourseUpdated(data);
    } catch (err) {
      setError(err.message || 'Database connection error.');
    } finally {
      setDetailsLoading(false);
    }
  };

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
      // TODO: migrate to apiFetch
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
        let errorMsg = 'Failed to verify password.';
        if (data && data.detail) {
          if (Array.isArray(data.detail)) {
            errorMsg = data.detail.map(e => e.msg).join(', ');
          } else if (typeof data.detail === 'string') {
            errorMsg = data.detail;
          }
        }
        throw new Error(errorMsg);
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
      // TODO: migrate to apiFetch
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
        let errorMsg = 'Failed to verify password.';
        if (data && data.detail) {
          if (Array.isArray(data.detail)) {
            errorMsg = data.detail.map(e => e.msg).join(', ');
          } else if (typeof data.detail === 'string') {
            errorMsg = data.detail;
          }
        }
        throw new Error(errorMsg);
      }

      addNotification({ type: 'success', title: 'Course Deleted', description: `Course "${course?.name}" has been permanently deleted.` });
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
        {/* Course Details Card */}
        <div className="settings-card card">
          <div className="card-title-row">
            <BookOpen size={18} className="blue-text" />
            <h2>Course Details</h2>
          </div>
          <form className="card-body-form" onSubmit={handleSaveDetails}>
            <div className="form-group">
              <label className="form-label" htmlFor="course-name">Course Name</label>
              <input
                id="course-name"
                type="text"
                className="input-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="course-description">Description</label>
              <textarea
                id="course-description"
                className="input-field settings-textarea"
                placeholder="What this course covers and how groups are assessed."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="course-tech">Languages &amp; Frameworks</label>
              <textarea
                id="course-tech"
                className="input-field settings-textarea"
                placeholder="e.g. Python 3.12 with FastAPI backend, React frontend, PostgreSQL"
                value={techRequirements}
                onChange={(e) => setTechRequirements(e.target.value)}
              />
              <span className="settings-hint">Expected tech stack. Included as context in the final report.</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="course-deadline-date">Submission Deadline</label>
              <div className="settings-deadline-inputs">
                <input
                  id="course-deadline-date"
                  type="date"
                  className="input-field"
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-today"
                  onClick={() => {
                    const d = new Date();
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    setDeadlineDate(`${year}-${month}-${day}`);
                  }}
                  title="Set deadline date to Today"
                >
                  <Calendar size={14} />
                  <span>Today</span>
                </button>
                <input
                  type="time"
                  className="input-field"
                  aria-label="Deadline time"
                  value={deadlineTime || '00:00'}
                  onChange={(e) => setDeadlineTime(e.target.value || '00:00')}
                  disabled={!deadlineDate}
                />
              </div>
              <span className="settings-hint">
                Blank time means midnight (00:00). Clear the date to remove the deadline.
              </span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="course-default-sampling-mode">Default Qualitative Sampling Mode</label>
              <select
                id="course-default-sampling-mode"
                className="input-field"
                value={defaultSamplingMode}
                onChange={(e) => setDefaultSamplingMode(e.target.value)}
              >
                <option value="sample">Smart (Stratified Sampling)</option>
                <option value="full">Full (Process All Commits)</option>
                <option value="random">Random (Random 20% Sampling)</option>
              </select>
              <span className="settings-hint">
                The default mode loaded for new projects and qualitative scan sessions.
              </span>
            </div>
            <button type="submit" className="btn btn-primary btn-sm settings-action-btn" disabled={detailsLoading}>
              <Save size={16} />
              <span>{detailsLoading ? 'Saving...' : 'Save Details'}</span>
            </button>
          </form>
        </div>

        {/* User API Keys Management Card */}
        <div
          ref={apiKeysRef}
          id="settings-api-keys"
          className="settings-card card"
          style={{
            scrollMarginTop: '80px',
            boxShadow: highlightApiKeys ? '0 0 0 2px #f59e0b' : 'none',
            transition: 'box-shadow 0.3s ease',
          }}
        >
          <div className="card-title-row">
            <Key size={18} className="blue-text" />
            <h2>Cloud AI API Keys (User Account)</h2>
          </div>
          <div className="card-body-form">
            <p className="settings-hint" style={{ marginTop: 0, marginBottom: '14px' }}>
              Manage your Cloud AI models API keys. Select which key is active for generating qualitative reports.
            </p>

            {/* List of Keys */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {apiKeys.length === 0 ? (
                <div style={{ padding: '12px 16px', borderRadius: '6px', backgroundColor: 'var(--bg-app)', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                  No API keys saved yet. Add a key below to enable Cloud AI reports.
                </div>
              ) : (
                apiKeys.map((k) => (
                  <div
                    key={k.id}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '6px',
                      backgroundColor: k.is_active ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-app)',
                      border: `1px solid ${k.is_active ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {k.is_active ? (
                        <CheckCircle2 size={18} color="#10b981" />
                      ) : (
                        <Lock size={18} style={{ color: 'var(--text-muted)' }} />
                      )}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)' }}>{k.name}</span>
                          <span style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                            {k.provider}
                          </span>
                          {k.is_active && (
                            <span style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#10b981', color: '#fff', fontWeight: '600' }}>
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>
                          {k.masked_key}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {!k.is_active && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => handleActivateApiKey(k.id)}
                          disabled={apiKeysLoading}
                          style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                        >
                          <Check size={13} />
                          <span>Activate</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleDeleteApiKey(k.id, k.name)}
                        disabled={apiKeysLoading}
                        style={{ padding: '4px 8px', fontSize: '0.78rem', borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }}
                        title="Delete key"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add New Key Form */}
            <div style={{ paddingTop: '14px', borderTop: '1px solid var(--border-color)' }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: '10px', fontWeight: '600' }}>Add New API Key</h3>
              <form onSubmit={handleCreateApiKey} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="form-label">Name</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Gemini key 1"
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ width: '130px', marginBottom: 0 }}>
                    <label className="form-label">Provider</label>
                    <select
                      className="input-field"
                      value={keyProvider}
                      onChange={(e) => setKeyProvider(e.target.value)}
                    >
                      <option value="Gemini">Gemini</option>
                      <option value="AgentRouter">AgentRouter</option>
                      <option value="OpenAI">OpenAI</option>
                      <option value="Claude">Claude</option>
                    </select>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Key</label>
                  <input
                    type="password"
                    className="input-field"
                    placeholder="sk**********************tXq"
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    autoComplete="off"
                    style={{ fontFamily: 'monospace' }}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-sm settings-action-btn"
                  disabled={apiKeysLoading || !keyName.trim() || !keyValue.trim()}
                  style={{ alignSelf: 'flex-start', marginTop: '6px' }}
                >
                  <Plus size={15} />
                  <span>{apiKeysLoading ? 'Encrypting & Saving...' : 'Add API Key'}</span>
                </button>
              </form>
            </div>
          </div>
        </div>

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
            <button className="btn btn-primary btn-sm settings-action-btn" onClick={() => addNotification({ type: 'success', title: 'Settings Saved', description: 'Parameters have been updated successfully.' })}>
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
              Resetting course data permanently deletes all projects, extracted commit logs, and student metrics under <strong>&quot;{course?.name}&quot;</strong>.
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
              Deleting this course permanently removes <strong>&quot;{course?.name}&quot;</strong> and all related projects, commit history, and student metrics. This action cannot be undone.
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

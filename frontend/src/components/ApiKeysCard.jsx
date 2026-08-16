import React, { useState, useEffect } from 'react';
import { Key, CheckCircle2, Lock, Plus, Check, Trash2 } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { fetchApiKeys, createApiKey, activateApiKey, deleteApiKey } from '../utils/apiKeys';

export default function ApiKeysCard() {
  const { addNotification } = useNotification();
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyProvider, setKeyProvider] = useState('Gemini');
  const [keyValue, setKeyValue] = useState('');

  const loadKeys = async () => {
    try {
      const keys = await fetchApiKeys();
      setApiKeys(keys);
    } catch (err) {
      addNotification({ type: 'error', title: 'Failed to load API keys', description: err.message });
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleActivate = async (id) => {
    setLoading(true);
    try {
      await activateApiKey(id);
      addNotification({ type: 'success', title: 'API key activated' });
      await loadKeys();
    } catch (err) {
      addNotification({ type: 'error', title: 'Activation failed', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete API key "${name}"? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await deleteApiKey(id);
      addNotification({ type: 'success', title: 'API key deleted' });
      await loadKeys();
    } catch (err) {
      addNotification({ type: 'error', title: 'Delete failed', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      await createApiKey({ name: keyName, provider: keyProvider, value: keyValue });
      addNotification({ type: 'success', title: 'API key added' });
      setKeyName('');
      setKeyProvider('Gemini');
      setKeyValue('');
      await loadKeys();
    } catch (err) {
      addNotification({ type: 'error', title: 'Add key failed', description: err.message });
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="settings-card" style={{ marginTop: '24px', border: 'none', boxShadow: 'none' }}>
  
      <div className="card-body-form">
        <p className="settings-hint" style={{ marginTop: 0, marginBottom: '14px' }}>
          Manage the API keys used to generate Cloud AI qualitative reports. Activate the key you want used by default.
        </p>
        {/* List of Keys */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {apiKeys.length === 0 ? (
            <div style={{ padding: '12px 16px', borderRadius: '6px', backgroundColor: 'var(--bg-app)', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
              No API keys saved yet. Add a key below to enable Cloud AI reports.
            </div>
          ) : (
            apiKeys.map((k) => (
              <div key={k.id} style={{
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: k.is_active ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-app)',
                border: `1px solid ${k.is_active ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {k.is_active ? (
                    <CheckCircle2 size={18} color="#10b981" />
                  ) : (
                    <Lock size={18} style={{ color: 'var(--text-muted)' }} />
                  )}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)' }}>{k.name}</span>
                      <span style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--border-color)', color: 'var(--text-muted)' }}>{k.provider}</span>
                      {k.is_active && (
                        <span style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#10b981', color: '#fff', fontWeight: '600' }}>ACTIVE</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>{k.masked_key}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {!k.is_active && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleActivate(k.id)}
                      disabled={loading}
                      style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                    >
                      <Check size={13} />
                      <span>Activate</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleDelete(k.id, k.name)}
                    disabled={loading}
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
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                <select className="input-field" value={keyProvider} onChange={(e) => setKeyProvider(e.target.value)}>
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
              disabled={formLoading || !keyName.trim() || !keyValue.trim()}
              style={{ alignSelf: 'flex-start', marginTop: '6px' }}
            >
              <Plus size={15} />
              <span>{formLoading ? 'Encrypting & Saving...' : 'Add API Key'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

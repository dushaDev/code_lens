import React, { useEffect, useState } from 'react';
import { X, Code, FileText, ChevronRight, AlertCircle } from 'lucide-react';

export default function CommitCodeViewModal({ commitHash, onClose }) {
  const [commit, setCommit] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchCommitDetails = async () => {
      setLoading(true);
      setError('');
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`/api/v1/commits/${commitHash}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load commit details and file changes.');
        const data = await res.json();
        setCommit(data);
        if (data.file_changes && data.file_changes.length > 0) {
          setSelectedFile(data.file_changes[0]);
        }
      } catch (err) {
        setError(err.message || 'Error loading diff.');
      } finally {
        setLoading(false);
      }
    };

    if (commitHash) {
      fetchCommitDetails();
    }
  }, [commitHash]);

  const renderDiffLines = (diffText) => {
    if (!diffText) return <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No diff content available.</div>;
    const lines = diffText.split('\n');
    return (
      <pre style={{ margin: 0, padding: '16px', overflowX: 'auto', fontFamily: 'Fira Code, monospace', fontSize: '0.82rem', lineHeight: '1.6', backgroundColor: '#1e1e2e', color: '#cdd6f4', borderRadius: '8px' }}>
        {lines.map((line, idx) => {
          let backgroundColor = 'transparent';
          let color = '#cdd6f4';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            backgroundColor = 'rgba(16, 185, 129, 0.15)';
            color = '#a6e3a1';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            backgroundColor = 'rgba(239, 68, 68, 0.15)';
            color = '#f38ba8';
          } else if (line.startsWith('@@')) {
            backgroundColor = 'rgba(137, 180, 250, 0.1)';
            color = '#89b4fa';
          }
          return (
            <div key={idx} style={{ backgroundColor, color, padding: '0 8px', display: 'flex' }}>
              <span style={{ width: '32px', display: 'inline-block', userSelect: 'none', color: 'rgba(205, 214, 244, 0.3)', marginRight: '8px', textAlign: 'right' }}>{idx + 1}</span>
              <span>{line}</span>
            </div>
          );
        })}
      </pre>
    );
  };

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(5px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000
      }}
    >
      <div 
        className="modal-content card" 
        onClick={(e) => e.stopPropagation()} 
        style={{ 
          maxWidth: '1200px', width: '95%', height: '85vh',
          display: 'flex', flexDirection: 'column', padding: 0,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)', overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', padding: '16px 24px', backgroundColor: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ backgroundColor: 'var(--primary-alpha)', color: 'var(--primary)', padding: '6px', borderRadius: '6px' }}>
              <Code size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-main)' }}>Commit: <code>{commitHash?.slice(0, 8)}</code></h2>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>Project File Diff & Source Code Viewer</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Loading / Error states */}
        {loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <div className="spinner"></div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading code diffs...</p>
          </div>
        )}

        {error && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', gap: '12px' }}>
            <AlertCircle size={32} className="red-text" />
            <p style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: '600' }}>{error}</p>
            <button className="btn btn-secondary" onClick={onClose}>Close Viewer</button>
          </div>
        )}

        {/* Content */}
        {!loading && !error && commit && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            
            {/* Sidebar: Files List */}
            <div style={{ width: '320px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }}>
              
              {/* Commit Meta info box */}
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Message:</span>
                  <div style={{ fontWeight: '600', color: 'var(--text-main)', marginTop: '2px', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {commit.message}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                  <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>+{commit.insertions}</span>
                  <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>-{commit.deletions}</span>
                  {commit.is_squash_suspected && (
                    <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>Squash Suspected</span>
                  )}
                </div>
              </div>

              {/* Files title */}
              <div style={{ padding: '10px 16px', fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Modified Files ({commit.file_changes?.length || 0})
              </div>

              {/* Files Scrollbox */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {commit.file_changes?.map((fc) => {
                  const isSelected = selectedFile?.id === fc.id;
                  return (
                    <div 
                      key={fc.id}
                      onClick={() => setSelectedFile(fc)}
                      style={{
                        padding: '10px 12px', borderRadius: '6px', cursor: 'pointer',
                        backgroundColor: isSelected ? 'var(--primary-alpha)' : 'transparent',
                        color: isSelected ? 'var(--primary)' : 'var(--text-main)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '8px', marginBottom: '4px', transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                        <FileText size={15} style={{ flexShrink: 0, color: isSelected ? 'var(--primary)' : 'var(--text-muted)' }} />
                        <span style={{ fontSize: '0.8rem', fontWeight: isSelected ? '600' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fc.filename}>
                          {fc.filename.split('/').pop()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>
                        <span style={{ color: '#10b981' }}>+{fc.lines_added}</span>
                        <span style={{ color: '#ef4444' }}>-{fc.lines_removed}</span>
                      </div>
                    </div>
                  );
                })}
                {(!commit.file_changes || commit.file_changes.length === 0) && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>No file changes recorded for this commit.</div>
                )}
              </div>
            </div>

            {/* Code diff viewing panel */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#1e1e2e' }}>
              
              {/* Diff Header */}
              {selectedFile && (
                <div style={{ padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#181825', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#cdd6f4' }}>
                    <span style={{ fontSize: '0.78rem', color: '#a6adc8' }}>Viewing Diff:</span>
                    <span style={{ fontSize: '0.82rem', fontFamily: 'monospace', fontWeight: 'bold' }}>{selectedFile.filename}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '100px', backgroundColor: 'rgba(165,221,254,0.1)', color: '#89b4fa', fontWeight: 'bold', textTransform: 'uppercase' }}>
                      {selectedFile.status}
                    </span>
                  </div>
                </div>
              )}

              {/* Code scrollable pre */}
              <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
                {selectedFile ? renderDiffLines(selectedFile.raw_diff) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a6adc8', fontSize: '0.85rem' }}>
                    Select a file from the sidebar list to view its code changes.
                  </div>
                )}
              </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}

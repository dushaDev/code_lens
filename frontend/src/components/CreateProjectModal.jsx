import React, { useState } from 'react';
import { X, FolderGit2, Info, RefreshCw } from 'lucide-react';
import './CreateProjectModal.css';

export default function CreateProjectModal({ 
  course, 
  onClose, 
  onProjectCreated 
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [groupNo, setGroupNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !gitUrl.trim() || !groupNo.trim()) return;

    setLoading(true);
    setError('');
    
    // Phase 1: Registering
    setProgressPct(15);
    setProgressMsg('Registering project on server...');

    const token = localStorage.getItem('token');

    try {
      // 1. Create project entry
      const createRes = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name,
          description,
          git_url: gitUrl,
          course_id: course.id,
          group_no: groupNo,
          store_local_copy: true
        })
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.detail || 'Failed to create project record.');
      }

      // Phase 2: Downloading
      setProgressPct(35);
      setProgressMsg('downloading...');

      // Phase 3 & 4 Progress Ticker
      const progressInterval = setInterval(() => {
        setProgressPct((prev) => {
          if (prev < 70) {
            setProgressMsg('extracting...');
            return prev + 5;
          } else if (prev < 94) {
            setProgressMsg('indexing...');
            return prev + 3;
          }
          return prev;
        });
      }, 350);

      // 2. Trigger git history extraction
      const extractRes = await fetch(`/api/v1/extract/${createData.project_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      clearInterval(progressInterval);

      const extractData = await extractRes.json();
      if (!extractRes.ok) {
        throw new Error(extractData.detail || 'Git extraction failed. Please check the repository URL.');
      }

      // Phase 5: Complete
      setProgressPct(100);
      setProgressMsg('completed!');
      
      const newProjectObj = {
        id: createData.project_id,
        name,
        description,
        gitUrl,
        group_no: groupNo,
        techStack: ['Detecting...'],
        lastUpdated: 'Just now',
        plagiarismRisk: 'Good',
        course_id: course.id
      };
      
      setTimeout(() => {
        onProjectCreated(newProjectObj);
        onClose();
      }, 400);
    } catch (err) {
      setError(err.message || 'Server connection error.');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card card">
        <div className="modal-header">
          <div className="modal-title-box">
            <FolderGit2 size={20} className="blue-text" />
            <h2>Create New Project</h2>
          </div>
          <button className="close-btn" onClick={onClose} disabled={loading}>
            <X size={18} />
          </button>
        </div>

        {error && <div className="modal-alert alert-error">{error}</div>}

        {loading ? (
          <div className="modal-loader-box" style={{ padding: '24px 16px', textAlign: 'center' }}>
            <div style={{ marginBottom: '18px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
              <RefreshCw size={24} className="loader-spin icon-spin" style={{ color: '#3b82f6' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>Importing Repository</h3>
            </div>

            {/* Thin Pure Blue Progress Bar Track */}
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '5px', width: '100%', overflow: 'hidden', margin: '16px 0 10px 0' }}>
              <div 
                style={{ 
                  height: '100%', 
                  width: `${progressPct}%`, 
                  background: '#3b82f6', 
                  transition: 'width 0.35s ease-in-out',
                  borderRadius: '4px'
                }} 
              />
            </div>

            {/* Simple Small Phase Text */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '6px' }}>
              <span style={{ color: '#93c5fd', fontWeight: '500' }}>{progressMsg}</span>
              <span style={{ fontWeight: '600', color: '#3b82f6' }}>{progressPct}%</span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="modal-form">
            <div className="form-group-row" style={{ display: 'flex', gap: '16px' }}>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Project / Repository Name</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. Compiler Construction"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Group No / Tag</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. Group 4"
                  value={groupNo}
                  onChange={(e) => setGroupNo(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Repository Git URL</label>
              <input 
                type="url" 
                className="input-field" 
                placeholder="e.g. https://github.com/username/project.git"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description (Optional)</label>
              <textarea 
                className="input-field text-area" 
                placeholder="Brief project or assignment overview"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>



            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Create and Parse
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

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
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !gitUrl.trim() || !groupNo.trim()) return;

    setLoading(true);
    setError('');
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
          group_no: groupNo
        })
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.detail || 'Failed to create project record.');
      }

      // 2. Trigger git history extraction
      setProgressMsg('Cloning remote repository and parsing log history...');
      const extractRes = await fetch(`/api/v1/extract/${createData.project_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const extractData = await extractRes.json();
      if (!extractRes.ok) {
        throw new Error(extractData.detail || 'Git extraction failed. Please check the repository URL.');
      }

      // Complete
      alert(`Successfully imported ${extractData.total_commits} commits from ${extractData.total_authors} authors!`);
      
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
      
      onProjectCreated(newProjectObj);
      onClose();
    } catch (err) {
      setError(err.message || 'Server connection error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card card">
        <div className="modal-header">
          <div className="modal-title-box">
            <FolderGit2 size={20} className="blue-text" />
            <h2>Create Git Project</h2>
          </div>
          <button className="close-btn" onClick={onClose} disabled={loading}>
            <X size={18} />
          </button>
        </div>

        {error && <div className="modal-alert alert-error">{error}</div>}

        {loading ? (
          <div className="modal-loader-box">
            <RefreshCw size={36} className="loader-spin icon-spin" />
            <h3>Creating Project</h3>
            <p className="pulse">{progressMsg}</p>
            <div className="loader-tip">
              <Info size={14} />
              <span>This takes longer for repositories with extensive commit logs.</span>
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

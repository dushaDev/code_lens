import React, { useState, useEffect } from 'react';
import { useNotification } from '../../contexts/NotificationContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { 
  Users, 
  GraduationCap, 
  Award, 
  GitCommit, 
  SlidersHorizontal, 
  GitMerge, 
  Bot, 
  X, 
  ArrowUpDown,
  FolderGit2,
  ArrowUpRight
} from 'lucide-react';
import Tag from '../../components/Tag';
import './Students.css';

export default function Students({
  students,
  projects = [],
  onMergeAuthors,
  initialSearch = ''
}) {
  const { addNotification } = useNotification();
  const { navigate } = useNavigation();
  const [search, setSearch] = useState(initialSearch);

  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch);
    }
  }, [initialSearch]);
  const [projectFilter, setProjectFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('commits-desc');
  
  // Merge state
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [selectedSourceStudent, setSelectedSourceStudent] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState('');

  // Projects Modal state
  const [projectsModalStudent, setProjectsModalStudent] = useState(null);

  // 1. Identify bots helper
  const isBot = (student) => {
    const nameLower = student.name.toLowerCase();
    const emailLower = student.email.toLowerCase();
    const botKeywords = ['bot', 'actions', 'workflow', 'ci', 'support', 'helper', 'automated', 'npm-owner', 'greenkeeper', 'snyk'];
    
    return botKeywords.some(keyword => nameLower.includes(keyword) || emailLower.includes(keyword));
  };

  // 2. Filter students
  const filteredStudents = students.filter((student) => {
    // Search match
    const matchesSearch = 
      student.name.toLowerCase().includes(search.toLowerCase()) ||
      student.email.toLowerCase().includes(search.toLowerCase());
    
    if (!matchesSearch) return false;

    // Project match
    if (projectFilter !== 'all') {
      const selectedProject = projects.find(p => p.id === parseInt(projectFilter));
      if (selectedProject && selectedProject.authors) {
        // Check if student email matches an author of this project
        const hasContributed = selectedProject.authors.some(
          auth => auth.email.toLowerCase() === student.email.toLowerCase()
        );
        if (!hasContributed) return false;
      }
    }

    return true;
  });

  // 3. Sort students
  const sortedStudents = [...filteredStudents].sort((a, b) => {
    if (sortOrder === 'commits-desc') {
      return (b.commitsCount || 0) - (a.commitsCount || 0);
    }
    if (sortOrder === 'commits-asc') {
      return (a.commitsCount || 0) - (b.commitsCount || 0);
    }
    if (sortOrder === 'additions-desc') {
      return (b.additions || 0) - (a.additions || 0);
    }
    if (sortOrder === 'name-asc') {
      return a.name.localeCompare(b.name);
    }
    if (sortOrder === 'name-desc') {
      return b.name.localeCompare(a.name);
    }
    return 0;
  });

  const handleMergeSubmit = (e) => {
    e.preventDefault();
    if (!selectedSourceStudent || !mergeTargetId) return;
    
    if (selectedSourceStudent.id === parseInt(mergeTargetId)) {
      addNotification({ type: 'warning', title: 'Invalid Merge', description: "You cannot merge a student into themselves." });
      return;
    }

    onMergeAuthors(selectedSourceStudent.id, parseInt(mergeTargetId));
    setShowMergeModal(false);
    setSelectedSourceStudent(null);
    setMergeTargetId('');
  };

  return (
    <div className="students-view">
      <div className="view-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '8px' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, textAlign: 'left', flexWrap: 'wrap' }}>
          <span>Students Directory</span>
          <span style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-color)', display: 'inline-block', margin: '0 4px', alignSelf: 'center' }} />
          <span style={{ fontSize: '0.82rem', fontWeight: '400', color: 'var(--text-muted)', letterSpacing: 'normal' }}>Overview of students, their total commit activities, and contribution logs.</span>
        </h1>
        
        {/* Project selector relocated to top left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div className="select-wrapper">
            <span className="select-label" style={{ fontWeight: '600' }}>Filter by Project:</span>
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <select 
                className="select-field"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                style={{
                  borderColor: projectFilter !== 'all' ? 'var(--primary)' : 'var(--border-color)',
                  backgroundColor: projectFilter !== 'all' ? 'var(--primary-alpha)' : 'var(--bg-card)',
                  color: projectFilter !== 'all' ? 'var(--primary)' : 'var(--text-main)',
                  fontWeight: projectFilter !== 'all' ? '600' : 'normal',
                  paddingRight: projectFilter !== 'all' ? '30px' : '12px',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none'
                }}
              >
                <option value="all">All Projects</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {projectFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setProjectFilter('all')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 0
                  }}
                  title="Clear filter"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {projectFilter !== 'all' && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.78rem',
              color: 'var(--primary)',
              fontWeight: '600',
              backgroundColor: 'var(--primary-alpha)',
              padding: '4px 10px',
              borderRadius: '20px',
              border: '1px solid hsl(var(--primary-hue), var(--primary-sat), 85%)'
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--primary)' }} />
              Filter Active
            </span>
          )}
        </div>
      </div>

      {/* Top metrics bar */}
      <div className="students-metrics-row">
        <div className="student-metric-card card">
          <GraduationCap size={20} className="purple-text" />
          <div>
            <h3>{filteredStudents.filter(s => !isBot(s)).length}</h3>
            <p>Students</p>
          </div>
        </div>
        <div className="student-metric-card card">
          <Bot size={20} className="red-text" />
          <div>
            <h3>{filteredStudents.filter(s => isBot(s)).length}</h3>
            <p>Bots</p>
          </div>
        </div>
        <div className="student-metric-card card">
          <GitCommit size={20} className="blue-text" />
          <div>
            <h3>{filteredStudents.reduce((acc, s) => acc + (s.commitsCount || 0), 0)}</h3>
            <p>Total Commits</p>
          </div>
        </div>
      </div>

      {/* Horizontal Smaller Search & Filter Bar */}
      <div className="students-action-bar card">
        <div className="action-search-box">
          <input 
            type="text" 
            placeholder="Search student or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
          />
        </div>

        <div className="action-filters-group">
          {/* Sort order */}
          <div className="select-wrapper">
            <span className="select-label">Sort:</span>
            <select 
              className="select-field"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            >
              <option value="commits-desc">Commits: High to Low</option>
              <option value="commits-asc">Commits: Low to High</option>
              <option value="additions-desc">Additions: High to Low</option>
              <option value="name-asc">Name: A-Z</option>
              <option value="name-desc">Name: Z-A</option>
            </select>
          </div>
        </div>
      </div>

      {/* Students list */}
      <div className="students-list-card card">
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Name/Username</th>
                <th>Email</th>
                <th>Projects Contributed</th>
                <th>Commits</th>
                <th>Impact Lines</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map((student) => {
                const studentIsBot = isBot(student);
                const studentProjects = projects.filter((p) => {
                  const isAuthor = Array.isArray(p.authors) && p.authors.some(
                    a => a && a.email && String(a.email).toLowerCase() === String(student.email).toLowerCase()
                  );
                  const isInList = Array.isArray(student.projects) && student.projects.includes(p.id);
                  return isAuthor || isInList;
                });

                return (
                  <tr key={student.id} className={studentIsBot ? 'row-bot' : ''}>
                    <td style={{ padding: '8px 12px' }}>
                      <div className="student-name-row" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="student-name">{student.name}</span>
                        {studentIsBot && <Tag text="BOT" variant="danger" style={{ fontSize: '9px', padding: '1.5px 4px' }} />}
                      </div>
                    </td>
                    <td className="muted-cell">{student.email}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                        {studentProjects.slice(0, 2).map((proj) => (
                          <button
                            key={proj.id}
                            className="btn btn-outline btn-sm"
                            onClick={() => navigate({ project: proj })}
                            title={`Click to view analytics for ${proj.name}`}
                            style={{ 
                              padding: '3px 8px', 
                              fontSize: '0.75rem', 
                              gap: '4px',
                              color: 'var(--primary)',
                              borderColor: 'var(--border-color)',
                              backgroundColor: 'var(--bg-app)',
                              cursor: 'pointer'
                            }}
                          >
                            <FolderGit2 size={12} />
                            <span>{proj.name}</span>
                          </button>
                        ))}

                        {studentProjects.length > 2 && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => setProjectsModalStudent({ student, projects: studentProjects })}
                            title="Click to view all contributed projects"
                            style={{ 
                              padding: '3px 8px', 
                              fontSize: '0.75rem', 
                              fontWeight: 'bold',
                              color: 'var(--primary)',
                              backgroundColor: 'var(--primary-alpha)',
                              borderColor: 'var(--border-color)',
                              cursor: 'pointer'
                            }}
                          >
                            +{studentProjects.length - 2}
                          </button>
                        )}

                        {studentProjects.length === 0 && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No projects</span>
                        )}
                      </div>
                    </td>
                    <td className="bold-cell">{Math.round(student.commitsCount)}</td>
                    <td>
                      <span className="additions-text">+{Math.round(student.additions)}</span>
                      <span className="deletions-text">-{Math.round(student.deletions)}</span>
                    </td>
                    <td>
                      <button 
                        className="btn btn-outline btn-sm merge-btn-icon"
                        onClick={() => {
                          setSelectedSourceStudent(student);
                          setMergeTargetId('');
                          setShowMergeModal(true);
                        }}
                        title="Merge aliases/duplicate profiles for this user"
                      >
                        <GitMerge size={14} />
                        <span>Merge Alias</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {sortedStudents.length === 0 && (
                <tr>
                  <td colSpan="6" className="empty-table-cell">
                    <p>No students match your query filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showMergeModal && selectedSourceStudent && (
        <div className="modal-overlay">
          <div className="modal-card card">
            <div className="modal-header">
              <div className="modal-title-box">
                <GitMerge size={20} className="primary-text" />
                <h2>Merge Student Profile</h2>
              </div>
              <button 
                className="close-btn" 
                onClick={() => { setShowMergeModal(false); setSelectedSourceStudent(null); }}
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleMergeSubmit} className="modal-form" style={{ textAlign: 'left' }}>
              
              {/* Step 1: Source */}
              <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                  1. Profile to Merge (Will be Hidden)
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)' }}>
                  {selectedSourceStudent.name}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {selectedSourceStudent.email}
                </div>
              </div>

              {/* Arrow Indicator */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0', color: 'var(--primary)' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Merge Into</span>
              </div>

              {/* Step 2: Target */}
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                  2. Destination Profile (Will Receive Data)
                </div>
                <select
                  className="select-field"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  required
                  style={{ width: '100%', padding: '8px' }}
                >
                  <option value="">Select target student profile...</option>
                  {students
                    .filter((s) => {
                      if (s.id === selectedSourceStudent.id) return false;
                      const sourceProjects = selectedSourceStudent.projects || [];
                      const targetProjects = s.projects || [];
                      return sourceProjects.some(id => targetProjects.includes(id));
                    })
                    .map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                    ))
                  }
                </select>
                {students.filter((s) => {
                  if (s.id === selectedSourceStudent.id) return false;
                  const sourceProjects = selectedSourceStudent.projects || [];
                  const targetProjects = s.projects || [];
                  return sourceProjects.some(id => targetProjects.includes(id));
                }).length === 0 && (
                  <p style={{ marginTop: '8px', color: 'var(--color-danger)', fontSize: '0.8rem', margin: 0 }}>
                    No other student profiles found in the same project.
                  </p>
                )}
              </div>

              {/* Explanation Note */}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '16px' }}>
                <span>💡</span>
                <div>
                All commits, lines of code, and git activities from profile (1) will be consolidated into profile (2). Profile (1) will then be removed from the directory. <strong style={{ color: 'var(--color-danger)' }}>This action cannot be undone.</strong>
                </div>
              </div>
              
              <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => { setShowMergeModal(false); setSelectedSourceStudent(null); }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={!mergeTargetId}
                >
                  Merge Profiles
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Projects List Popup Modal when +N is clicked */}
      {projectsModalStudent && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-card card" style={{ maxWidth: '540px', width: '90%' }}>
            <div className="modal-header">
              <div className="modal-title-box" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FolderGit2 size={22} className="primary-text" />
                <h2>Projects Contributed by {projectsModalStudent.student.name}</h2>
              </div>
              <button 
                className="close-btn" 
                onClick={() => setProjectsModalStudent(null)}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px', textAlign: 'left' }}>
              Click any project card below to view detailed analytics and contribution metrics.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
              {projectsModalStudent.projects.map((proj) => (
                <div
                  key={proj.id}
                  className="card"
                  onClick={() => {
                    setProjectsModalStudent(null);
                    navigate({ project: proj });
                  }}
                  style={{
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    transition: 'var(--transition)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--primary-alpha)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <FolderGit2 size={20} />
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-main)' }}>{proj.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {proj.group_no || proj.groupNo || 'Group Project'} • {proj.authorsCount || (proj.authors?.length || 1)} Contributor(s)
                      </div>
                    </div>
                  </div>

                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--primary)'
                  }}>
                    View Analytics <ArrowUpRight size={14} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

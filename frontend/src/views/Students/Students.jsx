import React, { useState } from 'react';
import { 
  Users, 
  GraduationCap, 
  Award, 
  GitCommit, 
  SlidersHorizontal, 
  GitMerge, 
  Bot, 
  X, 
  ArrowUpDown 
} from 'lucide-react';
import Tag from '../../components/Tag';
import './Students.css';

export default function Students({ 
  students, 
  projects = [], 
  onMergeAuthors 
}) {
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('commits-desc');
  
  // Merge state
  const [mergingSourceId, setMergingSourceId] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState('');

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

  const handleMergeSubmit = (e, sourceId) => {
    e.preventDefault();
    if (!mergeTargetId) return;
    
    if (sourceId === parseInt(mergeTargetId)) {
      alert("You cannot merge a student into themselves.");
      return;
    }

    onMergeAuthors(sourceId, parseInt(mergeTargetId));
    setMergingSourceId(null);
    setMergeTargetId('');
  };

  return (
    <div className="students-view">
      <div className="view-header">
        <div>
          <h1>Students Directory</h1>
          <p className="subtitle">Overview of students, their total commit activities, and contribution logs.</p>
        </div>
      </div>

      {/* Top metrics bar */}
      <div className="students-metrics-row">
        <div className="student-metric-card card">
          <GraduationCap size={20} className="purple-text" />
          <div>
            <h3>{students.filter(s => !isBot(s)).length}</h3>
            <p>Actual Students</p>
          </div>
        </div>
        <div className="student-metric-card card">
          <Bot size={20} className="red-text" />
          <div>
            <h3>{students.filter(s => isBot(s)).length}</h3>
            <p>Bots Identified</p>
          </div>
        </div>
        <div className="student-metric-card card">
          <GitCommit size={20} className="blue-text" />
          <div>
            <h3>{students.reduce((acc, s) => acc + (s.commitsCount || 0), 0)}</h3>
            <p>Total Commits Evaluated</p>
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
          {/* Project filter */}
          <div className="select-wrapper">
            <span className="select-label">Project:</span>
            <select 
              className="select-field"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="all">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

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
                <th>Student Details</th>
                <th>Primary Email</th>
                <th>Commits</th>
                <th>Impact Lines</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map((student) => {
                const studentIsBot = isBot(student);
                return (
                  <tr key={student.id} className={studentIsBot ? 'row-bot' : ''}>
                    <td>
                      <div className="student-info-cell-content">
                        <div className={`student-avatar ${studentIsBot ? 'avatar-bot' : ''}`}>
                          {studentIsBot ? <Bot size={16} /> : student.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="student-name-row">
                            <span className="student-name">{student.name}</span>
                            {studentIsBot && <Tag text="BOT" variant="danger" style={{ fontSize: '9px', padding: '1.5px 4px' }} />}
                          </div>
                          <span className="student-id">ID: {student.studentId || `CS-${1000 + student.id}`}</span>
                        </div>
                      </div>
                    </td>
                    <td className="muted-cell">{student.email}</td>
                    <td className="bold-cell">{Math.round(student.commitsCount)}</td>
                    <td>
                      <span className="additions-text">+{Math.round(student.additions)}</span>
                      <span className="deletions-text">-{Math.round(student.deletions)}</span>
                    </td>
                    <td>
                      {mergingSourceId === student.id ? (
                        <form 
                          className="inline-merge-form"
                          onSubmit={(e) => handleMergeSubmit(e, student.id)}
                        >
                          <select 
                            className="select-field select-sm"
                            value={mergeTargetId}
                            onChange={(e) => setMergeTargetId(e.target.value)}
                            required
                          >
                            <option value="">Merge into...</option>
                            {students
                              .filter(s => s.id !== student.id)
                              .map(s => (
                                <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                              ))}
                          </select>
                          <button type="submit" className="btn btn-primary btn-sm confirm-merge-btn">
                            Confirm
                          </button>
                          <button 
                            type="button" 
                            className="close-merge-btn"
                            onClick={() => setMergingSourceId(null)}
                          >
                            <X size={14} />
                          </button>
                        </form>
                      ) : (
                        <button 
                          className="btn btn-outline btn-sm merge-btn-icon"
                          onClick={() => setMergingSourceId(student.id)}
                          title="Merge aliases/duplicate profiles for this user"
                        >
                          <GitMerge size={14} />
                          <span>Merge Alias</span>
                        </button>
                      )}
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
    </div>
  );
}

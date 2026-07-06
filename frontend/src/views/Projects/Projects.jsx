import React, { useState } from 'react';
import { 
  FolderGit2, 
  Search, 
  SlidersHorizontal, 
  ArrowUpRight, 
  FileCheck2, 
  AlertOctagon, 
  Trash2 
} from 'lucide-react';
import { getTechDetails } from '../../utils/techIcons';
import './Projects.css';

export default function Projects({ 
  projects, 
  onViewAnalytics, 
  onDeleteProject 
}) {
  const [filter, setFilter] = useState('all'); // all, good, high-risk
  const [search, setSearch] = useState('');

  const filteredProjects = projects.filter((project) => {
    // Filter condition
    if (filter === 'good' && project.plagiarismRisk !== 'Good') return false;
    if (filter === 'high-risk' && project.plagiarismRisk !== 'High Risk') return false;

    // Search condition
    const matchesSearch = 
      project.name.toLowerCase().includes(search.toLowerCase()) ||
      project.description?.toLowerCase().includes(search.toLowerCase()) ||
      project.techStack?.some(tech => tech.toLowerCase().includes(search.toLowerCase()));
    
    return matchesSearch;
  });

  const renderTechBadge = (tech) => {
    if (!tech) return null;
    const { icon, badgeClass } = getTechDetails(tech, 12);
    
    return (
      <span 
        key={tech} 
        className={`tech-badge ${badgeClass}`} 
        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      >
        {icon}
        <span>{tech}</span>
      </span>
    );
  };

  return (
    <div className="projects-view">
      <div className="view-header">
        <div>
          <h1>Course Projects</h1>
          <p className="subtitle">List of repositories imported and parsed under the current course.</p>
        </div>
      </div>

      {/* Filter and Search Action Bar */}
      <div className="action-bar card">
        <div className="search-box">
          <Search size={18} />
          <input 
            type="text" 
            placeholder="Search projects by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-options">
          <span className="filter-label">
            <SlidersHorizontal size={14} />
            <span>Filter By:</span>
          </span>
          <div className="btn-group">
            <button 
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All Projects
            </button>
            <button 
              className={`filter-btn ${filter === 'good' ? 'active' : ''}`}
              onClick={() => setFilter('good')}
            >
              Good Health
            </button>
            <button 
              className={`filter-btn ${filter === 'high-risk' ? 'active' : ''}`}
              onClick={() => setFilter('high-risk')}
            >
              High Plagiarism Risk
            </button>
          </div>
        </div>
      </div>

      {/* Projects Table Card */}
      <div className="projects-list-card card">
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Project Name</th>
                <th>Tech Stack</th>
                <th>Last Updated</th>
                <th>Status</th>
                <th>Plagiarism</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => {
                const isHighRisk = project.plagiarismRisk === 'High Risk';
                return (
                  <tr key={project.id} className={isHighRisk ? 'row-high-risk' : ''}>
                    <td>
                      <div className="project-name-cell-content" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FolderGit2 size={16} className="project-icon" />
                        <span className="group-tag" style={{
                          backgroundColor: 'var(--bg-app)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-muted)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          letterSpacing: '0.02em',
                          textTransform: 'uppercase'
                        }}>{project.group_no || project.groupNo || 'G-00'}</span>
                        <span className="project-title">{project.name}</span>
                      </div>
                    </td>
                    <td>
                      <div className="tech-badges-list">
                        {project.techStack?.map(tech => renderTechBadge(tech))}
                      </div>
                    </td>
                    <td className="muted-cell">{project.lastUpdated}</td>
                    <td>
                      {project.plagiarismRisk !== 'High Risk' ? (
                        <span className="status-indicator status-good">
                          <FileCheck2 size={14} />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="status-indicator status-warning">
                          <AlertOctagon size={14} />
                          <span>Needs Review</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {isHighRisk ? (
                        <span className="badge badge-danger">High Risk</span>
                      ) : (
                        <span className="badge badge-success">Good</span>
                      )}
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={() => onViewAnalytics(project)}
                        >
                          <span>View Analytics</span>
                          <ArrowUpRight size={14} />
                        </button>
                        <button 
                          className="btn-delete"
                          onClick={() => onDeleteProject(project.id)}
                          title="Delete Project"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan="6" className="empty-table-cell">
                    <p>No projects match your current search/filter parameters.</p>
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

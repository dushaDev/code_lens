import React, { useState } from 'react';
import { useNavigation } from '../../contexts/NavigationContext';
import { 
  FolderGit2, 
  Search, 
  SlidersHorizontal, 
  ArrowUpRight, 
  FileCheck2, 
  AlertOctagon, 
  Trash2,
  RefreshCw
} from 'lucide-react';
import { getTechDetails } from '../../utils/techIcons';
import Tag from '../../components/Tag';
import './Projects.css';

export default function Projects({
  projects,
  onDeleteProject,
  onSyncProject
}) {
  const { navigate } = useNavigation();
  const [filter, setFilter] = useState('all'); // all, good, high-risk
  const [sortBy, setSortBy] = useState('added'); // 'added' (default), 'risk'
  const [search, setSearch] = useState('');
  const [syncingId, setSyncingId] = useState(null);

  const filteredProjects = projects
    .filter((project) => {
      // Filter condition
      if (filter === 'good' && project.plagiarismRisk !== 'Good') return false;
      if (filter === 'high-risk' && project.plagiarismRisk !== 'High Risk') return false;

      // Search condition
      const matchesSearch = 
        project.name.toLowerCase().includes(search.toLowerCase()) ||
        project.description?.toLowerCase().includes(search.toLowerCase()) ||
        project.techStack?.some(tech => tech.toLowerCase().includes(search.toLowerCase())) ||
        (project.group_no || project.groupNo || '').toLowerCase().includes(search.toLowerCase());
      
      return matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'risk') {
        const getRiskRank = (p) => {
          if (p.plagiarismRisk === 'High Risk') return 3;
          if (p.plagiarismRisk === 'Medium Risk') return 2;
          return 1;
        };
        const rankA = getRiskRank(a);
        const rankB = getRiskRank(b);
        if (rankA !== rankB) {
          return rankB - rankA; // Highest risk first
        }
      }
      // Default: Added time (Newest project first by ID or created_at timestamp)
      const timeA = a.created_at ? new Date(a.created_at).getTime() : (a.id || 0);
      const timeB = b.created_at ? new Date(b.created_at).getTime() : (b.id || 0);
      return timeB - timeA;
    });

  const renderTechBadges = (techStack) => {
    if (!techStack) return null;
    const maxVisible = 2;
    const visibleTech = techStack.slice(0, maxVisible);
    const extraCount = techStack.length - maxVisible;

    return (
      <div className="tech-badges-list" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {visibleTech.map((tech) => {
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
        })}
        {extraCount > 0 && (
          <span 
            className="tech-badge" 
            style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              backgroundColor: 'var(--bg-app)', 
              color: 'var(--text-muted)', 
              border: '1px solid var(--border-color)', 
              fontSize: '11px', 
              padding: '2px 6px', 
              borderRadius: '4px', 
              fontWeight: 'bold' 
            }}
            title={techStack.slice(maxVisible).join(', ')}
          >
            +{extraCount}
          </span>
        )}
      </div>
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
      <div className="action-bar card" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="search-box">
          <Search size={18} />
          <input 
            type="text" 
            placeholder="Search projects by Group Id, Name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-options" style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <SlidersHorizontal size={14} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-muted)' }}>Filter:</span>
            <div className="btn-group">
              <button 
                className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
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
                High Risk
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-muted)' }}>Sort By:</span>
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              style={{ 
                background: 'var(--card-bg, #1e293b)', 
                color: 'var(--text-primary, #f8fafc)', 
                border: '1px solid var(--border-color, #334155)', 
                borderRadius: '6px', 
                padding: '6px 12px', 
                fontSize: '0.82rem', 
                fontWeight: '500',
                cursor: 'pointer' 
              }}
            >
              <option value="added">Added Time (Newest First)</option>
              <option value="risk">Risk Level (Highest First)</option>
            </select>
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
                  <tr key={project.id}>
                    <td>
                      <div className="project-name-cell-content" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FolderGit2 size={16} className="project-icon" />
                        <Tag text={project.group_no || project.groupNo || 'G-00'} variant="muted" style={{ fontSize: '0.75rem', padding: '2px 6px' }} />
                        <span 
                          className="project-title" 
                          onClick={() => navigate({ project })}
                          style={{ cursor: 'pointer' }}
                          title="Click to open project analytics"
                        >
                          {project.name}
                        </span>
                      </div>
                    </td>
                    <td>
                      {renderTechBadges(project.techStack)}
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
                      <Tag 
                        text={project.plagiarismRisk} 
                        variant={
                          project.plagiarismRisk === 'High Risk' ? 'danger' :
                          project.plagiarismRisk === 'Medium Risk' ? 'warning' : 'success'
                        } 
                      />
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={async () => {
                            if (!onSyncProject) return;
                            setSyncingId(project.id);
                            try {
                              await onSyncProject(project.id);
                            } finally {
                              setSyncingId(null);
                            }
                          }}
                          disabled={syncingId === project.id}
                          title="Pull latest git commits from GitHub"
                          style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <RefreshCw size={13} className={syncingId === project.id ? 'spin' : ''} />
                          <span>{syncingId === project.id ? 'Syncing...' : 'Sync Git'}</span>
                        </button>
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={() => navigate({ project })}
                        >
                          <span>Analytics</span>
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

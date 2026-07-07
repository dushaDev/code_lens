import React from 'react';
import { 
  Folder, 
  Users, 
  AlertTriangle, 
  Download, 
  ArrowUpRight, 
  PlusCircle, 
  Code
} from 'lucide-react';
import { getTechDetails } from '../../utils/techIcons';
import Tag from '../../components/Tag';
import './Dashboard.css';

export default function Dashboard({ 
  user,
  projects, 
  studentsCount, 
  plagiarismCount, 
  onViewAnalytics, 
  onCreateProjectClick 
}) {

  // Function to map tech stack names to beautiful background colors and icons
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

  const handleExport = () => {
    alert('Report downloaded successfully!');
  };

  const getGreeting = () => {
    const hrs = new Date().getHours();
    if (hrs < 12) return 'Good morning';
    if (hrs < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getFormattedDate = () => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString(undefined, options);
  };

  return (
    <div className="dashboard-view">
      <div className="dashboard-greeting">
        <h1>{getGreeting()}, {user?.username || 'Professor'}</h1>
        <p className="subtitle"><strong>Today is {getFormattedDate()}.</strong> Here is the latest overview of your academic analysis metrics.</p>
      </div>

      {/* Stat Cards Grid */}
      <div className="stats-grid">
        <div className="stat-card card">
          <div className="stat-card-header">
            <div className="stat-icon-wrapper blue-icon">
              <Folder size={22} />
            </div>
            <span className="stat-label">Total Active Projects</span>
          </div>
          <div className="stat-card-body">
            <h2 className="stat-value">{projects.length}</h2>
            <p className="stat-subtext text-success">
              <span className="arrow-up">↑ +2</span> from last term
            </p>
          </div>
        </div>

        <div className="stat-card card">
          <div className="stat-card-header">
            <div className="stat-icon-wrapper purple-icon">
              <Users size={22} />
            </div>
            <span className="stat-label">Total Students Evaluated</span>
          </div>
          <div className="stat-card-body">
            <h2 className="stat-value">{studentsCount}</h2>
            <p className="stat-subtext">Across all active repositories</p>
          </div>
        </div>

        <div className="stat-card card warning-card">
          <div className="stat-card-header">
            <div className="stat-icon-wrapper red-icon">
              <AlertTriangle size={22} />
            </div>
            <span className="stat-label">High-Risk Plagiarism Alerts</span>
          </div>
          <div className="stat-card-body">
            <h2 className="stat-value red-value">{plagiarismCount}</h2>
            <p className="stat-subtext text-danger">Immediate review recommended</p>
          </div>
        </div>
      </div>

      {/* Recent Projects Table Section */}
      <div className="recent-projects-section card">
        <div className="recent-projects-header">
          <h2>Recent Projects</h2>
          <button className="btn btn-secondary export-btn" onClick={handleExport}>
            <Download size={16} />
            <span>Export Report</span>
          </button>
        </div>

        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Project Name</th>
                <th>Tech Stack</th>
                <th>Last Updated</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.slice(0, 5).map((project) => {
                const isHighRisk = project.plagiarismRisk === 'High Risk';
                return (
                  <tr key={project.id} className={isHighRisk ? 'row-high-risk' : ''}>
                    <td>
                      <div className="project-name-cell-content" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Tag text={project.group_no || project.groupNo || 'G-00'} variant="muted" style={{ fontSize: '0.75rem', padding: '2px 6px' }} />
                        <span className="project-title">{project.name}</span>
                      </div>
                    </td>
                     <td>
                       {renderTechBadges(project.techStack)}
                     </td>
                    <td className="muted-cell">{project.lastUpdated}</td>
                    <td>
                      <Tag text={isHighRisk ? 'High Risk' : 'Good'} variant={isHighRisk ? 'danger' : 'success'} />
                    </td>
                    <td>
                      <button 
                        className="btn btn-primary btn-sm view-analytics-btn"
                        onClick={() => onViewAnalytics(project)}
                      >
                        <span>View Analytics</span>
                        <ArrowUpRight size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {projects.length === 0 && (
                <tr>
                  <td colSpan="5" className="empty-table-cell">
                    <p>No projects imported yet.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom CTA block */}
      <div className="create-project-cta card" onClick={onCreateProjectClick}>
        <div className="cta-icon-box">
          <PlusCircle size={24} />
        </div>
        <div className="cta-text">
          <h3>Create a New Project</h3>
          <p>Clone a student repository and parse its git history logs.</p>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { 
  ArrowLeft, 
  GitCommit, 
  Percent, 
  Scale, 
  AlertCircle, 
  BarChart4, 
  User 
} from 'lucide-react';
import './Analytics.css';

export default function Analytics({ project, onBack }) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      setError('');
      const token = localStorage.getItem('token');

      try {
        const response = await fetch(`/api/v1/projects/${project.id}/analytics`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error('Failed to load project analytics.');
        const data = await response.json();
        setAnalytics(data);
      } catch (err) {
        setError(err.message || 'Failed to load project analytics from database.');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [project]);

  if (loading) {
    return (
      <div className="loader-box">
        <div className="spinner"></div>
        <p>Analyzing repository commit history logs...</p>
      </div>
    );
  }

  const getGiniStatusClass = (gini) => {
    if (gini > 0.7) return 'badge-danger';
    if (gini > 0.4) return 'badge-warning';
    return 'badge-success';
  };

  const getContributionColorClass = (percentage, totalContributors) => {
    if (!totalContributors || totalContributors <= 0) return 'progress-fill-good';
    
    // Ideal share is 100% divided by number of contributors
    const idealShare = 100 / totalContributors;
    const deviation = Math.abs(percentage - idealShare);
    const relativeDeviation = deviation / idealShare;
    
    // Within 35% deviation from ideal: Good (Green)
    // Within 65% deviation from ideal: Warning (Orange)
    // Greater deviation: Danger (Red)
    if (relativeDeviation < 0.35) {
      return 'progress-fill-good';
    } else if (relativeDeviation < 0.65) {
      return 'progress-fill-warning';
    } else {
      return 'progress-fill-danger';
    }
  };

  return (
    <div className="analytics-view">
      <div className="analytics-header">
        <button className="btn btn-secondary back-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Back to Projects</span>
        </button>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="group-tag" style={{
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-muted)',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.85rem',
              fontWeight: '700',
              letterSpacing: '0.02em',
              textTransform: 'uppercase'
            }}>{project.group_no || project.groupNo || 'G-00'}</span>
            <span>{project.name}</span>
          </h1>
          <p className="subtitle">Repository metadata, contribution inequality, and git log history metrics.</p>
      </div>

      {analytics && (
        <div className="analytics-content-grid">
          {/* Summary metrics */}
          <div className="analytics-summary-cards">
            <div className="stat-card card">
              <div className="stat-card-header">
                <div className="stat-icon-wrapper blue-icon">
                  <Scale size={22} />
                </div>
                <span className="stat-label">Gini Coefficient (Inequality)</span>
              </div>
              <div className="stat-card-body">
                <h2 className="stat-value">{analytics.gini_coefficient?.toFixed(2)}</h2>
                <span className={`badge ${getGiniStatusClass(analytics.gini_coefficient)}`}>
                  {analytics.distribution_status}
                </span>
              </div>
            </div>

            <div className="stat-card card">
              <div className="stat-card-header">
                <div className="stat-icon-wrapper purple-icon">
                  <GitCommit size={22} />
                </div>
                <span className="stat-label">Total Commits Analyzed</span>
              </div>
              <div className="stat-card-body">
                <h2 className="stat-value">{analytics.total_commits}</h2>
                <p className="stat-subtext">Across all active branches</p>
              </div>
            </div>

            <div className="stat-card card">
              <div className="stat-card-header">
                <div className="stat-icon-wrapper red-icon">
                  <Percent size={22} />
                </div>
                <span className="stat-label">Total Insertions</span>
              </div>
              <div className="stat-card-body">
                <h2 className="stat-value">{analytics.total_insertions}</h2>
                <p className="stat-subtext">Lines of parsed source code</p>
              </div>
            </div>
          </div>

          {/* Gini index explanation alert */}
          <div className="gini-explanation-banner card">
            <AlertCircle size={22} className="explanation-icon" />
            <div>
              <h4>Gini Coefficient Explanation</h4>
              <p>
                A Gini coefficient near <strong>0.0</strong> indicates perfectly equal contribution (all members contributed equally). 
                A Gini coefficient near <strong>1.0</strong> indicates completely unequal contribution (one student did all the work). 
                A coefficient above <strong>0.6</strong> usually indicates that other group members are sliding by without significant coding contribution.
              </p>
            </div>
          </div>

          {/* Contribution table */}
          <div className="recent-projects-section card">
            <div className="recent-projects-header">
              <h2>Author Contributions</h2>
            </div>
            <div className="table-container">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Contributor</th>
                    <th>Email Address</th>
                    <th>Commits</th>
                    <th>Lines Contributed</th>
                    <th>Overall Share</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.contributions?.map((contrib) => (
                    <tr key={contrib.author_id}>
                      <td className="student-info-cell">
                        <div className="student-avatar">
                          {contrib.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="student-name">{contrib.name}</span>
                      </td>
                      <td className="muted-cell">{contrib.email}</td>
                      <td className="bold-cell">{contrib.commit_count}</td>
                      <td className="bold-cell text-success">+{contrib.lines_added}</td>
                      <td>
                        <div className="progress-bar-cell">
                          <span className="progress-text">{contrib.contribution_percentage?.toFixed(1)}%</span>
                          <div className="progress-track">
                            <div 
                              className={`progress-fill ${getContributionColorClass(contrib.contribution_percentage, analytics.contributions.length)}`}
                              style={{ width: `${contrib.contribution_percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

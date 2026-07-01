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

      // Mock mode
      if (token === 'mock-jwt-token') {
        setTimeout(() => {
          setAnalytics({
            project_id: project.id,
            gini_coefficient: project.plagiarismRisk === 'High Risk' ? 0.82 : 0.34,
            total_commits: 48,
            total_insertions: 3420,
            distribution_status: project.plagiarismRisk === 'High Risk' ? 'Highly Unequal Contribution' : 'Balanced Contribution',
            contributions: [
              { author_id: 1, name: 'Dusha Dev', email: 'dusha@example.com', commit_count: 36, lines_added: 2800, contribution_percentage: 81.8 },
              { author_id: 2, name: 'Chamara K', email: 'chamara@example.com', commit_count: 8, lines_added: 420, contribution_percentage: 12.2 },
              { author_id: 3, name: 'Noyel F', email: 'noyel@example.com', commit_count: 4, lines_added: 200, contribution_percentage: 6.0 },
            ]
          });
          setLoading(false);
        }, 600);
        return;
      }

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
        // Fallback mock
        setAnalytics({
          project_id: project.id,
          gini_coefficient: 0.38,
          total_commits: 34,
          total_insertions: 2150,
          distribution_status: 'Balanced Contribution',
          contributions: [
            { author_id: 1, name: 'Dusha Dev', email: 'dusha@example.com', commit_count: 22, lines_added: 1400, contribution_percentage: 65.1 },
            { author_id: 2, name: 'Chamara K', email: 'chamara@example.com', commit_count: 12, lines_added: 750, contribution_percentage: 34.9 },
          ]
        });
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

  return (
    <div className="analytics-view">
      <div className="analytics-header">
        <button className="btn btn-secondary back-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Back to Projects</span>
        </button>
        <div className="header-text-block">
          <h1>Analytics: {project.name}</h1>
          <p className="subtitle">Repository metadata, contribution inequality, and git log history metrics.</p>
        </div>
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
                              className="progress-fill" 
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

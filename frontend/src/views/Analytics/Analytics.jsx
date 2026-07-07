import React, { useEffect, useState } from 'react';
import { 
  ArrowLeft, 
  GitCommit, 
  Percent, 
  Scale, 
  AlertCircle, 
  BarChart4, 
  User,
  Info
} from 'lucide-react';
import './Analytics.css';

export default function Analytics({ project, onBack }) {
  const [analytics, setAnalytics] = useState(null);
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      setError('');
      const token = localStorage.getItem('token');

      try {
        const [analyticsRes, commitsRes] = await Promise.all([
          fetch(`/api/v1/projects/${project.id}/analytics`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch(`/api/v1/projects/${project.id}/commits`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);
        if (!analyticsRes.ok) throw new Error('Failed to load project analytics.');
        const analyticsData = await analyticsRes.json();
        const commitsData = commitsRes.ok ? await commitsRes.json() : { commits: [] };
        
        setAnalytics(analyticsData);
        setCommits(commitsData.commits || []);
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

  const renderCommitChart = () => {
    if (!commits || commits.length === 0) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '140px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No commits recorded to plot activity history.
        </div>
      );
    }

    const sorted = [...commits].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const groups = {};
    sorted.forEach(c => {
      const dateStr = new Date(c.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      groups[dateStr] = (groups[dateStr] || 0) + 1;
    });

    const chartData = Object.entries(groups).slice(-8);
    if (chartData.length === 0) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '140px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No activity logs to render graph.
        </div>
      );
    }

    const maxVal = Math.max(...chartData.map(([_, count]) => count), 1);
    const width = 360;
    const height = 130;
    const paddingLeft = 30;
    const paddingRight = 10;
    const paddingTop = 15;
    const paddingBottom = 20;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const barSpacing = chartWidth / chartData.length;
    const barWidth = Math.max(barSpacing * 0.5, 8);

    return (
      <div style={{ position: 'relative', width: '100%', height: '140px' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          {[0, 0.5, 1].map((ratio, index) => {
            const y = paddingTop + chartHeight * (1 - ratio);
            return (
              <g key={index}>
                <line 
                  x1={paddingLeft} 
                  y1={y} 
                  x2={width - paddingRight} 
                  y2={y} 
                  stroke="var(--border-color)" 
                  strokeWidth="1" 
                  strokeDasharray="4 4"
                />
                <text 
                  x={paddingLeft - 8} 
                  y={y + 4} 
                  textAnchor="end" 
                  fontSize="9px" 
                  fill="var(--text-muted)"
                  fontWeight="bold"
                >
                  {Math.round(maxVal * ratio)}
                </text>
              </g>
            );
          })}

          {chartData.map(([date, count], index) => {
            const x = paddingLeft + (index * barSpacing) + (barSpacing - barWidth) / 2;
            const barHeight = (count / maxVal) * chartHeight;
            const y = paddingTop + chartHeight - barHeight;

            return (
              <g key={date}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 3)}
                  rx="3"
                  ry="3"
                  fill="var(--primary)"
                  style={{ transition: 'all 0.3s ease' }}
                  title={`${date}: ${count} commits`}
                />
                <text
                  x={x + barWidth / 2}
                  y={height - 4}
                  textAnchor="middle"
                  fontSize="9px"
                  fill="var(--text-muted)"
                >
                  {date}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
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
            <div className="stat-card card" style={{ position: 'relative' }}>
              <div className="stat-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="stat-icon-wrapper blue-icon">
                    <Scale size={22} />
                  </div>
                  <span className="stat-label">Gini Coefficient (Inequality)</span>
                </div>
                <div className="gini-tooltip-trigger" style={{ cursor: 'pointer', color: 'var(--text-light)' }}>
                  <Info size={16} />
                  <div className="gini-tooltip-content">
                    <strong style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Gini Coefficient Explanation</strong>
                    <p style={{ margin: 0, lineHeight: '1.4', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                      A Gini coefficient near <strong>0.0</strong> indicates perfectly equal contribution (all members contributed equally).
                      A Gini coefficient near <strong>1.0</strong> indicates completely unequal contribution (one student did all the work).
                      A coefficient above <strong>0.6</strong> usually indicates that other group members are sliding by without significant coding contribution.
                    </p>
                  </div>
                </div>
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

          {/* Visualizations Section */}
          <div className="analytics-visualization-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px', marginBottom: '24px', marginTop: '24px' }}>
            
            {/* Language Distribution Card */}
            <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-main)', marginBottom: '16px', textAlign: 'left' }}>Codebase Languages</h3>
                
                {/* Segmented language distribution bar */}
                <div style={{ display: 'flex', height: '12px', width: '100%', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'var(--bg-app)', marginBottom: '20px' }}>
                  {Object.entries(analytics.language_distribution || {}).map(([lang, pct], idx) => {
                    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#374151'];
                    const color = colors[idx % colors.length];
                    return (
                      <div 
                        key={lang} 
                        style={{ 
                          width: `${pct}%`, 
                          backgroundColor: color, 
                          height: '100%' 
                        }} 
                        title={`${lang}: ${pct}%`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Language labels list */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', textAlign: 'left' }}>
                {Object.entries(analytics.language_distribution || {}).map(([lang, pct], idx) => {
                  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#374151'];
                  const color = colors[idx % colors.length];
                  return (
                    <div key={lang} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color }} />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)' }}>{lang}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Commit History Chart Card */}
            <div className="card" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-main)', marginBottom: '16px', textAlign: 'left' }}>Commit Activity History</h3>
              {renderCommitChart()}
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

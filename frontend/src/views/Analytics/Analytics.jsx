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
  const [chartInterval, setChartInterval] = useState('weekly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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
        
        const commitsList = commitsData.commits || [];
        setAnalytics(analyticsData);
        setCommits(commitsList);
        
        if (commitsList.length > 0) {
          const sorted = [...commitsList].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          setStartDate(sorted[0].timestamp.split('T')[0]);
          setEndDate(sorted[sorted.length - 1].timestamp.split('T')[0]);
        }
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '220px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No commits recorded to plot activity history.
        </div>
      );
    }

    const filteredCommits = commits.filter(c => {
      const ts = c.timestamp.split('T')[0];
      if (startDate && ts < startDate) return false;
      if (endDate && ts > endDate) return false;
      return true;
    });

    const setQuickRange = (days) => {
      const sorted = [...commits].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      if (sorted.length === 0) return;
      const latestDateStr = sorted[sorted.length - 1].timestamp.split('T')[0];
      const latestDate = new Date(latestDateStr);
      
      if (days === 'all') {
        setStartDate(sorted[0].timestamp.split('T')[0]);
        setEndDate(latestDateStr);
      } else {
        const priorDate = new Date(latestDate);
        priorDate.setDate(priorDate.getDate() - days);
        const priorStr = priorDate.toISOString().split('T')[0];
        
        const earliestStr = sorted[0].timestamp.split('T')[0];
        setStartDate(priorStr < earliestStr ? earliestStr : priorStr);
        setEndDate(latestDateStr);
      }
    };

    const start = new Date(startDate || new Date());
    const end = new Date(endDate || new Date());

    const chartData = [];
    if (chartInterval === 'monthly') {
      let curr = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      while (curr <= endMonth) {
        const label = curr.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
        const nextMonth = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
        const count = filteredCommits.filter(c => {
          const d = new Date(c.timestamp);
          return d >= curr && d < nextMonth;
        }).length;
        chartData.push({ label, count, tooltip: `${label}: ${count} commits` });
        curr = nextMonth;
      }
    } else if (chartInterval === 'weekly') {
      let curr = new Date(start);
      curr.setDate(curr.getDate() - curr.getDay());
      while (curr <= end) {
        const weekEnd = new Date(curr);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const label = curr.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const count = filteredCommits.filter(c => {
          const d = new Date(c.timestamp);
          return d >= curr && d <= weekEnd;
        }).length;
        chartData.push({ 
          label, 
          count, 
          tooltip: `${curr.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}: ${count} commits` 
        });
        curr.setDate(curr.getDate() + 7);
      }
    } else {
      let curr = new Date(start);
      while (curr <= end) {
        const label = curr.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const dateStr = curr.toDateString();
        const count = filteredCommits.filter(c => {
          const d = new Date(c.timestamp);
          return d.toDateString() === dateStr;
        }).length;
        chartData.push({ label, count, tooltip: `${curr.toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${count} commits` });
        curr.setDate(curr.getDate() + 1);
      }
    }

    const maxVal = Math.max(...chartData.map(d => d.count), 1);
    
    const width = 600;
    const height = 180;
    const paddingLeft = 15;
    const paddingRight = 55;
    const paddingTop = 15;
    const paddingBottom = 25;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    
    const barSpacing = chartWidth / Math.max(chartData.length, 1);
    const barWidth = Math.max(barSpacing * 0.6, 4);

    const totalSelectedCommits = filteredCommits.length;
    const avgCommits = (totalSelectedCommits / Math.max(chartData.length, 1)).toFixed(1);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button 
              type="button"
              className="btn btn-secondary" 
              style={{ padding: '4px 10px', fontSize: '0.75rem', height: 'auto' }} 
              onClick={() => setQuickRange(30)}
            >
              30 Days
            </button>
            <button 
              type="button"
              className="btn btn-secondary" 
              style={{ padding: '4px 10px', fontSize: '0.75rem', height: 'auto' }} 
              onClick={() => setQuickRange(90)}
            >
              90 Days
            </button>
            <button 
              type="button"
              className="btn btn-secondary" 
              style={{ padding: '4px 10px', fontSize: '0.75rem', height: 'auto' }} 
              onClick={() => setQuickRange('all')}
            >
              All Time
            </button>
          </div>

          <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-app)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            {['daily', 'weekly', 'monthly'].map(t => (
              <button
                key={t}
                type="button"
                style={{
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  border: 'none',
                  background: chartInterval === t ? 'var(--bg-card)' : 'transparent',
                  color: chartInterval === t ? 'var(--primary)' : 'var(--text-muted)',
                  fontWeight: chartInterval === t ? '600' : 'normal',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  boxShadow: chartInterval === t ? 'var(--shadow-sm)' : 'none'
                }}
                onClick={() => setChartInterval(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>From:</span>
            <input 
              type="date" 
              className="input-field" 
              style={{ padding: '4px 8px', fontSize: '0.8rem', width: '130px', height: 'auto' }}
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>To:</span>
            <input 
              type="date" 
              className="input-field" 
              style={{ padding: '4px 8px', fontSize: '0.8rem', width: '130px', height: 'auto' }}
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div style={{ position: 'relative', width: '100%', minHeight: '190px', padding: '10px 0', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-app)' }}>
          <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
              const y = paddingTop + chartHeight * (1 - ratio);
              return (
                <g key={index}>
                  <line 
                    x1={paddingLeft} 
                    y1={y} 
                    x2={width - paddingRight} 
                    y2={y} 
                    stroke="var(--border-color)" 
                    strokeWidth="0.75" 
                    strokeDasharray="4 4"
                  />
                  <text 
                    x={width - paddingRight + 8} 
                    y={y + 3} 
                    textAnchor="start" 
                    fontSize="9px" 
                    fill="var(--text-muted)"
                    fontWeight="600"
                  >
                    {Math.round(maxVal * ratio)}
                  </text>
                </g>
              );
            })}

            <text
              transform={`rotate(90, ${width - 15}, ${paddingTop + chartHeight / 2})`}
              x={width - 15}
              y={paddingTop + chartHeight / 2}
              textAnchor="middle"
              fontSize="9px"
              fontWeight="600"
              fill="var(--text-muted)"
              letterSpacing="0.05em"
            >
              Contributions
            </text>

            {chartData.map((d, index) => {
              const x = paddingLeft + (index * barSpacing) + (barSpacing - barWidth) / 2;
              const barHeight = (d.count / maxVal) * chartHeight;
              const y = paddingTop + chartHeight - barHeight;
              const showLabel = chartData.length <= 12 || index % Math.ceil(chartData.length / 10) === 0;

              return (
                <g key={index} className="chart-bar-group">
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(barHeight, 2)}
                    rx="1.5"
                    ry="1.5"
                    fill="var(--primary)"
                    style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
                  />
                  <rect
                    x={x - (barSpacing - barWidth)/2}
                    y={paddingTop}
                    width={barSpacing}
                    height={chartHeight}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                  >
                    <title>{d.tooltip}</title>
                  </rect>
                  {showLabel && (
                    <text
                      x={x + barWidth / 2}
                      y={height - 8}
                      textAnchor="middle"
                      fontSize="8.5px"
                      fill="var(--text-muted)"
                    >
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Selected Range Commits</div>
            <strong style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>{totalSelectedCommits}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Avg Commits/{chartInterval}</div>
            <strong style={{ fontSize: '1.05rem', color: 'var(--primary)' }}>{avgCommits}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Peak {chartInterval === 'monthly' ? 'Month' : chartInterval === 'weekly' ? 'Week' : 'Day'}</div>
            <strong style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>{maxVal}</strong>
          </div>
        </div>
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
          <div className="analytics-visualization-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
            
            {/* Language Distribution Card */}
            <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: '1 1 320px', maxWidth: '420px' }}>
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
            <div className="card" style={{ padding: '24px', flex: '2 1 500px' }}>
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

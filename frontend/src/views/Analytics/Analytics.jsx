import React, { useEffect, useState } from 'react';
import { 
  ArrowLeft, 
  GitCommit, 
  Percent, 
  Scale, 
  AlertCircle, 
  BarChart4, 
  User,
  Info,
  MessageSquare,
  Bot
} from 'lucide-react';
import Tag from '../../components/Tag';
import Tooltip from '../../components/Tooltip';
import './Analytics.css';

export default function Analytics({ project, onBack }) {
  const [analytics, setAnalytics] = useState(null);
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chartInterval, setChartInterval] = useState('weekly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState('quantitative');
  const [showCommitsModal, setShowCommitsModal] = useState(false);

  const isBot = (name, email) => {
    const nameLower = name.toLowerCase();
    const emailLower = email.toLowerCase();
    const botKeywords = ['bot', 'actions', 'workflow', 'ci', 'support', 'helper', 'automated', 'npm-owner', 'greenkeeper', 'snyk'];
    return botKeywords.some(keyword => nameLower.includes(keyword) || emailLower.includes(keyword));
  };

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
      {/* Switcher Tab Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', position: 'relative', minHeight: '40px' }}>
        {/* Left Side: Back Button */}
        <button 
          type="button"
          className="btn btn-secondary back-btn" 
          onClick={onBack}
          style={{ margin: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <ArrowLeft size={16} />
          <span>Back to Projects</span>
        </button>

        {/* Center: Switcher Pill */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '4px', backgroundColor: 'var(--bg-app)', padding: '4px', borderRadius: '30px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', zIndex: 5 }}>
          <button
            type="button"
            onClick={() => setActiveTab('quantitative')}
            style={{
              padding: '8px 24px',
              background: activeTab === 'quantitative' ? 'var(--bg-card)' : 'transparent',
              border: 'none',
              borderRadius: '20px',
              color: activeTab === 'quantitative' ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'quantitative' ? '600' : '500',
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: activeTab === 'quantitative' ? 'var(--shadow-sm)' : 'none'
            }}
          >
            Quantitative Analysis
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('qualitative')}
            style={{
              padding: '8px 24px',
              background: activeTab === 'qualitative' ? 'var(--bg-card)' : 'transparent',
              border: 'none',
              borderRadius: '20px',
              color: activeTab === 'qualitative' ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'qualitative' ? '600' : '500',
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: activeTab === 'qualitative' ? 'var(--shadow-sm)' : 'none'
            }}
          >
            Qualitative Analysis
          </button>
        </div>
      </div>

      <div className="analytics-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px', marginBottom: '24px' }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 8px 0', textAlign: 'left' }}>
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
          <p className="subtitle" style={{ margin: 0, textAlign: 'left' }}>Repository metadata, contribution inequality, and git log history metrics.</p>
      </div>

      {analytics && activeTab === 'quantitative' && (
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
                <Tooltip 
                  title="Gini Coefficient" 
                  content="Measures workload division: 0.0 is perfectly equal, 1.0 is single-member dominant. A value above 0.6 indicates others may not be contributing significantly." 
                />
              </div>
              <div className="stat-card-body">
                <h2 className="stat-value">{analytics.gini_coefficient?.toFixed(2)}</h2>
                <span className={`badge ${getGiniStatusClass(analytics.gini_coefficient)}`}>
                  {analytics.distribution_status}
                </span>
              </div>
            </div>

            <div className="stat-card card">
              <div className="stat-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="stat-icon-wrapper purple-icon">
                    <GitCommit size={22} />
                  </div>
                  <span className="stat-label">Total Commits Analyzed</span>
                </div>
                <Tooltip 
                  title="Total Commits" 
                  content="The total number of commits extracted and parsed from the repository across all active git branches." 
                />
              </div>
              <div className="stat-card-body">
                <h2 className="stat-value">{analytics.total_commits}</h2>
                <p className="stat-subtext">Across all active branches</p>
              </div>
            </div>

            <div className="stat-card card">
              <div className="stat-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="stat-icon-wrapper red-icon">
                    <Percent size={22} />
                  </div>
                  <span className="stat-label">Total Insertions</span>
                </div>
                <Tooltip 
                  title="Total Insertions" 
                  content="The cumulative number of lines of source code added across all commits. This measures the overall volume of work." 
                />
              </div>
              <div className="stat-card-body">
                <h2 className="stat-value">{analytics.total_insertions}</h2>
                <p className="stat-subtext">Lines of parsed source code</p>
              </div>
            </div>
          </div>

          {/* Visualizations Section */}
          <div className="analytics-visualization-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
            
            {/* Language Distribution Card */}
            <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: '1 1 320px', maxWidth: '420px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-main)', margin: 0, textAlign: 'left' }}>Codebase Languages</h3>
                  <Tooltip 
                    title="Codebase Languages" 
                    content="The percentage distribution of different programming languages in the project, calculated based on the total lines of code added." 
                  />
                </div>
                
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-main)', margin: 0, textAlign: 'left' }}>Commit Activity History</h3>
                <Tooltip 
                  title="Commit Activity History" 
                  content="A historical timeline of commit logs grouped by daily, weekly, or monthly intervals, showing git activity over the selected range." 
                />
              </div>
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
                    <th>Lines Added</th>
                    <th>Lines Removed (Refactoring)</th>
                    <th>Overall Share</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.contributions?.map((contrib) => (
                    <tr key={contrib.author_id}>
                      <td className="student-info-cell" style={{ padding: '8px 12px' }}>
                        <span className="student-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {contrib.name}
                          {isBot(contrib.name, contrib.email) && <Tag text="Bot" variant="danger" style={{ fontSize: '9px', padding: '1.5px 4px' }} />}
                        </span>
                      </td>
                      <td className="muted-cell">{contrib.email}</td>
                      <td className="bold-cell">{contrib.commit_count}</td>
                      <td className="bold-cell text-success">+{contrib.lines_added}</td>
                      <td className="bold-cell text-danger">-{contrib.lines_removed || 0}</td>
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

          {/* Commit Message Quality Analysis */}
          <div className="recent-projects-section card" style={{ marginTop: '24px' }}>
            <div className="recent-projects-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Recent Repository Commits</h2>
              <button 
                type="button" 
                className="btn btn-outline btn-sm"
                onClick={() => setShowCommitsModal(true)}
              >
                See all commits
              </button>
            </div>
            <div className="table-container">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th style={{ width: '45%' }}>Commit Message</th>
                    <th>Author</th>
                    <th>Date/Time</th>
                    <th>Impact Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {commits.slice(0, 5).map((c) => {
                    const getAuthorName = (authorId) => {
                      const contrib = analytics.contributions?.find(a => a.author_id === authorId);
                      return contrib ? contrib.name : 'Unknown';
                    };
                    const formatDate = (dateStr) => {
                      const d = new Date(dateStr);
                      return d.toLocaleString([], { 
                        year: 'numeric', 
                        month: 'numeric', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      });
                    };
                    return (
                      <tr key={c.hash}>
                        <td style={{ textAlign: 'left', padding: '10px 12px' }}>
                          <div style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            fontSize: '0.85rem',
                            lineHeight: '1.4',
                            fontWeight: '500',
                            color: 'var(--text-main)'
                          }} title={c.message}>
                            <code>{c.message}</code>
                          </div>
                        </td>
                        <td className="muted-cell" style={{ fontSize: '0.85rem' }}>{getAuthorName(c.author_id)}</td>
                        <td className="muted-cell" style={{ fontSize: '0.85rem' }}>
                          {formatDate(c.timestamp)}
                        </td>
                        <td style={{ fontSize: '0.85rem', fontWeight: '600' }}>
                          <span style={{ color: 'var(--text-success)', marginRight: '6px' }}>+{c.insertions}</span>
                          <span style={{ color: 'var(--text-danger)' }}>-{c.deletions}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* All Commits Popup Modal */}
          {showCommitsModal && (
            <div 
              className="modal-overlay" 
              onClick={() => setShowCommitsModal(false)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                backdropFilter: 'blur(4px)'
              }}
            >
              <div 
                className="modal-content card" 
                onClick={(e) => e.stopPropagation()} 
                style={{ 
                  maxWidth: '850px', 
                  width: '90%', 
                  maxHeight: '85vh', 
                  display: 'flex', 
                  flexDirection: 'column',
                  padding: '24px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)'
                }}
              >
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '16px' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-main)' }}>All Repository Commits ({commits.length})</h2>
                  <button 
                    type="button"
                    onClick={() => setShowCommitsModal(false)} 
                    style={{ 
                      background: 'transparent', 
                      border: 'none', 
                      color: 'var(--text-muted)', 
                      cursor: 'pointer', 
                      fontSize: '1.5rem', 
                      lineHeight: '1',
                      padding: '4px'
                    }}
                  >
                    &times;
                  </button>
                </div>
                <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                  <table className="custom-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '50%' }}>Commit Message</th>
                        <th>Author</th>
                        <th>Date/Time</th>
                        <th>Impact Changes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commits.map((c) => {
                        const getAuthorName = (authorId) => {
                          const contrib = analytics.contributions?.find(a => a.author_id === authorId);
                          return contrib ? contrib.name : 'Unknown';
                        };
                        const formatDate = (dateStr) => {
                          const d = new Date(dateStr);
                          return d.toLocaleString([], { 
                            year: 'numeric', 
                            month: 'numeric', 
                            day: 'numeric', 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          });
                        };
                        return (
                          <tr key={c.hash}>
                            <td style={{ textAlign: 'left', padding: '10px 12px', whiteSpace: 'pre-wrap' }}>
                              <code>{c.message}</code>
                            </td>
                            <td className="muted-cell" style={{ fontSize: '0.85rem' }}>{getAuthorName(c.author_id)}</td>
                            <td className="muted-cell" style={{ fontSize: '0.85rem' }}>
                              {formatDate(c.timestamp)}
                            </td>
                            <td style={{ fontSize: '0.85rem', fontWeight: '600' }}>
                              <span style={{ color: 'var(--text-success)', marginRight: '6px' }}>+{c.insertions}</span>
                              <span style={{ color: 'var(--text-danger)' }}>-{c.deletions}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}



      {analytics && activeTab === 'qualitative' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '320px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '40px', textAlign: 'center', marginTop: '24px' }}>
          <div style={{ padding: '16px', borderRadius: '50%', backgroundColor: 'var(--primary-alpha)', color: 'var(--primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MessageSquare size={32} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-main)', marginBottom: '8px' }}>Qualitative Code Review Analysis</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', maxWidth: '460px', lineHeight: '1.6', margin: '0 auto' }}>
            This section will house qualitative analysis metrics including code styling check results, code duplication ratios, structural design complexity, and instructor peer reviews.
          </p>
          <div style={{ marginTop: '20px', display: 'inline-block', fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: 'var(--primary-alpha)', padding: '6px 16px', borderRadius: '100px' }}>
            Feature Coming Soon
          </div>
        </div>
      )}

    </div>
  );
}

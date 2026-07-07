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
  Bot,
  X
} from 'lucide-react';
import Tag from '../../components/Tag';
import Tooltip from '../../components/Tooltip';
import CommitActivityChart from '../../components/CommitActivityChart';
import './Analytics.css';

export default function Analytics({ project, onBack }) {
  const [analytics, setAnalytics] = useState(null);
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('quantitative');
  const [showCommitsModal, setShowCommitsModal] = useState(false);
  const [selectedAuthor, setSelectedAuthor] = useState(null); // { id, name }

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

  const handleAuthorRowClick = (contrib) => {
    setSelectedAuthor(prev =>
      prev && prev.id === contrib.author_id ? null : { id: contrib.author_id, name: contrib.name }
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', position: 'relative', minHeight: '40px' }}>
        {/* Left Side: Back Button */}
        <button 
          type="button"
          className="btn btn-secondary back-btn" 
          onClick={onBack}
          style={{ margin: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <ArrowLeft size={16} />
          <span>Back</span>
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

      <div className="analytics-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '14px' }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, textAlign: 'left', flexWrap: 'wrap' }}>
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
            <span style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-color)', display: 'inline-block', margin: '0 4px', alignSelf: 'center' }} />
            <span style={{ fontSize: '0.82rem', fontWeight: '400', color: 'var(--text-muted)', letterSpacing: 'normal' }}>Repository metadata, contribution inequality, and git log history metrics.</span>
          </h1>
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
              <CommitActivityChart commits={commits} allCommits={commits} />
            </div>
          </div>

          {/* Contribution table */}
          <div className="recent-projects-section card">
            <div className="recent-projects-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Author Contributions</h2>
              {selectedAuthor && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  <span>Click row again or</span>
                  <button
                    type="button"
                    onClick={() => setSelectedAuthor(null)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', fontSize: '0.8rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '20px', cursor: 'pointer', color: 'var(--text-main)' }}
                  >
                    <X size={12} /> Clear filter
                  </button>
                </div>
              )}
            </div>
            <div className="table-container">
              <table className="custom-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '22%' }} />
                </colgroup>
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
                    <tr
                      key={contrib.author_id}
                      onClick={() => handleAuthorRowClick(contrib)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: selectedAuthor?.id === contrib.author_id
                          ? 'var(--primary-alpha)'
                          : undefined,
                        outline: selectedAuthor?.id === contrib.author_id
                          ? '1px solid var(--primary)'
                          : undefined,
                        transition: 'background 0.15s'
                      }}
                    >
                      <td className="student-info-cell" style={{ padding: '8px 12px' }}>
                        <span className="student-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {contrib.name}
                          {isBot(contrib.name, contrib.email) && <Tag text="Bot" variant="danger" style={{ fontSize: '9px', padding: '1.5px 4px' }} />}
                        </span>
                      </td>
                      <td className="muted-cell" title={contrib.email}>{contrib.email}</td>
                      <td className="bold-cell">{contrib.commit_count}</td>
                      <td>
                        <span style={{ display: 'inline-block', backgroundColor: 'rgba(16,185,129,0.12)', color: '#10b981', padding: '2px 7px', borderRadius: '4px', fontSize: '0.82rem', fontWeight: '600', letterSpacing: '0.02em' }}>+{contrib.lines_added}</span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-block', backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444', padding: '2px 7px', borderRadius: '4px', fontSize: '0.82rem', fontWeight: '600', letterSpacing: '0.02em' }}>-{contrib.lines_removed || 0}</span>
                      </td>
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

          {/* Author Drill-down Chart — Popup Modal */}
          {selectedAuthor && (
            <div
              onClick={() => setSelectedAuthor(null)}
              style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999
              }}
            >
              <div
                className="card"
                onClick={e => e.stopPropagation()}
                style={{ width: '90%', maxWidth: '780px', padding: '20px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-main)', margin: '0 0 2px 0' }}>
                      Commit Activity — {selectedAuthor.name}
                    </h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Showing only this contributor's commits
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedAuthor(null)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '4px' }}
                  >
                    <X size={18} />
                  </button>
                </div>
                <CommitActivityChart
                  commits={commits.filter(c => c.author_id === selectedAuthor.id)}
                  allCommits={commits}
                  authorName={selectedAuthor.name}
                />
              </div>
            </div>
          )}

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
              <table className="custom-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '45%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '15%' }} />
                </colgroup>
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
                        <td style={{ fontSize: '0.82rem', fontWeight: '600', whiteSpace: 'nowrap' }}>
                          <span style={{
                            display: 'inline-block',
                            backgroundColor: 'rgba(16,185,129,0.12)',
                            color: '#10b981',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            marginRight: '5px',
                            letterSpacing: '0.02em'
                          }}>+{c.insertions}</span>
                          <span style={{
                            display: 'inline-block',
                            backgroundColor: 'rgba(239,68,68,0.12)',
                            color: '#ef4444',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            letterSpacing: '0.02em'
                          }}>-{c.deletions}</span>
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
                  maxWidth: '1100px', 
                  width: '95%', 
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
                            <td style={{ fontSize: '0.82rem', fontWeight: '600', whiteSpace: 'nowrap' }}>
                              <span style={{
                                display: 'inline-block',
                                backgroundColor: 'rgba(16,185,129,0.12)',
                                color: '#10b981',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                marginRight: '5px',
                                letterSpacing: '0.02em'
                              }}>+{c.insertions}</span>
                              <span style={{
                                display: 'inline-block',
                                backgroundColor: 'rgba(239,68,68,0.12)',
                                color: '#ef4444',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                letterSpacing: '0.02em'
                              }}>-{c.deletions}</span>
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

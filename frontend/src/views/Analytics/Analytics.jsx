import React, { useEffect, useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
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
  X,
  XCircle,
  Code,
  RefreshCw,
  Play,
  Square,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import Tag from '../../components/Tag';
import Tooltip from '../../components/Tooltip';
import CommitActivityChart from '../../components/CommitActivityChart';
import CommitCodeViewModal from '../../components/CommitCodeViewModal';
import FileBrowserModal from '../../components/FileBrowserModal';
import { formatDeadline } from '../../utils/courseMeta';
import './Analytics.css';

export default function Analytics({ project, course, onBack, qualAnalysisState, onStartQualitative, onStopQualitative }) {
  const [analytics, setAnalytics] = useState(null);
  const courseDeadline = course?.deadline || project?.course?.deadline || project?.deadline;
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('quantitative');
  const [showCommitsModal, setShowCommitsModal] = useState(false);
  const [showFileBrowserModal, setShowFileBrowserModal] = useState(false);
  const [showRawDataInspector, setShowRawDataInspector] = useState(false);
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState(null);
  const [samplingMode, setSamplingMode] = useState('sample'); // 'sample' | 'full' | 'random'

  const [cloudReport, setCloudReport] = useState(null);
  const [isCloudGenerating, setIsCloudGenerating] = useState(false);
  const [cloudError, setCloudError] = useState(null);

  // Shorthand aliases for cleaner JSX
  const qualStatus = qualAnalysisState?.status || 'idle';
  const qualProgress = qualAnalysisState?.progress || 0;
  const qualMessage = qualAnalysisState?.message || '';
  const qualData = qualAnalysisState?.data || null;
  const isRunning = qualStatus === 'running';
  const isCancelling = qualStatus === 'cancelling';
  const isComplete = qualStatus === 'complete';
  const isIdle = qualStatus === 'idle' || qualStatus === 'cancelled';







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



  // When entering qualitative tab: if idle, check backend/DB status then auto-start
  useEffect(() => {
    if (activeTab !== 'qualitative') return;
    // Already running or complete: nothing to do, just display
    if (isRunning || isCancelling || isComplete) return;
    // If idle: check backend status, then auto-start if no cache found
    const checkAndStart = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/v1/projects/${project.id}/qualitative-analysis/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Status check failed');
        const statusData = await res.json();
        if (statusData.status === 'running') {
          // Backend is running but this session lost the stream — just show status
          // The global state in App.jsx will reflect this via RUNNING_PROJECTS on next full start
          return;
        }
        if (statusData.status === 'complete' || statusData.has_db_cache) {
          // DB has cached data — start stream (will return instantly from cache)
          onStartQualitative(false);
          return;
        }
        // Truly idle, no cache: auto-start
        onStartQualitative(false);
      } catch (err) {
        console.error('Status check failed, auto-starting:', err);
        onStartQualitative(false);
      }
    };
    checkAndStart();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, project.id]);

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

  const generateCloudReport = async () => {
    setIsCloudGenerating(true);
    setCloudError(null);
    setCloudReport(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/v1/projects/${project.id}/cloud-report`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 402) {
        setCloudError('NO_API_KEY');
        setIsCloudGenerating(false);
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        let detailMsg = 'Failed to generate cloud report';
        if (errData && errData.detail) {
          detailMsg = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
        }
        throw new Error(detailMsg);
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `CodeLens_Report_${project.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setCloudReport("PDF Generated Successfully!");
    } catch (err) {
      setCloudError(err.message);
    } finally {
      setIsCloudGenerating(false);
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

        {/* Right Side: Web File Browser Button */}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowFileBrowserModal(true)}
          style={{ zIndex: 10, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}
        >
          <Code size={16} className="blue-text" />
          <span>Browse Project Files</span>
        </button>
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
            
            {/* Left Column: Codebase Languages + Submission Deadline Card */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: '1 1 320px', maxWidth: '420px', width: '100%' }}>
              
              {/* Language Distribution Card */}
              <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
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

              {/* Submission Deadline & Late Commits Card (rendered if project/course has deadline) */}
              {(() => {
                const deadlineDateObj = courseDeadline ? new Date(courseDeadline) : null;
                const isValidDeadline = deadlineDateObj && !isNaN(deadlineDateObj.getTime());
                if (!isValidDeadline) return null;

                const allLateCommits = commits.filter(c => new Date(c.timestamp) > deadlineDateObj);
                const totalLateCount = allLateCommits.length;

                const lateAuthorsMap = {};
                if (totalLateCount > 0) {
                  allLateCommits.forEach(c => {
                    const authorName = c.author_name || c.author?.name || 'Contributor';
                    lateAuthorsMap[authorName] = (lateAuthorsMap[authorName] || 0) + 1;
                  });
                }

                return (
                  <div className="card" style={{ padding: '24px', textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-main)', margin: 0 }}>Submission Deadline</h3>
                      <Tooltip 
                        title="Submission Deadline & Late Commits" 
                        content="Monitors the course cutoff date and tracks all commits submitted after the deadline." 
                      />
                    </div>

                    {/* Deadline Info Banner */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                      <Clock size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.82rem', fontWeight: '500', color: 'var(--text-main)' }}>
                        {formatDeadline(courseDeadline)}
                      </span>
                    </div>

                    {/* Late Commits Summary Stat */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', backgroundColor: totalLateCount > 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)', borderRadius: '6px', }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Total Late Commits</div>
                        <strong style={{ fontSize: '1.25rem', color: totalLateCount > 0 ? '#ef4444' : '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {totalLateCount > 0 ? (
                            <>
                              <span>{totalLateCount}</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={18} color="#10b981" />
                              <span>0</span>
                            </>
                          )}
                        </strong>
                      </div>
                    
                    </div>

                  </div>
                );
              })()}

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
              <CommitActivityChart commits={commits} allCommits={commits} deadline={courseDeadline} />
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
                  {analytics.contributions?.map((contrib) => {
                    const authorCommits = commits.filter(c => c.author_id === contrib.author_id);
                    const lateCount = courseDeadline 
                      ? authorCommits.filter(c => new Date(c.timestamp) > new Date(courseDeadline)).length
                      : 0;

                    return (
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
                          <span className="student-name" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {contrib.name}
                            {isBot(contrib.name, contrib.email) && <Tag text="Bot" variant="danger" style={{ fontSize: '9px', padding: '1.5px 4px' }} />}
                            {lateCount > 0 && (
                              <Tag 
                                text={`Late (${lateCount})`} 
                                variant="danger" 
                                style={{ fontSize: '9px', padding: '1.5px 5px', fontWeight: '700' }} 
                                title={`${lateCount} commit(s) pushed after submission deadline`} 
                              />
                            )}
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
                    );
                  })}
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
                zIndex: 1000, padding: '20px'
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
                  deadline={courseDeadline}
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
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '8%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Commit Message</th>
                    <th>Author</th>
                    <th>Date/Time</th>
                    <th>Impact Changes</th>
                    <th>Code</th>
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
                        <td>
                          <button 
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => setSelectedCommitHash(c.hash)}
                            title="View Code Diffs"
                          >
                            <Code size={14} />
                          </button>
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
                  <table className="custom-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <colgroup>
                      <col style={{ width: '40%' }} />
                      <col style={{ width: '18%' }} />
                      <col style={{ width: '22%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '8%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ width: '40%' }}>Commit Message</th>
                        <th>Author</th>
                        <th>Date/Time</th>
                        <th>Impact Changes</th>
                        <th>Code</th>
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
                            <td>
                              <button 
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => setSelectedCommitHash(c.hash)}
                                title="View Code Diffs"
                              >
                                <Code size={14} />
                              </button>
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



      {analytics && activeTab === 'qualitative' && (() => {
        // Status badge

        // Status badge
        const statusBadge = () => {
          if (isRunning) return <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'3px 10px', borderRadius:'20px', backgroundColor:'rgba(99,102,241,0.15)', color:'var(--primary)', fontSize:'0.78rem', fontWeight:'600', border:'1px solid rgba(99,102,241,0.3)' }}><span style={{width:'6px',height:'6px',borderRadius:'50%',backgroundColor:'var(--primary)',animation:'pulse 1.2s infinite'}} />Running</span>;
          if (isCancelling) return <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'3px 10px', borderRadius:'20px', backgroundColor:'rgba(251,191,36,0.15)', color:'#f59e0b', fontSize:'0.78rem', fontWeight:'600', border:'1px solid rgba(251,191,36,0.3)' }}>Cancelling...</span>;
          if (isComplete) return <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'3px 10px', borderRadius:'20px', backgroundColor:'rgba(16,185,129,0.15)', color:'#10b981', fontSize:'0.78rem', fontWeight:'600', border:'1px solid rgba(16,185,129,0.3)' }}><CheckCircle2 size={12} />Complete</span>;
          if (qualStatus === 'cancelled') return <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'3px 10px', borderRadius:'20px', backgroundColor:'rgba(239,68,68,0.12)', color:'#ef4444', fontSize:'0.78rem', fontWeight:'600', border:'1px solid rgba(239,68,68,0.3)' }}>Stopped</span>;
          return <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'3px 10px', borderRadius:'20px', backgroundColor:'var(--bg-app)', color:'var(--text-muted)', fontSize:'0.78rem', fontWeight:'600', border:'1px solid var(--border-color)' }}><Clock size={12} />Idle</span>;
        };

        return (
          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <style>{`
              @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
            `}</style>

            {/* ── Row 1: Controls + Progress ─────────────────────────────── */}
            <div className="card" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: isRunning ? '16px' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Bot size={20} style={{ color: 'var(--primary)' }} />
                  <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-main)' }}>
                    Local AI Qualitative Analysis
                  </h2>
                  {statusBadge()}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {/* Sampling mode selector — always visible */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '2px', backgroundColor: 'var(--bg-app)' }}>
                    {[['sample', 'Smart'], ['full', 'Full'], ['random', 'Random']].map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSamplingMode(m)}
                        disabled={isRunning || isCancelling}
                        style={{
                          padding: '3px 9px', borderRadius: '4px', fontSize: '0.73rem', fontWeight: '600',
                          border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                          backgroundColor: samplingMode === m ? 'var(--primary)' : 'transparent',
                          color: samplingMode === m ? '#fff' : 'var(--text-muted)',
                        }}
                        title={m === 'sample' ? 'Stratified Smart-Sampling: always-include high-signal commits + 20% per contributor' : m === 'full' ? 'Process every commit (slow on large repos)' : 'Pure random 20% of all commits'}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Start button — only when idle/cancelled */}
                  {isIdle && (
                    <button type="button" className="btn btn-secondary"
                      onClick={() => onStartQualitative(false)}
                      style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'0.85rem', color:'var(--primary)', borderColor:'var(--primary)' }}
                    >
                      <Play size={14} /><span>Start Analysis</span>
                    </button>
                  )}
                  {/* Stop button — only when running */}
                  {(isRunning || isCancelling) && (
                    <button type="button" className="btn btn-secondary"
                      onClick={onStopQualitative}
                      disabled={isCancelling}
                      style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'0.85rem', borderColor:'#ef4444', color:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)' }}
                    >
                      <Square size={14} /><span>{isCancelling ? 'Cancelling...' : 'Stop'}</span>
                    </button>
                  )}
                  {/* Re-analyze — always available */}
                  <button type="button" className="btn btn-secondary"
                    onClick={() => onStartQualitative(true)}
                    disabled={isRunning || isCancelling}
                    style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'0.85rem' }}
                    title="Clear DB cache and re-run from scratch"
                  >
                    <RefreshCw size={14} /><span>Re-analyze</span>
                  </button>
                  {/* View raw JSON */}
                  <button type="button" className="btn btn-secondary"
                    onClick={() => setShowRawDataInspector(!showRawDataInspector)}
                    style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'0.85rem' }}
                  >
                    <Code size={14} /><span>{showRawDataInspector ? 'Hide JSON' : 'View Output JSON'}</span>
                  </button>
                </div>
              </div>

              {/* Progress bar — only when running */}
              {(isRunning || isCancelling) && (
                <div style={{ marginTop: '8px' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {qualMessage || 'Processing...'}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--bg-app)', borderRadius: '5px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                      <div style={{ height: '100%', width: `${qualProgress}%`, background: 'linear-gradient(90deg, var(--primary), #818cf8)', borderRadius: '5px', transition: 'width 0.4s ease-out' }} />
                    </div>
                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--primary)', minWidth: '42px', textAlign: 'right' }}>{qualProgress}%</span>
                  </div>
                </div>
              )}

              {/* Done status message */}
              {isComplete && (
                <p style={{ margin: '8px 0 0 0', fontSize: '0.82rem', color: '#10b981' }}>
                  ✓ {qualMessage}
                </p>
              )}
              {qualStatus === 'cancelled' && (
                <p style={{ margin: '8px 0 0 0', fontSize: '0.82rem', color: '#ef4444' }}>
                  {qualMessage}
                </p>
              )}
            </div>

            {/* ── Row 2: Output JSON Inspector ───────────────────────────── */}
            {showRawDataInspector && (
              <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(90deg, rgba(99,102,241,0.08), transparent)' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--primary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Preprocessed JSON Output — Cloud Model Input Payload
                  </span>
                  <button type="button" onClick={() => setShowRawDataInspector(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                    <X size={14} />
                  </button>
                </div>
                <div style={{ height: '320px', overflowY: 'auto' }}>
                  {isRunning ? (
                    <div style={{ padding: '20px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>
                      Analysis in progress... JSON will appear here upon completion.
                    </div>
                  ) : qualData ? (
                    <pre style={{ margin: 0, padding: '16px', fontFamily: 'Fira Code, Consolas, monospace', fontSize: '0.78rem', color: 'var(--text-main)', overflowX: 'auto', lineHeight: '1.6', backgroundColor: 'var(--bg-app)' }}>
                      {JSON.stringify(qualData, null, 2)}
                    </pre>
                  ) : (
                    <div style={{ padding: '20px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>
                      No qualitative data yet. Start analysis to generate output.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Row 3: Individual Student Qualitative Contributions Table ── */}
            {qualData && qualData.contributors && (
              <div className="card" style={{ padding: '24px' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-main)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <User size={20} style={{ color: 'var(--primary)' }} />
                  <span>Individual Student Qualitative Contributions</span>
                </h2>
                <div className="table-container">
                  <table className="custom-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }}>Student Name</th>
                        <th style={{ width: '15%' }}>Commit Share</th>
                        <th style={{ width: '15%' }}>LOC Share</th>
                        <th style={{ width: '15%' }}>Vague Msg %</th>
                        <th style={{ width: '15%' }}>Msg Mismatch %</th>
                        <th style={{ width: '10%' }}>AI Risk</th>
                        <th style={{ width: '23%' }}>Status / Red Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(qualData.contributors).map(([name, info]) => {
                        const stats = info.stats || {};
                        const riskScore = stats.ai_risk_score ?? 0;
                        const isFreeRider = stats.free_rider_suspected ?? false;
                        const flags = stats.detected_red_flags || [];

                        // Risk Badge style helper
                        const getRiskBadge = (score) => {
                          const color = score >= 7 ? '#ef4444' : score >= 5 ? '#f59e0b' : '#10b981';
                          const bg = score >= 7 ? 'rgba(239,68,68,0.1)' : score >= 5 ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)';
                          return (
                            <span style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              backgroundColor: bg,
                              color: color,
                              fontWeight: '700',
                              fontSize: '0.82rem'
                            }}>
                              {score}/10
                            </span>
                          );
                        };

                        return (
                          <tr key={name}>
                            <td className="student-info-cell" style={{ fontWeight: '600' }}>{name}</td>
                            <td>{stats.commit_share_percentage ?? 0}%</td>
                            <td>{stats.loc_share_percentage ?? 0}%</td>
                            <td style={{ color: stats.vague_message_percentage > 30 ? '#ef4444' : 'inherit' }}>
                              {stats.vague_message_percentage ?? 0}%
                            </td>
                            <td style={{ color: stats.message_mismatch_percentage > 20 ? '#ef4444' : 'inherit' }}>
                              {stats.message_mismatch_percentage ?? 0}%
                            </td>
                            <td>{getRiskBadge(riskScore)}</td>
                            <td>
                              {isFreeRider ? (
                                <Tag 
                                  text="Free-rider Risk" 
                                  variant="danger" 
                                  style={{ fontSize: '10px', padding: '3px 6px', fontWeight: '700' }}
                                  title={flags.join(', ')}
                                />
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Good Standing</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Row 4: Cloud AI Final Report ──────────────────────────── */}
            <div className="card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bot size={20} style={{ color: 'var(--primary)' }} />
                  <span>Cloud AI Final Report (Gemini)</span>
                </h2>
              </div>
              
              {!qualData && !isComplete && (
                <div style={{ padding: '20px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Info size={16} />
                  Run the local AI analysis first to gather project data.
                </div>
              )}

              {(qualData || isComplete) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {cloudError === 'NO_API_KEY' ? (
                    <div style={{ padding: '20px', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', color: '#f59e0b', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <AlertCircle size={18} />
                        <span><strong>API Key Not Enabled:</strong> You must configure a Cloud AI API key in Settings to generate the final report.</span>
                      </div>
                      <button 
                        onClick={onBack}
                        style={{ padding: '6px 12px', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}
                      >
                        Close & Go to Settings
                      </button>
                    </div>
                  ) : cloudError ? (
                    <div style={{ padding: '16px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#ef4444', fontSize: '0.9rem' }}>
                      <strong>Error generating report:</strong> {cloudError}
                    </div>
                  ) : null}

                  {!cloudReport ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '30px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                      <button 
                        onClick={generateCloudReport}
                        disabled={isCloudGenerating}
                        className="btn btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.95rem' }}
                      >
                        {isCloudGenerating ? (
                          <>
                            <RefreshCw size={16} className="spin" />
                            Generating PDF Report...
                          </>
                        ) : (
                          <>
                            <Bot size={16} />
                            Generate & Download PDF Report
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div style={{ padding: '24px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                      <div style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                        ✓ {cloudReport}
                      </div>
                      <button 
                        onClick={generateCloudReport}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}
                      >
                        <RefreshCw size={16} />
                        Regenerate & Download PDF
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}



      {selectedCommitHash && (
        <CommitCodeViewModal 
          commitHash={selectedCommitHash}
          onClose={() => setSelectedCommitHash(null)}
        />
      )}

      {showFileBrowserModal && (
        <FileBrowserModal
          project={project}
          onClose={() => setShowFileBrowserModal(false)}
        />
      )}

    </div>
  );
}

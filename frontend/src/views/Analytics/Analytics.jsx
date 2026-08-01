import React, { useEffect, useState, useRef } from 'react';
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
import './Analytics.css';

export default function Analytics({ project, onBack, qualAnalysisState, onStartQualitative, onStopQualitative }) {
  const [analytics, setAnalytics] = useState(null);
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('quantitative');
  const [showCommitsModal, setShowCommitsModal] = useState(false);
  const [showFileBrowserModal, setShowFileBrowserModal] = useState(false);
  const [showRawDataInspector, setShowRawDataInspector] = useState(false);
  const [showLiveLogs, setShowLiveLogs] = useState(true);
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState(null);
  const logEndRef = useRef(null);

  // Shorthand aliases for cleaner JSX
  const qualStatus = qualAnalysisState?.status || 'idle';
  const qualProgress = qualAnalysisState?.progress || 0;
  const qualMessage = qualAnalysisState?.message || '';
  const qualLogs = qualAnalysisState?.logs || [];
  const qualData = qualAnalysisState?.data || null;
  const isRunning = qualStatus === 'running';
  const isCancelling = qualStatus === 'cancelling';
  const isComplete = qualStatus === 'complete';
  const isIdle = qualStatus === 'idle' || qualStatus === 'cancelled';

  // Auto-scroll live log terminal to bottom on new entries
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [qualLogs.length]);







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

  const triggerQualitativeAnalysis = async (forceRefresh = false) => {
    setLoadingQualitative(true);
    setQualitativeProgress(5);
    setQualitativeStatusMsg(forceRefresh ? 'Re-analyzing project with local AI model...' : 'Initializing local AI classification pipeline...');
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const token = localStorage.getItem('token');
    
    try {
      const url = `/api/v1/projects/${project.id}/qualitative-analysis${forceRefresh ? '?force_refresh=true' : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: controller.signal
      });
      
      if (!res.ok) throw new Error('Failed to start qualitative analysis.');
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // save incomplete trailing string
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line.trim());
              if (event.type === 'progress') {
                setQualitativeProgress(event.progress || 0);
                if (event.message) setQualitativeStatusMsg(event.message);
                if (event.log_entry) {
                  setQualitativeLogs(prev => [...prev, event.log_entry]);
                }
              } else if (event.type === 'complete') {
                setQualitativeData(event.data);
                setQualitativeProgress(100);
                setQualitativeStatusMsg('Analysis Complete!');
                setLoadingQualitative(false);
              } else if (event.type === 'cancelled') {
                setQualitativeProgress(0);
                setQualitativeStatusMsg('Analysis stopped by user.');
                setLoadingQualitative(false);
              }
            } catch (jsonErr) {
              console.error("Stream line parse error:", jsonErr);
            }
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error("Qualitative stream error:", e);
        setQualitativeStatusMsg('Error running local AI analysis.');
      }
      setLoadingQualitative(false);
    }
  };

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
        let projectStartDate = 'N/A';
        let projectEndDate = 'N/A';
        let projectDurationDays = 0;
        let totalDeletions = 0;
        let totalSquashes = 0;
        let uniqueBranches = new Set();

        if (commits && commits.length > 0) {
          const sortedCommits = [...commits].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          const firstCommit = new Date(sortedCommits[0].timestamp);
          const lastCommit = new Date(sortedCommits[sortedCommits.length - 1].timestamp);
          projectStartDate = firstCommit.toLocaleDateString();
          projectEndDate = lastCommit.toLocaleDateString();
          projectDurationDays = Math.ceil((lastCommit - firstCommit) / (1000 * 60 * 60 * 24)) || 1;
          commits.forEach(c => {
            totalDeletions += (c.deletions || 0);
            if (c.is_squash_suspected) totalSquashes += 1;
            if (c.branches) c.branches.split(',').forEach(b => uniqueBranches.add(b.trim()));
          });
        }
        const netCodeVolume = analytics.total_insertions - totalDeletions;

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

            {/* ── Row 3: Live Log Terminal ────────────────────────────────── */}
            <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowLiveLogs(v => !v)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: '700', color: '#60a5fa', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Live Ollama Log Stream
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    ({qualLogs.length} commits processed)
                  </span>
                </div>
                {showLiveLogs ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
              </div>

              {showLiveLogs && (
                <div style={{ backgroundColor: '#090d16', padding: '12px 16px', maxHeight: '380px', overflowY: 'auto', fontFamily: 'Fira Code, Consolas, monospace', fontSize: '0.78rem', lineHeight: '1.5' }}>
                  {qualLogs.length === 0 ? (
                    <div style={{ color: '#475569', fontStyle: 'italic' }}>
                      {isRunning ? 'Waiting for first commit inference...' : 'No logs yet. Start analysis to see live output.'}
                    </div>
                  ) : (
                    qualLogs.map((log, i) => (
                      <div key={i} style={{ marginBottom: '12px', borderBottom: '1px dashed #1e2636', paddingBottom: '10px' }}>
                        <div style={{ color: '#38bdf8', fontWeight: '600', marginBottom: '3px' }}>
                          [{log.step}/{log.total}] {log.author} — Commit <code style={{ color: '#7dd3fc' }}>{log.hash}</code>
                        </div>
                        <div style={{ color: '#fbbf24', margin: '2px 0 2px 8px' }}>
                          <strong>INPUT:</strong> &quot;{log.input?.message?.slice(0, 80)}{log.input?.message?.length > 80 ? '...' : ''}&quot;
                        </div>
                        {log.input?.diff && log.input.diff !== 'No diff body available.' && (
                          <pre style={{ margin: '0 0 4px 8px', padding: '4px 8px', backgroundColor: '#0f172a', color: '#94a3b8', borderRadius: '4px', fontSize: '0.72rem', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden', border: '1px solid #1e293b' }}>
                            {log.input.diff}
                          </pre>
                        )}
                        <div style={{ color: '#4ade80', margin: '2px 0 2px 8px' }}>
                          <strong>OUTPUT:</strong>{' '}
                          <span style={{ color: '#86efac' }}>
                            type={log.output?.type} | sub={log.output?.substance} | quality={log.output?.message_quality} | ai={log.output?.ai_generated_likelihood}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>

            {/* ── Row 4: Overall Project Status ──────────────────────────── */}
            <div className="card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bot size={20} style={{ color: 'var(--primary)' }} />
                  <span>Overall Project Analysis Summary</span>
                  {isRunning && (
                    <span style={{ fontSize: '0.73rem', fontWeight: '500', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      (partial — analysis in progress)
                    </span>
                  )}
                </h2>
                {!qualData && !isRunning && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    AI data shown after analysis completes
                  </span>
                )}
              </div>

              {(() => {
                // ── Derive all display values ────────────────────────────────
                const ps = qualData?.project_summary;

                // Commit type distribution (from qualData or empty)
                const typeDist = ps?.type_distribution || {};
                const totalSampled = ps?.sampled_commits || 0;
                const typeOrder = ['feature', 'bugfix', 'refactor', 'docs', 'test', 'config', 'style', 'merge', 'other'];
                const typeColors = {
                  feature: '#6366f1', bugfix: '#ef4444', refactor: '#f59e0b',
                  docs: '#3b82f6', test: '#8b5cf6', config: '#14b8a6',
                  style: '#ec4899', merge: '#64748b', other: '#94a3b8'
                };

                // Substance distribution
                const subDist = ps?.substance_distribution || {};
                const totalSub = (subDist.substantial || 0) + (subDist.moderate || 0) + (subDist.trivial || 0);

                // Code Smells
                const codeSmells = ps?.code_smell_distribution || {};
                const codeSmellsEntries = Object.entries(codeSmells).filter(([k]) => k !== 'none');

                // Architecture Issues
                const archIssues = ps?.architecture_issue_distribution || {};
                const archIssuesEntries = Object.entries(archIssues).filter(([k]) => k !== 'none');

                // Code resurrection flags
                const resurrectionFlags = ps?.code_resurrection_flags || [];

                // Peer review
                const peerReview = ps?.peer_review_summary || {};

                // Metric pill helper
                const MetricPill = ({ label, value, color, bg }) => (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: '6px', backgroundColor: bg || 'var(--bg-card)', border: '1px solid var(--border-color)', marginBottom: '5px' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{label}</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: color || 'var(--text-main)' }}>{value}</span>
                  </div>
                );

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '16px' }}>

                    {/* ── Card 1: Project Scope ──────────────────────────── */}
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Project Scope
                      </h4>
                      <MetricPill label="Project" value={project.name} />
                      <MetricPill label="Total Commits" value={analytics.total_commits} />
                      <MetricPill label="Analysed by AI" value={totalSampled > 0 ? `${totalSampled} commits` : '—'} color={totalSampled > 0 ? 'var(--primary)' : 'var(--text-muted)'} />
                      <MetricPill label="Contributors" value={analytics.contributions?.length || 0} />
                      <MetricPill label="Net Code Volume" value={`+${netCodeVolume} lines`} color="#10b981" />
                      <MetricPill label="Gini Coefficient" value={`${analytics.gini_coefficient?.toFixed(2)} (${analytics.distribution_status})`} />
                      <MetricPill label="Timespan" value={`${projectStartDate} → ${projectEndDate}`} />
                      <MetricPill label="Active Days" value={`${projectDurationDays} days`} />
                      <MetricPill label="Branches" value={`${uniqueBranches.size > 0 ? Array.from(uniqueBranches).slice(0, 3).join(', ') : 'main'}`} />
                      <MetricPill label="Languages" value={Object.keys(analytics.language_distribution || {}).join(', ') || 'N/A'} color="var(--primary)" />
                    </div>

                    {/* ── Card 2: Commit Quality (AI) ──────────────────── */}
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Commit Quality — AI Labels
                      </h4>
                      {!ps ? (
                        <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.83rem', margin: '8px 0 0 0' }}>Run analysis to see AI-generated commit quality data.</p>
                      ) : (
                        <>
                          <MetricPill
                            label="Vague Messages"
                            value={`${ps.vague_message_percentage}%`}
                            color={ps.vague_message_percentage > 40 ? '#ef4444' : ps.vague_message_percentage > 20 ? '#f59e0b' : '#10b981'}
                            bg={ps.vague_message_percentage > 40 ? 'rgba(239,68,68,0.07)' : undefined}
                          />
                          <MetricPill
                            label="Message ↔ Code Mismatch"
                            value={`${ps.message_mismatch_percentage}%`}
                            color={ps.message_mismatch_percentage > 30 ? '#f59e0b' : '#10b981'}
                          />
                          <MetricPill
                            label="Substantial/Trivial Ratio"
                            value={ps.substantial_to_trivial_ratio ?? '—'}
                            color={ps.substantial_to_trivial_ratio > 1 ? '#10b981' : '#f59e0b'}
                          />
                          {/* Substance bar chart */}
                          <div style={{ marginTop: '10px', marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>Commit Substance</span>
                            {(['substantial', 'moderate', 'trivial']).map(sub => {
                              const count = subDist[sub] || 0;
                              const pct = totalSub > 0 ? Math.round((count / totalSub) * 100) : 0;
                              const col = sub === 'substantial' ? '#10b981' : sub === 'moderate' ? '#6366f1' : '#f59e0b';
                              return (
                                <div key={sub} style={{ marginBottom: '5px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                    <span style={{ textTransform: 'capitalize' }}>{sub}</span>
                                    <span style={{ color: col, fontWeight: '600' }}>{count} ({pct}%)</span>
                                  </div>
                                  <div style={{ height: '5px', borderRadius: '3px', backgroundColor: 'var(--bg-card)', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: col, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* Type distribution mini tags */}
                          <div style={{ marginTop: '10px' }}>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>Commit Types</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {typeOrder.filter(t => typeDist[t] > 0).map(t => (
                                <span key={t} style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '0.73rem', fontWeight: '600', backgroundColor: `${typeColors[t]}22`, color: typeColors[t], border: `1px solid ${typeColors[t]}44` }}>
                                  {t}: {typeDist[t]}
                                </span>
                              ))}
                              {Object.keys(typeDist).length === 0 && (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>—</span>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* ── Card 3: Risk Flags (AI) ──────────────────────── */}
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Risk Flags — AI Labels
                      </h4>
                      {!ps ? (
                        <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.83rem', margin: '8px 0 0 0' }}>Run analysis to see security and code quality risk data.</p>
                      ) : (
                        <>
                          <MetricPill
                            label="🔒 Security Risk Commits"
                            value={ps.security_risk_commits}
                            color={ps.security_risk_commits > 0 ? '#ef4444' : '#10b981'}
                            bg={ps.security_risk_commits > 0 ? 'rgba(239,68,68,0.07)' : undefined}
                          />

                          <MetricPill
                            label="🔁 Code Resurrection Flags"
                            value={resurrectionFlags.length}
                            color={resurrectionFlags.length > 0 ? '#ef4444' : '#10b981'}
                            bg={resurrectionFlags.length > 0 ? 'rgba(239,68,68,0.07)' : undefined}
                          />
                          <MetricPill
                            label="⭐ Peer Review Score"
                            value={`${peerReview.average_quality_score ?? '—'}/10`}
                            color={peerReview.average_quality_score >= 7 ? '#10b981' : peerReview.average_quality_score >= 5 ? '#f59e0b' : '#ef4444'}
                          />
                          <MetricPill
                            label="Constructive Reviews"
                            value={peerReview.constructive_reviews ?? '—'}
                            color="var(--primary)"
                          />
                          <MetricPill label="Rubber Stamps" value={peerReview.rubber_stamps ?? '—'} />
                          <MetricPill label="Suspected Squashes" value={totalSquashes} />

                          {/* Code Smells list */}
                          {codeSmellsEntries.length > 0 && (
                            <div style={{ marginTop: '10px' }}>
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>Code Smells Detected</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {codeSmellsEntries.map(([k, v]) => (
                                  <span key={k} style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '0.73rem', fontWeight: '600', backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
                                    {k.replace(/_/g, ' ')}: {v}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Architecture Issues list */}
                          {archIssuesEntries.length > 0 && (
                            <div style={{ marginTop: '10px' }}>
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>Architecture Issues</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {archIssuesEntries.map(([k, v]) => (
                                  <span key={k} style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '0.73rem', fontWeight: '600', backgroundColor: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}>
                                    {k.replace(/_/g, ' ')}: {v}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {codeSmellsEntries.length === 0 && archIssuesEntries.length === 0 && (
                            <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <CheckCircle2 size={13} /> Code looks clean (No major smells or architecture issues)
                            </div>
                          )}

                          {/* Code resurrection details */}
                          {resurrectionFlags.length > 0 && (
                            <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                              <span style={{ fontSize: '0.78rem', color: '#ef4444', fontWeight: '600', display: 'block', marginBottom: '4px' }}>⚠ Code Resurrection Details</span>
                              {resurrectionFlags.map((f, i) => (
                                <div key={i} style={{ fontSize: '0.77rem', color: 'var(--text-muted)', marginBottom: '5px', padding: '5px 8px', backgroundColor: 'rgba(239,68,68,0.06)', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.15)' }}>
                                  <strong style={{ color: '#fca5a5' }}>{f.original_author}</strong> → <strong style={{ color: '#fca5a5' }}>{f.restored_author}</strong>
                                  <span style={{ color: '#f87171', marginLeft: '4px' }}>({f.similarity_type?.replace(/_/g, ' ')})</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                  </div>
                );
              })()}
            </div>

            {/* ── Row 5: Student Qualitative Analysis ──────────────────────── */}
            <div className="card" style={{ padding: '24px' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-main)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={20} style={{ color: 'var(--primary)' }} />
                <span>Student Qualitative Analysis Data</span>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {analytics.contributions?.map((contrib) => {
                  const authorCommits = commits.filter(c => c.author_id === contrib.author_id);
                  const avgCommitSize = contrib.commit_count > 0 ? Math.round(contrib.lines_added / contrib.commit_count) : 0;
                  let firstActive = 'N/A', lastActive = 'N/A', authorSquashes = 0;
                  const activeDays = new Set();
                  if (authorCommits.length > 0) {
                    const sorted = [...authorCommits].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                    firstActive = new Date(sorted[0].timestamp).toLocaleDateString();
                    lastActive = new Date(sorted[sorted.length - 1].timestamp).toLocaleDateString();
                    authorCommits.forEach(c => {
                      if (c.is_squash_suspected) authorSquashes++;
                      activeDays.add(new Date(c.timestamp).toISOString().split('T')[0]);
                    });
                  }
                  const refactoringRatio = contrib.lines_added > 0 ? (contrib.lines_removed / contrib.lines_added * 100).toFixed(1) : 0;
                  const linesPerDay = activeDays.size > 0 ? Math.round(contrib.lines_added / activeDays.size) : 0;
                  // Qualitative labels for this author
                  const authorQual = qualData?.contributors?.[contrib.name];

                  return (
                    <div key={contrib.author_id} style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>
                          {contrib.name} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>({contrib.email})</span>
                        </h3>
                        <div style={{ display: 'flex', gap: '10px', fontSize: '0.82rem', fontWeight: '600' }}>
                          <span style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '3px 8px', borderRadius: '4px' }}>{contrib.contribution_percentage?.toFixed(1)}% Share</span>
                          <span style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-main)', padding: '3px 8px', borderRadius: '4px' }}>{contrib.commit_count} Commits</span>
                          {authorQual && (
                            <span style={{ backgroundColor: 'rgba(99,102,241,0.12)', color: 'var(--primary)', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(99,102,241,0.3)' }}>
                              {authorQual.stats?.sampled_commits} sampled
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                        <div>
                          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Quantitative Metrics</h4>
                          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                            <li>Lines Added: <strong style={{ color: '#10b981' }}>+{contrib.lines_added}</strong></li>
                            <li>Lines Removed: <strong style={{ color: '#ef4444' }}>-{contrib.lines_removed || 0}</strong> ({refactoringRatio}% refactor)</li>
                            <li>Avg Commit Size: <strong>{avgCommitSize} lines</strong></li>
                            <li>Active Days: <strong>{activeDays.size}</strong> (~{linesPerDay} lines/day)</li>
                            <li>Timeline: <strong>{firstActive} → {lastActive}</strong></li>
                            <li>Suspected Squashes: <strong>{authorSquashes}</strong></li>
                          </ul>
                        </div>

                        {authorQual && (
                          <div>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>AI Labels</h4>
                            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                              <li>Vague Messages: <strong style={{ color: authorQual.stats.vague_message_percentage > 40 ? '#ef4444' : '#10b981' }}>{authorQual.stats.vague_message_percentage}%</strong></li>
                              <li>Msg Mismatch: <strong style={{ color: authorQual.stats.message_mismatch_percentage > 30 ? '#f59e0b' : '#10b981' }}>{authorQual.stats.message_mismatch_percentage}%</strong></li>
                              <li>Security Risks: <strong style={{ color: authorQual.stats.security_risk_commits > 0 ? '#ef4444' : 'inherit' }}>{authorQual.stats.security_risk_commits}</strong></li>
                              {Object.keys(authorQual.stats.code_smell_distribution || {}).length > 0 && (
                                <li style={{ color: '#ef4444' }}>Code Smells: <strong>{Object.values(authorQual.stats.code_smell_distribution).reduce((a, b) => a + b, 0)}</strong></li>
                              )}
                              {Object.keys(authorQual.stats.architecture_issue_distribution || {}).length > 0 && (
                                <li style={{ color: '#f59e0b' }}>Arch. Issues: <strong>{Object.values(authorQual.stats.architecture_issue_distribution).reduce((a, b) => a + b, 0)}</strong></li>
                              )}
                            </ul>
                          </div>
                        )}

                        <div>
                          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Recent Commit Messages</h4>
                          <div style={{ maxHeight: '120px', overflowY: 'auto', backgroundColor: 'var(--bg-card)', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-main)' }}>
                            {authorCommits.length > 0 ? (
                              <ul style={{ margin: 0, paddingLeft: '14px' }}>
                                {authorCommits.slice(0, 4).map(c => (
                                  <li key={c.hash} style={{ marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.message}>{c.message}</li>
                                ))}
                              </ul>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>No commits found.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
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

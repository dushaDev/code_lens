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
  ChevronUp,
  FolderTree,
  FileText,
  ShieldAlert,
  Layers,
  Activity,
  GitBranch,
  Zap,
  Sparkles,
  ChevronRight,
  Check
} from 'lucide-react';
import Tag from '../../components/Tag';
import Tooltip from '../../components/Tooltip';
import CommitActivityChart from '../../components/CommitActivityChart';
import CommitCodeViewModal from '../../components/CommitCodeViewModal';
import FileBrowserModal from '../../components/FileBrowserModal';
import { formatDeadline } from '../../utils/courseMeta';
import { useNavigation } from '../../contexts/NavigationContext';
import './Analytics.css';

export default function Analytics({ project, course, onBack, qualAnalysisState, onStartQualitative, onStopQualitative }) {
  const { navigate } = useNavigation();
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
  const [expandedQualContributor, setExpandedQualContributor] = useState(null);

  const [cloudReport, setCloudReport] = useState(null);
  const [isCloudGenerating, setIsCloudGenerating] = useState(false);
  const [isPdfDownloading, setIsPdfDownloading] = useState(false);
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

  // Live Timer & ETA Calculation for Local AI Qualitative Analysis
  const [startTime, setStartTime] = useState(null);
  const [nowTime, setNowTime] = useState(Date.now());

  useEffect(() => {
    if (isRunning || isCancelling) {
      if (!startTime) {
        setStartTime(Date.now());
      }
      const interval = setInterval(() => {
        setNowTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setStartTime(null);
    }
  }, [isRunning, isCancelling, startTime]);

  const elapsedSec = startTime ? Math.max(0, Math.floor((nowTime - startTime) / 1000)) : 0;
  const etaSec = (startTime && qualProgress > 3 && qualProgress < 100)
    ? Math.max(0, Math.round(((100 - qualProgress) / qualProgress) * elapsedSec))
    : null;

  // Stuck-init detector: running for >30s but still at 0% means Ollama / model isn't responding
  const isStuckInitializing = isRunning && qualProgress === 0 && elapsedSec > 30;

  const formatSeconds = (sec) => {
    if (sec === null || isNaN(sec) || sec < 0) return null;
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };







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
        const [analyticsRes, commitsRes, cloudReportRes] = await Promise.all([
          // TODO: migrate to apiFetch
          fetch(`/api/v1/projects/${project.id}/analytics`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          // TODO: migrate to apiFetch
          fetch(`/api/v1/projects/${project.id}/commits`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          // TODO: migrate to apiFetch
          fetch(`/api/v1/projects/${project.id}/cloud-report`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);
        if (!analyticsRes.ok) throw new Error('Failed to load project analytics.');
        const analyticsData = await analyticsRes.json();
        const commitsData = commitsRes.ok ? await commitsRes.json() : { commits: [] };
        setAnalytics(analyticsData);
        setCommits(commitsData.commits || []);

        if (cloudReportRes && cloudReportRes.ok) {
          const cloudData = await cloudReportRes.json();
          if (cloudData && cloudData.cloud_report) {
            setCloudReport(cloudData.cloud_report);
          } else {
            setCloudReport(null);
          }
        } else {
          setCloudReport(null);
        }
      } catch (err) {
        setError(err.message || 'Failed to load project analytics. Please check backend connection.');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [project]);
  // Sync sampling mode from completed qualitative analysis data if available
  useEffect(() => {
    if (qualData?.project_summary?.sampling_mode) {
      setSamplingMode(qualData.project_summary.sampling_mode);
    }
  }, [qualData]);

  // When entering qualitative tab: if idle, check backend/DB status then auto-start
  useEffect(() => {
    if (activeTab !== 'qualitative') return;
    // Already running or complete: nothing to do, just display
    if (isRunning || isCancelling || isComplete) return;
    // If idle: check backend status, then auto-start if no cache found
    const checkAndStart = async () => {
      try {
        const token = localStorage.getItem('token');
        // TODO: migrate to apiFetch
        const res = await fetch(`/api/v1/projects/${project.id}/qualitative-analysis/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Status check failed');
        const statusData = await res.json();

        // By the time the fetch resolved, App.jsx may have already changed the state
        // (e.g. a prior render already kicked off the stream). Re-check before acting.
        const currentStatus = qualAnalysisState?.status || 'idle';
        if (currentStatus === 'running' || currentStatus === 'cancelling' || currentStatus === 'complete') {
          return; // someone else started it — don't double-fire
        }

        if (statusData.status === 'running') {
          // Backend is running but this session lost the stream — just show status
          return;
        }
        if (statusData.status === 'complete' || statusData.has_db_cache) {
          // DB has cached data — start stream (will return instantly from cache)
          onStartQualitative(false, samplingMode);
          return;
        }
        // Truly idle, no cache: auto-start
        onStartQualitative(false, samplingMode);
      } catch (err) {
        console.error('Status check failed, auto-starting:', err);
        const currentStatus = qualAnalysisState?.status || 'idle';
        if (currentStatus === 'idle' || currentStatus === 'cancelled') {
          onStartQualitative(false, samplingMode);
        }
      }
    };
    checkAndStart();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, project.id]);

  useEffect(() => {
    if (project && project.sampling_mode) {
      setSamplingMode(project.sampling_mode);
    }
  }, [project]);

  // NOTE: early returns for loading/error/empty states live just before the
  // main `return` below — they MUST come after every hook (incl. the cloud-report
  // useEffect) so the number of hooks is identical on every render. Placing them
  // here would skip later hooks once data loads, crashing the whole view (blank page).

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

  const getVerdictBadgeStyle = (verdict) => {
    const v = (verdict || "").toLowerCase();
    if (v.startsWith("low risk")) {
      return { backgroundColor: 'rgba(16,185,129,0.12)', color: '#10b981', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.2)', fontWeight: '600', fontSize: '0.8rem' };
    }
    if (v.startsWith("moderate risk") || v.startsWith("medium risk")) {
      return { backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.2)', fontWeight: '600', fontSize: '0.8rem' };
    }
    if (v.startsWith("high risk")) {
      return { backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.2)', fontWeight: '600', fontSize: '0.8rem' };
    }
    return { backgroundColor: 'var(--bg-app)', color: 'var(--text-muted)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: '600', fontSize: '0.8rem' };
  };

  const getRiskScoreBadgeStyle = (score) => {
    const s = (score || "").toLowerCase();
    if (s.includes("high") || s.includes("7/") || s.includes("8/") || s.includes("9/") || s.includes("10/")) {
      return { backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '4px 10px', borderRadius: '12px', fontWeight: '700', fontSize: '0.85rem' };
    }
    if (s.includes("mod") || s.includes("medium") || s.includes("4/") || s.includes("5/") || s.includes("6/")) {
      return { backgroundColor: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', padding: '4px 10px', borderRadius: '12px', fontWeight: '700', fontSize: '0.85rem' };
    }
    return { backgroundColor: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', padding: '4px 10px', borderRadius: '12px', fontWeight: '700', fontSize: '0.85rem' };
  };

  const getComplexityBadge = (avgScore) => {
    const cx = parseFloat(avgScore) || 0;
    if (cx <= 5) return { label: 'Low — straightforward & maintainable', color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.25)' };
    if (cx <= 10) return { label: 'Moderate — acceptable complexity', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' };
    if (cx <= 20) return { label: 'High — heavily branched code', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)' };
    return { label: 'Very High — deeply nested logic', color: '#dc2626', bg: 'rgba(220,38,38,0.15)', border: 'rgba(220,38,38,0.3)' };
  };

  const getModularityBadge = (scoreStr) => {
    const s = (scoreStr || '').toLowerCase();
    if (s.includes('high')) return { label: scoreStr, color: '#10b981', bg: 'rgba(16,185,129,0.12)' };
    if (s.includes('mod')) return { label: scoreStr, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
    return { label: scoreStr || 'Monolithic', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' };
  };

  const getDocScoreBadge = (docStr) => {
    const d = (docStr || '').toLowerCase();
    if (d.includes('comp') || d.includes('9/') || d.includes('8/')) return { color: '#10b981', bg: 'rgba(16,185,129,0.12)' };
    if (d.includes('basic') || d.includes('5/')) return { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
    return { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
  };

  const smellDescriptions = {
    magic_numbers: 'Magic Numbers — raw numeric literals used in logic instead of named constants, making intent unclear',
    deep_nesting: 'Deep Nesting — code branches nested 3+ levels deep, significantly reducing readability and testability',
    long_method: 'Long Method — function or method is too large, handling multiple concerns that should be separated',
    dead_code: 'Dead Code — unreachable or unused code left in the codebase, increasing maintenance burden',
    complex_conditional: 'Complex Conditional — overly complicated if/else or switch conditions that are hard to reason about'
  };

  const archDescriptions = {
    tight_coupling: 'Tight Coupling — components are too interdependent; changes in one part will break others',
    poor_separation_of_concerns: 'Poor Separation of Concerns — business logic, UI, and data handling are mixed together rather than cleanly separated',
    missing_abstraction: 'Missing Abstraction — repeated patterns or logic that should be extracted into a reusable module or class',
    business_logic_in_ui: 'Business Logic in UI — processing rules or calculations placed directly inside view/controller layers instead of the appropriate service or domain layer'
  };

  const handleSamplingModeChange = async (mode) => {
    setSamplingMode(mode);
    try {
      const token = localStorage.getItem('token');
      // TODO: migrate to apiFetch
      const res = await fetch(`/api/v1/projects/${project.id}/sampling-mode`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sampling_mode: mode })
      });
      if (!res.ok) {
        console.error('Failed to update project sampling mode in DB');
      }
    } catch (err) {
      console.error('Error updating project sampling mode', err);
    }
  };

  const generateCloudReportData = async () => {
    setIsCloudGenerating(true);
    setCloudError(null);
    setCloudReport(null);
    try {
      const token = localStorage.getItem('token');
      // TODO: migrate to apiFetch
      const res = await fetch(`/api/v1/projects/${project.id}/cloud-report/generate`, {
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
      const data = await res.json();
      setCloudReport(data);
    } catch (err) {
      const isKnownIntentional = err.message && !err.message.includes('failed') && !err.message.includes('fetch') && !err.message.includes('Unexpected') && err.message !== 'Internal server error';
      setCloudError(isKnownIntentional ? err.message : 'Something went wrong, please try again.');
    } finally {
      setIsCloudGenerating(false);
    }
  };

  // Automatically trigger Cloud AI report generation when qualitative analysis is ready/complete if not already generated
  useEffect(() => {
    if ((qualData || isComplete) && !cloudReport && !isCloudGenerating && !cloudError) {
      generateCloudReportData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualData, isComplete, cloudReport, isCloudGenerating, cloudError]);

  const downloadCloudReportPDF = async () => {
    setIsPdfDownloading(true);
    setCloudError(null);
    try {
      const token = localStorage.getItem('token');
      // TODO: migrate to apiFetch
      const res = await fetch(`/api/v1/projects/${project.id}/cloud-report`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 402) {
        setCloudError('NO_API_KEY');
        setIsPdfDownloading(false);
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        let detailMsg = 'Failed to download PDF report';
        if (errData && errData.detail) {
          detailMsg = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
        }
        throw new Error(detailMsg);
      }
      
      let fileName = `Project Report_${(project.course_name || 'Course').replace(/[^\w\-_]/g, '_')}_${(project.name || 'Project').replace(/[^\w\-_]/g, '_')}_${project.id}.pdf`;
      const disposition = res.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) {
          fileName = match[1];
        }
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      const isKnownIntentional = err.message && !err.message.includes('failed') && !err.message.includes('fetch') && !err.message.includes('Unexpected') && err.message !== 'Internal server error';
      setCloudError(isKnownIntentional ? err.message : 'Something went wrong, please try again.');
    } finally {
      setIsPdfDownloading(false);
    }
  };

  // ── Conditional render states (placed AFTER all hooks — see note above) ──
  if (loading) {
    return (
      <div className="loader-box">
        <div className="spinner" />
        <p>Analyzing repository commit history logs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="analytics-view">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary back-btn"
            onClick={onBack}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
        </div>
        <div className="card" style={{ padding: '32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <AlertCircle size={48} style={{ color: 'var(--color-danger, #ef4444)' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-main)', margin: 0 }}>Failed to Load Analytics</h2>
          <p style={{ color: 'var(--text-muted)', margin: 0, maxWidth: '400px' }}>{error}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setError(''); setLoading(true); window.location.reload(); }}
            style={{ marginTop: '8px' }}
          >
            Retry Loading
          </button>
        </div>
      </div>
    );
  }

  // If analytics data is not available (null or undefined), show a friendly placeholder
  if (!analytics) {
    return (
      <div className="analytics-view">
        {/* Back button */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary back-btn"
            onClick={onBack}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
        </div>
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: '600', margin: 0 }}>No Analytics Data</h2>
          <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
            Analytics information is not yet available for this project. Please ensure the repository has been processed.
          </p>
        </div>
      </div>
    );
  }

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
            <div className="stat-card card" style={{ position: 'relative' }}>
              <div className="stat-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="stat-icon-wrapper purple-icon">
                    <User size={22} />
                  </div>
                  <span className="stat-label">Contributors</span>
                </div>
                <Tooltip
                  title="Contributors Count"
                  content="Number of distinct human contributors and automated bot accounts detected in Git commit logs."
                />
              </div>
              <div className="stat-card-body">
                {(() => {
                  const contribs = analytics.contributions || [];
                  const isBot = (name) => /\[bot\]|dependabot|github-actions|renovate|actions-user/i.test(name || '');
                  const botCount = contribs.filter(c => isBot(c.name)).length;
                  const humanCount = contribs.length - botCount;

                  return (
                    <div>
                      <h2 className="stat-value" style={{ marginBottom: '2px' }}>
                        {humanCount} <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-muted)' }}>Humans</span>
                        {botCount > 0 && (
                          <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--primary)', marginLeft: '8px' }}>
                            + {botCount} {botCount === 1 ? 'Bot' : 'Bots'}
                          </span>
                        )}
                      </h2>
                      <p className="stat-subtext" style={{ margin: 0 }}>
                        {botCount > 0 
                          ? `${humanCount} real ${humanCount === 1 ? 'person' : 'people'} & ${botCount} automated ${botCount === 1 ? 'bot' : 'bots'}`
                          : `${humanCount} distinct ${humanCount === 1 ? 'person' : 'people'}`}
                      </p>
                    </div>
                  );
                })()}
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
                  {/* Sampling mode selector — locked while analysis is running */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    border: '1px solid var(--border-color)', borderRadius: '6px', padding: '2px',
                    backgroundColor: 'var(--bg-app)',
                    opacity: (isRunning || isCancelling) ? 0.6 : 1,
                    pointerEvents: (isRunning || isCancelling) ? 'none' : 'auto'
                  }}>
                    {[['sample', 'Smart'], ['full', 'Full'], ['random', 'Random']].map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleSamplingModeChange(m)}
                        disabled={isRunning || isCancelling}
                        style={{
                          padding: '3px 9px', borderRadius: '4px', fontSize: '0.73rem', fontWeight: '600',
                          border: 'none',
                          cursor: (isRunning || isCancelling) ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                          backgroundColor: samplingMode === m ? 'var(--primary)' : 'transparent',
                          color: samplingMode === m ? '#fff' : 'var(--text-muted)',
                        }}
                        title={(isRunning || isCancelling) ? 'Mode selection is locked while analysis is in progress' : (m === 'sample' ? 'Stratified Smart-Sampling: always-include high-signal commits + 20% per contributor' : m === 'full' ? 'Process every commit (slow on large repos)' : 'Pure random 20% of all commits')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Start button — only when idle/cancelled */}
                  {isIdle && (
                    <button type="button" className="btn btn-secondary"
                      onClick={() => onStartQualitative(false, samplingMode)}
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
                    onClick={() => onStartQualitative(true, samplingMode)}
                    disabled={isRunning || isCancelling}
                    style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'0.85rem' }}
                    title="Clear DB cache and re-run from scratch with selected mode"
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

              {/* Progress bar with Live Timer & Estimated Time Remaining */}
              {(isRunning || isCancelling) && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: '500' }}>
                      {qualMessage || 'Processing...'}
                    </p>
                    {/* Live Timer & ETA Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}>
                        <Clock size={13} style={{ color: 'var(--primary)' }} />
                        <span>Elapsed: <strong>{formatSeconds(elapsedSec)}</strong></span>
                      </span>
                      {etaSec !== null ? (
                        <span style={{
                          fontWeight: '600', color: 'var(--primary)',
                          backgroundColor: 'rgba(99,102,241,0.1)',
                          padding: '2px 8px', borderRadius: '4px',
                          border: '1px solid rgba(99,102,241,0.2)'
                        }}>
                          Est. remaining: ~{formatSeconds(etaSec)}
                        </span>
                      ) : qualProgress <= 3 ? (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          Calculating ETA...
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--bg-app)', borderRadius: '5px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                      <div style={{ height: '100%', width: `${qualProgress}%`, background: 'linear-gradient(90deg, var(--primary), #818cf8)', borderRadius: '5px', transition: 'width 0.4s ease-out' }} />
                    </div>
                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--primary)', minWidth: '42px', textAlign: 'right' }}>{qualProgress}%</span>
                  </div>
                  {/* Stuck-initializing warning */}
                  {isStuckInitializing && (
                    <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <AlertCircle size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '1px' }} />
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                        <strong style={{ color: '#f59e0b' }}>Taking longer than expected.</strong>{' '}
                        The local AI model (Ollama) may not be running, or the model is still loading.
                        Make sure Ollama is started and the model is pulled.{' '}
                        You can <button type="button" onClick={onStopQualitative} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontWeight: '600', padding: 0, fontSize: '0.8rem' }}>stop the analysis</button> and retry once Ollama is ready.
                      </div>
                    </div>
                  )}
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

            {/* ── Row 3: Plagiarism / Winnowing Similarity Scan Banner ─────── */}
            {qualData?.project_summary?.plagiarism_summary?.has_scan && (() => {
              const plag = qualData.project_summary.plagiarism_summary;
              const isHigh = plag.max_similarity_score > 50;
              const isMed = plag.max_similarity_score > 25;
              const alertColor = isHigh ? '#ef4444' : isMed ? '#f59e0b' : '#10b981';
              const alertBg = isHigh ? 'rgba(239,68,68,0.08)' : isMed ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)';
              const alertBorder = isHigh ? 'rgba(239,68,68,0.25)' : isMed ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)';

              return (
                <div style={{
                  backgroundColor: alertBg,
                  border: `1px solid ${alertBorder}`,
                  borderRadius: '8px',
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ShieldAlert size={20} style={{ color: alertColor, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: '700', color: alertColor, fontSize: '0.92rem' }}>
                        AST Winnowing Code Similarity Scan: {plag.max_similarity_score}% Similarity
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Matched with <strong>{plag.matched_project_name || 'Another Project'}</strong> ({plag.matched_blocks_count || 0} shared AST token blocks)
                      </div>
                    </div>
                  </div>
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: '12px',
                    fontSize: '0.78rem',
                    fontWeight: '700',
                    backgroundColor: alertColor,
                    color: '#fff'
                  }}>
                    {plag.status || (isHigh ? 'High Similarity' : isMed ? 'Needs Review' : 'Clean')}
                  </span>
                </div>
              );
            })()}

            {/* ── Row 4: Repository Architecture, Quality & AST Metrics Grid ─── */}
            {qualData?.project_summary && (() => {
              const ps = qualData.project_summary;
              const ast = ps.ast_complexity_summary || {};
              const fs = ps.folder_structure || {};
              const readme = ps.readme_quality || {};
              const pacing = ps.pacing_summary || {};
              const cxBadge = getComplexityBadge(ast.avg_complexity_score);
              const modBadge = getModularityBadge(fs.modularity_score);
              const docBadge = getDocScoreBadge(readme.documentation_score);

              return (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
                  gap: '20px'
                }}>
                  {/* Card 1: AST Complexity & Functions */}
                  <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="stat-icon-wrapper blue-icon" style={{ width: '32px', height: '32px' }}>
                          <Code size={18} />
                        </div>
                        <span style={{ fontWeight: '700', fontSize: '0.92rem', color: 'var(--text-main)' }}>AST Code Complexity</span>
                      </div>
                      <Tooltip 
                        title="AST Cyclomatic Complexity"
                        content="Evaluates code branching (if, for, while, switch) parsed via language AST. Low (1-5), Moderate (6-10), High (11-20), Very High (>20)."
                      />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--text-main)' }}>
                          {ast.avg_complexity_score ?? 0}
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: cxBadge.bg,
                          color: cxBadge.color,
                          border: `1px solid ${cxBadge.border}`
                        }}>
                          {cxBadge.label.split('—')[0].trim()}
                        </span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {cxBadge.label}
                      </p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '10px', fontSize: '0.8rem' }}>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Parsed Functions: </span>
                        <strong>{ast.total_functions ?? 0}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Squash Commits: </span>
                        <strong style={{ color: (ast.squash_suspected_commits > 0) ? '#ef4444' : '#10b981' }}>
                          {ast.squash_suspected_commits ?? 0}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Repository Modularity & Structure */}
                  <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="stat-icon-wrapper purple-icon" style={{ width: '32px', height: '32px' }}>
                          <FolderTree size={18} />
                        </div>
                        <span style={{ fontWeight: '700', fontSize: '0.92rem', color: 'var(--text-main)' }}>Repository Structure</span>
                      </div>
                      <Tooltip 
                        title="Repository Modularity"
                        content="Analyzes project file layout, directories, modular separation, and presence of automated test suites."
                      />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: '0.82rem',
                          fontWeight: '700',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: modBadge.bg,
                          color: modBadge.color
                        }}>
                          {modBadge.label}
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          backgroundColor: fs.has_tests_dir ? 'rgba(16,185,129,0.12)' : 'var(--bg-app)',
                          color: fs.has_tests_dir ? '#10b981' : 'var(--text-muted)',
                          border: '1px solid var(--border-color)'
                        }}>
                          {fs.has_tests_dir ? '✓ Tests Directory Present' : 'No Tests Directory'}
                        </span>
                      </div>
                      <p style={{ margin: '6px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <strong>{fs.total_files ?? 0}</strong> files across <strong>{fs.total_directories ?? 0}</strong> directories
                      </p>
                    </div>
                    {/* Folders Overview Tags */}
                    {(fs.filtered_ai_folders || fs.top_level_directories) && (
                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                        <span style={{ fontSize: '0.74rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Key Architectural Folders:
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' }}>
                          {(fs.filtered_ai_folders || fs.top_level_directories).slice(0, 8).map((f, i) => (
                            <span key={i} style={{
                              fontSize: '0.72rem',
                              fontFamily: 'monospace',
                              fontWeight: '600',
                              backgroundColor: 'var(--bg-app)',
                              border: '1px solid var(--border-color)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              color: 'var(--primary)'
                            }}>
                              📁 {f}/
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card 3: Documentation & Velocity */}
                  <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="stat-icon-wrapper red-icon" style={{ width: '32px', height: '32px' }}>
                          <FileText size={18} />
                        </div>
                        <span style={{ fontWeight: '700', fontSize: '0.92rem', color: 'var(--text-main)' }}>Docs & Velocity</span>
                      </div>
                      <Tooltip 
                        title="Documentation & Velocity"
                        content="Measures documentation presence and commit velocity trends across active days."
                      />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize: '0.82rem',
                          fontWeight: '700',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: docBadge.bg,
                          color: docBadge.color
                        }}>
                          Doc: {readme.documentation_score || 'Not Found'}
                        </span>
                        {readme.has_setup_guide && (
                          <span style={{ fontSize: '0.72rem', fontWeight: '600', color: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                            Setup Guide ✓
                          </span>
                        )}
                      </div>
                      {readme.has_readme && (
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          README Size: <strong>{readme.readme_size_kb || 0} KB</strong>
                        </p>
                      )}
                    </div>
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Peak Activity:</span>
                        <strong>{pacing.peak_commit_date || 'N/A'} ({pacing.peak_commit_count || 0} commits)</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Avg Velocity:</span>
                        <strong>{pacing.avg_commits_per_active_day || 0} commits / active day</strong>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Row 5: Code Smells & Architecture Patterns Panel ─────────── */}
            {qualData?.project_summary && (() => {
              const ps = qualData.project_summary;
              const smells = ps.code_smell_distribution || {};
              const archs = ps.architecture_issue_distribution || {};
              const substance = ps.substance_distribution || {};
              const hasSmells = Object.keys(smells).length > 0;
              const hasArchs = Object.keys(archs).length > 0;

              return (
                <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Layers size={20} style={{ color: 'var(--primary)' }} />
                      <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-main)', margin: 0 }}>
                        Code Quality, Smells & Architecture Analysis
                      </h2>
                    </div>
                    {/* Security & Resurrection Badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        padding: '3px 9px',
                        borderRadius: '4px',
                        backgroundColor: (ps.security_risk_commits > 0) ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                        color: (ps.security_risk_commits > 0) ? '#ef4444' : '#10b981',
                        border: `1px solid ${(ps.security_risk_commits > 0) ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`
                      }}>
                        <ShieldAlert size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                        {ps.security_risk_commits > 0 ? `${ps.security_risk_commits} Security Risk Commits` : '0 Security Risks Detected'}
                      </span>
                    </div>
                  </div>

                  {/* 2-Column Grid: Smells vs Architecture */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                    {/* Left: Code Smells */}
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <AlertCircle size={16} style={{ color: '#f59e0b' }} />
                        <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-main)', margin: 0 }}>
                          Detected Code Smells
                        </h3>
                      </div>
                      <p style={{ margin: '0 0 12px 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Patterns indicating quality issues or maintenance friction across commits:
                      </p>

                      {hasSmells ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {Object.entries(smells).map(([smell, count]) => (
                            <div key={smell} style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '10px',
                              padding: '8px 10px',
                              backgroundColor: 'var(--bg-card)',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)'
                            }}>
                              <span style={{
                                backgroundColor: 'rgba(245,158,11,0.15)',
                                color: '#f59e0b',
                                fontWeight: '700',
                                fontSize: '0.75rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                flexShrink: 0
                              }}>
                                {count}×
                              </span>
                              <div style={{ fontSize: '0.8rem', lineHeight: '1.4' }}>
                                <strong style={{ color: '#f59e0b', textTransform: 'capitalize' }}>
                                  {smell.replace(/_/g, ' ')}
                                </strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
                                  {smellDescriptions[smell] || 'Identified recurring code pattern that may reduce maintainability.'}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ padding: '12px', textAlign: 'center', color: '#10b981', fontSize: '0.82rem', fontWeight: '600' }}>
                          ✓ Clean code quality — no significant code smells detected.
                        </div>
                      )}
                    </div>

                    {/* Right: Architecture Issues */}
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <Layers size={16} style={{ color: '#ef4444' }} />
                        <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-main)', margin: 0 }}>
                          Detected Architecture Issues
                        </h3>
                      </div>
                      <p style={{ margin: '0 0 12px 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Structural design concerns identified across repository modules:
                      </p>

                      {hasArchs ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {Object.entries(archs).map(([issue, count]) => (
                            <div key={issue} style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '10px',
                              padding: '8px 10px',
                              backgroundColor: 'var(--bg-card)',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)'
                            }}>
                              <span style={{
                                backgroundColor: 'rgba(239,68,68,0.15)',
                                color: '#ef4444',
                                fontWeight: '700',
                                fontSize: '0.75rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                flexShrink: 0
                              }}>
                                {count}×
                              </span>
                              <div style={{ fontSize: '0.8rem', lineHeight: '1.4' }}>
                                <strong style={{ color: '#ef4444', textTransform: 'capitalize' }}>
                                  {issue.replace(/_/g, ' ')}
                                </strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
                                  {archDescriptions[issue] || 'Structural modularity concern identified across components.'}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ padding: '12px', textAlign: 'center', color: '#10b981', fontSize: '0.82rem', fontWeight: '600' }}>
                          ✓ Clean architectural boundaries — no major modularity issues detected.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Substance Breakdown & Resurrection Alerts Strip */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    borderTop: '1px solid var(--border-color)',
                    paddingTop: '14px',
                    fontSize: '0.82rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '600', color: 'var(--text-muted)' }}>Commit Substance Breakdown:</span>
                      <span style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#10b981', padding: '2px 8px', borderRadius: '4px', fontWeight: '600' }}>
                        Substantial: {substance.substantial ?? 0}
                      </span>
                      <span style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '2px 8px', borderRadius: '4px', fontWeight: '600' }}>
                        Moderate: {substance.moderate ?? 0}
                      </span>
                      <span style={{ backgroundColor: 'rgba(107,114,128,0.12)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: '4px', fontWeight: '600' }}>
                        Trivial: {substance.trivial ?? 0}
                      </span>
                    </div>

                    {ps.code_resurrection_flags && ps.code_resurrection_flags.length > 0 && (
                      <div style={{ color: '#f59e0b', fontWeight: '600', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertCircle size={14} />
                        <span>{ps.code_resurrection_flags.length} Code Resurrection Flag(s)</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ── Row 6: Individual Student Qualitative Contributions Table & Drawer ── */}
            {qualData && qualData.contributors && (
              <div className="card" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                  <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <User size={20} style={{ color: 'var(--primary)' }} />
                    <span>Individual Student Qualitative Contributions</span>
                  </h2>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Click any student row to view substantial commit diffs & timing patterns
                  </span>
                </div>
                <div className="table-container">
                  <table className="custom-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }}>Student Name</th>
                        <th style={{ width: '13%' }}>Commit Share</th>
                        <th style={{ width: '13%' }}>LOC Share</th>
                        <th style={{ width: '14%' }}>Vague Msg %</th>
                        <th style={{ width: '14%' }}>Msg Mismatch %</th>
                        <th style={{ width: '10%' }}>Risk Score</th>
                        <th style={{ width: '14%' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(qualData.contributors).map(([name, info]) => {
                        const stats = info.stats || {};
                        const examples = info.examples || {};
                        const riskScore = stats.ai_risk_score ?? 0;
                        const isFreeRider = stats.free_rider_suspected ?? false;
                        const flags = stats.detected_red_flags || [];
                        const isExpanded = expandedQualContributor === name;

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
                          <React.Fragment key={name}>
                            <tr 
                              onClick={() => setExpandedQualContributor(isExpanded ? null : name)}
                              style={{ cursor: 'pointer', backgroundColor: isExpanded ? 'var(--bg-hover)' : 'inherit' }}
                              title="Click to view detailed commit examples and timing"
                            >
                              <td className="student-info-cell" style={{ fontWeight: '600' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {isExpanded ? <ChevronDown size={14} style={{ color: 'var(--primary)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                                  <span>{name}</span>
                                </div>
                              </td>
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
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Good Standing</span>
                                )}
                              </td>
                            </tr>

                            {/* In-Depth Contributor Details Accordion */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={7} style={{ padding: '0', backgroundColor: 'var(--bg-app)', borderBottom: '2px solid var(--border-color)' }}>
                                  <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                    
                                    {/* Top meta tags */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <strong style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{name}'s Work Breakdown:</strong>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                          {stats.total_project_commits ?? 0} total commits ({stats.sampled_commits ?? 0} sampled by AI)
                                        </span>
                                      </div>
                                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                        Timing: <strong>{stats.timing_pattern || 'Normal distribution'}</strong>
                                      </span>
                                    </div>

                                    {/* Substantial Commits Examples */}
                                    {examples.substantial_commits && examples.substantial_commits.length > 0 && (
                                      <div>
                                        <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                          Key Substantial Commits:
                                        </span>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                                          {examples.substantial_commits.map((c, ci) => (
                                            <div key={ci} style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'space-between',
                                              backgroundColor: 'var(--bg-card)',
                                              padding: '6px 10px',
                                              borderRadius: '6px',
                                              border: '1px solid var(--border-color)',
                                              fontSize: '0.8rem'
                                            }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                                <code style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>
                                                  {c.hash?.substring(0, 8)}
                                                </code>
                                                <span style={{ color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                                  {c.message}
                                                </span>
                                              </div>
                                              <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={(e) => { e.stopPropagation(); setSelectedCommitHash(c.hash); }}
                                                style={{ padding: '3px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                              >
                                                <Code size={12} /><span>Diff</span>
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Detected Red Flags list if any */}
                                    {flags && flags.length > 0 && flags[0] !== 'None' && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#ef4444' }}>Flagged Concerns:</span>
                                        {flags.map((flag, fi) => (
                                          <span key={fi} style={{
                                            fontSize: '0.74rem',
                                            padding: '2px 7px',
                                            borderRadius: '4px',
                                            backgroundColor: 'rgba(239,68,68,0.1)',
                                            color: '#ef4444',
                                            border: '1px solid rgba(239,68,68,0.2)'
                                          }}>
                                            {flag}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Row 4: Cloud AI Final Report ──────────────────────────── */}
            <div className="card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Bot size={22} style={{ color: 'var(--primary)' }} />
                  <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main)', margin: 0 }}>
                    Cloud AI Final Evaluation Report
                  </h2>
                  {cloudReport && cloudReport.overall_project_risk_score && (
                    <span style={{
                      ...getRiskScoreBadgeStyle(cloudReport.overall_project_risk_score),
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <AlertCircle size={13} />
                      Risk Score: {cloudReport.overall_project_risk_score}
                    </span>
                  )}
                </div>

                {cloudReport && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={downloadCloudReportPDF}
                      disabled={isPdfDownloading || isCloudGenerating}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
                      title="Download PDF Report"
                    >
                      {isPdfDownloading ? (
                        <>
                          <RefreshCw size={14} className="spin" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <Bot size={14} />
                          <span>Download PDF</span>
                        </>
                      )}
                    </button>
                    <button 
                      onClick={generateCloudReportData}
                      disabled={isCloudGenerating}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
                      title="Regenerate Report"
                    >
                      <RefreshCw size={14} className={isCloudGenerating ? "spin" : ""} />
                      <span>Regenerate</span>
                    </button>
                  </div>
                )}
              </div>
              
              {!qualData && !isComplete && (
                <div style={{ padding: '20px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Info size={16} />
                  Run the local AI analysis first to gather project data.
                </div>
              )}

              {(qualData || isComplete) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {cloudError === 'NO_API_KEY' ? (
                    <div style={{ padding: '20px', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', color: '#f59e0b', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <AlertCircle size={18} />
                        <span><strong>API Key Not Enabled:</strong> You must configure a Cloud AI API key in Settings to generate the final report.</span>
                      </div>
                      <button
                        onClick={() => navigate({ tab: 'settings', section: 'api-keys' })}
                        style={{ padding: '6px 12px', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}
                      >
                        Go to Settings
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
                        onClick={generateCloudReportData}
                        disabled={isCloudGenerating}
                        className="btn btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.95rem' }}
                      >
                        {isCloudGenerating ? (
                          <>
                            <RefreshCw size={16} className="spin" />
                            Generating Cloud AI Report...
                          </>
                        ) : (
                          <>
                            <Bot size={16} />
                            Generate Cloud AI Final Report
                          </>
                        )}
                      </button>
                    </div>
                  ) : typeof cloudReport === 'object' && cloudReport.executive_summary ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      
                      {/* Grid for Executive Summary and Work Distribution */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                        <div style={{ backgroundColor: 'var(--bg-app)', padding: '18px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          <h3 style={{ fontSize: '0.92rem', fontWeight: '600', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>
                            Executive Summary
                          </h3>
                          <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: '1.6', color: 'var(--text-main)' }}>
                            {cloudReport.executive_summary}
                          </p>
                        </div>
                        <div style={{ backgroundColor: 'var(--bg-app)', padding: '18px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          <h3 style={{ fontSize: '0.92rem', fontWeight: '600', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>
                            Work Distribution & Collaboration
                          </h3>
                          <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: '1.6', color: 'var(--text-main)' }}>
                            {cloudReport.work_distribution_and_fairness}
                          </p>
                        </div>
                      </div>

                      {/* Integrity Anomalies (if any) */}
                      {cloudReport.academic_integrity_anomalies && !cloudReport.academic_integrity_anomalies.includes("No anomalies") && !cloudReport.academic_integrity_anomalies.includes("none") && (
                        <div style={{ backgroundColor: 'rgba(239,68,68,0.06)', padding: '18px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', gap: '12px' }}>
                          <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                          <div>
                            <h3 style={{ fontSize: '0.92rem', fontWeight: '700', color: '#ef4444', margin: '0 0 6px 0' }}>
                              Academic Integrity & Team Dynamics Anomalies
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.86rem', lineHeight: '1.5', color: 'var(--text-main)' }}>
                              {cloudReport.academic_integrity_anomalies}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Individual Student Evaluations */}
                      {cloudReport.student_evaluations && cloudReport.student_evaluations.length > 0 && (
                        <div>
                          <h3 style={{ fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-main)', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <User size={16} style={{ color: 'var(--primary)' }} />
                            <span>Individual Student Qualitative Evaluations</span>
                          </h3>
                          <div className="table-container">
                            <table className="custom-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                              <thead>
                                <tr>
                                  <th style={{ width: '18%' }}>Student</th>
                                  <th style={{ width: '18%' }}>Verdict</th>
                                  <th style={{ width: '16%' }}>Commits</th>
                                  <th style={{ width: '16%' }}>Substance</th>
                                  <th style={{ width: '16%' }}>Pacing</th>
                                  <th style={{ width: '16%' }}>Quality Signals</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cloudReport.student_evaluations.map((student, idx) => (
                                  <tr key={idx}>
                                    <td style={{ fontWeight: '600' }}>{student.student_name}</td>
                                    <td>
                                      <span style={getVerdictBadgeStyle(student.verdict)}>
                                        {student.verdict}
                                      </span>
                                    </td>
                                    <td style={{ fontSize: '0.82rem' }}>{student.commits_summary}</td>
                                    <td style={{ fontSize: '0.82rem' }}>{student.substance_breakdown}</td>
                                    <td style={{ fontSize: '0.82rem' }}>{student.pacing_and_deadlines}</td>
                                    <td style={{ fontSize: '0.82rem' }}>{student.quality_and_integrity_signals}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Actionable Recommendations */}
                      {cloudReport.actionable_recommendations && cloudReport.actionable_recommendations.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                          <h3 style={{ fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-main)', margin: '0 0 10px 0' }}>
                            Actionable Recommendations
                          </h3>
                          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {cloudReport.actionable_recommendations.map((rec, idx) => (
                              <li key={idx} style={{ fontSize: '0.88rem', color: 'var(--text-main)', lineHeight: '1.5' }}>
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                    </div>
                  ) : (
                    <div style={{ padding: '24px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                      <div style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                        ✓ {String(cloudReport)}
                      </div>
                      <button 
                        onClick={downloadCloudReportPDF}
                        disabled={isPdfDownloading || isCloudGenerating}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}
                      >
                        {isPdfDownloading ? (
                          <>
                            <RefreshCw size={16} className="spin" />
                            <span>Processing...</span>
                          </>
                        ) : (
                          <>
                            <Bot size={16} />
                            <span>Download PDF Report</span>
                          </>
                        )}
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

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
  Users,
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
  Check,
  GitMerge
} from 'lucide-react';
import Tag from '../../components/Tag';
import Tooltip from '../../components/Tooltip';
import CommitActivityChart from '../../components/CommitActivityChart';
import CommitCodeViewModal from '../../components/CommitCodeViewModal';
import FileBrowserModal from '../../components/FileBrowserModal';
import { formatDeadline } from '../../utils/courseMeta';
import { useNavigation } from '../../contexts/NavigationContext';
import './Analytics.css';

export default function Analytics({ project, course, onBack, qualAnalysisState, onStartQualitative, onStopQualitative, onMergeAuthors }) {
  const { navigate } = useNavigation();
  const [analytics, setAnalytics] = useState(null);
  const [mergingIdentity, setMergingIdentity] = useState(false);
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
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState('');

  const handleOpenMergeModal = (source, targetId = '') => {
    setMergeSource(source);
    setMergeTargetId(targetId ? String(targetId) : '');
    setShowMergeModal(true);
  };

  const handleMergeSubmit = async (e) => {
    e.preventDefault();
    if (!mergeSource || !mergeTargetId || !onMergeAuthors) return;

    setMergingIdentity(true);
    try {
      await onMergeAuthors(mergeSource.id, parseInt(mergeTargetId));
      setShowMergeModal(false);
      setMergeSource(null);
      setMergeTargetId('');
      if (onStartQualitative) {
        onStartQualitative(true, samplingMode);
      }
    } catch (err) {
      console.error('Merge error:', err);
    } finally {
      setMergingIdentity(false);
    }
  };

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
    const green = { backgroundColor: 'rgba(16,185,129,0.12)', color: '#10b981', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.2)', fontWeight: '600', fontSize: '0.8rem' };
    const amber = { backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.2)', fontWeight: '600', fontSize: '0.8rem' };
    const red = { backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.2)', fontWeight: '600', fontSize: '0.8rem' };
    const gray = { backgroundColor: 'var(--bg-app)', color: 'var(--text-muted)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: '600', fontSize: '0.8rem' };
    // Quality wording (current, higher = better).
    if (v.startsWith("high quality")) return green;
    if (v.startsWith("moderate quality")) return amber;
    if (v.startsWith("poor quality")) return red;
    if (v.startsWith("unverified") || v.startsWith("n/a")) return gray;
    // Legacy Risk wording (older cached reports, opposite polarity): Low Risk = good.
    if (v.startsWith("low risk")) return green;
    if (v.startsWith("moderate risk") || v.startsWith("medium risk")) return amber;
    if (v.startsWith("high risk")) return red;
    return gray;
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', position: 'relative', minHeight: '42px' }}>
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

        {/* Center: Page-Level Mode Switcher */}
        <div 
          className="analytics-mode-switcher"
          role="tablist" 
          aria-label="Analysis Mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'quantitative'}
            className={`analytics-mode-tab ${activeTab === 'quantitative' ? 'active' : ''}`}
            onClick={() => setActiveTab('quantitative')}
          >
            <BarChart4 size={15} className="mode-tab-icon" />
            <span style={{ whiteSpace: 'nowrap' }}>Quantitative Analysis</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'qualitative'}
            className={`analytics-mode-tab ${activeTab === 'qualitative' ? 'active' : ''}`}
            onClick={() => setActiveTab('qualitative')}
          >
            <Bot size={15} className="mode-tab-icon" />
            <span style={{ whiteSpace: 'nowrap' }}>Qualitative Analysis</span>
            {qualData && (
              <span className="mode-tab-ready-dot" title="Qualitative Analysis Ready" />
            )}
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
            <span style={{ fontSize: '0.82rem', fontWeight: '400', color: 'var(--text-muted)', letterSpacing: 'normal' }}>
              {activeTab === 'quantitative'
                ? 'Repository metadata, contribution inequality, and git log history metrics.'
                : 'Architectural evaluation, AST similarity detection, and qualitative code inspection.'}
            </span>
          </h1>
      </div>

      {analytics && activeTab === 'quantitative' && (
        <div className="analytics-content-grid analytics-tab-content">
          {/* Summary metrics */}
          <div className="analytics-summary-cards">
            {(() => {
              const isSolo = qualData?.project_summary?.is_solo_project ?? (qualData?.project_summary?.identity_analysis?.is_solo_project ?? (analytics.contributions?.length === 1));
              return (
                <div className="stat-card card" style={{ position: 'relative' }}>
                  <div className="stat-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="stat-icon-wrapper blue-icon">
                        <Scale size={22} />
                      </div>
                      <span className="stat-label">Workload Distribution</span>
                    </div>
                    <Tooltip 
                      title="Workload Distribution (Gini)" 
                      content={
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            Team inequality score (0.00 = equal, 1.00 = unequal):
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.78rem' }}>
                            <div><strong style={{ color: '#10b981' }}>Low (&lt;0.30):</strong> Balanced teamwork</div>
                            <div><strong style={{ color: '#f59e0b' }}>Medium (0.30–0.49):</strong> Moderate imbalance</div>
                            <div><strong style={{ color: '#ef4444' }}>High (≥0.50):</strong> Severe imbalance (free-riding risk)</div>
                          </div>
                        </div>
                      } 
                    />
                  </div>
                  <div className="stat-card-body">
                    {isSolo ? (
                      <div>
                        <h2 className="stat-value" style={{ fontSize: '1.4rem' }}>N/A</h2>
                        <span className="badge" style={{ backgroundColor: 'rgba(2, 132, 199, 0.12)', color: '#0284c7', fontWeight: '700' }}>
                          Single Contributor
                        </span>
                      </div>
                    ) : (
                      <div>
                        <h2 className="stat-value">{analytics.gini_coefficient?.toFixed(2)}</h2>
                        <span className={`badge ${getGiniStatusClass(analytics.gini_coefficient)}`}>
                          {analytics.distribution_status}
                        </span>
                      </div>
                    )}
                  </div>
                  {qualData?.project_summary?.excluded_bots?.length > 0 && (
                    <div style={{ padding: '0 24px 16px', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '-8px' }}>
                      * {qualData.project_summary.excluded_bots.length} automated contributor(s) excluded
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="stat-card card">
              <div className="stat-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="stat-icon-wrapper blue-icon">
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
                  <div className="stat-icon-wrapper blue-icon">
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
                  <div className="stat-icon-wrapper blue-icon">
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
                      {analytics.co_authors_only_count > 0 && (
                        <div style={{ marginTop: '8px', padding: '6px 10px', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '6px', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                          <AlertCircle size={14} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
                          <span style={{ fontSize: '0.75rem', color: '#d97706', fontWeight: '600', lineHeight: '1.4' }}>
                            {analytics.co_authors_only_count} additional member(s) identified as co-authors but have not made direct commits.
                          </span>
                        </div>
                      )}
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
                              <span>No Late Commits</span>
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
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Contributor</th>
                    <th>Email Address</th>
                    <th>Commits</th>
                    <th>Lines Added</th>
                    <th>Lines Removed (Refactoring)</th>
                    <th>Overall Share</th>
                    <th>Actions</th>
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
                        <td onClick={e => e.stopPropagation()}>
                          {onMergeAuthors && analytics.contributions?.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.75rem',
                                padding: '3px 8px'
                              }}
                              onClick={() => handleOpenMergeModal({ id: contrib.author_id, name: contrib.name, email: contrib.email })}
                              title="Merge aliases/duplicate profiles for this contributor"
                            >
                              <GitMerge size={12} />
                              <span>Merge</span>
                            </button>
                          )}
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
          <div className="analytics-tab-content" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <style>{`
              @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
            `}</style>

            {/* ── Row 1: Controls + Progress ─────────────────────────────── */}
            <div className="card" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', marginBottom: (isRunning || isCancelling) ? '14px' : '0' }}>
                {/* Left: Title & Status Badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Bot size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: '700', color: 'var(--text-main)' }}>
                    Local AI Qualitative Analysis
                  </h2>
                  {statusBadge()}
                </div>

                {/* Right: Controls & Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {/* Actions Group */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Start button — only when idle */}
                    {isIdle && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onStartQualitative(false, samplingMode)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: 'var(--primary)',
                          borderColor: 'var(--primary)',
                          fontWeight: '600'
                        }}
                      >
                        <Play size={13} />
                        <span>Start Analysis</span>
                      </button>
                    )}

                    {/* Stop button (destructive action) — only when running */}
                    {(isRunning || isCancelling) && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={onStopQualitative}
                        disabled={isCancelling}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          borderColor: '#ef4444',
                          color: '#ef4444',
                          backgroundColor: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid #ef4444',
                          cursor: isCancelling ? 'not-allowed' : 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        <Square size={13} />
                        <span>{isCancelling ? 'Cancelling...' : 'Stop'}</span>
                      </button>
                    )}

                    {/* Re-analyze — when not running */}
                    {!isRunning && !isCancelling && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onStartQualitative(true, samplingMode)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                        title="Clear DB cache and re-run from scratch with selected mode"
                      >
                        <RefreshCw size={13} />
                        <span>Re-analyze</span>
                      </button>
                    )}

                    {/* View / Hide JSON inspector */}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowRawDataInspector(!showRawDataInspector)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Code size={13} />
                      <span>{showRawDataInspector ? 'Hide JSON' : 'View Output JSON'}</span>
                    </button>
                  </div>

                  {/* Segmented Mode Selector — Moved to the Right Corner */}
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'stretch',
                      height: '32px',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px',
                      backgroundColor: 'var(--bg-app)',
                      boxSizing: 'border-box',
                      opacity: (isRunning || isCancelling) ? 0.6 : 1,
                      pointerEvents: (isRunning || isCancelling) ? 'none' : 'auto'
                    }}
                    role="group"
                    aria-label="Sampling mode selector"
                  >
                    {[
                      ['sample', 'Smart'],
                      ['full', 'Full'],
                      ['random', 'Random']
                    ].map(([m, label]) => {
                      const isActive = samplingMode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleSamplingModeChange(m)}
                          disabled={isRunning || isCancelling}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            padding: '0 12px',
                            borderRadius: '4px',
                            fontSize: '0.82rem',
                            fontWeight: isActive ? '600' : '500',
                            border: 'none',
                            cursor: (isRunning || isCancelling) ? 'not-allowed' : 'pointer',
                            transition: 'all 0.15s ease',
                            backgroundColor: isActive ? 'var(--primary)' : 'transparent',
                            color: isActive ? '#ffffff' : 'var(--text-main)',
                            boxShadow: isActive ? '0 1px 2px rgba(0, 0, 0, 0.1)' : 'none',
                            whiteSpace: 'nowrap'
                          }}
                          title={
                            (isRunning || isCancelling)
                              ? 'Mode selection is locked while analysis is in progress'
                              : (m === 'sample'
                                ? 'Stratified Smart-Sampling: always-include high-signal commits + 20% per contributor'
                                : m === 'full'
                                ? 'Process every commit (slow on large repos)'
                                : 'Pure random 20% of all commits')
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Progress bar with plain status & dominant percentage */}
              {(isRunning || isCancelling) && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: '6px',
                    gap: '12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                      <p style={{
                        margin: 0,
                        fontSize: '0.82rem',
                        color: 'var(--text-muted)',
                        fontWeight: '500',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {qualMessage || 'Processing qualitative analysis...'}
                      </p>
                      {elapsedSec > 0 && (
                        <span style={{
                          fontSize: '0.76rem',
                          color: 'var(--text-muted)',
                          fontVariantNumeric: 'tabular-nums',
                          flexShrink: 0
                        }}>
                          &middot; {formatSeconds(elapsedSec)}
                        </span>
                      )}
                    </div>

                    <span style={{
                      fontSize: '0.92rem',
                      fontWeight: '700',
                      color: 'var(--primary)',
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0
                    }}>
                      {qualProgress}%
                    </span>
                  </div>

                  <div style={{
                    width: '100%',
                    height: '6px',
                    backgroundColor: 'var(--bg-app)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${qualProgress}%`,
                        background: 'linear-gradient(90deg, var(--primary), #818cf8)',
                        borderRadius: '3px',
                        transition: 'width 0.4s ease-out'
                      }}
                    />
                  </div>

                  {/* Stuck-initializing warning */}
                  {isStuckInitializing && (
                    <div style={{
                      marginTop: '10px',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.25)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px'
                    }}>
                      <AlertCircle size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '1px' }} />
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                        <strong style={{ color: '#f59e0b' }}>Taking longer than expected.</strong>{' '}
                        The local AI model (Ollama) may still be loading into memory.{' '}
                        You can{' '}
                        <button
                          type="button"
                          onClick={onStopQualitative}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#ef4444',
                            fontWeight: '600',
                            padding: 0,
                            fontSize: '0.8rem'
                          }}
                        >
                          stop the analysis
                        </button>{' '}
                        and retry once Ollama is ready.
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
              const alertBg = isHigh ? 'rgba(239, 68, 68, 0.04)' : isMed ? 'rgba(245, 158, 11, 0.04)' : 'rgba(16, 185, 129, 0.04)';
              const alertBorder = isHigh ? 'rgba(239, 68, 68, 0.2)' : isMed ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)';

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
                  gap: '14px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <ShieldAlert size={22} style={{ color: alertColor, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: '700', color: 'var(--text-muted)' }}>
                        AST Winnowing Scan
                      </div>
                      <div style={{ fontSize: '0.94rem', fontWeight: '700', color: 'var(--text-main)', marginTop: '2px' }}>
                        <span style={{ color: alertColor }}>{plag.max_similarity_score}% Similarity</span>
                        <span style={{ fontWeight: '400', color: 'var(--text-muted)', fontSize: '0.82rem', marginLeft: '8px' }}>
                          with <strong style={{ color: 'var(--text-main)', fontWeight: '600' }}>{plag.matched_project_name || 'Another Project'}</strong> ({plag.matched_blocks_count || 0} shared AST token blocks)
                        </span>
                      </div>
                    </div>
                  </div>

                  <span style={{
                    padding: '3px 10px',
                    borderRadius: '4px',
                    fontSize: '0.78rem',
                    fontWeight: '700',
                    backgroundColor: alertBg,
                    color: alertColor,
                    border: `1px solid ${alertBorder}`,
                    letterSpacing: '0.2px',
                    flexShrink: 0
                  }}>
                    {plag.status || (isHigh ? 'High Similarity' : isMed ? 'Needs Review' : 'Clean')}
                  </span>
                </div>
              );
            })()}

            {/* ── Row 3b: Contributor Identity & Authenticity Signals ───────── */}
            {qualData?.project_summary?.identity_analysis && (() => {
              const ia = qualData.project_summary.identity_analysis;
              
              const isMergedIssue = (issue) => {
                if (!issue.author_ids || issue.author_ids.length < 2) return false;
                const canonicalIds = issue.author_ids.map(id => {
                  const author = analytics.authors?.find(a => a.id === id);
                  return author ? (author.canonical_author_id || author.id) : null;
                }).filter(Boolean);
                return canonicalIds.length > 1 && new Set(canonicalIds).size === 1;
              };

              const suspected = (ia.suspected_same_person || []).filter(issue => !isMergedIssue(issue));
              const shared = (ia.shared_accounts || []).filter(issue => !isMergedIssue(issue));
              const pushed = (ia.pushed_by_other || []).filter(issue => !isMergedIssue(issue));
              const isSolo = ia.is_solo_project;
              const hasSignals = suspected.length > 0 || shared.length > 0 || pushed.length > 0;

              if (!hasSignals && !isSolo) return null;

              const isHigh = suspected.some(s => s.confidence === 'HIGH');
              const alertColor = isHigh ? '#ef4444' : hasSignals ? '#f59e0b' : '#0284c7';
              const alertBg = isHigh ? 'rgba(239, 68, 68, 0.04)' : hasSignals ? 'rgba(245, 158, 11, 0.04)' : 'rgba(2, 132, 199, 0.04)';
              const alertBorder = isHigh ? 'rgba(239, 68, 68, 0.2)' : hasSignals ? 'rgba(245, 158, 11, 0.2)' : 'rgba(2, 132, 199, 0.2)';

              const parseMember = (memberStr) => {
                if (!memberStr) return { name: 'Unknown', email: '' };
                const match = memberStr.match(/^(.*?)\s*<([^>]+)>$/);
                if (match) {
                  return { name: match[1].trim(), email: match[2].trim() };
                }
                return { name: memberStr.trim(), email: '' };
              };

              return (
                <div style={{
                  backgroundColor: alertBg,
                  border: `1px solid ${alertBorder}`,
                  borderRadius: '8px',
                  padding: '14px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  {/* If Suspected Same-Person pairs exist */}
                  {suspected.length > 0 && suspected.map((issue, idx) => {
                    const memA = parseMember(issue.members?.[0]);
                    const memB = parseMember(issue.members?.[1]);
                    const tokens = issue.matched_tokens || [];
                    const tokenSnippet = tokens.length > 0 ? ` (matches "${tokens.join('", "')}")` : '';

                    return (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '12px',
                          paddingTop: idx > 0 ? '10px' : '0',
                          borderTop: idx > 0 ? '1px solid var(--border-color)' : 'none'
                        }}
                      >
                        {/* Left side: Icon + Category + Pair + Short Evidence */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                          <User size={22} style={{ color: alertColor, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: '700', color: 'var(--text-muted)' }}>
                              Suspected Split Git Identity
                            </div>
                            {/* Names grouped closely together without being pushed to corners */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '2px', fontSize: '0.9rem' }}>
                              <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>
                                {memA.name} {memA.email && <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)', fontFamily: 'Fira Code, monospace' }}>&lt;{memA.email}&gt;</span>}
                              </span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>↔</span>
                              <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>
                                {memB.name} {memB.email && <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)', fontFamily: 'Fira Code, monospace' }}>&lt;{memB.email}&gt;</span>}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              Likely the same contributor using multiple Git identities{tokenSnippet}.
                            </div>
                          </div>
                        </div>

                        {/* Right side: Review & Merge Action Button */}
                        {issue.author_ids && issue.author_ids.length === 2 && onMergeAuthors && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              borderColor: 'var(--primary)',
                              color: 'var(--primary)',
                              fontWeight: '600',
                              fontSize: '0.8rem',
                              padding: '5px 12px',
                              flexShrink: 0
                            }}
                            disabled={mergingIdentity}
                            onClick={() => {
                              handleOpenMergeModal(
                                { id: issue.author_ids[1], name: memB.name, email: memB.email },
                                issue.author_ids[0]
                              );
                            }}
                          >
                            <GitMerge size={14} />
                            <span>Review & Merge</span>
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {/* If Solo project and no split identities */}
                  {isSolo && suspected.length === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <User size={22} style={{ color: '#0284c7', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: '700', color: 'var(--text-muted)' }}>
                          Solo Project Verified
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)', marginTop: '2px' }}>
                          All commits authored by 1 primary contributor.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Shared Account Notices */}
                  {shared.length > 0 && (
                    <div style={{ borderTop: suspected.length > 0 ? '1px solid var(--border-color)' : 'none', paddingTop: suspected.length > 0 ? '8px' : '0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <strong style={{ color: 'var(--text-main)' }}>Shared Account:</strong> {shared.map(s => s.members?.join(', ')).join('; ')} ({shared[0]?.evidence?.[0] || 'Multiple students committing via one account'})
                    </div>
                  )}

                  {/* Proxy Push Divergence */}
                  {pushed.length > 0 && (
                    <div style={{ borderTop: (suspected.length > 0 || shared.length > 0) ? '1px solid var(--border-color)' : 'none', paddingTop: (suspected.length > 0 || shared.length > 0) ? '8px' : '0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <strong style={{ color: 'var(--text-main)' }}>Proxy Push:</strong> {pushed.map(p => p.members?.join(', ')).join('; ')} ({pushed[0]?.evidence?.[0] || 'Committer email differs from author'})
                    </div>
                  )}
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
                  {/* ── Card 1: AST Code Complexity ── */}
                  <div className="card" style={{
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    backgroundColor: 'var(--card-bg)'
                  }}>
                    {/* Header: Icon + Title + Tooltip */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className="stat-icon-wrapper blue-icon" style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}>
                          <Code size={17} />
                        </div>
                        <span style={{ fontWeight: '700', fontSize: '0.92rem', color: 'var(--text-main)' }}>AST Code Complexity</span>
                      </div>
                      <Tooltip 
                        title="AST Cyclomatic Complexity"
                        content="Evaluates code branching (if, for, while, switch) parsed via language AST. Low (1-5), Moderate (6-10), High (11-20), Very High (>20)."
                      />
                    </div>

                    {/* Primary Stat & Badge */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                        <span style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                          {ast.avg_complexity_score ?? 0}
                        </span>
                        <span style={{
                          fontSize: '0.74rem',
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

                    {/* Supporting Details (Aligned 2-Column Layout) */}
                    <div style={{
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '12px',
                      marginTop: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      fontSize: '0.8rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Parsed Functions:</span>
                        <strong style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                          {(ast.total_functions ?? 0).toLocaleString()}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Squash Commits:</span>
                        <strong style={{
                          color: (ast.squash_suspected_commits > 0) ? '#ef4444' : 'var(--text-main)',
                          fontVariantNumeric: 'tabular-nums'
                        }}>
                          {ast.squash_suspected_commits ?? 0}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* ── Card 2: Repository Structure ── */}
                  <div className="card" style={{
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    backgroundColor: 'var(--card-bg)'
                  }}>
                    {/* Header: Icon + Title + Tooltip */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className="stat-icon-wrapper blue-icon" style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}>
                          <FolderTree size={17} />
                        </div>
                        <span style={{ fontWeight: '700', fontSize: '0.92rem', color: 'var(--text-main)' }}>Repository Structure</span>
                      </div>
                      <Tooltip 
                        title="Repository Modularity"
                        content="Analyzes project file layout, directories, modular separation, and presence of automated test suites."
                      />
                    </div>

                    {/* Primary Stat & Badge */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                        <span style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                          {(fs.total_files ?? 0).toLocaleString()}
                        </span>
                        <span style={{
                          fontSize: '0.74rem',
                          fontWeight: '700',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: modBadge.bg,
                          color: modBadge.color,
                          border: `1px solid ${modBadge.color}33`
                        }}>
                          {modBadge.label}
                        </span>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        marginTop: '4px',
                        fontSize: '0.78rem',
                        color: fs.has_tests_dir ? '#10b981' : 'var(--text-muted)'
                      }}>
                        <span>{fs.has_tests_dir ? '✓ Tests Directory Present' : '— No Tests Directory'}</span>
                      </div>
                    </div>

                    {/* Folders Overview (Fixed Grid) */}
                    {(fs.filtered_ai_folders || fs.top_level_directories) && (
                      <div style={{ marginTop: '2px' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                          Key Architectural Folders:
                        </div>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
                          gap: '5px'
                        }}>
                          {(fs.filtered_ai_folders || fs.top_level_directories).slice(0, 8).map((f, i) => (
                            <span
                              key={i}
                              title={`${f}/`}
                              style={{
                                fontSize: '0.72rem',
                                fontFamily: 'Fira Code, monospace',
                                fontWeight: '600',
                                backgroundColor: 'var(--bg-app)',
                                border: '1px solid var(--border-color)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                color: 'var(--primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                textAlign: 'center'
                              }}
                            >
                              {f}/
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Supporting Details (Aligned 2-Column Layout) */}
                    <div style={{
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '12px',
                      marginTop: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      fontSize: '0.8rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Total Directories:</span>
                        <strong style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                          {fs.total_directories ?? 0}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Test Suite:</span>
                        <strong style={{ color: fs.has_tests_dir ? '#10b981' : 'var(--text-muted)' }}>
                          {fs.has_tests_dir ? 'Present' : 'None'}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* ── Card 3: Documentation & Velocity ── */}
                  <div className="card" style={{
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    backgroundColor: 'var(--card-bg)'
                  }}>
                    {/* Header: Icon + Title + Tooltip */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className="stat-icon-wrapper blue-icon" style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}>
                          <FileText size={17} />
                        </div>
                        <span style={{ fontWeight: '700', fontSize: '0.92rem', color: 'var(--text-main)' }}>Docs & Velocity</span>
                      </div>
                      <Tooltip 
                        title="Documentation & Velocity"
                        content="Measures documentation presence and commit velocity trends across active days."
                      />
                    </div>

                    {/* Primary Stat & Badge */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                        <span style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                          {readme.readme_size_kb ? `${readme.readme_size_kb} KB` : '0 KB'}
                        </span>
                        <span style={{
                          fontSize: '0.74rem',
                          fontWeight: '700',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: docBadge.bg,
                          color: docBadge.color,
                          border: `1px solid ${docBadge.color}33`
                        }}>
                          Doc: {readme.documentation_score || 'Not Found'}
                        </span>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        marginTop: '4px',
                        fontSize: '0.78rem',
                        color: readme.has_setup_guide ? '#10b981' : 'var(--text-muted)'
                      }}>
                        <span>{readme.has_setup_guide ? '✓ Setup Guide Included' : '— No Setup Guide'}</span>
                      </div>
                    </div>

                    {/* Supporting Details (Aligned 2-Column Layout) */}
                    <div style={{
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '12px',
                      marginTop: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      fontSize: '0.8rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Avg Velocity:</span>
                        <strong style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                          {pacing.avg_commits_per_active_day || 0} commits / active day
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Peak Activity:</span>
                        <strong style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                          {pacing.peak_commit_date || 'N/A'} ({pacing.peak_commit_count || 0} commits)
                        </strong>
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
              const smellEntries = Object.entries(smells);
              const archEntries = Object.entries(archs);
              const hasSmells = smellEntries.length > 0;
              const hasArchs = archEntries.length > 0;

              const smellDescriptions = {
                dead_code: 'Unused functions, variables, or unreachable code paths.',
                large_function: 'Functions with high line counts reducing readability.',
                deep_nesting: 'Excessive nesting increasing cognitive complexity.',
                duplicate_code: 'Redundant logic repeated across files.',
                magic_numbers: 'Hardcoded literal values without named constants.',
                god_class: 'Classes or modules taking on too many responsibilities.',
              };

              const archDescriptions = {
                tight_coupling: 'Direct interdependent modules hindering modularity and testing.',
                poor_separation_of_concerns: 'Mixing UI, business logic, or data access in single files.',
                circular_dependency: 'Modules depending on each other in cycles.',
                leaky_abstraction: 'Implementation details exposed across boundaries.',
                monolithic_module: 'Overly centralized single-file modules.'
              };

              return (
                <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
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

                  {/* 2-Column Grid: Smells vs Architecture (Separated by Vertical Divider, No Nested Boxes) */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    gap: '32px'
                  }}>
                    {/* Left Column: Code Smells */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <AlertCircle size={16} style={{ color: '#f59e0b' }} />
                          <h3 style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--text-main)', margin: 0 }}>
                            Detected Code Smells
                          </h3>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Patterns indicating quality issues or maintenance friction across commits:
                        </p>
                      </div>

                      {hasSmells ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
                          {smellEntries.map(([smell, count], idx) => (
                            <div 
                              key={smell} 
                              style={{ 
                                paddingBottom: idx < smellEntries.length - 1 ? '12px' : '0', 
                                borderBottom: idx < smellEntries.length - 1 ? '1px solid var(--border-color)' : 'none' 
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                                <strong style={{ color: '#f59e0b', textTransform: 'capitalize', fontSize: '0.84rem' }}>
                                  {smell.replace(/_/g, ' ')}
                                </strong>
                                <span style={{
                                  backgroundColor: 'rgba(245,158,11,0.12)',
                                  color: '#f59e0b',
                                  fontWeight: '700',
                                  fontSize: '0.72rem',
                                  padding: '1px 6px',
                                  borderRadius: '4px'
                                }}>
                                  {count}×
                                </span>
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', lineHeight: '1.4' }}>
                                {smellDescriptions[smell] || 'Identified recurring code pattern that may reduce maintainability.'}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '0.82rem', fontWeight: '500', padding: '8px 0' }}>
                          <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                          <span>Clean code quality — no significant code smells detected.</span>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Architecture Issues (Separated by subtle border on larger screens or gap) */}
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: '12px',
                      borderLeft: '1px solid var(--border-color)',
                      paddingLeft: '32px'
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <Layers size={16} style={{ color: '#ef4444' }} />
                          <h3 style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--text-main)', margin: 0 }}>
                            Detected Architecture Issues
                          </h3>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Structural design concerns identified across repository modules:
                        </p>
                      </div>

                      {hasArchs ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
                          {archEntries.map(([issue, count], idx) => (
                            <div 
                              key={issue} 
                              style={{ 
                                paddingBottom: idx < archEntries.length - 1 ? '12px' : '0', 
                                borderBottom: idx < archEntries.length - 1 ? '1px solid var(--border-color)' : 'none' 
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                                <strong style={{ color: '#ef4444', textTransform: 'capitalize', fontSize: '0.84rem' }}>
                                  {issue.replace(/_/g, ' ')}
                                </strong>
                                <span style={{
                                  backgroundColor: 'rgba(239,68,68,0.12)',
                                  color: '#ef4444',
                                  fontWeight: '700',
                                  fontSize: '0.72rem',
                                  padding: '1px 6px',
                                  borderRadius: '4px'
                                }}>
                                  {count}×
                                </span>
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', lineHeight: '1.4' }}>
                                {archDescriptions[issue] || 'Structural modularity concern identified across components.'}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '0.82rem', fontWeight: '500', padding: '8px 0' }}>
                          <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                          <span>Clean architectural boundaries — no major modularity issues detected.</span>
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
                        <th style={{ width: '10%' }}>Quality Score</th>
                        <th style={{ width: '14%' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(qualData.contributors).map(([name, info]) => {
                        const stats = info.stats || {};
                        const examples = info.examples || {};
                        const qualityScore = stats.ai_quality_score ?? 0;
                        const scoreUnverified = stats.score_unverified ?? false;
                        const isFreeRider = stats.free_rider_suspected ?? false;
                        const flags = stats.detected_red_flags || [];
                        const isExpanded = expandedQualContributor === name;

                        // Quality Badge style helper
                        const getQualityBadge = (score) => {
                          const color = score >= 8 ? '#10b981' : score >= 5 ? '#f59e0b' : '#ef4444';
                          const bg = score >= 8 ? 'rgba(16,185,129,0.1)' : score >= 5 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)';
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
                              <td>
                                {scoreUnverified ? (
                                  <span
                                    title="No sampled commits could be analyzed by the local AI — risk not assessed"
                                    style={{
                                      display: 'inline-block',
                                      padding: '3px 8px',
                                      borderRadius: '4px',
                                      backgroundColor: 'rgba(107,114,128,0.12)',
                                      color: '#6b7280',
                                      fontWeight: '700',
                                      fontSize: '0.82rem'
                                    }}
                                  >
                                    N/A
                                  </span>
                                ) : getQualityBadge(qualityScore)}
                              </td>
                              <td>
                                {isFreeRider ? (
                                  <Tag 
                                    text="Free-rider Risk" 
                                    variant="danger" 
                                    style={{ fontSize: '10px', padding: '3px 6px', fontWeight: '700' }}
                                    title={flags.join(', ')}
                                  />
                                ) : scoreUnverified ? (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>Unverified</span>
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
              {/* Header Row: Title & Action Buttons */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
                flexWrap: 'wrap',
                gap: '12px',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Bot size={22} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main)', margin: 0 }}>
                    Cloud AI Final Evaluation Report
                  </h2>
                </div>

                {cloudReport && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      onClick={downloadCloudReportPDF}
                      disabled={isPdfDownloading || isCloudGenerating}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
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
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
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
                      
                      {/* 1. Dedicated Project Risk Score Banner */}
                      {cloudReport.overall_project_risk_score && (() => {
                        const raw = String(cloudReport.overall_project_risk_score).trim();
                        let scoreVal = raw;
                        let scoreDesc = '';
                        if (raw.includes(' - ')) {
                          const parts = raw.split(' - ');
                          scoreVal = parts[0].trim();
                          scoreDesc = parts.slice(1).join(' - ').trim();
                        } else if (raw.includes(': ')) {
                          const parts = raw.split(': ');
                          scoreVal = parts[0].trim();
                          scoreDesc = parts.slice(1).join(': ').trim();
                        } else if (raw.includes('(')) {
                          const match = raw.match(/^(.*?)\s*\((.*?)\)$/);
                          if (match) {
                            scoreVal = match[1].trim();
                            scoreDesc = match[2].trim();
                          }
                        }

                        const lower = scoreVal.toLowerCase();
                        const isHigh = lower.includes('high') || lower.includes('8/') || lower.includes('9/') || lower.includes('10/');
                        const isMed = lower.includes('mod') || lower.includes('medium') || lower.includes('5/') || lower.includes('6/') || lower.includes('7/');
                        const riskColor = isHigh ? '#10b981' : isMed ? '#f59e0b' : '#ef4444';
                        const riskBg = isHigh ? 'rgba(16, 185, 129, 0.05)' : isMed ? 'rgba(245, 158, 11, 0.05)' : 'rgba(239, 68, 68, 0.05)';
                        const riskBorder = isHigh ? 'rgba(16, 185, 129, 0.22)' : isMed ? 'rgba(245, 158, 11, 0.22)' : 'rgba(239, 68, 68, 0.22)';
                        const riskBadge = isHigh ? 'High Quality' : isMed ? 'Moderate Quality' : 'Poor Quality';

                        return (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '20px',
                            padding: '16px 20px',
                            backgroundColor: riskBg,
                            borderRadius: 'var(--radius-md)',
                            border: `1px solid ${riskBorder}`,
                            flexWrap: 'wrap'
                          }}>
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: '85px',
                              padding: '8px 14px',
                              backgroundColor: 'var(--bg-card)',
                              borderRadius: '8px',
                              border: `1px solid ${riskBorder}`,
                              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                              flexShrink: 0
                            }}>
                              <span style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Quality Score
                              </span>
                              <span style={{ fontSize: '1.45rem', fontWeight: '800', color: riskColor, fontVariantNumeric: 'tabular-nums', lineHeight: '1.15', marginTop: '2px' }}>
                                {scoreVal}
                              </span>
                            </div>

                            <div style={{ flex: 1, minWidth: '240px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: scoreDesc ? '4px' : 0 }}>
                                <AlertCircle size={15} style={{ color: riskColor, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.88rem', fontWeight: '700', color: 'var(--text-main)' }}>
                                  Overall Project Quality Evaluation
                                </span>
                                <span style={{
                                  fontSize: '0.72rem',
                                  fontWeight: '700',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: riskColor === '#ef4444' ? 'rgba(239,68,68,0.12)' : riskColor === '#f59e0b' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                                  color: riskColor
                                }}>
                                  {riskBadge}
                                </span>
                              </div>
                              {scoreDesc && (
                                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: '1.45' }}>
                                  {scoreDesc}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* 2. Executive Summary & Work Distribution (Clean Dividers without redundant card boxes) */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                        gap: '24px',
                        borderTop: '1px solid var(--border-color)',
                        borderBottom: '1px solid var(--border-color)',
                        paddingTop: '20px',
                        paddingBottom: '20px'
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FileText size={15} style={{ color: 'var(--primary)' }} />
                            <span>Executive Summary</span>
                          </h3>
                          <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: '1.6', color: 'var(--text-main)' }}>
                            {cloudReport.executive_summary}
                          </p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Users size={15} style={{ color: 'var(--primary)' }} />
                            <span>Work Distribution & Collaboration</span>
                          </h3>
                          <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: '1.6', color: 'var(--text-main)' }}>
                            {cloudReport.work_distribution_and_fairness}
                          </p>
                        </div>
                      </div>

                      {/* 3. Integrity Anomalies (Clean Alert banner) */}
                      {cloudReport.academic_integrity_anomalies && !cloudReport.academic_integrity_anomalies.includes("No anomalies") && !cloudReport.academic_integrity_anomalies.includes("none") && (
                        <div style={{
                          backgroundColor: 'rgba(239, 68, 68, 0.04)',
                          padding: '16px 18px',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          display: 'flex',
                          gap: '12px',
                          alignItems: 'flex-start'
                        }}>
                          <AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                          <div>
                            <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: '#ef4444', margin: '0 0 4px 0' }}>
                              Academic Integrity & Team Dynamics Anomalies
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.86rem', lineHeight: '1.55', color: 'var(--text-main)' }}>
                              {cloudReport.academic_integrity_anomalies}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* 4. Individual Student Qualitative Evaluations (Compact Responsive Table) */}
                      {cloudReport.student_evaluations && cloudReport.student_evaluations.length > 0 && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <h3 style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <User size={16} style={{ color: 'var(--primary)' }} />
                              <span>Individual Student Qualitative Evaluations</span>
                            </h3>
                            <Tooltip 
                              title="How Contribution Quality is Evaluated" 
                              content={
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    Quality verdicts are scored by combining 4 key signals:
                                  </span>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.78rem' }}>
                                    <div><strong>1. Substance:</strong> Ratio of substantial logic vs. trivial changes</div>
                                    <div><strong>2. Pacing:</strong> Steady incremental commits vs. last-minute dumps</div>
                                    <div><strong>3. Authenticity:</strong> Verified identity & proxy commit checks</div>
                                    <div><strong>4. Code Quality:</strong> Message-diff mismatches & code smells</div>
                                  </div>
                                </div>
                              } 
                            />
                          </div>
                          <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', textAlign: 'left' }}>
                              <thead>
                                <tr style={{ backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)' }}>
                                  <th style={{ width: '18%', padding: '10px 14px', fontSize: '0.74rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.04em' }}>Student</th>
                                  <th style={{ width: '22%', padding: '10px 14px', fontSize: '0.74rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.04em' }}>Verdict</th>
                                  <th style={{ width: '16%', padding: '10px 14px', fontSize: '0.74rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.04em' }}>Commits</th>
                                  <th style={{ width: '16%', padding: '10px 14px', fontSize: '0.74rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.04em' }}>Substance</th>
                                  <th style={{ width: '14%', padding: '10px 14px', fontSize: '0.74rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.04em' }}>Pacing</th>
                                  <th style={{ width: '14%', padding: '10px 14px', fontSize: '0.74rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.04em' }}>Quality Signals</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cloudReport.student_evaluations.map((student, idx) => {
                                  const rawVerdict = String(student.verdict || '').trim();
                                  let vBadge = rawVerdict;
                                  let vDetail = '';
                                  if (rawVerdict.includes(' - ')) {
                                    const parts = rawVerdict.split(' - ');
                                    vBadge = parts[0].trim();
                                    vDetail = parts.slice(1).join(' - ').trim();
                                  } else if (rawVerdict.includes(': ')) {
                                    const parts = rawVerdict.split(': ');
                                    vBadge = parts[0].trim();
                                    vDetail = parts.slice(1).join(': ').trim();
                                  } else if (rawVerdict.includes('(')) {
                                    const match = rawVerdict.match(/^(.*?)\s*\((.*?)\)$/);
                                    if (match) {
                                      vBadge = match[1].trim();
                                      vDetail = match[2].trim();
                                    }
                                  }

                                  const lowerV = vBadge.toLowerCase();
                                  // Quality wording (current): High/strong/good = green, Moderate/fair = amber,
                                  // Poor = red, Unverified = gray. Legacy Risk wording (older cached reports,
                                  // opposite polarity): Low Risk = green, High Risk = red.
                                  const isVUnverified = lowerV.includes('unverified') || lowerV.includes('n/a');
                                  const isVBad = lowerV.includes('poor') || lowerV.includes('high risk');
                                  const isVMed = !isVBad && (lowerV.includes('moderate') || lowerV.includes('medium') || lowerV.includes('fair') || lowerV.includes('minor'));
                                  const isVGood = !isVBad && !isVMed && (lowerV.includes('high quality') || lowerV.includes('low risk') || lowerV.includes('strong') || lowerV.includes('solid') || lowerV.includes('good'));
                                  const vColor = isVUnverified ? 'var(--text-muted)' : isVBad ? '#ef4444' : isVMed ? '#f59e0b' : isVGood ? '#10b981' : 'var(--text-muted)';
                                  const vBg = isVUnverified ? 'var(--bg-app)' : isVBad ? 'rgba(239,68,68,0.1)' : isVMed ? 'rgba(245,158,11,0.1)' : isVGood ? 'rgba(16,185,129,0.1)' : 'var(--bg-app)';
                                  const vBorder = isVUnverified ? 'var(--border-color)' : isVBad ? 'rgba(239,68,68,0.25)' : isVMed ? 'rgba(245,158,11,0.25)' : isVGood ? 'rgba(16,185,129,0.25)' : 'var(--border-color)';

                                  const matchingContrib = analytics?.contributions?.find(c => c.name.toLowerCase() === student.student_name.toLowerCase());
                                  const ghUsername = student.github_username || matchingContrib?.github_username;

                                  return (
                                    <tr key={idx} style={{ borderBottom: idx < cloudReport.student_evaluations.length - 1 ? '1px solid var(--border-color)' : 'none', backgroundColor: 'var(--bg-card)' }}>
                                      <td style={{ fontWeight: '600', color: 'var(--text-main)', verticalAlign: 'top', padding: '10px 14px', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          {ghUsername ? (
                                            <img 
                                              src={`https://github.com/${ghUsername}.png`} 
                                              alt={ghUsername}
                                              style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                                              onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                          ) : (
                                            <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: 'var(--primary-alpha)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '700', color: 'var(--primary)', flexShrink: 0 }}>
                                              {student.student_name.charAt(0).toUpperCase()}
                                            </div>
                                          )}
                                          <span style={{ fontSize: '0.86rem', lineHeight: '1.3' }}>{student.student_name}</span>
                                        </div>
                                      </td>
                                      <td style={{ verticalAlign: 'top', padding: '10px 14px', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
                                          <span style={{
                                            padding: '1.5px 7px',
                                            borderRadius: '4px',
                                            fontSize: '0.72rem',
                                            fontWeight: '700',
                                            color: vColor,
                                            backgroundColor: vBg,
                                            border: `1px solid ${vBorder}`,
                                            display: 'inline-block'
                                          }}>
                                            {vBadge}
                                          </span>
                                          {vDetail && (
                                            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: '1.3' }}>
                                              {vDetail}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ fontSize: '0.80rem', color: 'var(--text-main)', verticalAlign: 'top', padding: '10px 14px', lineHeight: '1.4', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>
                                        {student.commits_summary}
                                      </td>
                                      <td style={{ fontSize: '0.80rem', color: 'var(--text-main)', verticalAlign: 'top', padding: '10px 14px', lineHeight: '1.4', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>
                                        {student.substance_breakdown}
                                      </td>
                                      <td style={{ fontSize: '0.80rem', color: 'var(--text-main)', verticalAlign: 'top', padding: '10px 14px', lineHeight: '1.4', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>
                                        {student.pacing_and_deadlines}
                                      </td>
                                      <td style={{ fontSize: '0.80rem', color: 'var(--text-main)', verticalAlign: 'top', padding: '10px 14px', lineHeight: '1.4', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>
                                        {student.quality_and_integrity_signals}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* 5. Actionable Recommendations */}
                      {cloudReport.actionable_recommendations && cloudReport.actionable_recommendations.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                          <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-main)', margin: '0 0 10px 0' }}>
                            Actionable Recommendations
                          </h3>
                          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {cloudReport.actionable_recommendations.map((rec, idx) => (
                              <li key={idx} style={{ fontSize: '0.88rem', color: 'var(--text-main)', lineHeight: '1.55' }}>
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

      {showMergeModal && mergeSource && (
        <div className="modal-overlay" onClick={() => { setShowMergeModal(false); setMergeSource(null); }}>
          <div className="modal-card card" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px', width: '90%' }}>
            <div className="modal-header">
              <div className="modal-title-box">
                <GitMerge size={20} className="primary-text" />
                <h2>Merge Contributor Profile</h2>
              </div>
              <button 
                className="close-btn" 
                onClick={() => { setShowMergeModal(false); setMergeSource(null); }}
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleMergeSubmit} className="modal-form" style={{ textAlign: 'left' }}>
              
              {/* Step 1: Source */}
              <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                  1. Profile to Merge (Will be Hidden / Merged)
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)' }}>
                  {mergeSource.name}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'Fira Code, monospace' }}>
                  {mergeSource.email || 'No email provided'}
                </div>
              </div>

              {/* Direction Indicator + Swap affordance */}
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '8px 0', gap: '8px', color: 'var(--primary)' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Merge Into ↓</span>
                {mergeTargetId && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '0.72rem', padding: '2px 8px', gap: '4px' }}
                    onClick={() => {
                      const targetContrib = analytics?.contributions?.find(c => String(c.author_id) === String(mergeTargetId));
                      if (targetContrib) {
                        const oldSource = { ...mergeSource };
                        setMergeSource({ id: targetContrib.author_id, name: targetContrib.name, email: targetContrib.email });
                        setMergeTargetId(String(oldSource.id));
                      }
                    }}
                    title="Swap merge source and destination"
                  >
                    ⇄ Swap Direction
                  </button>
                )}
              </div>

              {/* Step 2: Target */}
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                  2. Destination Profile (Will Receive Data & Remain Active)
                </div>
                <select
                  className="select-field"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  required
                  style={{ width: '100%', padding: '8px' }}
                >
                  <option value="">Select target contributor profile...</option>
                  {analytics?.contributions
                    ?.filter(c => c.author_id !== mergeSource.id)
                    ?.map(c => (
                      <option key={c.author_id} value={c.author_id}>
                        {c.name} ({c.email})
                      </option>
                    ))
                  }
                </select>
                {(!analytics?.contributions || analytics.contributions.filter(c => c.author_id !== mergeSource.id).length === 0) && (
                  <p style={{ marginTop: '8px', color: 'var(--color-danger)', fontSize: '0.8rem', margin: 0 }}>
                    No other contributor profiles found in this project.
                  </p>
                )}
              </div>

              {/* Explanation Note */}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '16px' }}>
                <span>💡</span>
                <div>
                  All commits, lines of code, and git activities from <strong>{mergeSource.name}</strong> will be consolidated under the destination profile. Workload distribution and qualitative analysis will be automatically recalculated.
                </div>
              </div>
              
              <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  disabled={mergingIdentity}
                  onClick={() => { setShowMergeModal(false); setMergeSource(null); }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={!mergeTargetId || mergingIdentity}
                >
                  {mergingIdentity ? 'Merging...' : 'Confirm & Merge Profiles'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

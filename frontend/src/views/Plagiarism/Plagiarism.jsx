import React, { useState } from 'react';
import { AlertCircleIcon, CheckCircle2, XCircle, Play, RefreshCw, FileCode, Eye, AlertCircle } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import PlagiarismCodeCompareModal from '../../components/PlagiarismCodeCompareModal';
import './Plagiarism.css';

export default function Plagiarism({ alerts = [], currentCourseId }) {
  const { addNotification } = useNotification();
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'resolved'
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgressPct, setScanProgressPct] = useState(0);
  const [scanMessage, setScanMessage] = useState('');
  const [localAlerts, setLocalAlerts] = useState(alerts);
  const [inspectingAlert, setInspectingAlert] = useState(null);

  const displayAlerts = localAlerts.length > 0 ? localAlerts : alerts;

  const filteredAlerts = displayAlerts.filter(alert => {
    if (activeTab === 'active') {
      return !alert.status || alert.status === 'Needs Review';
    }
    return alert.status === 'Resolved' || alert.status === 'Dismissed' || alert.status === 'Confirmed';
  });

  const handleRunAnalysis = async () => {
    if (!currentCourseId) {
      addNotification({ type: 'warning', title: 'No Course', description: "No course selected." });
      return;
    }
    setIsScanning(true);
    setScanProgressPct(15);
    setScanMessage("Scanning AST structures & generating k-grams...");

    const progressTimer = setInterval(() => {
      setScanProgressPct(prev => {
        if (prev < 65) {
          setScanMessage("Comparing structural fingerprints & applying Winnowing algorithm...");
          return prev + 10;
        } else if (prev < 90) {
          setScanMessage("Filtering stopwords & updating database...");
          return prev + 5;
        }
        return prev;
      });
    }, 250);

    try {
      // TODO: migrate to apiFetch
      const res = await fetch(`/api/v1/courses/${currentCourseId}/similarity/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: 5, w: 4, similarity_threshold: 30.0 })
      });

      clearInterval(progressTimer);
      setScanProgressPct(100);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Similarity analysis failed.");
      }

      const data = await res.json();
      setScanMessage(`Scan completed! Scanned ${data.projects_scanned} projects, found ${data.total_flagged_pairs || 0} matching pair(s).`);

      const formatted = (data.reports || []).map((r, idx) => ({
        id: r.report_id || (idx + 1),
        severity: r.confidence_level === 'HIGH' ? 'High' : 'Medium',
        percentage: r.file_match_percentage || r.similarity_score,
        fileMatchPct: r.file_match_percentage || r.similarity_score,
        identifierOverlap: r.identifier_overlap_percentage || 100.0,
        totalMatchRuns: r.total_match_runs || (r.matched_blocks?.length || 0),
        maxContiguousTokens: r.max_contiguous_run_tokens || 0,
        timestamp: 'Recently',
        projectA: r.project_a_name,
        projectAId: r.project_a_id,
        authorA: 'Project ' + r.project_a_name,
        projectB: r.project_b_name,
        projectBId: r.project_b_id,
        authorB: 'Project ' + r.project_b_name,
        matchedFile: r.matched_blocks?.[0]?.file_a || 'AST Structure Overlap',
        matchedBlocks: r.matched_blocks || [],
        status: r.status || 'Needs Review'
      }));

      setLocalAlerts(formatted);
    } catch (err) {
      clearInterval(progressTimer);
      console.error("Similarity Scan Error:", err);
      setScanMessage(`Scan failed: ${err.message}`);
    } finally {
      setTimeout(() => setIsScanning(false), 500);
    }
  };

  const handleUpdateReportStatus = async (reportId, newStatus) => {
    // 1. Instant local state update
    setLocalAlerts(prev => prev.map(a => a.id === reportId ? { ...a, status: newStatus } : a));

    // 2. Persist status in database
    try {
      // TODO: migrate to apiFetch
      await fetch(`/api/v1/similarity/reports/${reportId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (err) {
      console.error("Failed to update status in DB:", err);
    }
  };

  return (
    <div className="plagiarism-view">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '16px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, textAlign: 'left', flexWrap: 'wrap' }}>
            <span>Plagiarism Alerts</span>
            <span style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-color)', display: 'inline-block', margin: '0 4px', alignSelf: 'center' }} />
            <span style={{ fontSize: '0.82rem', fontWeight: '400', color: 'var(--text-muted)', letterSpacing: 'normal' }}>Cross-repository AST Winnowing similarity flags and duplication logs.</span>
          </h1>
        </div>

        <button 
          className="btn btn-primary" 
          onClick={handleRunAnalysis}
          disabled={isScanning}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          {isScanning ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
          <span>{isScanning ? 'Running Scan...' : 'Run Similarity Scan'}</span>
        </button>
      </div>

      {/* Scanning Progress Bar */}
      {isScanning && (
        <div style={{ padding: '8px 0', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>{scanMessage}</span>
            <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{scanProgressPct}%</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '4px', width: '100%', overflow: 'hidden' }}>
            <div 
              style={{ 
                height: '100%', 
                width: `${scanProgressPct}%`, 
                background: 'var(--text-muted, #94a3b8)', 
                transition: 'width 0.3s ease-in-out',
                borderRadius: '4px'
              }} 
            />
          </div>
        </div>
      )}

      {scanMessage && !isScanning && (
        <div style={{ padding: '6px 0', marginBottom: '16px' }}>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>{scanMessage}</p>
        </div>
      )}

      {/* Toggle Tabs */}
      <div className="plag-tabs" style={{ marginBottom: '16px' }}>
        <button 
          className={`tab-btn ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          Active Alerts ({displayAlerts.filter(a => !a.status || a.status === 'Needs Review').length})
        </button>
        <button 
          className={`tab-btn ${activeTab === 'resolved' ? 'active' : ''}`}
          onClick={() => setActiveTab('resolved')}
        >
          Resolved Alerts ({displayAlerts.filter(a => a.status === 'Resolved' || a.status === 'Dismissed' || a.status === 'Confirmed').length})
        </button>
      </div>

      {/* Alerts List */}
      <div className="alerts-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {filteredAlerts.map((alert) => (
          <div key={alert.id} className="alert-itemcard card" style={{ padding: '18px 20px', borderRadius: '10px' }}>
            <div className="alert-itemcard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div className="risk-level-badge" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={18} style={{ color: alert.severity === 'High' ? '#ef4444' : '#f59e0b' }} />
                <span style={{ fontWeight: '300', fontSize: '0.95rem' }}><strong>{alert.percentage}% File Overlap</strong></span>
              
              </div>
              <span className="alert-timestamp" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Flagged {alert.timestamp}</span>
            </div>

            {/* Matched Projects Small Section */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '12px' }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>Repository A</span>
                <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '2px' }}>{alert.projectA}</div>
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.08)', padding: '4px 10px', borderRadius: '4px' }}>VS</div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>Repository B</span>
                <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '2px' }}>{alert.projectB}</div>
              </div>
            </div>

            <div className="matched-files-box" style={{ marginBottom: '14px' }}>
              <p style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0, fontSize: '0.88rem' }}>
                <FileCode size={16} style={{ color: '#60a5fa' }} />
                <strong>Matched Structural File:</strong> <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.82rem' }}>{alert.matchedFile}</code>
              </p>
            </div>

            <div className="alert-actions-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setInspectingAlert(alert)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
              >
                <Eye size={14} />
                <span>View Code</span>
              </button>

              {(!alert.status || alert.status === 'Needs Review') ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    className="btn btn-primary btn-sm success-btn"
                    onClick={() => handleUpdateReportStatus(alert.id, 'Dismissed')}
                    style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid #10b981', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '600' }}
                  >
                    <CheckCircle2 size={14} />
                    <span>Dismiss (Safe)</span>
                  </button>
                  <button 
                    className="btn btn-outline btn-sm danger-btn"
                    onClick={() => handleUpdateReportStatus(alert.id, 'Confirmed')}
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid #ef4444', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '600' }}
                  >
                    <XCircle size={14} />
                    <span>Confirm Infraction</span>
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: '0.8rem', padding: '4px 10px', borderRadius: '4px', fontWeight: '600', background: alert.status === 'Dismissed' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: alert.status === 'Dismissed' ? '#34d399' : '#f87171', border: alert.status === 'Dismissed' ? '1px solid #10b981' : '1px solid #ef4444' }}>
                  Status: {alert.status}
                </span>
              )}
            </div>
          </div>
        ))}

        {filteredAlerts.length === 0 && (
          <div className="empty-alerts card" style={{ padding: '40px', textAlign: 'center' }}>
            <CheckCircle2 size={48} className="empty-icon" style={{ color: '#10b981', margin: '0 auto 12px auto' }} />
            <h3>No Plagiarism Alerts</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {activeTab === 'active' 
                ? 'All scanned project codebases are clean or no similarity threshold was exceeded. Click Run AST Similarity Scan above to scan projects.'
                : 'No resolved or dismissed alerts recorded yet.'}
            </p>
          </div>
        )}
      </div>

      {/* Side-by-Side Comparative Code Inspection Modal */}
      {inspectingAlert && (
        <PlagiarismCodeCompareModal
          alert={inspectingAlert}
          onClose={() => setInspectingAlert(null)}
        />
      )}
    </div>
  );
}

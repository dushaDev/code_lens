import React, { useState } from 'react';
import { AlertCircleIcon, CheckCircle2, XCircle, Play, RefreshCw, Eye, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { apiFetch } from '../../api/client';
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
  const [inspectingBlockIdx, setInspectingBlockIdx] = useState(0);
  const [expandedAlertFiles, setExpandedAlertFiles] = useState({});

  const toggleExpandFiles = (alertId) => {
    setExpandedAlertFiles(prev => ({
      ...prev,
      [alertId]: !prev[alertId]
    }));
  };

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
      const res = await apiFetch(`/api/v1/courses/${currentCourseId}/similarity/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: 5, w: 4, similarity_threshold: 25.0 })
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
    setLocalAlerts(prev => prev.map(a => a.id === reportId ? { ...a, status: newStatus } : a));

    try {
      await apiFetch(`/api/v1/similarity/reports/${reportId}/status`, {
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
      <div className="view-header">
        <div>
          <h1>Plagiarism Alerts</h1>
          <p className="subtitle">Cross-repository AST Winnowing similarity flags and duplication logs.</p>
        </div>
        <button 
          className="btn btn-primary"
          onClick={handleRunAnalysis}
          disabled={isScanning}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          {isScanning ? (
            <>
              <RefreshCw size={16} className="spinning" />
              <span>Scanning Course Repositories...</span>
            </>
          ) : (
            <>
              <Play size={16} />
              <span>Run Similarity Scan</span>
            </>
          )}
        </button>
      </div>

      {isScanning && (
        <div className="card scan-progress-card" style={{ marginBottom: '20px', padding: '16px 20px', borderLeft: '4px solid var(--accent-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.88rem', fontWeight: '600' }}>
            <span>{scanMessage}</span>
            <span>{scanProgressPct}%</span>
          </div>
          <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${scanProgressPct}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}

      {!isScanning && scanMessage && (
        <div className="card scan-summary-card" style={{ marginBottom: '20px', padding: '12px 18px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertCircleIcon size={18} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <span style={{ fontSize: '0.88rem', color: '#93c5fd' }}>{scanMessage}</span>
        </div>
      )}

      <div className="plagiarism-tabs">
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

      <div className="alerts-list">
        {filteredAlerts.map(alert => {
          const filePairs = (() => {
            const seen = new Set();
            const pairs = [];
            const blocks = alert.matchedBlocks || [];
            blocks.forEach((block, bIdx) => {
              const fA = block.file_a || 'unknown';
              const fB = block.file_b || 'unknown';
              const key = `${fA}::${fB}`;
              if (!seen.has(key)) {
                seen.add(key);
                pairs.push({
                  blockIdx: bIdx,
                  fileA: fA,
                  fileB: fB,
                  lineStartA: block.line_a,
                  lineEndA: block.end_line_a,
                  lineStartB: block.line_b,
                  lineEndB: block.end_line_b,
                  tokens: block.token_span
                });
              }
            });
            return pairs;
          })();

          const isExpanded = !!expandedAlertFiles[alert.id];
          const visibleFiles = isExpanded ? filePairs : filePairs.slice(0, 1);
          const hiddenCount = filePairs.length - 1;
          const severityColor = alert.severity === 'High' ? '#ef4444' : '#f59e0b';

          return (
            <div
              key={alert.id}
              className="alert-itemcard card"
              style={{
                padding: '12px 16px',
                marginBottom: '10px'
              }}
            >
              {/* Header: Single Consolidated Stat + Timestamp */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      backgroundColor: severityColor,
                      display: 'inline-block'
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: '700', color: severityColor }}>
                    {alert.percentage}% overlap &middot; {filePairs.length} {filePairs.length === 1 ? 'file' : 'files'}
                  </span>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Flagged {alert.timestamp}
                </span>
              </div>

              {/* Simplified Repo Comparison Header */}
              <div
                style={{
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-main)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px'
                }}
              >
                <span>{alert.projectA}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: '400', fontSize: '0.82rem' }}>↔</span>
                <span>{alert.projectB}</span>
              </div>

              {/* Files Table (Clean Rows, No Pill Borders) */}
              {filePairs.length > 0 ? (
                <div
                  style={{
                    borderTop: '1px solid var(--border-color)',
                    borderBottom: '1px solid var(--border-color)',
                    paddingTop: '2px',
                    paddingBottom: '2px',
                    marginBottom: '10px'
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {visibleFiles.map((p, pIdx) => (
                        <tr
                          key={pIdx}
                          onClick={() => {
                            setInspectingBlockIdx(p.blockIdx);
                            setInspectingAlert(alert);
                          }}
                          title="Click to inspect side-by-side code diff"
                          className="file-match-row"
                          style={{ cursor: 'pointer' }}
                        >
                          <td style={{ padding: '4px 4px', color: 'var(--text-main)', fontFamily: 'Fira Code, Consolas, monospace', fontSize: '0.76rem' }}>
                            <span>{p.fileA}</span>
                            <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>↔</span>
                            <span>{p.fileB}</span>
                          </td>
                          <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                            {p.tokens ? `${p.tokens.toLocaleString()} tokens` : ''}
                          </td>
                          <td style={{ padding: '4px 2px', textAlign: 'right', width: '18px', color: 'var(--text-muted)' }}>
                            <ChevronRight size={13} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleExpandFiles(alert.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '0.74rem',
                        cursor: 'pointer',
                        padding: '2px 4px 4px 4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        textDecoration: 'none'
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      {isExpanded ? (
                        <>Show fewer files <ChevronUp size={11} /></>
                      ) : (
                        <>+ See {hiddenCount} more {hiddenCount === 1 ? 'file' : 'files'} <ChevronDown size={11} /></>
                      )}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                  {alert.matchedFile || 'AST Structure Overlap'}
                </div>
              )}

              {/* Action Buttons: Clear Visual Weight Hierarchy */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setInspectingBlockIdx(0);
                    setInspectingAlert(alert);
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.76rem', padding: '4px 10px' }}
                >
                  <Eye size={12} />
                  <span>Side-by-Side Diff</span>
                </button>

                {(!alert.status || alert.status === 'Needs Review') ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {/* Primary / Safe Decision: Filled secondary button */}
                    <button 
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleUpdateReportStatus(alert.id, 'Dismissed')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.76rem', padding: '4px 10px' }}
                    >
                      <CheckCircle2 size={12} />
                      <span>Dismiss</span>
                    </button>
                    {/* Destructive Action: Outlined/Ghost button with red accent */}
                    <button 
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleUpdateReportStatus(alert.id, 'Confirmed')}
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        color: '#f87171',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.76rem',
                        padding: '4px 10px',
                        cursor: 'pointer'
                      }}
                    >
                      <XCircle size={12} />
                      <span>Confirm Infraction</span>
                    </button>
                  </div>
                ) : (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontWeight: '600',
                      background: alert.status === 'Dismissed' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                      color: alert.status === 'Dismissed' ? '#34d399' : '#f87171',
                      border: alert.status === 'Dismissed' ? '1px solid #10b981' : '1px solid #ef4444'
                    }}
                  >
                    Status: {alert.status}
                  </span>
                )}
              </div>
            </div>
          );
        })}

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

      {inspectingAlert && (
        <PlagiarismCodeCompareModal
          alert={inspectingAlert}
          initialBlockIdx={inspectingBlockIdx}
          onClose={() => setInspectingAlert(null)}
        />
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { ShieldAlert, AlertOctagon, HelpCircle, User, CheckCircle2, XCircle } from 'lucide-react';
import './Plagiarism.css';

export default function Plagiarism({ alerts, onResolveAlert }) {
  const [activeTab, setActiveTab] = useState('active');

  const filteredAlerts = alerts.filter(alert => {
    if (activeTab === 'active') return alert.status === 'Needs Review';
    return alert.status === 'Resolved';
  });

  return (
    <div className="plagiarism-view">
      <div className="view-header">
        <div>
          <h1>Plagiarism Alerts</h1>
          <p className="subtitle">Cross-repository code similarity flags and duplication detection logs.</p>
        </div>
      </div>

      {/* Main warning card */}
      <div className="plagiarism-banner card">
        <ShieldAlert size={28} className="banner-icon" />
        <div className="banner-text">
          <h3>Plagiarism Detection Engine Active</h3>
          <p>
            The engine scans git diff insertions for copy-paste matches, structure patterns, 
            and comment duplications. Immediate instructor review is required for items flagged as <strong>High Risk</strong>.
          </p>
        </div>
      </div>

      {/* Toggle Tabs */}
      <div className="plag-tabs">
        <button 
          className={`tab-btn ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          Active Alerts ({alerts.filter(a => a.status === 'Needs Review').length})
        </button>
        <button 
          className={`tab-btn ${activeTab === 'resolved' ? 'active' : ''}`}
          onClick={() => setActiveTab('resolved')}
        >
          Resolved Alerts ({alerts.filter(a => a.status === 'Resolved').length})
        </button>
      </div>

      {/* Alerts List */}
      <div className="alerts-list">
        {filteredAlerts.map((alert) => (
          <div key={alert.id} className="alert-itemcard card">
            <div className="alert-itemcard-header">
              <div className="risk-level-badge">
                <AlertOctagon size={18} />
                <span>{alert.severity} Risk ({alert.percentage}%)</span>
              </div>
              <span className="alert-timestamp">Flagged {alert.timestamp}</span>
            </div>

            <div className="alert-comparison-details">
              <div className="compare-side">
                <span className="side-label">Repository A</span>
                <h4>{alert.projectA}</h4>
                <div className="author-box">
                  <User size={14} />
                  <span>{alert.authorA}</span>
                </div>
              </div>
              <div className="compare-versus">VS</div>
              <div className="compare-side">
                <span className="side-label">Repository B</span>
                <h4>{alert.projectB}</h4>
                <div className="author-box">
                  <User size={14} />
                  <span>{alert.authorB}</span>
                </div>
              </div>
            </div>

            <div className="matched-files-box">
              <p><strong>Highest Match File:</strong> <code>{alert.matchedFile}</code></p>
              <p className="matched-note">AST structural fingerprint overlap detected in function implementations.</p>
            </div>

            {alert.status === 'Needs Review' && (
              <div className="alert-actions-row">
                <button 
                  className="btn btn-primary btn-sm success-btn"
                  onClick={() => onResolveAlert(alert.id, 'Dismissed')}
                >
                  <CheckCircle2 size={14} />
                  <span>Dismiss (Safe)</span>
                </button>
                <button 
                  className="btn btn-outline btn-sm danger-btn"
                  onClick={() => onResolveAlert(alert.id, 'Flagged')}
                >
                  <XCircle size={14} />
                  <span>Confirm Infraction</span>
                </button>
              </div>
            )}
          </div>
        ))}

        {filteredAlerts.length === 0 && (
          <div className="empty-alerts card">
            <CheckCircle2 size={40} className="check-icon" />
            <h3>No Alerts Found</h3>
            <p>All scanned codebases are clean and show healthy original git history.</p>
          </div>
        )}
      </div>
    </div>
  );
}

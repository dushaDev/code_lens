import React from 'react';
import { Bot, X, ArrowRight, Loader2 } from 'lucide-react';

/**
 * QualitativeFloatingPill
 * A persistent floating status toast shown in the top-right corner
 * whenever qualitative analysis is running and the user is NOT viewing it.
 */
export default function QualitativeFloatingPill({ qualAnalysisState, onView, onDismiss }) {
  const { status, progress, message } = qualAnalysisState;

  if (status !== 'running' && status !== 'cancelling') return null;

  const isRunning = status === 'running';

  return (
    <div
      style={{
        position: 'fixed',
        top: '72px',
        right: '20px',
        zIndex: 99999,
        width: '320px',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        animation: 'pillSlideIn 0.25s ease-out',
      }}
    >
      <style>{`
        @keyframes pillSlideIn {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes pill-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .pill-spin { animation: pill-spin 1.2s linear infinite; }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-color)',
          background: 'linear-gradient(90deg, rgba(99,102,241,0.12), transparent)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Loader2 size={14} className="pill-spin" style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {isRunning ? 'AI Analysis Running' : 'Cancelling...'}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: '4px' }}
          title="Hide pill (process keeps running in background)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Progress bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ flex: 1, height: '6px', borderRadius: '4px', backgroundColor: 'var(--bg-app)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                borderRadius: '4px',
                background: 'linear-gradient(90deg, var(--primary), #818cf8)',
                transition: 'width 0.4s ease-out',
              }}
            />
          </div>
          <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--primary)', minWidth: '36px', textAlign: 'right' }}>
            {progress}%
          </span>
        </div>

        {/* Status message */}
        <p
          style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={message}
        >
          {message || 'Processing commits...'}
        </p>

        {/* View button */}
        <button
          type="button"
          onClick={onView}
          style={{
            alignSelf: 'flex-end',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 12px',
            borderRadius: '6px',
            border: '1px solid var(--primary)',
            background: 'rgba(99,102,241,0.12)',
            color: 'var(--primary)',
            fontSize: '0.8rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.22)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; }}
        >
          <Bot size={13} />
          <span>View Progress</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}

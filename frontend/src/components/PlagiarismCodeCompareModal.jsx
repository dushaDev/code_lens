import React, { useState, useEffect, useRef } from 'react';
import { X, AlertOctagon, FileCode, ArrowRight, CornerDownRight, CheckCircle2 } from 'lucide-react';
import './PlagiarismCodeCompareModal.css';

export default function PlagiarismCodeCompareModal({ alert, onClose }) {
  const [selectedBlockIdx, setSelectedBlockIdx] = useState(0);
  const [fileAContent, setFileAContent] = useState('');
  const [fileBContent, setFileBContent] = useState('');
  const [loadingA, setLoadingA] = useState(true);
  const [loadingB, setLoadingB] = useState(true);
  const [errorA, setErrorA] = useState(null);
  const [errorB, setErrorB] = useState(null);

  const leftEditorRef = useRef(null);
  const rightEditorRef = useRef(null);

  const matchedBlocks = alert?.matchedBlocks || [];
  const currentBlock = matchedBlocks[selectedBlockIdx] || matchedBlocks[0] || {};

  const projectAId = alert?.projectAId || alert?.project_a_id;
  const projectBId = alert?.projectBId || alert?.project_b_id;

  const fileA = currentBlock.file_a || alert?.matchedFile || '';
  const fileB = currentBlock.file_b || alert?.matchedFile || '';

  const lineStartA = currentBlock.line_a || 1;
  const lineEndA = currentBlock.end_line_a || lineStartA;

  const lineStartB = currentBlock.line_b || 1;
  const lineEndB = currentBlock.end_line_b || lineStartB;

  // Fetch File A content
  useEffect(() => {
    if (!projectAId || !fileA) {
      setLoadingA(false);
      setErrorA('Missing Project A ID or file path');
      return;
    }
    setLoadingA(true);
    setErrorA(null);

    const token = localStorage.getItem('token');
    fetch(`/api/v1/projects/${projectAId}/files/content?file_path=${encodeURIComponent(fileA)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('File not found in Project A repo');
        return res.json();
      })
      .then(data => setFileAContent(data.content || ''))
      .catch(err => setErrorA(err.message))
      .finally(() => setLoadingA(false));
  }, [projectAId, fileA]);

  // Fetch File B content
  useEffect(() => {
    if (!projectBId || !fileB) {
      setLoadingB(false);
      setErrorB('Missing Project B ID or file path');
      return;
    }
    setLoadingB(true);
    setErrorB(null);

    const token = localStorage.getItem('token');
    fetch(`/api/v1/projects/${projectBId}/files/content?file_path=${encodeURIComponent(fileB)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('File not found in Project B repo');
        return res.json();
      })
      .then(data => setFileBContent(data.content || ''))
      .catch(err => setErrorB(err.message))
      .finally(() => setLoadingB(false));
  }, [projectBId, fileB]);

  // Auto-scroll to highlighted overlap lines when loaded or block changes
  useEffect(() => {
    if (!loadingA && leftEditorRef.current) {
      const targetElem = leftEditorRef.current.querySelector(`#line-a-${lineStartA}`);
      if (targetElem) {
        targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [loadingA, lineStartA, fileAContent]);

  useEffect(() => {
    if (!loadingB && rightEditorRef.current) {
      const targetElem = rightEditorRef.current.querySelector(`#line-b-${lineStartB}`);
      if (targetElem) {
        targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [loadingB, lineStartB, fileBContent]);

  const handleJumpToOverlap = () => {
    if (leftEditorRef.current) {
      const targetA = leftEditorRef.current.querySelector(`#line-a-${lineStartA}`);
      if (targetA) targetA.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (rightEditorRef.current) {
      const targetB = rightEditorRef.current.querySelector(`#line-b-${lineStartB}`);
      if (targetB) targetB.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const renderCodeLines = (content, startLine, endLine, prefix) => {
    const lines = content.split('\n');
    return lines.map((lineText, idx) => {
      const lineNum = idx + 1;
      const isOverlap = lineNum >= startLine && lineNum <= endLine;
      return (
        <div
          key={lineNum}
          id={`${prefix}-${lineNum}`}
          className={`plag-compare-line-row ${isOverlap ? 'highlighted-overlap' : ''}`}
        >
          <span className="line-number">{lineNum}</span>
          <span className="line-content">{lineText || ' '}</span>
        </div>
      );
    });
  };

  return (
    <div className="plag-compare-modal-overlay" onClick={onClose}>
      <div className="plag-compare-modal-container" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="plag-compare-modal-header">
          <div className="plag-compare-header-info">
            <h3 className="plag-compare-header-title">
              <AlertOctagon size={20} style={{ color: '#ef4444' }} />
              <span>Code Review</span>
            </h3>
            <span style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '4px 10px', borderRadius: '4px', fontSize: '0.82rem', fontWeight: '600' }}>
              {alert?.percentage || 0}% Overlap
            </span>

        
          </div>
          <button className="icon-btn" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="plag-compare-modal-body">
          {/* Toolbar */}
          <div className="plag-compare-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600' }}>
                Matched AST Overlaps ({matchedBlocks.length}):
              </span>
              {matchedBlocks.length > 1 && (
                <select
                  value={selectedBlockIdx}
                  onChange={e => setSelectedBlockIdx(Number(e.target.value))}
                  style={{ padding: '4px 10px', borderRadius: '6px', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)', fontSize: '0.83rem' }}
                >
                  {matchedBlocks.map((b, idx) => (
                    <option key={idx} value={idx}>
                      Match #{idx + 1}: {b.file_a} (L{b.line_a}) ↔ {b.file_b} (L{b.line_b}) [{b.token_span || 15} tokens]
                    </option>
                  ))}
                </select>
              )}
            </div>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleJumpToOverlap}
              style={{ fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <CornerDownRight size={14} />
              <span>Jump to Overlap Lines</span>
            </button>
          </div>

          {/* Side-by-Side Dual Editor View */}
          <div className="plag-compare-split-container">
            {/* Panel A: Project A */}
            <div className="plag-compare-side-panel">
              <div className="plag-compare-side-header">
                <div className="plag-compare-side-title">
                  <FileCode size={16} />
                  <span>Repo A: {alert?.projectA || 'Project A'}</span>
                </div>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                  {fileA} (Lines {lineStartA}-{lineEndA})
                </span>
              </div>
              <div className="plag-compare-code-editor" ref={leftEditorRef}>
                {loadingA ? (
                  <div className="loader-box" style={{ padding: '40px' }}><div className="spinner" /><p>Loading Project A code...</p></div>
                ) : errorA ? (
                  <div style={{ padding: '20px', color: '#ef4444' }}>{errorA}</div>
                ) : (
                  renderCodeLines(fileAContent, lineStartA, lineEndA, 'line-a')
                )}
              </div>
            </div>

            {/* Panel B: Project B */}
            <div className="plag-compare-side-panel">
              <div className="plag-compare-side-header">
                <div className="plag-compare-side-title" style={{ color: '#f59e0b' }}>
                  <FileCode size={16} />
                  <span>Repo B: {alert?.projectB || 'Project B'}</span>
                </div>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                  {fileB} (Lines {lineStartB}-{lineEndB})
                </span>
              </div>
              <div className="plag-compare-code-editor" ref={rightEditorRef}>
                {loadingB ? (
                  <div className="loader-box" style={{ padding: '40px' }}><div className="spinner" /><p>Loading Project B code...</p></div>
                ) : errorB ? (
                  <div style={{ padding: '20px', color: '#ef4444' }}>{errorB}</div>
                ) : (
                  renderCodeLines(fileBContent, lineStartB, lineEndB, 'line-b')
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

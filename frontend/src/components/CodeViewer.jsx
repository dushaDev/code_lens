import React, { useState } from 'react';
import { Copy, Check, FileCode2, AlertOctagon, Eye, AlertCircleIcon } from 'lucide-react';
import './CodeViewer.css';

// Tokenizer for lightweight syntax highlighting
function highlightCode(code, lang) {
  if (!code) return [];

  const lines = code.split('\n');
  return lines.map(line => {
    let tokens = [];
    let current = '';
    let i = 0;

    const pushToken = (content, type) => {
      if (content) {
        tokens.push({ content, type });
      }
    };

    while (i < line.length) {
      // Single line comments (# or //)
      if ((line[i] === '#' && lang !== 'css') || (line[i] === '/' && line[i + 1] === '/')) {
        pushToken(current, 'plain');
        current = '';
        pushToken(line.slice(i), 'comment');
        i = line.length;
        break;
      }

      // Strings (double, single, backtick quotes)
      if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
        const quote = line[i];
        pushToken(current, 'plain');
        current = quote;
        i++;
        while (i < line.length && line[i] !== quote) {
          if (line[i] === '\\' && i + 1 < line.length) {
            current += line[i] + line[i + 1];
            i += 2;
          } else {
            current += line[i];
            i++;
          }
        }
        if (i < line.length) {
          current += line[i];
          i++;
        }
        pushToken(current, 'string');
        current = '';
        continue;
      }

      // Numbers
      if (/\d/.test(line[i]) && (i === 0 || /[^\w$]/.test(line[i - 1]))) {
        pushToken(current, 'plain');
        current = '';
        let num = '';
        while (i < line.length && /[\d._xX-a-fA-F]/.test(line[i])) {
          num += line[i];
          i++;
        }
        pushToken(num, 'number');
        continue;
      }

      // Words (keywords, identifiers, functions)
      if (/[a-zA-Z_$]/.test(line[i])) {
        pushToken(current, 'plain');
        current = '';
        let word = '';
        while (i < line.length && /[\w$]/.test(line[i])) {
          word += line[i];
          i++;
        }

        const keywords = new Set([
          'const', 'let', 'var', 'function', 'def', 'class', 'import', 'export', 'from',
          'return', 'if', 'else', 'elif', 'for', 'while', 'in', 'async', 'await', 'try',
          'catch', 'finally', 'raise', 'except', 'with', 'as', 'public', 'private',
          'protected', 'static', 'void', 'int', 'string', 'bool', 'boolean', 'struct',
          'interface', 'type', 'enum', 'default', 'switch', 'case', 'break', 'continue',
          'new', 'this', 'self', 'true', 'false', 'null', 'undefined', 'None', 'True', 'False'
        ]);

        if (keywords.has(word)) {
          pushToken(word, 'keyword');
        } else if (i < line.length && line[i] === '(') {
          pushToken(word, 'function');
        } else if (/^[A-Z]/.test(word)) {
          pushToken(word, 'type');
        } else {
          pushToken(word, 'plain');
        }
        continue;
      }

      // Operators & Punctuations
      current += line[i];
      i++;
    }

    pushToken(current, 'plain');
    return tokens;
  });
}

export default function CodeViewer({ code, filePath }) {
  const [copied, setCopied] = useState(false);
  const [forceLoad, setForceLoad] = useState(false);

  const getLanguage = (path) => {
    if (!path) return 'text';
    const ext = path.split('.').pop().toLowerCase();
    const map = {
      py: 'python', js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
      html: 'html', css: 'css', json: 'json', java: 'java', cpp: 'cpp', c: 'c',
      go: 'go', rs: 'rust', md: 'markdown', sh: 'bash', sql: 'sql'
    };
    return map[ext] || ext;
  };

  const lineCount = code ? code.split('\n').length : 0;
  const byteCount = code ? new Blob([code]).size : 0;

  const MAX_LINES = 2000;
  const MAX_BYTES = 200 * 1024; // 200 KB
  const isTooLarge = (lineCount > MAX_LINES || byteCount > MAX_BYTES) && !forceLoad;

  const lang = getLanguage(filePath);
  const highlightedLines = isTooLarge ? [] : highlightCode(code, lang);

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-viewer">
      <div className="code-viewer-header">
        <div className="file-info">
          <FileCode2 size={16} className="lang-icon" />
          <span className="file-path">{filePath || 'Untitled'}</span>
          <span className="lang-badge">{lang.toUpperCase()}</span>
        </div>

        <div className="actions">
          <span className="line-count">{lineCount.toLocaleString()} lines ({formatSize(byteCount)})</span>
          <button className="copy-btn" onClick={handleCopy} title="Copy code">
            {copied ? <Check size={14} className="green-text" /> : <Copy size={14} />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {isTooLarge ? (
        <div className="large-file-container">
          <div className="large-file-card">
            <AlertCircleIcon size={36} className="large-file-icon" />
            <h3>File Too Large to Preview</h3>
            <p>
              This file contains <strong>{lineCount.toLocaleString()} lines</strong> ({formatSize(byteCount)}). 
              Rendering this large file directly in the browser may slow down performance.
            </p>
            <button 
              className="btn btn-secondary force-load-btn"
              onClick={() => setForceLoad(true)}
            >
              <Eye size={15} />
              <span>Load Preview Anyway</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="code-viewer-canvas">
          <div className="line-numbers">
            {highlightedLines.map((_, idx) => (
              <div key={idx} className="line-number">{idx + 1}</div>
            ))}
          </div>

          <div className="code-lines">
            {highlightedLines.map((tokens, lineIdx) => (
              <div key={lineIdx} className="code-line">
                {tokens.length === 0 ? '\u00A0' : tokens.map((token, tokIdx) => (
                  <span key={tokIdx} className={`token token-${token.type}`}>
                    {token.content}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

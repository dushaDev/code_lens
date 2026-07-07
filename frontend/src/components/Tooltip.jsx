import React from 'react';
import { Info } from 'lucide-react';

export default function Tooltip({ title, content, style }) {
  return (
    <div className="card-tooltip-trigger" style={{ cursor: 'pointer', color: 'var(--text-light)', ...style }}>
      <Info size={16} />
      <div className="card-tooltip-content">
        {title && <strong style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>{title}</strong>}
        <p style={{ margin: 0, lineHeight: '1.4', fontWeight: 'normal', color: 'var(--text-muted)' }}>
          {content}
        </p>
      </div>
    </div>
  );
}

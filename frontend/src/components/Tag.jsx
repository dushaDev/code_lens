import React from 'react';

export default function Tag({ text, variant = 'primary', style = {}, className = '' }) {
  // Define color mappings for variant keys to keep consistency across the app
  const variantStyles = {
    primary: {
      backgroundColor: 'var(--primary-alpha)',
      color: 'var(--primary)',
      border: '1px solid hsl(var(--primary-hue), var(--primary-sat), 80%)'
    },
    success: {
      backgroundColor: 'var(--color-success-bg)',
      color: 'var(--color-success)',
      border: '1px solid rgba(16, 185, 129, 0.25)'
    },
    danger: {
      backgroundColor: 'var(--color-danger-bg)',
      color: 'var(--color-danger)',
      border: '1px solid rgba(239, 68, 68, 0.25)'
    },
    warning: {
      backgroundColor: 'var(--color-warning-bg)',
      color: 'var(--color-warning)',
      border: '1px solid rgba(245, 158, 11, 0.25)'
    },
    info: {
      backgroundColor: 'var(--color-info-bg)',
      color: 'var(--color-info)',
      border: '1px solid rgba(59, 130, 246, 0.25)'
    },
    muted: {
      backgroundColor: 'var(--bg-app)',
      color: 'var(--text-muted)',
      border: '1px solid var(--border-color)'
    }
  };

  const currentStyle = variantStyles[variant] || variantStyles.primary;

  return (
    <span 
      className={`app-tag tag-${variant} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        lineHeight: '1.2',
        ...currentStyle,
        ...style
      }}
    >
      {text}
    </span>
  );
}

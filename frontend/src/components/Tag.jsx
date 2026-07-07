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
      backgroundColor: '#f0fdf4',
      color: '#16a34a',
      border: '1px solid #bbf7d0'
    },
    danger: {
      backgroundColor: '#fef2f2',
      color: '#dc2626',
      border: '1px solid #fecaca'
    },
    warning: {
      backgroundColor: '#fffbeb',
      color: '#d97706',
      border: '1px solid #fef3c7'
    },
    info: {
      backgroundColor: '#f5f3ff',
      color: '#7c3aed',
      border: '1px solid #ddd6fe'
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

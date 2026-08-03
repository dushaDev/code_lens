import React from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import './NotificationContainer.css'; // We'll add this next

const NotificationItem = ({ notification, onRemove }) => {
  const { id, type, title, description, progress, progressValue } = notification;

  const getIcon = () => {
    if (progress) return <img src="/favicon.svg" alt="Code Lens" className="notification-icon" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'contain' }} />;
    switch (type) {
      case 'success': return <CheckCircle className="notification-icon success" />;
      case 'error': return <AlertCircle className="notification-icon error" />;
      case 'warning': return <AlertTriangle className="notification-icon warning" />;
      case 'info':
      default:
        return <Info className="notification-icon info" />;
    }
  };

  return (
    <div className={`notification-item ${type} ${progress ? 'progressing' : ''}`}>
      <div className="notification-icon-wrapper">
        {getIcon()}
      </div>
      <div className="notification-content">
        {title && <h4 className="notification-title">{title}</h4>}
        {description && (
          <p className="notification-description">
            {description.length > 100 ? `${description.substring(0, 100)}...` : description}
          </p>
        )}
      </div>
      {!progress && (
        <button className="notification-close" onClick={() => onRemove(id)}>
          <X size={16} />
        </button>
      )}
      {progress && (
        <div className={`notification-progress-bar ${progressValue !== undefined ? 'determinate' : 'indeterminate'}`}>
          <div 
            className="notification-progress-fill" 
            style={progressValue !== undefined ? { width: `${progressValue}%` } : {}}
          ></div>
        </div>
      )}
    </div>
  );
};

const NotificationContainer = ({ notifications, onRemove }) => {
  return (
    <div className="notification-container">
      {notifications.map((notif) => (
        <NotificationItem 
          key={notif.id} 
          notification={notif} 
          onRemove={onRemove} 
        />
      ))}
    </div>
  );
};

export default NotificationContainer;

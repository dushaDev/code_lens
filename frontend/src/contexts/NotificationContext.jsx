import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import NotificationContainer from '../components/NotificationContainer';

const NotificationContext = createContext(null);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const nextId = useRef(0);

  const addNotification = useCallback((notification) => {
    const id = nextId.current++;
    const newNotification = {
      id,
      type: notification.type || 'info', // info, success, warning, error
      title: notification.title || '',
      description: notification.description || '',
      progress: notification.progress || false,
      progressValue: notification.progressValue, // optional number 0-100
      duration: notification.duration || 5000,
      autoClose: notification.autoClose !== undefined ? notification.autoClose : true
    };

    setNotifications((prev) => {
      // Limit to 5 max active notifications
      const active = [...prev, newNotification];
      if (active.length > 5) active.shift();
      return active;
    });

    if (newNotification.autoClose && !newNotification.progress) {
      // Auto close after duration if not a progress type
      setTimeout(() => {
        removeNotification(id);
      }, newNotification.duration);
    }

    return id;
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const updateNotification = useCallback((id, updates) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...updates } : n))
    );
  }, []);

  return (
    <NotificationContext.Provider value={{ addNotification, removeNotification, updateNotification }}>
      {children}
      <NotificationContainer 
        notifications={notifications} 
        onRemove={removeNotification} 
      />
    </NotificationContext.Provider>
  );
};

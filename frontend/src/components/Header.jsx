import React, { useState, useEffect, useRef } from 'react';
import { Search, Bell, HelpCircle } from 'lucide-react';
import Tag from './Tag';
import ProfileDropdown from './ProfileDropdown';
import './Header.css';

export default function Header({ 
  user, 
  searchTerm, 
  setSearchTerm, 
  currentCourse,
  onSelectProject,
  onNavigateTab,
  onSelectCourse,
  onLogout,
  onUserUpdate 
}) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const searchContainerRef = useRef(null);

  // Close search popup when clicking outside the container
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowPopup(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const handleSearchChange = async (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    
    if (value.trim().length < 2) {
      setResults([]);
      setShowPopup(false);
      return;
    }
    
    setLoading(true);
    setShowPopup(true);
    try {
      const token = localStorage.getItem('token');
      const courseParam = currentCourse ? `&course_id=${currentCourse.id}` : '';
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(value)}${courseParam}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      setResults(data.results || []);
    } catch (err) {
      console.error(err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleResultClick = (item) => {
    setShowPopup(false);
    setSearchTerm('');
    if (item.type === 'project' && item.project_id) {
      onSelectProject(item.project_id);
    } else if (item.type === 'student') {
      onNavigateTab('students', item.title || item.subtitle || '');
    } else if (item.type === 'commit' && item.project_id) {
      onSelectProject(item.project_id);
    } else if (item.type === 'course' && onSelectCourse) {
      const courseIdInt = parseInt(item.id.replace('course-', ''), 10);
      onSelectCourse({ id: courseIdInt, name: item.title });
    }
  };

  return (
    <header className="app-header">
      <div className="header-search" ref={searchContainerRef}>
        <Search size={18} className="search-icon" />
        <input 
          type="text" 
          placeholder="Search projects, students..." 
          value={searchTerm}
          onChange={handleSearchChange}
          onFocus={() => searchTerm.trim().length >= 2 && setShowPopup(true)}
        />

        {showPopup && (
          <div className="search-popup">
            {loading ? (
              <div className="search-loading">Searching...</div>
            ) : results.length === 0 ? (
              <div className="search-no-results">No matching projects or students.</div>
            ) : (
              <div className="search-results-list">
                {results.map((item, index) => (
                  <div 
                    key={index} 
                    className="search-item" 
                    onClick={() => handleResultClick(item)}
                  >
                    <span className={`search-badge-tag tag-${item.type}`}>{item.type}</span>
                    <div className="search-item-info">
                      <p className="search-item-title">{item.title}</p>
                      <p className="search-item-subtitle">{item.subtitle || ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="header-actions">
        <button className="action-btn" title="Help & Guides">
          <HelpCircle size={20} />
        </button>
        <button className="action-btn" title="Notifications">
          <Bell size={20} />
          <span className="notification-badge"></span>
        </button>

        <ProfileDropdown 
          user={user} 
          onLogout={onLogout} 
          onUserUpdate={onUserUpdate} 
        />
      </div>
    </header>
  );
}

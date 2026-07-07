import React, { useState, useEffect, useRef } from 'react';
import { Search, Bell, HelpCircle, User, LogOut, ChevronDown } from 'lucide-react';
import './Header.css';

export default function Header({ 
  user, 
  searchTerm, 
  setSearchTerm, 
  currentCourse,
  onSelectProject,
  onNavigateTab,
  onSelectCourse,
  onLogout 
}) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
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
      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = (item) => {
    setShowPopup(false);
    setSearchTerm('');
    if (item.type === 'project' || item.type === 'commit') {
      if (item.project_id) {
        onSelectProject(item.project_id);
      }
    } else if (item.type === 'student') {
      onNavigateTab('students');
    } else if (item.type === 'course') {
      // Re-trigger course selection
      onSelectCourse(null);
    }
  };

  return (
    <header className="app-header">
      <div className="header-search" ref={searchContainerRef}>
        <Search size={18} className="search-icon" />
        <input 
          type="text" 
          placeholder="Search projects, students, or commits..."
          value={searchTerm}
          onChange={handleSearchChange}
          onFocus={() => { if (searchTerm.trim().length >= 2) setShowPopup(true); }}
        />

        {showPopup && (
          <div className="search-popup">
            {loading && <div className="search-loading">Searching...</div>}
            {!loading && results.length === 0 && (
              <div className="search-no-results">No results found for "{searchTerm}"</div>
            )}
            {!loading && results.length > 0 && (
              <div className="search-results-list">
                {results.map((item) => (
                  <div 
                    key={item.id} 
                    className="search-item" 
                    onClick={() => handleItemClick(item)}
                  >
                    <span className={`search-badge-tag tag-${item.type}`}>{item.type}</span>
                    <div className="search-item-info">
                      <p className="search-item-title">{item.title}</p>
                      <p className="search-item-subtitle">{item.subtitle}</p>
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

        <div className="profile-container">
          <button 
            className="profile-trigger" 
            onClick={() => setShowProfileMenu(!showProfileMenu)}
          >
            <div className="avatar">
              {user?.username ? user.username.slice(0, 2).toUpperCase() : <User size={16} />}
            </div>
            <div className="profile-info">
              <span className="profile-name">{user?.username || 'Professor'}</span>
              <span className="profile-role">Instructor</span>
            </div>
            <ChevronDown size={14} className="dropdown-arrow" />
          </button>

          {showProfileMenu && (
            <div className="profile-menu">
              <div className="menu-header">
                <p className="menu-username">{user?.username}</p>
                <p className="menu-email">{user?.email || 'instructor@codelens.edu'}</p>
              </div>
              <ul className="menu-list">
                <li>
                  <button className="menu-item" onClick={onLogout}>
                    <LogOut size={16} />
                    <span>Log Out</span>
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

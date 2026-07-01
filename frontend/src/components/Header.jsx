import React, { useState } from 'react';
import { Search, Bell, HelpCircle, User, LogOut, ChevronDown } from 'lucide-react';
import './Header.css';

export default function Header({ 
  user, 
  searchTerm, 
  setSearchTerm, 
  onLogout 
}) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  return (
    <header className="app-header">
      <div className="header-search">
        <Search size={18} className="search-icon" />
        <input 
          type="text" 
          placeholder="Search projects, students, or commits..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
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

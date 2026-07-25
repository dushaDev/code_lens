import React, { useState, useEffect, useRef } from 'react';
import { User, LogOut, ChevronDown, Plus, Sun, Moon } from 'lucide-react';
import './Header.css'; // Reuses the shared header styles

export default function ProfileDropdown({ user, onLogout, onUserUpdate }) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showGithubInput, setShowGithubInput] = useState(false);
  const [githubUsername, setGithubUsername] = useState(user?.github_username || '');
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    setGithubUsername(user?.github_username || '');
    setImgError(false);
  }, [user]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowProfileMenu(false);
        setShowGithubInput(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const handleSaveGitHubUsername = async (e) => {
    e.preventDefault();
    setSaving(true);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/v1/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          github_username: githubUsername.trim()
        })
      });
      if (!response.ok) throw new Error('Failed to update GitHub profile.');
      const updatedUser = await response.json();
      if (onUserUpdate) {
        onUserUpdate(updatedUser);
      }
      setShowGithubInput(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoutClick = () => {
    if (window.confirm('Are you sure you want to log out?')) {
      onLogout();
    }
  };

  const handleToggleTheme = async () => {
    if (!user) return;
    setSaving(true);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/v1/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          is_dark_mode: !user.is_dark_mode
        })
      });
      if (!response.ok) throw new Error('Failed to update theme preference.');
      const updatedUser = await response.json();
      if (onUserUpdate) {
        onUserUpdate(updatedUser);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-container" ref={dropdownRef}>
      <button 
        className="profile-trigger" 
        onClick={() => setShowProfileMenu(!showProfileMenu)}
      >
        <div className="avatar">
          {user?.github_username && !imgError ? (
            <img 
              src={`https://github.com/${user.github_username}.png`} 
              alt={user.username} 
              onError={() => setImgError(true)}
            />
          ) : user?.username ? (
            user.username.slice(0, 2).toUpperCase()
          ) : (
            <User size={16} />
          )}
        </div>
        <div className="profile-info">
          <span className="profile-name">{user?.username || 'Professor'}</span>
        </div>
        <ChevronDown size={14} className="dropdown-arrow" />
      </button>

      {showProfileMenu && (
        <div className="profile-menu">
          <div className="menu-header">
            <div 
              className="menu-avatar-container" 
              onClick={() => setShowGithubInput(!showGithubInput)}
              title="Click to set profile picture"
            >
              <div className="avatar menu-avatar">
                {user?.github_username && !imgError ? (
                  <img 
                    src={`https://github.com/${user.github_username}.png`} 
                    alt={user.username} 
                    onError={() => setImgError(true)}
                  />
                ) : user?.username ? (
                  user.username.slice(0, 2).toUpperCase()
                ) : (
                  <User size={20} />
                )}
              </div>
              <div className="avatar-edit-overlay">
                <Plus size={12} />
              </div>
            </div>
            <p className="menu-username">{user?.username}</p>
            <p className="menu-email">{user?.email || 'instructor@codelens.edu'}</p>
          </div>

          {/* GitHub Input inline textbox */}
          {showGithubInput && (
            <form onSubmit={handleSaveGitHubUsername} className="menu-github-form-inline">
              <div className="menu-github-input-group">
                <input
                  type="text"
                  className="menu-github-input"
                  placeholder="GitHub username"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="menu-github-btn" disabled={saving}>
                  {saving ? '...' : 'Save'}
                </button>
              </div>
            </form>
          )}

          <ul className="menu-list">
            <li>
              <button className="menu-item theme-toggle-item" onClick={handleToggleTheme} disabled={saving}>
                {user?.is_dark_mode ? <Sun size={16} className="theme-toggle-icon-sun" /> : <Moon size={16} className="theme-toggle-icon-moon" />}
                <span>{user?.is_dark_mode ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
            </li>
            <li>
              <button className="menu-item logout-item" onClick={handleLogoutClick}>
                <LogOut size={16} />
                <span>Log Out</span>
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { 
  LayoutDashboard, 
  FolderGit2, 
  Users, 
  AlertTriangle, 
  Settings, 
  LogOut, 
  GraduationCap, 
  PlusCircle 
} from 'lucide-react';
import './Sidebar.css';

export default function Sidebar({ 
  currentCourse, 
  currentTab, 
  setCurrentTab, 
  onCloseCourse, 
  onLogout,
  onCreateProjectClick,
  unreadPlagiarismCount = 0,
  onClearUnreadPlagiarism
}) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', icon: FolderGit2 },
    { id: 'students', label: 'Students', icon: Users },
    { id: 'plagiarism', label: 'Plagiarism Alerts', icon: AlertTriangle },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="app-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <img src="/code_lens_logo_light.svg" className="theme-logo logo-icon-img" alt="Code Lens Logo" style={{ width: '155px', height: '60px', objectFit: 'contain' }} />
        </div>
      </div>

      {currentCourse && (
        <div className="sidebar-course-card">
          <div className="course-info">
            <GraduationCap size={16} className="course-icon" />
            <span className="course-name" title={currentCourse.name}>
              {currentCourse.name}
            </span>
          </div>
          <button className="sidebar-create-btn" onClick={onCreateProjectClick}>
            <PlusCircle size={15} />
            <span>Create New Project</span>
          </button>
        </div>
      )}

      <nav className="sidebar-nav">
        <ul>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            const showBadge = item.id === 'plagiarism' && unreadPlagiarismCount > 0;

            return (
              <li key={item.id}>
                <button 
                  className={`nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setCurrentTab(item.id);
                    if (item.id === 'plagiarism' && onClearUnreadPlagiarism) {
                      onClearUnreadPlagiarism();
                    }
                  }}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {showBadge && (
                    <span className="sidebar-unread-badge" title={`${unreadPlagiarismCount} new plagiarism alert(s)`}>
                      {unreadPlagiarismCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        {currentCourse ? (
          <button className="nav-link close-course-btn" onClick={onCloseCourse}>
            <GraduationCap size={18} />
            <span>Close Course</span>
          </button>
        ) : (
          <button className="nav-link logout-btn" onClick={onLogout}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        )}
      </div>
    </aside>
  );
}

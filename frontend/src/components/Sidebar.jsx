import React from 'react';
import { 
  LayoutDashboard, 
  FolderGit2, 
  Users, 
  ShieldAlert, 
  Settings, 
  LogOut, 
  BookOpen, 
  PlusCircle 
} from 'lucide-react';
import './Sidebar.css';

export default function Sidebar({ 
  currentCourse, 
  currentTab, 
  setCurrentTab, 
  onCloseCourse, 
  onLogout,
  onCreateProjectClick
}) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', icon: FolderGit2 },
    { id: 'students', label: 'Students', icon: Users },
    { id: 'plagiarism', label: 'Plagiarism Alerts', icon: ShieldAlert },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="app-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="logo-icon">C</span>
          <div className="logo-text">
            <h2>Code Lens</h2>
            <p>Academic Git Analyzer</p>
          </div>
        </div>
      </div>

      {currentCourse && (
        <div className="sidebar-course-card">
          <div className="course-info">
            <BookOpen size={16} className="course-icon" />
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
            return (
              <li key={item.id}>
                <button 
                  className={`nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setCurrentTab(item.id)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        {currentCourse ? (
          <button className="nav-link close-course-btn" onClick={onCloseCourse}>
            <BookOpen size={18} />
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

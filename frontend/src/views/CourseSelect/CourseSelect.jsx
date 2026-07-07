import React, { useState, useEffect } from 'react';
import { LogOut, Plus, GraduationCap, Trash2, Database, AlertOctagon, X } from 'lucide-react';
import './CourseSelect.css';

export default function CourseSelect({ user, onSelectCourse, onLogout }) {
  const [courses, setCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseDesc, setNewCourseDesc] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Password reset modal states
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipePassword, setWipePassword] = useState('');
  const [wipeLoading, setWipeLoading] = useState(false);
  const [wipeError, setWipeError] = useState('');

  const fetchCourses = async () => {
    setLoading(true);
    setError('');
    const token = localStorage.getItem('token');

    try {
      const response = await fetch('/api/v1/courses', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch courses');
      const data = await response.json();
      setCourses(data.courses);
    } catch (err) {
      setError('Could not retrieve courses from backend database.');
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  const handleCreateCourse = async (e) => {
    e.preventDefault();
    if (!newCourseName.trim()) return;

    const token = localStorage.getItem('token');

    try {
      const response = await fetch('/api/v1/courses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newCourseName,
          description: newCourseDesc
        })
      });

      if (!response.ok) throw new Error('Failed to create course');
      fetchCourses();
      setNewCourseName('');
      setNewCourseDesc('');
      setShowAddForm(false);
    } catch (err) {
      setError('Failed to create course: ' + err.message);
    }
  };

  const handleDeleteCourse = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this course? All belonging projects will be deleted.')) return;

    const token = localStorage.getItem('token');

    try {
      const response = await fetch(`/api/v1/courses/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to delete course');
      fetchCourses();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const handleWipeDatabase = async (e) => {
    e.preventDefault();
    if (!wipePassword) return;

    setWipeLoading(true);
    setWipeError('');

    const token = localStorage.getItem('token');

    try {
      const response = await fetch('/api/v1/system/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          password: wipePassword
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Wipe failed. Please check your password.');
      }

      alert('Database has been fully reset. All courses and history are cleared.');
      setCourses([]);
      setWipePassword('');
      setShowWipeModal(false);
      fetchCourses();
    } catch (err) {
      setWipeError(err.message || 'Wipe failed.');
    } finally {
      setWipeLoading(false);
    }
  };

  const getGreeting = () => {
    const hrs = new Date().getHours();
    if (hrs < 12) return 'Good Morning';
    if (hrs < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className="course-select-page">
      <div className="course-select-container">
        <header className="course-select-header">
          <div className="user-greeting">
            <h1>{getGreeting()}, {user?.username || 'Instructor'}</h1>
            <p className="subtitle">Welcome to Code Lens. Please select a course to begin.</p>
          </div>
          <div className="header-button-group">
            <button 
              className="btn btn-outline wipe-db-btn" 
              onClick={() => setShowWipeModal(true)}
            >
              <Database size={16} />
              <span>Full System Reset</span>
            </button>
            <button className="btn btn-secondary logout-top-btn" onClick={onLogout}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {error && <div className="course-select-alert">{error}</div>}

        <div className="courses-grid-section">
          <div className="section-title-row">
            <h2>Select a Course</h2>
            <button 
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              <Plus size={16} />
              <span>Add Course</span>
            </button>
          </div>

          {showAddForm && (
            <form onSubmit={handleCreateCourse} className="add-course-form card">
              <h3>Create a New Course</h3>
              <div className="form-group">
                <label className="form-label">Course Name</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. Software Engineering - CSE402"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description (Optional)</label>
                <textarea 
                  className="input-field text-area" 
                  placeholder="e.g. Group evaluations for Autumn 2026 term"
                  value={newCourseDesc}
                  onChange={(e) => setNewCourseDesc(e.target.value)}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Course
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="loader-box">
              <div className="spinner"></div>
              <p>Loading your courses...</p>
            </div>
          ) : (
            <div className="courses-grid">
              {courses.map((course) => (
                <div 
                  key={course.id} 
                  className="course-card card"
                  onClick={() => onSelectCourse(course)}
                >
                  <div className="course-card-header">
                    <div className="course-card-icon">
                      <GraduationCap size={20} />
                    </div>
                    <button 
                      className="delete-course-btn" 
                      onClick={(e) => handleDeleteCourse(course.id, e)}
                      title="Delete Course"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <h3>{course.name}</h3>
                  <p>{course.description || 'No description provided.'}</p>
                  <div className="course-card-footer">
                    <span className="open-link">Open Course &rarr;</span>
                  </div>
                </div>
              ))}

              {courses.length === 0 && (
                <div className="empty-courses card">
                  <GraduationCap size={48} className="empty-icon" />
                  <h3>No Courses Yet</h3>
                  <p>Create your first course to begin importing git repositories.</p>
                  <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
                    <Plus size={16} />
                    <span>Create Course</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FULL SYSTEM RESET PASSWORD MODAL */}
      {showWipeModal && (
        <div className="modal-overlay">
          <div className="modal-card card danger-border">
            <div className="modal-header">
              <div className="modal-title-box">
                <AlertOctagon size={20} className="red-text" />
                <h2>Full System Reset</h2>
              </div>
              <button className="close-btn" onClick={() => { setShowWipeModal(false); setWipePassword(''); }} disabled={wipeLoading}>
                <X size={18} />
              </button>
            </div>

            {wipeError && <div className="modal-alert alert-error">{wipeError}</div>}

            <form onSubmit={handleWipeDatabase} className="modal-form">
              <p className="danger-notice">
                WARNING: This action is permanent. It will delete all courses, projects, git commits, 
                and author metrics. The users and authentication tables will NOT be deleted.
              </p>

              <div className="form-group">
                <label className="form-label">Verify Instructor Password</label>
                <input 
                  type="password" 
                  className="input-field" 
                  placeholder="Enter your login password"
                  value={wipePassword}
                  onChange={(e) => setWipePassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-actions">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => { setShowWipeModal(false); setWipePassword(''); }}
                  disabled={wipeLoading}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger" disabled={wipeLoading}>
                  {wipeLoading ? 'Wiping...' : 'Confirm System Wipe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

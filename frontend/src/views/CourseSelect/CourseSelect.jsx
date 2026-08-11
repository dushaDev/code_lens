import React, { useState, useEffect } from 'react';
import { Plus, GraduationCap, X, CalendarClock, Calendar } from 'lucide-react';
import ProfileDropdown from '../../components/ProfileDropdown';
import Tooltip from '../../components/Tooltip';
import { buildDeadline, formatDeadline } from '../../utils/courseMeta';
import './CourseSelect.css';
import '../../components/Header.css';

const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function CourseSelect({ user, onSelectCourse, onLogout, onUserUpdate }) {
  const [courses, setCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseDesc, setNewCourseDesc] = useState('');
  const [newCourseTech, setNewCourseTech] = useState('');
  const [newDeadlineDate, setNewDeadlineDate] = useState(() => todayISO());
  const [newDeadlineTime, setNewDeadlineTime] = useState('00:00');
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCourses = async () => {
    setLoading(true);
    setError('');
    const token = localStorage.getItem('token');

    try {
      // TODO: migrate to apiFetch
      const response = await fetch('/api/v1/courses', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch courses');
      const data = await response.json();
      setCourses(data.courses);
    } catch (err) {
      setError('Could not retrieve courses from database.');
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
      // TODO: migrate to apiFetch
      const response = await fetch('/api/v1/courses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newCourseName,
          description: newCourseDesc,
          tech_requirements: newCourseTech.trim() || null,
          deadline: buildDeadline(newDeadlineDate, newDeadlineTime || '00:00')
        })
      });

      if (!response.ok) throw new Error('Failed to create course');
      fetchCourses();
      setNewCourseName('');
      setNewCourseDesc('');
      setNewCourseTech('');
      setNewDeadlineDate(todayISO());
      setNewDeadlineTime('00:00');
      setShowAddForm(false);
    } catch (err) {
      setError('Failed to create course: ' + err.message);
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
          <div className="header-actions">
            <ProfileDropdown 
              user={user} 
              onLogout={onLogout} 
              onUserUpdate={onUserUpdate} 
            />
          </div>
        </header>

        {error && <div className="course-select-alert">{error}</div>}

        <div className="courses-grid-section">
          <div className="section-title-row">
            <h2>Select a Course</h2>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddForm(true)}
            >
              <Plus size={16} />
              <span>Add Course</span>
            </button>
          </div>

          {showAddForm && (
            <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div className="modal-card card" style={{ maxWidth: '540px', width: '90%', padding: '24px', position: 'relative' }}>
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <div className="modal-title-box" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <GraduationCap size={22} className="blue-text" />
                    <h2 style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-main)', margin: 0 }}>Create a New Course</h2>
                  </div>
                  <button 
                    className="close-btn" 
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleCreateCourse} className="modal-form" style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', marginBottom: '6px', color: 'var(--text-main)' }}>Course Name</label>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="Advanced Software Engineering & Systems - CSE402"
                      value={newCourseName}
                      onChange={(e) => setNewCourseName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', marginBottom: '6px', color: 'var(--text-main)' }}>Description (Optional)</label>
                    <textarea
                      className="input-field text-area"
                      placeholder="Capstone team evaluations focusing on RESTful microservices, git contribution metrics, code quality, and architectural design."
                      value={newCourseDesc}
                      onChange={(e) => setNewCourseDesc(e.target.value)}
                      style={{ minHeight: '64px', resize: 'vertical' }}
                    />
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-main)', margin: 0 }}>Languages &amp; Frameworks (Optional)</label>
                      <Tooltip content="Expected tech stack for this course. Used as context in the final report." />
                    </div>
                    <textarea
                      className="input-field text-area"
                      placeholder="Python 3.12 (FastAPI), React 18 (Vite), PostgreSQL 16, Docker, TailwindCSS"
                      value={newCourseTech}
                      onChange={(e) => setNewCourseTech(e.target.value)}
                      style={{ minHeight: '64px', resize: 'vertical' }}
                    />
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-main)', margin: 0 }}>Submission Deadline</label>
                      <Tooltip content="Commits pushed after this deadline will be flagged as late." />
                    </div>
                    <div className="settings-deadline-inputs" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="date"
                        className="input-field"
                        value={newDeadlineDate}
                        onChange={(e) => setNewDeadlineDate(e.target.value)}
                        style={{ flex: 2 }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-today"
                        onClick={() => setNewDeadlineDate(todayISO())}
                        title="Set deadline date to Today"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 12px', height: '38px', fontSize: '0.82rem', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        <Calendar size={14} />
                        <span>Today</span>
                      </button>
                      <input
                        type="time"
                        className="input-field"
                        aria-label="Deadline time"
                        value={newDeadlineTime}
                        onChange={(e) => setNewDeadlineTime(e.target.value || '00:00')}
                        disabled={!newDeadlineDate}
                        style={{ flex: 1.2 }}
                      />
                    </div>
                  </div>

                  <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary">
                      Create Course
                    </button>
                  </div>
                </form>
              </div>
            </div>
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
                  </div>
                  <h3 title={course.name || course.title || course.course_name || 'Unnamed Course'}>
                    {course.name || course.title || course.course_name || 'Unnamed Course'}
                  </h3>
                  <p>{course.description || 'No description provided.'}</p>
                  {course.deadline && (
                    <div className="course-card-deadline">
                      <CalendarClock size={14} />
                      <span>Due {formatDeadline(course.deadline)}</span>
                    </div>
                  )}
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

      
    </div>
  );
}

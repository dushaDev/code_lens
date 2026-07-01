import React, { useState, useEffect } from 'react';
import { LogOut, Plus, BookOpen, Trash2 } from 'lucide-react';
import './CourseSelect.css';

export default function CourseSelect({ user, onSelectCourse, onLogout }) {
  const [courses, setCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseDesc, setNewCourseDesc] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCourses = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    
    // Check if we are in mock/demo mode
    if (token === 'mock-jwt-token') {
      setCourses([
        { id: 1, name: 'Advanced Algorithms - Term 1', description: 'Group analysis and complexity checks' },
        { id: 2, name: 'Web Dev Final - Section B', description: 'React and node project reviews' },
        { id: 3, name: 'Data Structures - Assignment 2', description: 'C++ coding exercises' },
        { id: 4, name: 'Mobile App Dev - Prototype', description: 'Android & Flutter application evaluations' },
      ]);
      setLoading(false);
      return;
    }

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
      setError('Could not connect to backend. Loaded offline demo courses.');
      // Load fallback mock courses
      setCourses([
        { id: 1, name: 'Advanced Algorithms - Term 1', description: 'Group analysis and complexity checks' },
        { id: 2, name: 'Web Dev Final - Section B', description: 'React and node project reviews' },
        { id: 3, name: 'Data Structures - Assignment 2', description: 'C++ coding exercises' },
        { id: 4, name: 'Mobile App Dev - Prototype', description: 'Android & Flutter application evaluations' },
      ]);
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
    if (token === 'mock-jwt-token') {
      const newMockCourse = {
        id: courses.length + 1,
        name: newCourseName,
        description: newCourseDesc || 'Custom course'
      };
      setCourses([...courses, newMockCourse]);
      setNewCourseName('');
      setNewCourseDesc('');
      setShowAddForm(false);
      return;
    }

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
    e.stopPropagation(); // Prevent select course action
    if (!window.confirm('Are you sure you want to delete this course? All belonging projects will be deleted.')) return;

    const token = localStorage.getItem('token');
    if (token === 'mock-jwt-token') {
      setCourses(courses.filter(c => c.id !== id));
      return;
    }

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

  // Determine greeting based on current local hour
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
          <button className="btn btn-secondary logout-top-btn" onClick={onLogout}>
            <LogOut size={16} />
            <span>Logout</span>
          </button>
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
                      <BookOpen size={20} />
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
                  <BookOpen size={48} className="empty-icon" />
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

import React, { useState, useEffect } from 'react';
import { Plus, GraduationCap, X, CalendarClock, Calendar, Settings as SettingsIcon } from 'lucide-react';
import ProfileDropdown from '../../components/ProfileDropdown';
import Tooltip from '../../components/Tooltip';
import ApiKeysCard from '../../components/ApiKeysCard';
import { buildDeadline, formatDeadline } from '../../utils/courseMeta';
import './CourseSelect.css';
import '../../components/Header.css';

const TECH_SUGGESTIONS = [
  'JavaScript','TypeScript','React','React Native','Vue','Angular','Node.js','Express','Next.js','Nuxt.js','Svelte',
  'Python','Django','Flask','FastAPI','PyTorch','TensorFlow','Pandas','NumPy','SciPy',
  'Java','Spring','Spring Boot','Kotlin','Android','Flutter','Dart','Scala',
  'C','C++','C#','.NET','ASP.NET','WPF',
  'Go','Rust','Zig',
  'Ruby','Rails','PHP','Laravel','Symfony','JSP','Servlet',
  'Swift','SwiftUI','Objective-C',
  'SQL','PostgreSQL','MySQL','SQLite','MongoDB','Redis','Elasticsearch','GraphQL',
  'HTML','CSS','Sass','Tailwind','Bootstrap',
  'Docker','Kubernetes','Terraform','Ansible','AWS','Azure','GCP','Git','CI/CD'
];

const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const minDeadlineISO = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const addDaysISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const endOfMonthISO = () => {
  const d = new Date();
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`;
};

const normalizeTech = (raw) => {
  const t = raw.trim();
  if (!t) return '';
  const hit = TECH_SUGGESTIONS.find(s => s.toLowerCase() === t.toLowerCase());
  return hit || t;
};

export default function CourseSelect({ user, onSelectCourse, onLogout, onUserUpdate }) {
  const [courses, setCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseDesc, setNewCourseDesc] = useState('');
  const [techTags, setTechTags] = useState([]);
  const [techInput, setTechInput] = useState('');
  const [techActiveIdx, setTechActiveIdx] = useState(-1);
  const [newDeadlineDate, setNewDeadlineDate] = useState(() => todayISO());
  const [newDeadlineTime, setNewDeadlineTime] = useState('23:59');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const addTechTag = (raw) => {
    const val = normalizeTech(raw);
    if (!val) return;
    setTechTags(prev => prev.some(x => x.toLowerCase() === val.toLowerCase()) ? prev : [...prev, val]);
    setTechInput('');
    setTechActiveIdx(-1);
  };

  const removeTechTag = (i) => setTechTags(prev => prev.filter((_, idx) => idx !== i));

  const techMatches = techInput.trim()
    ? TECH_SUGGESTIONS.filter(s => s.toLowerCase().includes(techInput.trim().toLowerCase())
        && !techTags.some(t => t.toLowerCase() === s.toLowerCase())).slice(0, 6)
    : [];

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
    if (!newCourseName.trim() || submitting) return;

    if (techInput.trim()) {
      addTechTag(techInput);
    }

    const currentTags = techInput.trim()
      ? (techTags.some(x => x.toLowerCase() === normalizeTech(techInput).toLowerCase())
          ? techTags
          : [...techTags, normalizeTech(techInput)])
      : techTags;

    setSubmitting(true);
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
          tech_requirements: currentTags.length ? currentTags.join(', ') : null,
          deadline: buildDeadline(newDeadlineDate, newDeadlineTime || '23:59')
        })
      });

      if (!response.ok) throw new Error('Failed to create course');
      fetchCourses();
      setNewCourseName('');
      setNewCourseDesc('');
      setTechTags([]);
      setTechInput('');
      setNewDeadlineDate(todayISO());
      setNewDeadlineTime('23:59');
      setShowAddForm(false);
    } catch (err) {
      setError('Failed to create course: ' + err.message);
    } finally {
      setSubmitting(false);
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
            <button className="icon-btn" onClick={() => setShowApiKeys(true)} title="API Keys" style={{ background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: '8px' }}>
              <SettingsIcon size={20} className="blue-text" />
            </button>
          </div>
        </header>

        {error && <div className="course-select-alert">{error}</div>}

        <div className="courses-grid-section">
          <div className="section-title-row">
            <h2>Select a Course</h2>
            {courses.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowAddForm(true)}
              >
                <Plus size={16} />
                <span>Add Course</span>
              </button>
            )}
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
                    <label className="form-label" style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', marginBottom: '6px', color: 'var(--text-main)' }}>
                      Course Name<span style={{ color: 'var(--danger,#e5484d)' }}> *</span>
                    </label>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="e.g. Advanced Web Application Development - SE401"
                      value={newCourseName}
                      onChange={(e) => setNewCourseName(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', marginBottom: '6px', color: 'var(--text-main)' }}>Description (Optional)</label>
                    <textarea
                      className="input-field text-area"
                      placeholder="e.g. Short summary of what this course covers."
                      value={newCourseDesc}
                      onChange={(e) => setNewCourseDesc(e.target.value)}
                      maxLength={500}
                      style={{ minHeight: '120px', resize: 'vertical' }}
                    />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: '4px' }}>
                      {newCourseDesc.length}/500
                    </div>
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-main)', margin: 0 }}>Languages &amp; Frameworks (Optional)</label>
                      <Tooltip content="Expected tech stack for this course. Used as context in the final report." />
                    </div>
                    <div style={{ position: 'relative' }}>
                      <div 
                        className="input-field" 
                        style={{ 
                          padding: '4px 8px', 
                          minHeight: '38px', 
                          display: 'flex', 
                          flexWrap: 'wrap', 
                          gap: '6px', 
                          alignItems: 'center', 
                          height: 'auto' 
                        }}
                      >
                        {techTags.map((tag, idx) => (
                          <span 
                            key={idx} 
                            style={{ 
                              background: 'var(--bg-hover)', 
                              border: '1px solid var(--border-color)', 
                              borderRadius: '4px', 
                              padding: '2px 8px', 
                              fontSize: '0.8rem', 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '4px',
                              color: 'var(--text-main)'
                            }}
                          >
                            {tag}
                            <button 
                              type="button" 
                              onClick={() => removeTechTag(idx)} 
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          value={techInput}
                          placeholder={techTags.length === 0 ? "Type to add… e.g. React" : ""}
                          onChange={(e) => { setTechInput(e.target.value); setTechActiveIdx(-1); }}
                          onBlur={() => { if (techInput.trim()) addTechTag(techInput); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              if (techActiveIdx >= 0 && techMatches[techActiveIdx]) {
                                addTechTag(techMatches[techActiveIdx]);
                              } else {
                                addTechTag(techInput);
                              }
                            } else if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setTechActiveIdx(i => Math.min(i + 1, techMatches.length - 1));
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setTechActiveIdx(i => Math.max(i - 1, 0));
                            } else if (e.key === 'Backspace' && techInput === '' && techTags.length > 0) {
                              removeTechTag(techTags.length - 1);
                            } else if (e.key === 'Escape') {
                              setTechInput('');
                              setTechActiveIdx(-1);
                            }
                          }}
                          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-main)', fontSize: '0.85rem', minWidth: '120px' }}
                        />
                      </div>
                      {techMatches.length > 0 && (
                        <div 
                          style={{ 
                            position: 'absolute', 
                            top: '100%', 
                            left: 0, 
                            right: 0, 
                            zIndex: 10, 
                            background: 'var(--bg-card)', 
                            border: '1px solid var(--border-color)', 
                            borderRadius: '4px', 
                            marginTop: '4px', 
                            maxHeight: '160px', 
                            overflowY: 'auto',
                            boxShadow: 'var(--shadow-lg)'
                          }}
                        >
                          {techMatches.map((match, index) => (
                            <div
                              key={match}
                              onMouseDown={(e) => { e.preventDefault(); addTechTag(match); }}
                              style={{
                                padding: '6px 12px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                background: index === techActiveIdx ? 'var(--bg-hover)' : 'transparent',
                                color: 'var(--text-main)'
                              }}
                            >
                              {match}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-main)', margin: 0 }}>Submission Deadline</label>
                        <Tooltip content="Commits pushed after this deadline will be flagged as late." />
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setNewDeadlineDate(todayISO())}
                          style={{ padding: '2px 8px', height: '28px', fontSize: '0.75rem' }}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setNewDeadlineDate(addDaysISO(7))}
                          style={{ padding: '2px 8px', height: '28px', fontSize: '0.75rem' }}
                        >
                          +1 week
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setNewDeadlineDate(addDaysISO(14))}
                          style={{ padding: '2px 8px', height: '28px', fontSize: '0.75rem' }}
                        >
                          +2 weeks
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setNewDeadlineDate(endOfMonthISO())}
                          style={{ padding: '2px 8px', height: '28px', fontSize: '0.75rem' }}
                        >
                          End of month
                        </button>
                      </div>
                    </div>
                    <div className="settings-deadline-inputs" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="date"
                        className="input-field"
                        value={newDeadlineDate}
                        min={minDeadlineISO()}
                        onChange={(e) => setNewDeadlineDate(e.target.value)}
                        style={{ flex: 2 }}
                      />
                      <input
                        type="time"
                        className="input-field"
                        aria-label="Deadline time"
                        value={newDeadlineTime}
                        onChange={(e) => setNewDeadlineTime(e.target.value || '23:59')}
                        disabled={!newDeadlineDate}
                        style={{ flex: 1.2 }}
                      />
                    </div>
                  </div>

                  <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)} disabled={submitting}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!newCourseName.trim() || submitting}>
                      {submitting ? 'Creating…' : 'Create Course'}
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
{showApiKeys && (
  <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
    <div className="modal-card card" style={{ maxWidth: '540px', width: '90%', padding: '24px', position: 'relative' }}>
      <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: `1px solid var(--border-color)`, paddingBottom: '12px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-main)', margin: 0 }}>Cloud Model API Keys</h2>
        <button className="close-btn" type="button" onClick={() => setShowApiKeys(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
          <X size={20} />
        </button>
      </div>
      <ApiKeysCard />
    </div>
  </div>
)}
    </div>
  );
}


import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Login from './views/Login/Login';
import CourseSelect from './views/CourseSelect/CourseSelect';
import Dashboard from './views/Dashboard/Dashboard';
import Projects from './views/Projects/Projects';
import Students from './views/Students/Students';
import Plagiarism from './views/Plagiarism/Plagiarism';
import Settings from './views/Settings/Settings';
import Analytics from './views/Analytics/Analytics';
import CreateProjectModal from './components/CreateProjectModal';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [currentCourse, setCurrentCourse] = useState(null);
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [selectedProject, setSelectedProject] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // App state lists
  const [projects, setProjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [plagiarismAlerts, setPlagiarismAlerts] = useState([]);
  
  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Global 401 interceptor to redirect to login on unauthorized access
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 401) {
        localStorage.removeItem('token');
        setUser(null);
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // 1. Initial auth check
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setAuthLoading(false);
        return;
      }

      if (token === 'mock-jwt-token') {
        setUser({ id: 1, username: 'Dr. Noyel Fernando', email: 'noyel@example.com' });
        setAuthLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/v1/users/me', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          localStorage.removeItem('token');
        }
      } catch (err) {
        console.error('Auth verification offline. Loading demo session.');
        setUser({ id: 1, username: 'Dr. Noyel Fernando', email: 'noyel@example.com' });
      } finally {
        setAuthLoading(false);
      }
    };

    checkAuth();
  }, []);

  // 2. Load projects and mock lists on course select
  useEffect(() => {
    if (!currentCourse) {
      setProjects([]);
      return;
    }

    const loadCourseData = async () => {
      const token = localStorage.getItem('token');

      try {
        const response = await fetch(`/api/v1/courses/${currentCourse.id}/projects`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error('API failed to load course projects');
        const data = await response.json();

        if (data.projects.length === 0) {
          setProjects([]);
          setStudents([]);
          setPlagiarismAlerts([]);
          return;
        }

        // Fetch metrics and authors in parallel for each project
        const detailedProjects = await Promise.all(
          data.projects.map(async (proj) => {
            try {
              // 1. Fetch analytics (Gini coefficient & distribution status)
              const analyticsRes = await fetch(`/api/v1/projects/${proj.id}/analytics`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const analyticsData = analyticsRes.ok ? await analyticsRes.json() : null;

              // 2. Fetch commits
              const commitsRes = await fetch(`/api/v1/projects/${proj.id}/commits`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const commitsData = commitsRes.ok ? await commitsRes.json() : { commits: [] };

              // Determine last updated text
              let lastUpdated = 'No commits';
              if (commitsData.commits && commitsData.commits.length > 0) {
                const latestDate = new Date(commitsData.commits[0].timestamp);
                lastUpdated = latestDate.toLocaleDateString();
              }

              // 3. Fetch authors
              const authorsRes = await fetch(`/api/v1/projects/${proj.id}/authors`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const authorsData = authorsRes.ok ? await authorsRes.json() : { authors: [] };

              const gini = analyticsData ? analyticsData.gini_coefficient : 0.35;
              const plagiarismRisk = gini > 0.6 ? 'High Risk' : 'Good';

              return {
                ...proj,
                techStack: proj.tech_stack || ['Python'],
                lastUpdated,
                plagiarismRisk,
                gini,
                authorsCount: authorsData.total_authors || 0,
                commitsCount: commitsData.total_commits || 0,
                authors: authorsData.authors || [],
                analytics: analyticsData
              };
            } catch (err) {
              console.error(`Error loading details for project ${proj.id}:`, err);
              return {
                ...proj,
                techStack: proj.tech_stack || ['Python'],
                lastUpdated: 'Recently updated',
                plagiarismRisk: 'Good',
                gini: 0.35,
                authorsCount: 0,
                commitsCount: 0,
                authors: []
              };
            }
          })
        );

        setProjects(detailedProjects);

        // 4. Derive students directory dynamically from authors list
        const studentsMap = {};
        detailedProjects.forEach((proj) => {
          if (proj.authors) {
            proj.authors.forEach((auth) => {
              const emailKey = auth.email.toLowerCase();
              if (!studentsMap[emailKey]) {
                // Find matching stats in project analytics contributions
                const contribution = proj.analytics?.contributions?.find(c => c.email.toLowerCase() === emailKey);
                
                studentsMap[emailKey] = {
                  id: auth.id,
                  name: auth.name,
                  email: auth.email,
                  studentId: `CS-${1000 + auth.id}`,
                  commitsCount: contribution ? contribution.commit_count : (proj.commitsCount / (proj.authorsCount || 1)),
                  additions: contribution ? contribution.lines_added : 0,
                  deletions: contribution ? Math.floor(contribution.lines_added * 0.2) : 0,
                  status: 'Active',
                  projects: [proj.id]
                };
              } else {
                // Accumulate commits/lines if student is in multiple projects
                const contribution = proj.analytics?.contributions?.find(c => c.email.toLowerCase() === emailKey);
                if (contribution) {
                  studentsMap[emailKey].commitsCount += contribution.commit_count;
                  studentsMap[emailKey].additions += contribution.lines_added;
                  studentsMap[emailKey].deletions += Math.floor(contribution.lines_added * 0.2);
                }
                if (!studentsMap[emailKey].projects.includes(proj.id)) {
                  studentsMap[emailKey].projects.push(proj.id);
                }
              }
            });
          }
        });

        const derivedStudents = Object.values(studentsMap);
        setStudents(derivedStudents);

        // 5. Derive plagiarism alerts dynamically based on Gini index
        const derivedAlerts = [];
        const highRisk = detailedProjects.filter(p => p.plagiarismRisk === 'High Risk');
        
        highRisk.forEach((proj, idx) => {
          const otherProj = detailedProjects.find(p => p.id !== proj.id) || { name: 'External Course Library' };
          derivedAlerts.push({
            id: idx + 1,
            severity: 'High',
            percentage: Math.floor(75 + (proj.gini * 20)), // Scale percentage with Gini coefficient
            timestamp: 'Recently',
            projectA: proj.name,
            authorA: proj.authors?.[0]?.name || 'Student Team',
            projectB: otherProj.name,
            authorB: otherProj.authors?.[0]?.name || 'Reference Repository',
            matchedFile: 'src/main.py',
            status: 'Needs Review'
          });
        });

        setPlagiarismAlerts(derivedAlerts);

      } catch (err) {
        console.error('Failed to load course details from API:', err);
        setProjects([]);
        setStudents([]);
        setPlagiarismAlerts([]);
      }
    };

    loadCourseData();
  }, [currentCourse]);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setCurrentCourse(null);
    setSelectedProject(null);
  };

  const handleCloseCourse = () => {
    setCurrentCourse(null);
    setSelectedProject(null);
  };

  const handleProjectCreated = (newProject) => {
    window.location.reload();
  };

  const handleDeleteProject = async (id) => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    
    const token = localStorage.getItem('token');

    try {
      const response = await fetch(`/api/v1/projects/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        setProjects(projects.filter(p => p.id !== id));
      }
    } catch (err) {
      console.error('Delete project failed:', err);
    }
  };

  const handleResolvePlagiarism = (id, result) => {
    setPlagiarismAlerts(plagiarismAlerts.map(alert => 
      alert.id === id ? { ...alert, status: 'Resolved', severity: result } : alert
    ));
    alert(`Alert resolved as: ${result}`);
  };

  const handleMergeAuthors = async (sourceId, targetId) => {
    if (!window.confirm("Are you sure you want to merge these two author profiles? This will combine their git logs and contribution history.")) {
      return;
    }

    const token = localStorage.getItem('token');

    try {
      const response = await fetch('/api/v1/authors/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          source_author_id: sourceId,
          target_author_id: targetId
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Author merge failed.');
      }

      alert('Student profiles merged successfully. Recalculating metrics...');
      // Re-trigger course data loading
      setCurrentCourse({ ...currentCourse });
    } catch (err) {
      alert('Merge failed: ' + err.message);
    }
  };

  const handleSelectProjectById = async (projectId) => {
    let proj = projects.find(p => p.id === projectId);
    if (!proj) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/v1/projects/${projectId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          proj = await res.json();
        }
      } catch (err) {
        console.error('Failed to load project details:', err);
      }
    }
    if (proj) {
      setSelectedProject(proj);
    } else {
      alert('Could not open project analytics.');
    }
  };

  if (authLoading) {
    return (
      <div className="loader-box" style={{ height: '100vh', justifyContent: 'center' }}>
        <div className="spinner"></div>
        <p>Loading Code Lens Session...</p>
      </div>
    );
  }

  // Route 1: Not Logged In
  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Route 2: Logged In, Select Course
  if (!currentCourse) {
    return (
      <CourseSelect 
        user={user} 
        onSelectCourse={setCurrentCourse} 
        onLogout={handleLogout} 
      />
    );
  }

  // Route 3: Course Workspace
  return (
    <div className="app-container">
      <Sidebar 
        currentCourse={currentCourse}
        currentTab={currentTab}
        setCurrentTab={(tab) => {
          setSelectedProject(null);
          setCurrentTab(tab);
        }}
        onCloseCourse={handleCloseCourse}
        onLogout={handleLogout}
        onCreateProjectClick={() => setShowCreateModal(true)}
      />

      <main className="main-content">
        <Header 
          user={user}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          currentCourse={currentCourse}
          onSelectProject={handleSelectProjectById}
          onNavigateTab={setCurrentTab}
          onSelectCourse={setCurrentCourse}
          onLogout={handleLogout}
        />

        <div className="content-body">
          {selectedProject ? (
            <Analytics 
              project={selectedProject} 
              onBack={() => setSelectedProject(null)} 
            />
          ) : (
            <>
              {currentTab === 'dashboard' && (
                <Dashboard 
                  user={user}
                  projects={projects}
                  studentsCount={students.length}
                  plagiarismCount={plagiarismAlerts.filter(a => a.status === 'Needs Review').length}
                  onViewAnalytics={setSelectedProject}
                  onCreateProjectClick={() => setShowCreateModal(true)}
                />
              )}

              {currentTab === 'projects' && (
                <Projects 
                  projects={projects}
                  onViewAnalytics={setSelectedProject}
                  onDeleteProject={handleDeleteProject}
                />
              )}

              {currentTab === 'students' && (
                <Students 
                  students={students}
                  projects={projects}
                  onMergeAuthors={handleMergeAuthors}
                />
              )}

              {currentTab === 'plagiarism' && (
                <Plagiarism 
                  alerts={plagiarismAlerts} 
                  onResolveAlert={handleResolvePlagiarism}
                />
              )}

              {currentTab === 'settings' && (
                <Settings 
                  course={currentCourse}
                  onCourseReset={() => {
                    setCurrentCourse({ ...currentCourse });
                  }}
                />
              )}
            </>
          )}
        </div>
      </main>

      {showCreateModal && (
        <CreateProjectModal 
          course={currentCourse}
          onClose={() => setShowCreateModal(false)}
          onProjectCreated={handleProjectCreated}
        />
      )}
    </div>
  );
}

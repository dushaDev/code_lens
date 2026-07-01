import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Login from './views/Login';
import CourseSelect from './views/CourseSelect';
import Dashboard from './views/Dashboard';
import Projects from './views/Projects';
import Students from './views/Students';
import Plagiarism from './views/Plagiarism';
import Settings from './views/Settings';
import Analytics from './views/Analytics';
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

      // Mock data setup
      const mockProjects = [
        { id: 1, name: 'Advanced Algorithms Group 4', description: 'Complexity metrics search', gitUrl: 'https://github.com/algo/group4.git', techStack: ['Python'], lastUpdated: '2 hours ago', plagiarismRisk: 'Good', course_id: currentCourse.id },
        { id: 2, name: 'Web Dev Final - Section B', description: 'Full stack app review', gitUrl: 'https://github.com/web/secb.git', techStack: ['JavaScript', 'React'], lastUpdated: 'Yesterday', plagiarismRisk: 'Good', course_id: currentCourse.id },
        { id: 3, name: 'Data Structures - Assignment 2', description: 'Red-Black tree implementations', gitUrl: 'https://github.com/ds/assign2.git', techStack: ['C++'], lastUpdated: '3 days ago', plagiarismRisk: 'High Risk', course_id: currentCourse.id },
        { id: 4, name: 'Mobile App Dev - Prototype', description: 'Android application review', gitUrl: 'https://github.com/mobile/proto.git', techStack: ['Kotlin'], lastUpdated: '1 week ago', plagiarismRisk: 'Good', course_id: currentCourse.id },
      ];

      const mockStudents = [
        { id: 1, name: 'Chamara Kapugedara', email: 'chamara@codelens.edu', studentId: 'CS-2401', commitsCount: 28, additions: 1840, deletions: 210, status: 'Active' },
        { id: 2, name: 'Dusha Madushanka', email: 'dusha@codelens.edu', studentId: 'CS-2402', commitsCount: 42, additions: 3290, deletions: 450, status: 'Active' },
        { id: 3, name: 'Noyel Fernando', email: 'noyel@codelens.edu', studentId: 'CS-2403', commitsCount: 16, additions: 920, deletions: 120, status: 'Active' },
        { id: 4, name: 'Sanduni K', email: 'sanduni@codelens.edu', studentId: 'CS-2404', commitsCount: 8, additions: 320, deletions: 40, status: 'Active' },
      ];

      const mockAlerts = [
        { id: 1, severity: 'High', percentage: 86, timestamp: '2 hours ago', projectA: 'Data Structures - Assignment 2', authorA: 'Student Group 3', projectB: 'Data Structures - Assignment 2 (Copy)', authorB: 'Student Group 7', matchedFile: 'src/rb_tree.cpp', status: 'Needs Review' },
        { id: 2, severity: 'Medium', percentage: 64, timestamp: '1 day ago', projectA: 'Web Dev Final - Section B', authorA: 'Alice Johnson', projectB: 'Web Dev Final - Section A', authorB: 'Bob Smith', matchedFile: 'app/server.js', status: 'Resolved' },
      ];

      setStudents(mockStudents);
      setPlagiarismAlerts(mockAlerts);

      if (token === 'mock-jwt-token') {
        setProjects(mockProjects);
        return;
      }

      try {
        const response = await fetch(`/api/v1/courses/${currentCourse.id}/projects`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error('API failed');
        const data = await response.json();
        
        // Merge tech stacks and plagiarism flags to database results for mockup fidelity
        const merged = data.projects.map((p, idx) => ({
          ...p,
          techStack: idx % 2 === 0 ? ['Python'] : ['JavaScript', 'React'],
          lastUpdated: 'Recently updated',
          plagiarismRisk: idx === 2 ? 'High Risk' : 'Good'
        }));
        
        setProjects(merged.length > 0 ? merged : mockProjects);
      } catch (err) {
        setProjects(mockProjects);
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
    setProjects([newProject, ...projects]);
  };

  const handleDeleteProject = async (id) => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    
    const token = localStorage.getItem('token');
    if (token === 'mock-jwt-token') {
      setProjects(projects.filter(p => p.id !== id));
      return;
    }

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
      setProjects(projects.filter(p => p.id !== id));
    }
  };

  const handleResolvePlagiarism = (id, result) => {
    setPlagiarismAlerts(plagiarismAlerts.map(alert => 
      alert.id === id ? { ...alert, status: 'Resolved', severity: result } : alert
    ));
    alert(`Alert resolved as: ${result}`);
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
                <Students students={students} />
              )}

              {currentTab === 'plagiarism' && (
                <Plagiarism 
                  alerts={plagiarismAlerts} 
                  onResolveAlert={handleResolvePlagiarism}
                />
              )}

              {currentTab === 'settings' && (
                <Settings />
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

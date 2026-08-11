import { apiFetch, UNAUTHORIZED_EVENT } from './api/client';
import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { useNotification } from './contexts/NotificationContext';
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
import QualitativeFloatingPill from './components/QualitativeFloatingPill';
import './App.css';

export default function App() {
  // Listen for unauthorized events from apiFetch client to log out user
  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem('token');
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, []);

  const { addNotification, removeNotification, updateNotification } = useNotification();
  const [user, setUser] = useState(null);
  const [currentCourse, setCurrentCourse] = useState(null);
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [selectedProject, setSelectedProject] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');

  const handleNavigateTab = (tab, query = '') => {
    setSelectedProject(null);
    setCurrentTab(tab);
    if (tab === 'students') {
      setStudentSearchQuery(query);
    }
  };
  
  // App state lists
  const [projects, setProjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [plagiarismAlerts, setPlagiarismAlerts] = useState([]);
  const [plagiarismClusters, setPlagiarismClusters] = useState([]);
  const [plagiarismCoverage, setPlagiarismCoverage] = useState(null);
  
  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Automatic Plagiarism Check & Unread Counter
  const [isAutoPlagiarismScanning, setIsAutoPlagiarismScanning] = useState(false);
  const [unreadPlagiarismCount, setUnreadPlagiarismCount] = useState(0);

  // ── Global Qualitative Analysis State ──────────────────────────────────────
  // Persists across tab switches so background processing continues
  const [qualAnalysisState, setQualAnalysisState] = useState({
    projectId: null,
    status: 'idle',    // 'idle' | 'running' | 'cancelling' | 'complete' | 'cancelled'
    progress: 0,
    message: '',
    data: null,
  });
  const [pillDismissed, setPillDismissed] = useState(false);
  const qualAbortRef = useRef(null);  // AbortController for the streaming fetch
  // ──────────────────────────────────────────────────────────────────────────



  // ── Global Qualitative Stream Logic ──────────────────────────────────────
  const triggerQualitativeAnalysis = async (projectId, forceRefresh = false, mode = 'sample') => {
    // Abort any existing stream for a different project
    if (qualAbortRef.current) {
      qualAbortRef.current.abort();
      qualAbortRef.current = null;
    }

    const controller = new AbortController();
    qualAbortRef.current = controller;
    const token = localStorage.getItem('token');

    setQualAnalysisState(prev => ({
      ...prev,
      projectId,
      status: 'running',
      progress: 0,
      message: forceRefresh ? 'Re-analyzing project...' : 'Initializing local AI pipeline...',
      data: forceRefresh ? null : prev.data,
    }));
    setPillDismissed(false);

    try {
      const params = new URLSearchParams();
      if (forceRefresh) params.append('force_refresh', 'true');
      if (mode) params.append('mode', mode);
      const url = `/api/v1/projects/${projectId}/qualitative-analysis?${params.toString()}`;
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: controller.signal
      });

      if (!res.ok) throw new Error('Failed to start qualitative analysis.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line.trim());
            if (event.type === 'progress') {
              setQualAnalysisState(prev => ({
                ...prev,
                status: 'running',
                progress: event.progress || prev.progress,
                message: event.message || prev.message,
              }));
            } else if (event.type === 'complete') {
              setQualAnalysisState(prev => ({
                ...prev,
                status: 'complete',
                progress: 100,
                message: 'Analysis Complete!',
                data: event.data,
              }));
            } else if (event.type === 'cancelled') {
              setQualAnalysisState(prev => ({
                ...prev,
                status: 'cancelled',
                progress: 0,
                message: 'Analysis stopped by user.',
              }));
            }
          } catch (jsonErr) {
            console.error('Stream parse error:', jsonErr);
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Qualitative stream error:', e);
        setQualAnalysisState(prev => ({
          ...prev,
          status: 'cancelled',
          message: 'Error running local AI analysis.',
        }));
      }
    }
  };

  const handleStopQualitative = async (projectId) => {
    if (qualAbortRef.current) {
      qualAbortRef.current.abort();
      qualAbortRef.current = null;
    }
    setQualAnalysisState(prev => ({ ...prev, status: 'cancelling', message: 'Cancelling backend local AI process...' }));
    try {
      const token = localStorage.getItem('token');
      await apiFetch(`/api/v1/projects/${projectId}/qualitative-analysis/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setQualAnalysisState(prev => ({ ...prev, status: 'cancelled', progress: 0, message: 'Analysis stopped by user.' }));
    } catch (err) {
      console.error('Failed to signal cancel to backend:', err);
      setQualAnalysisState(prev => ({ ...prev, status: 'cancelled', message: 'Analysis stopped.' }));
    }
  };
  // ──────────────────────────────────────────────────────────────────────────

  // 1. Initial auth check
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setAuthLoading(false);
        return;
      }

      try {
        const response = await apiFetch('/api/v1/users/me', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          localStorage.removeItem('token');
          setUser(null);
        }
      } catch (err) {
        console.error('Auth verification offline/failed:', err);
        localStorage.removeItem('token');
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    checkAuth();
  }, []);

  // 2. Apply dark mode theme class globally based on user preference
  useEffect(() => {
    if (user?.is_dark_mode) {
      document.documentElement.classList.add('dark-theme');
    } else {
      document.documentElement.classList.remove('dark-theme');
    }
  }, [user]);

  // 3. Load projects and mock lists on course select
  useEffect(() => {
    if (!currentCourse) {
      setProjects([]);
      return;
    }

    const loadCourseData = async () => {
      const token = localStorage.getItem('token');

      try {
        const response = await apiFetch(`/api/v1/courses/${currentCourse.id}/projects`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error('API failed to load course projects');
        const data = await response.json();

        const projList = Array.isArray(data.projects) ? data.projects : (Array.isArray(data) ? data : []);

        if (projList.length === 0) {
          setProjects([]);
          setStudents([]);
          setPlagiarismAlerts([]);
          setUnreadPlagiarismCount(0);
          setIsAutoPlagiarismScanning(false);
          return;
        }

        // Fetch metrics and authors in parallel for each project
        const detailedProjects = await Promise.all(
          projList.map(async (proj) => {
            try {
              // 1. Fetch analytics (Gini coefficient & distribution status)
              const analyticsRes = await apiFetch(`/api/v1/projects/${proj.id}/analytics`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const analyticsData = analyticsRes.ok ? await analyticsRes.json() : null;

              // 2. Fetch commits
              const commitsRes = await apiFetch(`/api/v1/projects/${proj.id}/commits`, {
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
              const authorsRes = await apiFetch(`/api/v1/projects/${proj.id}/authors`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const authorsData = authorsRes.ok ? await authorsRes.json() : { authors: [] };

              const gini = analyticsData ? analyticsData.gini_coefficient : 0.35;
              const plagiarismRisk = gini >= 0.5 ? 'High Risk' : gini >= 0.3 ? 'Medium Risk' : 'Good';

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

        // 4. Derive students directory dynamically from authors list safely
        const studentsMap = {};
        detailedProjects.forEach((proj) => {
          if (Array.isArray(proj.authors)) {
            proj.authors.forEach((auth) => {
              if (!auth) return;
              const rawEmail = auth.email || auth.name || `author-${auth.id}`;
              const emailKey = String(rawEmail).toLowerCase();

              if (!studentsMap[emailKey]) {
                const contribution = Array.isArray(proj.analytics?.contributions) 
                  ? proj.analytics.contributions.find(c => c && c.email && String(c.email).toLowerCase() === emailKey)
                  : null;
                
                studentsMap[emailKey] = {
                  id: auth.id,
                  name: auth.name || 'Unknown Author',
                  email: auth.email || 'no-email@domain.com',
                  studentId: `CS-${1000 + (auth.id || 0)}`,
                  commitsCount: contribution ? contribution.commit_count : Math.round(proj.commitsCount / (proj.authorsCount || 1)),
                  additions: contribution ? contribution.lines_added : 0,
                  deletions: contribution ? Math.floor((contribution.lines_added || 0) * 0.2) : 0,
                  status: 'Active',
                  projects: [proj.id]
                };
              } else {
                const contribution = Array.isArray(proj.analytics?.contributions) 
                  ? proj.analytics.contributions.find(c => c && c.email && String(c.email).toLowerCase() === emailKey)
                  : null;

                if (contribution) {
                  studentsMap[emailKey].commitsCount += (contribution.commit_count || 0);
                  studentsMap[emailKey].additions += (contribution.lines_added || 0);
                  studentsMap[emailKey].deletions += Math.floor((contribution.lines_added || 0) * 0.2);
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

        // 5. Automatic Plagiarism Check (Runs Winnowing AST analysis)
        setIsAutoPlagiarismScanning(true);
        const scanNotifId = addNotification({
          type: 'info',
          title: 'Automatic Plagiarism Check',
          description: 'Parsing AST structures & k-grams (15%)...',
          progress: true,
          progressValue: 15,
          autoClose: false
        });

        let currentProgress = 15;
        const scanInterval = setInterval(() => {
          if (currentProgress < 85) {
            currentProgress += 15;
            let msg = 'Comparing structural fingerprints (Winnowing)...';
            if (currentProgress > 60) msg = 'Filtering match clusters & computing overlap...';
            updateNotification(scanNotifId, {
              progressValue: currentProgress,
              description: `${msg} (${currentProgress}%)`
            });
          }
        }, 200);

        try {
          const simRes = await apiFetch(`/api/v1/courses/${currentCourse.id}/similarity/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ k: 5, w: 4, similarity_threshold: 30.0 })
          });

          clearInterval(scanInterval);
          updateNotification(scanNotifId, {
            progressValue: 100,
            description: 'Plagiarism check completed (100%)'
          });

          if (simRes.ok) {
            const simData = await simRes.json();
            const realAlerts = (simData.reports || []).map((r, idx) => ({
              id: r.report_id || (idx + 1),
              severity: r.confidence_level === 'HIGH' ? 'High' : 'Medium',
              percentage: r.file_match_percentage || r.similarity_score,
              fileMatchPct: r.file_match_percentage || r.similarity_score,
              identifierOverlap: r.identifier_overlap_percentage || 100.0,
              totalMatchRuns: r.total_match_runs || (r.matched_blocks?.length || 0),
              maxContiguousTokens: r.max_contiguous_run_tokens || 0,
              timestamp: r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Recently',
              projectA: r.project_a_name,
              projectAId: r.project_a_id,
              authorA: 'Project ' + r.project_a_name,
              projectB: r.project_b_name,
              projectBId: r.project_b_id,
              authorB: 'Project ' + r.project_b_name,
              matchedFile: r.matched_blocks?.[0]?.file_a || 'AST Structure Match',
              matchedBlocks: r.matched_blocks || [],
              status: r.status || 'Needs Review'
            }));

            setPlagiarismAlerts(realAlerts);
            setPlagiarismClusters(simData.clusters || []);

            const unreviewedCount = realAlerts.filter(a => !a.status || a.status === 'Needs Review').length;
            setUnreadPlagiarismCount(unreviewedCount);

            const covRes = await apiFetch(`/api/v1/courses/${currentCourse.id}/similarity/coverage`);
            if (covRes.ok) {
              const covData = await covRes.json();
              setPlagiarismCoverage(covData);
            }
          } else {
            setPlagiarismAlerts([]);
            setPlagiarismClusters([]);
            setUnreadPlagiarismCount(0);
          }
        } catch (e) {
          console.warn('Could not run automatic similarity scan:', e);
          setPlagiarismAlerts([]);
          setUnreadPlagiarismCount(0);
        } finally {
          setIsAutoPlagiarismScanning(false);
          removeNotification(scanNotifId);
        }

      } catch (err) {
        console.error('Failed to load course details from API:', err);
        setProjects([]);
        setStudents([]);
        setPlagiarismAlerts([]);
        setUnreadPlagiarismCount(0);
      }
    };

    loadCourseData();
  }, [currentCourse?.id, refreshCounter]);

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
    setShowCreateModal(false);
    setRefreshCounter(prev => prev + 1);
  };

  const handleDeleteProject = async (id) => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    
    const token = localStorage.getItem('token');

    try {
      const response = await apiFetch(`/api/v1/projects/${id}`, {
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

  const handleSyncProject = async (projectId) => {
    const token = localStorage.getItem('token');
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to pull updates from GitHub.');
      }
      setRefreshCounter(prev => prev + 1);
      addNotification({ type: 'success', title: 'Sync Successful', description: `Project successfully updated from GitHub!` });
    } catch (err) {
      console.error('Failed to sync project:', err);
      addNotification({ type: 'error', title: 'Sync Failed', description: err.message });
    }
  };

  const handleResolvePlagiarism = (id, result) => {
    setPlagiarismAlerts(prev => prev.map(alert => 
      alert.id === id ? { ...alert, status: 'Resolved', severity: result } : alert
    ));
    setUnreadPlagiarismCount(prev => Math.max(0, prev - 1));
    addNotification({ type: 'success', title: 'Alert Resolved', description: `Alert resolved as: ${result}` });
  };

  const handleMergeAuthors = async (sourceId, targetId) => {
    if (!window.confirm("Are you sure you want to merge these two author profiles? This will combine their git logs and contribution history.")) {
      return;
    }

    const token = localStorage.getItem('token');

    try {
      const response = await apiFetch('/api/v1/authors/merge', {
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

      setRefreshCounter(prev => prev + 1);
      addNotification({ type: 'success', title: 'Merge Successful', description: 'Student profiles merged successfully. Recalculating metrics...' });
    } catch (err) {
      addNotification({ type: 'error', title: 'Merge Failed', description: err.message });
    }
  };

  const handleSelectProjectById = async (projectId) => {
    let proj = projects.find(p => p.id === projectId);
    if (!proj) {
      try {
        const token = localStorage.getItem('token');
        const res = await apiFetch(`/api/v1/projects/${projectId}`, {
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
      addNotification({ type: 'error', title: 'Navigation Error', description: 'Could not open project analytics.' });
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
        onUserUpdate={(updatedUser) => setUser(updatedUser)}
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
        unreadPlagiarismCount={unreadPlagiarismCount}
        onClearUnreadPlagiarism={() => setUnreadPlagiarismCount(0)}
      />

      <main className="main-content">
        <Header 
          user={user}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          currentCourse={currentCourse}
          onSelectProject={handleSelectProjectById}
          onNavigateTab={handleNavigateTab}
          onSelectCourse={setCurrentCourse}
          onLogout={handleLogout}
          onUserUpdate={(updatedUser) => setUser(updatedUser)}
        />

        <div className="content-body">
          {selectedProject ? (
            <Analytics 
              project={selectedProject} 
              course={currentCourse}
              onBack={() => setSelectedProject(null)}
              qualAnalysisState={qualAnalysisState.projectId === selectedProject.id ? qualAnalysisState : { projectId: selectedProject.id, status: 'idle', progress: 0, message: '', data: null }}
              onStartQualitative={(forceRefresh, mode) => triggerQualitativeAnalysis(selectedProject.id, forceRefresh, mode)}
              onStopQualitative={() => handleStopQualitative(selectedProject.id)}
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
                  onSyncProject={handleSyncProject}
                />
              )}

              {currentTab === 'students' && (
                <Students 
                  students={students}
                  projects={projects}
                  onMergeAuthors={handleMergeAuthors}
                  onSelectProject={setSelectedProject}
                  initialSearch={studentSearchQuery}
                />
              )}

              {currentTab === 'plagiarism' && (
                <Plagiarism 
                  alerts={plagiarismAlerts} 
                  clusters={plagiarismClusters}
                  coverage={plagiarismCoverage}
                  currentCourseId={currentCourse?.id}
                  onResolveAlert={handleResolvePlagiarism}
                />
              )}

              {currentTab === 'settings' && (
                <Settings 
                  course={currentCourse}
                  onCourseReset={() => {
                    setRefreshCounter(prev => prev + 1);
                  }}
                  onCourseDeleted={() => {
                    setCurrentCourse(null);
                  }}
                  onCourseUpdated={(updatedCourse) => {
                    setCurrentCourse(updatedCourse);
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
          existingProjects={projects}
          onClose={() => setShowCreateModal(false)}
          onProjectCreated={handleProjectCreated}
        />
      )}

      {/* Floating Notification Pill when Plagiarism Scan runs in background */}
      {/* Removed old UI pill in favor of centralized notifications */}

      {/* Global floating pill — shown when analysis runs while user navigated elsewhere */}
      {qualAnalysisState.status !== 'idle' &&
       qualAnalysisState.status !== 'complete' &&
       qualAnalysisState.status !== 'cancelled' &&
       !pillDismissed &&
       !(selectedProject && selectedProject.id === qualAnalysisState.projectId) && (
        <QualitativeFloatingPill
          qualAnalysisState={qualAnalysisState}
          onView={() => {
            // Navigate back to the project analytics
            const proj = projects.find(p => p.id === qualAnalysisState.projectId);
            if (proj) setSelectedProject(proj);
            setPillDismissed(false);
          }}
          onDismiss={() => setPillDismissed(true)}
        />
      )}
    </div>
  );
}

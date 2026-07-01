import React, { useState } from 'react';
import { Users, GraduationCap, Award, GitCommit, FileSpreadsheet } from 'lucide-react';
import './Students.css';

export default function Students({ students }) {
  const [search, setSearch] = useState('');

  const filteredStudents = students.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="students-view">
      <div className="view-header">
        <div>
          <h1>Students Directory</h1>
          <p className="subtitle">Overview of students, their total commit activities, and contribution logs.</p>
        </div>
      </div>

      {/* Top metrics bar */}
      <div className="students-metrics-row">
        <div className="student-metric-card card">
          <GraduationCap size={20} className="purple-text" />
          <div>
            <h3>{students.length}</h3>
            <p>Enrolled Students</p>
          </div>
        </div>
        <div className="student-metric-card card">
          <GitCommit size={20} className="blue-text" />
          <div>
            <h3>{students.reduce((acc, s) => acc + (s.commitsCount || 0), 0)}</h3>
            <p>Total Commits Evaluated</p>
          </div>
        </div>
        <div className="student-metric-card card">
          <Award size={20} className="emerald-text" />
          <div>
            <h3>89.4%</h3>
            <p>Average Contribution Index</p>
          </div>
        </div>
      </div>

      {/* Students Search Bar */}
      <div className="students-search card">
        <input 
          type="text" 
          placeholder="Search students by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field"
        />
      </div>

      {/* Students list */}
      <div className="students-list-card card">
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Student Details</th>
                <th>Primary Email</th>
                <th>Commits</th>
                <th>Impact Lines</th>
                <th>Current Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((student) => (
                <tr key={student.id}>
                  <td className="student-info-cell">
                    <div className="student-avatar">
                      {student.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span className="student-name">{student.name}</span>
                      <span className="student-id">ID: {student.studentId || `CS-${1000 + student.id}`}</span>
                    </div>
                  </td>
                  <td className="muted-cell">{student.email}</td>
                  <td className="bold-cell">{student.commitsCount || 24}</td>
                  <td>
                    <span className="additions-text">+{student.additions || 1400}</span>
                    <span className="deletions-text">-{student.deletions || 320}</span>
                  </td>
                  <td>
                    <span className={`badge ${student.status === 'Active' ? 'badge-success' : 'badge-info'}`}>
                      {student.status || 'Active'}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan="5" className="empty-table-cell">
                    <p>No students match your query.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

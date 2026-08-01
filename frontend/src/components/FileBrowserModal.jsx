import React, { useState, useEffect } from 'react';
import { X, Folder, File, ChevronRight, ChevronDown, Code2, AlertTriangle, RefreshCw } from 'lucide-react';
import CodeViewer from './CodeViewer';
import './FileBrowserModal.css';

function TreeNode({ node, onSelectFile, selectedPath }) {
  const [isOpen, setIsOpen] = useState(false);
  const isDir = node.type === 'directory';

  if (isDir) {
    return (
      <div className="tree-node-dir">
        <div 
          className="tree-node-header"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={15} className="folder-icon" />
          <span className="node-name">{node.name}</span>
        </div>
        {isOpen && (
          <div className="tree-node-children">
            {node.children && node.children.map((child, idx) => (
              <TreeNode 
                key={child.path || idx} 
                node={child} 
                onSelectFile={onSelectFile}
                selectedPath={selectedPath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  return (
    <div 
      className={`tree-node-file ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelectFile(node.path)}
    >
      <File size={14} className="file-icon" />
      <span className="node-name">{node.name}</span>
    </div>
  );
}

export default function FileBrowserModal({ project, onClose }) {
  const [treeData, setTreeData] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetchTree();
  }, [project.id]);

  const fetchTree = async () => {
    setLoadingTree(true);
    setErrorMsg('');
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`/api/v1/projects/${project.id}/files/tree`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to load project directory tree.');
      }
      setTreeData(data.tree);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoadingTree(false);
    }
  };

  const handleSelectFile = async (filePath) => {
    setSelectedFile(filePath);
    setLoadingContent(true);
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`/api/v1/projects/${project.id}/files/content?file_path=${encodeURIComponent(filePath)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Could not load file content.');
      }
      setFileContent(data.content);
    } catch (err) {
      setFileContent(`/* Error: ${err.message} */`);
    } finally {
      setLoadingContent(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card card file-browser-card">
        <div className="modal-header">
          <div className="modal-title-box">
            <Code2 size={20} className="blue-text" />
            <h2>Web File Browser — {project.name || 'Project Files'}</h2>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {errorMsg ? (
          <div className="file-browser-error-box alert-error">
            <AlertTriangle size={24} />
            <div>
              <h4>Files Unavailable</h4>
              <p>{errorMsg}</p>
            </div>
          </div>
        ) : loadingTree ? (
          <div className="modal-loader-box">
            <RefreshCw size={32} className="loader-spin icon-spin" />
            <p>Loading project file structure...</p>
          </div>
        ) : (
          <div className="file-browser-body">
            <div className="file-browser-sidebar">
              <div className="sidebar-title">Project Structure</div>
              <div className="tree-container">
                {treeData && (
                  <TreeNode 
                    node={treeData} 
                    onSelectFile={handleSelectFile} 
                    selectedPath={selectedFile}
                  />
                )}
              </div>
            </div>

            <div className="file-browser-content">
              <div className="code-viewer-container" style={{ padding: 0 }}>
                {loadingContent ? (
                  <div className="code-placeholder pulse">Loading file content...</div>
                ) : selectedFile ? (
                  <CodeViewer code={fileContent} filePath={selectedFile} />
                ) : (
                  <div className="code-placeholder">Click any file on the left sidebar to view its code.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

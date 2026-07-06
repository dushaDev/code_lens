import React from 'react';
import { 
  Code,
  Terminal,
  Cpu,
  Smartphone,
  Coffee,
  Braces,
  Binary,
  Hash,
  Gem,
  Database,
  Palette,
  Layers,
  Settings,
  FileText,
  Layout,
  Globe,
  Wrench,
  Sparkles
} from 'lucide-react';

/**
 * Returns the icon and CSS badge class for a given programming language or technology.
 * Supports a comprehensive list of standard developer stacks.
 * 
 * @param {string} techName Name of the technology stack
 * @param {number} size Icon width and height in pixels (default: 12)
 * @returns {{ icon: React.ReactNode, badgeClass: string }}
 */
export function getTechDetails(techName, size = 12) {
  if (!techName) {
    return {
      icon: <Code size={size} />,
      badgeClass: 'badge-info'
    };
  }

  const name = techName.toLowerCase().trim();

  // Python
  if (name.includes('python') || name === 'py') {
    return {
      icon: <Terminal size={size} />,
      badgeClass: 'tech-python'
    };
  }

  // React & Web Frameworks
  if (name.includes('react')) {
    return {
      icon: <Sparkles size={size} />,
      badgeClass: 'tech-react'
    };
  }

  // JavaScript & TypeScript
  if (name === 'javascript' || name === 'js' || name.includes('node')) {
    return {
      icon: <Braces size={size} />,
      badgeClass: 'tech-react'
    };
  }
  if (name === 'typescript' || name === 'ts') {
    return {
      icon: <Braces size={size} />,
      badgeClass: 'tech-ts'
    };
  }

  // C++ & C
  if (name === 'c++' || name === 'cpp' || name === 'c') {
    return {
      icon: <Cpu size={size} />,
      badgeClass: 'tech-cpp'
    };
  }

  // C#
  if (name === 'c#' || name === 'csharp') {
    return {
      icon: <Hash size={size} />,
      badgeClass: 'tech-csharp'
    };
  }

  // Java
  if (name === 'java') {
    return {
      icon: <Coffee size={size} />,
      badgeClass: 'tech-kotlin'
    };
  }

  // Kotlin & Android
  if (name === 'kotlin' || name.includes('android')) {
    return {
      icon: <Smartphone size={size} />,
      badgeClass: 'tech-kotlin'
    };
  }

  // Database / SQL
  if (name.includes('sql') || name === 'postgres' || name === 'mysql' || name === 'database' || name === 'db') {
    return {
      icon: <Database size={size} />,
      badgeClass: 'tech-db'
    };
  }

  // HTML & Markup
  if (name === 'html' || name === 'xml') {
    return {
      icon: <Layout size={size} />,
      badgeClass: 'tech-html'
    };
  }

  // CSS & Styling
  if (name === 'css' || name === 'scss' || name === 'sass' || name.includes('tailwind')) {
    return {
      icon: <Palette size={size} />,
      badgeClass: 'tech-css'
    };
  }

  // Shell & Scripting
  if (name === 'shell' || name === 'bash' || name === 'sh' || name === 'powershell') {
    return {
      icon: <Terminal size={size} />,
      badgeClass: 'tech-shell'
    };
  }

  // Go / Golang
  if (name === 'go' || name === 'golang') {
    return {
      icon: <Binary size={size} />,
      badgeClass: 'tech-go'
    };
  }

  // Rust
  if (name === 'rust' || name === 'rs') {
    return {
      icon: <Wrench size={size} />,
      badgeClass: 'tech-rust'
    };
  }

  // Ruby
  if (name === 'ruby' || name === 'rb') {
    return {
      icon: <Gem size={size} />,
      badgeClass: 'tech-ruby'
    };
  }

  // PHP
  if (name === 'php') {
    return {
      icon: <Globe size={size} />,
      badgeClass: 'tech-php'
    };
  }

  // Configuration (YAML, JSON, TOML)
  if (name === 'yaml' || name === 'yml' || name === 'json' || name === 'toml') {
    return {
      icon: <Settings size={size} />,
      badgeClass: 'tech-config'
    };
  }

  // Documentation (Markdown)
  if (name === 'markdown' || name === 'md') {
    return {
      icon: <FileText size={size} />,
      badgeClass: 'tech-md'
    };
  }

  // Scala & JVM languages
  if (name === 'scala') {
    return {
      icon: <Layers size={size} />,
      badgeClass: 'tech-kotlin'
    };
  }

  // Default fallback
  return {
    icon: <Code size={size} />,
    badgeClass: 'badge-info'
  };
}

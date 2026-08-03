import React from 'react';
import { 
  DiPython,
  DiJavascript1,
  DiReact,
  DiJava,
  DiAndroid,
  DiDatabase,
  DiHtml5,
  DiCss3,
  DiGo,
  DiRuby,
  DiPhp,
  DiMarkdown,
  DiTerminal
} from 'react-icons/di';
import { 
  SiTypescript,
  SiKotlin,
  SiRust,
  SiPostgresql,
  SiYaml,
  SiJson,
  SiCplusplus
} from 'react-icons/si';

/**
 * Returns the brand logo icon with authentic original brand colors and CSS badge class for a technology.
 * 
 * @param {string} techName Name of the technology stack
 * @param {number} size Icon width and height in pixels (default: 16)
 * @returns {{ icon: React.ReactNode, badgeClass: string }}
 */
export function getTechDetails(techName, size = 16) {
  if (!techName) {
    return {
      icon: <DiTerminal size={size} color="#3b82f6" />,
      badgeClass: 'badge-info'
    };
  }

  const name = techName.toLowerCase().trim();

  // Python
  if (name.includes('python') || name === 'py') {
    return {
      icon: <DiPython size={size} color="#3776AB" />,
      badgeClass: 'tech-python'
    };
  }

  // React & Web Frameworks
  if (name.includes('react')) {
    return {
      icon: <DiReact size={size} color="#00d8ff" />,
      badgeClass: 'tech-react'
    };
  }

  // JavaScript & TypeScript
  if (name === 'javascript' || name === 'js' || name.includes('node')) {
    return {
      icon: <DiJavascript1 size={size} color="#f7df1e" />,
      badgeClass: 'tech-react'
    };
  }
  if (name === 'typescript' || name === 'ts') {
    return {
      icon: <SiTypescript size={size - 2} color="#3178c6" />,
      badgeClass: 'tech-ts'
    };
  }

  // C++ & C
  if (name === 'c++' || name === 'cpp' || name === 'c') {
    return {
      icon: <SiCplusplus size={size - 2} color="#00599c" />,
      badgeClass: 'tech-cpp'
    };
  }

  // C#
  if (name === 'c#' || name === 'csharp') {
    return {
      icon: <DiTerminal size={size} color="#239120" />,
      badgeClass: 'tech-csharp'
    };
  }

  // Java
  if (name === 'java') {
    return {
      icon: <DiJava size={size + 4} color="#e76f00" style={{ marginTop: '-2px' }} />,
      badgeClass: 'tech-kotlin'
    };
  }

  // Kotlin & Android
  if (name === 'kotlin') {
    return {
      icon: <SiKotlin size={size - 2} color="#7f52ff" />,
      badgeClass: 'tech-kotlin'
    };
  }
  if (name.includes('android')) {
    return {
      icon: <DiAndroid size={size + 2} color="#3ddc84" />,
      badgeClass: 'tech-kotlin'
    };
  }

  // Database / SQL
  if (name === 'postgresql' || name === 'postgres') {
    return {
      icon: <SiPostgresql size={size - 2} color="#336791" />,
      badgeClass: 'tech-db'
    };
  }
  if (name.includes('sql') || name === 'database' || name === 'db' || name === 'mysql') {
    return {
      icon: <DiDatabase size={size} color="#64748b" />,
      badgeClass: 'tech-db'
    };
  }

  // HTML & Markup
  if (name === 'html' || name === 'xml') {
    return {
      icon: <DiHtml5 size={size + 2} color="#e34f26" />,
      badgeClass: 'tech-html'
    };
  }

  // CSS & Styling
  if (name === 'css' || name === 'scss' || name === 'sass' || name.includes('tailwind')) {
    return {
      icon: <DiCss3 size={size + 2} color="#1572b6" />,
      badgeClass: 'tech-css'
    };
  }

  // Shell & Scripting
  if (name === 'shell' || name === 'bash' || name === 'sh' || name === 'powershell') {
    return {
      icon: <DiTerminal size={size} color="#10b981" />,
      badgeClass: 'tech-shell'
    };
  }

  // Go / Golang
  if (name === 'go' || name === 'golang') {
    return {
      icon: <DiGo size={size + 4} color="#00add8" />,
      badgeClass: 'tech-go'
    };
  }

  // Rust
  if (name === 'rust' || name === 'rs') {
    return {
      icon: <SiRust size={size - 2} color="#ce412b" />,
      badgeClass: 'tech-rust'
    };
  }

  // Ruby
  if (name === 'ruby' || name === 'rb') {
    return {
      icon: <DiRuby size={size} color="#cc342d" />,
      badgeClass: 'tech-ruby'
    };
  }

  // PHP
  if (name === 'php') {
    return {
      icon: <DiPhp size={size + 4} color="#777bb4" />,
      badgeClass: 'tech-php'
    };
  }

  // Configuration (YAML, JSON, TOML)
  if (name === 'yaml' || name === 'yml') {
    return {
      icon: <SiYaml size={size - 2} color="#cb171e" />,
      badgeClass: 'tech-config'
    };
  }
  if (name === 'json') {
    return {
      icon: <SiJson size={size - 2} color="#0284c7" />,
      badgeClass: 'tech-config'
    };
  }

  // Documentation (Markdown)
  if (name === 'markdown' || name === 'md') {
    return {
      icon: <DiMarkdown size={size + 2} color="#083fa1" />,
      badgeClass: 'tech-md'
    };
  }

  // Default fallback
  return {
    icon: <DiTerminal size={size} color="#3b82f6" />,
    badgeClass: 'badge-info'
  };
}

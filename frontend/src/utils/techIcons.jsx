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
 * Returns the brand logo icon and CSS badge class for a technology.
 * Uses a unified neutral gray color and a slightly larger default size.
 * 
 * @param {string} techName Name of the technology stack
 * @param {number} size Icon width and height in pixels (default: 16)
 * @returns {{ icon: React.ReactNode, badgeClass: string }}
 */
export function getTechDetails(techName, size = 16) {
  const iconColor = '#4b5563'; // Neutral gray color for all icons

  if (!techName) {
    return {
      icon: <DiTerminal size={size} color={iconColor} />,
      badgeClass: 'badge-info'
    };
  }

  const name = techName.toLowerCase().trim();

  // Python
  if (name.includes('python') || name === 'py') {
    return {
      icon: <DiPython size={size} color={iconColor} />,
      badgeClass: 'tech-python'
    };
  }

  // React & Web Frameworks
  if (name.includes('react')) {
    return {
      icon: <DiReact size={size} color={iconColor} />,
      badgeClass: 'tech-react'
    };
  }

  // JavaScript & TypeScript
  if (name === 'javascript' || name === 'js' || name.includes('node')) {
    return {
      icon: <DiJavascript1 size={size} color={iconColor} />,
      badgeClass: 'tech-react'
    };
  }
  if (name === 'typescript' || name === 'ts') {
    return {
      icon: <SiTypescript size={size - 2} color={iconColor} />,
      badgeClass: 'tech-ts'
    };
  }

  // C++ & C
  if (name === 'c++' || name === 'cpp' || name === 'c') {
    return {
      icon: <SiCplusplus size={size - 2} color={iconColor} />,
      badgeClass: 'tech-cpp'
    };
  }

  // C#
  if (name === 'c#' || name === 'csharp') {
    return {
      icon: <DiTerminal size={size} color={iconColor} />,
      badgeClass: 'tech-csharp'
    };
  }

  // Java
  if (name === 'java') {
    return {
      icon: <DiJava size={size + 4} color={iconColor} style={{ marginTop: '-2px' }} />,
      badgeClass: 'tech-kotlin'
    };
  }

  // Kotlin & Android
  if (name === 'kotlin') {
    return {
      icon: <SiKotlin size={size - 2} color={iconColor} />,
      badgeClass: 'tech-kotlin'
    };
  }
  if (name.includes('android')) {
    return {
      icon: <DiAndroid size={size + 2} color={iconColor} />,
      badgeClass: 'tech-kotlin'
    };
  }

  // Database / SQL
  if (name === 'postgresql' || name === 'postgres') {
    return {
      icon: <SiPostgresql size={size - 2} color={iconColor} />,
      badgeClass: 'tech-db'
    };
  }
  if (name.includes('sql') || name === 'database' || name === 'db' || name === 'mysql') {
    return {
      icon: <DiDatabase size={size} color={iconColor} />,
      badgeClass: 'tech-db'
    };
  }

  // HTML & Markup
  if (name === 'html' || name === 'xml') {
    return {
      icon: <DiHtml5 size={size + 2} color={iconColor} />,
      badgeClass: 'tech-html'
    };
  }

  // CSS & Styling
  if (name === 'css' || name === 'scss' || name === 'sass' || name.includes('tailwind')) {
    return {
      icon: <DiCss3 size={size + 2} color={iconColor} />,
      badgeClass: 'tech-css'
    };
  }

  // Shell & Scripting
  if (name === 'shell' || name === 'bash' || name === 'sh' || name === 'powershell') {
    return {
      icon: <DiTerminal size={size} color={iconColor} />,
      badgeClass: 'tech-shell'
    };
  }

  // Go / Golang
  if (name === 'go' || name === 'golang') {
    return {
      icon: <DiGo size={size + 4} color={iconColor} />,
      badgeClass: 'tech-go'
    };
  }

  // Rust
  if (name === 'rust' || name === 'rs') {
    return {
      icon: <SiRust size={size - 2} color={iconColor} />,
      badgeClass: 'tech-rust'
    };
  }

  // Ruby
  if (name === 'ruby' || name === 'rb') {
    return {
      icon: <DiRuby size={size} color={iconColor} />,
      badgeClass: 'tech-ruby'
    };
  }

  // PHP
  if (name === 'php') {
    return {
      icon: <DiPhp size={size + 4} color={iconColor} />,
      badgeClass: 'tech-php'
    };
  }

  // Configuration (YAML, JSON, TOML)
  if (name === 'yaml' || name === 'yml') {
    return {
      icon: <SiYaml size={size - 2} color={iconColor} />,
      badgeClass: 'tech-config'
    };
  }
  if (name === 'json') {
    return {
      icon: <SiJson size={size - 2} color={iconColor} />,
      badgeClass: 'tech-config'
    };
  }

  // Documentation (Markdown)
  if (name === 'markdown' || name === 'md') {
    return {
      icon: <DiMarkdown size={size + 2} color={iconColor} />,
      badgeClass: 'tech-md'
    };
  }

  // Default fallback
  return {
    icon: <DiTerminal size={size} color={iconColor} />,
    badgeClass: 'badge-info'
  };
}

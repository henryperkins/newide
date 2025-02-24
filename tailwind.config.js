// tailwind.config.js
module.exports = {
  content: [
    './static/**/*.html',
    './static/**/*.js',
    // Add other file types if needed
  ],
  darkMode: 'class', // Use class-based dark mode for explicit control
  theme: {
    extend: {
      // Colors mapped from CSS variables in base.css
      colors: {
        // Primary colors
        'primary': {
          DEFAULT: '#2563eb', // --color-primary
          'dark': '#1e40af',  // --color-primary-dark
          'light': '#3b82f6'  // --color-primary-light
        },
        // Text colors
        'text': {
          'primary': '#1e293b',    // --text-primary
          'secondary': '#475569',  // --text-secondary
          'muted': '#94a3b8',      // --text-muted
          'inverted': '#f8fafc'    // --text-inverted
        },
        // Surface colors
        'surface': {
          'main': '#ffffff',      // --surface-main
          'secondary': '#f8fafc', // --surface-secondary
          'tertiary': '#f1f5f9',  // --surface-tertiary
          'elevated': '#ffffff'   // --surface-elevated
        },
        // Border colors
        'border': {
          'subtle': '#e2e8f0',    // --border-subtle
          'medium': '#cbd5e1',    // --border-medium
          'emphasis': '#94a3b8'   // --border-emphasis
        },
        // Feedback colors
        'feedback': {
          'success': '#10b981', // --feedback-success
          'warning': '#f59e0b', // --feedback-warning
          'error': '#ef4444',   // --feedback-error
          'info': '#0ea5e9'     // --feedback-info
        }
      },
      // Spacing system mapped from CSS variables
      spacing: {
        '2xs': '0.25rem', // --space-2xs
        'xs': '0.5rem',   // --space-xs
        'sm': '0.75rem',  // --space-sm
        'md': '1rem',     // --space-md
        'lg': '1.5rem',   // --space-lg
        'xl': '2rem',     // --space-xl
        '2xl': '3rem',    // --space-2xl
      },
      // Border radius mapped from CSS variables
      borderRadius: {
        'sm': '0.25rem', // --radius-sm
        'md': '0.5rem',  // --radius-md
        'lg': '0.75rem', // --radius-lg
        'xl': '1rem',    // --radius-xl
      },
      // Shadow system mapped from CSS variables
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.05)',                                                                // --shadow-sm
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',                       // --shadow-md
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',                     // --shadow-lg
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',                   // --shadow-xl
        'dark-sm': '0 1px 3px rgba(0, 0, 0, 0.3)',                                                            // Dark mode --shadow-sm
        'dark-md': '0 4px 6px rgba(0, 0, 0, 0.4)',                                                            // Dark mode --shadow-md
        'dark-lg': '0 10px 15px rgba(0, 0, 0, 0.5)',                                                          // Dark mode --shadow-lg
        'dark-xl': '0 20px 25px rgba(0, 0, 0, 0.6)',                                                          // Dark mode --shadow-xl
      },
      // Font families mapped from CSS variables
      fontFamily: {
        'sans': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],        // --font-sans
        'mono': ['JetBrains Mono', 'Consolas', 'Monaco', 'Courier New', 'monospace'],                        // --font-mono
      },
      // Font sizes mapped from CSS variables
      fontSize: {
        'xs': '0.75rem',    // --text-xs
        'sm': '0.875rem',   // --text-sm
        'md': '1rem',       // --text-md
        'lg': '1.125rem',   // --text-lg
        'xl': '1.25rem',    // --text-xl
        '2xl': '1.5rem',    // --text-2xl
      },
      // Line heights mapped from CSS variables
      lineHeight: {
        'tight': '1.25',     // --leading-tight
        'normal': '1.5',     // --leading-normal
        'relaxed': '1.75',   // --leading-relaxed
      },
      // Custom animations
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'slide-out-right': 'slideOutRight 0.3s ease-in',
        'slide-out-left': 'slideOutLeft 0.3s ease-in',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideOutRight: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        slideOutLeft: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(-100%)', opacity: '0' },
        },
      },
      // Add custom transition durations
      transitionDuration: {
        '0': '0ms',
        '150': '150ms', // --transition-fast
        '250': '250ms', // --transition-normal
        '350': '350ms', // --transition-slow
      },
      // Add focus ring styles
      ringWidth: {
        DEFAULT: '3px', // Default focus ring width from --focus-ring
      },
      ringColor: {
        DEFAULT: 'rgba(37, 99, 235, 0.4)', // Default focus ring color from --focus-ring
        'dark': 'rgba(59, 130, 246, 0.6)', // Dark mode focus ring color
      },
      // Add typography plugin customizations for markdown
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: theme('colors.text.primary'),
            a: {
              color: theme('colors.primary.DEFAULT'),
              '&:hover': {
                color: theme('colors.primary.dark'),
              },
            },
            h1: {
              color: theme('colors.text.primary'),
            },
            h2: {
              color: theme('colors.text.primary'),
            },
            h3: {
              color: theme('colors.text.primary'),
            },
            h4: {
              color: theme('colors.text.primary'),
            },
            code: {
              color: theme('colors.primary.dark'),
              backgroundColor: theme('colors.surface.tertiary'),
              padding: '0.2em 0.4em',
              borderRadius: '0.25rem',
              fontWeight: '400',
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
            pre: {
              backgroundColor: theme('colors.surface.tertiary'),
              color: theme('colors.text.primary'),
            },
            blockquote: {
              color: theme('colors.text.secondary'),
              borderLeftColor: theme('colors.border.subtle'),
            },
          },
        },
        dark: {
          css: {
            color: theme('colors.text.inverted'),
            a: {
              color: theme('colors.primary.light'),
              '&:hover': {
                color: theme('colors.primary.DEFAULT'),
              },
            },
            h1: {
              color: theme('colors.text.inverted'),
            },
            h2: {
              color: theme('colors.text.inverted'),
            },
            h3: {
              color: theme('colors.text.inverted'),
            },
            h4: {
              color: theme('colors.text.inverted'),
            },
            code: {
              color: theme('colors.primary.light'),
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            },
            pre: {
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              color: theme('colors.text.inverted'),
            },
            blockquote: {
              color: theme('colors.text.muted'),
              borderLeftColor: theme('colors.border.medium'),
            },
          },
        },
      }),
    },
  },
  variants: {
    extend: {
      // Enable dark mode variants
      backgroundColor: ['dark'],
      textColor: ['dark'],
      borderColor: ['dark'],
      ringColor: ['dark', 'focus-visible'],
      ringWidth: ['focus-visible'],
      typography: ['dark'],
    },
  },
  plugins: [
    require('@tailwindcss/typography'), // For markdown content styling
    require('@tailwindcss/forms'),      // For form input styling
  ],
}
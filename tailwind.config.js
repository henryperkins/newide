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
        // Dracula theme colors using OKLCH values
        'dracula': {
          'background': 'oklch(28.822% 0.022 277.508)', // --color-base-100
          'current-line': 'oklch(26.805% 0.02 277.508)', // --color-base-200
          'deeper-dark': 'oklch(24.787% 0.019 277.508)', // --color-base-300
          'foreground': 'oklch(97.747% 0.007 106.545)', // --color-base-content
          'comment': 'oklch(39.445% 0.032 275.524)', // --color-neutral
          'cyan': 'oklch(88.263% 0.093 212.846)', // --color-info
          'green': 'oklch(87.099% 0.219 148.024)', // --color-success
          'orange': 'oklch(95.533% 0.134 112.757)', // --color-warning
          'pink': 'oklch(75.461% 0.183 346.812)', // --color-primary
          'purple': 'oklch(74.202% 0.148 301.883)', // --color-secondary
          'red': 'oklch(68.22% 0.206 24.43)', // --color-error
          'yellow': 'oklch(83.392% 0.124 66.558)' // --color-accent
        },
        // Primary colors - updated with Dracula theme
        'primary': {
          DEFAULT: 'oklch(75.461% 0.183 346.812)', // --color-primary (pink)
          'dark': 'oklch(39.445% 0.032 275.524)',  // --color-neutral (comment)
          'light': 'oklch(74.202% 0.148 301.883)', // --color-secondary (purple)
          'content': 'oklch(15.092% 0.036 346.812)' // --color-primary-content
        },
        'secondary': {
          DEFAULT: 'oklch(74.202% 0.148 301.883)', // --color-secondary (purple)
          'content': 'oklch(14.84% 0.029 301.883)' // --color-secondary-content
        },
        'accent': {
          DEFAULT: 'oklch(83.392% 0.124 66.558)', // --color-accent (yellow)
          'content': 'oklch(16.678% 0.024 66.558)' // --color-accent-content
        },
        'neutral': {
          DEFAULT: 'oklch(39.445% 0.032 275.524)', // --color-neutral (comment)
          'content': 'oklch(87.889% 0.006 275.524)' // --color-neutral-content
        },
        'info': {
          DEFAULT: 'oklch(88.263% 0.093 212.846)', // --color-info (cyan)
          'content': 'oklch(17.652% 0.018 212.846)' // --color-info-content
        },
        'success': {
          DEFAULT: 'oklch(87.099% 0.219 148.024)', // --color-success (green)
          'content': 'oklch(17.419% 0.043 148.024)' // --color-success-content
        },
        'warning': {
          DEFAULT: 'oklch(95.533% 0.134 112.757)', // --color-warning (orange)
          'content': 'oklch(19.106% 0.026 112.757)' // --color-warning-content
        },
        'error': {
          DEFAULT: 'oklch(68.22% 0.206 24.43)', // --color-error (red)
          'content': 'oklch(13.644% 0.041 24.43)' // --color-error-content
        },
        // Text colors - updated with Dracula theme
        'text': {
          'primary': '#1e293b',    // --text-primary
          'secondary': '#475569',  // --text-secondary
          'muted': '#94a3b8',      // --text-muted
          'inverted': '#f8f8f2'    // Dracula foreground
        },
        // Surface colors - updated with Dracula theme
        'surface': {
          'main': '#ffffff',      // --surface-main
          'secondary': '#f8fafc', // --surface-secondary
          'tertiary': '#f1f5f9',  // --surface-tertiary
          'elevated': '#ffffff',  // --surface-elevated
          'dark': {
            'main': '#282a36',      // Dracula background
            'secondary': '#44475a', // Dracula current line
            'tertiary': '#6272a4',  // Dracula comment
          }
        },
        // Border colors
        'border': {
          'subtle': '#e2e8f0',    // --border-subtle
          'medium': '#cbd5e1',    // --border-medium
          'emphasis': '#94a3b8',   // --border-emphasis
          'dark': {
            'subtle': '#44475a',    // Dracula current line
            'medium': '#6272a4',    // Dracula comment
            'emphasis': '#bd93f9'   // Dracula purple
          }
        },
        // Feedback colors - updated with Dracula theme
        'feedback': {
          'success': '#50fa7b', // Dracula green
          'warning': '#ffb86c', // Dracula orange
          'error': '#ff5555',   // Dracula red
          'info': '#8be9fd'     // Dracula cyan
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
      // Add focus ring styles - updated with Dracula theme
      ringWidth: {
        DEFAULT: '3px', // Default focus ring width from --focus-ring
      },
      ringColor: {
        DEFAULT: 'rgba(37, 99, 235, 0.4)', // Default focus ring color from --focus-ring
        'dark': 'rgba(189, 147, 249, 0.6)', // Dracula purple with opacity
        'pink': 'rgba(255, 121, 198, 0.6)', // Dracula pink with opacity
        'cyan': 'rgba(139, 233, 253, 0.6)', // Dracula cyan with opacity
      },
      ringOpacity: {
        '60': '0.6',
        '40': '0.4',
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
            color: theme('colors.dracula.foreground'),
            a: {
              color: theme('colors.dracula.pink'),
              '&:hover': {
                color: theme('colors.dracula.purple'),
              },
            },
            h1: {
              color: theme('colors.dracula.foreground'),
            },
            h2: {
              color: theme('colors.dracula.foreground'),
            },
            h3: {
              color: theme('colors.dracula.foreground'),
            },
            h4: {
              color: theme('colors.dracula.foreground'),
            },
            strong: {
              color: theme('colors.dracula.orange'),
            },
            code: {
              color: theme('colors.dracula.green'),
              backgroundColor: theme('colors.dracula.current-line'),
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
            pre: {
              backgroundColor: theme('colors.dracula.current-line'),
              color: theme('colors.dracula.foreground'),
            },
            blockquote: {
              color: theme('colors.dracula.comment'),
              borderLeftColor: theme('colors.dracula.purple'),
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

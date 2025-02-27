// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './static/**/*.html',
    './static/**/*.js',
    './templates/**/*.html',
  ],
  safelist: [
    'selection:bg-primary-900/20',
    'selection:bg-primary-100',
    'selection:text-primary-900',
    'selection:text-dracula-foreground',
  ],
  darkMode: 'class', // Use class-based dark mode for explicit control
  theme: {
    extend: {
      // Enable selection variant with opacity modifiers
      opacity: {
        '20': '0.2', // Add explicit 20% opacity if not already defined
        '60': '0.6', // Add 60% opacity for ring utilities
      },
      ringOpacity: {
        '60': '0.6', // Explicitly add ring opacity
      },
      // Consistent color system with Dracula theme
      colors: {
        primary: {
          50:  'oklch(97% 0.03 348)',
          100: 'oklch(94% 0.05 348)',
          200: 'oklch(90% 0.07 348)',
          300: 'oklch(85% 0.10 348)',
          400: 'oklch(80% 0.15 348)',
          500: 'oklch(75% 0.18 347)', // Dracula pink
          600: 'oklch(70% 0.17 346)',
          700: 'oklch(65% 0.16 345)',
          800: 'oklch(60% 0.13 345)',
          900: 'oklch(50% 0.10 345)',
          950: 'oklch(40% 0.08 345)',
        },
        secondary: {
          50:  'oklch(96% 0.03 302)',
          100: 'oklch(92% 0.05 302)',
          200: 'oklch(88% 0.07 302)',
          300: 'oklch(84% 0.09 302)',
          400: 'oklch(80% 0.12 302)',
          500: 'oklch(74% 0.15 302)', // Dracula purple
          600: 'oklch(68% 0.13 301)',
          700: 'oklch(60% 0.12 300)',
          800: 'oklch(50% 0.10 300)',
          900: 'oklch(40% 0.08 300)',
          950: 'oklch(30% 0.06 300)',
        },
        accent: {
          50:  'oklch(98% 0.03 67)',
          100: 'oklch(95% 0.05 67)',
          200: 'oklch(92% 0.07 67)',
          300: 'oklch(88% 0.09 67)',
          400: 'oklch(85% 0.12 67)',
          500: 'oklch(83% 0.12 67)', // Dracula yellow
          600: 'oklch(75% 0.11 66)',
          700: 'oklch(65% 0.10 65)',
          800: 'oklch(55% 0.09 65)',
          900: 'oklch(45% 0.08 65)',
          950: 'oklch(35% 0.06 65)',
        },
        dracula: {
          background: 'oklch(29% 0.02 278)',
          currentLine: 'oklch(27% 0.02 278)',
          selection: 'oklch(39% 0.03 276)',
          foreground: 'oklch(98% 0.01 107)',
          comment: 'oklch(39% 0.03 276)',
          cyan: 'oklch(88% 0.09 213)',
          green: 'oklch(87% 0.22 148)',
          orange: 'oklch(96% 0.13 113)',
          pink: 'oklch(75% 0.18 347)',
          purple: 'oklch(74% 0.15 302)',
          red: 'oklch(68% 0.21 24)',
          yellow: 'oklch(83% 0.12 67)',
        },
        surface: {
          DEFAULT: 'white',
          50: 'white',
          100: 'oklch(98% 0.005 0)',
          200: 'oklch(96% 0.005 0)',
          300: 'oklch(94% 0.005 0)',
          400: 'oklch(92% 0.005 0)',
          500: 'oklch(90% 0.005 0)',
        },
        dark: {
          DEFAULT: 'oklch(29% 0.02 278)', // Dracula background
          50: 'oklch(39% 0.03 276)',       // Dracula selection
          100: 'oklch(37% 0.03 276)',
          200: 'oklch(35% 0.03 276)',
          300: 'oklch(33% 0.03 276)',
          400: 'oklch(31% 0.02 277)',
          500: 'oklch(29% 0.02 278)',     // Dracula background
          600: 'oklch(27% 0.02 277)',     // Dracula current line
          700: 'oklch(25% 0.019 278)',    // Dracula deeper dark
          800: 'oklch(22% 0.019 278)',
          900: 'oklch(18% 0.018 278)',
          950: 'oklch(15% 0.018 278)',
        },
      },
      // Standardized typography scales
      fontFamily: {
        'sans': ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        'mono': ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xs':  ['0.75rem', { lineHeight: '1rem' }],     // 12px
        'sm':  ['0.875rem', { lineHeight: '1.25rem' }], // 14px
        'base': ['1rem', { lineHeight: '1.5rem' }],     // 16px
        'lg':  ['1.125rem', { lineHeight: '1.75rem' }], // 18px
        'xl':  ['1.25rem', { lineHeight: '1.75rem' }],  // 20px
        '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 24px
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],   // 36px
        '5xl': ['3rem', { lineHeight: '1' }],           // 48px
      },
      // Consistent spacing and sizing
      spacing: {
        '4xs': '0.125rem', // 2px
        '3xs': '0.1875rem', // 3px
        '2xs': '0.25rem',  // 4px  
        'xs':  '0.5rem',   // 8px
        'sm':  '0.75rem',  // 12px
        'md':  '1rem',     // 16px
        'lg':  '1.5rem',   // 24px
        'xl':  '2rem',     // 32px
        '2xl': '2.5rem',   // 40px
        '3xl': '3rem',     // 48px
        '4xl': '4rem',     // 64px
      },
      borderRadius: {
        'xs':  '0.125rem', // 2px
        'sm':  '0.25rem',  // 4px
        'md':  '0.375rem', // 6px
        'lg':  '0.5rem',   // 8px
        'xl':  '0.75rem',  // 12px
        '2xl': '1rem',     // 16px
        '3xl': '1.5rem',   // 24px
        '4xl': '2rem',     // 32px
      },
      screens: {
        'xs': '360px',     // Small mobile
        'sm': '640px',     // Mobile
        'md': '768px',     // Tablet
        'lg': '1024px',    // Desktop
        'xl': '1280px',    // Large desktop
        '2xl': '1536px',   // Extra large desktop
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        'inner': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
        'focus': '0 0 0 3px rgba(164, 144, 255, 0.45)',
        'focus-error': '0 0 0 3px rgba(220, 38, 38, 0.35)',
        'dark-focus': '0 0 0 3px rgba(189, 147, 249, 0.45)',
      },
      // Animations
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in forwards',
        'fade-out': 'fadeOut 0.2s ease-out forwards',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'slide-out-right': 'slideOutRight 0.3s ease-in',
        'slide-in-bottom': 'slideInBottom 0.3s ease-out',
        'slide-out-bottom': 'slideOutBottom 0.3s ease-in',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        fadeOut: {
          '0%': { opacity: 1 },
          '100%': { opacity: 0 },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: 0 },
          '100%': { transform: 'translateX(0)', opacity: 1 },
        },
        slideOutRight: {
          '0%': { transform: 'translateX(0)', opacity: 1 },
          '100%': { transform: 'translateX(100%)', opacity: 0 },
        },
        slideInBottom: {
          '0%': { transform: 'translateY(20px)', opacity: 0 },
          '100%': { transform: 'translateY(0)', opacity: 1 },
        },
        slideOutBottom: {
          '0%': { transform: 'translateY(0)', opacity: 1 },
          '100%': { transform: 'translateY(20px)', opacity: 0 },
        },
      },
      // Typography plugin customizations for markdown
      typography: (theme) => ({
        DEFAULT: {
          css: {
            maxWidth: 'none',
            color: theme('colors.gray.900'),
            a: {
              color: theme('colors.primary.600'),
              '&:hover': {
                color: theme('colors.primary.700'),
              },
            },
            code: {
              color: theme('colors.purple.600'),
              backgroundColor: theme('colors.gray.100'),
              borderRadius: theme('borderRadius.sm'),
              padding: `${theme('spacing.2xs')} ${theme('spacing.xs')}`,
              fontWeight: '400',
              fontFamily: theme('fontFamily.mono'),
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
            pre: {
              backgroundColor: theme('colors.gray.100'),
              color: theme('colors.gray.900'),
              borderRadius: theme('borderRadius.md'),
              padding: theme('spacing.md'),
              fontSize: theme('fontSize.sm[0]'),
              fontFamily: theme('fontFamily.mono'),
              fontWeight: '400',
              lineHeight: '1.6',
              overflowX: 'auto',
            },
            'pre code': {
              backgroundColor: 'transparent',
              color: 'inherit',
              fontSize: 'inherit',
              fontWeight: 'inherit',
              lineHeight: 'inherit',
              padding: '0',
            },
            blockquote: {
              color: theme('colors.gray.600'),
              borderLeftColor: theme('colors.gray.300'),
              fontStyle: 'normal',
            },
            // More additions to typography plugin...
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
            strong: {
              color: theme('colors.dracula.orange'),
            },
            h1: { color: theme('colors.dracula.foreground') },
            h2: { color: theme('colors.dracula.foreground') },
            h3: { color: theme('colors.dracula.foreground') },
            h4: { color: theme('colors.dracula.foreground') },
            h5: { color: theme('colors.dracula.foreground') },
            h6: { color: theme('colors.dracula.foreground') },
            code: {
              color: theme('colors.dracula.green'),
              backgroundColor: theme('colors.dracula.currentLine'),
            },
            pre: {
              backgroundColor: theme('colors.dracula.currentLine'),
              color: theme('colors.dracula.foreground'),
            },
            blockquote: {
              color: theme('colors.dracula.comment'),
              borderLeftColor: theme('colors.dracula.purple'),
            },
            // More dark mode typography overrides...
          },
        },
      }),
    },
  },
  // Core plugin configurations
  corePlugins: {
    // Ensure selection variant is enabled
    selection: true,
  },
  // Configure variants
  variants: {
    extend: {
      // Enable opacity modifiers for selection variant
      backgroundColor: ['selection'],
      textColor: ['selection'],
    },
  },
  // Plugin configurations
  plugins: [
    require('@tailwindcss/typography'), // For markdown content styling
    require('@tailwindcss/forms'),      // For form input styling
    function({ addVariant, matchUtilities, theme }) {
      // Add selection variant with opacity support
      addVariant('selection', ['&::selection', '&::-moz-selection']);
      
      // Add explicit support for opacity modifiers with selection variant
      matchUtilities(
        {
          'selection-bg': (value) => ({
            '&::selection': { backgroundColor: value },
            '&::-moz-selection': { backgroundColor: value },
          }),
          'selection-text': (value) => ({
            '&::selection': { color: value },
            '&::-moz-selection': { color: value },
          }),
        },
        { values: theme('colors') }
      );
    },
    function({ addComponents, theme }) {
      // Add consistent component classes
      addComponents({
        // Button components
        '.btn': {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme('borderRadius.md'),
          padding: `${theme('spacing.xs')} ${theme('spacing.md')}`,
          fontSize: theme('fontSize.sm[0]'),
          fontWeight: '500',
          transition: 'all 0.2s',
          cursor: 'pointer',
          '&:focus': {
            outline: 'none',
            boxShadow: theme('boxShadow.focus'),
          },
          '&:disabled': {
            opacity: '0.65',
            cursor: 'not-allowed',
          },
        },
        '.btn-primary': {
          backgroundColor: theme('colors.primary.600'),
          color: 'white',
          '&:hover:not(:disabled)': {
            backgroundColor: theme('colors.primary.700'),
          },
          '&:active:not(:disabled)': {
            backgroundColor: theme('colors.primary.800'),
          },
        },
        '.btn-secondary': {
          backgroundColor: theme('colors.gray.100'),
          color: theme('colors.gray.800'),
          '.dark &': {
            backgroundColor: theme('colors.dark.600'),
            color: theme('colors.gray.200'),
          },
          '&:hover:not(:disabled)': {
            backgroundColor: theme('colors.gray.200'),
            '.dark &': {
              backgroundColor: theme('colors.dark.500'),
            },
          },
          '&:active:not(:disabled)': {
            backgroundColor: theme('colors.gray.300'),
            '.dark &': {
              backgroundColor: theme('colors.dark.400'),
            },
          },
        },
        '.btn-danger': {
          backgroundColor: theme('colors.red.600'),
          color: 'white',
          '&:hover:not(:disabled)': {
            backgroundColor: theme('colors.red.700'),
          },
          '&:active:not(:disabled)': {
            backgroundColor: theme('colors.red.800'),
          },
        },
        '.btn-success': {
          backgroundColor: theme('colors.green.600'),
          color: 'white',
          '&:hover:not(:disabled)': {
            backgroundColor: theme('colors.green.700'),
          },
          '&:active:not(:disabled)': {
            backgroundColor: theme('colors.green.800'),
          },
        },
        '.btn-icon': {
          padding: theme('spacing.xs'),
          minHeight: theme('spacing.lg'),
          minWidth: theme('spacing.lg'),
        },
        // Form components
        '.form-input': {
          appearance: 'none',
          borderWidth: '1px',
          borderColor: theme('colors.gray.300'),
          borderRadius: theme('borderRadius.md'),
          padding: `${theme('spacing.xs')} ${theme('spacing.sm')}`,
          fontSize: theme('fontSize.base'),
          lineHeight: theme('lineHeight.normal'),
          color: theme('colors.gray.700'),
          backgroundColor: 'white',
          minHeight: '2.75rem',
          '&:focus': {
            outline: 'none',
            borderColor: theme('colors.primary.400'),
            boxShadow: theme('boxShadow.focus'),
          },
          '&:disabled': {
            backgroundColor: theme('colors.gray.100'),
            opacity: '0.65',
          },
          '&::placeholder': {
            color: theme('colors.gray.400'),
            opacity: '1',
          },
          '.dark &': {
            borderColor: theme('colors.dark.400'),
            backgroundColor: theme('colors.dark.700'),
            color: 'white',
            '&:focus': {
              borderColor: theme('colors.primary.500'),
              boxShadow: theme('boxShadow.dark-focus'),
            },
            '&:disabled': {
              backgroundColor: theme('colors.dark.600'),
            },
            '&::placeholder': {
              color: theme('colors.gray.500'),
            },
          },
        },
        '.form-label': {
          display: 'block',
          marginBottom: theme('spacing.xs'),
          fontSize: theme('fontSize.sm[0]'),
          fontWeight: '500',
          color: theme('colors.gray.700'),
          '.dark &': {
            color: theme('colors.gray.300'),
          },
        },
        // Card components
        '.card': {
          backgroundColor: 'white',
          borderRadius: theme('borderRadius.lg'),
          boxShadow: theme('boxShadow.md'),
          overflow: 'hidden',
          '.dark &': {
            backgroundColor: theme('colors.dark.600'),
          },
        },
        '.card-header': {
          padding: theme('spacing.md'),
          borderBottom: `1px solid ${theme('colors.gray.200')}`,
          '.dark &': {
            borderColor: theme('colors.dark.400'),
          },
        },
        '.card-body': {
          padding: theme('spacing.md'),
        },
        '.card-footer': {
          padding: theme('spacing.md'),
          borderTop: `1px solid ${theme('colors.gray.200')}`,
          '.dark &': {
            borderColor: theme('colors.dark.400'),
          },
        },
        // Alert/notification components
        '.alert': {
          position: 'relative',
          padding: theme('spacing.md'),
          marginBottom: theme('spacing.md'),
          borderWidth: '1px',
          borderRadius: theme('borderRadius.md'),
        },
        '.alert-info': {
          backgroundColor: theme('colors.blue.50'),
          borderColor: theme('colors.blue.200'),
          color: theme('colors.blue.800'),
          '.dark &': {
            backgroundColor: 'rgba(3, 105, 161, 0.2)',
            borderColor: theme('colors.blue.800'),
            color: theme('colors.blue.200'),
          },
        },
        '.alert-success': {
          backgroundColor: theme('colors.green.50'),
          borderColor: theme('colors.green.200'),
          color: theme('colors.green.800'),
          '.dark &': {
            backgroundColor: 'rgba(21, 128, 61, 0.2)',
            borderColor: theme('colors.green.800'),
            color: theme('colors.green.200'),
          },
        },
        '.alert-warning': {
          backgroundColor: theme('colors.yellow.50'),
          borderColor: theme('colors.yellow.200'),
          color: theme('colors.yellow.800'),
          '.dark &': {
            backgroundColor: 'rgba(161, 98, 7, 0.2)',
            borderColor: theme('colors.yellow.800'),
            color: theme('colors.yellow.200'),
          },
        },
        '.alert-danger': {
          backgroundColor: theme('colors.red.50'),
          borderColor: theme('colors.red.200'),
          color: theme('colors.red.800'),
          '.dark &': {
            backgroundColor: 'rgba(185, 28, 28, 0.2)',
            borderColor: theme('colors.red.800'),
            color: theme('colors.red.200'),
          },
        },
        // Toast notifications
        '.toast': {
          position: 'fixed',
          borderRadius: theme('borderRadius.md'),
          padding: theme('spacing.md'),
          boxShadow: theme('boxShadow.lg'),
          maxWidth: '24rem',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
        },
        // Chat message components
        '.message-user': {
          borderRadius: theme('borderRadius.xl'),
          borderBottomRightRadius: theme('borderRadius.sm'),
          backgroundColor: theme('colors.primary.500'),
          color: 'white',
          padding: theme('spacing.md'),
          maxWidth: '85%',
          marginLeft: 'auto',
          marginRight: theme('spacing.md'),
          marginBottom: theme('spacing.md'),
          boxShadow: theme('boxShadow.md'),
        },
        '.message-assistant': {
          borderRadius: theme('borderRadius.xl'),
          borderBottomLeftRadius: theme('borderRadius.sm'),
          backgroundColor: 'white',
          color: theme('colors.gray.800'),
          padding: theme('spacing.md'),
          maxWidth: '85%',
          marginRight: 'auto',
          marginLeft: theme('spacing.md'),
          marginBottom: theme('spacing.md'),
          boxShadow: theme('boxShadow.md'),
          '.dark &': {
            backgroundColor: theme('colors.dark.600'),
            color: 'white',
          },
        },
        '.message-thinking': {
          borderRadius: theme('borderRadius.xl'),
          borderBottomLeftRadius: theme('borderRadius.sm'),
          backgroundColor: theme('colors.blue.50'),
          color: theme('colors.gray.800'),
          padding: theme('spacing.md'),
          maxWidth: '85%',
          marginRight: 'auto',
          marginLeft: theme('spacing.md'),
          marginBottom: theme('spacing.md'),
          boxShadow: theme('boxShadow.md'),
          '.dark &': {
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            color: 'white',
          },
        },
        '.message-system': {
          borderRadius: theme('borderRadius.md'),
          backgroundColor: theme('colors.yellow.50'),
          color: theme('colors.yellow.800'),
          padding: theme('spacing.md'),
          maxWidth: '90%',
          margin: `${theme('spacing.md')} auto`,
          borderLeftWidth: '4px',
          borderColor: theme('colors.yellow.400'),
          '.dark &': {
            backgroundColor: 'rgba(202, 138, 4, 0.15)',
            color: theme('colors.yellow.200'),
            borderColor: theme('colors.yellow.600'),
          },
        },
        // Modal component
        '.modal-overlay': {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme('spacing.md'),
        },
        '.modal': {
          backgroundColor: 'white',
          borderRadius: theme('borderRadius.lg'),
          boxShadow: theme('boxShadow.xl'),
          maxWidth: '500px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          zIndex: 50,
          '.dark &': {
            backgroundColor: theme('colors.dark.600'),
          },
        },
        '.modal-header': {
          padding: theme('spacing.md'),
          borderBottom: `1px solid ${theme('colors.gray.200')}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          '.dark &': {
            borderColor: theme('colors.dark.400'),
          },
        },
        '.modal-body': {
          padding: theme('spacing.md'),
        },
        '.modal-footer': {
          padding: theme('spacing.md'),
          borderTop: `1px solid ${theme('colors.gray.200')}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: theme('spacing.sm'),
          '.dark &': {
            borderColor: theme('colors.dark.400'),
          },
        },
      });
    },
    function({ addUtilities, theme }) {
      // Add consistent touch utilities
      addUtilities({
        '.touch-target': {
          minHeight: '44px',
          minWidth: '44px',
        },
        '.touch-action-none': {
          touchAction: 'none',
        },
        '.touch-action-manipulation': {
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        },
        '.focus-visible-ring': {
          '&:focus-visible': {
            outline: 'none',
            boxShadow: theme('boxShadow.focus'),
          },
        },
        '.focus-visible-ring-danger': {
          '&:focus-visible': {
            outline: 'none',
            boxShadow: theme('boxShadow.focus-error'),
          },
        },
        '.sr-only': {
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: '0',
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          borderWidth: '0',
        },
        '.sr-only-focusable': {
          '&:not(:focus)': {
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: '0',
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            borderWidth: '0',
          },
        },
      });
    },
  ],
};

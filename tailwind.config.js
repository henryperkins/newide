/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./static/**/*.{html,js}",
    "./templates/**/*.{html,py}",  // If you have a templates directory
    // More specific patterns instead of the broad "./**/*.{html,js,py}"
    "./*.{html,py}" // For files in the root directory
  ],
  safelist: [
    // Add specific ring utilities that might be used dynamically
    'ring-primary-500/60',
    'ring-primary-400/60',
    'focus:ring-primary-500',
    'focus:ring-primary-500/60',
    'focus:ring-2',
    'ring-2',
  ],
  darkMode: 'class', // Consistent dark mode approach
  theme: {
    extend: {
      colors: {
        // Define primary design system colors with proper naming
        'thinking-border': 'oklch(76% 0.12 276)',
        'thinking-bg': 'oklch(97% 0.01 276)',
        primary: {
          50: 'oklch(97% 0.029 276)',
          100: 'oklch(94% 0.048 276)',
          200: 'oklch(89% 0.078 276)',
          300: 'oklch(83% 0.107 276)',
          400: 'oklch(76% 0.126 276)',
          500: 'oklch(68% 0.140 276)', // Base primary color
          600: 'oklch(60% 0.135 276)',
          700: 'oklch(52% 0.130 276)',
          800: 'oklch(44% 0.118 276)',
          900: 'oklch(36% 0.095 276)',
          950: 'oklch(28% 0.075 276)',
        },
        // Secondary accent color
        secondary: {
          50: 'oklch(97% 0.029 333)',
          100: 'oklch(94% 0.048 333)',
          200: 'oklch(89% 0.078 333)',
          300: 'oklch(83% 0.107 333)',
          400: 'oklch(76% 0.126 333)',
          500: 'oklch(68% 0.140 333)', // Base secondary color
          600: 'oklch(60% 0.135 333)',
          700: 'oklch(52% 0.130 333)',
          800: 'oklch(44% 0.118 333)',
          900: 'oklch(36% 0.095 333)',
          950: 'oklch(28% 0.075 333)',
        },
        // Neutral colors for text and backgrounds
        dark: {
          50: 'oklch(98% 0.005 276)',
          100: 'oklch(95% 0.008 276)',
          200: 'oklch(86% 0.010 276)',
          300: 'oklch(76% 0.012 276)',
          400: 'oklch(67% 0.015 276)',
          500: 'oklch(54% 0.018 276)',
          600: 'oklch(42% 0.019 276)',
          700: 'oklch(32% 0.020 276)',
          800: 'oklch(24% 0.018 276)',
          900: 'oklch(18% 0.014 276)',
          950: 'oklch(13% 0.010 276)',
        },
        // Consistent semantic colors
        success: {
          50: 'oklch(96% 0.05 145)',
          100: 'oklch(93% 0.08 145)',
          500: 'oklch(65% 0.22 145)',
          700: 'oklch(45% 0.18 145)',
          900: 'oklch(33% 0.12 145)',
        },
        warning: {
          50: 'oklch(97% 0.05 85)',
          100: 'oklch(94% 0.08 85)',
          500: 'oklch(75% 0.20 85)',
          700: 'oklch(60% 0.18 85)',
          900: 'oklch(40% 0.12 85)',
        },
        error: {
          50: 'oklch(97% 0.05 30)',
          100: 'oklch(94% 0.08 30)',
          500: 'oklch(65% 0.25 30)',
          700: 'oklch(50% 0.22 30)',
          900: 'oklch(35% 0.15 30)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        // Ensure consistent typographic scale
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
      },
      spacing: {
        // Ensure consistent spacing
        '0': '0',
        '1': '0.25rem',
        '2': '0.5rem',
        '3': '0.75rem',
        '4': '1rem',
        '5': '1.25rem',
        '6': '1.5rem',
        '8': '2rem',
        '10': '2.5rem',
        '12': '3rem',
        '16': '4rem',
        '20': '5rem',
        '24': '6rem',
        '32': '8rem',
        '40': '10rem',
        '48': '12rem',
        '56': '14rem',
        '64': '16rem',
      },
      animation: {
        'spin': 'spin 1s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'fade-out': 'fadeOut 0.3s ease-in-out',
        'slide-in-right': 'slideInRight 0.3s ease-in-out',
        'slide-out-right': 'slideOutRight 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        slideOutRight: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      boxShadow: {
        sm: '0 1px 2px 0 oklch(0% 0 0 / 0.05)',
        DEFAULT: '0 1px 3px 0 oklch(0% 0 0 / 0.1), 0 1px 2px -1px oklch(0% 0 0 / 0.1)',
        md: '0 4px 6px -1px oklch(0% 0 0 / 0.1), 0 2px 4px -2px oklch(0% 0 0 / 0.1)',
        lg: '0 10px 15px -3px oklch(0% 0 0 / 0.1), 0 4px 6px -4px oklch(0% 0 0 / 0.1)',
        xl: '0 20px 25px -5px oklch(0% 0 0 / 0.1), 0 8px 10px -6px oklch(0% 0 0 / 0.1)',
      },
      borderRadius: {
        'sm': '0.125rem',
        DEFAULT: '0.25rem',
        'md': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
        'full': '9999px',
      },
    },
  },
  // Component extraction for consistent UI elements
  plugins: [
    function({ addComponents }) {
      addComponents({
        '.btn': {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: '500',
          fontSize: '0.875rem',
          padding: '0.5rem 1rem',
          borderRadius: '0.375rem',
          transition: 'all 150ms ease-in-out',
          cursor: 'pointer',
          '&:focus-visible': {
            outline: '2px solid oklch(68% 0.14 276)',
            outlineOffset: '2px',
          },
          '&:disabled': {
            opacity: '0.65',
            pointerEvents: 'none',
          },
        },
        '.btn-primary': {
          backgroundColor: 'oklch(68% 0.14 276)',
          color: 'white',
          '&:hover:not(:disabled)': {
            backgroundColor: 'oklch(60% 0.135 276)',
          },
          '&:active:not(:disabled)': {
            backgroundColor: 'oklch(52% 0.13 276)',
          },
        },
        '.btn-secondary': {
          backgroundColor: 'oklch(95% 0.008 276)',
          color: 'oklch(42% 0.019 276)',
          border: '1px solid oklch(86% 0.01 276)',
          '.dark &': {
            backgroundColor: 'oklch(32% 0.02 276)',
            color: 'oklch(95% 0.008 276)',
            border: '1px solid oklch(42% 0.019 276)',
          },
          '&:hover:not(:disabled)': {
            backgroundColor: 'oklch(90% 0.01 276)',
            '.dark &': {
              backgroundColor: 'oklch(36% 0.022 276)',
            },
          },
          '&:active:not(:disabled)': {
            backgroundColor: 'oklch(86% 0.012 276)',
            '.dark &': {
              backgroundColor: 'oklch(42% 0.024 276)',
            },
          },
        },
        '.btn-danger': {
          backgroundColor: 'oklch(65% 0.25 30)',
          color: 'white',
          '&:hover:not(:disabled)': {
            backgroundColor: 'oklch(58% 0.23 30)',
          },
          '&:active:not(:disabled)': {
            backgroundColor: 'oklch(50% 0.22 30)',
          },
        },
        '.btn-icon': {
          padding: '0.5rem',
          borderRadius: '0.375rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
        '.form-label': {
          display: 'block',
          marginBottom: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: '500',
          color: 'oklch(42% 0.019 276)',
          '.dark &': {
            color: 'oklch(86% 0.01 276)',
          },
        },
        '.form-input': {
          width: '100%',
          padding: '0.625rem 0.75rem',
          fontSize: '0.875rem',
          lineHeight: '1.25rem',
          backgroundColor: 'white',
          color: 'oklch(32% 0.02 276)',
          borderRadius: '0.375rem',
          border: '1px solid oklch(76% 0.012 276)',
          boxShadow: '0 1px 2px 0 oklch(0% 0 0 / 0.05)',
          transition: 'border-color 150ms ease-in-out, box-shadow 150ms ease-in-out',
          '.dark &': {
            backgroundColor: 'oklch(24% 0.018 276)',
            color: 'oklch(95% 0.008 276)',
            border: '1px solid oklch(42% 0.019 276)',
          },
          '&:focus': {
            outline: 'none',
            borderColor: 'oklch(68% 0.14 276)',
            boxShadow: '0 0 0 3px oklch(68% 0.14 276 / 0.25)',
          },
          '&:disabled': {
            backgroundColor: 'oklch(95% 0.008 276)',
            cursor: 'not-allowed',
            '.dark &': {
              backgroundColor: 'oklch(36% 0.022 276)',
            },
          },
        },
        '.touch-target': {
          minHeight: '44px',
          minWidth: '44px',
        },
        '.card': {
          backgroundColor: 'white',
          borderRadius: '0.5rem',
          boxShadow: '0 1px 3px 0 oklch(0% 0 0 / 0.1), 0 1px 2px -1px oklch(0% 0 0 / 0.1)',
          overflow: 'hidden',
          '.dark &': {
            backgroundColor: 'oklch(24% 0.018 276)',
          },
        },
        '.notification': {
          backgroundColor: 'white',
          borderRadius: '0.5rem',
          boxShadow: '0 4px 6px -1px oklch(0% 0 0 / 0.1), 0 2px 4px -2px oklch(0% 0 0 / 0.1)',
          padding: '1rem',
          marginBottom: '0.5rem',
          display: 'flex',
          alignItems: 'flex-start',
          width: '100%',
          maxWidth: '28rem',
          pointer: 'auto',
          '.dark &': {
            backgroundColor: 'oklch(24% 0.018 276)',
          },
        },
        '.message': {
          padding: '1rem',
          borderRadius: '0.75rem',
          marginBottom: '1rem',
          maxWidth: '80%',
          position: 'relative',
          '.dark &': {
            color: 'oklch(95% 0.008 276)',
          },
          '&.user-message': {
            backgroundColor: 'oklch(68% 0.14 276)',
            color: 'white',
            alignSelf: 'flex-end',
            marginLeft: 'auto',
          },
          '&.assistant-message': {
            backgroundColor: 'oklch(95% 0.008 276)',
            color: 'oklch(32% 0.02 276)',
            alignSelf: 'flex-start',
            marginRight: 'auto',
            '.dark &': {
              backgroundColor: 'oklch(32% 0.02 276)',
              color: 'oklch(95% 0.008 276)',
            },
          },
          '&.system-message': {
            backgroundColor: 'oklch(94% 0.08 85)',
            color: 'oklch(40% 0.12 85)',
            width: '100%',
            maxWidth: '36rem',
            margin: '0 auto 1rem auto',
            '.dark &': {
              backgroundColor: 'oklch(40% 0.12 85 / 0.2)',
              color: 'oklch(94% 0.08 85)',
            },
          },
        },
        '.mobile-text-optimized': {
          '@media (max-width: 640px)': {
            fontSize: '16px',
          },
        },
        '.safe-area-inset-bottom': {
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        },
        '.token-usage': {
          padding: '0.75rem',
          fontSize: '0.75rem',
          borderTop: '1px solid oklch(86% 0.01 276)',
          backgroundColor: 'oklch(98% 0.005 276)',
          transition: 'all 0.3s ease',
          overflow: 'hidden',
          '.dark &': {
            backgroundColor: 'oklch(24% 0.018 276)',
            borderTop: '1px solid oklch(42% 0.019 276)',
          },
        },
        '.token-summary': {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        },
        '.token-label': {
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          color: 'oklch(54% 0.018 276)',
          '.dark &': {
            color: 'oklch(76% 0.012 276)',
          },
        },
        '.token-value': {
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: '500',
          color: 'oklch(42% 0.019 276)',
          '.dark &': {
            color: 'oklch(86% 0.01 276)',
          },
        },
        '.thinking-process': {
          margin: '1rem 0',
          border: '1px solid oklch(86% 0.01 276)',
          borderRadius: '0.375rem',
          overflow: 'hidden',
          '.dark &': {
            border: '1px solid oklch(42% 0.019 276)',
          },
          position: 'relative',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
          transition: 'all 0.2s ease-in-out'
        },
        '.thinking-header': {
          backgroundColor: 'oklch(94% 0.048 276 / 0.2)',
          padding: '0.5rem 1rem',
          borderTopLeftRadius: '0.375rem',
          borderTopRightRadius: '0.375rem',
          '.dark &': {
            backgroundColor: 'oklch(60% 0.135 276 / 0.2)',
          },
          padding: '0.5rem 0.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        },
        '.thinking-toggle': {
          fontWeight: '500',
          color: 'oklch(60% 0.135 276)',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          '.dark &': {
            color: 'oklch(76% 0.126 276)',
          },
          display: 'flex',
          justifyContent: 'space-between',
          userSelect: 'none',
          transition: 'color 0.2s ease-in-out'
        },
        '.thinking-content': {
          backgroundColor: 'oklch(97% 0.029 276 / 0.2)',
          padding: '1rem',
          overflowX: 'auto',
          borderBottomLeftRadius: '0.375rem',
          borderBottomRightRadius: '0.375rem',
          '.dark &': {
            backgroundColor: 'oklch(52% 0.13 276 / 0.1)',
          },
          position: 'relative',
          transition: 'all 0.3s ease-in-out'
        },
        '.thinking-pre': {
          margin: '0',
          whiteSpace: 'pre-wrap',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.875rem',
          color: 'oklch(42% 0.019 276)',
          '.dark &': {
            color: 'oklch(86% 0.01 276)',
          },
          fontFamily: 'monospace',
          overflowY: 'auto',
          maxHeight: '300px',
          padding: '0.75rem 1rem'
        },
        '.thinking-gradient': {
          position: 'absolute',
          bottom: '0',
          left: '0',
          right: '0',
          height: '2.5rem',
          background: 'linear-gradient(to top, var(--tw-gradient-stops))',
          pointerEvents: 'none'
        },
      });
    },
    // Add new plugin for ring opacity support
    function({ addUtilities, theme }) {
      const colors = theme('colors');
      const opacities = theme('opacity', {
        '0': '0',
        '5': '0.05',
        '10': '0.1',
        '20': '0.2',
        '25': '0.25',
        '30': '0.3',
        '40': '0.4',
        '50': '0.5',
        '60': '0.6',
        '70': '0.7',
        '75': '0.75',
        '80': '0.8',
        '90': '0.9',
        '95': '0.95',
        '100': '1',
      });
      
      // Generate custom ring utilities with opacity modifiers for OKLCH colors
      const ringOpacityUtilities = {};
      
      // Loop through colors and create ring utilities with opacity variants
      Object.entries(colors).forEach(([colorName, colorValues]) => {
        if (typeof colorValues === 'object') {
          Object.entries(colorValues).forEach(([shade, value]) => {
            // Only process OKLCH colors
            if (typeof value === 'string' && value.includes('oklch')) {
              Object.entries(opacities).forEach(([opKey, opValue]) => {
                // Create the utility with opacity modifier
                ringOpacityUtilities[`.ring-${colorName}-${shade}\\/${opKey}`] = {
                  '--tw-ring-color': `${value.replace(')', '')} / ${opValue})`,
                };
                
                // Also add focus variants
                ringOpacityUtilities[`.focus\\:ring-${colorName}-${shade}\\/${opKey}:focus`] = {
                  '--tw-ring-color': `${value.replace(')', '')} / ${opValue})`,
                };
              });
            }
          });
        }
      });
      
      addUtilities(ringOpacityUtilities);
    },
  ],
};

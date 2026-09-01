/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        matrix: {
          // ── Base layers (deepened + layered for real glass depth —
          //    was a single flat #020408; a premium dark UI needs at
          //    least 3 visually distinct depth steps: page < card < raised) ──
          black:  '#05070D',   // page background — was #020408
          dark:   '#0A121F',   // sidebar / recessed surfaces — was #040C14
          panel:  '#101B2E',   // card surface (glass base) — was #071220
          raised: '#16233A',   // hover/raised state, thead — new token
          border: '#1E2E48',   // was #0D2137 — brighter for real definition
          muted:  '#16263D',   // was #0F2940
          // ── Accents — unchanged, this is the brand signature ──
          cyan:   '#00D4FF',
          blue:   '#0066FF',
          green:  '#00FF88',
          amber:  '#FFB800',
          red:    '#FF2D55',
          purple: '#9B5DE5',
          // ── Text ──
          text:   '#DCEEFA',   // was #C8E6F5 — slightly brighter for legibility
          subtle: '#6E93B8',   // was #4A7A9B — THE fix for sidebar/table contrast;
                                // old value was too close to background to read as
                                // "inactive but present" vs. "invisible"
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'monospace'],
        body:    ['var(--font-body)', 'sans-serif'],
        mono:    ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        'neon-cyan':  '0 0 20px rgba(0,212,255,0.4), 0 0 60px rgba(0,212,255,0.1)',
        'neon-green': '0 0 20px rgba(0,255,136,0.4), 0 0 60px rgba(0,255,136,0.1)',
        'neon-red':   '0 0 20px rgba(255,45,85,0.4),  0 0 60px rgba(255,45,85,0.1)',
        'neon-amber': '0 0 20px rgba(255,184,0,0.4),  0 0 60px rgba(255,184,0,0.1)',
        'panel':      '0 4px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(0,212,255,0.08)',
        // ── New: soft ambient depth shadow for glass cards — replaces the
        //    harsh single black shadow with a diffused, multi-layer one
        //    (the visual signature of "premium" over "flat dark theme") ──
        'glass':      '0 8px 32px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04) inset, 0 0 0 1px rgba(255,255,255,0.02) inset',
        'glass-hover':'0 12px 48px rgba(0,0,0,0.55), 0 0 24px rgba(0,212,255,0.08), 0 1px 0 rgba(255,255,255,0.06) inset',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4,0,0.6,1) infinite',
        'scan-line':  'scanLine 8s linear infinite',
        'fade-in-up': 'fadeInUp 0.5s ease-out forwards',
        'spin-slow':  'spin 3s linear infinite',
      },
      keyframes: {
        scanLine: {
          '0%':   { transform: 'translateY(-100vh)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        fadeInUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      borderRadius: { panel: '12px' },
    },
  },
  plugins: [],
};

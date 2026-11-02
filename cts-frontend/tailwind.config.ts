import type { Config } from 'tailwindcss'

const v = (name: string) => `var(--${name})`

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Design tokens (values live in app/globals.css, light + dark)
      colors: {
        paper: v('paper'),
        surface: v('surface'),
        sunken: v('sunken'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        line: v('line'),
        'line-strong': v('line-strong'),
        accent: v('accent'),
        'accent-strong': v('accent-strong'),
        'accent-soft': v('accent-soft'),
        'on-accent': v('on-accent'),
        'chart-a': v('chart-a'),
        'chart-b': v('chart-b'),
        attention: v('attention'),
        'attention-soft': v('attention-soft'),
        danger: v('danger'),
        'danger-soft': v('danger-soft'),
        ok: v('ok'),
        'ok-soft': v('ok-soft'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config

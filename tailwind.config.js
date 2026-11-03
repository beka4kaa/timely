/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ['var(--font-onest)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  			serif: ['var(--font-literata)', 'Georgia', 'Times New Roman', 'serif'],
  			onest: ['var(--font-onest)', 'sans-serif'],
  			handwriting: ['var(--font-handwriting)', 'cursive'],
  			virgil: ['var(--font-handwriting)', 'cursive'],
  		},
  		colors: {
  			// Палитра Timely — значения в globals.css (--tm-*), тёмная тема там же.
  			tm: {
  				'bg': 'rgb(var(--tm-bg) / <alpha-value>)',
  				'surface': 'rgb(var(--tm-surface) / <alpha-value>)',
  				'surface-2': 'rgb(var(--tm-surface-2) / <alpha-value>)',
  				'surface-3': 'rgb(var(--tm-surface-3) / <alpha-value>)',
  				'line': 'rgb(var(--tm-line) / <alpha-value>)',
  				'line-strong': 'rgb(var(--tm-line-strong) / <alpha-value>)',
  				'ink': 'rgb(var(--tm-ink) / <alpha-value>)',
  				'ink-2': 'rgb(var(--tm-ink-2) / <alpha-value>)',
  				'muted': 'rgb(var(--tm-muted) / <alpha-value>)',
  				'faint': 'rgb(var(--tm-faint) / <alpha-value>)',
  				'strong': 'rgb(var(--tm-strong) / <alpha-value>)',
  				'on-strong': 'rgb(var(--tm-on-strong) / <alpha-value>)',
  				'accent': 'rgb(var(--tm-accent) / <alpha-value>)',
  				'accent-soft': 'rgb(var(--tm-accent-soft) / <alpha-value>)',
  				'accent-line': 'rgb(var(--tm-accent-line) / <alpha-value>)',
  				'pink': 'rgb(var(--tm-pink) / <alpha-value>)',
  				'lilac': 'rgb(var(--tm-lilac) / <alpha-value>)',
  				'sky': 'rgb(var(--tm-sky) / <alpha-value>)',
  				'mint': 'rgb(var(--tm-mint) / <alpha-value>)',
  				'pink-ink': 'rgb(var(--tm-pink-ink) / <alpha-value>)',
  				'lilac-ink': 'rgb(var(--tm-lilac-ink) / <alpha-value>)',
  				'sky-ink': 'rgb(var(--tm-sky-ink) / <alpha-value>)',
  				'mint-ink': 'rgb(var(--tm-mint-ink) / <alpha-value>)',
  				'warn': 'rgb(var(--tm-warn) / <alpha-value>)',
  				'danger': 'rgb(var(--tm-danger) / <alpha-value>)',
  				'danger-soft': 'rgb(var(--tm-danger-soft) / <alpha-value>)',
  				'danger-line': 'rgb(var(--tm-danger-line) / <alpha-value>)',
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [
    require("tailwindcss-animate"),
    // Запросы по ширине КОНТЕЙНЕРА, а не окна. Панель вопросов съедает часть
    // экрана, и медиа-запрос на широком мониторе с растянутой панелью
    // по-прежнему считал бы место просторным.
    require("@tailwindcss/container-queries"),
  ],
}
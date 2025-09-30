b# Time Schedule Platform

A simple, minimalistic time management platform built with Next.js, TypeScript, and Tailwind CSS. Features clean design with shadcn/ui components for a focused user experience.

## 🚀 Features

- **Minimalistic Design**: Clean, simple interface focused on usability
- **Modern Tech Stack**: Built with Next.js 14, TypeScript, and Tailwind CSS  
- **shadcn/ui Integration**: Beautiful components with dashboard-01 template
- **Responsive Design**: Works perfectly on all devices
- **Simple Navigation**: Easy-to-use interface with clear structure

## 🛠️ Technologies Used

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React
- **Build Tool**: Next.js built-in bundler

## 📦 Components Library

This project includes a comprehensive set of shadcn/ui components:

- **Layout**: Cards, Badges, Avatar
- **Forms**: Input, Label, Textarea, Select
- **Navigation**: Tabs, Navigation Menu
- **Feedback**: Dialog, Progress, Button variants
- **Data Display**: Tables, Lists, Progress indicators

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- npm, yarn, or pnpm

### Installation

1. Clone the repository or use this template
2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── components/         # Components showcase page
│   ├── dashboard/          # Dashboard page
│   ├── globals.css         # Global styles
│   ├── layout.tsx          # Root layout
│   └── page.tsx           # Homepage
├── components/
│   └── ui/                # shadcn/ui components
└── lib/
    └── utils.ts           # Utility functions
```

## 🎨 Pages Overview

### Homepage (`/`)
- Simple hero section with clear messaging
- Minimal feature showcase
- Clean white background with focused content

### Dashboard (`/dashboard`)
- Modern dashboard using shadcn/ui dashboard-01 template
- Sidebar navigation with interactive components
- Data visualization and analytics
- Clean, organized layout

### Components (`/components`)
- Simple showcase of core UI components
- Clean examples of buttons, cards, forms, and badges
- Minimalistic presentation focused on functionality

## 🔧 Customization

### Adding New Components

1. Install additional shadcn/ui components:
   ```bash
   npx shadcn@latest add [component-name]
   ```

2. Import and use in your pages:
   ```typescript
   import { ComponentName } from '@/components/ui/component-name'
   ```

### Styling

- Tailwind CSS classes for styling
- CSS variables for theming (in `globals.css`)
- shadcn/ui design system for consistency

### Configuration

- `tailwind.config.js` - Tailwind CSS configuration
- `components.json` - shadcn/ui configuration
- `next.config.js` - Next.js configuration

## 🚀 Deployment

This project can be deployed on various platforms:

- **Vercel** (recommended for Next.js)
- **Netlify**
- **Railway**
- **DigitalOcean App Platform**

Build the project and deploy the `.next` output directory.

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

If you need help or have questions, please open an issue in the repository.

---

Built with ❤️ using Next.js, TypeScript, Tailwind CSS, and shadcn/ui.
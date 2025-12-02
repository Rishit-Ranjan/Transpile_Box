# Transpile Box

transpile_box is a small React + Vite starter focused on fast iteration and simple tooling. It comes preconfigured with React 19, Vite, Tailwind CSS support and ESLint so you can prototype UI ideas quickly.

**Tech stack:** `React 19`, `Vite`, `Tailwind CSS`, `ESLint`, `lucide-react` (icons)

**Goals:**
- Provide a minimal, modern frontend dev environment with HMR and sensible defaults.
- Keep configuration lightweight and easy to extend.

**When to use:** Great for prototyping components, small projects, or as a base to scaffold a larger app.

**Demo / Playground:** Open the dev server to work on UI with instant reloads.

**Contents**
- `src/` — application source (JSX, CSS, assets)
- `public/` — static files served as-is
- `index.html` — Vite entry HTML
- `vite.config.js` — Vite configuration
- `package.json` — scripts and dependencies

**Quick Start**

Run these commands in PowerShell from the project root:

```powershell
npm install
npm run dev    # start dev server (HMR)
npm run build  # produce production build
npm run preview # locally preview production build
npm run lint   # run ESLint
```

Open `http://localhost:5173` (or the URL printed by Vite) to see the app while `npm run dev` is running.

**Available Scripts**
- `npm run dev` — starts Vite dev server with fast refresh.
- `npm run build` — builds the app for production (`dist/`).
- `npm run preview` — preview the production build locally.
- `npm run lint` — run ESLint across the project.

**Notes on Configuration**
- Tailwind: project includes `tailwindcss` and the `@tailwindcss/vite` helper. Tweak `tailwind.config.js` (add one if needed) to customize design tokens.
- ESLint: configured for a lightweight React setup. Consider adding TypeScript and `@typescript-eslint` for type-aware linting in larger apps.<br/><br/>


<img width="1842" height="901" alt="image" src="https://github.com/user-attachments/assets/8561a52f-fae2-4ac7-8b8f-00c15db2d81b" />


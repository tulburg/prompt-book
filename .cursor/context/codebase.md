Codebase Identity:
- Stack, package manager, and canonical scripts start in - `package.json`, `bun.lock`, `README.md`
- Product direction and context-writing intent start in - `feat.md`

Run And Build:
- Install dependencies with - `bun i`
- Start the web dev server with - `bun dev`
- Build the web bundle with - `bun run build:web`
- Build desktop packages with the interactive builder script - `bun run build:desktop`
- Preview the built web app with - `bun run start:web`
- Launch the built desktop app with - `bun run start:desktop`

App Entry Points:
- Renderer bootstrap and global CSS load start in - `src/main.tsx`
- Main app shell and three-panel layout start in - `src/app.tsx`
- Shared UI exports start in - `src/ui/index.ts`

Desktop Runtime:
- Electron window creation, persisted window state, and app lifecycle start in - `electron/main.ts`
- Renderer IPC bridge exposed to `window.ipcRenderer` starts in - `electron/preload.ts`
- Desktop packaging defaults and build flow start in - `electron-builder.json`, `package.json`, `scripts/build-desktop.ts`

UI Surface:
- Header interactions and Electron drag-region behavior start in - `src/ui/lower/Header.tsx`
- Resizable panel host and saved panel layout behavior start in - `src/ui/higher/FrameHost.tsx`
- Current prompt editor surface starts in - `src/ui/higher/Canvas.tsx`
- Current sidebar surface starts in - `src/ui/higher/Sidebar.tsx`
- Current explorer surface starts in - `src/ui/higher/ExplorerPanel.tsx`
- Prompt text input component starts in - `src/components/PromptBox.tsx`

Styling And Aliases:
- Tailwind v4 theme tokens, global colors, and resize handle styles start in - `src/index.css`
- Vite plugins and the `@` path alias start in - `vite.config.ts`
- TypeScript compiler options and the `@/*` alias start in - `tsconfig.json`
- Shadcn component aliases and styling defaults start in - `components.json`
- Formatting and lint rules start in - `biome.json`

Quality:
- Test runner, DOM environment, coverage, and test server config start in - `vitest.config.ts`
- Shared test cleanup starts in - `src/__tests__/setup.ts`
- Current app smoke tests start in - `src/__tests__/pages/app.test.tsx`

Editor Rules:
- Repo-specific editing constraints for this workspace start in - `.cursor/rules/critical.md`

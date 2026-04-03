---
alwaysApply: true
---

### How to add rules:
1. Add  a heading and the rule definition
2. Add a single example of wrong and right case
3. Add a further clarification in description of other examples that this might also match.

### Electron IPC handlers live in `electron/handlers/`
All `ipcMain.handle` registrations must be in dedicated handler files inside `electron/handlers/`, never directly in `electron/main.ts`.

**Wrong** — adding a new handler inline in `main.ts`:
```ts
// electron/main.ts
ipcMain.handle("theme:get", async () => { ... });
```

**Right** — creating or extending a handler file and registering via the barrel:
```ts
// electron/handlers/theme-handlers.ts
export function registerThemeHandlers() {
  ipcMain.handle("theme:get", async () => { ... });
}

// electron/handlers/index.ts
import { registerThemeHandlers } from "./theme-handlers";
// add to registerAllHandlers()
```

Shared types, store access, and utility functions used across handlers belong in `electron/handlers/shared.ts`. The `electron/main.ts` file is reserved for window creation, app lifecycle, and the application menu.

### All styling must use Tailwind utility classes
Do not create CSS files, add custom CSS classes, or use inline `style` attributes for styling. All visual styling must be expressed through Tailwind classes in `className`.

**Wrong** — custom CSS class in a stylesheet:
```css
.chat-panel { background-color: var(--color-panel); border-radius: 16px; }
```

**Right** — Tailwind classes directly on the element:
```tsx
<div className="rounded-2xl bg-panel" />
```

The only permitted exceptions in `src/index.css` are: `@theme` tokens, `@layer base` resets, `@keyframes` for animations, and `@utility` definitions for vendor-prefixed properties with no Tailwind equivalent (e.g. `-webkit-app-region`). Inline `style` is only allowed for truly dynamic runtime values (e.g. computed positions, progress bar widths) — never for static visual properties like colors, spacing, or typography.

### All tests must live in `__tests__/` folders
Place every test file inside a `__tests__/` directory, mirroring the source tree from there instead of colocating `*.test.*` files beside implementation files.

**Wrong** — colocated test file beside source:
```ts
// src/lib/chat/request-builder.test.ts
```

**Right** — test file inside a mirrored `__tests__` path:
```ts
// src/__tests__/lib/chat/request-builder.test.ts
```

Use the nearest shared `__tests__/` directory for that source tree, such as `src/__tests__/...` for app code and `electron/__tests__/...` for Electron code.
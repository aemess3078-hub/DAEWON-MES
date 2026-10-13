# Server Actions Rules

These rules apply to files whose first directive is `"use server"` or `'use server'`.
The goal is to avoid Next.js runtime failures such as:

```text
A "use server" file can only export async functions
```

## Required Pattern

Allowed:

```ts
"use server"

export async function createSomething() {
  // ...
}
```

Not allowed:

```ts
"use server"

export const SOME_VALUE = "value"
export function helper() {}
export const buildCheck = () => ({})
export { helper }
```

## Rules

- Runtime exports from `"use server"` files must be `export async function ...`.
- Do not export constants, schemas, callbacks, builders, or helper functions.
- Do not use default exports from `"use server"` files.
- Keep validation schemas and pure helpers in ordinary modules.
- Keep server-only helper services in `.server.ts` modules without the `"use server"` directive.
- Client Components may import server-action functions from `"use server"` files, but must not import `.server.ts` helper services directly.
- Reference checks for selected-delete features belong in `src/lib/actions/reference-check.server.ts` or a similarly scoped non-`"use server"` service.

Type-only exports are erased by TypeScript, but avoid putting shared types in action files when a separate types module is clearer.

## Automated Check

Run:

```bash
npm run check:server-actions
```

The check scans `src` for `"use server"` files and fails when a runtime export is not
an `export async function` declaration. It is intended to catch the same class of
mistake before Preview or Production deployment.

Run it with the normal verification set:

```bash
npm run type-check
npm run lint
npm run build
npm run check:server-actions
```

## Refactoring Guidance

When a server action needs shared logic:

- put the exported action in `*.actions.ts`
- put reusable server-only logic in `*.server.ts`
- put pure formatting or type utilities in an ordinary module
- import helpers into the action file, but export only async action functions from the action file

For selected-delete reference checks, keep the final deletion guard on the server action path.
The UI result is only a preview; the server must check again immediately before deleting.

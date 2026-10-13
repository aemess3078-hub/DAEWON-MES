# Master Data Bulk Delete Checklist

Use this checklist for every master-data selected-delete feature. The default rule is:
referenced operating data must never be deleted.

## Implementation Rules

- Follow the stabilized pattern from PR #22 and PR #23.
- Add row selection, selected count, selected-delete button, and confirmation dialog.
- Compute delete eligibility per row.
- Show clear block reasons for rows that cannot be deleted.
- Re-run the reference check on the server immediately before deletion.
- Delete only rows that are still eligible after the final server check.
- Leave an `AuditLog` entry with action `DELETE` for each successful delete.
- Keep referenced rows untouched and return a blocked result to the UI.
- Keep implementation scoped to the requested master-data area.

## Server Action Rules

- A `"use server"` action file must export only `export async function ...`.
- Do not export constants, schemas, builders, callbacks, or helper functions from a `"use server"` file.
- Put reference-check helpers in `src/lib/actions/reference-check.server.ts` or another non-`"use server"` `.server.ts` service.
- Do not pass callbacks/builders out of a `"use server"` module in a way that makes them exported server-action values.
- Run `npm run check:server-actions` before reporting completion.

## UX Verification

Verify on `NewMES` only:

- row checkbox selection works
- header select-all behavior works
- selected-delete button appears only when expected
- dialog opens with the selected rows
- dialog separates deletable and blocked rows
- blocked rows show user-readable reasons
- confirm action deletes only eligible rows
- UI refreshes after delete
- success/error toast or dialog result is clear

## Data Safety Verification

Verify on `NewMES` only:

- a referenced row is blocked and remains in the table
- an unreferenced temporary test row can be deleted
- deleting a mix of referenced and unreferenced rows deletes only the eligible rows
- an `AuditLog` `DELETE` row is written for each successful delete
- the final server-side reference check blocks a row if references appear after the dialog opens

Do not perform these tests on `cns-medical-mes` Preview or Production.

## cns-medical-mes Verification

On `cns-medical-mes` Preview and Production, use read-only checks only:

- build/deployment is successful
- unauthenticated protected URLs redirect to login or return the expected non-mutating response
- runtime logs have no `500`
- runtime logs have no `"use server"` export error
- runtime logs have no `Server Components` render error

Do not log in for feature E2E unless explicitly approved by the operator.
Do not create, delete, or mutate operating data.

## Completion Notes

The PR report should identify:

- target master-data screens
- files changed
- checks run
- NewMES functional verification result
- cns-medical-mes read-only verification result
- migration requirement
- operating DB mutation status
- known limitations or follow-up work

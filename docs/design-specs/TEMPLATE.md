# SPEC-NNN: Title

- **Status:** Todo
- **Phase:** 1 / 2 / 3
- **Depends on:** SPEC-xxx (or none)
- **Estimated size:** S / M / L (rough half-day / day / multi-day)

## Context

Where this fits in the product and why it matters now. Reference the current
state of the code (files, stubs, TODOs) that this spec builds on.

## Goal

One or two sentences: what "done" looks like from the user's point of view.

## Non-goals

Explicitly out of scope, to keep the unit small. Point at the spec that covers
each deferred item where relevant.

## Data model changes

New/changed Drizzle tables or columns (`apps/api/src/db/schema.ts`), plus the
migration step. State "none" if there are none.

## API changes

New/changed routes, request/response shapes, and the Zod schemas in
`packages/shared` that back them. Note auth requirements.

## Web / UI changes

New components, hooks, routes, and state. Note responsive behavior and the
design tokens involved.

## Implementation notes

Ordering, libraries to add (with why), gotchas, and any security considerations.
Keep the reader inside a single area of the code where possible.

## Acceptance criteria

A checklist of observable, testable outcomes. This is the contract for "done."

- [ ] ...
- [ ] ...

## Testing

What to test and at what level (unit / integration / manual), including the
specific cases that must be covered.

## Open questions

Anything to resolve before or during implementation. Remove if none.

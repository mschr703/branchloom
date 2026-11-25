# F17: A local bug replay

This first slice records a small interaction in Branchloom's **Web preview** and saves it on an existing card. It does not start an agent or replay automatically.

## Record

1. Create or open a card and start its **Card preview** from the saved F01 development profile. Open the same local preview address in **Web preview**.
2. Expand **Record bug replay** and press **Start recording**. Click the relevant controls in the preview. Up to five clicks on elements with a stable `id` or `data-testid` are accepted. If viewport size matters, resize the preview and press **Mark current size** at the desired point.
3. Press **Stop recording**. Review the captured steps; remove accidental steps. Pick the card, give a stable target `id` or `data-testid`, and choose whether it should be visible or hidden after the steps. Press **Save on card**.
4. Open the card. **Bug replays** lists the saved steps and expectation. Press **Prepare replay**, read the local test data warning, then press **Run in test system**. The result and the Git evidence are saved with the scenario.

The UI text is localized in German. The English control names above describe their equivalents.

## Boundaries and results

- Recording captures only trusted clicks on one visible loopback tab and explicit viewport markers. It does not store input values, page text, cookies, screenshots, arbitrary CSS selectors, or cross-origin requests. Unstable or ambiguous clicks are ignored; a recording with ignored clicks cannot be saved. The unsaved draft is in memory only and is discarded when the project changes.
- Saving requires an active card in the same project, a ready F01 preview on the same origin, and the current development profile. The scenario binds the card content revision, profile fingerprint, local URL path, viewport, actions, and expectation. It persists in the local Branchloom SQLite database across app restarts. Query strings and fragments are rejected because they may contain private data.
- Each replay uses a fresh isolated Electron partition and verifies the current F01 preview. Only GET/HEAD requests to the preview origin are allowed, with repeated ownership checks. POST/PUT/DELETE requests and downloads are blocked. A changed card revision, changed development profile, missing preview, blocked request, missing action target, or missing expectation target is an error, never a pass.
- **Expectation met** means only that the selected DOM element was visible or hidden at the end of this run. A clean, stable Git HEAD in the card's verified worktree (or project checkout when no card worktree exists) is required to label the result as passed. Start/end HEAD and dirty state are stored. This does **not** prove that the running server served that exact commit; the card explicitly shows this limit.
- A local app may still have side effects on GET or client-side state changes after a click. Use a development server with synthetic test data. Branchloom never submits forms, replays typing, opens external sites, or silently retries after restart in this slice.

Verification for this slice: `npx vitest run tests/main/browser.test.ts tests/main/bug-replay.test.ts tests/renderer/card-bug-replay.test.tsx`, `npm run typecheck`, `npm run build`, and `npm run smoke:f17`. The Electron smoke runs against a synthetic loopback page and checks a failed pre-fix expectation, a missing target error, a blocked POST, and a passed post-fix expectation.

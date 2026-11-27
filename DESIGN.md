# Branchloom visual system (working direction)

This file records the current UI decisions for Branchloom's Windows desktop app. It is a design constraint for new work, not a claim that every existing screen follows it. [Product intent](docs/PRODUCT_VISION.md), [verified status](docs/STATUS.md), and user feedback take precedence when they disagree with this file.

## Job and audience

Branchloom is an operating surface for people who plan, run, and review coding-agent work. Its primary view should show the work itself: a board, a diagram, an editable artboard, a live app, or a source-backed relationship map. Controls should support that surface without becoming the main visual event. A newcomer must see the next useful action; an experienced user must retain fast access to sources, agent settings, and approval gates.

## Current tokens and next direction

The 26 November user reference sharpens the target: project identity, one quiet search entry, the board's real work, and a compact session rail should form a readable vertical sequence. Restrained column tones orient the reader; user-selected tones persist with a column and do not imply workflow progress. Small status signals distinguish actual work states. An absent feature in the reference image is not a request to remove it. The Design view now has a project-level entry for real saved drafts, stored QA screenshots, and captured local app elements. QA images are bounded, dated evidence, not editable designs or proof of the current checkout. Actual agent-produced visual artifacts are not collected automatically yet; do not synthesize a design from a completed session. The existing editor's card binding, manual agent proposal, and explicit approval remain visible limitations until a broader artifact model ships.

Team presence belongs to the place where work happens: a quiet count or face in navigation for an open view, and named viewers versus editors on the specific card or canvas selection. Show only authenticated live sessions, expire stale presence, and never present a viewing cursor as an edit. Keep the board readable when nobody is present.

- **Type:** IBM Plex Sans Variable for interface copy and headings; tabular numerals for IDs, counts, sizes, and time. Keep primary controls and inspector values readable at 13–14 px or larger at a 1440 px desktop viewport. Secondary metadata may be smaller, but must remain legible.
- **Light (default for new profiles; current implementation tokens):** canvas `#f6f5f2`, sidebar `#eeece7`, surface `#ffffff`, text `#25262a`, border `#d8d5ce`, ink accent `#373b46`. A previously saved dark preference remains dark.
- **Dark (current implementation tokens):** canvas `#1d1d1f`, sidebar `#19191b`, surface `#28282b`, text `#eeece9`, border `#505055`, ink accent `#dedddd`.
- These are an initial implementation of the user's selected light Signals direction, not a final brand palette. Blue denotes actual agent/selection/dependency state, orange and red actual card priorities. No progress marker may be drawn from a guessed workflow state.
- Borders express actual containment or a resizable split. Prefer spacing and type hierarchy over nested rounded boxes. Color must have meaning beyond decoration and must not be the sole way to read a state.
- The next visual pass applies across the whole app, not just the board. Use the information density and direct manipulation of modern work apps, the compact agent workflow of Kangentic, and the restraint of Apple interfaces as references without copying their screens. Current heavy headings, filled sections, and nested frames need a lighter hierarchy. Verify the proposed direction with realistic Board and Intake mockups before propagating it.
- The user selected the light **Signals** Board study on 25 November 2026 as the direction for the next UI pass. Compact cards, neutral surfaces, a right-hand detail drawer, project monograms, and flat saved-note rows have entered the app. A follow-up branch adds a collapsible strip for real running sessions. A second follow-up branch adds compact Board markers only from persisted per-card workflow evidence. A route index alone is never shown as completed progress.

## Surface rules

| View | Main object | Supporting controls |
| --- | --- | --- |
| Board | Cards in a readable workflow column | Column settings, search/filter, and task actions stay close to the relevant work. |
| Architecture | Diagram on a spacious canvas | Selection, source evidence, draft discussion, and explicit incorporation; no permanent empty inspector taking diagram space. |
| Memory | One source and its proven local relationships | Source/age, depth, filters, inspector, and a path to the complete excerpt. Node position never implies semantic similarity. |
| Design | Editable artboard or explicitly opened local app | Layers and properties remain visible; a compact tool cluster keeps the canvas in the first viewport. The focused editor uses shallow artboard previews and shares a toolbar row with save and approval when space allows. Save and agent approval are separate steps. |

## Interaction and verification

- Selection should be obvious and keyboard reachable. When an operation uses mouse drag, provide a discoverable keyboard path where practical.
- An unsaved draft, a saved revision, an approved context, and running source code are different states. Label them plainly and never imply that a model response changed project code.
- Motion should explain a user action, such as opening an inspector or completing a move. Avoid ambient animation, decorative gradients, glows, and vanity statistics.
- Review the actual Electron UI at 1440 × 900 and 430 × 760 with synthetic data in both themes when changing a shared visual rule. Check overflow, focus, contrast, empty/error states, and whether the main surface is visible without scrolling.
- For the Design editor, `npm run smoke:design-preview` builds and opens a hidden Electron window with an isolated synthetic profile, checks the real editor path, and prints desktop and narrow screenshot paths. It does not activate a Windows window or use the user's mouse and keyboard. The screenshots are temporary review artifacts, not saved user designs.

This direction draws on the user's screenshots and feedback, the local `anti-slop-design` and `frontend-design` skills, and [Impeccable's design-context workflow](https://impeccable.style/docs/context/). No Impeccable source code is included in Branchloom.

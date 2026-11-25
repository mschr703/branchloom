# Branchloom visual system (working direction)

This file records the current UI decisions for Branchloom's Windows desktop app. It is a design constraint for new work, not a claim that every existing screen follows it. [Product intent](docs/PRODUCT_VISION.md), [verified status](docs/STATUS.md), and user feedback take precedence when they disagree with this file.

## Job and audience

Branchloom is an operating surface for people who plan, run, and review coding-agent work. Its primary view should show the work itself: a board, a diagram, an editable artboard, a live app, or a source-backed relationship map. Controls should support that surface without becoming the main visual event. A newcomer must see the next useful action; an experienced user must retain fast access to sources, agent settings, and approval gates.

## Current visual language

- **Type:** IBM Plex Sans Variable for interface copy and headings; tabular numerals for IDs, counts, sizes, and time. Keep primary controls and inspector values readable at 13–14 px or larger at a 1440 px desktop viewport. Secondary metadata may be smaller, but must remain legible.
- **Light:** canvas `#f6f7f5`, sidebar `#e9eeea`, surface `#ffffff`, text `#202a24`, border `#c7d0c8`, accent `#275d48`.
- **Dark:** canvas `#191e1b`, sidebar `#151b17`, surface `#222a25`, text `#eef3ee`, border `#4e5e52`, accent `#8bcaa7`.
- These values come from `src/renderer/brand.css`. Use its semantic CSS variables for new UI; avoid new page-specific colors without a concrete state or source distinction. Both themes are product surfaces, not a dark-only marketing treatment.
- Borders express actual containment or a resizable split. Prefer spacing and type hierarchy over nested rounded boxes. Reserve the accent for selection, focus, and the one primary action in a local workflow.

## Surface rules

| View | Main object | Supporting controls |
| --- | --- | --- |
| Board | Cards in a readable workflow column | Column settings, search/filter, and task actions stay close to the relevant work. |
| Architecture | Diagram on a spacious canvas | Selection, source evidence, draft discussion, and explicit incorporation; no permanent empty inspector taking diagram space. |
| Memory | One source and its proven local relationships | Source/age, depth, filters, inspector, and a path to the complete excerpt. Node position never implies semantic similarity. |
| Design | Editable artboard or explicitly opened local app | Layers and properties remain visible; a compact tool cluster keeps the canvas in the first viewport. Save and agent approval are separate steps. |

## Interaction and verification

- Selection should be obvious and keyboard reachable. When an operation uses mouse drag, provide a discoverable keyboard path where practical.
- An unsaved draft, a saved revision, an approved context, and running source code are different states. Label them plainly and never imply that a model response changed project code.
- Motion should explain a user action, such as opening an inspector or completing a move. Avoid ambient animation, decorative gradients, glows, and vanity statistics.
- Review the actual Electron UI at 1440 × 900 and 430 × 760 with synthetic data in both themes when changing a shared visual rule. Check overflow, focus, contrast, empty/error states, and whether the main surface is visible without scrolling.

This direction draws on the user's screenshots and feedback, the local `anti-slop-design` and `frontend-design` skills, and [Impeccable's design-context workflow](https://impeccable.style/docs/context/). No Impeccable source code is included in Branchloom.

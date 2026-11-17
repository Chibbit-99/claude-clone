# Claude Clone App

* This is where the final clone app files will be stored and hosted.
* The app branch is where the app will be deployed to github pages.
* The app directory in main will be pushed automatically to the app branch.

## /new — reconstructed new chat page

* `index.html` — the saved `claude.ai/new` document (scripts stripped) plus the
  popovers/dialogs sliced out of the other extractions, stored in `<template>`
  elements. Generated file, do not edit by hand.
* `stylesheet_0.css`, `stylesheet_1.css`, `stylesheet_2.css`, `fonts/`,
  `images/` — copied verbatim from `clones/new/index`.
* `stylesheet_extra.css` — generated delta in two layers, both copied
  out of the extractions (no hand-written CSS):
  1. every rule the other captures brought in that the base bundle lacks
     (`tools/cssmerge.py`), plus, for selectors the base already has, only the
     *properties* the base leaves out — that recovers ~40 theme variables
     (`--cds-neutral-50`, `--cds-pad-lg`, `--cds-shadow-popover`, …) that only
     the popover/dialog captures define. Existing base properties are never
     overridden, so the page itself still renders exactly like its capture;
  2. utilities for markup classes that no capture stylesheet contains, rebuilt
     from sibling rules (`tools/derived.py`): declarations, selectors and the
     `@media`/`@supports` context are all taken from captured rules — e.g.
     `data-[highlighted]:bg-fill-ghost-hover` from the `hover:`/`stacks:` rule
     for the same token, `group-…/btn:bg-fill-brand-hover` from the sibling
     group utilities. Classes whose declarations cannot be traced are skipped,
     never guessed.
  Build prints coverage: currently `1055/1102` classes of the built document
  have a rule. The 47 that don't are (a) JS-only hook names that claude.ai's
  own sheet does not style either (`df-titlebar-brand`, `chat-ui-core`,
  `ProseMirror-trailingBreak`, `group/label`, …), and (b) states that need a
  declaration no capture contains (`shadow-field-pressed`, `ps-8`, `size-0`).
  Some hover tints also depend on custom properties the app sets from its own
  JS (`--row-hover`, `--hov`, `--pl-tint`) — those values exist in no
  extraction, so they cannot be reconstructed.
* `app.js` — the only hand-written file. It wires the UI together using the
  attributes/classes the original markup already reacts to, and adds no CSS.

Rebuild after new extractions land:

```
python3 tools/build.py   # regenerates app/new/index.html + assets
```

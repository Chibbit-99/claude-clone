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
* `app.js` — the only hand-written file. It wires the UI together using the
  attributes/classes the original markup already reacts to, and adds no CSS.

Rebuild after new extractions land:

```
python3 tools/build.py   # regenerates app/new/index.html + assets
```

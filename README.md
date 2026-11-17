# Claude clone
A small project to recreate claude.ai UI and functionality using the singlefile chrome extension

### Info
* Do not edit files in /clones or /extractions
* /clones is an automated extraction of zip archives of /extractions
* Upload extractions from singlefile chrome extension to /extractions (must be zip file)

### Status
**16/11/26** 
* Most extractions for new chat page have been completed.
* Reconstruction at /app has not been started.
* Key workflow actions and documentation files have been setup
**17/11/26**
* New chat page reconstructed at `app/new` and wired up (`app/new/app.js`).
* `app/new` is generated from `/clones` by `tools/build.py` — markup, CSS and fonts are copied verbatim from the extractions, nothing is re-styled by hand.
* Working interactions: add menu (+ its project / skills / connector / design system submenus), upload dialog, new project dialog, project chip, model selector (+ effort and more models submenus), prompt category suggestions, Cowork dialog, Chat/Cowork switch, sidebar collapse, composer typing.

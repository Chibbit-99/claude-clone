/* Behaviour for the reconstructed Claude "new chat" page.
 *
 * Every visual comes from the extracted markup + stylesheets in this folder.
 * This file only wires interactions together, and it does so using the
 * attributes and classes the real app already reacts to (`data-highlighted`,
 * `data-checked`, `aria-checked`, `data-collapsed`, ...). No CSS is added.
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const PORTAL = $('#portal-root');

  const fragment = (name) => {
    const tpl = document.querySelector(`template[data-frag="${name}"]`);
    if (!tpl) throw new Error(`missing fragment: ${name}`);
    return tpl.content.firstElementChild.cloneNode(true);
  };

  /* ------------------------------------------------------------------ *
   * small helpers over the extracted markup
   * ------------------------------------------------------------------ */

  // First "leaf" .truncate inside a row is always its visible label:
  // menu rows, model rows (name + description + badge) and effort rows all
  // follow that shape.
  const labelOf = (row) => {
    for (const el of row.querySelectorAll('.truncate')) {
      if (!el.querySelector('*')) return el.textContent.trim();
    }
    return row.textContent.trim();
  };

  const CHECK_ICON = (() => {
    const tpl = document.querySelector('template[data-frag="pop-model-effort"]');
    const holder = tpl && tpl.content.querySelector('[data-effort-id="low"] span[style*="fill-accent"]');
    return holder ? holder.innerHTML : '';
  })();

  /** Radio style menu rows draw their tick from a sibling row's markup. */
  const setRadio = (scope, attr, value) => {
    for (const row of $$(`[${attr}]`, scope)) {
      const on = row.getAttribute(attr) === value;
      row.setAttribute('aria-checked', String(on));
      const holder = row.querySelector('span[style*="fill-accent"]');
      if (holder) holder.innerHTML = on ? CHECK_ICON : '';
    }
  };

  /* ------------------------------------------------------------------ *
   * popovers (menus + submenus)
   * ------------------------------------------------------------------ */

  const stack = [];        // open portals, index === level
  const dialogs = [];
  const subTimers = new Map();
  const hovered = new Map();   // level -> highlighted row

  const positioner = (host) => host.querySelector('[data-side][data-align][role="presentation"]');

  const place = (host, anchor, side, align) => {
    const pos = positioner(host);
    if (!pos) return;
    const r = anchor.getBoundingClientRect();
    const gap = 4;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    pos.setAttribute('data-side', side);
    pos.setAttribute('data-align', align);
    pos.style.setProperty('--anchor-width', `${Math.round(r.width)}px`);
    pos.style.setProperty('--anchor-height', `${Math.round(r.height)}px`);

    const w = pos.offsetWidth;
    const h = pos.offsetHeight;

    let left;
    let top;
    if (side === 'bottom') {
      left = align === 'end' ? r.right - w : r.left;
      top = r.bottom + gap;
    } else {
      left = r.right + 2;
      top = align === 'end' ? r.bottom - h : r.top;
    }
    left = Math.max(pad, Math.min(left, vw - w - pad));
    top = Math.max(pad, Math.min(top, vh - h - pad));

    pos.style.setProperty('--available-width', `${Math.max(128, vw - left - pad)}px`);
    pos.style.setProperty('--available-height', `${Math.max(96, vh - top - pad)}px`);
    pos.style.setProperty('--transform-origin', align === 'end' ? '100% -4px' : '0% -4px');
    pos.style.transform = `translate(${left}px, ${top}px)`;
  };

  const openPop = (name, { anchor, side = 'bottom', align = 'start' }) => {
    const host = fragment(name);
    PORTAL.appendChild(host);
    place(host, anchor, side, align);

    const backdrop = host.querySelector('[data-base-ui-inert]');
    if (backdrop) {
      backdrop.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      backdrop.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAll();
      });
    }
    stack.push({ host, anchor, name });
    if (anchor.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', 'true');
    hydrate(host);
    return host;
  };

  const closeAbove = (level) => {
    while (stack.length > level) {
      const entry = stack.pop();
      entry.host.remove();
      if (entry.anchor && entry.anchor.hasAttribute('aria-expanded')) {
        const stillOpen = stack.some((e) => e.anchor === entry.anchor);
        if (!stillOpen) entry.anchor.setAttribute('aria-expanded', 'false');
      }
    }
    for (const [depth, row] of hovered) {
      if (depth >= level) {
        setHighlight(row, false);
        hovered.delete(depth);
      }
    }
  };

  const closeAll = () => closeAbove(0);

  const levelOf = (host) => stack.findIndex((e) => e.host === host);

  const cancelClose = () => {
    for (const t of subTimers.values()) clearTimeout(t);
    subTimers.clear();
  };

  const setHighlight = (row, on) => {
    if (!row) return;
    if (on) row.setAttribute('data-highlighted', '');
    else row.removeAttribute('data-highlighted');
    if (row.hasAttribute('aria-haspopup')) row.setAttribute('aria-expanded', String(on));
  };

  const hoverRow = (row, sub, level) => {
    if (hovered.get(level) === row) return;
    cancelClose();
    setHighlight(hovered.get(level), false);
    hovered.delete(level);
    closeAbove(level + 1);          // drop a submenu that came from another row
    hovered.set(level, row);
    setHighlight(row, true);
    if (sub) {
      const host = openPop(sub.name, { anchor: row, side: 'inline-end', align: sub.align || 'end' });
      attachMenu(host, sub);
    }
  };

  const leaveMenu = (level) => {
    clearTimeout(subTimers.get(level));
    subTimers.set(level, setTimeout(() => {
      setHighlight(hovered.get(level), false);
      hovered.delete(level);
      closeAbove(level + 1);
    }, 180));
  };

  /** Attach pointer + click handling to a menu portal. */
  function attachMenu(host, options = {}) {
    const { subs = {}, onPick } = options;
    const menu = host.querySelector('[role="menu"]');
    if (!menu) return;
    const level = levelOf(host);

    menu.addEventListener('pointerover', (e) => {
      const row = e.target.closest('[role^="menuitem"]');
      if (!row || !menu.contains(row)) return;
      const sub = subs[labelOf(row)] || null;
      hoverRow(row, sub, level);
    });

    menu.addEventListener('pointerenter', cancelClose);
    menu.addEventListener('pointerleave', () => leaveMenu(level));

    menu.addEventListener('click', (e) => {
      const row = e.target.closest('[role^="menuitem"], a[role="menuitem"]');
      if (!row || !menu.contains(row)) return;
      e.preventDefault();
      if (onPick) onPick(row, e);
    });
  }

  /* ------------------------------------------------------------------ *
   * dialogs
   * ------------------------------------------------------------------ */

  const openDialog = (name) => {
    const host = fragment(name);
    PORTAL.appendChild(host);
    dialogs.push({ host, name });

    const backdrop = host.querySelector('.bg-backdrop');
    if (backdrop) {
      backdrop.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      backdrop.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDialog(host);
      });
    }

    host.addEventListener('click', (e) => {
      const button = e.target.closest('button, a');
      if (!button || !host.contains(button)) return;
      const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
      const text = label.toLowerCase();

      if (text.startsWith('close') || text === 'later' || text === 'cancel') {
        e.preventDefault();
        closeDialog(host);
        return;
      }
      if (name === 'dialog-upload' && text === 'choose files') {
        e.preventDefault();
        const input = host.querySelector('input[type="file"]');
        if (input) input.click();
      }
      if (name === 'dialog-newproject' && text === 'create project') {
        e.preventDefault();
        const input = host.querySelector('input:not([type="file"])');
        const value = (input && input.value.trim()) || 'Untitled project';
        closeDialog(host);
        setProject(value);
      }
    });

    return host;
  };

  const closeDialog = (host) => {
    const i = dialogs.findIndex((d) => d.host === host);
    if (i === -1) return;
    const [entry] = dialogs.splice(i, 1);
    entry.host.remove();
    if (entry.name === 'dialog-cowork') selectSurface('chat');
  };

  /* ------------------------------------------------------------------ *
   * composer: model selector
   * ------------------------------------------------------------------ */

  const modelButton = () => $('[data-testid="model-selector-dropdown"]');
  const modelLabel = () => {
    const btn = modelButton();
    const name = btn.querySelector('.truncate');
    return {
      name,
      effort: name ? name.nextElementSibling : null,
    };
  };

  const state = { model: '', effort: '', modelId: '', effortId: '', project: '', webSearch: true };

  const readModel = () => {
    const { name, effort } = modelLabel();
    if (name) state.model = name.textContent.trim();
    if (effort) state.effort = effort.textContent.trim();
    const tpl = document.querySelector('template[data-frag="pop-model"]');
    if (tpl) {
      const checked = tpl.content.querySelector('[data-model-id][aria-checked="true"]');
      if (checked) state.modelId = checked.getAttribute('data-model-id');
    }
    const effortTpl = document.querySelector('template[data-frag="pop-model-effort"]');
    if (effortTpl) {
      const checked = effortTpl.content.querySelector('[data-effort-id][aria-checked="true"]');
      if (checked) state.effortId = checked.getAttribute('data-effort-id');
    }
  };

  /** Menus are cloned from templates, so re-apply the current selection. */
  const hydrate = (host) => {
    for (const menu of $$('[role="menu"]', host)) {
      if (menu.querySelector('[data-model-id]') && state.modelId) setRadio(menu, 'data-model-id', state.modelId);
      if (menu.querySelector('[data-effort-id]') && state.effortId) setRadio(menu, 'data-effort-id', state.effortId);
      for (const item of $$('[role="menuitem"]', menu)) {
        if (labelOf(item) !== 'Effort') continue;
        const icon = item.querySelector('[data-cds="Icon"]');
        const value = icon && icon.previousElementSibling;
        if (value) value.textContent = state.effort;
      }
      // checked rows in the add menu (web search) and the project submenu
      for (const row of $$('[role="menuitemcheckbox"]', menu)) {
        const label = labelOf(row);
        const on = label === 'Web search' ? state.webSearch : label === state.project;
        row.setAttribute('aria-checked', String(on));
        const holder = row.querySelector('span[style*="fill-accent"]');
        if (holder) holder.innerHTML = on ? CHECK_ICON : '';
      }
    }
  };

  const setChip = (model, effort) => {
    state.model = model;
    state.effort = effort;
    const btn = modelButton();
    const { name, effort: effortEl } = modelLabel();
    if (name) name.textContent = model;
    if (effortEl) effortEl.textContent = ` ${effort}`;
    btn.setAttribute('aria-label', `Model: ${model} ${effort}`);
  };

  const selectModel = (row) => {
    const id = row.getAttribute('data-model-id');
    state.modelId = id;
    for (const entry of stack) {
      const menu = entry.host.querySelector('[role="menu"]');
      if (menu && menu.querySelector(`[data-model-id="${id}"]`)) setRadio(menu, 'data-model-id', id);
    }
    setChip(labelOf(row), state.effort);
    closeAll();
  };

  const selectEffort = (row) => {
    const effort = labelOf(row);
    state.effortId = row.getAttribute('data-effort-id');
    for (const entry of stack) {
      const menu = entry.host.querySelector('[role="menu"]');
      if (menu && menu.querySelector('[data-effort-id]')) setRadio(menu, 'data-effort-id', state.effortId);
      // keep the "Effort  Low" summary row in the model menu in sync
      if (menu) {
        for (const item of $$('[role="menuitem"]', menu)) {
          if (labelOf(item) === 'Effort') {
            const icon = item.querySelector('[data-cds="Icon"]');
            const value = icon && icon.previousElementSibling;
            if (value) value.textContent = effort;
          }
        }
      }
    }
    setChip(state.model, effort);
    closeAll();
  };

  const pickModel = (row) => {
    if (row.hasAttribute('data-model-id')) {
      selectModel(row);
      return true;
    }
    return false;
  };

  const pickEffort = (row) => {
    if (row.hasAttribute('data-effort-id')) {
      selectEffort(row);
      return true;
    }
    return false;
  };

  const MODEL_SUBS = {
    Effort: { name: 'pop-model-effort', align: 'start', onPick: pickEffort },
    'More models': { name: 'pop-model-more', align: 'end', onPick: pickModel },
  };

  const openModelMenu = () => {
    if (stack.some((e) => e.name === 'pop-model')) {
      closeAll();
      return;
    }
    closeAll();
    const btn = modelButton();
    const host = openPop('pop-model', { anchor: btn, side: 'bottom', align: 'end' });
    attachMenu(host, {
      subs: MODEL_SUBS,
      onPick: (row) => {
        if (pickModel(row)) return;
        const sub = MODEL_SUBS[labelOf(row)];
        if (sub) hoverRow(row, sub, levelOf(host));
      },
    });
  };

  /* ------------------------------------------------------------------ *
   * composer: add menu
   * ------------------------------------------------------------------ */

  const pickProject = (row) => {
    const label = labelOf(row);
    if (label === 'New project') {
      closeAll();
      openDialog('dialog-newproject');
      return;
    }
    if (row.getAttribute('role') === 'menuitemcheckbox') {
      setProject(label);
      hydrate(row.closest('[data-base-ui-portal]') || document.body);
      closeAll();
    }
  };

  const openProjectMenu = (anchor, side = 'inline-end', align = 'end') => {
    const host = openPop('pop-add-project', { anchor, side, align });
    attachMenu(host, { onPick: pickProject });
    return host;
  };

  const ADD_SUBS = {
    'Add to project': { name: 'pop-add-project', align: 'end', onPick: pickProject },
    Skills: { name: 'pop-add-skills', align: 'end' },
    'Add connector': { name: 'pop-add-connectors', align: 'end' },
    'Design system': { name: 'pop-add-design-system', align: 'end' },
  };

  const openAddMenu = () => {
    if (stack.some((e) => e.name === 'pop-add')) {
      closeAll();
      return;
    }
    closeAll();
    const btn = $('[data-testid="chat-input-attach"]');
    const host = openPop('pop-add', { anchor: btn, side: 'bottom', align: 'start' });
    attachMenu(host, {
      subs: ADD_SUBS,
      onPick: (row) => {
        const label = labelOf(row);
        if (label === 'Upload or add files') {
          closeAll();
          openDialog('dialog-upload');
          return;
        }
        if (row.getAttribute('role') === 'menuitemcheckbox') {
          state.webSearch = !state.webSearch;
          const holder = row.querySelector('span[style*="fill-accent"]');
          row.setAttribute('aria-checked', String(state.webSearch));
          if (holder) holder.innerHTML = state.webSearch ? CHECK_ICON : '';
        }
      },
    });
  };

  /* ------------------------------------------------------------------ *
   * composer: project chip
   * ------------------------------------------------------------------ */

  // The chip lives in the slot right after the add button. The extraction only
  // renders the inner .contents wrapper once a project is picked, so fall back
  // to that (display:contents) row itself.
  const projectSlot = () => {
    const chips = $('[data-chorus-callout="attach-chips"]');
    if (!chips) return null;
    const neighbour = chips.nextElementSibling;
    if (!neighbour) return null;
    return neighbour.querySelector('.contents') || neighbour.lastElementChild || neighbour;
  };

  function setProject(name) {
    state.project = name;
    const slot = projectSlot();
    if (!slot) return;
    const chip = fragment('project-chip');
    const btn = chip.querySelector('button');
    btn.setAttribute('aria-label', `Project: ${name}`);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (stack.some((s) => s.name === 'pop-add-project')) closeAll();
      else {
        closeAll();
        openProjectMenu(btn, 'bottom', 'start');
      }
    });
    slot.replaceChildren(chip);
  }

  /* ------------------------------------------------------------------ *
   * composer: editor
   * ------------------------------------------------------------------ */

  const editor = () => $('[data-testid="chat-input"]');

  const syncComposer = () => {
    const el = editor();
    if (!el) return;
    const empty = el.textContent.replace(/\u200b/g, '').trim() === '';
    el.setAttribute('data-doc-empty', String(empty));

    const placeholder = $('[data-composer-placeholder]');
    if (placeholder) placeholder.classList.toggle('hidden', !empty);

    const first = el.querySelector('p');
    if (first && first.hasAttribute('data-placeholder')) {
      first.classList.toggle('is-empty', empty);
      first.classList.toggle('is-editor-empty', empty);
    }

    const send = $('[data-testid="chat-input-send"]');
    if (send) send.disabled = empty;
  };

  const insertPrompt = (text) => {
    const el = editor();
    if (!el) return;
    const p = document.createElement('p');
    p.textContent = text;
    el.replaceChildren(p);
    syncComposer();
    el.focus();
  };

  /* ------------------------------------------------------------------ *
   * composer: suggestions
   * ------------------------------------------------------------------ */

  const SUGGESTIONS = {
    Write: [
      'Brainstorm creative ideas',
      'Develop editorial guidelines',
      'Develop content templates',
      'Help me develop a unique voice for an audience',
      'Write compelling CTAs',
    ],
    Learn: [
      'Explain a concept step by step',
      'Quiz me on a topic I am studying',
      'Build a study plan for an exam',
      'Summarise a long article for me',
      'Find the gaps in my understanding',
    ],
    Code: [
      'Debug an error message with me',
      'Explain what this code does',
      'Write tests for a function',
      'Refactor code for readability',
      'Design a database schema',
    ],
    'Life stuff': [
      'Plan a weekly meal schedule',
      'Draft an email I have been avoiding',
      'Talk through a decision with me',
      'Build an exercise routine',
      'Organise a trip itinerary',
    ],
    'Claude\u2019s choice': [
      'Help me think through a tricky problem',
      'Summarise the key ideas of a topic',
      'Turn my rough notes into a first draft',
      'Suggest ways to make this better',
      'Ask me questions to sharpen my thinking',
    ],
  };

  const suggestionsFor = (label) => SUGGESTIONS[label] || SUGGESTIONS.Write;

  let panel = null;
  let panelChip = null;

  const chipLabel = (chip) => {
    const spans = $$('span', chip.querySelector('span.inline-flex'));
    const leaf = spans.filter((s) => !s.querySelector('*') && s.textContent.trim());
    return leaf.length ? leaf[leaf.length - 1].textContent.trim() : chip.textContent.trim();
  };

  const closeSuggestions = () => {
    if (panel) panel.remove();
    panel = null;
    panelChip = null;
  };

  const openSuggestions = (chip) => {
    const label = chipLabel(chip);
    if (panelChip === chip) {
      closeSuggestions();
      return;
    }
    closeSuggestions();
    const wrap = $('ul[aria-label="Prompt categories"]').parentElement;

    panel = fragment('panel-suggestions');
    panelChip = chip;

    const heading = panel.querySelector('h2');
    const icon = heading.parentElement.querySelector('[data-cds="Icon"]');
    const chipIcon = chip.querySelector('[data-cds="Icon"]');
    if (heading) heading.textContent = label;
    if (icon && chipIcon) icon.textContent = chipIcon.textContent;

    const list = panel.querySelector('ul[role="list"]');
    if (list) {
      list.setAttribute('aria-label', `${label} suggestions`);
      const proto = list.querySelector('li');
      const items = suggestionsFor(label);
      list.replaceChildren(...items.map((text) => {
        const li = proto.cloneNode(true);
        const target = li.querySelector('.flex-1');
        if (target) target.textContent = text;
        return li;
      }));
      // drop the hover arrow glyph text left over from the sample item
      for (const target of $$('.flex-1', list)) {
        target.childNodes.forEach((n) => {
          if (n.nodeType === 3 && !n.textContent.trim()) n.remove();
        });
      }
    }

    panel.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      e.preventDefault();
      if ((button.getAttribute('aria-label') || '').startsWith('Close')) {
        closeSuggestions();
        return;
      }
      const item = button.closest('li');
      const text = item && item.querySelector('.flex-1');
      if (text) {
        insertPrompt(text.textContent.trim());
        closeSuggestions();
      }
    });

    wrap.prepend(panel);
  };

  /* ------------------------------------------------------------------ *
   * composer: Chat / Cowork segmented control
   * ------------------------------------------------------------------ */

  const segment = () => $('[data-cds="SegmentedControl"][aria-label="Surface"]');

  const selectSurface = (which) => {
    const control = segment();
    if (!control) return;
    const radios = $$('[role="radio"]', control);
    const valueOf = (radio) => {
      const segmentEl = radio.querySelector('[data-surface-segment]');
      return segmentEl ? segmentEl.getAttribute('data-surface-segment') : radio.textContent.trim().toLowerCase();
    };
    const target = radios.find((r) => valueOf(r) === which);
    if (!target) return;
    for (const radio of radios) {
      const on = radio === target;
      if (on) {
        radio.setAttribute('data-checked', '');
        radio.removeAttribute('data-unchecked');
        radio.setAttribute('aria-checked', 'true');
        radio.tabIndex = 0;
      } else {
        radio.removeAttribute('data-checked');
        radio.setAttribute('data-unchecked', '');
        radio.setAttribute('aria-checked', 'false');
        radio.tabIndex = -1;
      }
    }
    const indicator = control.querySelector('[aria-hidden="true"] > div');
    if (indicator) {
      indicator.style.width = `${target.offsetWidth}px`;
      indicator.style.transform = `translateX(${target.offsetLeft}px)`;
    }
  };

  /* ------------------------------------------------------------------ *
   * sidebar
   * ------------------------------------------------------------------ */

  const FRAME = $('.dframe-root');
  const ASIDE = $('aside.dframe-sidebar');
  const SIDEBAR_WIDTH = 288;
  let collapsed = false;

  const setSidebar = (hide) => {
    collapsed = hide;
    FRAME.toggleAttribute('data-collapsed', hide);
    if (ASIDE) ASIDE.style.display = hide ? 'none' : '';
    FRAME.style.setProperty('--df-sidebar-width', `${hide ? 0 : SIDEBAR_WIDTH}px`);
    const toggle = $('button[aria-label="Hide sidebar"], button[aria-label="Show sidebar"]');
    if (toggle) toggle.setAttribute('aria-label', hide ? 'Show sidebar' : 'Hide sidebar');
  };

  /* ------------------------------------------------------------------ *
   * wiring
   * ------------------------------------------------------------------ */

  const init = () => {
    readModel();
    syncComposer();
    selectSurface('chat');

    // sidebar
    const sidebarToggle = $('button[aria-label="Hide sidebar"]');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', (e) => {
        e.preventDefault();
        setSidebar(!collapsed);
      });
    }

    // composer: attach / add menu
    const attach = $('[data-testid="chat-input-attach"]');
    if (attach) {
      attach.addEventListener('click', (e) => {
        e.preventDefault();
        openAddMenu();
      });
    }

    // composer: model selector
    const modelBtn = modelButton();
    if (modelBtn) {
      modelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openModelMenu();
      });
    }

    // composer: Chat / Cowork
    const control = segment();
    if (control) {
      control.addEventListener('click', (e) => {
        const radio = e.target.closest('[role="radio"]');
        if (!radio) return;
        e.preventDefault();
        const segmentEl = radio.querySelector('[data-surface-segment]');
        const which = segmentEl ? segmentEl.getAttribute('data-surface-segment') : radio.textContent.trim().toLowerCase();
        if (which === 'cowork') {
          selectSurface('cowork');
          const already = dialogs.some((d) => d.name === 'dialog-cowork');
          if (!already) openDialog('dialog-cowork');
        } else {
          selectSurface('chat');
          const cowork = dialogs.find((d) => d.name === 'dialog-cowork');
          if (cowork) closeDialog(cowork.host);
        }
      });
    }

    // composer: editor
    const el = editor();
    if (el) {
      el.addEventListener('input', syncComposer);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) e.preventDefault();
      });
    }

    // composer: prompt category chips
    const chips = $('ul[aria-label="Prompt categories"]');
    if (chips) {
      chips.addEventListener('click', (e) => {
        const chip = e.target.closest('button');
        if (!chip || !chips.contains(chip)) return;
        e.preventDefault();
        openSuggestions(chip);
      });
    }

    // links inside the extraction point at claude.ai: keep the page put
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (link) e.preventDefault();
    }, true);
    document.addEventListener('submit', (e) => e.preventDefault(), true);

    // keyboard + viewport
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (dialogs.length) {
        closeDialog(dialogs[dialogs.length - 1].host);
      } else {
        closeSuggestions();
        closeAll();
      }
    });
    window.addEventListener('resize', () => {
      if (stack.length) closeAll();
      const control2 = segment();
      const checked = control2 && control2.querySelector('[data-checked] [data-surface-segment]');
      if (checked) selectSurface(checked.getAttribute('data-surface-segment'));
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

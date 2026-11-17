/* Interaction layer for the reconstructed new-chat page.
   Everything here is UI behaviour only — there is no backend. */
(function () {
  "use strict";

  const data = window.CLAUDE_CLONE_DATA;

  /* ---------------------------------------------------------------- helpers */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const el = (tag, className, attrs) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  const icon = (codepoint, size) => {
    const s = el("span");
    s.setAttribute("data-cds", "Icon");
    s.setAttribute("aria-hidden", "true");
    s.style.fontSize = size || "calc(1.25rem * var(--cds-rem-scale, 1))";
    s.style.fontWeight = "433.3";
    s.textContent = codepoint;
    return s;
  };

  /* ------------------------------------------------------------------ chats */
  const chatList = $("#chat-list");
  data.chats.forEach((title) => {
    const wrap = el("div", "chat-row-wrap");
    const row = el("a", "row chat-row");
    row.href = "#";
    row.setAttribute("data-row", "");
    row.innerHTML =
      '<span class="row-label"><span>' +
      title.replace(/</g, "&lt;") +
      "</span></span>" +
      '<span class="row-leading"><span class="status-dot" role="img" aria-label="Idle">' +
      '<span aria-hidden="true"></span></span></span>';
    const controls = el("div", "row-controls");
    const more = el("button", "icon-btn");
    more.type = "button";
    more.setAttribute("aria-label", "More options for " + title);
    more.appendChild(icon("\ue061", "calc(1.25rem * var(--cds-rem-scale, 1))"));
    controls.appendChild(more);
    wrap.appendChild(row);
    wrap.appendChild(controls);
    chatList.appendChild(wrap);
  });

  /* ---------------------------------------------------------------- composer */
  const composer = $("#composer");
  const editor = $("#composer-editor");
  const placeholder = $("#composer-placeholder");

  const syncComposer = () => {
    const text = editor.textContent.replace(/\u200b/g, "").trim();
    const empty = text.length === 0;
    composer.classList.toggle("is-empty", empty);
    composer.classList.toggle("has-text", !empty);
    placeholder.hidden = !empty;
  };

  editor.addEventListener("input", syncComposer);
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (editor.textContent.trim()) {
        editor.textContent = "";
        syncComposer();
      }
    }
  });
  $("#composer").addEventListener("click", (e) => {
    if (e.target === composer || e.target.classList.contains("composer-box")) {
      editor.focus();
    }
  });
  syncComposer();

  /* segmented control */
  const surface = $("#surface-switch");
  const surfaceIndicator = $(".segmented-indicator", surface);
  const syncSegmented = () => {
    const active = $('.segmented-option[aria-checked="true"]', surface);
    if (!active) return;
    surfaceIndicator.style.width = active.offsetWidth + "px";
    surfaceIndicator.style.transform = "translateX(" + (active.offsetLeft - 1) + "px)";
  };
  $$(".segmented-option", surface).forEach((option) => {
    option.addEventListener("click", () => {
      $$(".segmented-option", surface).forEach((o) => o.setAttribute("aria-checked", String(o === option)));
      syncSegmented();
    });
  });
  window.addEventListener("resize", syncSegmented);
  requestAnimationFrame(syncSegmented);

  /* ------------------------------------------------------------- menu engine */
  /**
   * Minimal floating menu: anchored popup, portal rendered, escapes + outside
   * clicks close it, arrow keys move the highlight.
   */
  const Menus = {
    open: null,
    openMenu(anchor, menuEl, options) {
      this.close();
      const portal = $("#portal-root");
      const shell = el("div", "cds-root portal-shell");
      shell.setAttribute("data-cds", "portal");
      shell.setAttribute("data-mode", "dark");
      shell.setAttribute("data-cds-surface", "surface-3");
      shell.appendChild(menuEl);
      portal.appendChild(shell);

      let rect = anchor.getBoundingClientRect();
      const opts = options || {};
      if (opts.x !== undefined) rect = { left: opts.x, right: opts.x, top: opts.y, bottom: opts.y, width: 0, height: 0 };
      shell.style.position = "fixed";
      shell.style.inset = "0";
      shell.style.pointerEvents = "none";
      shell.style.zIndex = "120";

      const menuRect = menuEl.getBoundingClientRect();
      let top = rect.bottom + (opts.offset === undefined ? 4 : opts.offset);
      let left = opts.alignEnd ? rect.right - menuRect.width : rect.left;
      if (opts.preferLeft) left -= opts.preferLeft;
      if (opts.nudgeX) left += opts.nudgeX;
      if (!opts.ignoreClamp) {
        const maxLeft = window.innerWidth - menuRect.width - 8;
        left = Math.max(8, Math.min(left, maxLeft));
      }
      if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuRect.height - (opts.offset === undefined ? 4 : opts.offset));
      }

      menuEl.style.position = "absolute";
      menuEl.style.top = top + "px";
      menuEl.style.left = left + "px";
      menuEl.style.pointerEvents = "auto";

      const onPointerDown = (e) => {
        if (!shell.contains(e.target) && !anchor.contains(e.target)) this.close();
      };
      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          this.close();
          anchor.focus();
        }
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown);
      this.open = { shell, anchor, onPointerDown, onKeyDown };
      if (anchor.setAttribute) anchor.setAttribute("aria-expanded", "true");
    },
    close() {
      if (!this.open) return;
      const { shell, anchor, onPointerDown, onKeyDown } = this.open;
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      Submenus.hideAll();
      shell.remove();
      document.body.classList.remove("is-suggesting");
      if (anchor.setAttribute) anchor.setAttribute("aria-expanded", "false");
      this.open = null;
    }
  };

  /* ------------------------------------------------------- submenu manager
     One shared controller for every hover submenu. Each open menu registers
     its submenus here; opening one closes any other, and a single close timer
     owns the hide logic so nothing is left on screen after the pointer leaves. */
  const Submenus = {
    items: [],
    current: null,
    timer: 0,
    bound: false,

    reset() {
      this.items.forEach((it) => this.hideItem(it));
      this.items = [];
      this.current = null;
    },

    /* remove every open panel but keep the registrations */
    hideAll() {
      this.items.forEach((it) => this.hideItem(it));
      this.current = null;
    },

    register(row, build, opts) {
      const settings = opts || {};
      const item = { row, build, panel: null, click: !!settings.click };
      this.items.push(item);
      this.bindDelegation();
      if (item.click) {
        row.setAttribute("aria-haspopup", "menu");
        row.setAttribute("aria-expanded", "false");
        row.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.__submenuHandled = true;
          /* click only ever opens: a click while hovering must not close it */
          if (!item.panel) this.show(item);
        });
      }
      return item;
    },

    /* One document-level watcher pair, installed once. Hover and dismiss are
       decided from the live pointer position, so they cannot drift out of sync
       with the DOM the way per-element enter/leave timers can. */
    bindDelegation() {
      if (this.bound) return;
      this.bound = true;
      const self = this;
      const triggerFor = (target) => {
        if (!target || !target.closest) return null;
        const row = target.closest(".model-nav-row, .menu-item");
        return row ? self.items.find((it) => it.row === row) || null : null;
      };

      document.addEventListener(
        "pointerover",
        (e) => {
          const item = triggerFor(e.target);
          if (item) self.show(item);
        },
        true
      );

      document.addEventListener(
        "pointermove",
        (e) => {
          if (!self.items.some((it) => it.panel)) return;
          const onRow = self.items.some((it) => it.row.contains(e.target));
          const onPanel = self.items.some((it) => it.panel && it.panel.contains(e.target));
          if (onRow || onPanel) return;
          self.hideAll();
        },
        true
      );

      document.addEventListener(
        "click",
        (e) => {
          const item = triggerFor(e.target);
          if (!item || !item.clickDriven) return;
          if (e.__submenuHandled) return;
          e.preventDefault();
          if (!item.panel) self.show(item);
        },
        true
      );
    },

    show(item) {
      if (this.current === item && item.panel) return;
      this.items.forEach((it) => {
        if (it !== item) this.hideItem(it);
      });
      if (!item.panel) {
        item.panel = item.build();
        item.panel.classList.add("menu--submenu");
        item.panel.style.position = "absolute";
        item.panel.style.pointerEvents = "auto";
        const host = $(".portal-shell") || $("#portal-root").firstChild;
        if (host) host.appendChild(item.panel);
      }
      const r = item.row.getBoundingClientRect();
      const m = item.panel.getBoundingClientRect();
      let left = r.right + 8;
      if (left + m.width > window.innerWidth - 8) left = Math.max(8, r.left - 8 - m.width);
      let top = r.top;
      if (top + m.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - m.height);
      item.panel.style.left = left + "px";
      item.panel.style.top = top + "px";
      item.row.setAttribute("data-submenu-open", "true");
      item.row.setAttribute("aria-expanded", "true");
      this.current = item;
    },

    hideItem(item) {
      if (item.panel && item.panel.parentNode) item.panel.remove();
      item.panel = null;
      if (item.row) {
        item.row.removeAttribute("data-submenu-open");
        item.row.setAttribute("aria-expanded", "false");
      }
      if (this.current === item) this.current = null;
    }
  };

  const menuRow = (opts) => {
    const row = el("div", "menu-item");
    row.setAttribute("role", "menuitem");
    row.tabIndex = -1;
    if (opts.testid) row.setAttribute("data-testid", opts.testid);

    const lead = el("span", "menu-item-icon");
    lead.appendChild(icon(opts.icon || "\ue001"));
    row.appendChild(lead);

    const label = el("span", "menu-item-label");
    const inner = el("span", "menu-item-text");
    inner.textContent = opts.label;
    label.appendChild(inner);
    row.appendChild(label);

    if (opts.shortcut) {
      const trail = el("span", "menu-item-trailing");
      trail.innerHTML =
        '<span class="shortcut" aria-hidden="true">' +
        opts.shortcut.map((part) => (part === "+" ? "<span>+</span>" : "<kbd>" + part + "</kbd>")).join("") +
        "</span>";
      row.appendChild(trail);
    } else if (opts.checked) {
      const trail = el("span", "menu-item-trailing");
      const check = el("span", "menu-check");
      check.style.color = "var(--cds-text-accent)";
      check.appendChild(icon("\ue03b", "calc(1.25rem * var(--cds-rem-scale, 1))"));
      trail.appendChild(check);
      row.appendChild(trail);
    } else if (opts.submenu) {
      const trail = el("span", "menu-item-trailing");
      trail.appendChild(icon("\ue010", "calc(1rem * var(--cds-rem-scale, 1))"));
      row.appendChild(trail);
    }
    if (opts.onClick) row.addEventListener("click", opts.onClick);
    return row;
  };

  const menuSeparator = () => {
    const sep = el("div", "menu-separator");
    sep.setAttribute("role", "separator");
    return sep;
  };

  const buildMenu = (children) => {
    const menu = el("div", "menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-cds", "Menu");
    const sheet = el("div", "menu-sheet");
    children.forEach((c) => sheet.appendChild(c));
    menu.appendChild(sheet);
    return menu;
  };

  /* --------------------------------------------------------------- add menu */
  const addButton = $("#add-button");
  addButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (Menus.open && Menus.open.anchor === addButton) return Menus.close();
    Submenus.reset();

    const items = [
      menuRow({ label: "Upload or add files", icon: "\ue019", shortcut: ["Ctrl", "+", "U"], testid: "add-menu-upload-file", onClick: () => $("#file-input").click() }),
      menuRow({ label: "Take a screenshot", icon: "\ue025", testid: "add-menu-screenshot" }),
      menuRow({ label: "Add to project", icon: "\ue0c9", submenu: true, testid: "add-menu-project" }),
      menuSeparator(),
      menuRow({ label: "Skills", icon: "\ue0d2", submenu: true, testid: "add-menu-skills" }),
      menuRow({ label: "Add connector", icon: "\ue055", submenu: true, testid: "add-menu-connectors" }),
      menuRow({ label: "Design system", icon: "\ue0b8", submenu: true }),
      menuRow({ label: "Add plugins", icon: "\ue0c5", testid: "add-menu-plugins" }),
      menuSeparator(),
      menuRow({ label: "Web search", icon: "\ue082", checked: true, testid: "add-menu-web-search" })
    ];
    const menu = buildMenu(items);
    menu.classList.add("menu--add");

    /* hover submenus: project / connectors / skills / design system */
    const submenuMap = {
      "Add to project": {
        width: 292,
        items: [
          { label: "New project", icon: "\ue001", action: "new-project" },
          { label: "SC Drawer", icon: "\ue0c9" },
          { label: "Chibbit", icon: "\ue0c9" }
        ]
      },
      Skills: {
        width: 184,
        items: [
          { label: "google-workspace", icon: "\ue0d2" },
          { label: "import-memory", icon: "\ue0d2" },
          { label: "morning", icon: "\ue0d2" },
          { label: "skill-creator", icon: "\ue0d2" }
        ]
      },
      "Add connector": {
        width: 211,
        items: [
          { label: "Browse connectors", icon: "\ue055" },
          { label: "Add custom connector", icon: "\ue061" }
        ]
      },
      "Design system": {
        width: 211,
        items: [{ label: "Browse design systems", icon: "\ue0b8" }]
      }
    };

    $$(".menu-item", menu).forEach((row) => {
      const textEl = $(".menu-item-text", row);
      if (!textEl) return;
      const spec = submenuMap[textEl.textContent.trim()];
      if (!spec) return;
      Submenus.register(row, () => {
        const subMenu = buildMenu(
          spec.items.map((it) =>
            menuRow({
              label: it.label,
              icon: it.icon,
              onClick: it.action === "new-project" ? () => { Menus.close(); buildNewProjectDialog(); } : undefined
            })
          )
        );
        subMenu.style.width = spec.width + "px";
        return subMenu;
      });
    });

    Menus.openMenu(addButton, menu, { offset: -7 });
  });

  /* ------------------------------------------------------------- model menu */
  const modelButton = $("#model-button");
  modelButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (Menus.open && Menus.open.anchor === modelButton) return Menus.close();
    Submenus.reset();

    const rows = data.models.map((m) => {
      const row = el("button", "model-row");
      row.type = "button";
      if (m.selected) row.setAttribute("data-selected", "true");
      const head = el("span", "model-row-head");
      const name = el("span", "model-row-name");
      name.textContent = m.name;
      head.appendChild(name);
      if (m.badge) {
        const badge = el("span", "model-badge");
        badge.appendChild(icon("\ue08f", "calc(0.75rem * var(--cds-rem-scale, 1))"));
        const t = el("span", "model-badge-text");
        t.textContent = m.badge;
        badge.appendChild(t);
        head.appendChild(badge);
      }
      if (m.effort) {
        const effort = el("span", "model-row-effort");
        effort.textContent = m.effort;
        head.appendChild(effort);
      }
      row.appendChild(head);

      const desc = el("span", "model-row-desc");
      desc.textContent = m.desc;
      row.appendChild(desc);

      if (m.locked) {
        const up = el("span", "model-row-upgrade");
        up.textContent = "Upgrade";
        row.appendChild(up);
      }
      if (m.selected) {
        const check = el("span", "model-row-check");
        check.appendChild(icon("\ue03b", "calc(1.25rem * var(--cds-rem-scale, 1))"));
        row.appendChild(check);
      }
      row.addEventListener("click", () => {
        data.models.forEach((mm) => (mm.selected = mm === m));
        $(".model-selector-name > span:first-child").textContent = m.name;
        const eff = $(".model-effort");
        eff.textContent = m.effort || "Low";
        modelButton.setAttribute("aria-label", "Model: " + m.name + " " + (m.effort || "Low"));
        Menus.close();
      });
      return row;
    });

    const effortRow = el("button", "model-nav-row");
    effortRow.type = "button";
    effortRow.setAttribute("aria-haspopup", "menu");
    effortRow.setAttribute("aria-expanded", "false");
    const effortLabel = el("span");
    effortLabel.textContent = "Effort";
    const effortValue = el("span", "model-nav-value");
    effortValue.textContent = data.effort || "Low";
    effortRow.appendChild(effortLabel);
    effortRow.appendChild(effortValue);
    effortRow.appendChild(icon("\ue02a", "calc(1rem * var(--cds-rem-scale, 1))"));

    const moreRow = el("button", "model-nav-row");
    moreRow.type = "button";
    moreRow.setAttribute("aria-haspopup", "menu");
    moreRow.setAttribute("aria-expanded", "false");
    const moreLabel = el("span");
    moreLabel.textContent = "More models";
    moreRow.appendChild(moreLabel);
    moreRow.appendChild(icon("\ue02a", "calc(1rem * var(--cds-rem-scale, 1))"));

    const footer = el("div", "model-footer");
    footer.innerHTML =
      "Fable is included in Max and Ultra plans, and in Pro for a limited time. " +
      '<a href="#">Learn more</a>';

    const menu = el("div", "menu menu--models");
    menu.setAttribute("role", "menu");
    const sheet = el("div", "menu-sheet");
    rows.forEach((r) => sheet.appendChild(r));
    sheet.appendChild(menuSeparator());
    sheet.appendChild(effortRow);
    sheet.appendChild(menuSeparator());
    sheet.appendChild(moreRow);
    sheet.appendChild(menuSeparator());
    sheet.appendChild(footer);
    menu.appendChild(sheet);

    /* --- effort submenu (320px) ---------------------------------------- */
    const EFFORT_LEVELS = ["Low", "Medium", "High", "Extra", "Max"];
    const buildEffortMenu = () => {
      const panel = el("div", "menu menu--effort");
      panel.setAttribute("role", "menu");
      panel.setAttribute("aria-label", "Effort");
      const body = el("div", "menu-sheet");
      const note = el("p", "effort-note");
      note.textContent =
        "Higher effort means more thorough responses, but takes longer and uses your limits faster.";
      body.appendChild(note);

      const group = el("div", "effort-group");
      group.setAttribute("role", "group");
      EFFORT_LEVELS.forEach((level) => {
        const item = el("button", "menu-item effort-item");
        item.type = "button";
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", level === (data.effort || "Low") ? "true" : "false");
        const text = el("span", "effort-item-label");
        text.textContent = level;
        item.appendChild(text);
        if (level === "Medium") {
          const badge = el("span", "effort-badge");
          badge.textContent = "Recommended";
          item.appendChild(badge);
        }
        if (level === "Max") {
          const badge = el("span", "effort-badge effort-badge--warn");
          const warn = el("span", "effort-badge-icon");
          warn.setAttribute("aria-hidden", "true");
          warn.textContent = "\u26a0\ufe0e";
          badge.appendChild(warn);
          const t = el("span");
          t.textContent = "8\u00d7 or more usage";
          badge.appendChild(t);
          item.appendChild(badge);
        }
        if (level === (data.effort || "Low")) {
          const check = el("span", "effort-check");
          check.appendChild(icon("\ue03b", "calc(1.25rem * var(--cds-rem-scale, 1))"));
          item.appendChild(check);
        }
        item.addEventListener("click", (ev) => {
          ev.stopPropagation();
          data.effort = level;
          effortValue.textContent = level;
          const live = $(".model-effort");
          if (live) live.textContent = level;
          modelButton.setAttribute(
            "aria-label",
            "Effort: " + level
          );
          Menus.close();
        });
        group.appendChild(item);
      });
      body.appendChild(group);
      panel.appendChild(body);
      return panel;
    };

    /* --- more models submenu (278px) ------------------------------------ */
    const MORE_MODELS = [
      { name: "Fable 5.1", note: "Pro, Max, or Ultra", upgrade: true },
      { name: "Fable 5", note: "Pro, Max, or Ultra", upgrade: true },
      { name: "Opus 5", badge: "Pro", upgrade: true },
      { name: "Opus 4.8", badge: "Pro", upgrade: true },
      { name: "Opus 4.7", badge: "Pro", upgrade: true },
      { name: "Opus 4.6", badge: "Pro", upgrade: true },
      { name: "Opus 3", badge: "Pro", upgrade: true },
      { name: "Sonnet 5" },
      { name: "Sonnet 4.6" }
    ];
    const buildMoreModels = () => {
      const panel = el("div", "menu menu--more-models");
      panel.setAttribute("role", "menu");
      panel.setAttribute("aria-label", "More models");
      const body = el("div", "menu-sheet");
      const group = el("div", "more-models-group");
      group.setAttribute("role", "group");
      MORE_MODELS.forEach((m) => {
        const item = el("button", "menu-item more-model-item");
        item.type = "button";
        item.setAttribute("role", "menuitem");
        const name = el("span", "more-model-name");
        name.textContent = m.name;
        item.appendChild(name);
        if (m.note) {
          const info = el("span", "more-model-info");
          info.appendChild(icon("\ue08f", "calc(0.75rem * var(--cds-rem-scale, 1))"));
          const t = el("span", "more-model-note");
          t.textContent = m.note;
          info.appendChild(t);
          item.appendChild(info);
        }
        if (m.badge) {
          const badge = el("span", "more-model-badge");
          badge.textContent = m.badge;
          item.appendChild(badge);
        }
        if (m.upgrade) {
          const up = el("span", "more-model-upgrade");
          up.textContent = "Upgrade";
          item.appendChild(up);
        }
        item.addEventListener("click", (ev) => {
          ev.stopPropagation();
          $(".model-selector-name > span:first-child").textContent = m.name;
          modelButton.setAttribute("aria-label", "Model: " + m.name);
          Menus.close();
        });
        group.appendChild(item);
      });
      body.appendChild(group);
      panel.appendChild(body);
      return panel;
    };

    /* both open on hover and toggle on click, so a click always works */
    Submenus.register(effortRow, buildEffortMenu, { click: true });
    Submenus.register(moreRow, buildMoreModels, { click: true });

    Menus.openMenu(modelButton, menu, { offset: -7, alignEnd: true, nudgeX: 8, ignoreClamp: true });
  });

  /* ------------------------------------------------------------- picker shell */
  const pickerShell = () => {
    const shell = $("#portal-root").firstChild;
    return shell;
  };

  /* ------------------------------------------------------- suggestion sheet */
  const chips = $$(".chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      /* textContent includes the icon glyph, so read the label span instead */
      const labelEl = chip.querySelector(".chip-label") || chip.lastElementChild;
      const category = (labelEl.textContent || "").trim();
      /* clicking an open chip closes it */
      if (chip.getAttribute("data-active") === "true") {
        chip.removeAttribute("data-active");
        Menus.close();
        return;
      }
      chips.forEach((c) => c.removeAttribute("data-active"));
      chip.setAttribute("data-active", "true");

      const panelItems = (data.suggestions[category] || []).map((text) => {
        const li = el("li", "suggestion-li");
        const row = el("button", "suggestion-item");
        row.type = "button";
        const t = el("span", "suggestion-text");
        t.textContent = text;
        row.appendChild(t);
        row.appendChild(icon("\ue02a", "calc(1rem * var(--cds-rem-scale, 1))"));
        row.addEventListener("click", () => {
          editor.textContent = text;
          syncComposer();
          Menus.close();
          chip.removeAttribute("data-active");
          editor.focus();
        });
        li.appendChild(row);
        return li;
      });

      /* panel shell: header (category + close) then the suggestion list */
      const menu = el("div", "menu menu--suggestions");
      menu.setAttribute("role", "dialog");
      menu.setAttribute("aria-label", category + " suggestions");
      const sheet = el("div", "menu-sheet ss-sheet");
      const header = el("div", "ss-header");
      const headLead = el("div", "ss-head-lead");
      headLead.appendChild(icon("\ue064", "calc(0.875rem * var(--cds-rem-scale, 1))"));
      const headTitle = el("span", "ss-title");
      headTitle.textContent = category;
      headLead.appendChild(headTitle);
      header.appendChild(headLead);
      const closeBtn = el("button", "ss-close");
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.appendChild(icon("\ue10f", "calc(1.25rem * var(--cds-rem-scale, 1))"));
      closeBtn.addEventListener("click", () => {
        Menus.close();
        chip.removeAttribute("data-active");
      });
      header.appendChild(closeBtn);
      sheet.appendChild(header);
      const list = el("ul", "ss-list");
      panelItems.forEach((li) => list.appendChild(li));
      sheet.appendChild(list);
      menu.appendChild(sheet);

      /* anchored to the composer column, 16px under the chips row */
      const col = $(".composer-box").getBoundingClientRect();
      document.body.classList.add("is-suggesting");
      Menus.openMenu(chip, menu, { offset: 0, x: col.left, y: col.bottom + 40 });
    });
  });

  /* --------------------------------------------------------------- dialogs */
  /* Shared modal shell: overlay + panel, Escape / backdrop / [data-close]. */
  const openModal = (modal, opts) => {
    const options = opts || {};
    const overlay = el("div", "modal-overlay");
    if (options.className) overlay.classList.add(options.className);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-open"));

    const close = () => {
      if (!document.body.contains(overlay)) return;
      overlay.classList.remove("is-open");
      setTimeout(() => overlay.remove(), 150);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-close]")) close();
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    const observer = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        document.removeEventListener("keydown", onKey);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
    return { overlay, close };
  };

  /* ------------------------------------------------------ create-a-project */
  const buildNewProjectDialog = () => {
    const modal = el("div", "dialog dialog--project");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "new-project-title");

    const head = el("div", "dialog-head");
    const title = el("h2", "dialog-title");
    title.id = "new-project-title";
    title.textContent = "Create a project";
    head.appendChild(title);
    const closeX = el("button", "dialog-close");
    closeX.type = "button";
    closeX.setAttribute("aria-label", "Close");
    closeX.setAttribute("data-close", "");
    closeX.appendChild(icon("\ue10f", "calc(1.25rem * var(--cds-rem-scale, 1))"));
    head.appendChild(closeX);
    modal.appendChild(head);

    const body = el("div", "dialog-body");

    const nameLabel = el("label", "dialog-label");
    nameLabel.setAttribute("for", "project-name");
    nameLabel.textContent = "What are you working on?";
    body.appendChild(nameLabel);
    const nameInput = el("input", "dialog-input");
    nameInput.id = "project-name";
    nameInput.type = "text";
    nameInput.placeholder = "Name your project";
    body.appendChild(nameInput);

    const goalLabel = el("label", "dialog-label");
    goalLabel.setAttribute("for", "project-goal");
    goalLabel.textContent = "What are you trying to achieve?";
    body.appendChild(goalLabel);
    const goalInput = el("textarea", "dialog-textarea");
    goalInput.id = "project-goal";
    goalInput.placeholder = "Describe your project, goals, subject, etc...";
    goalInput.rows = 3;
    body.appendChild(goalInput);

    modal.appendChild(body);

    const actions = el("div", "dialog-actions");
    const cancel = el("button", "btn-ghost");
    cancel.type = "button";
    cancel.setAttribute("data-close", "");
    cancel.textContent = "Cancel";
    const create = el("button", "btn-solid");
    create.type = "button";
    create.textContent = "Create project";
    actions.appendChild(cancel);
    actions.appendChild(create);
    modal.appendChild(actions);

    const popup = openModal(modal);
    create.addEventListener("click", () => popup.close());
    setTimeout(() => nameInput.focus(), 60);
    return popup;
  };

  /* ------------------------------------------------------------ cowork sheet */
  const coworkOption = $('.segmented-option[data-value="cowork"]');
  coworkOption.addEventListener("click", () => {
    if (coworkOption.getAttribute("data-prompted") === "true") return;
    coworkOption.setAttribute("data-prompted", "true");

    const overlay = el("div", "modal-overlay");
    const modal = el("div", "cowork-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "cowork-title");

    const closeX = el("button", "modal-close");
    closeX.type = "button";
    closeX.setAttribute("aria-label", "Close");
    closeX.setAttribute("data-close", "");
    closeX.appendChild(icon("\ue10f", "calc(1.25rem * var(--cds-rem-scale, 1))"));
    modal.appendChild(closeX);

    /* --- hero: illustrated light panel ---------------------------------- */
    const art = el("div", "cowork-art");
    const expand = el("button", "cowork-expand");
    expand.type = "button";
    expand.setAttribute("aria-label", "Expand");
    expand.appendChild(icon("\ue023", "calc(1rem * var(--cds-rem-scale, 1))"));
    art.appendChild(expand);

    const bolt = el("span", "cowork-bolt");
    bolt.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true">' +
      '<path d="M11.9 1 4 11.2h4.3L7.1 19l8-10.3h-4.4L11.9 1Z"></path></svg>';
    art.appendChild(bolt);

    const artTitle = el("div", "cowork-art-title");
    artTitle.textContent = "Let\u2019s knock something off your list";
    art.appendChild(artTitle);

    const cards = el("div", "cowork-cards");
    [
      ["Create a file", "\ue026"],
      ["Crunch data", "\ue009"],
      ["Make a prototype", "\ue0e1"],
      ["Prep for the day", "\ue024"],
      ["Organize files", "\ue072"],
      ["Send a message", "\ue037"]
    ].forEach(([label, cp]) => {
      const card = el("div", "cowork-card");
      card.appendChild(icon(cp, "calc(1.25rem * var(--cds-rem-scale, 1))"));
      const t = el("span", "cowork-card-label");
      t.textContent = label;
      card.appendChild(t);
      cards.appendChild(card);
    });
    art.appendChild(cards);
    const heroBadge = el("span", "cowork-hero-badge");
    heroBadge.appendChild(icon("\ue0bb", "calc(1.25rem * var(--cds-rem-scale, 1))"));
    art.appendChild(heroBadge);
    modal.appendChild(art);

    /* --- body ------------------------------------------------------------ */
    const body = el("div", "cowork-body");
    const h2 = el("h2", "cowork-title");
    h2.id = "cowork-title";
    h2.textContent = "Don\u2019t just chat. Cowork.";
    body.appendChild(h2);
    const p = el("p", "cowork-desc");
    p.textContent =
      "With Cowork, Claude tackles complex tasks independently. It can organize files, draft docs, and more.";
    body.appendChild(p);
    const ul = el("ul", "cowork-list");
    [
      "Point Claude at a folder and let it work",
      "Runs in the background while you do other things",
      "Claude checks in when it needs your input"
    ].forEach((line) => {
      const li = el("li");
      li.textContent = line;
      ul.appendChild(li);
    });
    body.appendChild(ul);

    const actions = el("div", "cowork-actions");
    const later = el("button", "btn-secondary");
    later.type = "button";
    later.textContent = "Later";
    later.setAttribute("data-close", "");
    const upgrade = el("button", "btn-primary");
    upgrade.type = "button";
    upgrade.textContent = "Upgrade";
    upgrade.setAttribute("data-close", "");
    actions.appendChild(later);
    actions.appendChild(upgrade);
    body.appendChild(actions);
    modal.appendChild(body);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-open"));

    const close = () => {
      overlay.classList.remove("is-open");
      setTimeout(() => overlay.remove(), 150);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-close], .modal-close")) close();
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && document.body.contains(overlay)) close();
      },
      { once: true }
    );
  });

  /* ------------------------------------------------------------- misc wiring */
  /* click outside a menu closes it (Menus handles this) */
  document.addEventListener("click", (e) => {
    if (Menus.open && !e.target.closest(".menu, .modal-overlay")) {
      const anchor = Menus.open.anchor;
      if (anchor && !anchor.contains(e.target)) {
        const chip = anchor.closest && anchor.closest(".chip");
        if (chip) chip.removeAttribute("data-active");
      }
    }
  });

  /* file input used by "Upload or add files" */
  const fileInput = $("#file-input");

  /* keep the composer placeholder in sync after zoom/font changes */
  window.addEventListener("resize", syncComposer);
})();

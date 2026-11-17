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
      shell.remove();
      document.body.classList.remove("is-suggesting");
      if (anchor.setAttribute) anchor.setAttribute("aria-expanded", "false");
      this.open = null;
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

    /* hover submenus: project / connectors / skills */
    const submenuMap = {
      "Add to project": [
        { label: "Browse projects", icon: "\ue0c9" },
        { label: "New project", icon: "\ue001" }
      ],
      "Add connector": [
        { label: "Browse connectors", icon: "\ue096" },
        { label: "Add custom connector", icon: "\ue061" }
      ],
      Skills: [
        { label: "Create skill", icon: "\ue001" },
        { label: "Manage skills", icon: "\ue100" }
      ],
      "Design system": [{ label: "Browse design systems", icon: "\ue0b8" }]
    };

    $$(".menu-item", menu).forEach((row) => {
      const label = $(".menu-item-text", row).textContent;
      const sub = submenuMap[label];
      if (!sub) return;
      let subEl = null;
      row.addEventListener("mouseenter", () => {
        if (subEl) return;
        const subMenu = buildMenu(sub.map((s) => menuRow({ label: s.label, icon: s.icon })));
        subMenu.classList.add("menu--submenu");
        const r = row.getBoundingClientRect();
        $("#portal-root").firstChild.appendChild(subMenu);
        subMenu.style.position = "absolute";
        subMenu.style.top = r.top + "px";
        subMenu.style.left = r.right + 4 + "px";
        subMenu.style.pointerEvents = "auto";
        subEl = subMenu;
        row.setAttribute("data-submenu-open", "true");
      });
      row.addEventListener("mouseleave", () => {
        if (!subEl) return;
        setTimeout(() => {
          if (subEl && !subEl.matches(":hover") && !row.matches(":hover")) {
            subEl.remove();
            subEl = null;
            row.removeAttribute("data-submenu-open");
          }
        }, 120);
      });
      if (subEl) subEl.addEventListener("mouseleave", () => {
        subEl.remove();
        subEl = null;
        row.removeAttribute("data-submenu-open");
      });
    });

    Menus.openMenu(addButton, menu, { offset: 17 });
  });

  /* ------------------------------------------------------------- model menu */
  const modelButton = $("#model-button");
  modelButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (Menus.open && Menus.open.anchor === modelButton) return Menus.close();

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
    effortRow.innerHTML = '<span>Effort</span><span class="model-nav-value">Low' + '</span>';
    effortRow.appendChild(icon("\ue02a", "calc(1rem * var(--cds-rem-scale, 1))"));

    const moreRow = el("button", "model-nav-row");
    moreRow.type = "button";
    moreRow.innerHTML = '<span>More models</span>';
    moreRow.appendChild(icon("\ue02a", "calc(1rem * var(--cds-rem-scale, 1))"));

    const footer = el("div", "model-footer");
    footer.innerHTML =
      "Fable is included in Max and Ultra plans, and in Pro for a limited time. " +
      '<a href="#">Learn more</a>';

    const menu = el("div", "menu menu--models");
    menu.setAttribute("role", "menu");
    const sheet = el("div", "menu-sheet");
    rows.forEach((r) => sheet.appendChild(r));
    const sep1 = menuSeparator();
    sheet.appendChild(sep1);
    sheet.appendChild(effortRow);
    const sepMid = menuSeparator();
    sheet.appendChild(sepMid);
    sheet.appendChild(moreRow);
    const sep2 = menuSeparator();
    sheet.appendChild(sep2);
    sheet.appendChild(footer);
    menu.appendChild(sheet);

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

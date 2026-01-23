Hooks.once("init", function () {
  if (typeof libWrapper !== "undefined") {
    libWrapper.register(
      "axeom-hud-pf2e",
      "DetectionMode.prototype.testVisibility",
      function (wrapped, visionSource, mode, { object, tests }) {
        const src = visionSource.object.document;
        const srcActorId = src.actor?.id;
        const flag = object?.document?.getFlag("axeom-hud-pf2e", "conditional-visibility-actors") ?? [];
        if (srcActorId && flag.includes(srcActorId)) return false;
        return wrapped(visionSource, mode, { object, tests });
      },
      "MIXED"
    );
  } else {
    const originalTestVisibility = DetectionMode.prototype.testVisibility;
    DetectionMode.prototype.testVisibility = function (visionSource, mode, config) {
      const src = visionSource.object.document;
      const srcActorId = src.actor?.id;
      const flag = config.object?.document?.getFlag("axeom-hud-pf2e", "conditional-visibility-actors") ?? [];
      if (srcActorId && flag.includes(srcActorId)) return false;
      return originalTestVisibility.call(this, visionSource, mode, config);
    };
  }
});

Hooks.on("refreshToken", (token) => {
  if (!game.user.isGM) return;
  const flag = token.document.getFlag("axeom-hud-pf2e", "conditional-visibility-actors") ?? [];
  const hasConditionalVisibility = flag.length > 0;
  if (hasConditionalVisibility && !token.document.hidden) {
    token.mesh.alpha = 0.5;
  }
});

class AxTokenHud extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.hud.BasePlaceableHUD,
) {
  static DEFAULT_OPTIONS = {
    id: "token-hud",
    actions: {
      togglePalette: AxTokenHud.prototype._onTogglePalette,
      effect: { handler: AxTokenHud.prototype._onToggleEffect, buttons: [0, 2] },
      incrementEffect: AxTokenHud.prototype._onIncrementEffect,
      decrementEffect: AxTokenHud.prototype._onDecrementEffect,
      visibility: { handler: AxTokenHud.prototype._onToggleVisibility, buttons: [0, 2] },
      conditionalVisibilityAll: { handler: AxTokenHud.prototype._onConditionalVisibilityAll, buttons: [0, 2] },
      conditionalVisibilityToken: { handler: AxTokenHud.prototype._onConditionalVisibilityToken, buttons: [0, 2] },
      combat: AxTokenHud.prototype._onToggleCombat,
      clownCar: AxTokenHud.prototype._onToggleClownCar,
      target: AxTokenHud.prototype._onToggleTarget,
      sort: AxTokenHud.prototype._onSort,
      config: AxTokenHud.prototype._onConfig,
      focusInput: AxTokenHud.prototype._onFocusInput,
    },
  };

  static PARTS = {
    hud: { root: true, template: "modules/axeom-hud-pf2e/templates/TokenHUD.hbs" },
  };

  constructor(...args) {
    super(...args);
    this._cachedTags = null;
    this._lastEffectsUpdateHash = null;
    this._paletteStates = new Map();
    this._submenuTimeout = null;
    this._statusEffectsCache = null;
    this._conditionalVisibilityCache = null;
    this._els = null;
    this._boundSearchInput = null;
    this._boundSearchKeydown = null;
  }

  get actor() { return this.document?.actor; }
  bind(object) { return super.bind(object); }
  _insertElement(element) { document.body.appendChild(element); }

  async render(force = false, options = {}) {
    const openSubmenu = this.element?.querySelector(".ax-th-submenu.ax-th-active");
    let openSubmenuClass = null;
    if (openSubmenu?.classList.contains("ax-th-status-effects")) {
      openSubmenuClass = "ax-th-status-effects";
    } else if (openSubmenu?.classList.contains("ax-th-conditional-visibility")) {
      openSubmenuClass = "ax-th-conditional-visibility";
    }
    const searchInput = openSubmenu?.querySelector("[data-effect-search='true']");
    const searchValue = searchInput?.value;
    const searchWasFocused = searchInput && document.activeElement === searchInput;
    const selectedItem = openSubmenu?.querySelector(".ax-th-submenu-item.ax-th-selected");
    const selectedStatusId = selectedItem?.dataset?.statusId;
    const scrollTop = openSubmenu?.scrollTop ?? 0;
    const result = await super.render(force, options);
    if (openSubmenuClass && this.element) {
      const submenu = this.element.querySelector(`.ax-th-submenu.${openSubmenuClass}`);
      const trigger = submenu?.previousElementSibling;
      if (submenu && trigger) {
        this._showSubmenu(trigger, submenu, true);
        submenu.scrollTop = scrollTop;
        if (openSubmenuClass === "ax-th-status-effects") {
          const search = submenu.querySelector("[data-effect-search='true']");
          if (searchValue !== undefined && search) {
            search.value = searchValue;
            const query = searchValue.trim().toLowerCase();
            const items = submenu.querySelectorAll(".ax-th-submenu-item.ax-th-effect-control");
            for (const el of items) {
              const name = (el.dataset.effectName ?? "").toLowerCase();
              const match = !query || name.includes(query);
              el.classList.toggle("ax-th-filtered-out", !match);
              el.classList.remove("ax-th-selected");
            }
            const itemToSelect = selectedStatusId
              ? submenu.querySelector(`.ax-th-submenu-item[data-status-id="${selectedStatusId}"]:not(.ax-th-filtered-out)`)
              : Array.from(items).find((el) => !el.classList.contains("ax-th-filtered-out"));
            if (itemToSelect && !itemToSelect.classList.contains("ax-th-filtered-out")) {
              itemToSelect.classList.add("ax-th-selected");
            }
            // Restore focus to search input if it was focused before render
            if (searchWasFocused) {
              search.focus({ preventScroll: true });
            }
          }
        }
      }
    }
    this._cacheElements();
    return result;
  }

  _cacheElements() {
    if (!this.element) return;
    this._els = {
      statusSubmenu: this.element.querySelector(".ax-th-submenu.ax-th-status-effects"),
      visibilitySubmenu: this.element.querySelector(".ax-th-submenu.ax-th-conditional-visibility"),
      searchInput: this.element.querySelector("[data-effect-search='true']"),
      effectItems: null, // Lazy-loaded
    };
  }

  _getEffectItems() {
    if (!this._els?.statusSubmenu) return [];
    if (!this._els.effectItems) {
      this._els.effectItems = this._els.statusSubmenu.querySelectorAll(".ax-th-submenu-item.ax-th-effect-control");
    }
    return this._els.effectItems;
  }

  async close(options = {}) {
    if (this.element) this.element.classList.add("ax-th-closing");
    if (this._submenuTimeout) { clearTimeout(this._submenuTimeout); this._submenuTimeout = null; }
    if (this.object && !options.skipRelease) this.object.release();
    this._cleanupInputs();
    this._clearCaches();
    this._els = null;
    return await super.close(options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("focusout", ".ax-th-bar-input, .ax-th-elevation-input", this._onInputBlur.bind(this));
    html.on("keydown", ".ax-th-bar-input, .ax-th-elevation-input", this._onInputKeydown.bind(this));
    html.on("keydown", ".ax-th-submenu", this._onSubmenuKeydown.bind(this));

    html.on("mouseenter", ".ax-th-menu-item.ax-th-submenu-trigger", this._onSubmenuEnter.bind(this));
    html.on("mouseleave", ".ax-th-menu-item.ax-th-submenu-trigger", this._onSubmenuLeave.bind(this));
    html.on("mouseenter", ".ax-th-submenu", this._onSubmenuContentEnter.bind(this));
    html.on("mouseleave", ".ax-th-submenu", this._onSubmenuContentLeave.bind(this));
    html.on("mouseenter", ".ax-th-conditional-visibility-token", this._onConditionalVisibilityTokenHover.bind(this));
    html.on("mouseleave", ".ax-th-conditional-visibility-token", this._onConditionalVisibilityTokenHoverOut.bind(this));
    html.on("mouseleave", this._onHudMouseLeave.bind(this));
    setTimeout(() => { this._selectFirstMenuItem(); }, 100);
  }

  _selectFirstMenuItem() {
    // Select first interactive menu item for keyboard navigation hints
    const firstItem = this.element?.querySelector(".ax-th-menu-item:not(.ax-th-bar-item):not(.ax-th-elevation-item)");
    if (firstItem) {
      firstItem.classList.add("ax-th-keyboard-selected");
    }
  }

  _onInputBlur(event) {
    const input = event.currentTarget;
    input.classList.remove("ax-th-active", "ax-th-focused");
  }

  _onInputKeydown(event) {
    if (event.key === "Escape") { event.currentTarget.blur(); event.preventDefault(); }
  }

  _onFocusInput(event, target) {
    const input = target.querySelector("input");
    if (input && !input.disabled) {
      input.focus();
      input.select();
    }
  }

  _onEffectSearchInput(event) {
    const query = event.currentTarget.value.trim().toLowerCase();
    const submenu = this._els?.statusSubmenu ?? this.element?.querySelector(".ax-th-submenu.ax-th-status-effects");
    if (!submenu) return;
    const items = this._getEffectItems();

    requestAnimationFrame(() => {
      let firstVisible = null;
      for (const el of items) {
        const name = (el.dataset.effectName ?? "").toLowerCase();
        const match = !query || name.includes(query);
        el.classList.toggle("ax-th-filtered-out", !match);
        if (match && !firstVisible) firstVisible = el;
      }
      // Auto-select first visible if nothing selected
      if (firstVisible && !submenu.querySelector(".ax-th-submenu-item.ax-th-selected:not(.ax-th-filtered-out)")) {
        submenu.querySelectorAll(".ax-th-submenu-item.ax-th-selected").forEach(el => el.classList.remove("ax-th-selected"));
        firstVisible.classList.add("ax-th-selected");
      }
    });
  }

  _onEffectSearchKeydown(event) {
    const submenu = this._els?.statusSubmenu ?? this.element?.querySelector(".ax-th-submenu.ax-th-status-effects");
    if (!submenu) return;
    if (event.key === "Escape") {
      const trigger = submenu.previousElementSibling;
      this._hideSubmenu(trigger, submenu);
      // Allow the default Escape behavior (token deselection)
      return;
    }
    const items = this._getEffectItems();
    const visible = Array.from(items).filter((el) => !el.classList.contains("ax-th-filtered-out"));
    if (!visible.length) return;
    let currentIndex = visible.findIndex((el) => el.classList.contains("ax-th-selected"));
    const moveSelection = (delta) => {
      if (currentIndex === -1) currentIndex = 0;
      else currentIndex = (currentIndex + delta + visible.length) % visible.length;
      for (const el of items) el.classList.remove("ax-th-selected");
      visible[currentIndex].classList.add("ax-th-selected");
      visible[currentIndex].scrollIntoView({ block: "nearest" });
    };
    if (event.key === "ArrowDown") { moveSelection(1); event.preventDefault(); }
    else if (event.key === "ArrowUp") { moveSelection(-1); event.preventDefault(); }
    else if (event.key === "Enter") {
      const target = visible[currentIndex >= 0 ? currentIndex : 0];
      if (target) {
        if (event.metaKey || event.ctrlKey) {
          this._onToggleEffect({ button: 0, preventDefault() {} }, target);
          const trigger = submenu.previousElementSibling;
          this._hideSubmenu(trigger, submenu);
          event.preventDefault();
        } else if (event.shiftKey) {
          this._onToggleEffect({ button: 2, preventDefault() {} }, target);
          event.preventDefault();
        } else {
          this._onToggleEffect({ button: 0, preventDefault() {} }, target);
          event.preventDefault();
        }
      }
    }
  }

  _onSubmenuKeydown(event) {
    if (event.key === "Escape") {
      const submenu = event.currentTarget.closest(".ax-th-submenu");
      if (submenu) {
        const trigger = submenu.previousElementSibling;
        this._hideSubmenu(trigger, submenu);
      }
    }
  }

  setPosition(position = {}) {
    if (!this.object || !this.element) return position;
    const token = this.object;
    const tokenDoc = token.document;
    const gridSize = canvas.grid.size;
    const tokenX = tokenDoc.x;
    const tokenY = tokenDoc.y;
    const tokenWidth = tokenDoc.width * gridSize;
    const tokenHeight = tokenDoc.height * gridSize;
    const topLeft = canvas.clientCoordinatesFromCanvas({ x: tokenX, y: tokenY });
    const bottomRight = canvas.clientCoordinatesFromCanvas({ x: tokenX + tokenWidth, y: tokenY + tokenHeight });
    const tokenScreenWidth = bottomRight.x - topLeft.x;
    const tokenScreenHeight = bottomRight.y - topLeft.y;
    let left = topLeft.x + tokenScreenWidth + 15;
    let top = topLeft.y + tokenScreenHeight / 2;
    const padding = 20;
    const hudWidth = 240;
    const hudHeight = 200;
    if (left + hudWidth > window.innerWidth - padding) left = topLeft.x - hudWidth - 15;
    const finalLeft = Math.max(padding, Math.min(left, window.innerWidth - hudWidth - padding));
    const finalTop = Math.max(padding, Math.min(top, window.innerHeight - hudHeight - padding));
    this.element.style.position = 'fixed';
    this.element.style.left = `${finalLeft}px`;
    this.element.style.top = `${finalTop}px`;
    this.element.style.transform = 'none';
    this.element.style.scale = '1';
    this.position.left = finalLeft;
    this.position.top = finalTop;
    return this.position;
  }

  _cleanupInputs() {
    if (!this.element) return;
    const activeInputs = this.element.querySelectorAll("input:focus");
    activeInputs.forEach((input) => { input.blur(); input.value = input.defaultValue; });
    const allInputs = this.element.querySelectorAll("input");
    allInputs.forEach((input) => { input.classList.remove("ax-th-active", "ax-th-focused"); });
  }

  _clearCaches() {
    this._paletteStates?.clear();
    this._statusEffectsCache = null;
    this._conditionalVisibilityCache = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const token = this.object;
    const actor = token?.actor;
    if (!token || !actor) return context;
    const bar1 = this.document.getBarAttribute("bar1");
    const bar2 = this.document.getBarAttribute("bar2");
    const finalContext = foundry.utils.mergeObject(context, {
      actorName: actor.name,
      displayBar1: bar1 && bar1.type !== "none",
      bar1Data: bar1,
      displayBar2: bar2 && bar2.type !== "none",
      bar2Data: bar2,
      statusEffects: this._getStatusEffects(),
      hidden: this.document.hidden,
      visibilityClass: this.document.hidden ? "ax-th-active" : "",
      elevation: this.document.elevation,
      locked: this.document.locked,
      ...this._getConditionalVisibilityData(),
      inCombat: this.document.inCombat,
      canToggleCombat: game.combat !== null || !this.document.inCombat,
      combatClass: this.document.inCombat ? "ax-th-active" : "",
      targetClass: game.user.targets.has(this.object) ? "ax-th-active" : "",
      isGM: game.user.isGM,
      canConfigure: game.user.can("TOKEN_CONFIGURE"),
      isGamePaused: game.paused,
      ...this._getPartyClownCarData(),
    });
    return finalContext;
  }

  _getStatusEffects() {
    // Check cache validity
    const cacheKey = this._computeStatusEffectsCacheKey();
    if (this._statusEffectsCache?.key === cacheKey) {
      return this._statusEffectsCache.value;
    }

    const choices = {};
    for (const status of CONFIG.statusEffects) {
      if (status.hud === false || (foundry.utils.getType(status.hud) === "Object" && status.hud.actorTypes?.includes(this.document.actor.type) === false)) continue;
      // Check if this is a pf2e condition
      const pf2eCondition = game.pf2e?.ConditionManager?.getCondition?.(status.id);
      const isValued = pf2eCondition?.system?.value?.isValued ?? false;
      choices[status.id] = {
        _id: status._id,
        id: status.id,
        title: game.i18n.localize(status.name ?? status.label),
        src: status.img ?? status.icon,
        isActive: false,
        isOverlay: false,
        isValued: isValued,
      };
    }
    if (this.actor?.conditions) {
      const activeConditions = this.actor.conditions.active;
      for (const condition of activeConditions) {
        const status = choices[condition.slug];
        if (status && condition.isInHUD) {
          status.isActive = true;
          if (condition.value !== undefined && typeof condition.value === "number") status.value = condition.value;
        }
      }
    }
    // Check ActiveEffects for non-2e status effects
    const activeEffects = this.actor?.effects ?? [];
    for (const effect of activeEffects) {
      for (const statusId of effect.statuses) {
        const status = choices[statusId];
        if (!status || status.isActive) continue;
        if (status._id) { if (status._id !== effect.id) continue; }
        else { if (effect.statuses.size !== 1) continue; }
        status.isActive = true;
        if (effect.getFlag("core", "overlay")) status.isOverlay = true;
        break;
      }
    }
    const result = Object.values(choices).map((status) => ({
      id: status.id,
      title: status.title,
      src: status.src,
      value: status.value,
      isActive: status.isActive,
      isValued: status.isValued,
      cssClass: [status.isActive ? "ax-th-active" : null, status.isOverlay ? "ax-th-overlay" : null].filterJoin(" "),
    }));

    // Cache the result
    this._statusEffectsCache = { key: cacheKey, value: result };
    return result;
  }

  _computeStatusEffectsCacheKey() {
    const actorId = this.actor?.id ?? "";
    const conditions = this.actor?.conditions?.active?.map(c => `${c.slug}:${c.value ?? 0}`).join(",") ?? "";
    const effects = this.actor?.effects?.map(e => `${e.id}:${Array.from(e.statuses).join("|")}`).join(",") ?? "";
    return `${actorId}|${conditions}|${effects}`;
  }

  _getConditionalVisibilityData() {
    // Check cache validity
    const cacheKey = this._computeConditionalVisibilityCacheKey();
    if (this._conditionalVisibilityCache?.key === cacheKey) {
      return this._conditionalVisibilityCache.value;
    }

    const flag = this.document.getFlag("axeom-hud-pf2e", "conditional-visibility-actors") ?? [];
    const currentActorId = this.document.actor?.id;
    const isHiddenFromAll = this.document.hidden;
    let partyMembers = [];
    const partyActor = game.actors.party;
    if (partyActor?.members) partyMembers = Array.from(partyActor.members);
    if (partyMembers.length === 0) partyMembers = game.actors.filter((a) => a.hasPlayerOwner);
    const actors = partyMembers
      .filter((a) => a.id !== currentActorId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({
        id: a.id,
        name: a.name,
        img: a.prototypeToken?.texture?.src ?? a.img,
        isHidden: flag.includes(a.id),
        cssClass: flag.includes(a.id) ? "ax-th-active" : "",
      }));
    const hiddenCount = actors.filter((a) => a.isHidden).length;
    const totalCount = actors.length;
    const hiddenFromAllActors = totalCount > 0 && hiddenCount === totalCount;
    let conditionalVisibilityLabel;
    let conditionalVisibilityActive = false;
    if (isHiddenFromAll) {
      conditionalVisibilityLabel = "Hidden from all";
      conditionalVisibilityActive = true;
    } else if (hiddenFromAllActors) {
      conditionalVisibilityLabel = "Hidden from all";
      conditionalVisibilityActive = true;
    } else if (hiddenCount > 0) {
      conditionalVisibilityLabel = `Hidden from ${hiddenCount} actor${hiddenCount === 1 ? "" : "s"}`;
      conditionalVisibilityActive = true;
    } else {
      conditionalVisibilityLabel = "Hide from…";
      conditionalVisibilityActive = false;
    }
    const result = {
      conditionalVisibilityActors: actors,
      conditionalVisibilityLabel,
      conditionalVisibilityActive,
      conditionalVisibilityClass: conditionalVisibilityActive ? "ax-th-active" : "",
      hiddenFromAll: isHiddenFromAll,
      hiddenFromAllActors,
    };

    // Cache the result
    this._conditionalVisibilityCache = { key: cacheKey, value: result };
    return result;
  }

  _computeConditionalVisibilityCacheKey() {
    const flag = this.document.getFlag("axeom-hud-pf2e", "conditional-visibility-actors") ?? [];
    const hidden = this.document.hidden;
    const actorId = this.document.actor?.id ?? "";
    const partyActor = game.actors.party;
    const partyMemberIds = partyActor?.members?.map(m => m.id).join(",") ?? "";
    return `${actorId}|${hidden}|${flag.join(",")}|${partyMemberIds}`;
  }

  _isPartyActor(actor) {
    return actor?.id?.includes("PF2ExPARTY") ?? false;
  }

  _getPartyClownCarData() {
    const actor = this.document.actor;
    if (!this._isPartyActor(actor)) return { isPartyToken: false };

    const memberTokens = actor.members.flatMap(m => m.getActiveTokens(true, true));
    const memberTokensExist = memberTokens.length > 0;
    const partyInCombat = memberTokens.some(t => (t.document ?? t).inCombat);

    return {
      isPartyToken: true,
      clownCarWillRetrieve: memberTokensExist,
      clownCarLabel: memberTokensExist ? "Collect Tokens" : "Deposit Tokens",
      clownCarIcon: memberTokensExist ? "fa-person-walking-arrow-loop-left" : "fa-person-walking-arrow-right",
      partyInCombat,
    };
  }

  _parseAttributeInput(name, attr, input) {
    if (name === "bar1" || name === "bar2") {
      attr = this.document.getBarAttribute(name);
      name = attr.attribute;
    }
    return super._parseAttributeInput(name, attr, input);
  }

  async _onSubmit(event, form, formData) {
    if (event.type === "change" && ["bar1", "bar2"].includes(event.target.name)) return this._onSubmitBar(event, form, formData);
    if (event.type === "change" && event.target.name === "elevation") return this._onSubmitElevation(event, form, formData);
    return super._onSubmit(event, form, formData);
  }

  async _onSubmitBar(event, form, formData) {
    const name = event.target.name;
    const input = event.target.value;
    const { attribute, value, delta, isDelta, isBar } = this._parseAttributeInput(name, undefined, input);
    await this.actor?.modifyTokenAttribute(attribute, isDelta ? delta : value, isDelta, isBar);
  }

  async _onSubmitElevation(event, form, formData) {
    const elevation = this._parseAttributeInput("elevation", this.document.elevation, event.target.value).value;
    await this.document.update({ elevation });
  }

  _onSubmenuEnter(event) {
    const trigger = event.currentTarget;
    const submenu = trigger.nextElementSibling;
    if (submenu && submenu.classList.contains("ax-th-submenu")) {
      if (this._submenuTimeout) { clearTimeout(this._submenuTimeout); this._submenuTimeout = null; }
      this._closeAllSubmenus(submenu);
      this._showSubmenu(trigger, submenu);
    }
  }

  _onSubmenuLeave(event) {
    const trigger = event.currentTarget;
    const submenu = trigger.nextElementSibling;
    if (submenu && submenu.classList.contains("ax-th-submenu")) {
      this._submenuTimeout = setTimeout(() => {
        if (!submenu.matches(":hover") && !trigger.matches(":hover")) this._hideSubmenu(trigger, submenu);
      }, 100);
    }
  }

  _onSubmenuContentEnter(event) {
    if (this._submenuTimeout) { clearTimeout(this._submenuTimeout); this._submenuTimeout = null; }
  }

  _onSubmenuContentLeave(event) {
    const submenu = event.currentTarget;
    const trigger = submenu.previousElementSibling;
    this._submenuTimeout = setTimeout(() => {
      if (!submenu.matches(":hover") && !trigger.matches(":hover")) this._hideSubmenu(trigger, submenu);
    }, 100);
  }

  _onHudMouseLeave(event) {
    this._submenuTimeout = setTimeout(() => { this._closeAllSubmenus(); }, 200);
  }

  _showSubmenu(trigger, submenu, skipReset = false) {
    this._positionSubmenu(trigger, submenu);
    trigger.classList.add("ax-th-expanded");
    submenu.classList.add("ax-th-active");
    if (submenu.classList.contains("ax-th-status-effects")) {
      const search = submenu.querySelector("[data-effect-search='true']");
      if (search) {
        search.removeEventListener("input", this._boundSearchInput);
        search.removeEventListener("keydown", this._boundSearchKeydown);
        this._boundSearchInput = this._onEffectSearchInput.bind(this);
        this._boundSearchKeydown = this._onEffectSearchKeydown.bind(this);
        search.addEventListener("input", this._boundSearchInput);
        search.addEventListener("keydown", this._boundSearchKeydown);
        if (!skipReset) {
          search.value = "";
          setTimeout(() => {
            search.focus();
            search.select();
            this._onEffectSearchInput({ currentTarget: search });
          }, 50);
        }
      }
    }
  }

  _hideSubmenu(trigger, submenu) {
    trigger.classList.remove("ax-th-expanded");
    submenu.classList.remove("ax-th-active");
    if (submenu.classList.contains("ax-th-status-effects")) {
      const search = submenu.querySelector("[data-effect-search='true']");
      if (search && this._boundSearchInput) {
        search.removeEventListener("input", this._boundSearchInput);
        search.removeEventListener("keydown", this._boundSearchKeydown);
      }
    }
  }

  _closeAllSubmenus(except = null) {
    const submenus = this.element.querySelectorAll(".ax-th-submenu");
    submenus.forEach((submenu) => {
      if (submenu !== except) {
        const trigger = submenu.previousElementSibling;
        this._hideSubmenu(trigger, submenu);
      }
    });
  }

  _positionSubmenu(trigger, submenu) {
    const triggerRect = trigger.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    submenu.classList.remove("ax-th-flip-horizontal", "ax-th-flip-vertical");
    if (triggerRect.right + submenuRect.width > window.innerWidth - 20) submenu.classList.add("ax-th-flip-horizontal");
    if (triggerRect.top + submenuRect.height > window.innerHeight - 20) submenu.classList.add("ax-th-flip-vertical");
  }

  async _onTogglePalette(event, target) {
    event.preventDefault();
    const submenu = target.nextElementSibling;
    if (submenu) {
      const isActive = submenu.classList.contains("ax-th-active");
      if (isActive) this._hideSubmenu(target, submenu);
      else { this._closeAllSubmenus(submenu); this._showSubmenu(target, submenu); }
    }
  }

  async _onToggleEffect(event, target) {
    if (!this.actor) { ui.notifications.warn("HUD.WarningEffectNoActor", { localize: true }); return; }
    const submenu = target.closest(".ax-th-submenu");
    if (submenu) {
      submenu.querySelectorAll(".ax-th-submenu-item.ax-th-selected").forEach((el) => el.classList.remove("ax-th-selected"));
      target.classList.add("ax-th-selected");
    }
    const statusId = target.dataset.statusId;
    const isRightClick = event.button === 2;
    const isPF2eCondition = game.pf2e?.ConditionManager?.getCondition?.(statusId);
    if (isPF2eCondition && this.actor.conditions) {
      const existingCondition = this.actor.conditions.bySlug(statusId, { temporary: false })?.find((c) => c.isInHUD && !c.system.references.parent);
      if (isRightClick) {
        if (existingCondition?.value && typeof existingCondition.value === "number") {
          await game.pf2e.ConditionManager.updateConditionValue(existingCondition.id, this.actor, existingCondition.value - 1);
        } else if (existingCondition) {
          await this.actor.decreaseCondition(statusId);
        }
      } else {
        if (existingCondition?.value && typeof existingCondition.value === "number") {
          await game.pf2e.ConditionManager.updateConditionValue(existingCondition.id, this.actor, existingCondition.value + 1);
        } else {
          await this.actor.increaseCondition(statusId);
        }
      }
    } else {
      // For non-PF2e status effects, Dead defaults to overlay (big skull)
      const useOverlay = (statusId === "dead") ? !isRightClick : isRightClick;
      await this.actor.toggleStatusEffect(statusId, { active: !target.classList.contains("ax-th-active"), overlay: useOverlay });
    }
  }

  async _onIncrementEffect(event, target) {
    if (!this.actor) { ui.notifications.warn("HUD.WarningEffectNoActor", { localize: true }); return; }
    event.stopPropagation();
    const statusId = target.dataset.statusId;
    const isPF2eCondition = game.pf2e?.ConditionManager?.getCondition?.(statusId);
    if (isPF2eCondition && this.actor.conditions) {
      const existingCondition = this.actor.conditions.bySlug(statusId, { temporary: false })?.find((c) => c.isInHUD && !c.system.references.parent);
      if (existingCondition?.value && typeof existingCondition.value === "number") {
        await game.pf2e.ConditionManager.updateConditionValue(existingCondition.id, this.actor, existingCondition.value + 1);
      } else {
        await this.actor.increaseCondition(statusId);
      }
    }
  }

  async _onDecrementEffect(event, target) {
    if (!this.actor) { ui.notifications.warn("HUD.WarningEffectNoActor", { localize: true }); return; }
    event.stopPropagation();
    const statusId = target.dataset.statusId;
    const isPF2eCondition = game.pf2e?.ConditionManager?.getCondition?.(statusId);
    if (isPF2eCondition && this.actor.conditions) {
      const existingCondition = this.actor.conditions.bySlug(statusId, { temporary: false })?.find((c) => c.isInHUD && !c.system.references.parent);
      if (existingCondition?.value && typeof existingCondition.value === "number") {
        await game.pf2e.ConditionManager.updateConditionValue(existingCondition.id, this.actor, existingCondition.value - 1);
      } else if (existingCondition) {
        await this.actor.decreaseCondition(statusId);
      }
    }
  }

  _onConditionalVisibilityTokenHover(event) {
    const actorId = event.currentTarget.dataset.actorId;
    const tokens = canvas.tokens.placeables.filter((t) => t.actor?.id === actorId);
    for (const token of tokens) { token.hover = true; token.renderFlags.set({ refreshState: true }); }
  }

  _onConditionalVisibilityTokenHoverOut(event) {
    const actorId = event.currentTarget.dataset.actorId;
    const tokens = canvas.tokens.placeables.filter((t) => t.actor?.id === actorId);
    for (const token of tokens) { token.hover = false; token.renderFlags.set({ refreshState: true }); }
  }

  async _onToggleVisibility(event, target) {
    if (!game.user.isGM) { ui.notifications.warn("Only GMs can toggle token visibility"); return; }
    const isRightClick = event.button === 2;
    if (isRightClick) {
      const tokenDocs = canvas.tokens.controlled.map((t) => t.document);
      if (!this.object.controlled) tokenDocs.push(this.document);
      for (const doc of tokenDocs) {
        await doc.unsetFlag("axeom-hud-pf2e", "conditional-visibility-actors");
        if (doc.hidden) await doc.update({ hidden: false });
      }
      canvas.perception.update({ refreshVision: true });
      this.render();
    } else {
      const submenu = target.nextElementSibling;
      if (submenu) {
        const isActive = submenu.classList.contains("ax-th-active");
        if (isActive) this._hideSubmenu(target, submenu);
        else { this._closeAllSubmenus(submenu); this._showSubmenu(target, submenu); }
      }
    }
  }

  async _onConditionalVisibilityAll(event, target) {
    if (!game.user.isGM) { ui.notifications.warn("Only GMs can toggle token visibility"); return; }
    const isRightClick = event.button === 2;
    const { conditionalVisibilityActors, hiddenFromAllActors } = this._getConditionalVisibilityData();
    const allActorIds = conditionalVisibilityActors.map((a) => a.id);
    const tokenDocs = canvas.tokens.controlled.map((t) => t.document);
    if (!this.object.controlled) tokenDocs.push(this.document);
    if (isRightClick) {
      for (const doc of tokenDocs) {
        await doc.unsetFlag("axeom-hud-pf2e", "conditional-visibility-actors");
        if (doc.hidden) await doc.update({ hidden: false });
      }
      canvas.perception.update({ refreshVision: true });
    } else {
      if (hiddenFromAllActors || this.document.hidden) {
        for (const doc of tokenDocs) {
          await doc.unsetFlag("axeom-hud-pf2e", "conditional-visibility-actors");
          if (doc.hidden) await doc.update({ hidden: false });
        }
      } else {
        for (const doc of tokenDocs) {
          await doc.setFlag("axeom-hud-pf2e", "conditional-visibility-actors", allActorIds);
        }
      }
      canvas.perception.update({ refreshVision: true });
    }
    const submenu = target.closest(".ax-th-submenu");
    if (submenu) { const trigger = submenu.previousElementSibling; this._hideSubmenu(trigger, submenu); }
  }

  async _onConditionalVisibilityToken(event, target) {
    if (!game.user.isGM) { ui.notifications.warn("Only GMs can toggle token visibility"); return; }
    const actorId = target.dataset.actorId;
    const isRightClick = event.button === 2;
    const tokenDocs = canvas.tokens.controlled.map((t) => t.document);
    if (!this.object.controlled) tokenDocs.push(this.document);
    // Use the primary document's state to determine the toggle action
    let primaryFlags = this.document.getFlag("axeom-hud-pf2e", "conditional-visibility-actors") ?? [];
    const isCurrentlyHidden = primaryFlags.includes(actorId);
    for (const doc of tokenDocs) {
      let flags = doc.getFlag("axeom-hud-pf2e", "conditional-visibility-actors") ?? [];
      if (isRightClick) {
        if (isCurrentlyHidden) flags = flags.filter((id) => id !== actorId);
      } else {
        if (!isCurrentlyHidden && !flags.includes(actorId)) flags.push(actorId);
        else if (isCurrentlyHidden) flags = flags.filter((id) => id !== actorId);
      }
      await doc.setFlag("axeom-hud-pf2e", "conditional-visibility-actors", flags);
      if (doc.hidden) await doc.update({ hidden: false });
    }
    canvas.perception.update({ refreshVision: true });
    this.render();
  }

  async _onToggleCombat(event, target) {
    const actor = this.document.actor;

    if (this._isPartyActor(actor)) {
      const memberTokens = actor.members.flatMap(m => m.getActiveTokens(true, true));
      if (memberTokens.length === 0) {
        ui.notifications.warn("No party member tokens on this scene. Use 'Deposit Tokens' first.");
        return;
      }

      const tokenDocs = memberTokens.map(t => t.document ?? t);
      const anyInCombat = tokenDocs.some(t => t.inCombat);

      try {
        if (anyInCombat) {
          await foundry.documents.TokenDocument.implementation.deleteCombatants(tokenDocs);
        } else {
          await foundry.documents.TokenDocument.implementation.createCombatants(tokenDocs);
        }
        this.render();
      } catch (err) { ui.notifications.warn(err.message); }
      return;
    }

    const tokens = canvas.tokens.controlled.map((t) => t.document);
    if (!this.object.controlled) tokens.push(this.document);
    try {
      if (this.document.inCombat) await foundry.documents.TokenDocument.implementation.deleteCombatants(tokens);
      else await foundry.documents.TokenDocument.implementation.createCombatants(tokens);
    } catch (err) { ui.notifications.warn(err.message); }
  }

  async _onToggleClownCar(event, target) {
    const actor = this.document.actor;
    if (!this._isPartyActor(actor)) return;

    const scene = this.document.scene;
    if (!scene?.isOwner) {
      ui.notifications.warn("You don't have permission to modify this scene.");
      return;
    }

    target.disabled = true;

    try {
      const memberTokens = actor.members.flatMap(m => m.getActiveTokens(true, true));

      if (memberTokens.length > 0) {
        await this._retrievePartyTokens(memberTokens);
      } else {
        await this._depositPartyTokens();
      }

      this.render();
    } catch (err) {
      console.error("Clown car error:", err);
      ui.notifications.error(err.message);
    } finally {
      target.disabled = false;
    }
  }

  async _retrievePartyTokens(memberTokens) {
    const scene = this.document.scene;
    const partyX = this.document.x;
    const partyY = this.document.y;

    const updates = memberTokens.map(t => ({
      _id: t.id,
      x: partyX,
      y: partyY,
    }));
    await scene.updateEmbeddedDocuments("Token", updates);

    await Promise.all(memberTokens.map(async token => {
      await token.object?.animationContexts?.get(token.object.movementAnimationName)?.promise;
      return token.delete();
    }));
  }

  async _depositPartyTokens() {
    const actor = this.document.actor;
    const scene = this.document.scene;
    const car = this.document;

    if (!car.object) return;

    const newTokens = (await Promise.all(
      actor.members.map(m => m.getTokenDocument({ x: car.x, y: car.y, actorLink: true }))
    )).map(t => ({
      ...t.toObject(),
      x: car.x,
      y: car.y,
    })).sort((a, b) => b.width - a.width);

    const createdTokens = await scene.createEmbeddedDocuments("Token", newTokens);

    const freeSpaces = this._getDepositSpaces();
    const placementData = createdTokens.map(token => {
      const widthPixels = token.mechanicalBounds?.width ?? token.bounds?.width ?? canvas.grid.size;
      const square = freeSpaces.findSplice?.(s =>
        Math.abs(s.x - token.x) >= widthPixels && Math.abs(s.y - token.y) >= widthPixels
      ) ?? freeSpaces.shift();
      return {
        _id: token._id ?? "",
        x: square?.x ?? car.x,
        y: square?.y ?? car.y,
      };
    });

    await scene.updateEmbeddedDocuments("Token", placementData);
  }

  _getDepositSpaces() {
    const placeable = this.document.object;
    if (!placeable) return [];

    const center = placeable.center;
    const diameter = placeable.bounds.width * 7;
    const radiusPixels = diameter / 2;
    const distance = canvas.dimensions?.distance ?? 5;
    const radius = radiusPixels / distance;

    const areaBounds = new PIXI.Rectangle(
      center.x - radiusPixels,
      center.y - radiusPixels,
      diameter,
      diameter
    );

    // Use pf2e's getAreaSquares
    if (typeof getAreaSquares === "function") {
      const squares = getAreaSquares({ bounds: areaBounds, radius, token: placeable })
        .filter(s => s.active);
      return squares.filter(s =>
        !(s.x === placeable.x && s.y === placeable.y) &&
        !(s.center.x === center.x && s.center.y === center.y) &&
        !placeable.checkCollision(s.center, { type: "move", mode: "any" })
      ).reverse();
    }

    // Fallback
    const gridSize = canvas.grid.size;
    const positions = [];
    for (let ring = 1; ring <= 3; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.abs(dx) === ring || Math.abs(dy) === ring) {
            const x = placeable.x + dx * gridSize;
            const y = placeable.y + dy * gridSize;
            const testCenter = { x: x + gridSize / 2, y: y + gridSize / 2 };
            if (!placeable.checkCollision(testCenter, { type: "move", mode: "any" })) {
              positions.push({ x, y, center: testCenter });
            }
          }
        }
      }
    }
    return positions;
  }

  _onToggleTarget(event, target) {
    const token = this.object;
    const targeted = !game.user.targets.has(token);
    token.setTarget(targeted, { releaseOthers: false });
    target.classList.toggle("ax-th-active", targeted);
  }

  async _onSort(event, target) {
    const direction = target.dataset.direction;
    const currentZ = this.document.sort;
    const newZ = direction === "up" ? currentZ + 1 : currentZ - 1;
    await this.document.update({ sort: newZ });
  }


  async _onConfig(event, target) {
    new TokenConfig(this.document).render(true);
  }
}

Hooks.once("setup", () => {
  foundry.applications.handlebars.loadTemplates(["modules/axeom-hud-pf2e/templates/TokenHUD.hbs"]);
  CONFIG.Token.hudClass = AxTokenHud;
});

globalThis.AxTokenHud = AxTokenHud;

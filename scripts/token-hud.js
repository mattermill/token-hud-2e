Hooks.once("init", function () {
  if (typeof libWrapper !== "undefined") {
    libWrapper.register(
      "token-hud-2e",
      "DetectionMode.prototype.testVisibility",
      function (wrapped, visionSource, mode, { object, tests }) {
        const src = visionSource.object.document;
        const srcActorId = src.actor?.id;
        const flag = object?.document?.getFlag("token-hud-2e", "conditional-visibility-actors") ?? [];
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
      const flag = config.object?.document?.getFlag("token-hud-2e", "conditional-visibility-actors") ?? [];
      if (srcActorId && flag.includes(srcActorId)) return false;
      return originalTestVisibility.call(this, visionSource, mode, config);
    };
  }
});

Hooks.on("refreshToken", (token) => {
  if (!game.user.isGM) return;
  const flag = token.document.getFlag("token-hud-2e", "conditional-visibility-actors") ?? [];
  const hasConditionalVisibility = flag.length > 0;
  if (hasConditionalVisibility && !token.document.hidden) {
    token.mesh.alpha = 0.5;
  }
});

class TokenTagsHUD extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.hud.BasePlaceableHUD,
) {
  static DEFAULT_OPTIONS = {
    id: "token-hud",
    actions: {
      togglePalette: TokenTagsHUD.prototype._onTogglePalette,
      effect: { handler: TokenTagsHUD.prototype._onToggleEffect, buttons: [0, 2] },
      incrementEffect: TokenTagsHUD.prototype._onIncrementEffect,
      decrementEffect: TokenTagsHUD.prototype._onDecrementEffect,
      visibility: { handler: TokenTagsHUD.prototype._onToggleVisibility, buttons: [0, 2] },
      conditionalVisibilityAll: { handler: TokenTagsHUD.prototype._onConditionalVisibilityAll, buttons: [0, 2] },
      conditionalVisibilityToken: { handler: TokenTagsHUD.prototype._onConditionalVisibilityToken, buttons: [0, 2] },
      combat: TokenTagsHUD.prototype._onToggleCombat,
      target: TokenTagsHUD.prototype._onToggleTarget,
      sort: TokenTagsHUD.prototype._onSort,
      config: TokenTagsHUD.prototype._onConfig,
      focusInput: TokenTagsHUD.prototype._onFocusInput,
    },
  };

  static PARTS = {
    hud: { root: true, template: "modules/token-hud-2e/templates/TokenHUD.hbs" },
  };

  constructor(...args) {
    super(...args);
    this._cachedTags = null;
    this._lastEffectsUpdateHash = null;
    this._paletteStates = new Map();
    this._submenuTimeout = null;
  }

  get actor() { return this.document?.actor; }
  bind(object) { return super.bind(object); }
  _insertElement(element) { document.body.appendChild(element); }

  async render(force = false, options = {}) {
    const openSubmenu = this.element?.querySelector(".submenu.active");
    let openSubmenuClass = null;
    if (openSubmenu?.classList.contains("status-effects")) {
      openSubmenuClass = "status-effects";
    } else if (openSubmenu?.classList.contains("conditional-visibility")) {
      openSubmenuClass = "conditional-visibility";
    }
    const searchInput = openSubmenu?.querySelector("[data-effect-search='true']");
    const searchValue = searchInput?.value;
    const searchWasFocused = searchInput && document.activeElement === searchInput;
    const selectedItem = openSubmenu?.querySelector(".submenu-item.selected");
    const selectedStatusId = selectedItem?.dataset?.statusId;
    const scrollTop = openSubmenu?.scrollTop ?? 0;
    const result = await super.render(force, options);
    if (openSubmenuClass && this.element) {
      const submenu = this.element.querySelector(`.submenu.${openSubmenuClass}`);
      const trigger = submenu?.previousElementSibling;
      if (submenu && trigger) {
        this._showSubmenu(trigger, submenu, true);
        submenu.scrollTop = scrollTop;
        if (openSubmenuClass === "status-effects") {
          const search = submenu.querySelector("[data-effect-search='true']");
          if (searchValue !== undefined && search) {
            search.value = searchValue;
            const query = searchValue.trim().toLowerCase();
            const items = submenu.querySelectorAll(".submenu-item.effect-control");
            for (const el of items) {
              const name = (el.dataset.effectName || el.querySelector(".menu-label")?.textContent || "").toLowerCase();
              const match = !query || name.includes(query);
              el.style.display = match ? "" : "none";
              el.classList.remove("selected");
            }
            const itemToSelect = selectedStatusId
              ? submenu.querySelector(`.submenu-item[data-status-id="${selectedStatusId}"]`)
              : Array.from(items).find((el) => el.style.display !== "none");
            if (itemToSelect && itemToSelect.style.display !== "none") {
              itemToSelect.classList.add("selected");
            }
            // Restore focus to search input if it was focused before render
            if (searchWasFocused) {
              search.focus({ preventScroll: true });
            }
          }
        }
      }
    }
    return result;
  }

  async close(options = {}) {
    if (this.element) this.element.classList.add("closing");
    if (this._submenuTimeout) { clearTimeout(this._submenuTimeout); this._submenuTimeout = null; }
    if (this.object && !options.skipRelease) this.object.release();
    this._cleanupInputs();
    this._clearCaches();
    return await super.close(options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("focusout", ".bar-input, .elevation-input", this._onInputBlur.bind(this));
    html.on("keydown", ".bar-input, .elevation-input", this._onInputKeydown.bind(this));
    html.on("keydown", ".submenu", this._onSubmenuKeydown.bind(this));

    html.on("mouseenter", ".menu-item.submenu-trigger", this._onSubmenuEnter.bind(this));
    html.on("mouseleave", ".menu-item.submenu-trigger", this._onSubmenuLeave.bind(this));
    html.on("mouseenter", ".submenu", this._onSubmenuContentEnter.bind(this));
    html.on("mouseleave", ".submenu", this._onSubmenuContentLeave.bind(this));
    html.on("mouseenter", ".conditional-visibility-token", this._onConditionalVisibilityTokenHover.bind(this));
    html.on("mouseleave", ".conditional-visibility-token", this._onConditionalVisibilityTokenHoverOut.bind(this));
    html.on("mouseleave", this._onHudMouseLeave.bind(this));
    setTimeout(() => { this._selectFirstMenuItem(); }, 100);
  }

  _onInputBlur(event) {
    const input = event.currentTarget;
    input.classList.remove("active", "focused");
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
    const submenu = this.element?.querySelector(".submenu.status-effects");
    if (!submenu) return;
    const items = submenu.querySelectorAll(".submenu-item.effect-control");
    for (const el of items) {
      const name = (el.dataset.effectName || el.querySelector(".menu-label")?.textContent || "").toLowerCase();
      const match = !query || name.includes(query);
      el.style.display = match ? "" : "none";
    }
  }

  _onEffectSearchKeydown(event) {
    const submenu = this.element?.querySelector(".submenu.status-effects");
    if (!submenu) return;
    if (event.key === "Escape") {
      const trigger = submenu.previousElementSibling;
      this._hideSubmenu(trigger, submenu);
      // Allow the default Escape behavior (token deselection) to proceed
      return;
    }
    const visible = Array.from(submenu.querySelectorAll(".submenu-item.effect-control")).filter((el) => el.style.display !== "none");
    if (!visible.length) return;
    let currentIndex = visible.findIndex((el) => el.classList.contains("selected"));
    const moveSelection = (delta) => {
      if (currentIndex === -1) currentIndex = 0;
      else currentIndex = (currentIndex + delta + visible.length) % visible.length;
      visible.forEach((el) => el.classList.remove("selected"));
      visible[currentIndex].classList.add("selected");
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
      const submenu = event.currentTarget.closest(".submenu");
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
    allInputs.forEach((input) => { input.classList.remove("active", "focused"); });
  }

  _clearCaches() { this._paletteStates?.clear(); }

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
      visibilityClass: this.document.hidden ? "active" : "",
      elevation: this.document.elevation,
      locked: this.document.locked,
      ...this._getConditionalVisibilityData(),
      inCombat: this.document.inCombat,
      canToggleCombat: game.combat !== null || !this.document.inCombat,
      combatClass: this.document.inCombat ? "active" : "",
      targetClass: game.user.targets.has(this.object) ? "active" : "",
      isGM: game.user.isGM,
      canConfigure: game.user.can("TOKEN_CONFIGURE"),
      isGamePaused: game.paused,
    });
    return finalContext;
  }

  _getStatusEffects() {
    const choices = {};
    for (const status of CONFIG.statusEffects) {
      if (status.hud === false || (foundry.utils.getType(status.hud) === "Object" && status.hud.actorTypes?.includes(this.document.actor.type) === false)) continue;
      // Check if this is a PF2e valued condition
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
    const activeEffects = this.actor?.effects || [];
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
    return Object.values(choices).map((status) => ({
      id: status.id,
      title: status.title,
      src: status.src,
      value: status.value,
      isActive: status.isActive,
      isValued: status.isValued,
      cssClass: [status.isActive ? "active" : null, status.isOverlay ? "overlay" : null].filterJoin(" "),
    }));
  }

  _getConditionalVisibilityData() {
    const flag = this.document.getFlag("token-hud-2e", "conditional-visibility-actors") ?? [];
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
        img: a.prototypeToken?.texture?.src || a.img,
        isHidden: flag.includes(a.id),
        cssClass: flag.includes(a.id) ? "active" : "",
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
    return {
      conditionalVisibilityActors: actors,
      conditionalVisibilityLabel,
      conditionalVisibilityActive,
      conditionalVisibilityClass: conditionalVisibilityActive ? "active" : "",
      hiddenFromAll: isHiddenFromAll,
      hiddenFromAllActors,
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
    if (submenu && submenu.classList.contains("submenu")) {
      if (this._submenuTimeout) { clearTimeout(this._submenuTimeout); this._submenuTimeout = null; }
      this._closeAllSubmenus(submenu);
      this._showSubmenu(trigger, submenu);
    }
  }

  _onSubmenuLeave(event) {
    const trigger = event.currentTarget;
    const submenu = trigger.nextElementSibling;
    if (submenu && submenu.classList.contains("submenu")) {
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
    trigger.classList.add("expanded");
    submenu.classList.add("active");
    if (submenu.classList.contains("status-effects")) {
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
    trigger.classList.remove("expanded");
    submenu.classList.remove("active");
    if (submenu.classList.contains("status-effects")) {
      const search = submenu.querySelector("[data-effect-search='true']");
      if (search && this._boundSearchInput) {
        search.removeEventListener("input", this._boundSearchInput);
        search.removeEventListener("keydown", this._boundSearchKeydown);
      }
    }
  }

  _closeAllSubmenus(except = null) {
    const submenus = this.element.querySelectorAll(".submenu");
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
    submenu.classList.remove("flip-horizontal", "flip-vertical");
    if (triggerRect.right + submenuRect.width > window.innerWidth - 20) submenu.classList.add("flip-horizontal");
    if (triggerRect.top + submenuRect.height > window.innerHeight - 20) submenu.classList.add("flip-vertical");
  }

  async _onTogglePalette(event, target) {
    event.preventDefault();
    const submenu = target.nextElementSibling;
    if (submenu) {
      const isActive = submenu.classList.contains("active");
      if (isActive) this._hideSubmenu(target, submenu);
      else { this._closeAllSubmenus(submenu); this._showSubmenu(target, submenu); }
    }
  }

  async _onToggleEffect(event, target) {
    if (!this.actor) { ui.notifications.warn("HUD.WarningEffectNoActor", { localize: true }); return; }
    const submenu = target.closest(".submenu");
    if (submenu) {
      submenu.querySelectorAll(".submenu-item.selected").forEach((el) => el.classList.remove("selected"));
      target.classList.add("selected");
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
      await this.actor.toggleStatusEffect(statusId, { active: !target.classList.contains("active"), overlay: useOverlay });
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
        await doc.unsetFlag("token-hud-2e", "conditional-visibility-actors");
        if (doc.hidden) await doc.update({ hidden: false });
      }
      canvas.perception.update({ refreshVision: true });
      this.render();
    } else {
      const submenu = target.nextElementSibling;
      if (submenu) {
        const isActive = submenu.classList.contains("active");
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
        await doc.unsetFlag("token-hud-2e", "conditional-visibility-actors");
        if (doc.hidden) await doc.update({ hidden: false });
      }
      canvas.perception.update({ refreshVision: true });
    } else {
      if (hiddenFromAllActors || this.document.hidden) {
        for (const doc of tokenDocs) {
          await doc.unsetFlag("token-hud-2e", "conditional-visibility-actors");
          if (doc.hidden) await doc.update({ hidden: false });
        }
      } else {
        for (const doc of tokenDocs) {
          await doc.setFlag("token-hud-2e", "conditional-visibility-actors", allActorIds);
        }
      }
      canvas.perception.update({ refreshVision: true });
    }
    const submenu = target.closest(".submenu");
    if (submenu) { const trigger = submenu.previousElementSibling; this._hideSubmenu(trigger, submenu); }
  }

  async _onConditionalVisibilityToken(event, target) {
    if (!game.user.isGM) { ui.notifications.warn("Only GMs can toggle token visibility"); return; }
    const actorId = target.dataset.actorId;
    const isRightClick = event.button === 2;
    const tokenDocs = canvas.tokens.controlled.map((t) => t.document);
    if (!this.object.controlled) tokenDocs.push(this.document);
    // Use the primary document's state to determine the toggle action
    let primaryFlags = this.document.getFlag("token-hud-2e", "conditional-visibility-actors") ?? [];
    const isCurrentlyHidden = primaryFlags.includes(actorId);
    for (const doc of tokenDocs) {
      let flags = doc.getFlag("token-hud-2e", "conditional-visibility-actors") ?? [];
      if (isRightClick) {
        if (isCurrentlyHidden) flags = flags.filter((id) => id !== actorId);
      } else {
        if (!isCurrentlyHidden && !flags.includes(actorId)) flags.push(actorId);
        else if (isCurrentlyHidden) flags = flags.filter((id) => id !== actorId);
      }
      await doc.setFlag("token-hud-2e", "conditional-visibility-actors", flags);
      if (doc.hidden) await doc.update({ hidden: false });
    }
    canvas.perception.update({ refreshVision: true });
    this.render();
  }

  async _onToggleCombat(event, target) {
    const tokens = canvas.tokens.controlled.map((t) => t.document);
    if (!this.object.controlled) tokens.push(this.document);
    try {
      if (this.document.inCombat) await foundry.documents.TokenDocument.implementation.deleteCombatants(tokens);
      else await foundry.documents.TokenDocument.implementation.createCombatants(tokens);
    } catch (err) { ui.notifications.warn(err.message); }
  }

  _onToggleTarget(event, target) {
    const token = this.object;
    const targeted = !game.user.targets.has(token);
    token.setTarget(targeted, { releaseOthers: false });
    target.classList.toggle("active", targeted);
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
  foundry.applications.handlebars.loadTemplates(["modules/token-hud-2e/templates/TokenHUD.hbs"]);
  CONFIG.Token.hudClass = TokenTagsHUD;
});

globalThis.TokenTagsHUD = TokenTagsHUD;

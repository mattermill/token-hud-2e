// ==========================================
// Custom Drag Ruler Without History
// ==========================================

class SimpleRuler {
  constructor() {
    this.active = false;
    this.startPoint = null;
    this.endPoint = null;
    this.token = null;
    this.ruler = null;
    this.label = null;
  }

  /**
   * Start measuring from a token
   */
  start(token, origin) {
    this.active = true;
    this.token = token;
    this.startPoint = origin;
    this.endPoint = origin;

    // Create PIXI graphics for the ruler line
    if (!this.ruler) {
      this.ruler = new PIXI.Graphics();
      canvas.controls.addChild(this.ruler);
    }

    // Create text label for distance
    if (!this.label) {
      this.label = new PIXI.Text("", {
        fontFamily: "Signika",
        fontSize: 20,
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 4,
      });
      canvas.controls.addChild(this.label);
    }

    this.draw();
  }

  /**
   * Update the ruler endpoint
   */
  update(point) {
    if (!this.active) return;
    this.endPoint = point;
    this.draw();
  }

  /**
   * Draw the ruler line and label
   */
  draw() {
    if (!this.active || !this.ruler) return;

    this.ruler.clear();

    // Draw the ruler line
    this.ruler.lineStyle(5, 0x42f5f5, 0.8);
    this.ruler.moveTo(this.startPoint.x, this.startPoint.y);
    this.ruler.lineTo(this.endPoint.x, this.endPoint.y);

    // Draw endpoint circle
    this.ruler.beginFill(0x42f5f5, 0.5);
    this.ruler.drawCircle(this.endPoint.x, this.endPoint.y, 8);
    this.ruler.endFill();

    // Calculate distance respecting grid settings
    const distance = this.measureDistance(this.startPoint, this.endPoint);

    // Update label
    if (this.label) {
      const units = canvas.scene.grid.units || "ft";
      this.label.text = `${Math.round(distance)} ${units}`;

      // Position label at midpoint
      this.label.x = (this.startPoint.x + this.endPoint.x) / 2;
      this.label.y = (this.startPoint.y + this.endPoint.y) / 2 - 30;
      this.label.anchor.set(0.5, 0.5);
    }
  }

  /**
   * Measure distance between two points respecting grid diagonals
   */
  measureDistance(start, end) {
    const gridType = canvas.grid.type;
    const gridSize = canvas.grid.size;

    if (gridType === CONST.GRID_TYPES.GRIDLESS) {
      // Gridless: straight line distance
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const pixels = Math.hypot(dx, dy);
      return (pixels / gridSize) * canvas.scene.grid.distance;
    }

    // For square grids, use grid-aware measurement
    const ray = new Ray(start, end);
    const segments = [{ ray }];

    return canvas.grid.measurePath(segments, {
      gridSpaces: true,
    }).distance;
  }

  /**
   * Clear and hide the ruler
   */
  clear() {
    this.active = false;
    this.token = null;
    this.startPoint = null;
    this.endPoint = null;

    if (this.ruler) {
      this.ruler.clear();
    }

    if (this.label) {
      this.label.text = "";
    }
  }

  /**
   * Destroy the ruler completely
   */
  destroy() {
    this.clear();

    if (this.ruler) {
      this.ruler.destroy();
      this.ruler = null;
    }

    if (this.label) {
      this.label.destroy();
      this.label = null;
    }
  }
}

// Initialize our custom ruler system
Hooks.once("init", function () {
  // Disable the default ruler with history
  CONFIG.Token.rulerClass = null;

  console.log("Realm UI | Default ruler disabled, custom ruler will be used");
});

Hooks.once("canvasReady", function () {
  // Create our custom ruler instance
  canvas.simpleRuler = new SimpleRuler();

  console.log("Realm UI | Custom ruler initialized");
});

// Hook into token dragging to show our ruler
Hooks.on("canvasReady", () => {
  // Store original drag handlers
  const originalOnDragLeftStart = Token.prototype._onDragLeftStart;
  const originalOnDragLeftMove = Token.prototype._onDragLeftMove;
  const originalOnDragLeftDrop = Token.prototype._onDragLeftDrop;
  const originalOnDragLeftCancel = Token.prototype._onDragLeftCancel;

  // Override drag start
  Token.prototype._onDragLeftStart = function (event) {
    const result = originalOnDragLeftStart.call(this, event);

    // Start our custom ruler
    if (canvas.simpleRuler) {
      const origin = {
        x: this.document.x + (this.document.width * canvas.grid.size) / 2,
        y: this.document.y + (this.document.height * canvas.grid.size) / 2,
      };
      canvas.simpleRuler.start(this, origin);
    }

    return result;
  };

  // Override drag move
  Token.prototype._onDragLeftMove = function (event) {
    const result = originalOnDragLeftMove.call(this, event);

    // Update our custom ruler
    if (canvas.simpleRuler && canvas.simpleRuler.active) {
      const point = event.interactionData.destination;
      canvas.simpleRuler.update({
        x: point.x + (this.document.width * canvas.grid.size) / 2,
        y: point.y + (this.document.height * canvas.grid.size) / 2,
      });
    }

    return result;
  };

  // Override drag drop
  Token.prototype._onDragLeftDrop = function (event) {
    const result = originalOnDragLeftDrop.call(this, event);

    // Clear our custom ruler
    if (canvas.simpleRuler) {
      canvas.simpleRuler.clear();
    }

    return result;
  };

  // Override drag cancel
  Token.prototype._onDragLeftCancel = function (event) {
    const result = originalOnDragLeftCancel.call(this, event);

    // Clear our custom ruler
    if (canvas.simpleRuler) {
      canvas.simpleRuler.clear();
    }

    return result;
  };
});

/**
 * Realm UI - Interface improvements for FoundryVTT
 * Uses HandlebarsApplicationMixin for proper rendering with custom template
 */
class TokenTagsHUD extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.hud.BasePlaceableHUD,
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "token-hud",
    classes: ["hud", "token-hud", "token-tags-hud"],
    actions: {
      togglePalette: TokenTagsHUD.prototype._onTogglePalette,
      effect: {
        handler: TokenTagsHUD.prototype._onToggleEffect,
        buttons: [0, 2],
      },
      visibility: TokenTagsHUD.prototype._onToggleVisibility,
      combat: TokenTagsHUD.prototype._onToggleCombat,
      target: TokenTagsHUD.prototype._onToggleTarget,
      sort: TokenTagsHUD.prototype._onSort,
      movementAction: TokenTagsHUD.prototype._onSelectMovementAction,
      config: TokenTagsHUD.prototype._onConfig,
    },
  };

  /** @override */
  static PARTS = {
    hud: {
      root: true,
      template: "modules/token-hud-2e/templates/TokenHud.hbs",
    },
  };

  constructor(...args) {
    super(...args);
    this._cachedTags = null;
    this._lastEffectsUpdateHash = null;
    this._paletteStates = new Map();
    this._submenuTimeout = null;
  }

  /**
   * Convenience reference to the Actor document
   * @type {Actor}
   */
  get actor() {
    return this.document?.actor;
  }

  /** @override */
  bind(object) {
    return super.bind(object);
  }

  /**
   * Insert the application element into the DOM.
   * Override to place the HUD directly in document.body to ensure it's completely
   * independent of canvas zoom transforms. The #hud container and #interface layer
   * may still inherit transforms in some configurations.
   * @param {HTMLElement} element - The element to insert
   * @override
   * @protected
   */
  _insertElement(element) {
    // Insert directly into document.body to guarantee no parent transforms affect scaling
    document.body.appendChild(element);
  }

  /** @override */
  async render(force = false, options = {}) {
    // Store which submenu is currently open before re-render
    const openSubmenu = this.element?.querySelector(".submenu.active");
    const openSubmenuClass = openSubmenu?.classList.contains("status-effects")
      ? "status-effects"
      : null;
    const searchValue = openSubmenu?.querySelector(
      "[data-effect-search='true']",
    )?.value;

    // Store which item was selected (by its status ID)
    const selectedItem = openSubmenu?.querySelector(".submenu-item.selected");
    const selectedStatusId = selectedItem?.dataset?.statusId;

    const result = await super.render(force, options);

    // Restore the open submenu after re-render
    if (openSubmenuClass && this.element) {
      const submenu = this.element.querySelector(
        `.submenu.${openSubmenuClass}`,
      );
      const trigger = submenu?.previousElementSibling;
      if (submenu && trigger) {
        // Pass skipReset=true to prevent resetting search/selection
        this._showSubmenu(trigger, submenu, true);

        const search = submenu.querySelector("[data-effect-search='true']");

        // Restore search value and selection if they existed
        if (searchValue !== undefined && search) {
          search.value = searchValue;
          search.focus();

          // Manually apply filtering and restore selection without the default first-item selection
          const query = searchValue.trim().toLowerCase();
          const items = submenu.querySelectorAll(
            ".submenu-item.effect-control",
          );

          for (const el of items) {
            const name = (
              el.dataset.effectName ||
              el.querySelector(".menu-label")?.textContent ||
              ""
            ).toLowerCase();
            const match = !query || name.includes(query);
            el.style.display = match ? "" : "none";
            el.classList.remove("selected");
          }

          // Select the previously selected item (or first visible if none was selected)
          const itemToSelect = selectedStatusId
            ? submenu.querySelector(
                `.submenu-item[data-status-id="${selectedStatusId}"]`,
              )
            : Array.from(items).find((el) => el.style.display !== "none");

          if (itemToSelect && itemToSelect.style.display !== "none") {
            itemToSelect.classList.add("selected");
            itemToSelect.scrollIntoView({ block: "nearest" });
          }
        }
      }
    }

    return result;
  }

  /** @override */
  async close(options = {}) {
    // Add closing class for CSS transitions
    if (this.element) {
      this.element.classList.add("closing");
    }

    // Clear any pending submenu timeouts
    if (this._submenuTimeout) {
      clearTimeout(this._submenuTimeout);
      this._submenuTimeout = null;
    }

    // Release (deselect) the token when the HUD closes
    if (this.object && !options.skipRelease) {
      this.object.release();
    }

    this._cleanupInputs();
    this._clearCaches();
    return await super.close(options);
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Add input blur handlers for proper cleanup
    html.on(
      "focusout",
      ".bar-input, .elevation-input",
      this._onInputBlur.bind(this),
    );
    html.on(
      "keydown",
      ".bar-input, .elevation-input",
      this._onInputKeydown.bind(this),
    );

    // Add main menu keyboard navigation
    html.on("keydown", this._onMainMenuKeydown.bind(this));

    // Effect search filtering will be bound when submenu is shown
    // since the search input is inside a hidden submenu initially

    // Add submenu hover handlers for context menu behavior
    html.on(
      "mouseenter",
      ".menu-item.submenu-trigger",
      this._onSubmenuEnter.bind(this),
    );
    html.on(
      "mouseleave",
      ".menu-item.submenu-trigger",
      this._onSubmenuLeave.bind(this),
    );
    html.on("mouseenter", ".submenu", this._onSubmenuContentEnter.bind(this));
    html.on("mouseleave", ".submenu", this._onSubmenuContentLeave.bind(this));

    // Close all submenus when clicking elsewhere
    html.on("mouseleave", this._onHudMouseLeave.bind(this));

    // Select first menu item when HUD opens (after a short delay to ensure render is complete)
    setTimeout(() => {
      this._selectFirstMenuItem();
    }, 100);
  }

  /**
   * Handle input blur events
   */
  _onInputBlur(event) {
    const input = event.currentTarget;
    input.classList.remove("active", "focused");
  }

  /**
   * Handle input keydown events (ESC to blur)
   */
  _onInputKeydown(event) {
    if (event.key === "Escape") {
      event.currentTarget.blur();
      event.preventDefault();
    }
  }

  /**
   * Filter status effects as the user types
   */
  _onEffectSearchInput(event) {
    const query = event.currentTarget.value.trim().toLowerCase();
    const submenu = this.element?.querySelector(".submenu.status-effects");
    if (!submenu) return;

    const items = submenu.querySelectorAll(".submenu-item.effect-control");
    for (const el of items) {
      const name = (
        el.dataset.effectName ||
        el.querySelector(".menu-label")?.textContent ||
        ""
      ).toLowerCase();
      const match = !query || name.includes(query);
      el.style.display = match ? "" : "none";
    }
  }

  /**
   * Keyboard navigation + apply on Enter inside the search box
   */
  _onEffectSearchKeydown(event) {
    const submenu = this.element?.querySelector(".submenu.status-effects");
    if (!submenu) return;

    const visible = Array.from(
      submenu.querySelectorAll(".submenu-item.effect-control"),
    ).filter((el) => el.style.display !== "none");

    if (!visible.length) return;

    let currentIndex = visible.findIndex((el) =>
      el.classList.contains("selected"),
    );

    const moveSelection = (delta) => {
      if (currentIndex === -1) currentIndex = 0;
      else
        currentIndex = (currentIndex + delta + visible.length) % visible.length;
      visible.forEach((el) => el.classList.remove("selected"));
      visible[currentIndex].classList.add("selected");
      // Ensure selected item is scrolled into view if submenu scrolls
      visible[currentIndex].scrollIntoView({ block: "nearest" });
    };

    if (event.key === "ArrowDown") {
      moveSelection(1);
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      moveSelection(-1);
      event.preventDefault();
    } else if (event.key === "Enter") {
      const target = visible[currentIndex >= 0 ? currentIndex : 0];
      if (target) {
        // Cmd+Enter or Ctrl+Enter: increment condition value and close the HUD
        if (event.metaKey || event.ctrlKey) {
          this._onToggleEffect({ button: 0, preventDefault() {} }, target);
          const trigger = submenu.previousElementSibling;
          this._hideSubmenu(trigger, submenu);
          event.preventDefault();
        }
        // Shift+Enter: decrement condition value and keep HUD open
        else if (event.shiftKey) {
          this._onToggleEffect({ button: 2, preventDefault() {} }, target);
          event.preventDefault();
        }
        // Plain Enter: increment condition value and keep HUD open
        else {
          this._onToggleEffect({ button: 0, preventDefault() {} }, target);
          event.preventDefault();
        }
      }
    }
  }

  /** @override */
  setPosition(position = {}) {
    if (!this.object || !this.element) return position;

    const token = this.object;
    const tokenDoc = token.document;
    const gridSize = canvas.grid.size;

    // Calculate token canvas position and size
    const tokenX = tokenDoc.x;
    const tokenY = tokenDoc.y;
    const tokenWidth = tokenDoc.width * gridSize;
    const tokenHeight = tokenDoc.height * gridSize;

    // Convert token position to screen coordinates
    const topLeft = canvas.clientCoordinatesFromCanvas({
      x: tokenX,
      y: tokenY,
    });
    const bottomRight = canvas.clientCoordinatesFromCanvas({
      x: tokenX + tokenWidth,
      y: tokenY + tokenHeight,
    });

    // Calculate preferred position
    const tokenScreenWidth = bottomRight.x - topLeft.x;
    const tokenScreenHeight = bottomRight.y - topLeft.y;

    // Position to the right of the token by default
    let left = topLeft.x + tokenScreenWidth + 15;
    let top = topLeft.y + tokenScreenHeight / 2;

    // Ensure HUD stays on screen with padding
    const padding = 20;
    const hudWidth = 240;
    const hudHeight = 200;

    if (left + hudWidth > window.innerWidth - padding) {
      left = topLeft.x - hudWidth - 15;
    }

    const finalLeft = Math.max(
      padding,
      Math.min(left, window.innerWidth - hudWidth - padding),
    );
    const finalTop = Math.max(
      padding,
      Math.min(top, window.innerHeight - hudHeight - padding),
    );

    // Apply position directly to element - completely bypass parent positioning
    // Use fixed positioning and explicitly reset any transforms to prevent canvas zoom scaling
    this.element.style.position = 'fixed';
    this.element.style.left = `${finalLeft}px`;
    this.element.style.top = `${finalTop}px`;
    this.element.style.transform = 'none';
    this.element.style.scale = '1';

    // Update internal position tracking without calling super
    this.position.left = finalLeft;
    this.position.top = finalTop;

    return this.position;
  }


  /**
   * Clean up input states when HUD is closed
   */
  _cleanupInputs() {
    if (!this.element) return;

    // Remove focus from any active inputs
    const activeInputs = this.element.querySelectorAll("input:focus");
    activeInputs.forEach((input) => {
      input.blur();
      input.value = input.defaultValue; // Reset to original value
    });

    // Clear any active input states
    const allInputs = this.element.querySelectorAll("input");
    allInputs.forEach((input) => {
      input.classList.remove("active", "focused");
    });
  }

  /**
   * Clear internal caches
   */
  _clearCaches() {
    // Tag caching removed; only palette state needs clearing
    this._paletteStates?.clear();
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const token = this.object;
    const actor = token?.actor;

    if (!token || !actor) {
      return context;
    }

    // Get bar attributes
    const bar1 = this.document.getBarAttribute("bar1");
    const bar2 = this.document.getBarAttribute("bar2");

    const finalContext = foundry.utils.mergeObject(context, {
      // Basic info
      actorName: actor.name,

      // Attribute bars
      displayBar1: bar1 && bar1.type !== "none",
      bar1Data: bar1,
      displayBar2: bar2 && bar2.type !== "none",
      bar2Data: bar2,

      // Status effects
      statusEffects: this._getStatusEffects(),

      // Token state
      hidden: this.document.hidden,
      visibilityClass: this.document.hidden ? "active" : "",
      elevation: this.document.elevation,
      locked: this.document.locked,

      // Combat and targeting
      inCombat: this.document.inCombat,
      canToggleCombat: game.combat !== null,
      combatClass: this.document.inCombat ? "active" : "",
      targetClass: game.user.targets.has(this.object) ? "active" : "",

      // Movement actions
      movementActions: this._getMovementActions(),

      // Permissions
      isGM: game.user.isGM,
      canConfigure: game.user.can("TOKEN_CONFIGURE"),
      isGamePaused: game.paused,
    });

    return finalContext;
  }

  /**
   * Get status effects for the template
   */
  _getStatusEffects() {
    const choices = {};

    // Include all HUD-enabled status effects
    for (const status of CONFIG.statusEffects) {
      if (
        status.hud === false ||
        (foundry.utils.getType(status.hud) === "Object" &&
          status.hud.actorTypes?.includes(this.document.actor.type) === false)
      ) {
        continue;
      }

      choices[status.id] = {
        _id: status._id,
        id: status.id,
        title: game.i18n.localize(status.name ?? status.label),
        src: status.img ?? status.icon,
        isActive: false,
        isOverlay: false,
      };
    }

    // For PF2e actors, use the conditions API directly
    if (this.actor?.conditions) {
      // Get all active conditions
      const activeConditions = this.actor.conditions.active;

      for (const condition of activeConditions) {
        const status = choices[condition.slug];

        if (status && condition.isInHUD) {
          status.isActive = true;

          // Get the condition value
          if (
            condition.value !== undefined &&
            typeof condition.value === "number"
          ) {
            status.value = condition.value;
          }
        }
      }
    } else {
      // Fallback for non-PF2e systems using standard effects
      const activeEffects = this.actor?.effects || [];

      for (const effect of activeEffects) {
        for (const statusId of effect.statuses) {
          const status = choices[statusId];
          if (!status) continue;
          if (status._id) {
            if (status._id !== effect.id) continue;
          } else {
            if (effect.statuses.size !== 1) continue;
          }
          status.isActive = true;
          if (effect.getFlag("core", "overlay")) status.isOverlay = true;
          break;
        }
      }
    }

    // Flag status CSS class and convert to array
    return Object.values(choices).map((status) => ({
      id: status.id,
      title: status.title,
      src: status.src,
      value: status.value, // Include the condition value
      isActive: status.isActive, // Include active state for template
      cssClass: [
        status.isActive ? "active" : null,
        status.isOverlay ? "overlay" : null,
      ].filterJoin(" "),
    }));
  }

  /**
   * Get movement actions for the template
   */
  _getMovementActions() {
    // Use documented properties instead of private _source
    const currentAction = this.document.movementAction;

    const choices = [
      {
        id: "",
        label: game.i18n.localize("Default"),
        cssClass: currentAction === null ? "active" : "",
      },
    ];

    // Only show basic movement actions that are always available
    const basicActions = [
      { id: "walk", label: "Walk" },
      { id: "dash", label: "Dash" },
      { id: "fly", label: "Fly" },
      { id: "swim", label: "Swim" },
    ];

    for (const action of basicActions) {
      const isActive = action.id === currentAction;
      choices.push({
        id: action.id,
        label: game.i18n.localize(action.label),
        cssClass: isActive ? "active" : "",
      });
    }

    return choices;
  }

  /** @override */
  _parseAttributeInput(name, attr, input) {
    if (name === "bar1" || name === "bar2") {
      attr = this.document.getBarAttribute(name);
      name = attr.attribute;
    }
    return super._parseAttributeInput(name, attr, input);
  }

  /** @override */
  async _onSubmit(event, form, formData) {
    // Handle bar changes
    if (
      event.type === "change" &&
      ["bar1", "bar2"].includes(event.target.name)
    ) {
      return this._onSubmitBar(event, form, formData);
    }

    // Handle elevation changes
    if (event.type === "change" && event.target.name === "elevation") {
      return this._onSubmitElevation(event, form, formData);
    }

    return super._onSubmit(event, form, formData);
  }

  /**
   * Handle bar attribute changes
   */
  async _onSubmitBar(event, form, formData) {
    const name = event.target.name;
    const input = event.target.value;
    const { attribute, value, delta, isDelta, isBar } =
      this._parseAttributeInput(name, undefined, input);
    await this.actor?.modifyTokenAttribute(
      attribute,
      isDelta ? delta : value,
      isDelta,
      isBar,
    );
  }

  /**
   * Handle elevation changes
   */
  async _onSubmitElevation(event, form, formData) {
    const elevation = this._parseAttributeInput(
      "elevation",
      this.document.elevation,
      event.target.value,
    ).value;

    // Simple elevation update using documented methods
    await this.document.update({ elevation });
  }

  // === ACTION HANDLERS ===

  /**
   * Handle submenu mouse enter for context menu behavior
   */
  _onSubmenuEnter(event) {
    const trigger = event.currentTarget;
    const submenu = trigger.nextElementSibling;

    if (submenu && submenu.classList.contains("submenu")) {
      // Clear any existing timeout
      if (this._submenuTimeout) {
        clearTimeout(this._submenuTimeout);
        this._submenuTimeout = null;
      }

      // Close other open submenus
      this._closeAllSubmenus(submenu);

      // Show this submenu
      this._showSubmenu(trigger, submenu);
    }
  }

  /**
   * Handle submenu mouse leave for context menu behavior
   */
  _onSubmenuLeave(event) {
    const trigger = event.currentTarget;
    const submenu = trigger.nextElementSibling;

    if (submenu && submenu.classList.contains("submenu")) {
      // Delay hiding to allow mouse to move to submenu
      this._submenuTimeout = setTimeout(() => {
        if (!submenu.matches(":hover") && !trigger.matches(":hover")) {
          this._hideSubmenu(trigger, submenu);
        }
      }, 100);
    }
  }

  /**
   * Handle submenu content mouse enter
   */
  _onSubmenuContentEnter(event) {
    if (this._submenuTimeout) {
      clearTimeout(this._submenuTimeout);
      this._submenuTimeout = null;
    }
  }

  /**
   * Handle submenu content mouse leave
   */
  _onSubmenuContentLeave(event) {
    const submenu = event.currentTarget;
    const trigger = submenu.previousElementSibling;

    this._submenuTimeout = setTimeout(() => {
      if (!submenu.matches(":hover") && !trigger.matches(":hover")) {
        this._hideSubmenu(trigger, submenu);F2F4F7
        E6E9EF
      }
    }, 100);
  }

  /**
   * Handle HUD mouse leave to close all submenus
   */
  _onHudMouseLeave(event) {
    this._submenuTimeout = setTimeout(() => {
      this._closeAllSubmenus();
    }, 200);
  }

  /**
   * Show a submenu with proper positioning
   * @param {HTMLElement} trigger - The trigger element
   * @param {HTMLElement} submenu - The submenu element
   * @param {boolean} skipReset - If true, don't reset search value or selection (for restoring state)
   */
  _showSubmenu(trigger, submenu, skipReset = false) {
    // Position the submenu
    this._positionSubmenu(trigger, submenu);

    // Add active classes
    trigger.classList.add("expanded");
    submenu.classList.add("active");

    // Auto-focus the effect search when opening the status effects submenu
    if (submenu.classList.contains("status-effects")) {
      const search = submenu.querySelector("[data-effect-search='true']");
      if (search) {
        // Remove any existing event listeners to avoid duplicates
        search.removeEventListener("input", this._boundSearchInput);
        search.removeEventListener("keydown", this._boundSearchKeydown);

        // Store bound functions for removal later
        this._boundSearchInput = this._onEffectSearchInput.bind(this);
        this._boundSearchKeydown = this._onEffectSearchKeydown.bind(this);

        // Add event listeners
        search.addEventListener("input", this._boundSearchInput);
        search.addEventListener("keydown", this._boundSearchKeydown);

        if (!skipReset) {
          // Clear any previous search value
          search.value = "";

          // Focus the search input with a slight delay to ensure submenu is fully visible
          setTimeout(() => {
            search.focus();
            search.select(); // Select any existing text for easy overwriting
            // Trigger initial filter to ensure all items are visible and first is selected
            this._onEffectSearchInput({ currentTarget: search });
          }, 50);
        }
      }
    }
  }

  /**
   * Hide a submenu
   */
  _hideSubmenu(trigger, submenu) {
    trigger.classList.remove("expanded");
    submenu.classList.remove("active");

    // Clean up search event listeners when hiding status effects submenu
    if (submenu.classList.contains("status-effects")) {
      const search = submenu.querySelector("[data-effect-search='true']");
      if (search && this._boundSearchInput) {
        search.removeEventListener("input", this._boundSearchInput);
        search.removeEventListener("keydown", this._boundSearchKeydown);
      }
    }
  }

  /**
   * Close all open submenus
   */
  _closeAllSubmenus(except = null) {
    const submenus = this.element.querySelectorAll(".submenu");
    submenus.forEach((submenu) => {
      if (submenu !== except) {
        const trigger = submenu.previousElementSibling;
        this._hideSubmenu(trigger, submenu);
      }
    });
  }

  /**
   * Position submenu to avoid screen edges
   */
  _positionSubmenu(trigger, submenu) {
    const triggerRect = trigger.getBoundingClientRect();
    const hudRect = this.element.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();

    // Reset positioning classes
    submenu.classList.remove("flip-horizontal", "flip-vertical");

    // Check if submenu would go off right edge of screen
    const wouldOverflowRight =
      triggerRect.right + submenuRect.width > window.innerWidth - 20;
    if (wouldOverflowRight) {
      submenu.classList.add("flip-horizontal");
    }

    // Check if submenu would go off bottom edge of screen
    const wouldOverflowBottom =
      triggerRect.top + submenuRect.height > window.innerHeight - 20;
    if (wouldOverflowBottom) {
      submenu.classList.add("flip-vertical");
    }
  }

  /**
   * Toggle palette visibility (legacy support)
   */
  async _onTogglePalette(event, target) {
    event.preventDefault();
    const submenu = target.nextElementSibling;

    if (submenu) {
      const isActive = submenu.classList.contains("active");

      if (isActive) {
        this._hideSubmenu(target, submenu);
      } else {
        this._closeAllSubmenus(submenu);
        this._showSubmenu(target, submenu);
      }
    }
  }

  /**
   * Handle toggling a token status effect
   * Left-click (button 0): Increment condition value or add condition
   * Right-click (button 2): Decrement condition value or remove condition
   */
  async _onToggleEffect(event, target) {
    if (!this.actor) {
      ui.notifications.warn("HUD.WarningEffectNoActor", { localize: true });
      return;
    }

    // Update selection when clicking with mouse
    const submenu = target.closest(".submenu");
    if (submenu) {
      submenu
        .querySelectorAll(".submenu-item.selected")
        .forEach((el) => el.classList.remove("selected"));
      target.classList.add("selected");
    }

    const statusId = target.dataset.statusId;
    const isRightClick = event.button === 2;

    // Check if this is a PF2e condition with incremental values
    const isPF2eCondition =
      game.pf2e?.ConditionManager?.getCondition?.(statusId);

    if (isPF2eCondition && this.actor.conditions) {
      // Get the existing condition from the actor
      const existingCondition = this.actor.conditions
        .bySlug(statusId, { temporary: false })
        ?.find((c) => c.isInHUD && !c.system.references.parent);

      if (isRightClick) {
        // Right-click: Decrement or remove
        if (
          existingCondition?.value &&
          typeof existingCondition.value === "number"
        ) {
          // Has a value - decrease it
          await game.pf2e.ConditionManager.updateConditionValue(
            existingCondition.id,
            this.actor,
            existingCondition.value - 1,
          );
        } else if (existingCondition) {
          // No value or value is 1 - remove the condition
          await this.actor.decreaseCondition(statusId);
        }
        // If no condition exists, right-click does nothing
      } else {
        // Left-click: Increment or add
        if (
          existingCondition?.value &&
          typeof existingCondition.value === "number"
        ) {
          // Has existing value - increase it
          await game.pf2e.ConditionManager.updateConditionValue(
            existingCondition.id,
            this.actor,
            existingCondition.value + 1,
          );
        } else {
          // No existing value - add the condition (or increment if it's a valued condition)
          await this.actor.increaseCondition(statusId);
        }
      }
    } else {
      // Fall back to default toggle behavior for non-PF2e or non-valued conditions
      await this.actor.toggleStatusEffect(statusId, {
        active: !target.classList.contains("active"),
        overlay: isRightClick,
      });
    }
  }

  /**
   * Handle visibility toggle (GM only)
   */
  async _onToggleVisibility() {
    if (!game.user.isGM) {
      ui.notifications.warn("Only GMs can toggle token visibility");
      return;
    }
    await this.document.update({ hidden: !this.document.hidden });
  }

  /**
   * Toggle combat state
   */
  async _onToggleCombat(event, target) {
    const tokens = canvas.tokens.controlled.map((t) => t.document);
    if (!this.object.controlled) tokens.push(this.document);
    try {
      if (this.document.inCombat)
        await foundry.documents.TokenDocument.implementation.deleteCombatants(
          tokens,
        );
      else
        await foundry.documents.TokenDocument.implementation.createCombatants(
          tokens,
        );
    } catch (err) {
      ui.notifications.warn(err.message);
    }
  }

  /**
   * Handle toggling the target state
   */
  _onToggleTarget(event, target) {
    const token = this.object;
    const targeted = !game.user.targets.has(token);
    token.setTarget(targeted, { releaseOthers: false });
    target.classList.toggle("active", targeted);
  }

  /**
   * Handle layer sorting (bring to front/send to back)
   */
  async _onSort(event, target) {
    const direction = target.dataset.direction;
    const currentZ = this.document.sort;
    const newZ = direction === "up" ? currentZ + 1 : currentZ - 1;
    await this.document.update({ sort: newZ });
  }

  /**
   * Handle selecting a movement action
   */
  async _onSelectMovementAction(event, target) {
    await this.document.update({
      movementAction: target.dataset.movementAction || null,
    });
  }

  /**
   * Handle token configuration
   */
  async _onConfig(event, target) {
    new TokenConfig(this.document).render(true);
  }
}

// Module initialization
Hooks.once("init", () => {
  // Register the availableTags setting
  game.settings.register("token-tags", "availableTags", {
    name: "Available Tags",
    hint: "Predefined tags available for tokens",
    scope: "world",
    config: false,
    type: Array,
    default: [
      {
        id: "important",
        name: "Important",
        icon: "fas fa-exclamation-triangle",
        category: "priority",
        description: "Marks this token as important",
        color: "#ff6b35",
      },
      {
        id: "ally",
        name: "Ally",
        icon: "fas fa-shield-alt",
        category: "faction",
        description: "Friendly unit",
        color: "#4ecdc4",
      },
      {
        id: "enemy",
        name: "Enemy",
        icon: "fas fa-skull",
        category: "faction",
        description: "Hostile unit",
        color: "#ff4757",
      },
      {
        id: "boss",
        name: "Boss",
        icon: "fas fa-crown",
        category: "priority",
        description: "Boss enemy",
        color: "#ff3838",
      },
      {
        id: "quest",
        name: "Quest",
        icon: "fas fa-scroll",
        category: "general",
        description: "Quest-related NPC",
        color: "#ffa502",
      },
      {
        id: "merchant",
        name: "Merchant",
        icon: "fas fa-coins",
        category: "general",
        description: "Merchant or trader",
        color: "#f39c12",
      },
    ],
  });
});

// Preload templates and register HUD class
Hooks.once("setup", () => {
  // Preload templates using new namespaced method
  foundry.applications.handlebars.loadTemplates([
    "modules/token-tags/templates/TokenHud.hbs",
  ]);

  // Register the custom TokenHUD class once
  CONFIG.Token.hudClass = TokenTagsHUD;
});

// Make available globally
globalThis.TokenTagsHUD = TokenTagsHUD;

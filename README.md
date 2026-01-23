<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mattermill/axeom-hud-pf2e/refs/heads/main/assets/axeom-lock-onlight.svg">
  <source media="(prefers-color-scheme: light)" srcset="[light-mode-image.png](https://raw.githubusercontent.com/mattermill/axeom-hud-pf2e/refs/heads/main/assets/axeom-lock-ondark.svg)">
  <img alt="Fallback image description" src="https://raw.githubusercontent.com/mattermill/axeom-hud-pf2e/refs/heads/main/assets/axeom-lock-onlight.svg">
</picture>

# Axeom HUD: PF2e
Token HUD improvements for [Pathfinder 2e](https://github.com/foundryvtt/pf2e) on [Foundry VTT](https://github.com/foundryvtt). 

## Features

### Quickly manage status effects:
The _Status Effects_ sub-menu allows you to quickly begin typing to find status effects to apply.

- `Enter`/`Left Click` to apply/increment
- `Shift+Enter`/`Right Click` to remove/decrement

When using keyboard shortcuts, if no condition is selected, the first condition in the list will be applied.

<img width="1920" height="1080" alt="SetConditions" src="https://github.com/user-attachments/assets/84337500-0868-47e5-a6ed-db9f675413bc" />

### Hide tokens conditionally:
<img width="1440" height="810" alt="HideFrom" src="https://github.com/user-attachments/assets/227e30fd-1fbc-49ad-977e-eeffdbb059d3" />

## Installation
Paste the following manifest URL into Foundry's "Install Module" dialog:
    
 ```
 https://raw.githubusercontent.com/mattermill/axeom-hud-pf2e/main/module.json
 ```

## Known Issues
This will override most modules that manipulate the token hud by adding other controls, such as [pf2e-hud](https://github.com/reonZ/pf2e-hud) and [conditional-visibility](https://github.com/mclemente/conditional-visibility).
### Bugs
- `Bring to Front` / `Send to Back` seems to update the z-index of the token by 1 for each click, rather than send the token all the way to the front/back. Until fixed, be mindful of excessive clicking :)
## To-Do
- [ ] Quick access to applied conditions in the main HUD for easy removal.
- [ ] Health increment/decrement buttons with reasonable stops (e.g. 1/5/10) for HP adjustments
---
Enjoy the module? [Buy me a coffee](https://www.buymeacoffee.com/mattermill) :)

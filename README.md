# token-hud-2e

Foundry VTT token HUD improvements for [foundryvtt/pf2e](https://github.com/foundryvtt/pf2e).

![Apply Conditions](Screenshot.png)

## Usage
### Applying Status Effects
Clicking **Status Effects** in the HUD menu will open a sub-menu where you can immediately begin searching for status effects to apply to the token. `Enter` applies/increments the selected condition from the list. If no condition is selected, the first condition in the list will be applied. `Shift+Enter` decrements the condition level.

| Shortcut | Description |
| --- | --- |
| `Enter` / `Left Click` | Increment the selected condition level |
| `Shift+Enter` / `Right Click` | Decrement the selected condition level |

## Known Issues

 - `Bring to Front` / `Send to Back` seems to update the z-index of the token by 1 for each click, rather than send the token all the way to the front/back. Until fixed, be mindful of excessive clicking :)

 ## To-Do
 - Quick access to applied conditions in the main HUD for easy removal.
 - Health increment/decrement buttons with reasonable stops (e.g. 1/5/10) for HP adjustments

 
 ## Installation
Paste the following manifest URL into Foundry's "Install Module" dialog:
    
 ```
 https://raw.githubusercontent.com/mattermill/token-hud-2e/main/module.json
 ```

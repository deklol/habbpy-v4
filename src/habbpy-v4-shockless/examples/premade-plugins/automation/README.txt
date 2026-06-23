# Automation Premade Module

Readable user-plugin source reference for the built-in Automation module.

This folder is a premade user-plugin source reference for the native built-in module.
It does not replace the native panel; it shows how a third-party plugin can subscribe to the same public events and APIs.

## Install

1. Open Plugin Manager.
2. Choose Install From Folder.
3. Select this folder.
4. Enable the installed plugin if needed.

## Permissions

- `ui.panel`
- `ui.status`
- `console.commands`
- `events.room`
- `engine.snapshot`
- `actions.avatar`
- `actions.fishing`
- `actions.furni`
- `actions.plants`
- `storage`

## Capabilities Mirrored From The Built-In Module

- Auto-hide Bulletin Board after login
- Fishing plugin split
- Gardening plugin split
- Wall Mover plugin split
- Comfort toggles
- Fishing minigame relay helpers

## Notes

- The plugin keeps state in plugin-scoped storage.
- Packet hooks observe and allow packets; they do not mutate traffic.
- Raw packet injection, custom React panels, and custom console commands remain reserved host phases.


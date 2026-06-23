# Fishing Premade Module

Readable user-plugin source reference for the built-in Fishing module.

This folder is a premade user-plugin source reference for the native built-in module.
It does not replace the native panel; it shows how a third-party plugin can subscribe to the same public events and APIs.

## Install

1. Open Plugin Manager.
2. Choose Install From Folder.
3. Select this folder.
4. Enable the installed plugin if needed.

## Permissions

- `ui.panel`
- `console.commands`
- `events.room`
- `engine.snapshot`
- `events.packet`
- `packet.read`
- `actions.fishing`
- `actions.avatar`
- `storage`

## Capabilities Mirrored From The Built-In Module

- Live room prerequisite, fishing-area candidate rows, and walk-to-area movement
- Validated start fishing, minigame input, derby register, token, stats, rod, products, and Fishopedia relay actions
- Packet-backed catches, golden catches, XP, token balance, and level
- Packet-backed minigame status/pin values and frenzy notifications
- Packet-backed Fishopedia snapshot/update rows

## Notes

- The plugin keeps state in plugin-scoped storage.
- Packet hooks observe and allow packets; they do not mutate traffic.
- Raw packet injection, custom React panels, and custom console commands remain reserved host phases.


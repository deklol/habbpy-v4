# Present Catcher Premade Module

Readable user-plugin source reference for the built-in Present Catcher module.

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
- `events.packet`
- `engine.snapshot`
- `engine.control`
- `packet.read`
- `packet.inject`
- `actions.avatar`
- `actions.furni`
- `storage`

## Capabilities Mirrored From The Built-In Module

- Live hammer and event-present target lists from parsed room objects
- Panic list using parsed room users
- Packet-backed walk, hammer collect, and present-use actions
- Gift opener controls for inventory tokens and present-open packets
- Treasure fragment request/trade packet controls

## Notes

- The plugin keeps state in plugin-scoped storage.
- Packet hooks observe and allow packets; they do not mutate traffic.
- Raw packet injection, custom React panels, and custom console commands remain reserved host phases.

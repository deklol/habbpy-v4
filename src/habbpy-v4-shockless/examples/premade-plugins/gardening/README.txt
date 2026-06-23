# Gardening Premade Module

Readable user-plugin source reference for the built-in Gardening module.

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
- `actions.plants`
- `storage`

## Capabilities Mirrored From The Built-In Module

- Start Gardening and Compost All use the v3 move/action/return packet flow through the local relay
- Live plant-like room object candidate list
- Current target plant detail from room rows
- Current cycle phase, original tile, working tile, attempts, completed, and queued counts
- Tracked room and room-cycle controls documented until visit helpers exist

## Notes

- The plugin keeps state in plugin-scoped storage.
- Packet hooks observe and allow packets; they do not mutate traffic.
- Raw packet injection, custom React panels, and custom console commands remain reserved host phases.

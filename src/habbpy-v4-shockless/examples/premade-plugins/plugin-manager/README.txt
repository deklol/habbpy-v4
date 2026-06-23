# Plugin Manager Premade Module

Readable user-plugin source reference for the built-in Plugin Manager module.

This folder is a premade user-plugin source reference for the native built-in module.
It does not replace the native panel; it shows how a third-party plugin can subscribe to the same public events and APIs.

## Install

1. Open Plugin Manager.
2. Choose Install From Folder.
3. Select this folder.
4. Enable the installed plugin if needed.

## Permissions

- `ui.panel`
- `events.session`
- `engine.snapshot`
- `storage`

## Capabilities Mirrored From The Built-In Module

- Pinned core plugin that cannot be disabled
- Built-in and user plugin list
- Enable/disable optional plugins
- Per-surface toggles
- Create plugin from template
- Install plugin from folder
- Plugin folder and reload controls

## Notes

- The plugin keeps state in plugin-scoped storage.
- Packet hooks observe and allow packets; they do not mutate traffic.
- Raw packet injection, custom React panels, and custom console commands remain reserved host phases.

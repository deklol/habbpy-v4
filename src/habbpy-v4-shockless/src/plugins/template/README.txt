# Habbpy v4 Plugin Template

This folder is copied by Plugin Manager when a user creates a plugin.

Files:

- `habbpy.plugin.json`: plugin metadata, schema UI surfaces, commands, hotkeys, and permissions.
- `plugin.js`: JavaScript module entry point running in the restricted Habbpy worker host.

The template demonstrates:

- `ui.preview`: plugin-store preview content.
- `ui.settings`: plugin settings controls.
- `surfaces[].layout`: the plugin rail/panel UI.
- `ui.onAction()`: handling button/toggle/input changes.
- `ui.setValue()`: updating host-rendered control values from plugin code.
- `buttonGrid`: reusable grouped buttons rendered by the host.
- `table.rowAction`: selectable rows that emit the clicked row key.
- `commands` and `hotkeys`: declared command metadata.

Do not store account files, passwords, tokens, endpoints URLs, or local test credentials in plugin folders.

See `docs/plugin-authoring.md` and `docs/plugin-api-reference.md` in the Habbpy v4 source tree for the full schema and API reference.

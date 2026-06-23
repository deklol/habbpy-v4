# Habbpy v4 Plugin Template

This folder is copied by Plugin Manager when a user creates a plugin.

Files:

- `habbpy.plugin.json`: plugin metadata, surfaces, and permissions.
- `plugin.js`: JavaScript module entry point.

The Plugin Manager validates, installs, enables, disables, and displays this
plugin from the manifest. Packet permissions are included in the relay policy
when the plugin is enabled.

Plugin entry execution must go through the restricted Habbpy host. Do not store
account files, passwords, tokens, or webhook URLs in plugin folders.

See `docs/plugin-authoring.md` in the Habbpy v4 source tree for the full
create/install workflow, manifest schema, surface types, permissions, relay
hook policy, validation rules, packaging notes, and example plugin manifests.

# Chooser/Furni Permissions

This example demonstrates the `client.rights` permission and the client rights API.

The plugin grants when a selected source runtime is ready:

- `fuse_habbo_chooser`
- `fuse_furni_chooser`

Those rights live in the selected Shockless source `Session.user_rights` list. They are clientside runtime rights, not server account privileges. After the plugin is enabled in a loaded room, type `:chooser` or `:furni` through the normal game chat path. If the client accepts the right list, the matching Habbo chooser window opens.

Relevant APIs:

```js
await client.getRights();
await client.grantRights(["fuse_habbo_chooser"]);
await client.removeRights(["fuse_habbo_chooser"]);
await client.enableChooserCommands();
```

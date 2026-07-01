Shockless Application Source
==============================

This folder contains the Electron/React desktop application, plugin manager, user plugin host, packet log reader, relay bridge integration, and portable packaging scripts.

License: GNU Affero General Public License v3.0.

Build:

  npm install
  npm run build

Package portable:

  npm --prefix ../habbo-origins-engine/standalone install
  npm --prefix ../habbo-origins-engine/standalone run compile
  npm run package:portable

The sibling engine source is expected at ../habbo-origins-engine in this release layout. Import/Build Client needs the built Shockless standalone importer at ../habbo-origins-engine/standalone/dist/main/cli/profile-import.js.

Public docs are in ../../docs and this folder's docs directory.

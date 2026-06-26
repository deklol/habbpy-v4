interface AboutPanelProps {
  readonly appName: string;
  readonly appVersion: string;
  readonly appMode: string;
  readonly profileLabel: string;
  readonly buildLabel: string;
  readonly storageMode: string;
}

export function AboutPanel({ appName, appVersion, appMode, profileLabel, buildLabel, storageMode }: AboutPanelProps) {
  return (
    <div className="runtime-panel about-panel">
      <div className="kv-grid">
        <span>App</span>
        <strong>{appName}</strong>
        <span>Version</span>
        <strong>{appVersion}</strong>
        <span>Mode</span>
        <strong>{appMode}</strong>
        <span>Profile</span>
        <strong>{profileLabel}</strong>
        <span>Build</span>
        <strong>{buildLabel}</strong>
        <span>Storage</span>
        <strong>{storageMode}</strong>
      </div>
      <div className="mini-section">
        <h3>Project</h3>
        <p>
          Habbpy v4 is a local Electron and React companion shell for Shockless Engine. It embeds the playable
          Director-compatible client and ports Habbpy v3 features into compact plugins.
        </p>
      </div>
      <div className="mini-section">
        <h3>Credits</h3>
        <div className="chip-list">
          <span>dek</span>
          <span>cam</span>
          <span>jeff</span>
          <span>sonicmouse</span>
          <span>scott</span>
          <span>Jephyrr</span>
          <span>DarkStar</span>
          <span>G-Earth</span>
          <span>ProjectorRays</span>
          <span>Shockless Engine</span>
        </div>
      </div>
      <div className="mini-section">
        <h3>Links</h3>
        <div className="mini-table about-link-table">
          <p><span>Site</span><strong>https://dek.cx</strong></p>
          <p><span>Habbo</span><strong>https://habbo.dek.cx</strong></p>
          <p><span>Social</span><strong>https://x.com/dekHabbo</strong></p>
          <p><span>G-Earth</span><strong>https://github.com/G-Realm/G-Earth</strong></p>
        </div>
      </div>
    </div>
  );
}

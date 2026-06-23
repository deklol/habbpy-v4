const CHOOSER_RIGHTS = ["fuse_habbo_chooser", "fuse_furni_chooser"];

export async function activate({ client, events, log, storage }) {
  let grantCount = 0;

  async function tryGrantChooserRights(reason) {
    try {
      const result = await client.enableChooserCommands();
      grantCount += 1;
      await storage.set("lastGrant", {
        ok: true,
        reason,
        grantCount,
        rights: result?.result?.rights ?? result?.rights ?? [],
        updatedAt: new Date().toISOString(),
      });
      log.info(`Chooser/Furni rights granted (${reason}).`);
      return result;
    } catch (error) {
      await storage.set("lastGrant", {
        ok: false,
        reason,
        message: error?.message || String(error),
        updatedAt: new Date().toISOString(),
      });
      log.warn(`Chooser/Furni rights not ready yet (${reason}): ${error?.message || error}`);
      return null;
    }
  }

  await tryGrantChooserRights("activation");
  const offRoomReady = events.on("room.ready", () => tryGrantChooserRights("room.ready"));

  return () => {
    offRoomReady();
  };
}

export const rights = CHOOSER_RIGHTS;

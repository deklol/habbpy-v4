export function activate(api) {
  const { log, packets, plugin } = api;

  log.info(`${plugin.name || "Sample plugin"} activated.`);

  const disposePacketListener = packets.on("server", {}, (packet) => {
    log.info(`server packet ${packet.packetName ?? "UNKNOWN_HEADER"} [${packet.header ?? "-"}]`);
    return packet.allow();
  });

  return () => {
    disposePacketListener();
    log.info(`${plugin.name || "Sample plugin"} deactivated.`);
  };
}

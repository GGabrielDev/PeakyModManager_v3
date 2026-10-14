import { autoUpdater } from "electron-updater";
import log from "electron-log/main";
import { app, ipcMain } from "electron";

const updatesEnabled = () =>
  app.isPackaged &&
  process.env.PMM_PACKAGE_MANAGED !== "1" &&
  __PMM_UPDATE_SOURCE__ !== null &&
  (process.platform === "win32" || (process.platform === "linux" && Boolean(process.env.APPIMAGE)));

ipcMain.handle("check-for-updates", async (): Promise<boolean | null> => {
  if (!updatesEnabled()) return null;
  const result = await autoUpdater.checkForUpdates();
  return result?.isUpdateAvailable ?? null;
});

export const setupAutoUpdater = () => {
  if (!updatesEnabled()) {
    log.info("Automatic updates disabled for this build or installation format.");
    return;
  }
  autoUpdater.setFeedURL(__PMM_UPDATE_SOURCE__!);
  autoUpdater.channel = __PMM_UPDATE_SOURCE__!.channel;
  autoUpdater.allowPrerelease = __PMM_UPDATE_SOURCE__!.channel === "preview";
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("error", (error) => log.error("Selected update source unavailable:", error.message));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for updates...");
  });
  autoUpdater.on("update-available", (info) => {
    log.info("Update available.", info);
  });
  autoUpdater.on("update-not-available", (info) => {
    log.info("Update not available.", info);
  });
  autoUpdater.checkForUpdatesAndNotify();
};

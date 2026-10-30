"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// The renderer is the web app; it only needs to know that it is running
// inside the desktop shell. No Node API is exposed to the page.
contextBridge.exposeInMainWorld("piWebDesktop", {
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  /**
   * The OS's own folder picker. Resolves `{ canceled, path }`; a build without
   * the handler rejects and the page keeps its own directory browser.
   */
  pickDirectory: (options) => ipcRenderer.invoke("pi-web:pick-directory", options ?? {}),
  /** Desktop-only settings (they belong to the app, not the web settings file). */
  getDesktopSettings: () => ipcRenderer.invoke("pi-web:get-desktop-settings"),
  /** Saves whether a fixed Web endpoint is offered. Applies on the next launch. */
  setWebAccess: (enabled) => ipcRenderer.invoke("pi-web:set-web-access", enabled === true),
  focusWindow: () => ipcRenderer.invoke("pi-web:focus-window"),
});

// The shell's own window chrome: on macOS the traffic lights are inset into the
// sidebar's first row (electron/main.js), so that row has to leave room for them
// and the browser build must not. A data attribute is the whole signal — the app
// keeps working with no desktop flag at all.
function markDesktopShell() {
  if (process.platform !== "darwin") return;
  document.documentElement?.setAttribute("data-desktop-shell", "mac");
}

markDesktopShell();
document.addEventListener("DOMContentLoaded", markDesktopShell);

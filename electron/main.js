"use strict";

// PI NEXT (pi-web) desktop shell.
//
// The web app is a Next.js server (API routes + UI), so the desktop app is
// this: a window that talks to a local Next server running out of the
// packaged bundle. The server runs as a child process (`next start` under
// Electron's Node mode) so a crash in the app's server code cannot take the
// window down with it, and so the server keeps the exact production runtime
// path the web app uses.

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_NAME = "PI NEXT";
const HOST = "127.0.0.1";
const DEFAULT_PORT = 30141;
const READY_TIMEOUT_MS = 90_000;
const IS_MAC = process.platform === "darwin";

// macOS keeps its own traffic lights and the app draws everything else: the
// lights sit inside the shell's first row, 8px in from the window edge like the
// floating panes (app/v3/shell.css). Windows and Linux have no such overlay to
// inset and keep the native frame with its own title bar.
const TRAFFIC_LIGHT_POSITION = { x: 24, y: 24 };

let mainWindow = null;
let serverProcess = null;
let serverPort = DEFAULT_PORT;
let quitting = false;

app.setName(APP_NAME);

// A packaged install is read-only for the user, and a test run must not touch
// the real profile: PI_WEB_USER_DATA_DIR moves the whole userData directory
// (which also moves the single-instance lock, so a smoke test can run beside
// the app the user already has open).
const userDataOverride = process.env.PI_WEB_USER_DATA_DIR;
if (userDataOverride) {
  try {
    fs.mkdirSync(userDataOverride, { recursive: true });
    app.setPath("userData", userDataOverride);
  } catch (error) {
    console.error("[pi-web] could not apply PI_WEB_USER_DATA_DIR:", error);
  }
}

function appDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(__dirname, "..");
}

function log(...args) {
  console.log("[pi-web]", ...args);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function choosePort(preferred) {
  if (await isPortFree(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function probeServer(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: HOST, port, path: "/api/home", timeout: 3000 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(`the PI NEXT server exited with code ${serverProcess.exitCode}`);
    }
    if (await probeServer(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startServer(port) {
  const dir = appDir();
  const nextBin = path.join(dir, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    throw new Error(`next is missing from the bundle: ${nextBin}`);
  }
  if (!fs.existsSync(path.join(dir, ".next", "BUILD_ID"))) {
    throw new Error(`the app was not built: ${path.join(dir, ".next", "BUILD_ID")} is missing`);
  }

  log(`starting the server on ${HOST}:${port}`);
  const child = spawn(
    process.execPath,
    [nextBin, "start", "-H", HOST, "-p", String(port)],
    {
      cwd: dir,
      env: {
        ...process.env,
        // The Electron binary is the Node runtime for the server process.
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const forward = (stream) => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) process.stdout.write(`[server] ${line}\n`);
      }
    });
  };
  forward(child.stdout);
  forward(child.stderr);

  child.on("exit", (code, signal) => {
    if (!quitting) {
      log(`the server stopped (code ${code}, signal ${signal})`);
    }
  });

  return child;
}

// The system folder picker. The web build has its own directory browser
// (components/DirectoryPicker.tsx); in the desktop shell that dialog is the
// wrong one — the OS's own picker knows the sidebar's places, recent folders
// and network volumes, and can create a folder. The renderer asks for it over
// IPC and falls back to the web dialog when this handler is not there.
ipcMain.handle("pi-web:pick-directory", async (_event, options) => {
  const { defaultPath, title } = options && typeof options === "object" ? options : {};
  const options_ = {
    title: typeof title === "string" && title ? title : "Select a folder",
    defaultPath: typeof defaultPath === "string" && defaultPath ? defaultPath : undefined,
    properties: ["openDirectory", "createDirectory"],
  };
  // Modal to the window when there is one; the plain overload otherwise.
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options_)
    : await dialog.showOpenDialog(options_);
  if (result.canceled || result.filePaths.length === 0) return { canceled: true, path: null };
  return { canceled: false, path: result.filePaths[0] };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#101014",
    title: APP_NAME,
    ...(IS_MAC
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: TRAFFIC_LIGHT_POSITION }
      : null),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Links to the outside world open in the user's browser, never in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://${HOST}:${serverPort}`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`http://${HOST}:${serverPort}/`);
}

function stopServer() {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

async function start() {
  try {
    serverPort = await choosePort(
      Number(process.env.PI_WEB_PORT || process.env.PORT) || DEFAULT_PORT,
    );
    serverProcess = startServer(serverPort);
    const ready = await waitForServer(serverPort, READY_TIMEOUT_MS);
    if (!ready) throw new Error("the PI NEXT server did not come up in time");
    log(`the server is ready on ${HOST}:${serverPort}`);
    createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("startup failed:", message);
    dialog.showErrorBox(`${APP_NAME} could not start`, message);
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  // Another copy owns the lock: it owns the window, this copy only exits.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(start);

  app.on("activate", () => {
    if (!mainWindow && serverProcess) createWindow();
  });

  app.on("window-all-closed", () => {
    // The server is a child of this process; keeping the app alive would
    // keep a Next server running with no window attached to it.
    app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });
}

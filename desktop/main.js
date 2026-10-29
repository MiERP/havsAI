'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const configPath = path.join(__dirname, 'config.json');
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : { serverUrl: 'https://103-20-102-229.sslip.io', fallbackUrl: 'http://localhost:3000' };

const SERVER_URL = (process.env.HAVS_SERVER_URL || config.serverUrl || 'https://103-20-102-229.sslip.io').replace(/\/+$/, '');

let electron;
try {
  electron = require('electron');
} catch {
  electron = null;
}

if (electron && electron.app) {
  const { app, BrowserWindow, shell, ipcMain, Notification } = electron;

  function createWindow() {
    const win = new BrowserWindow({
      title: 'havsAI — Gia sư AI Đa nền tảng',
      width: config.window?.width || 1360,
      height: config.window?.height || 860,
      minWidth: config.window?.minWidth || 420,
      minHeight: config.window?.minHeight || 640,
      backgroundColor: '#081005',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true
      }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(SERVER_URL)) return { action: 'allow' };
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });

    win.loadURL(`${SERVER_URL}/`).catch(() => {
      if (config.fallbackUrl) {
        win.loadURL(`${config.fallbackUrl}/`).catch(() => {});
      }
    });
  }

  ipcMain.handle('havs-desktop-info', () => ({
    platform: 'desktop',
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    appVersion: config.version || '1.0.0',
    serverUrl: SERVER_URL
  }));

  ipcMain.handle('havs-desktop-notify', (_event, payload) => {
    if (Notification && Notification.isSupported()) {
      new Notification({
        title: String(payload?.title || 'havsAI'),
        body: String(payload?.body || '')
      }).show();
      return { ok: true };
    }
    return { ok: false };
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, net, session } = require('electron');
const steamworks = require('steamworks.js');
const packageJson = require('./package.json');
const { SteamAuthHttpTransport } = require('./authTransport.cjs');
const { SteamWebApiTicketBroker } = require('./ticketBroker.cjs');

const REQUEST_TICKET_CHANNEL = 'gravity-well:steam:request-web-api-ticket';
const CANCEL_TICKET_CHANNEL = 'gravity-well:steam:cancel-web-api-ticket';
const EXCHANGE_SESSION_CHANNEL = 'gravity-well:steam:exchange-session';
const packagedIdentity = packageJson.gravityWell?.steamWebApiIdentity;
const packagedAuthApiBase = packageJson.gravityWell?.steamAuthApiBase;
const webEntryPath = path.join(__dirname, 'web', 'index.html');
const webEntryUrl = pathToFileURL(webEntryPath).toString();

let mainWindow = null;
let ticketBroker = null;
let authTransport = null;

function readSteamAppId() {
  const raw = process.env.STEAM_APP_ID ?? process.env.SteamAppId ?? process.env.SteamGameId ?? '';
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function createSteamClient() {
  const appId = readSteamAppId();
  if (appId && typeof steamworks.restartAppIfNecessary === 'function') {
    if (steamworks.restartAppIfNecessary(appId)) {
      return null;
    }
  }
  return appId ? steamworks.init(appId) : steamworks.init();
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Steam bridge rejected an unknown renderer.');
  }
  const senderUrl = event.senderFrame?.url ?? '';
  if (senderUrl !== webEntryUrl) {
    throw new Error('Steam bridge rejected an unexpected document.');
  }
}

function registerTicketIpc() {
  ipcMain.handle(REQUEST_TICKET_CHANNEL, async (event, identity) => {
    assertTrustedSender(event);
    return ticketBroker.acquire(identity);
  });
  ipcMain.handle(CANCEL_TICKET_CHANNEL, async (event, ticketId) => {
    assertTrustedSender(event);
    return ticketBroker.cancel(ticketId);
  });
  ipcMain.handle(EXCHANGE_SESSION_CHANNEL, async (event, request) => {
    assertTrustedSender(event);
    const endpoint = request?.endpoint;
    const ticketId = request?.ticketId;
    const ticket = ticketBroker.claimTicketForExchange(ticketId);
    if (!ticket) {
      throw new Error('Steam authentication rejected an unknown, expired, or already-used ticket lease.');
    }
    return authTransport.exchange(endpoint, ticket);
  });
}

function installRendererSecurityPolicy() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith('file:')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' file:; script-src 'self' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' data: blob: file:; media-src 'self' data: blob: file:; connect-src https: wss:; object-src 'none'; base-uri 'none'; frame-src 'none'",
        ],
      },
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1100,
    minHeight: 650,
    show: false,
    backgroundColor: '#020817',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== webEntryUrl) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    ticketBroker?.cancelAll();
    mainWindow = null;
  });
  void mainWindow.loadFile(webEntryPath);
}

app.enableSandbox();
app.whenReady().then(() => {
  try {
    const steamClient = createSteamClient();
    if (!steamClient) {
      app.quit();
      return;
    }
    ticketBroker = new SteamWebApiTicketBroker({
      client: steamClient,
      identity: packagedIdentity,
    });
    const developmentApiBase = !app.isPackaged
      ? String(process.env.STEAM_AUTH_API_BASE ?? '').trim()
      : '';
    authTransport = new SteamAuthHttpTransport({
      apiBase: developmentApiBase || packagedAuthApiBase,
      fetchImpl: net.fetch.bind(net),
      allowLoopbackHttp: !app.isPackaged,
    });
    installRendererSecurityPolicy();
    registerTicketIpc();
    createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Steamworks startup failure.';
    dialog.showErrorBox('Gravity Well could not start through Steam', message);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => ticketBroker?.cancelAll());

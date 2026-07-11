import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, session } from 'electron'
import path from 'path'
import { 
  initDatabase,
  getAccounts,
  addAccount,
  updateAccount,
  deleteAccount,
  getContacts,
  addContact,
  updateContact,
  deleteContact,
  getCallHistory,
  addCallHistory,
  deleteCallHistory,
  clearCallHistory,
  getMessages,
  addMessage,
  updateMessage,
  markConversationRead,
  deleteConversation,
  getSettings,
  updateSettings
} from './database'
import { NativeSipService } from './sip/NativeSipService'

// Safe IPC sender — guards against a null/destroyed window.
function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (!rendererReady) return
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

  try {
    const frame = mainWindow.webContents.mainFrame as Electron.WebFrameMain & { isDestroyed?: () => boolean }
    if (!frame || frame.isDestroyed?.()) return
    frame.send(channel, ...args)
  } catch {
    // Renderer gone — drop the message silently instead of spamming logs.
  }
}

// Extend app with isQuitting flag
interface AppWithQuitting extends Electron.App {
  isQuitting?: boolean
}

const appWithQuitting = app as AppWithQuitting

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let nativeSipService: NativeSipService | null = null
let rendererReady = false

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 340,
    height: 620,
    minWidth: 300,
    minHeight: 480,
    maxWidth: 480,
    titleBarStyle: 'hiddenInset',
    frame: false,
    // transparent + vibrancy + getUserMedia crashes the macOS compositor
    // when the mic permission popup appears — the renderer frame is disposed
    // and the window goes blank. Disable both for now so audio works reliably.
    transparent: false,
    vibrancy: undefined,
    visualEffectState: undefined,
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // DevTools can be opened manually with Cmd+Option+I (macOS) or Ctrl+Shift+I (Windows/Linux)
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Hide instead of close when clicking X
  mainWindow.on('close', (event) => {
    if (!appWithQuitting.isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Log renderer crashes so we can diagnose blank-screen issues.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    rendererReady = false
    console.error(`[Main] Renderer GONE: reason=${details?.reason} exitCode=${details?.exitCode}`)
  })
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[Main] Renderer UNRESPONSIVE')
  })
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
    console.log('[Main] Renderer STARTED LOADING (reload or navigation)')
  })
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true
    console.log('[Main] Renderer FINISHED LOAD')
  })
}

function createTray() {
  // Load tray icon based on platform
  let trayIconPath: string
  
  if (process.platform === 'darwin') {
    // macOS - use template icon
    trayIconPath = isDev
      ? path.join(__dirname, '../build/trayIcon.png')
      : path.join(process.resourcesPath, 'trayIcon.png')
  } else if (process.platform === 'win32') {
    // Windows
    trayIconPath = isDev
      ? path.join(__dirname, '../build/trayIcon-win.png')
      : path.join(process.resourcesPath, 'trayIcon-win.png')
  } else {
    // Linux
    trayIconPath = isDev
      ? path.join(__dirname, '../build/trayIcon.png')
      : path.join(process.resourcesPath, 'trayIcon.png')
  }
  
  // Create icon
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(trayIconPath)
    
    // If icon failed to load, try alternative path
    if (icon.isEmpty()) {
      const altPath = path.join(__dirname, '../public/icon.svg')
      icon = nativeImage.createFromPath(altPath)
      if (!icon.isEmpty()) {
        icon = icon.resize({ width: 16, height: 16 })
      }
    }
    
    // Set as template for macOS (adapts to light/dark mode)
    if (process.platform === 'darwin' && !icon.isEmpty()) {
      icon.setTemplateImage(true)
    }
  } catch (error) {
    console.error('Failed to load tray icon:', error)
    // Create a simple fallback icon
    icon = nativeImage.createEmpty()
  }
  
  tray = new Tray(icon)
  
  updateTrayMenu()
  
  tray.setToolTip('Zarsip - SIP Softphone')
  
  // Click to show/hide window
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
  
  // Right-click for menu
  tray.on('right-click', () => {
    tray?.popUpContextMenu()
  })
}

function updateTrayMenu() {
  if (!tray) return
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Zarsip',
      enabled: false,
      icon: nativeImage.createEmpty()
    },
    { type: 'separator' },
    {
      label: mainWindow?.isVisible() ? 'Hide Window' : 'Show Window',
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow?.show()
          mainWindow?.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Accounts',
      enabled: false
    },
    // Account status will be added dynamically here
    { type: 'separator' },
    {
      label: 'About Zarsip',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Zarsip',
      click: () => {
        appWithQuitting.isQuitting = true
        app.quit()
      }
    }
  ])
  
  tray.setContextMenu(contextMenu)
}

app.whenReady().then(() => {
  // Initialize database
  initDatabase()

  // Allow the renderer to access the microphone without a per-attempt prompt.
  // (macOS still shows the TCC system prompt once on first use.)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media')
  })

  // Initialize native SIP service
  nativeSipService = new NativeSipService()

  // Push remote RTP audio frames to the renderer for playback.
  nativeSipService.setRemoteFrameSink((frame: Int16Array) => {
    sendToRenderer('rtp:remote', frame)
  })

  // Set up SIP event handlers
  nativeSipService.on('registered', (accountId: string) => {
    console.log(`[Main] Account ${accountId} registered`)
    sendToRenderer('sip:registered', accountId)
  })

  nativeSipService.on('registrationFailed', (accountId: string, error: any) => {
    console.error(`[Main] Registration failed for ${accountId}:`, error)
    sendToRenderer('sip:registrationFailed', accountId, typeof error === 'string' ? error : error?.message ?? String(error))
  })

  nativeSipService.on('incomingCall', (accountId: string, number: string, callId: string) => {
    console.log(`[Main] Incoming call from ${number} (callId ${callId})`)
    sendToRenderer('sip:incomingCall', accountId, number, callId)
  })

  nativeSipService.on('incomingMessage', (accountId: string, from: string, body: string) => {
    console.log(`[Main] Incoming message from ${from}`)
    sendToRenderer('sip:incomingMessage', accountId, from, body)
  })

  nativeSipService.on('callState', (state: string) => {
    console.log(`[Main] Call state: ${state}`)
    sendToRenderer('sip:callState', state)
  })

  nativeSipService.on('authRequired', (accountId: string) => {
    sendToRenderer('sip:authRequired', accountId)
  })

  nativeSipService.on('error', (accountId: string, error: any) => {
    console.error(`[Main] SIP error for ${accountId}:`, error)
    sendToRenderer('sip:error', accountId, typeof error === 'string' ? error : error?.message ?? String(error))
  })

  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Don't quit the app when all windows are closed
  // The app will continue running in the tray
  // Only quit on macOS if explicitly requested
  if (process.platform !== 'darwin' && appWithQuitting.isQuitting) {
    app.quit()
  }
})

// Database IPC Handlers
ipcMain.handle('db:getAccounts', () => getAccounts())
ipcMain.handle('db:addAccount', (_event, account) => addAccount(account))
ipcMain.handle('db:updateAccount', (_event, id, account) => updateAccount(id, account))
ipcMain.handle('db:deleteAccount', (_event, id) => deleteAccount(id))

ipcMain.handle('db:getContacts', () => getContacts())
ipcMain.handle('db:addContact', (_event, contact) => addContact(contact))
ipcMain.handle('db:updateContact', (_event, id, contact) => updateContact(id, contact))
ipcMain.handle('db:deleteContact', (_event, id) => deleteContact(id))

ipcMain.handle('db:getCallHistory', () => getCallHistory())
ipcMain.handle('db:addCallHistory', (_event, call) => addCallHistory(call))
ipcMain.handle('db:deleteCallHistory', (_event, id) => deleteCallHistory(id))
ipcMain.handle('db:clearCallHistory', () => clearCallHistory())
ipcMain.handle('db:getMessages', () => getMessages())
ipcMain.handle('db:addMessage', (_event, message) => addMessage(message))
ipcMain.handle('db:updateMessage', (_event, id, patch) => updateMessage(id, patch))
ipcMain.handle('db:markConversationRead', (_event, peer) => markConversationRead(peer))
ipcMain.handle('db:deleteConversation', (_event, peer) => deleteConversation(peer))

ipcMain.handle('db:getSettings', () => getSettings())
ipcMain.handle('db:updateSettings', (_event, settings) => updateSettings(settings))

// Window IPC Handlers
ipcMain.handle('show-notification', (_event, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
})

ipcMain.handle('minimize-window', () => {
  mainWindow?.minimize()
})

ipcMain.handle('maximize-window', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('close-window', () => {
  mainWindow?.close()
})

// Native SIP IPC Handlers
ipcMain.handle('sip:register-native', async (_event, account) => {
  if (!nativeSipService) return false
  return await nativeSipService.register(account)
})

ipcMain.handle('sip:unregister-native', async (_event, accountId) => {
  if (!nativeSipService) return
  await nativeSipService.unregister(accountId)
})

ipcMain.handle('sip:reconnect-native', async (_event, accountId) => {
  if (!nativeSipService) return false
  return await nativeSipService.reconnect(accountId)
})

ipcMain.handle('sip:call-native', async (_event, accountId, targetNumber) => {
  if (!nativeSipService) return null
  return await nativeSipService.makeCall(accountId, targetNumber)
})

ipcMain.handle('sip:hangup-native', async (_event, accountId) => {
  if (!nativeSipService) return
  await nativeSipService.hangup(accountId)
})

ipcMain.handle('sip:message-native', async (_event, accountId, to, body) => {
  if (!nativeSipService) return { ok: false, error: 'SIP service unavailable' }
  return await nativeSipService.sendMessage(accountId, to, body)
})

ipcMain.handle('sip:answer-native', async (_event, accountId, callId) => {
  if (!nativeSipService) return
  await nativeSipService.answer(accountId, callId)
})

ipcMain.handle('sip:reject-native', async (_event, accountId, callId) => {
  if (!nativeSipService) return
  await nativeSipService.reject(accountId, callId)
})

ipcMain.handle('sip:dtmf-native', async (_event, accountId, digit) => {
  if (!nativeSipService) return
  nativeSipService.sendDTMF(accountId, digit)
})

ipcMain.handle('sip:mute-native', async (_event, accountId, muted) => {
  if (!nativeSipService) return
  nativeSipService.mute(accountId, muted)
})

ipcMain.handle('sip:hold-native', async (_event, accountId) => {
  if (!nativeSipService) return
  await nativeSipService.hold(accountId)
})

ipcMain.handle('sip:unhold-native', async (_event, accountId) => {
  if (!nativeSipService) return
  await nativeSipService.unhold(accountId)
})

// Mic audio frames from the renderer -> native RTP sender.
ipcMain.on('rtp:mic', (_event, accountId, frame: Int16Array) => {
  if (!nativeSipService) return
  nativeSipService.feedMicFrame(accountId, frame)
})

// Renderer log forwarding — so audio bridge errors show in the terminal.
ipcMain.on('renderer:log', (_event, msg: string) => {
  console.log(`[Renderer] ${msg}`)
})

// Cleanup on quit
app.on('before-quit', () => {
  if (nativeSipService) {
    nativeSipService.cleanup()
  }
})

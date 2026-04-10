import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } from 'electron'
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
  getSettings,
  updateSettings
} from './database'
import { NativeSipService } from './NativeSipService'

// Extend app with isQuitting flag
interface AppWithQuitting extends Electron.App {
  isQuitting?: boolean
}

const appWithQuitting = app as AppWithQuitting

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let nativeSipService: NativeSipService | null = null

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
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
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
  
  // Initialize native SIP service
  nativeSipService = new NativeSipService()
  
  // Set up SIP event handlers
  nativeSipService.on('registered', (accountId: string) => {
    console.log(`[Main] Account ${accountId} registered`)
    mainWindow?.webContents.send('sip:registered', accountId)
  })
  
  nativeSipService.on('registrationFailed', (accountId: string, error: any) => {
    console.error(`[Main] Registration failed for ${accountId}:`, error)
    mainWindow?.webContents.send('sip:registrationFailed', accountId, error.message)
  })
  
  nativeSipService.on('incomingCall', (accountId: string, number: string) => {
    console.log(`[Main] Incoming call from ${number}`)
    mainWindow?.webContents.send('sip:incomingCall', accountId, number)
  })
  
  nativeSipService.on('callState', (state: string) => {
    console.log(`[Main] Call state: ${state}`)
    mainWindow?.webContents.send('sip:callState', state)
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

ipcMain.handle('sip:call-native', async (_event, accountId, targetNumber) => {
  if (!nativeSipService) return
  await nativeSipService.makeCall(accountId, targetNumber)
})

ipcMain.handle('sip:hangup-native', async (_event, accountId) => {
  if (!nativeSipService) return
  await nativeSipService.hangup(accountId)
})

// Cleanup on quit
app.on('before-quit', () => {
  if (nativeSipService) {
    nativeSipService.cleanup()
  }
})

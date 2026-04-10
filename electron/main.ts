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
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createTray() {
  // Create a simple tray icon (you'll need to add actual icon files)
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => app.quit() }
  ])
  
  tray.setToolTip('Zarsip')
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    mainWindow?.show()
  })
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
  if (process.platform !== 'darwin') {
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

import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  db: {
    getAccounts: () => ipcRenderer.invoke('db:getAccounts'),
    addAccount: (account: any) => ipcRenderer.invoke('db:addAccount', account),
    updateAccount: (id: string, account: any) => ipcRenderer.invoke('db:updateAccount', id, account),
    deleteAccount: (id: string) => ipcRenderer.invoke('db:deleteAccount', id),
    
    getContacts: () => ipcRenderer.invoke('db:getContacts'),
    addContact: (contact: any) => ipcRenderer.invoke('db:addContact', contact),
    updateContact: (id: string, contact: any) => ipcRenderer.invoke('db:updateContact', id, contact),
    deleteContact: (id: string) => ipcRenderer.invoke('db:deleteContact', id),
    
    getCallHistory: () => ipcRenderer.invoke('db:getCallHistory'),
    addCallHistory: (call: any) => ipcRenderer.invoke('db:addCallHistory', call),
    
    getSettings: () => ipcRenderer.invoke('db:getSettings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('db:updateSettings', settings),
  },
  
  notifications: {
    show: (title: string, body: string) => 
      ipcRenderer.invoke('show-notification', title, body),
  },
  
  window: {
    minimize: () => ipcRenderer.invoke('minimize-window'),
    maximize: () => ipcRenderer.invoke('maximize-window'),
    close: () => ipcRenderer.invoke('close-window'),
  },
  
  // Native SIP operations
  sipNative: {
    register: (account: any) => ipcRenderer.invoke('sip:register-native', account),
    unregister: (accountId: string) => ipcRenderer.invoke('sip:unregister-native', accountId),
    makeCall: (accountId: string, targetNumber: string) => ipcRenderer.invoke('sip:call-native', accountId, targetNumber),
    hangup: (accountId: string) => ipcRenderer.invoke('sip:hangup-native', accountId),
    
    // Event listeners
    onRegistered: (callback: (accountId: string) => void) => {
      ipcRenderer.on('sip:registered', (_event, accountId) => callback(accountId))
    },
    onRegistrationFailed: (callback: (accountId: string, error: string) => void) => {
      ipcRenderer.on('sip:registrationFailed', (_event, accountId, error) => callback(accountId, error))
    },
    onIncomingCall: (callback: (accountId: string, number: string) => void) => {
      ipcRenderer.on('sip:incomingCall', (_event, accountId, number) => callback(accountId, number))
    },
    onCallState: (callback: (state: string) => void) => {
      ipcRenderer.on('sip:callState', (_event, state) => callback(state))
    },
  },
})

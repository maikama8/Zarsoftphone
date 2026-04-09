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
})

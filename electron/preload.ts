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
    reconnect: (accountId: string) => ipcRenderer.invoke('sip:reconnect-native', accountId) as Promise<boolean>,
    makeCall: (accountId: string, targetNumber: string) => ipcRenderer.invoke('sip:call-native', accountId, targetNumber) as Promise<string | null>,
    hangup: (accountId: string) => ipcRenderer.invoke('sip:hangup-native', accountId),
    answer: (accountId: string, callId: string) => ipcRenderer.invoke('sip:answer-native', accountId, callId),
    reject: (accountId: string, callId: string) => ipcRenderer.invoke('sip:reject-native', accountId, callId),
    sendDTMF: (accountId: string, digit: string) => ipcRenderer.invoke('sip:dtmf-native', accountId, digit),
    mute: (accountId: string, muted: boolean) => ipcRenderer.invoke('sip:mute-native', accountId, muted),
    hold: (accountId: string) => ipcRenderer.invoke('sip:hold-native', accountId),
    unhold: (accountId: string) => ipcRenderer.invoke('sip:unhold-native', accountId),

    // Event listeners
    onRegistered: (callback: (accountId: string) => void) => {
      ipcRenderer.on('sip:registered', (_event, accountId) => callback(accountId))
    },
    onRegistrationFailed: (callback: (accountId: string, error: string) => void) => {
      ipcRenderer.on('sip:registrationFailed', (_event, accountId, error) => callback(accountId, error))
    },
    onIncomingCall: (callback: (accountId: string, number: string, callId: string) => void) => {
      ipcRenderer.on('sip:incomingCall', (_event, accountId, number, callId) => callback(accountId, number, callId))
    },
    onCallState: (callback: (state: string) => void) => {
      ipcRenderer.on('sip:callState', (_event, state) => callback(state))
    },
    onAuthRequired: (callback: (accountId: string) => void) => {
      ipcRenderer.on('sip:authRequired', (_event, accountId) => callback(accountId))
    },
    onError: (callback: (accountId: string, error: string) => void) => {
      ipcRenderer.on('sip:error', (_event, accountId, error) => callback(accountId, error))
    },
  },

  // RTP media bridge — mic frames from renderer -> main, remote frames main -> renderer.
  rtp: {
    sendMic: (accountId: string, frame: Int16Array) => ipcRenderer.send('rtp:mic', accountId, frame),
    onRemote: (callback: (frame: Int16Array) => void) => {
      ipcRenderer.on('rtp:remote', (_event, frame: Int16Array) => callback(frame))
    },
    removeRemoteListener: () => {
      ipcRenderer.removeAllListeners('rtp:remote')
    },
  },
})

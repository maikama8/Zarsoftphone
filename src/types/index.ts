// SIP Account Types
// Browser-based SIP clients only support WebSocket transports (WS/WSS)
// UDP, TCP, TLS require native socket access - now available via NativeSipService in main process
export type TransportType = 'UDP' | 'TCP' | 'TLS' | 'WS' | 'WSS'
export type RegistrationState = 'disconnected' | 'registering' | 'registered' | 'failed'

export interface SipAccount {
  id: string
  displayName: string
  username: string
  password: string
  domain: string
  server: string
  transport: TransportType
  port: number
  registrationExpiry: number
  stunServer?: string
  turnServer?: string
  isEnabled: boolean
  isDefault: boolean
  registrationState?: RegistrationState
}

// Contact Types
export interface Contact {
  id: string
  name: string
  company?: string
  sipNumber: string
  notes?: string
  avatar?: string
  isFavorite: boolean
  createdAt: number
}

// Call History Types
export type CallDirection = 'incoming' | 'outgoing'
export type CallStatus = 'answered' | 'missed' | 'failed'

export interface CallHistory {
  id: string
  number: string
  name?: string
  direction: CallDirection
  status: CallStatus
  duration: number
  timestamp: number
  accountId: string
}

// Call State Types
export type CallState = 'idle' | 'connecting' | 'ringing' | 'active' | 'held' | 'ended'

export interface ActiveCall {
  id: string
  remoteNumber: string
  remoteName?: string
  direction: CallDirection
  state: CallState
  startTime?: number
  duration: number
  isMuted: boolean
  isHeld: boolean
  accountId: string
}

// Audio Device Types
export interface AudioDevice {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput'
}

// Settings Types
export interface AppSettings {
  general: {
    launchAtStartup: boolean
    minimizeToTray: boolean
    autoAnswer: boolean
    startHidden: boolean
  }
  audio: {
    inputDeviceId?: string
    outputDeviceId?: string
    ringtoneVolume: number
  }
  theme: 'dark' | 'light'
  notifications: {
    enabled: boolean
    showIncomingCalls: boolean
  }
}

// IPC Types for Electron
export interface ElectronAPI {
  // Database operations
  db: {
    getAccounts: () => Promise<SipAccount[]>
    addAccount: (account: Omit<SipAccount, 'id'>) => Promise<string>
    updateAccount: (id: string, account: Partial<SipAccount>) => Promise<void>
    deleteAccount: (id: string) => Promise<void>
    
    getContacts: () => Promise<Contact[]>
    addContact: (contact: Omit<Contact, 'id'>) => Promise<string>
    updateContact: (id: string, contact: Partial<Contact>) => Promise<void>
    deleteContact: (id: string) => Promise<void>
    
    getCallHistory: () => Promise<CallHistory[]>
    addCallHistory: (call: Omit<CallHistory, 'id'>) => Promise<string>
    
    getSettings: () => Promise<AppSettings>
    updateSettings: (settings: Partial<AppSettings>) => Promise<void>
  }
  
  // System operations
  notifications: {
    show: (title: string, body: string) => void
  }
  
  // Window operations
  window: {
    minimize: () => void
    close: () => void
  }
  
  // Native SIP operations
  sipNative: {
    register: (account: any) => Promise<boolean>
    unregister: (accountId: string) => Promise<void>
    reconnect: (accountId: string) => Promise<boolean>
    makeCall: (accountId: string, targetNumber: string) => Promise<string | null>
    hangup: (accountId: string) => Promise<void>
    answer: (accountId: string, callId: string) => Promise<void>
    reject: (accountId: string, callId: string) => Promise<void>
    sendDTMF: (accountId: string, digit: string) => Promise<void>
    mute: (accountId: string, muted: boolean) => Promise<void>
    hold: (accountId: string) => Promise<void>
    unhold: (accountId: string) => Promise<void>
    onRegistered: (callback: (accountId: string) => void) => void
    onRegistrationFailed: (callback: (accountId: string, error: string) => void) => void
    onIncomingCall: (callback: (accountId: string, number: string, callId: string) => void) => void
    onCallState: (callback: (state: string) => void) => void
    onAuthRequired: (callback: (accountId: string) => void) => void
    onError: (callback: (accountId: string, error: string) => void) => void
  }

  // RTP media bridge
  rtp: {
    sendMic: (accountId: string, frame: Int16Array) => void
    onRemote: (callback: (frame: Int16Array) => void) => void
    removeRemoteListener: () => void
  }

  log: (msg: string) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

// SIP Account Types
export type TransportType = 'UDP' | 'TCP' | 'TLS' | 'WSS'
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

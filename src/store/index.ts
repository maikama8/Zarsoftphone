import { create } from 'zustand'
import type { SipAccount, Contact, CallHistory, AppSettings, ActiveCall, AudioDevice } from '../types'
import { Invitation } from 'sip.js'

interface AppState {
  // Accounts
  accounts: SipAccount[]
  setAccounts: (accounts: SipAccount[]) => void
  addAccount: (account: SipAccount) => void
  updateAccount: (id: string, account: Partial<SipAccount>) => void
  removeAccount: (id: string) => void

  // Selected account for outgoing calls (UI-only, not persisted as isDefault)
  selectedAccountId: string | null
  setSelectedAccountId: (id: string | null) => void

  // Contacts
  contacts: Contact[]
  setContacts: (contacts: Contact[]) => void
  addContact: (contact: Contact) => void
  updateContact: (id: string, contact: Partial<Contact>) => void
  removeContact: (id: string) => void

  // Call History
  callHistory: CallHistory[]
  setCallHistory: (history: CallHistory[]) => void
  addCallHistory: (call: CallHistory) => void

  // Active Call
  activeCall: ActiveCall | null
  setActiveCall: (call: ActiveCall | null) => void
  updateCallState: (updates: Partial<ActiveCall>) => void

  // Incoming Call
  incomingCall: { accountId: string; remoteNumber: string; session: Invitation | null; isNative?: boolean; callId?: string } | null
  setIncomingCall: (call: { accountId: string; remoteNumber: string; session: Invitation | null; isNative?: boolean; callId?: string } | null) => void

  // Audio Devices
  audioDevices: AudioDevice[]
  setAudioDevices: (devices: AudioDevice[]) => void

  // Settings
  settings: AppSettings
  setSettings: (settings: AppSettings) => void
  updateSettings: (settings: Partial<AppSettings>) => void

  // UI State
  currentPage: string
  setCurrentPage: (page: string) => void
  searchQuery: string
  setSearchQuery: (query: string) => void

  // Compact UI modals
  showAddAccountModal: boolean
  setShowAddAccountModal: (show: boolean) => void
  editingAccountId: string | null
  setEditingAccountId: (id: string | null) => void
  showSettingsModal: boolean
  setShowSettingsModal: (show: boolean) => void

  // Dial number shared between dialer and contacts/history
  dialNumber: string
  setDialNumber: (number: string) => void
}

export const useStore = create<AppState>((set) => ({
  // Accounts
  accounts: [],
  setAccounts: (accounts) => set({ accounts }),
  addAccount: (account) => set((state) => ({ accounts: [...state.accounts, account] })),
  updateAccount: (id, updates) => set((state) => ({
    accounts: state.accounts.map((acc) => acc.id === id ? { ...acc, ...updates } : acc),
  })),
  removeAccount: (id) => set((state) => ({
    accounts: state.accounts.filter((acc) => acc.id !== id),
  })),

  selectedAccountId: null,
  setSelectedAccountId: (selectedAccountId) => set({ selectedAccountId }),

  // Contacts
  contacts: [],
  setContacts: (contacts) => set({ contacts }),
  addContact: (contact) => set((state) => ({ contacts: [...state.contacts, contact] })),
  updateContact: (id, updates) => set((state) => ({
    contacts: state.contacts.map((c) => c.id === id ? { ...c, ...updates } : c),
  })),
  removeContact: (id) => set((state) => ({
    contacts: state.contacts.filter((c) => c.id !== id),
  })),

  // Call History
  callHistory: [],
  setCallHistory: (callHistory) => set({ callHistory }),
  addCallHistory: (call) => set((state) => ({
    callHistory: [call, ...state.callHistory]
  })),

  // Active Call
  activeCall: null,
  setActiveCall: (activeCall) => set({ activeCall }),
  updateCallState: (updates) => set((state) => ({
    activeCall: state.activeCall ? { ...state.activeCall, ...updates } : null,
  })),

  // Incoming Call
  incomingCall: null,
  setIncomingCall: (incomingCall) => set({ incomingCall }),

  // Audio Devices
  audioDevices: [],
  setAudioDevices: (audioDevices) => set({ audioDevices }),

  // Settings
  settings: {
    general: {
      launchAtStartup: false,
      minimizeToTray: true,
      autoAnswer: false,
      startHidden: false,
    },
    audio: {
      ringtoneVolume: 80,
    },
    theme: 'dark',
    notifications: {
      enabled: true,
      showIncomingCalls: true,
    },
  },
  setSettings: (settings) => set({ settings }),
  updateSettings: (updates) => set((state) => ({
    settings: { ...state.settings, ...updates },
  })),

  // UI State
  currentPage: 'dialer',
  setCurrentPage: (currentPage) => set({ currentPage }),
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  // Compact UI modals
  showAddAccountModal: false,
  setShowAddAccountModal: (showAddAccountModal) => set({ showAddAccountModal }),
  editingAccountId: null,
  setEditingAccountId: (editingAccountId) => set({ editingAccountId }),
  showSettingsModal: false,
  setShowSettingsModal: (showSettingsModal) => set({ showSettingsModal }),

  // Shared dial number
  dialNumber: '',
  setDialNumber: (dialNumber) => set({ dialNumber }),
}))

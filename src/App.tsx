import { useEffect, useState } from 'react'
import { Users, History, MessageSquare, Phone } from 'lucide-react'
import { useStore } from './store'
import { sipService } from './services/sip/SipService'
import { ErrorBoundary } from './components/ErrorBoundary'
import TitleBar from './components/TitleBar'
import Dialer from './pages/Dialer'
import CompactContacts from './components/CompactContacts'
import CompactHistory from './components/CompactHistory'
import CompactMessages from './components/CompactMessages'
import IncomingCallModal from './components/IncomingCallModal'
import AddAccountModal from './components/AddAccountModal'
import CompactSettings from './components/CompactSettings'
import { initThemeListener } from './theme'
import { v4 as uuidv4 } from 'uuid'
import clsx from 'clsx'

type Panel = 'contacts' | 'history' | 'messages' | null

export default function App() {
  const setAccounts = useStore((s) => s.setAccounts)
  const setContacts = useStore((s) => s.setContacts)
  const setCallHistory = useStore((s) => s.setCallHistory)
  const setMessages = useStore((s) => s.setMessages)
  const unreadMessages = useStore((s) => s.messages.filter((m) => m.direction === 'incoming' && !m.read).length)
  const setSettings = useStore((s) => s.setSettings)
  const updateAccount = useStore((s) => s.updateAccount)
  const setIncomingCall = useStore((s) => s.setIncomingCall)
  const setActiveCall = useStore((s) => s.setActiveCall)
  const updateCallState = useStore((s) => s.updateCallState)
  const showAddAccountModal = useStore((s) => s.showAddAccountModal)
  const showSettingsModal = useStore((s) => s.showSettingsModal)

  // null = dialer fills the screen; set to panel name to open that panel
  const [activePanel, setActivePanel] = useState<Panel>(null)

  useEffect(() => {
    // Listen for navigation-to-dialer requests (e.g. from history click-to-call).
    const onNavigateDialer = () => setActivePanel(null)
    window.addEventListener('navigate-dialer', onNavigateDialer as EventListener)
    // Keep the theme in sync with the OS while in "system" mode.
    const cleanupTheme = initThemeListener()
    return () => {
      window.removeEventListener('navigate-dialer', onNavigateDialer as EventListener)
      cleanupTheme()
    }
  }, [])

  useEffect(() => {
    const loadData = async () => {
      const [accounts, contacts, history, messages, settings] = await Promise.all([
        window.electronAPI.db.getAccounts(),
        window.electronAPI.db.getContacts(),
        window.electronAPI.db.getCallHistory(),
        window.electronAPI.db.getMessages(),
        window.electronAPI.db.getSettings(),
      ])
      setAccounts(accounts)
      setContacts(contacts)
      setCallHistory(history)
      setMessages(messages)
      setSettings(settings)

      for (const account of accounts) {
        if (account.isEnabled) {
          try {
            await sipService.register(account)
          } catch (e) {
            console.error('Register failed for', account.id, e)
          }
        }
      }
    }

    loadData()

    // Set up WebSocket SIP callbacks
    sipService.setCallbacks({
      onRegistrationStateChange: (accountId, state) => {
        updateAccount(accountId, { registrationState: state as any })
      },
      onIncomingCall: (accountId, remoteNumber, session) => {
        setIncomingCall({ accountId, remoteNumber, session })
        window.electronAPI.notifications.show('Incoming Call', `Call from ${remoteNumber}`)
      },
      onCallStateChange: (state) => {
        if (state === 'ended') {
          const activeCall = useStore.getState().activeCall
          if (activeCall) {
            const duration = activeCall.startTime ? Math.floor((Date.now() - activeCall.startTime) / 1000) : 0
            window.electronAPI.db.addCallHistory({
              number: activeCall.remoteNumber,
              name: activeCall.remoteName,
              direction: activeCall.direction,
              status: duration > 0 ? 'answered' : 'failed',
              duration,
              timestamp: Date.now(),
              accountId: activeCall.accountId,
            }).then(async () => {
              const history = await window.electronAPI.db.getCallHistory()
              useStore.getState().setCallHistory(history)
            }).catch((e) => console.error('Failed to save call history:', e))
          }
          setActiveCall(null)
        } else {
          updateCallState({ state })
        }
      },
    })

    // Set up Native SIP callbacks
    window.electronAPI.sipNative.onRegistered((accountId) => {
      console.log(`Native SIP: Account ${accountId} registered`)
      updateAccount(accountId, { registrationState: 'registered' })
    })

    window.electronAPI.sipNative.onRegistrationFailed((accountId, error) => {
      console.error(`Native SIP: Registration failed for ${accountId}:`, error)
      updateAccount(accountId, { registrationState: 'failed' })
    })

    window.electronAPI.sipNative.onIncomingCall((accountId, remoteNumber, callId) => {
      console.log(`Native SIP: Incoming call from ${remoteNumber} (callId ${callId})`)
      setIncomingCall({ accountId, remoteNumber, session: null, isNative: true, callId })
      window.electronAPI.notifications.show('Incoming Call', `Call from ${remoteNumber}`)
    })

    window.electronAPI.sipNative.onIncomingMessage((accountId, from, body) => {
      const contact = useStore.getState().contacts.find((c) => c.sipNumber === from)
      const msg = {
        id: uuidv4(),
        peer: from,
        name: contact?.name,
        direction: 'incoming' as const,
        body,
        status: 'received' as const,
        timestamp: Date.now(),
        read: false,
        accountId,
      }
      useStore.getState().addMessage(msg)
      window.electronAPI.db.addMessage(msg).catch((e) => console.error('Failed to save message:', e))
      window.electronAPI.notifications.show(`Message from ${contact?.name || from}`, body)
    })

    window.electronAPI.sipNative.onCallState((state) => {
      console.log(`Native SIP: Call state ${state}`)
      if (state === 'active') {
        // Outbound call connected: ensure the renderer audio bridge is running
        // (makeCall pre-warms it — only start here if it failed earlier).
        updateCallState({ state: 'active', startTime: Date.now() })
        if (!sipService.isNativeAudioActive()) {
          sipService.setupNativeAudio(sipService.getActiveAccountId() || '').catch((e) => {
            console.error('Failed to start native audio bridge:', e)
          })
        }
      } else if (state === 'ended') {
        sipService.teardownNativeAudio().catch(() => {})
        // Save the call to history before clearing the active call.
        const activeCall = useStore.getState().activeCall
        if (activeCall) {
          const duration = activeCall.startTime ? Math.floor((Date.now() - activeCall.startTime) / 1000) : 0
          window.electronAPI.db.addCallHistory({
            number: activeCall.remoteNumber,
            name: activeCall.remoteName,
            direction: activeCall.direction,
            status: duration > 0 ? 'answered' : 'failed',
            duration,
            timestamp: Date.now(),
            accountId: activeCall.accountId,
          }).then(async () => {
            // Refresh history from DB so the list is always in sync.
            const history = await window.electronAPI.db.getCallHistory()
            useStore.getState().setCallHistory(history)
          }).catch((e) => console.error('Failed to save call history:', e))
        }
        setActiveCall(null)
      } else {
        updateCallState({ state: state as any })
      }
    })

    return () => { sipService.cleanup() }
  }, [])

  const togglePanel = (panel: Panel) => {
    setActivePanel((current) => (current === panel ? null : panel))
  }

  const navItems = [
    { id: 'contacts' as Panel, icon: Users,         label: 'Contacts' },
    { id: 'history'  as Panel, icon: History,       label: 'History'  },
    { id: 'messages' as Panel, icon: MessageSquare, label: 'Messages' },
  ]

  const goDialer = () => setActivePanel(null)

  return (
    <ErrorBoundary>
    <div className="flex flex-col h-screen bg-macos-bg-primary text-macos-text-primary overflow-hidden relative">
      {/* Compact header */}
      <TitleBar />

      {/* Main content — either dialer or a panel */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activePanel === null && <Dialer />}
        {activePanel === 'contacts' && <CompactContacts />}
        {activePanel === 'history'  && <CompactHistory />}
        {activePanel === 'messages' && <CompactMessages />}
      </div>

      {/* Bottom nav — always visible */}
      <div className="flex flex-shrink-0 items-center gap-1 px-1.5 py-1.5 border-t border-macos-separator surface-bar">
        {[{ id: null as Panel, icon: Phone, label: 'Dialer' }, ...navItems].map(({ id, icon: Icon, label }) => {
          const isActive = activePanel === id
          return (
            <button
              key={label}
              onClick={() => (id === null ? goDialer() : togglePanel(id))}
              className={clsx(
                'nav-item rounded-macos-lg',
                isActive
                  ? 'text-white brand-gradient shadow-brand-sm'
                  : 'text-macos-text-quaternary hover:text-macos-text-secondary hover:bg-macos-bg-tertiary/60'
              )}
            >
              <div className="relative">
                <Icon size={16} strokeWidth={isActive ? 2.4 : 2} />
                {id === 'messages' && unreadMessages > 0 && (
                  <span className={clsx(
                    'absolute -top-1.5 -right-2 min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center text-[8px] font-bold leading-none',
                    isActive ? 'bg-white text-macos-accent-blue' : 'bg-macos-accent-red text-white'
                  )}>
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </span>
                )}
              </div>
              <span className="text-[9px] font-medium leading-none">{label}</span>
            </button>
          )
        })}
      </div>

      {/* Incoming call banner */}
      <IncomingCallModal />

      {/* Modals */}
      {showAddAccountModal && <AddAccountModal />}
      {showSettingsModal    && <CompactSettings />}
    </div>
    </ErrorBoundary>
  )
}

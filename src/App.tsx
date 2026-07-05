import { useEffect, useState } from 'react'
import { Users, History, MessageSquare, Phone } from 'lucide-react'
import { useStore } from './store'
import { sipService } from './services/sip/SipService'
import TitleBar from './components/TitleBar'
import Dialer from './pages/Dialer'
import CompactContacts from './components/CompactContacts'
import CompactHistory from './components/CompactHistory'
import IncomingCallModal from './components/IncomingCallModal'
import AddAccountModal from './components/AddAccountModal'
import CompactSettings from './components/CompactSettings'
import clsx from 'clsx'

type Panel = 'contacts' | 'history' | 'messages' | null

export default function App() {
  const setAccounts = useStore((s) => s.setAccounts)
  const setContacts = useStore((s) => s.setContacts)
  const setCallHistory = useStore((s) => s.setCallHistory)
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
    const loadData = async () => {
      const [accounts, contacts, history, settings] = await Promise.all([
        window.electronAPI.db.getAccounts(),
        window.electronAPI.db.getContacts(),
        window.electronAPI.db.getCallHistory(),
        window.electronAPI.db.getSettings(),
      ])
      setAccounts(accounts)
      setContacts(contacts)
      setCallHistory(history)
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

    window.electronAPI.sipNative.onCallState((state) => {
      console.log(`Native SIP: Call state ${state}`)
      if (state === 'active') {
        // Outbound call connected: start the renderer audio bridge for mic/speaker.
        updateCallState({ state: 'active', startTime: Date.now() })
        sipService.setupNativeAudio(sipService.getActiveAccountId() || '').catch((e) => {
          console.error('Failed to start native audio bridge:', e)
        })
      } else if (state === 'ended') {
        sipService.teardownNativeAudio().catch(() => {})
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
    <div className="flex flex-col h-screen bg-macos-bg-primary text-macos-text-primary overflow-hidden relative">
      {/* Compact header */}
      <TitleBar />

      {/* Main content — either dialer or a panel */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activePanel === null && <Dialer />}
        {activePanel === 'contacts' && <CompactContacts />}
        {activePanel === 'history'  && <CompactHistory />}
        {activePanel === 'messages' && (
          <div className="flex-1 flex items-center justify-center text-xs text-macos-text-quaternary">
            Messages — coming soon
          </div>
        )}
      </div>

      {/* Bottom nav — always visible */}
      <div
        className="flex flex-shrink-0 border-t border-macos-separator"
        style={{ background: 'rgba(28,28,30,0.95)' }}
      >
        {/* Dialer tab — returns to the dialpad (no panel active) */}
        <button
          onClick={goDialer}
          className={clsx(
            'flex-1 flex flex-col items-center justify-center py-1.5 gap-0.5 transition-colors',
            activePanel === null
              ? 'text-macos-accent-blue'
              : 'text-macos-text-quaternary hover:text-macos-text-tertiary'
          )}
        >
          <Phone size={15} />
          <span className="text-[9px] leading-none">Dialer</span>
        </button>
        {navItems.map(({ id, icon: Icon, label }) => {
          const isActive = activePanel === id
          return (
            <button
              key={id}
              onClick={() => togglePanel(id)}
              className={clsx(
                'flex-1 flex flex-col items-center justify-center py-1.5 gap-0.5 transition-colors',
                isActive
                  ? 'text-macos-accent-blue'
                  : 'text-macos-text-quaternary hover:text-macos-text-tertiary'
              )}
            >
              <Icon size={15} />
              <span className="text-[9px] leading-none">{label}</span>
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
  )
}

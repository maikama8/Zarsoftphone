import { useEffect, useState } from 'react'
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

type Tab = 'contacts' | 'history' | 'messages'

function App() {
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

  const [tab, setTab] = useState<Tab>('contacts')

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
          await sipService.register(account)
        }
      }
    }

    loadData()

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

    return () => {
      sipService.cleanup()
    }
  }, [])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'contacts', label: 'Contacts' },
    { id: 'history', label: 'History' },
    { id: 'messages', label: 'Messages' },
  ]

  return (
    <div className="flex flex-col h-screen bg-macos-bg-primary text-macos-text-primary overflow-hidden relative">
      {/* Compact header: traffic lights + account switcher + actions */}
      <TitleBar />

      {/* Dialer: number input + controls + optional dialpad */}
      <Dialer />

      {/* Bottom section: tab bar + list */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* Tab bar */}
        <div className="flex border-b border-macos-separator flex-shrink-0"
          style={{ background: 'rgba(28,28,30,0.6)' }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'flex-1 py-1.5 text-[11px] font-medium transition-colors',
                tab === t.id
                  ? 'text-macos-accent-blue border-b border-macos-accent-blue'
                  : 'text-macos-text-quaternary hover:text-macos-text-tertiary'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0">
          {tab === 'contacts' && <CompactContacts />}
          {tab === 'history' && <CompactHistory />}
          {tab === 'messages' && (
            <div className="flex items-center justify-center h-full text-[11px] text-macos-text-quaternary">
              Messages — coming soon
            </div>
          )}
        </div>
      </div>

      {/* Incoming call compact banner */}
      <IncomingCallModal />

      {/* Modals */}
      {showAddAccountModal && <AddAccountModal />}
      {showSettingsModal && <CompactSettings />}
    </div>
  )
}

export default App

import { useState, useRef, useEffect } from 'react'
import { Settings, Plus, ChevronDown, X, Minus, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import clsx from 'clsx'
import Logo from './Logo'

function StatusDot({ state }: { state?: string }) {
  return (
    <span
      className={clsx('inline-block w-2 h-2 rounded-full flex-shrink-0', {
        'bg-macos-accent-green': state === 'registered',
        'bg-macos-accent-yellow animate-pulse': state === 'registering',
        'bg-macos-accent-red': state === 'failed',
        'bg-macos-text-quaternary': !state || state === 'disconnected',
      })}
    />
  )
}

export default function TitleBar() {
  const accounts = useStore((s) => s.accounts)
  const selectedAccountId = useStore((s) => s.selectedAccountId)
  const setSelectedAccountId = useStore((s) => s.setSelectedAccountId)
  const updateAccount = useStore((s) => s.updateAccount)
  const setShowAddAccountModal = useStore((s) => s.setShowAddAccountModal)
  const setShowSettingsModal = useStore((s) => s.setShowSettingsModal)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const enabledAccounts = accounts.filter((a) => a.isEnabled)
  const activeAccount =
    enabledAccounts.find((a) => a.id === selectedAccountId) ||
    enabledAccounts.find((a) => a.isDefault) ||
    enabledAccounts[0]

  // Sync selectedAccountId when accounts load
  useEffect(() => {
    if (!selectedAccountId && activeAccount) {
      setSelectedAccountId(activeAccount.id)
    }
  }, [activeAccount?.id])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelectAccount = (id: string) => {
    setSelectedAccountId(id)
    setDropdownOpen(false)
  }

  return (
    <div className="relative h-10 flex-shrink-0 app-drag select-none border-b border-macos-separator surface-bar">
      <div className="flex items-center h-full pl-3 pr-2 gap-2">
        {/* Traffic lights */}
        <div className="flex items-center gap-2 app-no-drag flex-shrink-0">
          <button
            onClick={() => window.electronAPI.window.close()}
            className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition-all flex items-center justify-center group"
            aria-label="Close"
          >
            <X size={6} className="opacity-0 group-hover:opacity-100 text-black" />
          </button>
          <button
            onClick={() => window.electronAPI.window.minimize()}
            className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-110 transition-all flex items-center justify-center group"
            aria-label="Minimize"
          >
            <Minus size={6} className="opacity-0 group-hover:opacity-100 text-black" />
          </button>
          <div className="w-3 h-3 rounded-full bg-[#28c840] opacity-40" />
        </div>

        {/* Brand mark */}
        <div className="flex-shrink-0 ml-1">
          <Logo size={18} />
        </div>

        {/* Account selector */}
        <div className="flex-1 min-w-0 app-no-drag relative ml-1" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="w-full flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-macos-bg-tertiary transition-colors"
          >
            <StatusDot state={activeAccount?.registrationState} />
            <span className="text-xs font-medium text-macos-text-primary truncate flex-1 text-left">
              {activeAccount
                ? (activeAccount.displayName?.trim() || `${activeAccount.username}@${activeAccount.domain}`)
                : 'No account'}
            </span>
            {enabledAccounts.length > 1 && (
              <ChevronDown
                size={10}
                className={clsx('text-macos-text-tertiary transition-transform flex-shrink-0', dropdownOpen && 'rotate-180')}
              />
            )}
          </button>

          {/* Account dropdown */}
          {dropdownOpen && enabledAccounts.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-macos-lg shadow-macos-lg border border-macos-separator overflow-hidden animate-slide-down surface-panel">
              {enabledAccounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => handleSelectAccount(acc.id)}
                  className={clsx(
                    'w-full flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors',
                    acc.id === activeAccount?.id
                      ? 'bg-macos-accent-blue bg-opacity-20'
                      : 'hover:bg-macos-bg-tertiary'
                  )}
                >
                  <StatusDot state={acc.registrationState} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-macos-text-primary truncate">
                      {acc.displayName}
                    </div>
                    <div className="text-[10px] text-macos-text-quaternary truncate">
                      {acc.username}@{acc.domain}
                    </div>
                  </div>
                  {acc.id === activeAccount?.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-macos-accent-blue flex-shrink-0" />
                  )}
                </button>
              ))}

              <div className="border-t border-macos-separator">
                {activeAccount && (
                  <button
                    onClick={async () => {
                      if (!activeAccount) return
                      setDropdownOpen(false)
                      updateAccount(activeAccount.id, { registrationState: 'registering' })
                      try {
                        await window.electronAPI.sipNative.reconnect(activeAccount.id)
                      } catch (e) {
                        console.error('Reconnect failed:', e)
                      }
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-macos-bg-tertiary transition-colors"
                  >
                    <RefreshCw size={10} className="text-macos-accent-blue flex-shrink-0" />
                    <span className="text-xs text-macos-text-primary">Reconnect</span>
                  </button>
                )}
                <button
                  onClick={() => { setShowAddAccountModal(true); setDropdownOpen(false) }}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-macos-bg-tertiary transition-colors"
                >
                  <Plus size={10} className="text-macos-accent-blue flex-shrink-0" />
                  <span className="text-xs text-macos-accent-blue">Add account</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 app-no-drag flex-shrink-0">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-1 rounded hover:bg-macos-bg-tertiary transition-colors text-macos-text-tertiary hover:text-macos-text-primary"
            title="Settings"
          >
            <Settings size={13} />
          </button>
          <button
            onClick={() => setShowAddAccountModal(true)}
            className="p-1 rounded hover:bg-macos-bg-tertiary transition-colors text-macos-text-tertiary hover:text-macos-accent-blue"
            title="Add account"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

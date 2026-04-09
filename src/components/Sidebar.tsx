import { Phone, Users, History, Settings, Grid3x3, ChevronDown, Circle } from 'lucide-react'
import { useStore } from '../store'
import clsx from 'clsx'
import { useState } from 'react'

const menuItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Grid3x3 },
  { id: 'dialer', label: 'Dialer', icon: Phone },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export default function Sidebar() {
  const currentPage = useStore((state) => state.currentPage)
  const setCurrentPage = useStore((state) => state.setCurrentPage)
  const accounts = useStore((state) => state.accounts)
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false)

  const enabledAccounts = accounts.filter(a => a.isEnabled)
  const defaultAccount = enabledAccounts.find(a => a.isDefault) || enabledAccounts[0]

  const getRegistrationStatus = (account: any) => {
    if (!account) return { color: 'bg-gray-500', label: 'No Account' }
    if (account.registrationState === 'registered') {
      return { color: 'bg-macos-accent-green', label: 'Online' }
    }
    return { color: 'bg-macos-accent-red', label: 'Offline' }
  }

  const status = getRegistrationStatus(defaultAccount)

  return (
    <div className="w-64 sidebar-glass border-r border-macos-separator flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-macos-separator">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-macos-lg bg-gradient-to-br from-macos-accent-blue to-blue-600 flex items-center justify-center">
            <Phone size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-macos-text-primary">Zar</h1>
            <p className="text-xs text-macos-text-tertiary">Softphone</p>
          </div>
        </div>
      </div>

      {/* Account Switcher */}
      {defaultAccount && (
        <div className="p-4 border-b border-macos-separator">
          <button
            onClick={() => setShowAccountSwitcher(!showAccountSwitcher)}
            className="w-full app-no-drag"
          >
            <div className="glass-effect-light rounded-macos-lg p-3 hover:bg-opacity-70 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-macos-bg-tertiary flex items-center justify-center">
                      <span className="text-sm font-semibold">
                        {defaultAccount.displayName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className={clsx(
                      'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-macos-bg-secondary',
                      status.color
                    )} />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-macos-text-primary truncate">
                      {defaultAccount.displayName}
                    </p>
                    <p className="text-xs text-macos-text-tertiary truncate">
                      {defaultAccount.username}@{defaultAccount.domain}
                    </p>
                  </div>
                </div>
                <ChevronDown 
                  size={16} 
                  className={clsx(
                    'text-macos-text-tertiary transition-transform',
                    showAccountSwitcher && 'rotate-180'
                  )} 
                />
              </div>
            </div>
          </button>

          {/* Account Switcher Dropdown */}
          {showAccountSwitcher && enabledAccounts.length > 1 && (
            <div className="mt-2 space-y-1 animate-slide-down">
              {enabledAccounts.filter(a => a.id !== defaultAccount.id).map(account => {
                const accStatus = getRegistrationStatus(account)
                return (
                  <button
                    key={account.id}
                    onClick={() => {
                      // Switch account logic here
                      setShowAccountSwitcher(false)
                    }}
                    className="w-full glass-effect-light rounded-macos p-2.5 hover:bg-opacity-70 transition-all app-no-drag"
                  >
                    <div className="flex items-center space-x-2">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-macos-bg-tertiary flex items-center justify-center">
                          <span className="text-xs font-semibold">
                            {account.displayName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className={clsx(
                          'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-macos-bg-secondary',
                          accStatus.color
                        )} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-medium text-macos-text-primary truncate">
                          {account.displayName}
                        </p>
                        <p className="text-xs text-macos-text-quaternary truncate">
                          {account.username}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto custom-scrollbar">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.id
          return (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={clsx(
                'w-full flex items-center space-x-3 px-4 py-2.5 rounded-macos transition-all app-no-drag',
                isActive
                  ? 'bg-macos-accent-blue text-white shadow-lg'
                  : 'text-macos-text-secondary hover:bg-macos-bg-tertiary hover:text-macos-text-primary'
              )}
            >
              <Icon size={18} />
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Account Status Footer */}
      {defaultAccount && (
        <div className="p-4 border-t border-macos-separator">
          <div className="flex items-center space-x-2 text-xs">
            <Circle 
              size={8} 
              className={clsx(
                'fill-current',
                status.color.replace('bg-', 'text-')
              )} 
            />
            <span className="text-macos-text-tertiary">{status.label}</span>
          </div>
        </div>
      )}
    </div>
  )
}


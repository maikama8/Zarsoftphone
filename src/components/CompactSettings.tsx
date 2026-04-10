import { useState } from 'react'
import { X, Power, Trash2, Edit } from 'lucide-react'
import { useStore } from '../store'
import { sipService } from '../services/sip/SipService'
import clsx from 'clsx'

export default function CompactSettings() {
  const setShowSettingsModal = useStore((s) => s.setShowSettingsModal)
  const accounts = useStore((s) => s.accounts)
  const updateAccount = useStore((s) => s.updateAccount)
  const removeAccount = useStore((s) => s.removeAccount)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const setShowAddAccountModal = useStore((s) => s.setShowAddAccountModal)
  const setEditingAccountId = useStore((s) => s.setEditingAccountId)

  const [tab, setTab] = useState<'accounts' | 'audio' | 'general'>('accounts')

  const handleToggleAccount = async (acc: typeof accounts[0]) => {
    const newEnabled = !acc.isEnabled
    await window.electronAPI.db.updateAccount(acc.id, { isEnabled: newEnabled })
    updateAccount(acc.id, { isEnabled: newEnabled })
    if (newEnabled) {
      await sipService.register(acc)
    } else {
      await sipService.unregister(acc.id)
    }
  }

  const handleEditAccount = (acc: typeof accounts[0]) => {
    setEditingAccountId(acc.id)
    setShowSettingsModal(false)
    setShowAddAccountModal(true)
  }

  const handleDeleteAccount = async (acc: typeof accounts[0]) => {
    if (!confirm(`Delete "${acc.displayName}"?`)) return
    await sipService.unregister(acc.id)
    await window.electronAPI.db.deleteAccount(acc.id)
    removeAccount(acc.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setShowSettingsModal(false)} />

      <div className="relative w-80 max-h-[500px] flex flex-col rounded-macos-lg border border-macos-separator shadow-macos-xl animate-scale-in"
        style={{ background: 'rgba(36,36,38,0.98)', backdropFilter: 'blur(30px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-macos-separator flex-shrink-0">
          <span className="text-sm font-semibold text-macos-text-primary">Settings</span>
          <button onClick={() => setShowSettingsModal(false)} className="text-macos-text-tertiary hover:text-macos-text-primary">
            <X size={14} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-macos-separator flex-shrink-0">
          {(['accounts', 'audio', 'general'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'flex-1 py-1.5 text-[11px] capitalize transition-colors',
                tab === t
                  ? 'text-macos-accent-blue border-b-2 border-macos-accent-blue'
                  : 'text-macos-text-tertiary hover:text-macos-text-secondary'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
          {tab === 'accounts' && (
            <div className="p-2 space-y-1">
              {accounts.length === 0 ? (
                <div className="text-center py-6 text-[11px] text-macos-text-quaternary">No accounts yet</div>
              ) : (
                accounts.map((acc) => (
                  <div key={acc.id}
                    className="flex items-center gap-2 p-2 rounded bg-macos-bg-secondary border border-macos-separator"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', {
                          'bg-macos-accent-green': acc.registrationState === 'registered',
                          'bg-macos-accent-yellow': acc.registrationState === 'registering',
                          'bg-macos-accent-red': acc.registrationState === 'failed',
                          'bg-macos-text-quaternary': !acc.registrationState || acc.registrationState === 'disconnected',
                        })} />
                        <span className="text-[12px] font-medium text-macos-text-primary truncate">
                          {acc.displayName}
                        </span>
                        {acc.isDefault && (
                          <span className="text-[9px] text-macos-accent-blue bg-macos-accent-blue bg-opacity-15 px-1 rounded">default</span>
                        )}
                      </div>
                      <div className="text-[10px] text-macos-text-quaternary truncate ml-3">
                        {acc.username}@{acc.domain}
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleAccount(acc)}
                      className={clsx(
                        'p-1 rounded transition-colors flex-shrink-0',
                        acc.isEnabled
                          ? 'text-macos-accent-green hover:bg-macos-bg-tertiary'
                          : 'text-macos-text-quaternary hover:bg-macos-bg-tertiary'
                      )}
                      title={acc.isEnabled ? 'Disable' : 'Enable'}
                    >
                      <Power size={12} />
                    </button>
                    <button
                      onClick={() => handleEditAccount(acc)}
                      className="p-1 rounded text-macos-text-quaternary hover:text-macos-accent-blue hover:bg-macos-bg-tertiary transition-colors flex-shrink-0"
                      title="Edit"
                    >
                      <Edit size={12} />
                    </button>
                    <button
                      onClick={() => handleDeleteAccount(acc)}
                      className="p-1 rounded text-macos-text-quaternary hover:text-macos-accent-red hover:bg-macos-bg-tertiary transition-colors flex-shrink-0"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
              <button
                onClick={() => { setShowSettingsModal(false); setShowAddAccountModal(true) }}
                className="w-full py-1.5 text-[11px] text-macos-accent-blue border border-dashed border-macos-accent-blue border-opacity-40 rounded hover:bg-macos-accent-blue hover:bg-opacity-10 transition-colors"
              >
                + Add account
              </button>
            </div>
          )}

          {tab === 'audio' && (
            <div className="p-3 space-y-3">
              <SettingRow label="Ringtone volume">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.audio.ringtoneVolume}
                    onChange={(e) => updateSettings({ audio: { ...settings.audio, ringtoneVolume: Number(e.target.value) } })}
                    className="flex-1 accent-macos-accent-blue"
                  />
                  <span className="text-[11px] text-macos-text-tertiary w-6 text-right">{settings.audio.ringtoneVolume}</span>
                </div>
              </SettingRow>
            </div>
          )}

          {tab === 'general' && (
            <div className="p-3 space-y-2">
              {([
                { key: 'minimizeToTray', label: 'Minimize to tray' },
                { key: 'autoAnswer', label: 'Auto-answer calls' },
                { key: 'launchAtStartup', label: 'Launch at startup' },
              ] as const).map(({ key, label }) => (
                <SettingRow key={key} label={label}>
                  <Toggle
                    on={settings.general[key]}
                    onChange={(v) => updateSettings({ general: { ...settings.general, [key]: v } })}
                  />
                </SettingRow>
              ))}
              <SettingRow label="Notifications">
                <Toggle
                  on={settings.notifications.enabled}
                  onChange={(v) => updateSettings({ notifications: { ...settings.notifications, enabled: v } })}
                />
              </SettingRow>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-macos-text-secondary">{label}</span>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={clsx(
        'relative w-8 h-4 rounded-full transition-colors',
        on ? 'bg-macos-accent-blue' : 'bg-macos-bg-tertiary'
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

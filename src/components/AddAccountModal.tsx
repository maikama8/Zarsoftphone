import { useState } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { useStore } from '../store'
import { sipService } from '../services/sip/SipService'
import type { SipAccount, TransportType } from '../types'
import { v4 as uuidv4 } from 'uuid'
import clsx from 'clsx'

const defaultForm = {
  displayName: '',
  username: '',
  password: '',
  domain: '',
  server: '',
  transport: 'WSS' as TransportType,
  port: 443,
  registrationExpiry: 600,
  stunServer: '',
  turnServer: '',
}

export default function AddAccountModal() {
  const setShowAddAccountModal = useStore((s) => s.setShowAddAccountModal)
  const accounts = useStore((s) => s.accounts)
  const addAccount = useStore((s) => s.addAccount)
  const setSelectedAccountId = useStore((s) => s.setSelectedAccountId)

  const [form, setForm] = useState(defaultForm)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.displayName || !form.username || !form.password || !form.domain) return
    setSaving(true)
    try {
      const newAccount: SipAccount = {
        id: uuidv4(),
        displayName: form.displayName,
        username: form.username,
        password: form.password,
        domain: form.domain,
        server: form.server || form.domain,
        transport: form.transport,
        port: form.port,
        registrationExpiry: form.registrationExpiry,
        stunServer: form.stunServer || undefined,
        turnServer: form.turnServer || undefined,
        isEnabled: true,
        isDefault: accounts.length === 0,
        registrationState: 'disconnected',
      }

      await window.electronAPI.db.addAccount(newAccount)
      addAccount(newAccount)
      setSelectedAccountId(newAccount.id)
      await sipService.register(newAccount)
      setShowAddAccountModal(false)
    } finally {
      setSaving(false)
    }
  }

  const canSave = form.displayName && form.username && form.password && form.domain

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={() => setShowAddAccountModal(false)}
      />

      <div className="relative w-72 rounded-macos-lg border border-macos-separator shadow-macos-xl animate-scale-in"
        style={{ background: 'rgba(36,36,38,0.98)', backdropFilter: 'blur(30px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-macos-separator">
          <span className="text-sm font-semibold text-macos-text-primary">Add SIP Account</span>
          <button
            onClick={() => setShowAddAccountModal(false)}
            className="p-0.5 rounded hover:bg-macos-bg-tertiary transition-colors text-macos-text-tertiary"
          >
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <div className="px-3 py-2 space-y-2">
          <Field label="Display name *">
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              className="compact-input w-full"
              placeholder="My SIP Account"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Username *">
              <input
                type="text"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                className="compact-input w-full"
                placeholder="1001"
                autoComplete="off"
              />
            </Field>
            <Field label="Password *">
              <input
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                className="compact-input w-full"
                placeholder="••••••"
                autoComplete="new-password"
              />
            </Field>
          </div>

          <Field label="SIP domain *">
            <input
              type="text"
              value={form.domain}
              onChange={(e) => set('domain', e.target.value)}
              className="compact-input w-full"
              placeholder="sip.example.com"
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Field label="SIP server">
                <input
                  type="text"
                  value={form.server}
                  onChange={(e) => set('server', e.target.value)}
                  className="compact-input w-full"
                  placeholder="sip.example.com"
                />
              </Field>
            </div>
            <Field label="Transport">
              <select
                value={form.transport}
                onChange={(e) => set('transport', e.target.value as TransportType)}
                className="compact-input w-full"
              >
                <option value="WSS">WSS</option>
                <option value="WS">WS</option>
                <option value="UDP">UDP</option>
                <option value="TCP">TCP</option>
                <option value="TLS">TLS</option>
              </select>
            </Field>
          </div>

          {/* Advanced section */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-macos-text-tertiary hover:text-macos-text-secondary transition-colors"
          >
            <ChevronDown
              size={10}
              className={clsx('transition-transform', showAdvanced && 'rotate-180')}
            />
            Advanced
          </button>

          {showAdvanced && (
            <div className="space-y-2 animate-slide-down">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Port">
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => set('port', parseInt(e.target.value) || 443)}
                    className="compact-input w-full"
                  />
                </Field>
                <Field label="Reg. expiry (s)">
                  <input
                    type="number"
                    value={form.registrationExpiry}
                    onChange={(e) => set('registrationExpiry', parseInt(e.target.value) || 600)}
                    className="compact-input w-full"
                  />
                </Field>
              </div>
              <Field label="STUN server">
                <input
                  type="text"
                  value={form.stunServer}
                  onChange={(e) => set('stunServer', e.target.value)}
                  className="compact-input w-full"
                  placeholder="stun:stun.l.google.com:19302"
                />
              </Field>
              <Field label="TURN server">
                <input
                  type="text"
                  value={form.turnServer}
                  onChange={(e) => set('turnServer', e.target.value)}
                  className="compact-input w-full"
                  placeholder="turn:turn.example.com:3478"
                />
              </Field>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-3 py-2 border-t border-macos-separator">
          <button
            onClick={() => setShowAddAccountModal(false)}
            className="flex-1 py-1.5 text-xs rounded bg-macos-bg-tertiary hover:bg-opacity-80 text-macos-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className={clsx(
              'flex-1 py-1.5 text-xs rounded font-medium transition-colors',
              canSave && !saving
                ? 'bg-macos-accent-blue hover:bg-opacity-90 text-white'
                : 'bg-macos-bg-tertiary text-macos-text-quaternary cursor-not-allowed'
            )}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-macos-text-tertiary mb-0.5 uppercase tracking-wide">{label}</div>
      {children}
    </div>
  )
}

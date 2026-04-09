import { useState } from 'react'
import { Plus, Trash2, Edit, Power, Check } from 'lucide-react'
import { useStore } from '../store'
import { sipService } from '../services/sip/SipService'
import type { SipAccount, TransportType } from '../types'
import { v4 as uuidv4 } from 'uuid'
import clsx from 'clsx'

export default function Accounts() {
  const accounts = useStore((state) => state.accounts)
  const addAccount = useStore((state) => state.addAccount)
  const updateAccount = useStore((state) => state.updateAccount)
  const removeAccount = useStore((state) => state.removeAccount)

  const [showModal, setShowModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState<SipAccount | null>(null)
  const [formData, setFormData] = useState({
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
  })

  const handleOpenModal = (account?: SipAccount) => {
    if (account) {
      setEditingAccount(account)
      setFormData({
        displayName: account.displayName,
        username: account.username,
        password: account.password,
        domain: account.domain,
        server: account.server,
        transport: account.transport,
        port: account.port,
        registrationExpiry: account.registrationExpiry,
        stunServer: account.stunServer || '',
        turnServer: account.turnServer || '',
      })
    } else {
      setEditingAccount(null)
      setFormData({
        displayName: '',
        username: '',
        password: '',
        domain: '',
        server: '',
        transport: 'WSS',
        port: 443,
        registrationExpiry: 600,
        stunServer: '',
        turnServer: '',
      })
    }
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formData.displayName || !formData.username || !formData.password || !formData.domain || !formData.server) {
      alert('Please fill in all required fields')
      return
    }

    if (editingAccount) {
      await window.electronAPI.db.updateAccount(editingAccount.id, formData)
      updateAccount(editingAccount.id, formData)
      
      // Re-register if enabled
      if (editingAccount.isEnabled) {
        await sipService.unregister(editingAccount.id)
        await sipService.register({ ...editingAccount, ...formData })
      }
    } else {
      const newAccount: SipAccount = {
        id: uuidv4(),
        ...formData,
        isEnabled: true,
        isDefault: accounts.length === 0,
        registrationState: 'disconnected',
      }
      
      await window.electronAPI.db.addAccount(newAccount)
      addAccount(newAccount)
      
      // Auto-register new account
      await sipService.register(newAccount)
    }

    setShowModal(false)
  }

  const handleDelete = async (account: SipAccount) => {
    if (confirm(`Delete account ${account.displayName}?`)) {
      await sipService.unregister(account.id)
      await window.electronAPI.db.deleteAccount(account.id)
      removeAccount(account.id)
    }
  }

  const handleToggleEnabled = async (account: SipAccount) => {
    const newEnabled = !account.isEnabled
    
    await window.electronAPI.db.updateAccount(account.id, { isEnabled: newEnabled })
    updateAccount(account.id, { isEnabled: newEnabled })

    if (newEnabled) {
      await sipService.register(account)
    } else {
      await sipService.unregister(account.id)
    }
  }

  const handleSetDefault = async (account: SipAccount) => {
    // Unset all defaults
    for (const acc of accounts) {
      if (acc.isDefault) {
        await window.electronAPI.db.updateAccount(acc.id, { isDefault: false })
        updateAccount(acc.id, { isDefault: false })
      }
    }
    
    // Set new default
    await window.electronAPI.db.updateAccount(account.id, { isDefault: true })
    updateAccount(account.id, { isDefault: true })
  }

  const getStateColor = (state?: string) => {
    switch (state) {
      case 'registered':
        return 'bg-green-500'
      case 'registering':
        return 'bg-yellow-500'
      case 'failed':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">SIP Accounts</h1>
          <button
            onClick={() => handleOpenModal()}
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors"
          >
            <Plus size={20} />
            <span>Add Account</span>
          </button>
        </div>
      </div>

      {/* Accounts List */}
      <div className="flex-1 overflow-auto p-6">
        {accounts.length === 0 ? (
          <div className="text-center text-gray-400 mt-8">
            No accounts configured. Add your first SIP account to get started.
          </div>
        ) : (
          <div className="space-y-4">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="bg-gray-800 p-4 rounded-lg"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold">{account.displayName}</h3>
                      {account.isDefault && (
                        <span className="bg-primary-600 text-xs px-2 py-1 rounded">Default</span>
                      )}
                      <span className={clsx('w-3 h-3 rounded-full', getStateColor(account.registrationState))} />
                    </div>
                    
                    <div className="text-sm text-gray-400 space-y-1">
                      <div>{account.username}@{account.domain}</div>
                      <div>{account.server}:{account.port} ({account.transport})</div>
                      <div className="capitalize">Status: {account.registrationState || 'disconnected'}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleToggleEnabled(account)}
                      className={clsx(
                        'p-2 rounded transition-colors',
                        account.isEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-600'
                      )}
                      title={account.isEnabled ? 'Disable' : 'Enable'}
                    >
                      <Power size={20} />
                    </button>
                    
                    {!account.isDefault && account.isEnabled && (
                      <button
                        onClick={() => handleSetDefault(account)}
                        className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                        title="Set as default"
                      >
                        <Check size={20} />
                      </button>
                    )}
                    
                    <button
                      onClick={() => handleOpenModal(account)}
                      className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                    >
                      <Edit size={20} />
                    </button>
                    
                    <button
                      onClick={() => handleDelete(account)}
                      className="p-2 bg-gray-700 hover:bg-red-600 rounded transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 overflow-auto">
          <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 my-8">
            <h2 className="text-xl font-bold mb-4">
              {editingAccount ? 'Edit Account' : 'Add Account'}
            </h2>

            <div className="grid grid-cols-2 gap-4 max-h-96 overflow-auto">
              <div>
                <label className="block text-sm font-medium mb-1">Display Name *</label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Username *</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Password *</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Domain *</label>
                <input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  placeholder="example.com"
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Server *</label>
                <input
                  type="text"
                  value={formData.server}
                  onChange={(e) => setFormData({ ...formData, server: e.target.value })}
                  placeholder="sip.example.com"
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Transport</label>
                <select
                  value={formData.transport}
                  onChange={(e) => setFormData({ ...formData, transport: e.target.value as TransportType })}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                >
                  <option value="WSS">WSS</option>
                  <option value="WS">WS</option>
                  <option value="UDP">UDP</option>
                  <option value="TCP">TCP</option>
                  <option value="TLS">TLS</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Port</label>
                <input
                  type="number"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Registration Expiry (seconds)</label>
                <input
                  type="number"
                  value={formData.registrationExpiry}
                  onChange={(e) => setFormData({ ...formData, registrationExpiry: parseInt(e.target.value) })}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">STUN Server</label>
                <input
                  type="text"
                  value={formData.stunServer}
                  onChange={(e) => setFormData({ ...formData, stunServer: e.target.value })}
                  placeholder="stun:stun.l.google.com:19302"
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">TURN Server</label>
                <input
                  type="text"
                  value={formData.turnServer}
                  onChange={(e) => setFormData({ ...formData, turnServer: e.target.value })}
                  placeholder="turn:turn.example.com:3478"
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-primary-600"
                />
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 rounded transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

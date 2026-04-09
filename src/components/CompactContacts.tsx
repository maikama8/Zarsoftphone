import { useState } from 'react'
import { Phone, Star, Search, Plus, X, Edit, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { sipService } from '../services/sip/SipService'
import type { Contact } from '../types'
import { v4 as uuidv4 } from 'uuid'
import clsx from 'clsx'

export default function CompactContacts() {
  const contacts = useStore((s) => s.contacts)
  const addContact = useStore((s) => s.addContact)
  const updateContact = useStore((s) => s.updateContact)
  const removeContact = useStore((s) => s.removeContact)
  const accounts = useStore((s) => s.accounts)
  const selectedAccountId = useStore((s) => s.selectedAccountId)
  const setActiveCall = useStore((s) => s.setActiveCall)

  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [form, setForm] = useState({ name: '', sipNumber: '', company: '', notes: '' })

  const activeAccount =
    accounts.find((a) => a.id === selectedAccountId && a.isEnabled) ||
    accounts.find((a) => a.isDefault && a.isEnabled) ||
    accounts.find((a) => a.isEnabled)

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.sipNumber.includes(search)
  )

  const openModal = (c?: Contact) => {
    if (c) {
      setEditing(c)
      setForm({ name: c.name, sipNumber: c.sipNumber, company: c.company || '', notes: c.notes || '' })
    } else {
      setEditing(null)
      setForm({ name: '', sipNumber: '', company: '', notes: '' })
    }
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.sipNumber) return
    if (editing) {
      await window.electronAPI.db.updateContact(editing.id, form)
      updateContact(editing.id, form)
    } else {
      const c: Contact = { id: uuidv4(), ...form, isFavorite: false, createdAt: Date.now() }
      await window.electronAPI.db.addContact(c)
      addContact(c)
    }
    setShowModal(false)
  }

  const handleDelete = async (c: Contact) => {
    await window.electronAPI.db.deleteContact(c.id)
    removeContact(c.id)
  }

  const handleFavorite = async (c: Contact) => {
    const upd = { isFavorite: !c.isFavorite }
    await window.electronAPI.db.updateContact(c.id, upd)
    updateContact(c.id, upd)
  }

  const handleCall = async (number: string) => {
    if (!activeAccount) return
    try {
      await sipService.makeCall(activeAccount.id, number)
      setActiveCall({
        id: Date.now().toString(),
        remoteNumber: number,
        direction: 'outgoing',
        state: 'connecting',
        duration: 0,
        isMuted: false,
        isHeld: false,
        accountId: activeAccount.id,
      })
    } catch (err) {
      console.error('Call failed:', err)
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1
    if (!a.isFavorite && b.isFavorite) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search + add */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-macos-separator flex-shrink-0">
        <div className="relative flex-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-macos-text-quaternary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full bg-macos-bg-tertiary text-[11px] text-macos-text-primary rounded pl-6 pr-2 py-1 focus:outline-none focus:ring-1 focus:ring-macos-accent-blue border border-transparent"
          />
        </div>
        <button
          onClick={() => openModal()}
          className="p-1 rounded bg-macos-bg-tertiary hover:bg-macos-accent-blue hover:text-white text-macos-text-tertiary transition-colors"
          title="Add contact"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {sorted.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-macos-text-quaternary">
            {search ? 'No matches' : 'No contacts yet'}
          </div>
        ) : (
          sorted.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              onCall={() => handleCall(c.sipNumber)}
              onEdit={() => openModal(c)}
              onDelete={() => handleDelete(c)}
              onFavorite={() => handleFavorite(c)}
            />
          ))
        )}
      </div>

      {/* Edit / Add modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setShowModal(false)} />
          <div className="relative w-64 rounded-macos-lg border border-macos-separator shadow-macos-xl animate-scale-in"
            style={{ background: 'rgba(36,36,38,0.98)', backdropFilter: 'blur(30px)' }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-macos-separator">
              <span className="text-xs font-semibold text-macos-text-primary">
                {editing ? 'Edit Contact' : 'Add Contact'}
              </span>
              <button onClick={() => setShowModal(false)} className="text-macos-text-tertiary hover:text-macos-text-primary">
                <X size={13} />
              </button>
            </div>
            <div className="px-3 py-2 space-y-2">
              {[
                { key: 'name', label: 'Name *', placeholder: 'John Doe' },
                { key: 'sipNumber', label: 'SIP number *', placeholder: '1001' },
                { key: 'company', label: 'Company', placeholder: 'Acme Inc.' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <div className="text-[10px] text-macos-text-tertiary mb-0.5 uppercase tracking-wide">{label}</div>
                  <input
                    type="text"
                    value={(form as any)[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    placeholder={placeholder}
                    className="compact-input w-full"
                    autoFocus={key === 'name'}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 px-3 py-2 border-t border-macos-separator">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-1.5 text-xs rounded bg-macos-bg-tertiary hover:bg-opacity-80 text-macos-text-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name || !form.sipNumber}
                className={clsx(
                  'flex-1 py-1.5 text-xs rounded font-medium transition-colors',
                  form.name && form.sipNumber
                    ? 'bg-macos-accent-blue hover:bg-opacity-90 text-white'
                    : 'bg-macos-bg-tertiary text-macos-text-quaternary cursor-not-allowed'
                )}
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

function ContactRow({
  contact, onCall, onEdit, onDelete, onFavorite,
}: {
  contact: Contact
  onCall: () => void
  onEdit: () => void
  onDelete: () => void
  onFavorite: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 border-b border-macos-separator hover:bg-macos-bg-secondary transition-colors group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-macos-bg-tertiary flex items-center justify-center flex-shrink-0 text-xs font-semibold text-macos-text-secondary">
        {contact.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[12px] font-medium text-macos-text-primary truncate leading-tight">
            {contact.name}
          </span>
          {contact.isFavorite && <Star size={9} className="text-macos-accent-yellow fill-current flex-shrink-0" />}
        </div>
        <div className="text-[10px] text-macos-text-quaternary truncate leading-tight">{contact.sipNumber}</div>
      </div>

      {/* Actions */}
      <div className={clsx('flex items-center gap-0.5 transition-opacity', hovered ? 'opacity-100' : 'opacity-0')}>
        <IconBtn onClick={onFavorite} title="Favorite">
          <Star size={11} className={contact.isFavorite ? 'text-macos-accent-yellow fill-current' : 'text-macos-text-quaternary'} />
        </IconBtn>
        <IconBtn onClick={onEdit} title="Edit">
          <Edit size={11} className="text-macos-text-quaternary" />
        </IconBtn>
        <IconBtn onClick={onDelete} title="Delete">
          <Trash2 size={11} className="text-macos-accent-red" />
        </IconBtn>
      </div>

      {/* Call button */}
      <button
        onClick={onCall}
        className="p-1 rounded bg-macos-accent-green bg-opacity-0 hover:bg-opacity-20 text-macos-accent-green transition-colors flex-shrink-0"
        title="Call"
      >
        <Phone size={13} />
      </button>
    </div>
  )
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 rounded hover:bg-macos-bg-tertiary transition-colors"
    >
      {children}
    </button>
  )
}

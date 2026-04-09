import { useState } from 'react'
import { Plus, Search, Phone, Star, Trash2, Edit, X } from 'lucide-react'
import { useStore } from '../store'
import type { Contact } from '../types'
import { v4 as uuidv4 } from 'uuid'
import clsx from 'clsx'

export default function Contacts() {
  const contacts = useStore((state) => state.contacts)
  const addContact = useStore((state) => state.addContact)
  const updateContact = useStore((state) => state.updateContact)
  const removeContact = useStore((state) => state.removeContact)
  const searchQuery = useStore((state) => state.searchQuery)
  const setSearchQuery = useStore((state) => state.setSearchQuery)
  const setCurrentPage = useStore((state) => state.setCurrentPage)
  
  const [showModal, setShowModal] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    company: '',
    sipNumber: '',
    notes: '',
  })

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.sipNumber.includes(searchQuery)
  )

  const favoriteContacts = filteredContacts.filter(c => c.isFavorite)
  const regularContacts = filteredContacts.filter(c => !c.isFavorite)

  const handleOpenModal = (contact?: Contact) => {
    if (contact) {
      setEditingContact(contact)
      setFormData({
        name: contact.name,
        company: contact.company || '',
        sipNumber: contact.sipNumber,
        notes: contact.notes || '',
      })
    } else {
      setEditingContact(null)
      setFormData({ name: '', company: '', sipNumber: '', notes: '' })
    }
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formData.name || !formData.sipNumber) return

    if (editingContact) {
      await window.electronAPI.db.updateContact(editingContact.id, formData)
      updateContact(editingContact.id, formData)
    } else {
      const newContact: Contact = {
        id: uuidv4(),
        ...formData,
        isFavorite: false,
        createdAt: Date.now(),
      }
      await window.electronAPI.db.addContact(newContact)
      addContact(newContact)
    }

    setShowModal(false)
  }

  const handleDelete = async (id: string) => {
    if (confirm('Delete this contact?')) {
      await window.electronAPI.db.deleteContact(id)
      removeContact(id)
    }
  }

  const handleToggleFavorite = async (contact: Contact) => {
    const updated = { isFavorite: !contact.isFavorite }
    await window.electronAPI.db.updateContact(contact.id, updated)
    updateContact(contact.id, updated)
  }

  const handleCall = (number: string) => {
    setCurrentPage('dialer')
    // TODO: Set the number in dialer
  }

  const ContactCard = ({ contact }: { contact: Contact }) => (
    <div className="card-macos group hover:bg-macos-bg-tertiary transition-all">
      <div className="flex items-center space-x-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-macos-accent-blue to-blue-600 flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-semibold text-white">
            {contact.name.charAt(0).toUpperCase()}
          </span>
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <h3 className="font-medium text-macos-text-primary truncate">{contact.name}</h3>
            {contact.isFavorite && (
              <Star size={14} className="text-macos-accent-yellow fill-current flex-shrink-0" />
            )}
          </div>
          {contact.company && (
            <p className="text-sm text-macos-text-tertiary truncate">{contact.company}</p>
          )}
          <p className="text-sm text-macos-text-secondary">{contact.sipNumber}</p>
        </div>

        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => handleToggleFavorite(contact)}
            className="p-2 hover:bg-macos-bg-tertiary rounded-macos transition-colors"
            title="Toggle favorite"
          >
            <Star 
              size={18} 
              className={contact.isFavorite ? 'text-macos-accent-yellow fill-current' : 'text-macos-text-tertiary'} 
            />
          </button>
          <button
            onClick={() => handleCall(contact.sipNumber)}
            className="p-2 hover:bg-macos-accent-green hover:bg-opacity-20 rounded-macos transition-colors text-macos-accent-green"
            title="Call"
          >
            <Phone size={18} />
          </button>
          <button
            onClick={() => handleOpenModal(contact)}
            className="p-2 hover:bg-macos-bg-tertiary rounded-macos transition-colors text-macos-text-tertiary"
            title="Edit"
          >
            <Edit size={18} />
          </button>
          <button
            onClick={() => handleDelete(contact.id)}
            className="p-2 hover:bg-macos-accent-red hover:bg-opacity-20 rounded-macos transition-colors text-macos-accent-red"
            title="Delete"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-macos-bg-primary">
      {/* Header */}
      <div className="p-6 border-b border-macos-separator glass-effect">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-macos-text-primary">Contacts</h1>
          <button
            onClick={() => handleOpenModal()}
            className="btn-primary flex items-center space-x-2"
          >
            <Plus size={18} />
            <span>Add Contact</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-macos-text-quaternary" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className="w-full input-macos pl-11"
          />
        </div>
      </div>

      {/* Contacts List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {filteredContacts.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-macos-bg-tertiary flex items-center justify-center mx-auto mb-4">
              <Phone size={32} className="text-macos-text-quaternary" />
            </div>
            <p className="text-macos-text-tertiary mb-2">No contacts found</p>
            <button
              onClick={() => handleOpenModal()}
              className="text-sm text-macos-accent-blue hover:text-opacity-80 transition-colors"
            >
              Add your first contact
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Favorites */}
            {favoriteContacts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-macos-text-tertiary uppercase tracking-wider mb-3">
                  Favorites
                </h2>
                <div className="space-y-2">
                  {favoriteContacts.map((contact) => (
                    <ContactCard key={contact.id} contact={contact} />
                  ))}
                </div>
              </div>
            )}

            {/* All Contacts */}
            {regularContacts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-macos-text-tertiary uppercase tracking-wider mb-3">
                  {favoriteContacts.length > 0 ? 'All Contacts' : 'Contacts'}
                </h2>
                <div className="space-y-2">
                  {regularContacts.map((contact) => (
                    <ContactCard key={contact.id} contact={contact} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black bg-opacity-60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          
          <div className="relative glass-effect rounded-macos-xl p-6 max-w-md w-full mx-4 shadow-macos-xl border border-macos-separator animate-scale-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-macos-text-primary">
                {editingContact ? 'Edit Contact' : 'Add Contact'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 hover:bg-macos-bg-tertiary rounded-macos transition-colors text-macos-text-tertiary"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-macos-text-secondary mb-2">
                  Name <span className="text-macos-accent-red">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-macos w-full"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-macos-text-secondary mb-2">Company</label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  className="input-macos w-full"
                  placeholder="Acme Inc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-macos-text-secondary mb-2">
                  SIP Number <span className="text-macos-accent-red">*</span>
                </label>
                <input
                  type="text"
                  value={formData.sipNumber}
                  onChange={(e) => setFormData({ ...formData, sipNumber: e.target.value })}
                  className="input-macos w-full"
                  placeholder="1001"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-macos-text-secondary mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="input-macos w-full resize-none"
                  placeholder="Additional notes..."
                />
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name || !formData.sipNumber}
                className={clsx(
                  'btn-primary flex-1',
                  (!formData.name || !formData.sipNumber) && 'opacity-50 cursor-not-allowed'
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


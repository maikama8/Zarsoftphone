import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Send, Search, Plus, ArrowLeft, Trash2, Check, CheckCheck, Clock,
  AlertCircle, MessageSquare,
} from 'lucide-react'
import { useStore } from '../store'
import type { ChatMessage } from '../types'
import { v4 as uuidv4 } from 'uuid'
import clsx from 'clsx'

type Conversation = {
  peer: string
  name?: string
  last: ChatMessage
  unread: number
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  const diff = Date.now() - ts
  if (diff < 6 * 24 * 60 * 60 * 1000) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CompactMessages() {
  const messages = useStore((s) => s.messages)
  const contacts = useStore((s) => s.contacts)
  const accounts = useStore((s) => s.accounts)
  const selectedAccountId = useStore((s) => s.selectedAccountId)
  const addMessage = useStore((s) => s.addMessage)
  const updateMessage = useStore((s) => s.updateMessage)
  const markConversationRead = useStore((s) => s.markConversationRead)
  const removeConversation = useStore((s) => s.removeConversation)

  const [openPeer, setOpenPeer] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [composingNew, setComposingNew] = useState(false)
  const [newPeer, setNewPeer] = useState('')

  const activeAccount =
    accounts.find((a) => a.id === selectedAccountId && a.isEnabled) ||
    accounts.find((a) => a.isDefault && a.isEnabled) ||
    accounts.find((a) => a.isEnabled)

  const nameFor = (peer: string) => contacts.find((c) => c.sipNumber === peer)?.name

  // Build conversation summaries (newest activity first).
  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, Conversation>()
    for (const m of messages) {
      const existing = map.get(m.peer)
      if (!existing) {
        map.set(m.peer, { peer: m.peer, name: m.name || nameFor(m.peer), last: m, unread: 0 })
      } else if (m.timestamp >= existing.last.timestamp) {
        existing.last = m
      }
    }
    for (const m of messages) {
      if (m.direction === 'incoming' && !m.read) {
        const c = map.get(m.peer)
        if (c) c.unread += 1
      }
    }
    return [...map.values()].sort((a, b) => b.last.timestamp - a.last.timestamp)
  }, [messages, contacts])

  const filteredConvos = conversations.filter((c) => {
    const q = search.toLowerCase()
    return c.peer.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q)
  })

  const openThread = (peer: string) => {
    setOpenPeer(peer)
    setComposingNew(false)
    if (messages.some((m) => m.peer === peer && m.direction === 'incoming' && !m.read)) {
      markConversationRead(peer)
      window.electronAPI.db.markConversationRead(peer).catch(() => {})
    }
  }

  const handleDelete = async (peer: string) => {
    removeConversation(peer)
    try { await window.electronAPI.db.deleteConversation(peer) } catch (e) { console.error(e) }
    if (openPeer === peer) setOpenPeer(null)
  }

  const handleSend = async (peer: string, body: string) => {
    if (!body.trim() || !activeAccount) return
    const msg: ChatMessage = {
      id: uuidv4(),
      peer,
      name: nameFor(peer),
      direction: 'outgoing',
      body: body.trim(),
      status: 'sending',
      timestamp: Date.now(),
      read: true,
      accountId: activeAccount.id,
    }
    addMessage(msg)
    window.electronAPI.db.addMessage(msg).catch((e) => console.error('Failed to save message:', e))

    try {
      const res = await window.electronAPI.sipNative.sendMessage(activeAccount.id, peer, msg.body)
      const status = res.ok ? 'delivered' : 'failed'
      updateMessage(msg.id, { status })
      window.electronAPI.db.updateMessage(msg.id, { status }).catch(() => {})
      if (!res.ok) console.warn('Message send failed:', res.error || res.code)
    } catch (e) {
      updateMessage(msg.id, { status: 'failed' })
      window.electronAPI.db.updateMessage(msg.id, { status: 'failed' }).catch(() => {})
      console.error('Message send error:', e)
    }
  }

  // ── Thread view ────────────────────────────────────────────────────────────
  if (openPeer !== null) {
    const thread = messages
      .filter((m) => m.peer === openPeer)
      .sort((a, b) => a.timestamp - b.timestamp)
    return (
      <MessageThread
        peer={openPeer}
        name={nameFor(openPeer)}
        messages={thread}
        canSend={!!activeAccount}
        onBack={() => setOpenPeer(null)}
        onSend={(body) => handleSend(openPeer, body)}
        onDelete={() => handleDelete(openPeer)}
      />
    )
  }

  // ── New conversation ─────────────────────────────────────────────────────────
  if (composingNew) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-macos-separator flex-shrink-0">
          <button onClick={() => setComposingNew(false)} className="p-1 rounded hover:bg-macos-bg-tertiary text-macos-text-tertiary">
            <ArrowLeft size={15} />
          </button>
          <span className="text-xs font-semibold text-macos-text-primary">New message</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="text-[10px] text-macos-text-tertiary uppercase tracking-wide">To</div>
          <input
            autoFocus
            value={newPeer}
            onChange={(e) => setNewPeer(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newPeer.trim()) openThread(newPeer.trim()) }}
            placeholder="Number or SIP address"
            className="compact-input w-full"
          />
          <button
            onClick={() => newPeer.trim() && openThread(newPeer.trim())}
            disabled={!newPeer.trim()}
            className={clsx(
              'w-full py-1.5 rounded-macos text-xs font-medium transition-all',
              newPeer.trim() ? 'brand-gradient text-white shadow-brand-sm' : 'bg-macos-bg-tertiary text-macos-text-quaternary cursor-not-allowed'
            )}
          >
            Start conversation
          </button>
        </div>
      </div>
    )
  }

  // ── Conversation list ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-macos-separator flex-shrink-0">
        <div className="relative flex-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-macos-text-quaternary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages…"
            className="w-full bg-macos-bg-tertiary text-[11px] text-macos-text-primary rounded pl-6 pr-2 py-1 focus:outline-none focus:ring-1 focus:ring-macos-accent-blue border border-transparent"
          />
        </div>
        <button
          onClick={() => { setComposingNew(true); setNewPeer('') }}
          className="p-1 rounded bg-macos-bg-tertiary hover:bg-macos-accent-blue hover:text-white text-macos-text-tertiary transition-colors"
          title="New message"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {filteredConvos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-macos-text-quaternary">
            <MessageSquare size={28} strokeWidth={1.5} className="opacity-40" />
            <div className="text-[11px]">{search ? 'No matches' : 'No messages yet'}</div>
            {!search && (
              <button onClick={() => setComposingNew(true)} className="text-[11px] text-macos-accent-blue hover:underline">
                Start a conversation
              </button>
            )}
          </div>
        ) : (
          filteredConvos.map((c) => (
            <ConversationRow key={c.peer} convo={c} onOpen={() => openThread(c.peer)} onDelete={() => handleDelete(c.peer)} />
          ))
        )}
      </div>
    </div>
  )
}

function ConversationRow({ convo, onOpen, onDelete }: { convo: Conversation; onOpen: () => void; onDelete: () => void }) {
  const title = convo.name || convo.peer
  const initial = (convo.name?.trim()?.[0] || convo.peer.replace(/\D/g, '')[0] || '#').toUpperCase()
  const preview = (convo.last.direction === 'outgoing' ? 'You: ' : '') + convo.last.body

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-2 px-2 py-1.5 border-b border-macos-separator hover:bg-macos-bg-secondary transition-colors cursor-pointer group"
    >
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-macos-bg-tertiary flex items-center justify-center text-xs font-semibold text-macos-text-secondary">
          {initial}
        </div>
        {convo.unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-macos-accent-red text-white text-[8px] font-bold flex items-center justify-center ring-2 ring-macos-bg-primary">
            {convo.unread > 9 ? '9+' : convo.unread}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className={clsx('text-[12px] truncate flex-1', convo.unread > 0 ? 'font-semibold text-macos-text-primary' : 'font-medium text-macos-text-primary')}>
            {title}
          </span>
          <span className="text-[9px] text-macos-text-quaternary flex-shrink-0">{formatTime(convo.last.timestamp)}</span>
        </div>
        <div className={clsx('text-[10px] truncate leading-tight', convo.unread > 0 ? 'text-macos-text-secondary' : 'text-macos-text-quaternary')}>
          {preview}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="p-1 rounded text-macos-text-quaternary hover:text-macos-accent-red hover:bg-macos-bg-tertiary transition-all flex-shrink-0 opacity-0 group-hover:opacity-100"
        title="Delete conversation"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function StatusIcon({ status }: { status: ChatMessage['status'] }) {
  if (status === 'sending') return <Clock size={10} className="text-white/60" />
  if (status === 'failed') return <AlertCircle size={10} className="text-macos-accent-red" />
  if (status === 'delivered') return <CheckCheck size={10} className="text-white/80" />
  if (status === 'sent') return <Check size={10} className="text-white/70" />
  return null
}

function MessageThread({
  peer, name, messages, canSend, onBack, onSend, onDelete,
}: {
  peer: string
  name?: string
  messages: ChatMessage[]
  canSend: boolean
  onBack: () => void
  onSend: (body: string) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const title = name || peer

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, peer])

  const submit = () => {
    if (!draft.trim()) return
    onSend(draft)
    setDraft('')
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-macos-separator flex-shrink-0 surface-bar">
        <button onClick={onBack} className="p-1 rounded hover:bg-macos-bg-tertiary text-macos-text-tertiary">
          <ArrowLeft size={15} />
        </button>
        <div className="w-7 h-7 rounded-full bg-macos-bg-tertiary flex items-center justify-center text-[11px] font-semibold text-macos-text-secondary flex-shrink-0">
          {(name?.trim()?.[0] || peer.replace(/\D/g, '')[0] || '#').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-macos-text-primary truncate leading-tight">{title}</div>
          {name && <div className="text-[9px] text-macos-text-quaternary truncate leading-tight">{peer}</div>}
        </div>
        <button onClick={onDelete} className="p-1 rounded text-macos-text-quaternary hover:text-macos-accent-red hover:bg-macos-bg-tertiary transition-colors" title="Delete conversation">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-2.5 py-2 space-y-1.5">
        {messages.length === 0 && (
          <div className="text-center text-[10px] text-macos-text-quaternary py-6">
            No messages yet — say hello 👋
          </div>
        )}
        {messages.map((m) => {
          const out = m.direction === 'outgoing'
          return (
            <div key={m.id} className={clsx('flex', out ? 'justify-end' : 'justify-start')}>
              <div
                className={clsx(
                  'max-w-[78%] rounded-macos-lg px-2.5 py-1.5 text-[12px] leading-snug break-words',
                  out
                    ? 'brand-gradient text-white rounded-br-sm'
                    : 'bg-macos-bg-tertiary text-macos-text-primary rounded-bl-sm'
                )}
              >
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className={clsx('flex items-center gap-1 mt-0.5 justify-end', out ? 'text-white/70' : 'text-macos-text-quaternary')}>
                  <span className="text-[8px]">{new Date(m.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                  {out && <StatusIcon status={m.status} />}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="flex items-end gap-1.5 px-2 py-2 border-t border-macos-separator flex-shrink-0">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder={canSend ? 'Message…' : 'No account available'}
          disabled={!canSend}
          rows={1}
          className="flex-1 resize-none max-h-20 bg-macos-bg-tertiary text-[12px] text-macos-text-primary rounded-macos px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-macos-accent-blue border border-transparent disabled:opacity-50 custom-scrollbar"
        />
        <button
          onClick={submit}
          disabled={!draft.trim() || !canSend}
          className={clsx(
            'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all',
            draft.trim() && canSend
              ? 'brand-gradient text-white shadow-brand-sm hover:brightness-110 active:scale-95'
              : 'bg-macos-bg-tertiary text-macos-text-quaternary cursor-not-allowed'
          )}
          title="Send"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  )
}

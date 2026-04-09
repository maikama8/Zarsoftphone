import { useState } from 'react'
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search } from 'lucide-react'
import { useStore } from '../store'
import { sipService } from '../services/sip/SipService'
import type { CallHistory } from '../types'
import clsx from 'clsx'

type Filter = 'all' | 'incoming' | 'outgoing' | 'missed'

function formatDate(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(s: number) {
  if (!s) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function CompactHistory() {
  const callHistory = useStore((s) => s.callHistory)
  const accounts = useStore((s) => s.accounts)
  const selectedAccountId = useStore((s) => s.selectedAccountId)
  const setActiveCall = useStore((s) => s.setActiveCall)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const activeAccount =
    accounts.find((a) => a.id === selectedAccountId && a.isEnabled) ||
    accounts.find((a) => a.isDefault && a.isEnabled) ||
    accounts.find((a) => a.isEnabled)

  const filtered = callHistory.filter((c) => {
    const matchFilter =
      filter === 'all' ||
      (filter === 'missed' && c.status === 'missed') ||
      (filter === 'incoming' && c.direction === 'incoming' && c.status !== 'missed') ||
      (filter === 'outgoing' && c.direction === 'outgoing')
    const matchSearch =
      c.number.includes(search) ||
      c.name?.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

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

  const filterLabels: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'incoming', label: 'In' },
    { key: 'outgoing', label: 'Out' },
    { key: 'missed', label: 'Missed' },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filters + search */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-macos-separator flex-shrink-0">
        <div className="flex gap-0.5">
          {filterLabels.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={clsx(
                'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                filter === key
                  ? 'bg-macos-accent-blue text-white'
                  : 'text-macos-text-tertiary hover:text-macos-text-secondary hover:bg-macos-bg-tertiary'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-macos-text-quaternary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-macos-bg-tertiary text-[11px] text-macos-text-primary rounded pl-5 pr-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-macos-accent-blue border border-transparent"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-macos-text-quaternary">No history</div>
        ) : (
          filtered.map((call) => (
            <HistoryRow key={call.id} call={call} onCall={() => handleCall(call.number)} />
          ))
        )}
      </div>
    </div>
  )
}

function HistoryRow({ call, onCall }: { call: CallHistory; onCall: () => void }) {
  const missed = call.status === 'missed'
  const incoming = call.direction === 'incoming'

  const Icon = missed ? PhoneMissed : incoming ? PhoneIncoming : PhoneOutgoing
  const iconColor = missed
    ? 'text-macos-accent-red'
    : incoming
    ? 'text-macos-accent-green'
    : 'text-macos-accent-blue'

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-macos-separator hover:bg-macos-bg-secondary transition-colors group">
      {/* Direction icon */}
      <div className={clsx('flex-shrink-0', iconColor)}>
        <Icon size={13} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className={clsx('text-[12px] font-medium truncate leading-tight', missed && 'text-macos-accent-red')}>
          {call.name || call.number}
        </div>
        <div className="text-[10px] text-macos-text-quaternary truncate leading-tight">
          {call.name ? call.number : ''}
        </div>
      </div>

      {/* Time + duration */}
      <div className="text-right flex-shrink-0">
        <div className="text-[10px] text-macos-text-tertiary leading-tight">{formatDate(call.timestamp)}</div>
        {call.duration > 0 && (
          <div className="text-[10px] text-macos-text-quaternary leading-tight">{formatDuration(call.duration)}</div>
        )}
      </div>

      {/* Call back */}
      <button
        onClick={onCall}
        className="p-1 rounded text-macos-accent-green opacity-0 group-hover:opacity-100 hover:bg-macos-accent-green hover:bg-opacity-10 transition-all flex-shrink-0"
        title="Call back"
      >
        <Phone size={13} />
      </button>
    </div>
  )
}

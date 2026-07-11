import { useState } from 'react'
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Trash2, Clock } from 'lucide-react'
import { useStore } from '../store'
import { sipService } from '../services/sip/SipService'
import type { CallHistory } from '../types'
import clsx from 'clsx'

type Filter = 'all' | 'incoming' | 'outgoing' | 'missed'

/** Consecutive calls with the same number (same day) collapse into one group. */
type CallGroup = { key: string; calls: CallHistory[] }
type Section = { label: string; groups: CallGroup[] }

const DAY = 24 * 60 * 60 * 1000

function startOfDay(ts: number) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function sectionLabel(ts: number) {
  const today = startOfDay(Date.now())
  const day = startOfDay(ts)
  if (day === today) return 'Today'
  if (day === today - DAY) return 'Yesterday'
  if (today - day < 7 * DAY) return new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: startOfDay(Date.now()) - day > 330 * DAY ? 'numeric' : undefined })
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(s: number) {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m ? `${m}m ${sec}s` : `${sec}s`
}

export default function CompactHistory() {
  const callHistory = useStore((s) => s.callHistory)
  const accounts = useStore((s) => s.accounts)
  const selectedAccountId = useStore((s) => s.selectedAccountId)
  const setActiveCall = useStore((s) => s.setActiveCall)
  const setDialNumber = useStore((s) => s.setDialNumber)
  const removeCallHistory = useStore((s) => s.removeCallHistory)
  const clearAll = useStore((s) => s.clearCallHistory)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [confirmClear, setConfirmClear] = useState(false)

  const activeAccount =
    accounts.find((a) => a.id === selectedAccountId && a.isEnabled) ||
    accounts.find((a) => a.isDefault && a.isEnabled) ||
    accounts.find((a) => a.isEnabled)

  const missedCount = callHistory.filter((c) => c.status === 'missed').length

  const filtered = callHistory.filter((c) => {
    const matchFilter =
      filter === 'all' ||
      (filter === 'missed' && c.status === 'missed') ||
      (filter === 'incoming' && c.direction === 'incoming' && c.status !== 'missed') ||
      (filter === 'outgoing' && c.direction === 'outgoing')
    const q = search.toLowerCase()
    const matchSearch = c.number.includes(search) || c.name?.toLowerCase().includes(q)
    return matchFilter && matchSearch
  })

  // Newest first, merge consecutive same-number calls (within a day), then bucket by day.
  const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp)
  const sections: Section[] = []
  for (const c of sorted) {
    const lastSection = sections[sections.length - 1]
    const label = sectionLabel(c.timestamp)
    const section =
      lastSection && lastSection.label === label
        ? lastSection
        : (sections.push({ label, groups: [] }), sections[sections.length - 1])
    const lastGroup = section.groups[section.groups.length - 1]
    if (lastGroup && lastGroup.calls[0].number === c.number) {
      lastGroup.calls.push(c)
    } else {
      section.groups.push({ key: c.id, calls: [c] })
    }
  }

  const handleCall = async (number: string) => {
    if (!activeAccount) return
    setDialNumber(number)
    window.dispatchEvent(new CustomEvent('navigate-dialer'))
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

  const handleDeleteGroup = async (group: CallGroup) => {
    for (const c of group.calls) {
      try { await window.electronAPI.db.deleteCallHistory(c.id) } catch (e) { console.error(e) }
      removeCallHistory(c.id)
    }
  }

  const handleClearAll = async () => {
    try { await window.electronAPI.db.clearCallHistory() } catch (e) { console.error(e) }
    clearAll()
    setConfirmClear(false)
  }

  const filterLabels: { key: Filter; label: string; badge?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'incoming', label: 'In' },
    { key: 'outgoing', label: 'Out' },
    { key: 'missed', label: 'Missed', badge: missedCount },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filters + search + clear */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-macos-separator flex-shrink-0">
        <div className="flex gap-0.5">
          {filterLabels.map(({ key, label, badge }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={clsx(
                'relative px-1.5 py-0.5 text-[10px] rounded transition-colors',
                filter === key
                  ? 'bg-macos-accent-blue text-white'
                  : 'text-macos-text-tertiary hover:text-macos-text-secondary hover:bg-macos-bg-tertiary'
              )}
            >
              {label}
              {badge ? (
                <span
                  className={clsx(
                    'ml-1 inline-flex items-center justify-center min-w-[13px] h-[13px] px-1 rounded-full text-[8px] font-semibold leading-none',
                    filter === key ? 'bg-white/25 text-white' : 'bg-macos-accent-red text-white'
                  )}
                >
                  {badge}
                </span>
              ) : null}
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
        {callHistory.length > 0 && (
          <button
            onClick={() => (confirmClear ? handleClearAll() : setConfirmClear(true))}
            onBlur={() => setConfirmClear(false)}
            className={clsx(
              'flex-shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
              confirmClear
                ? 'bg-macos-accent-red text-white'
                : 'text-macos-text-quaternary hover:text-macos-accent-red hover:bg-macos-bg-tertiary'
            )}
            title="Clear all history"
          >
            <Trash2 size={11} />
            {confirmClear && <span>Clear all?</span>}
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-macos-text-quaternary">
            <Clock size={28} strokeWidth={1.5} className="opacity-40" />
            <div className="text-[11px]">
              {search || filter !== 'all' ? 'No matching calls' : 'No call history yet'}
            </div>
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.label}>
              <div className="sticky top-0 z-10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-macos-text-quaternary bg-macos-bg-primary/95 backdrop-blur-sm border-b border-macos-separator">
                {section.label}
              </div>
              {section.groups.map((group) => (
                <HistoryRow
                  key={group.key}
                  group={group}
                  onCall={() => handleCall(group.calls[0].number)}
                  onDelete={() => handleDeleteGroup(group)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function HistoryRow({ group, onCall, onDelete }: { group: CallGroup; onCall: () => void; onDelete: () => void }) {
  const call = group.calls[0]
  const count = group.calls.length
  const missed = call.status === 'missed'
  const incoming = call.direction === 'incoming'

  const Icon = missed ? PhoneMissed : incoming ? PhoneIncoming : PhoneOutgoing
  const accent = missed
    ? { text: 'text-macos-accent-red', bg: 'bg-macos-accent-red' }
    : incoming
    ? { text: 'text-macos-accent-green', bg: 'bg-macos-accent-green' }
    : { text: 'text-macos-accent-blue', bg: 'bg-macos-accent-blue' }

  const title = call.name || call.number
  const initial = (call.name?.trim()?.[0] || call.number.replace(/\D/g, '')[0] || '#').toUpperCase()
  const subtitle = call.name ? call.number : missed ? 'Missed call' : formatDuration(call.duration) || (incoming ? 'Incoming' : 'Outgoing')

  return (
    <div
      onClick={onCall}
      className="flex items-center gap-2 px-2 py-1.5 border-b border-macos-separator hover:bg-macos-bg-secondary active:bg-macos-bg-tertiary transition-colors cursor-pointer group"
    >
      {/* Avatar with direction badge */}
      <div className="relative flex-shrink-0">
        <div className="w-7 h-7 rounded-full bg-macos-bg-tertiary flex items-center justify-center text-xs font-semibold text-macos-text-secondary">
          {initial}
        </div>
        <div className={clsx('absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center ring-2 ring-macos-bg-primary', accent.bg)}>
          <Icon size={7} className="text-white" strokeWidth={2.5} />
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 leading-tight">
          <span className={clsx('text-[12px] font-medium truncate', missed ? 'text-macos-accent-red' : 'text-macos-text-primary')}>
            {title}
          </span>
          {count > 1 && <span className={clsx('text-[10px] font-medium flex-shrink-0', accent.text)}>({count})</span>}
        </div>
        <div className="text-[10px] text-macos-text-quaternary truncate leading-tight">{subtitle}</div>
      </div>

      {/* Time */}
      <div className="text-[10px] text-macos-text-tertiary flex-shrink-0 tabular-nums">{formatTime(call.timestamp)}</div>

      {/* Delete — reveals on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="p-1 rounded text-macos-text-quaternary hover:text-macos-accent-red hover:bg-macos-bg-tertiary transition-all flex-shrink-0 opacity-0 group-hover:opacity-100"
        title="Delete"
      >
        <Trash2 size={12} />
      </button>

      {/* Call back */}
      <button
        onClick={(e) => { e.stopPropagation(); onCall() }}
        className="p-1 rounded text-macos-accent-green hover:bg-macos-accent-green hover:bg-opacity-10 transition-all flex-shrink-0"
        title="Call back"
      >
        <Phone size={13} />
      </button>
    </div>
  )
}

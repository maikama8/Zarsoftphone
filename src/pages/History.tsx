import { useState } from 'react'
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search } from 'lucide-react'
import { useStore } from '../store'
import type { CallHistory } from '../types'
import clsx from 'clsx'

export default function History() {
  const callHistory = useStore((state) => state.callHistory)
  const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing' | 'missed'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredHistory = callHistory.filter((call) => {
    const matchesFilter = filter === 'all' || 
      (filter === 'missed' && call.status === 'missed') ||
      (filter === 'incoming' && call.direction === 'incoming' && call.status !== 'missed') ||
      (filter === 'outgoing' && call.direction === 'outgoing')

    const matchesSearch = call.number.includes(searchQuery) ||
      call.name?.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesFilter && matchesSearch
  })

  const formatDuration = (seconds: number) => {
    if (seconds === 0) return '-'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    
    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getCallIcon = (call: CallHistory) => {
    if (call.status === 'missed') {
      return { Icon: PhoneMissed, color: 'text-macos-accent-red' }
    }
    if (call.direction === 'incoming') {
      return { Icon: PhoneIncoming, color: 'text-macos-accent-green' }
    }
    return { Icon: PhoneOutgoing, color: 'text-macos-accent-blue' }
  }

  return (
    <div className="h-full flex flex-col bg-macos-bg-primary">
      {/* Header */}
      <div className="p-6 border-b border-macos-separator glass-effect">
        <h1 className="text-2xl font-semibold text-macos-text-primary mb-4">Call History</h1>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-macos-text-quaternary" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search history..."
            className="w-full input-macos pl-11"
          />
        </div>

        {/* Filters */}
        <div className="flex space-x-2">
          {(['all', 'incoming', 'outgoing', 'missed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                'px-4 py-2 rounded-macos capitalize transition-all text-sm font-medium',
                filter === f
                  ? 'bg-macos-accent-blue text-white'
                  : 'glass-effect-light text-macos-text-secondary hover:text-macos-text-primary'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {filteredHistory.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-macos-bg-tertiary flex items-center justify-center mx-auto mb-4">
              <Phone size={32} className="text-macos-text-quaternary" />
            </div>
            <p className="text-macos-text-tertiary">No call history found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredHistory.map((call) => {
              const { Icon, color } = getCallIcon(call)
              return (
                <div
                  key={call.id}
                  className="card-macos hover:bg-macos-bg-tertiary transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4 flex-1 min-w-0">
                      <div className={clsx('w-10 h-10 rounded-full bg-macos-bg-tertiary flex items-center justify-center', color)}>
                        <Icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-macos-text-primary truncate">
                          {call.name || call.number}
                        </div>
                        {call.name && (
                          <div className="text-sm text-macos-text-tertiary truncate">{call.number}</div>
                        )}
                      </div>
                    </div>

                    <div className="text-right ml-4">
                      <div className="text-sm text-macos-text-secondary">
                        {formatDate(call.timestamp)}
                      </div>
                      <div className="text-sm text-macos-text-tertiary">
                        {formatDuration(call.duration)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}


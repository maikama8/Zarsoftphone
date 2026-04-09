import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Users, Clock } from 'lucide-react'
import { useStore } from '../store'
import clsx from 'clsx'

export default function Dashboard() {
  const accounts = useStore((state) => state.accounts)
  const callHistory = useStore((state) => state.callHistory)
  const contacts = useStore((state) => state.contacts)
  const setCurrentPage = useStore((state) => state.setCurrentPage)

  const defaultAccount = accounts.find(a => a.isDefault && a.isEnabled) || accounts.find(a => a.isEnabled)
  
  const recentCalls = callHistory.slice(0, 5)
  const todayCalls = callHistory.filter(call => {
    const today = new Date().setHours(0, 0, 0, 0)
    return call.timestamp >= today
  })

  const stats = [
    {
      label: 'Total Calls Today',
      value: todayCalls.length,
      icon: Phone,
      color: 'from-blue-500 to-blue-600',
    },
    {
      label: 'Contacts',
      value: contacts.length,
      icon: Users,
      color: 'from-green-500 to-green-600',
    },
    {
      label: 'Call Duration',
      value: `${Math.floor(todayCalls.reduce((acc, call) => acc + call.duration, 0) / 60)}m`,
      icon: Clock,
      color: 'from-purple-500 to-purple-600',
    },
  ]

  const getCallIcon = (call: any) => {
    if (call.status === 'missed') return PhoneMissed
    if (call.direction === 'incoming') return PhoneIncoming
    return PhoneOutgoing
  }

  const getCallIconColor = (call: any) => {
    if (call.status === 'missed') return 'text-macos-accent-red'
    if (call.direction === 'incoming') return 'text-macos-accent-green'
    return 'text-macos-accent-blue'
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-macos-bg-primary">
      <div className="max-w-6xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-macos-text-primary mb-2">Dashboard</h1>
          <p className="text-macos-text-tertiary">Welcome back to Zar Softphone</p>
        </div>

        {/* Account Status */}
        {defaultAccount && (
          <div className="card-macos mb-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-macos-accent-blue to-blue-600 flex items-center justify-center">
                  <span className="text-xl font-semibold text-white">
                    {defaultAccount.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-macos-text-primary">
                    {defaultAccount.displayName}
                  </h3>
                  <p className="text-sm text-macos-text-tertiary">
                    {defaultAccount.username}@{defaultAccount.domain}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div className={clsx(
                  'w-2.5 h-2.5 rounded-full',
                  defaultAccount.registrationState === 'registered' 
                    ? 'bg-macos-accent-green' 
                    : 'bg-macos-accent-red'
                )} />
                <span className="text-sm text-macos-text-secondary">
                  {defaultAccount.registrationState === 'registered' ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {stats.map((stat, index) => {
            const Icon = stat.icon
            return (
              <div key={index} className="card-macos">
                <div className="flex items-center space-x-4">
                  <div className={`w-12 h-12 rounded-macos-lg bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                    <Icon size={24} className="text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-macos-text-primary">{stat.value}</p>
                    <p className="text-sm text-macos-text-tertiary">{stat.label}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button
            onClick={() => setCurrentPage('dialer')}
            className="card-macos hover:bg-macos-bg-tertiary transition-all p-6 text-left group"
          >
            <div className="w-12 h-12 rounded-macos-lg bg-macos-accent-blue bg-opacity-20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Phone size={24} className="text-macos-accent-blue" />
            </div>
            <h3 className="text-lg font-medium text-macos-text-primary mb-1">Make a Call</h3>
            <p className="text-sm text-macos-text-tertiary">Open the dialer</p>
          </button>

          <button
            onClick={() => setCurrentPage('contacts')}
            className="card-macos hover:bg-macos-bg-tertiary transition-all p-6 text-left group"
          >
            <div className="w-12 h-12 rounded-macos-lg bg-macos-accent-green bg-opacity-20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Users size={24} className="text-macos-accent-green" />
            </div>
            <h3 className="text-lg font-medium text-macos-text-primary mb-1">Contacts</h3>
            <p className="text-sm text-macos-text-tertiary">View your contacts</p>
          </button>
        </div>

        {/* Recent Calls */}
        <div className="card-macos">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-macos-text-primary">Recent Calls</h2>
            <button
              onClick={() => setCurrentPage('history')}
              className="text-sm text-macos-accent-blue hover:text-opacity-80 transition-colors"
            >
              View All
            </button>
          </div>

          {recentCalls.length > 0 ? (
            <div className="space-y-2">
              {recentCalls.map((call) => {
                const Icon = getCallIcon(call)
                const iconColor = getCallIconColor(call)
                
                return (
                  <div
                    key={call.id}
                    className="flex items-center justify-between p-3 rounded-macos hover:bg-macos-bg-tertiary transition-colors"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className={clsx('w-10 h-10 rounded-full bg-macos-bg-tertiary flex items-center justify-center', iconColor)}>
                        <Icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-macos-text-primary truncate">
                          {call.name || call.number}
                        </p>
                        <p className="text-xs text-macos-text-tertiary">
                          {formatTime(call.timestamp)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-macos-text-secondary">
                        {call.duration > 0 ? formatDuration(call.duration) : 'Missed'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <Phone size={48} className="mx-auto text-macos-text-quaternary mb-3" />
              <p className="text-macos-text-tertiary">No recent calls</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Grid3x3, Delete, PhoneForwarded } from 'lucide-react'
import { useStore } from '../store'
import { sipService } from '../services/sip/SipService'
import clsx from 'clsx'

const PAD_BUTTONS = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: '' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: '' },
]

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function Dialer() {
  const dialNumber = useStore((s) => s.dialNumber)
  const setDialNumber = useStore((s) => s.setDialNumber)
  const activeCall = useStore((s) => s.activeCall)
  const setActiveCall = useStore((s) => s.setActiveCall)
  const updateCallState = useStore((s) => s.updateCallState)
  const accounts = useStore((s) => s.accounts)
  const selectedAccountId = useStore((s) => s.selectedAccountId)

  // Only shown during an active call, lets user send DTMF
  const [showDtmfPad, setShowDtmfPad] = useState(false)

  const activeAccount =
    accounts.find((a) => a.id === selectedAccountId && a.isEnabled) ||
    accounts.find((a) => a.isDefault && a.isEnabled) ||
    accounts.find((a) => a.isEnabled)

  // Call timer
  useEffect(() => {
    if (activeCall?.state === 'active' && activeCall.startTime) {
      const interval = setInterval(() => {
        updateCallState({ duration: Math.floor((Date.now() - activeCall.startTime!) / 1000) })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [activeCall?.state, activeCall?.startTime])

  const handleDigit = useCallback((digit: string) => {
    if (activeCall?.state === 'active') {
      sipService.sendDTMF(digit)
    } else {
      setDialNumber(dialNumber + digit)
    }
  }, [activeCall, dialNumber, setDialNumber])

  // Keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if ('0123456789*#'.includes(e.key)) handleDigit(e.key)
      if (e.key === 'Backspace') setDialNumber(dialNumber.slice(0, -1))
      if (e.key === 'Enter' && !activeCall && dialNumber) handleCall()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleDigit, dialNumber, activeCall])

  const handleCall = async () => {
    if (!activeAccount || !dialNumber) return
    try {
      await sipService.makeCall(activeAccount.id, dialNumber)
      setActiveCall({
        id: Date.now().toString(),
        remoteNumber: dialNumber,
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

  const handleHangup = async () => {
    if (!activeCall) return
    await sipService.hangup()
    await window.electronAPI.db.addCallHistory({
      number: activeCall.remoteNumber,
      name: activeCall.remoteName,
      direction: activeCall.direction,
      status: 'answered',
      duration: activeCall.duration,
      timestamp: Date.now(),
      accountId: activeCall.accountId,
    })
    setActiveCall(null)
    setDialNumber('')
    setShowDtmfPad(false)
  }

  const handleMute = async () => {
    if (!activeCall) return
    if (activeCall.isMuted) { await sipService.unmute(); updateCallState({ isMuted: false }) }
    else                    { await sipService.mute();   updateCallState({ isMuted: true  }) }
  }

  const handleHold = async () => {
    if (!activeCall) return
    if (activeCall.isHeld) { await sipService.unhold(); updateCallState({ isHeld: false }) }
    else                   { await sipService.hold();   updateCallState({ isHeld: true  }) }
  }

  // ── Active call ─────────────────────────────────────────────────────────────
  if (activeCall) {
    const name = activeCall.remoteName || activeCall.remoteNumber
    return (
      <div className="flex flex-col h-full">
        {/* Caller info row */}
        <div
          className="flex items-center gap-3 px-3 py-3 border-b border-macos-separator flex-shrink-0"
          style={{ background: 'rgba(28,28,30,0.7)' }}
        >
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-macos-accent-blue to-blue-700 flex items-center justify-center">
              <span className="text-sm font-semibold text-white">{name.charAt(0).toUpperCase()}</span>
            </div>
            {activeCall.state === 'ringing' && (
              <div className="absolute inset-0 rounded-full bg-macos-accent-blue opacity-40 animate-pulse-ring" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-macos-text-primary truncate">{name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              {activeCall.state === 'connecting' && (
                <span className="text-xs text-macos-text-quaternary animate-pulse">Connecting…</span>
              )}
              {activeCall.state === 'ringing' && (
                <span className="text-xs text-macos-text-quaternary animate-pulse">Ringing…</span>
              )}
              {activeCall.state === 'active' && (
                <>
                  <span className="text-xs font-mono text-macos-accent-green">
                    {formatDuration(activeCall.duration)}
                  </span>
                  {activeCall.isHeld && (
                    <span className="text-[10px] text-macos-accent-yellow">HOLD</span>
                  )}
                  {!activeCall.isHeld && (
                    <div className="flex items-end gap-0.5">
                      {[10, 16, 8, 14, 6].map((h, i) => (
                        <div key={i} className="w-0.5 bg-macos-accent-blue rounded-full animate-pulse"
                          style={{ height: h, animationDelay: `${i * 0.13}s` }} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Call controls */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b border-macos-separator flex-shrink-0"
          style={{ background: 'rgba(28,28,30,0.4)' }}
        >
          <CtrlBtn onClick={handleMute} active={activeCall.isMuted} activeColor="bg-macos-accent-red" title="Mute">
            {activeCall.isMuted ? <MicOff size={14} /> : <Mic size={14} />}
          </CtrlBtn>
          <CtrlBtn onClick={handleHold} active={activeCall.isHeld} activeColor="bg-macos-accent-yellow" title="Hold">
            {activeCall.isHeld ? <Play size={14} /> : <Pause size={14} />}
          </CtrlBtn>
          <CtrlBtn onClick={() => setShowDtmfPad((v) => !v)} active={showDtmfPad} title="DTMF">
            <Grid3x3 size={14} />
          </CtrlBtn>
          <CtrlBtn onClick={() => {}} title="Transfer">
            <PhoneForwarded size={14} />
          </CtrlBtn>
          {/* Hang up */}
          <button
            onClick={handleHangup}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-macos-accent-red hover:bg-opacity-90 text-white text-xs font-medium transition-all"
          >
            <PhoneOff size={13} /> End
          </button>
        </div>

        {/* DTMF pad or empty fill */}
        {showDtmfPad
          ? <DialPad onDigit={handleDigit} />
          : <div className="flex-1" />
        }
      </div>
    )
  }

  // ── Idle dialer ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Number input */}
      <div
        className="relative flex items-center px-3 border-b border-macos-separator flex-shrink-0"
        style={{ minHeight: 52, background: 'rgba(28,28,30,0.5)' }}
      >
        <input
          type="text"
          value={dialNumber}
          onChange={(e) => setDialNumber(e.target.value)}
          placeholder="Enter number…"
          className="flex-1 bg-transparent text-xl font-light text-macos-text-primary text-center focus:outline-none placeholder-macos-text-quaternary py-2"
        />
        {dialNumber && (
          <button
            onClick={() => setDialNumber(dialNumber.slice(0, -1))}
            onDoubleClick={() => setDialNumber('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-macos-text-quaternary hover:text-macos-text-secondary transition-colors"
            title="Backspace (double-click to clear)"
          >
            <Delete size={14} />
          </button>
        )}
      </div>

      {/* Call button */}
      <div
        className="flex items-center px-3 py-2 border-b border-macos-separator gap-2 flex-shrink-0"
        style={{ background: 'rgba(28,28,30,0.3)' }}
      >
        <button
          onClick={handleCall}
          disabled={!dialNumber || !activeAccount}
          className={clsx(
            'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition-all',
            dialNumber && activeAccount
              ? 'bg-macos-accent-green hover:bg-opacity-90 text-white'
              : 'bg-macos-bg-tertiary text-macos-text-quaternary cursor-not-allowed'
          )}
        >
          <Phone size={13} /> Call
        </button>
      </div>

      {/* Dialpad — fills all remaining height */}
      <DialPad onDigit={handleDigit} />
    </div>
  )
}

// ── Shared sub-components ────────────────────────────────────────────────────

function DialPad({ onDigit }: { onDigit: (d: string) => void }) {
  return (
    <div className="flex-1 grid grid-cols-3 grid-rows-4 min-h-0"
      style={{ background: 'rgba(28,28,30,0.15)' }}
    >
      {PAD_BUTTONS.map((btn) => (
        <button
          key={btn.digit}
          onClick={() => onDigit(btn.digit)}
          className="flex flex-col items-center justify-center hover:bg-macos-bg-tertiary active:bg-macos-bg-secondary transition-colors border-r border-b border-macos-separator last:border-r-0"
        >
          <span className="text-lg font-light text-macos-text-primary leading-none">{btn.digit}</span>
          {btn.sub && (
            <span className="text-[9px] text-macos-text-quaternary mt-0.5 leading-none tracking-wider">{btn.sub}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function CtrlBtn({
  onClick, children, active = false, activeColor = 'bg-macos-bg-tertiary', title,
}: {
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  activeColor?: string
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        'p-1.5 rounded transition-all text-xs',
        active
          ? `${activeColor} text-white`
          : 'bg-macos-bg-tertiary text-macos-text-secondary hover:text-macos-text-primary'
      )}
    >
      {children}
    </button>
  )
}

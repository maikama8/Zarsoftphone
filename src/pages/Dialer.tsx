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
    // History is saved by App.tsx's onCallState('ended') handler for both
    // native and WebSocket calls, covering remote-hangup too.
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
    const ringing = activeCall.state === 'connecting' || activeCall.state === 'ringing'
    return (
      <div className="flex flex-col h-full">
        {/* Caller hero */}
        <div className="flex flex-col items-center justify-center gap-3 pt-6 pb-4 px-4 flex-shrink-0">
          <div className="relative">
            {ringing && (
              <span className="absolute inset-0 rounded-full brand-gradient opacity-30 animate-pulse-ring" />
            )}
            <div className="relative w-20 h-20 rounded-full brand-gradient flex items-center justify-center shadow-brand ring-1 ring-white/10">
              <span className="text-2xl font-semibold text-white">{name.charAt(0).toUpperCase()}</span>
            </div>
          </div>
          <div className="text-center">
            <div className="text-base font-semibold text-macos-text-primary truncate max-w-[280px]">{name}</div>
            <div className="mt-1 flex items-center justify-center gap-2 h-4">
              {activeCall.state === 'connecting' && (
                <span className="text-xs text-macos-text-tertiary animate-pulse">Connecting…</span>
              )}
              {activeCall.state === 'ringing' && (
                <span className="text-xs text-macos-text-tertiary animate-pulse">Ringing…</span>
              )}
              {activeCall.state === 'active' && (
                <>
                  <span className="text-xs font-mono tabular-nums text-macos-accent-green">
                    {formatDuration(activeCall.duration)}
                  </span>
                  {activeCall.isHeld ? (
                    <span className="text-[10px] font-semibold text-macos-accent-yellow uppercase tracking-wide">On hold</span>
                  ) : (
                    <div className="flex items-end gap-0.5">
                      {[10, 16, 8, 14, 6].map((h, i) => (
                        <div key={i} className="w-0.5 bg-macos-accent-green rounded-full animate-pulse"
                          style={{ height: h, animationDelay: `${i * 0.13}s` }} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* In-call controls */}
        <div className="grid grid-cols-4 gap-2 px-4 flex-shrink-0">
          <CtrlBtn onClick={handleMute} active={activeCall.isMuted} activeColor="bg-macos-accent-red" label={activeCall.isMuted ? 'Unmute' : 'Mute'}>
            {activeCall.isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </CtrlBtn>
          <CtrlBtn onClick={handleHold} active={activeCall.isHeld} activeColor="bg-macos-accent-yellow" label={activeCall.isHeld ? 'Resume' : 'Hold'}>
            {activeCall.isHeld ? <Play size={18} /> : <Pause size={18} />}
          </CtrlBtn>
          <CtrlBtn onClick={() => setShowDtmfPad((v) => !v)} active={showDtmfPad} label="Keypad">
            <Grid3x3 size={18} />
          </CtrlBtn>
          <CtrlBtn onClick={() => {}} label="Transfer">
            <PhoneForwarded size={18} />
          </CtrlBtn>
        </div>

        {/* DTMF pad or spacer */}
        {showDtmfPad ? <DialPad onDigit={handleDigit} /> : <div className="flex-1" />}

        {/* End call */}
        <div className="flex justify-center pb-5 pt-2 flex-shrink-0">
          <button
            onClick={handleHangup}
            className="w-16 h-16 rounded-full bg-macos-accent-red text-white flex items-center justify-center shadow-lg shadow-macos-accent-red/40 hover:brightness-110 active:scale-95 transition-all"
            title="End call"
          >
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    )
  }

  // ── Idle dialer ──────────────────────────────────────────────────────────────
  const canCall = Boolean(dialNumber && activeAccount)
  return (
    <div className="flex flex-col h-full">
      {/* Number display */}
      <div className="flex items-center justify-center px-4 pt-5 pb-2 min-h-[64px] flex-shrink-0">
        <input
          type="text"
          value={dialNumber}
          onChange={(e) => setDialNumber(e.target.value)}
          placeholder="Enter number"
          className="w-full bg-transparent text-[28px] font-light tracking-wide text-macos-text-primary text-center focus:outline-none placeholder-macos-text-quaternary"
        />
      </div>

      {/* Dialpad */}
      <DialPad onDigit={handleDigit} />

      {/* Action row: call + backspace */}
      <div className="grid grid-cols-3 items-center px-4 pb-5 pt-1 flex-shrink-0">
        <div />
        <div className="flex justify-center">
          <button
            onClick={handleCall}
            disabled={!canCall}
            className={clsx(
              'w-16 h-16 rounded-full flex items-center justify-center transition-all',
              canCall
                ? 'brand-gradient-green text-white shadow-lg shadow-macos-accent-green/40 hover:brightness-110 active:scale-95'
                : 'bg-macos-bg-tertiary text-macos-text-quaternary cursor-not-allowed'
            )}
            title="Call"
          >
            <Phone size={24} />
          </button>
        </div>
        <div className="flex justify-center">
          {dialNumber && (
            <button
              onClick={() => setDialNumber(dialNumber.slice(0, -1))}
              onDoubleClick={() => setDialNumber('')}
              className="p-3 rounded-full text-macos-text-tertiary hover:text-macos-text-primary hover:bg-macos-bg-tertiary/60 active:scale-90 transition-all"
              title="Backspace (double-click to clear)"
            >
              <Delete size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared sub-components ────────────────────────────────────────────────────

function DialPad({ onDigit }: { onDigit: (d: string) => void }) {
  return (
    <div className="flex-1 grid grid-cols-3 gap-1.5 px-5 py-2 place-items-center content-center min-h-0">
      {PAD_BUTTONS.map((btn) => (
        <button
          key={btn.digit}
          onClick={() => onDigit(btn.digit)}
          className="dialpad-key w-full aspect-square max-w-[60px] max-h-[60px]"
        >
          <span className="text-2xl font-light text-macos-text-primary leading-none">{btn.digit}</span>
          {btn.sub && (
            <span className="text-[8px] text-macos-text-quaternary mt-0.5 leading-none tracking-[0.15em] font-medium">{btn.sub}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function CtrlBtn({
  onClick, children, active = false, activeColor = 'bg-macos-bg-tertiary', label,
}: {
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  activeColor?: string
  label?: string
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 group">
      <span
        className={clsx(
          'w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95',
          active
            ? `${activeColor} text-white`
            : 'bg-macos-bg-tertiary/70 text-macos-text-secondary group-hover:bg-macos-bg-tertiary group-hover:text-macos-text-primary'
        )}
      >
        {children}
      </span>
      {label && <span className="text-[9px] text-macos-text-tertiary leading-none">{label}</span>}
    </button>
  )
}

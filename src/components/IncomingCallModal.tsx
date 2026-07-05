import { useStore } from '../store'
import { sipService } from '../services/sip/SipService'
import { Phone, PhoneOff } from 'lucide-react'

export default function IncomingCallModal() {
  const incomingCall = useStore((s) => s.incomingCall)
  const setIncomingCall = useStore((s) => s.setIncomingCall)
  const setActiveCall = useStore((s) => s.setActiveCall)
  const contacts = useStore((s) => s.contacts)

  if (!incomingCall) return null

  const contact = contacts.find((c) => c.sipNumber === incomingCall.remoteNumber)
  const displayName = contact?.name || incomingCall.remoteNumber

  const handleAnswer = async () => {
    if (incomingCall.isNative) {
      // Native incoming call has no sip.js session — answer via IPC.
      await sipService.answerNativeCall({
        accountId: incomingCall.accountId,
        remoteNumber: incomingCall.remoteNumber,
        callId: incomingCall.callId || '',
      })
      setActiveCall({
        id: Date.now().toString(),
        remoteNumber: incomingCall.remoteNumber,
        remoteName: contact?.name,
        direction: 'incoming',
        state: 'connecting',
        startTime: Date.now(),
        duration: 0,
        isMuted: false,
        isHeld: false,
        accountId: incomingCall.accountId,
      })
      // Native 'active' call-state will arrive via IPC and start the audio bridge.
      setIncomingCall(null)
      return
    }
    if (!incomingCall.session) return
    await sipService.answerCall(incomingCall.session)
    setActiveCall({
      id: Date.now().toString(),
      remoteNumber: incomingCall.remoteNumber,
      remoteName: contact?.name,
      direction: 'incoming',
      state: 'active',
      startTime: Date.now(),
      duration: 0,
      isMuted: false,
      isHeld: false,
      accountId: incomingCall.accountId,
    })
    setIncomingCall(null)
  }

  const handleReject = async () => {
    if (incomingCall.isNative) {
      await sipService.rejectNativeCall({
        accountId: incomingCall.accountId,
        remoteNumber: incomingCall.remoteNumber,
        callId: incomingCall.callId || '',
      })
      setIncomingCall(null)
      await window.electronAPI.db.addCallHistory({
        number: incomingCall.remoteNumber,
        name: contact?.name,
        direction: 'incoming',
        status: 'missed',
        duration: 0,
        timestamp: Date.now(),
        accountId: incomingCall.accountId,
      })
      return
    }
    if (!incomingCall.session) { setIncomingCall(null); return }
    await sipService.rejectCall(incomingCall.session)
    setIncomingCall(null)
    await window.electronAPI.db.addCallHistory({
      number: incomingCall.remoteNumber,
      name: contact?.name,
      direction: 'incoming',
      status: 'missed',
      duration: 0,
      timestamp: Date.now(),
      accountId: incomingCall.accountId,
    })
  }

  return (
    /* Compact notification banner at the bottom of the window */
    <div className="absolute bottom-0 left-0 right-0 z-50 p-2 animate-slide-up">
      <div
        className="flex items-center gap-2 rounded-macos px-3 py-2 shadow-macos-lg border border-macos-separator"
        style={{ background: 'rgba(36,36,38,0.97)', backdropFilter: 'blur(20px)' }}
      >
        {/* Pulsing avatar */}
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-macos-accent-blue to-blue-700 flex items-center justify-center">
            <span className="text-sm font-semibold text-white">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="absolute inset-0 rounded-full bg-macos-accent-blue opacity-30 animate-pulse" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-macos-text-quaternary leading-none mb-0.5">Incoming call</div>
          <div className="text-xs font-semibold text-macos-text-primary truncate leading-tight">
            {displayName}
          </div>
          {contact?.name && (
            <div className="text-[10px] text-macos-text-quaternary truncate leading-none">
              {incomingCall.remoteNumber}
            </div>
          )}
        </div>

        {/* Decline */}
        <button
          onClick={handleReject}
          className="p-1.5 rounded-full bg-macos-accent-red hover:bg-opacity-90 text-white transition-all flex-shrink-0"
          title="Decline"
        >
          <PhoneOff size={14} />
        </button>

        {/* Answer */}
        <button
          onClick={handleAnswer}
          className="p-1.5 rounded-full bg-macos-accent-green hover:bg-opacity-90 text-white transition-all flex-shrink-0 animate-pulse"
          title="Answer"
        >
          <Phone size={14} />
        </button>
      </div>
    </div>
  )
}

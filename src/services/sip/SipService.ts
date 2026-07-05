import {
  UserAgent,
  Registerer,
  Inviter,
  Invitation,
  SessionState,
  RegistererState,
  UserAgentOptions,
  URI,
} from 'sip.js'
import type { SipAccount, CallState } from '../../types'
import { NativeAudioBridge } from '../../audio/NativeAudioBridge'

interface NativeIncomingCall {
  accountId: string
  remoteNumber: string
  callId: string
}

export class SipService {
  private userAgents: Map<string, UserAgent> = new Map()
  private registerers: Map<string, Registerer> = new Map()
  private currentSession: Inviter | Invitation | null = null
  private remoteAudio: HTMLAudioElement | null = null

  // Native (UDP/TCP/TLS) account tracking.
  private nativeAccounts: Set<string> = new Set()
  private registerSeen: Set<string> = new Set()
  private accountById: Map<string, SipAccount> = new Map()
  private currentCallIsNative = false
  private currentCallAccountId: string | null = null
  private audioBridge: NativeAudioBridge | null = null
  
  private onRegistrationStateChange?: (accountId: string, state: string) => void
  private onIncomingCall?: (accountId: string, remoteNumber: string, session: Invitation) => void
  private onCallStateChange?: (state: CallState) => void

  constructor() {
    // Create remote audio element for incoming audio
    this.remoteAudio = new Audio()
    this.remoteAudio.autoplay = true
  }

  setCallbacks(callbacks: {
    onRegistrationStateChange?: (accountId: string, state: string) => void
    onIncomingCall?: (accountId: string, remoteNumber: string, session: Invitation) => void
    onCallStateChange?: (state: CallState) => void
  }) {
    this.onRegistrationStateChange = callbacks.onRegistrationStateChange
    this.onIncomingCall = callbacks.onIncomingCall
    this.onCallStateChange = callbacks.onCallStateChange
  }

  async register(account: SipAccount) {
    // React StrictMode double-mounts effects in dev — ensure we only register
    // each account once per session (a re-register would orphan the first
    // transport and its 32s timeout would later overwrite a successful result).
    if (this.registerSeen.has(account.id)) return
    this.registerSeen.add(account.id)
    try {
      this.accountById.set(account.id, account)
      // Use native transport for UDP/TCP/TLS
      if (['UDP', 'TCP', 'TLS'].includes(account.transport)) {
        console.log(`Using native SIP service for ${account.transport}`)
        this.nativeAccounts.add(account.id)
        const success = await window.electronAPI.sipNative.register(account)
        // Registration success/failure is driven asynchronously by the
        // sipNative.onRegistered/onRegistrationFailed events wired in App.tsx;
        // do not flip to 'registered' here — the main process has only sent
        // the REGISTER, not yet received the 200 OK.
        if (!success) {
          this.onRegistrationStateChange?.(account.id, 'failed')
        }
        return success
      }

      // Use WebSocket for WS/WSS (existing code)
      const uri = `sip:${account.username}@${account.domain}`

      // Browser-based SIP clients can only use WebSocket transport (WS/WSS)
      // Auto-upgrade to WSS for secure ports (443, 8443) or when WSS is explicitly selected
      const useSecure = account.transport === 'WSS' || account.port === 443 || account.port === 8443

      const server = useSecure
        ? `wss://${account.server}:${account.port}`
        : `ws://${account.server}:${account.port}`

      const iceServers: RTCIceServer[] = []
      if (account.stunServer) iceServers.push({ urls: account.stunServer })
      if (account.turnServer) iceServers.push({ urls: account.turnServer })
      if (iceServers.length === 0) {
        iceServers.push({ urls: 'stun:stun.l.google.com:19302' })
      }

      const userAgentOptions: UserAgentOptions = {
        uri: UserAgent.makeURI(uri) as URI,
        transportOptions: {
          server,
        },
        authorizationUsername: account.username,
        authorizationPassword: account.password,
        displayName: account.displayName,
        sessionDescriptionHandlerFactoryOptions: {
          constraints: {
            audio: true,
            video: false,
          },
          iceGatheringTimeout: 2000,
          peerConnectionConfiguration: {
            iceServers,
          },
        },
      }

      const userAgent = new UserAgent(userAgentOptions)

      // Handle incoming calls
      userAgent.delegate = {
        onInvite: (invitation: Invitation) => {
          const remoteUri = invitation.remoteIdentity.uri.toString()
          const remoteNumber = this.extractNumber(remoteUri)
          
          if (this.onIncomingCall) {
            this.onIncomingCall(account.id, remoteNumber, invitation)
          }
        },
      }

      await userAgent.start()

      const registerer = new Registerer(userAgent)
      
      registerer.stateChange.addListener((state: RegistererState) => {
        let stateStr: string
        switch (state) {
          case RegistererState.Registered:   stateStr = 'registered';   break
          case RegistererState.Unregistered: stateStr = 'disconnected'; break
          case RegistererState.Terminated:   stateStr = 'failed';       break
          default:                           stateStr = 'registering';  break
        }
        this.onRegistrationStateChange?.(account.id, stateStr)
      })

      await registerer.register()

      this.userAgents.set(account.id, userAgent)
      this.registerers.set(account.id, registerer)

      return true
    } catch (error) {
      console.error('Registration failed:', error)
      if (this.onRegistrationStateChange) {
        this.onRegistrationStateChange(account.id, 'failed')
      }
      return false
    }
  }

  async unregister(accountId: string) {
    // Clear registration tracking so a re-enable can register again.
    this.registerSeen.delete(accountId)
    this.nativeAccounts.delete(accountId)
    // Check if this account is using native transport
    const account = this.userAgents.get(accountId)
    if (!account) {
      // Might be native transport
      await window.electronAPI.sipNative.unregister(accountId)
      return
    }

    const registerer = this.registerers.get(accountId)
    const userAgent = this.userAgents.get(accountId)

    if (registerer) {
      await registerer.unregister()
      this.registerers.delete(accountId)
    }

    if (userAgent) {
      await userAgent.stop()
      this.userAgents.delete(accountId)
    }
  }

  async makeCall(accountId: string, targetNumber: string) {
    // Native (UDP/TCP/TLS) path: delegate to the main-process SIP stack.
    if (this.nativeAccounts.has(accountId)) {
      this.currentCallIsNative = true
      this.currentCallAccountId = accountId
      this.onCallStateChange?.('connecting')
      // The main process drives subsequent states (ringing/active/ended) via
      // the sipNative.onCallState IPC, wired in App.tsx.
      await window.electronAPI.sipNative.makeCall(accountId, targetNumber)
      return
    }

    const userAgent = this.userAgents.get(accountId)
    if (!userAgent) {
      throw new Error('Account not registered')
    }

    const targetUri = `sip:${targetNumber}@${userAgent.configuration.uri?.host}`
    const target = UserAgent.makeURI(targetUri) as URI
    if (!target) {
      throw new Error('Invalid target')
    }

    const inviter = new Inviter(userAgent, target)
    this.currentSession = inviter
    this.currentCallIsNative = false
    this.currentCallAccountId = accountId

    // Setup session state change handler
    inviter.stateChange.addListener((state: SessionState) => {
      if (state === SessionState.Establishing) {
        this.onCallStateChange?.('connecting')
      } else if (state === SessionState.Established) {
        this.onCallStateChange?.('active')
        this.setupRemoteMedia(inviter)
      } else if (state === SessionState.Terminated) {
        this.onCallStateChange?.('ended')
        this.cleanupMedia()
      }
    })

    await inviter.invite()
    this.onCallStateChange?.('ringing')
  }

  // Called by App.tsx when the native 'active' call-state arrives — set up the
  // renderer-side audio bridge (mic capture + remote playback).
  async setupNativeAudio(accountId: string): Promise<void> {
    if (!this.audioBridge) {
      this.audioBridge = new NativeAudioBridge()
    }
    await this.audioBridge.start(accountId)
  }

  async teardownNativeAudio(): Promise<void> {
    if (this.audioBridge) {
      await this.audioBridge.stop()
      this.audioBridge = null
    }
  }

  // Answer an incoming native call (no sip.js session object).
  async answerNativeCall(call: NativeIncomingCall): Promise<void> {
    this.currentCallIsNative = true
    this.currentCallAccountId = call.accountId
    await window.electronAPI.sipNative.answer(call.accountId, call.callId)
  }

  async rejectNativeCall(call: NativeIncomingCall): Promise<void> {
    await window.electronAPI.sipNative.reject(call.accountId, call.callId)
    this.onCallStateChange?.('ended')
  }

  getActiveAccountId(): string | null {
    return this.currentCallAccountId
  }

  isCurrentCallNative(): boolean {
    return this.currentCallIsNative
  }

  async answerCall(session: Invitation) {
    this.currentSession = session

    session.stateChange.addListener((state: SessionState) => {
      if (state === SessionState.Established) {
        this.onCallStateChange?.('active')
        this.setupRemoteMedia(session)
      } else if (state === SessionState.Terminated) {
        this.onCallStateChange?.('ended')
        this.cleanupMedia()
      }
    })

    await session.accept()
  }

  async rejectCall(session: Invitation) {
    await session.reject()
    this.onCallStateChange?.('ended')
  }

  async hangup() {
    // Native path: tell the main process to CANCEL/BYE.
    if (this.currentCallIsNative && this.currentCallAccountId) {
      const accountId = this.currentCallAccountId
      this.currentCallIsNative = false
      this.currentCallAccountId = null
      await this.teardownNativeAudio()
      await window.electronAPI.sipNative.hangup(accountId)
      return
    }
    if (this.currentSession) {
      if (this.currentSession instanceof Inviter) {
        await this.currentSession.cancel()
      } else {
        await this.currentSession.bye()
      }
      this.currentSession = null
      this.cleanupMedia()
      this.onCallStateChange?.('ended')
    }
  }

  async mute() {
    if (this.currentCallIsNative) {
      if (this.audioBridge) this.audioBridge.setMuted(true)
      if (this.currentCallAccountId) await window.electronAPI.sipNative.mute(this.currentCallAccountId, true)
      return
    }
    if (this.currentSession?.sessionDescriptionHandler) {
      const pc = (this.currentSession.sessionDescriptionHandler as any).peerConnection
      if (pc) {
        const senders = pc.getSenders()
        senders.forEach((sender: RTCRtpSender) => {
          if (sender.track?.kind === 'audio') {
            sender.track.enabled = false
          }
        })
      }
    }
  }

  async unmute() {
    if (this.currentCallIsNative) {
      if (this.audioBridge) this.audioBridge.setMuted(false)
      if (this.currentCallAccountId) await window.electronAPI.sipNative.mute(this.currentCallAccountId, false)
      return
    }
    if (this.currentSession?.sessionDescriptionHandler) {
      const pc = (this.currentSession.sessionDescriptionHandler as any).peerConnection
      if (pc) {
        const senders = pc.getSenders()
        senders.forEach((sender: RTCRtpSender) => {
          if (sender.track?.kind === 'audio') {
            sender.track.enabled = true
          }
        })
      }
    }
  }

  async hold() {
    if (this.currentCallIsNative && this.currentCallAccountId) {
      await window.electronAPI.sipNative.hold(this.currentCallAccountId)
      return
    }
    // Simplified hold - in production, use proper SIP hold/unhold
    await this.mute()
  }

  async unhold() {
    if (this.currentCallIsNative && this.currentCallAccountId) {
      await window.electronAPI.sipNative.unhold(this.currentCallAccountId)
      return
    }
    await this.unmute()
  }

  sendDTMF(digit: string) {
    if (this.currentCallIsNative && this.currentCallAccountId) {
      void window.electronAPI.sipNative.sendDTMF(this.currentCallAccountId, digit)
      return
    }
    if (this.currentSession?.sessionDescriptionHandler) {
      const pc = (this.currentSession.sessionDescriptionHandler as any).peerConnection
      if (pc) {
        const senders = pc.getSenders()
        senders.forEach((sender: RTCRtpSender) => {
          if (sender.track?.kind === 'audio' && sender.dtmf) {
            sender.dtmf.insertDTMF(digit, 100, 70)
          }
        })
      }
    }
  }

  private setupRemoteMedia(session: Inviter | Invitation) {
    const pc = (session.sessionDescriptionHandler as any)?.peerConnection
    if (pc && this.remoteAudio) {
      const remoteStream = new MediaStream()
      pc.getReceivers().forEach((receiver: RTCRtpReceiver) => {
        if (receiver.track) {
          remoteStream.addTrack(receiver.track)
        }
      })
      this.remoteAudio.srcObject = remoteStream
    }
  }

  private cleanupMedia() {
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null
    }
  }

  private extractNumber(uri: string): string {
    const match = uri.match(/sip:([^@]+)@/)
    return match ? match[1] : uri
  }

  async cleanup() {
    for (const accountId of this.userAgents.keys()) {
      await this.unregister(accountId)
    }
  }
}

export const sipService = new SipService()

// NativeSipService — facade orchestrating the SIP + RTP modules for the
// UDP/TCP/TLS path. Emits the events the renderer/main process expect:
//   'registered' | 'registrationFailed' | 'incomingCall' | 'callState' | 'authRequired' | 'error' | 'remoteAudio'
// Public methods called via IPC from main.ts:
//   register / unregister / makeCall / hangup / answer / reject / hold / unhold / sendDTMF / mute

import { EventEmitter } from 'events'
import * as crypto from 'crypto'
import { SipTransport } from './transport'
import { TransactionLayer } from './transactions'
import {
  parseMessage, getHeader, getParam, getHeaders,
  type SipMessage,
} from './parser'
import { parseChallenge, contextFromChallenge, buildAuthorization, incrementNc, type AuthContext } from './digest'
import { dialogFromUac2xx, dialogFromUasInvite, nextCSeq, type DialogState } from './dialog'
import { parseSdp, negotiate, buildSdp, type NegotiatedMedia } from './sdp'
import { RtpSocket } from '../rtp/RtpSocket'
import { RtpSession } from '../rtp/RtpSession'

export interface SipAccount {
  id: string
  username: string
  password: string
  domain: string
  server: string
  transport: 'UDP' | 'TCP' | 'TLS'
  port: number
  displayName?: string
  authUser?: string
  realm?: string
  proxy?: string
}

interface AccountContext {
  account: SipAccount
  transport: SipTransport
  txLayer: TransactionLayer
  auth: Map<string, AuthContext> // keyed by realm
  registerCallId: string
  registerCSeq: number
  registerTag: string
  localTag: string
  registered: boolean
  disposed: boolean // set true on unregister; suppresses stray transaction timeouts
  keepaliveTimer?: NodeJS.Timeout
  reRegisterTimer?: NodeJS.Timeout
}

interface CallContext {
  accountId: string
  callId: string
  localTag: string
  inviteBranch: string
  inviteCSeq: number
  authRetried: boolean
  fromHeader: string // exact From header used on the INVITE (reused on ACK/BYE for RFC compliance)
  requestUri: string
  sdp: string
  dialog?: DialogState
  rtp?: RtpSession
  rtpSocket?: RtpSocket
  negotiated?: NegotiatedMedia
  state: 'calling' | 'proceeding' | 'early' | 'confirmed' | 'terminating' | 'terminated'
  direction: 'caller' | 'callee'
  targetNumber?: string
  localSdpPort?: number
  sessionId?: number
}

export class NativeSipService extends EventEmitter {
  private accounts: Map<string, AccountContext> = new Map()
  private registering: Set<string> = new Set()
  private calls: Map<string, CallContext> = new Map()
  // Per-account CSeq counter for out-of-dialog MESSAGE requests.
  private messageCSeq: Map<string, number> = new Map()
  // Active call id per account (for IPC handlers that take accountId).
  private activeCallByAccount: Map<string, string> = new Map()
  // Push audio frames to renderer.
  private sendRemoteFrame: (frame: Int16Array) => void = () => {}

  constructor() {
    super()
  }

  setRemoteFrameSink(fn: (frame: Int16Array) => void): void {
    this.sendRemoteFrame = fn
  }

  // Called by main.ts to feed a mic frame from the renderer into the active call.
  private micFrameCount = 0
  private remoteRtpCount = 0

  feedMicFrame(accountId: string, frame: Int16Array): void {
    const callId = this.activeCallByAccount.get(accountId)
    if (!callId) return
    const call = this.calls.get(callId)
    if (!call || !call.rtp) return
    call.rtp.sendFrame(frame)
    this.micFrameCount++
    if (this.micFrameCount % 50 === 1) {
      console.log(`[NativeSIP] mic frame #${this.micFrameCount} -> RTP (call ${callId.substring(0, 8)})`)
    }
  }

  onRemoteRtpReceived(): void {
    this.remoteRtpCount++
    if (this.remoteRtpCount % 50 === 1) {
      console.log(`[NativeSIP] remote RTP packet #${this.remoteRtpCount} received`)
    }
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  async register(account: SipAccount): Promise<boolean> {
    // Dedupe in-flight registrations (React StrictMode double-mounts effects in dev).
    if (this.registering.has(account.id)) {
      return true
    }
    this.registering.add(account.id)
    try {
      return await this._doRegister(account)
    } finally {
      this.registering.delete(account.id)
    }
  }

  private async _doRegister(account: SipAccount): Promise<boolean> {
    // If already registered, tear down first.
    if (this.accounts.has(account.id)) {
      await this.unregister(account.id).catch(() => {})
    }

    const transport = new SipTransport({
      transport: account.transport,
      server: account.server,
      port: account.port,
      servername: account.server,
      rejectUnauthorized: true,
    })

    const ctx: AccountContext = {
      account,
      transport,
      txLayer: new TransactionLayer(),
      auth: new Map(),
      registerCallId: this.generateCallId(),
      registerCSeq: 1,
      registerTag: this.generateTag(),
      localTag: this.generateTag(),
      registered: false,
      disposed: false,
    }

    transport.on('message', (raw: string, rinfo) => this.handleIncoming(raw, account.id, rinfo))
    transport.on('error', (err: Error) => {
      console.error(`[NativeSIP] ${account.id} transport error:`, err)
      this.emit('error', account.id, err)
    })

    try {
      await transport.connect()
    } catch (err) {
      this.emit('registrationFailed', account.id, (err as Error).message)
      return false
    }

    this.accounts.set(account.id, ctx)
    console.log(`[NativeSIP] Registering ${account.username}@${account.domain} via ${account.transport} (${transport.localAddress}:${transport.localPort})`)

    this.sendRegister(ctx, false)
    return true
  }

  async unregister(accountId: string): Promise<void> {
    const ctx = this.accounts.get(accountId)
    if (!ctx) return
    // Mark disposed so any in-flight transaction timeout (e.g. the de-register
    // REGISTER below, whose response we won't wait for) is silently dropped
    // instead of flipping the UI to "failed" after we've already torn down.
    ctx.disposed = true
    if (ctx.keepaliveTimer) { clearTimeout(ctx.keepaliveTimer); ctx.keepaliveTimer = undefined }
    if (ctx.reRegisterTimer) { clearTimeout(ctx.reRegisterTimer); ctx.reRegisterTimer = undefined }
    // Send a fire-and-forget REGISTER Expires:0 so the server drops us, then
    // close the socket immediately (don't wait for the response).
    if (ctx.registered) {
      try { this.sendRegisterFireAndForget(ctx, true) } catch { /* ignore */ }
    }
    ctx.transport.close()
    this.accounts.delete(accountId)
  }

  // Re-register an existing (or new) account — used by the UI's "Reconnect".
  async reconnect(accountId: string): Promise<boolean> {
    const existing = this.accounts.get(accountId)
    if (existing) {
      // Tear down the current transport cleanly, then re-register.
      await this.unregister(accountId).catch(() => {})
    }
    const account = existing?.account
    if (!account) return false
    return this.register(account)
  }

  // Send a REGISTER without tracking a transaction (no retransmission, no
  // timeout emission). Used for de-register on teardown.
  private sendRegisterFireAndForget(ctx: AccountContext, deRegister: boolean): void {
    const account = ctx.account
    ctx.registerCSeq += 1
    const branch = this.generateBranch()
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const expires = deRegister ? 0 : ((account as any).registrationExpiry ?? 600)
    const targetUri = `sip:${account.domain}`
    let msg =
      `REGISTER ${targetUri} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: <sip:${account.username}@${account.domain}>;tag=${ctx.registerTag}\r\n` +
      `To: <sip:${account.username}@${account.domain}>\r\n` +
      `Call-ID: ${ctx.registerCallId}\r\n` +
      `CSeq: ${ctx.registerCSeq} REGISTER\r\n` +
      `Contact: <sip:${account.username}@${localIp}:${localPort};transport=${account.transport.toLowerCase()}>\r\n` +
      `Expires: ${expires}\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: 0\r\n\r\n`
    try { ctx.transport.send(msg) } catch { /* closing — ignore */ }
  }

  private sendRegister(ctx: AccountContext, deRegister: boolean): void {
    const account = ctx.account
    ctx.registerCSeq += 1
    const branch = this.generateBranch()
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const expires = deRegister ? 0 : (account as any).registrationExpiry ?? 600
    const targetUri = `sip:${account.domain}`

    let msg =
      `REGISTER ${targetUri} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: <sip:${account.username}@${account.domain}>;tag=${ctx.registerTag}\r\n` +
      `To: <sip:${account.username}@${account.domain}>\r\n` +
      `Call-ID: ${ctx.registerCallId}\r\n` +
      `CSeq: ${ctx.registerCSeq} REGISTER\r\n` +
      `Contact: <sip:${account.username}@${localIp}:${localPort};transport=${account.transport.toLowerCase()}>\r\n` +
      `Expires: ${expires}\r\n` +
      `User-Agent: Zarsip/1.0\r\n`

    // Attach Authorization if we have a cached context for this realm.
    const authCtx = ctx.auth.values().next().value
    if (authCtx && !deRegister) {
      const challenge = {
        scheme: 'Digest',
        realm: authCtx.realm,
        nonce: authCtx.nonce,
        algorithm: authCtx.algorithm,
        qop: authCtx.qop ? [authCtx.qop] : undefined,
        opaque: authCtx.opaque,
        stale: false,
        params: {},
      }
      incrementNc(authCtx)
      msg += buildAuthorization({ method: 'REGISTER', uri: targetUri, challenge, context: authCtx, isProxy: false })
    }

    msg += `Content-Length: 0\r\n\r\n`

    const raw = msg
    const onFinal = (resp: SipMessage) => this.handleRegisterResponse(ctx, resp, deRegister)
    const onProvisional = (resp: SipMessage) => {
      console.log(`[NativeSIP] REGISTER provisional ${resp.statusCode}`)
    }
    ctx.txLayer.sendClientTransaction({
      branch, method: 'REGISTER', raw,
      send: (r) => ctx.transport.send(r),
      isInvite: false,
      onFinal, onProvisional,
    })
  }

  private handleRegisterResponse(ctx: AccountContext, resp: SipMessage, deRegister: boolean): void {
    // If the account was torn down while a REGISTER was in flight, drop it silently.
    if (ctx.disposed) return
    const code = resp.statusCode || 0
    const account = ctx.account

    // De-register responses are best-effort — never flap the UI on their failure.
    if (deRegister) {
      if (code === 200) console.log(`[NativeSIP] Deregistered ${account.id}`)
      return
    }

    if (code === 0) {
      // Timeout
      console.error(`[NativeSIP] REGISTER timed out for ${account.id}`)
      ctx.registered = false
      this.emit('registrationFailed', account.id, 'Request Timeout')
      return
    }

    if (code === 401 || code === 407) {
      const authHdr = getHeader(resp, code === 401 ? 'WWW-Authenticate' : 'Proxy-Authenticate')
      if (!authHdr) {
        this.emit('registrationFailed', account.id, `Auth challenge without header (${code})`)
        return
      }
      const challenge = parseChallenge(authHdr)
      if (!challenge) {
        this.emit('registrationFailed', account.id, 'Unparseable auth challenge')
        return
      }
      const existing = ctx.auth.get(challenge.realm)
      const authCtx = contextFromChallenge(account.authUser || account.username, account.password, challenge, existing)
      ctx.auth.set(challenge.realm, authCtx)
      console.log(`[NativeSIP] Auth challenge (realm=${challenge.realm}, qop=${challenge.qop}, alg=${challenge.algorithm}) — retrying REGISTER with credentials`)
      // Retry with credentials (new branch, CSeq+1).
      this.sendRegister(ctx, deRegister)
      return
    }

    if (code === 200) {
      console.log(`[NativeSIP] Registration successful: ${account.username}@${account.domain}`)
      ctx.registered = true
      this.emit('registered', account.id)
      // OPTIONS keepalive every 60s.
      if (ctx.keepaliveTimer) clearTimeout(ctx.keepaliveTimer)
      ctx.keepaliveTimer = setInterval(() => this.sendOptions(ctx), 60000)
      // Schedule a re-REGISTER well before the server's Expires deadline.
      this.scheduleReRegister(ctx, resp)
      return
    }

    if (code >= 400) {
      console.error(`[NativeSIP] REGISTER failed: ${code} ${resp.reasonPhrase}`)
      ctx.registered = false
      this.emit('registrationFailed', account.id, `${code} ${resp.reasonPhrase || ''}`.trim())
      return
    }
  }

  // Re-register at half the negotiated expiry (clamped) so the registration
  // never silently lapses. Honours the server's Expires header if present.
  private scheduleReRegister(ctx: AccountContext, resp: SipMessage): void {
    if (ctx.reRegisterTimer) clearTimeout(ctx.reRegisterTimer)
    const account = ctx.account
    const expiresHdr = getHeader(resp, 'Expires')
    const expires = expiresHdr ? parseInt(expiresHdr, 10) : ((account as any).registrationExpiry ?? 600)
    // Re-register at ~half the expiry, clamped to [60s, 600s]. Fallback 300s.
    const delay = Math.min(600, Math.max(60, Math.floor((expires || 600) / 2))) * 1000
    ctx.reRegisterTimer = setTimeout(() => {
      if (ctx.disposed) return
      console.log(`[NativeSIP] Re-registering ${account.id} (expiry ${expires}s)`)
      this.sendRegister(ctx, false)
    }, delay)
  }

  private sendOptions(ctx: AccountContext): void {
    const account = ctx.account
    const branch = this.generateBranch()
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const targetUri = `sip:${account.domain}`
    const raw =
      `OPTIONS ${targetUri} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: <sip:${account.username}@${account.domain}>;tag=${ctx.registerTag}\r\n` +
      `To: <sip:${account.domain}>\r\n` +
      `Call-ID: ${this.generateCallId()}\r\n` +
      `CSeq: ${++ctx.registerCSeq} OPTIONS\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Accept: application/sdp\r\n` +
      `Content-Length: 0\r\n\r\n`
    ctx.txLayer.sendClientTransaction({
      branch, method: 'OPTIONS', raw,
      send: (r) => ctx.transport.send(r),
      isInvite: false,
      onFinal: (resp) => {
        if (ctx.disposed) return
        const c = resp.statusCode || 0
        if (c === 0 || c >= 400) {
          console.warn(`[NativeSIP] Keepalive OPTIONS failed (${c}) — marking unregistered`)
          ctx.registered = false
          this.emit('registrationFailed', account.id, `keepalive ${c}`)
        }
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Outbound instant message (RFC 3428)
  // ---------------------------------------------------------------------------

  async sendMessage(accountId: string, to: string, body: string): Promise<{ ok: boolean; code?: number; error?: string }> {
    const ctx = this.accounts.get(accountId)
    if (!ctx || !ctx.registered) return { ok: false, error: 'Account not registered' }
    const target = this.normalizeUri(to, ctx.account.domain)
    return new Promise((resolve) => this.sendMessageAttempt(ctx, target, body, false, resolve))
  }

  private sendMessageAttempt(
    ctx: AccountContext,
    target: string,
    body: string,
    isRetry: boolean,
    resolve: (r: { ok: boolean; code?: number; error?: string }) => void,
  ): void {
    const account = ctx.account
    const branch = this.generateBranch()
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const cseq = (this.messageCSeq.get(account.id) ?? 0) + 1
    this.messageCSeq.set(account.id, cseq)
    const bodyBytes = Buffer.byteLength(body, 'utf8')

    let raw =
      `MESSAGE ${target} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: <sip:${account.username}@${account.domain}>;tag=${this.generateTag()}\r\n` +
      `To: <${target}>\r\n` +
      `Call-ID: ${this.generateCallId()}\r\n` +
      `CSeq: ${cseq} MESSAGE\r\n` +
      `User-Agent: Zarsip/1.0\r\n`

    raw += this.authHeaderFromCache(ctx, 'MESSAGE', target)

    raw +=
      `Content-Type: text/plain; charset=UTF-8\r\n` +
      `Content-Length: ${bodyBytes}\r\n\r\n` +
      body

    ctx.txLayer.sendClientTransaction({
      branch, method: 'MESSAGE', raw,
      send: (r) => ctx.transport.send(r),
      isInvite: false,
      onFinal: (resp) => {
        const code = resp.statusCode || 0
        if ((code === 401 || code === 407) && !isRetry) {
          const authHdr = getHeader(resp, code === 401 ? 'WWW-Authenticate' : 'Proxy-Authenticate')
          const challenge = authHdr ? parseChallenge(authHdr) : null
          if (challenge) {
            const existing = ctx.auth.get(challenge.realm)
            const authCtx = contextFromChallenge(account.authUser || account.username, account.password, challenge, existing)
            ctx.auth.set(challenge.realm, authCtx)
            this.sendMessageAttempt(ctx, target, body, true, resolve)
            return
          }
        }
        if (code >= 200 && code < 300) resolve({ ok: true, code })
        else resolve({ ok: false, code, error: resp.reasonPhrase || `SIP ${code || 'timeout'}` })
      },
    })
  }

  // Build an Authorization header from the account's cached digest context, so a
  // MESSAGE can often skip the 401 round-trip (nonce reuse with incremented nc).
  private authHeaderFromCache(ctx: AccountContext, method: string, uri: string): string {
    const authCtx = ctx.auth.values().next().value as AuthContext | undefined
    if (!authCtx) return ''
    const challenge = {
      scheme: 'Digest',
      realm: authCtx.realm,
      nonce: authCtx.nonce,
      algorithm: authCtx.algorithm,
      qop: authCtx.qop ? [authCtx.qop] : undefined,
      opaque: authCtx.opaque,
      stale: false,
      params: {},
    }
    incrementNc(authCtx)
    return buildAuthorization({ method, uri, challenge, context: authCtx, isProxy: false })
  }

  // Normalize a user-entered target into a SIP URI.
  private normalizeUri(to: string, domain: string): string {
    const t = to.trim()
    if (t.startsWith('sip:') || t.startsWith('sips:')) return t
    if (t.includes('@')) return `sip:${t}`
    return `sip:${t}@${domain}`
  }

  // ---------------------------------------------------------------------------
  // Outbound call
  // ---------------------------------------------------------------------------

  async makeCall(accountId: string, targetNumber: string): Promise<string> {
    const ctx = this.accounts.get(accountId)
    if (!ctx || !ctx.registered) throw new Error('Account not registered')

    // Already in a call? Reject.
    if (this.activeCallByAccount.has(accountId)) {
      throw new Error('Already in a call')
    }

    const account = ctx.account
    const callId = `${this.generateCallId()}@${account.domain}`
    const localTag = ctx.localTag
    const localIp = ctx.transport.localAddress
    const fromHeader = `"${account.displayName || account.username}" <sip:${account.username}@${account.domain}>;tag=${localTag}`

    // Allocate the RTP socket now so the SDP port is real.
    const rtpSocket = new RtpSocket()
    const rtpPort = await rtpSocket.bind()
    const sessionId = crypto.randomInt(0, 0x7fffffff)
    const sdp = buildSdp({
      localIp, rtpPort, payloadType: '0', direction: 'sendrecv',
      telephoneEventPt: '101', sessionId, sessionVersion: 1,
    })

    const target = this.normalizeTarget(targetNumber)
    const requestUri = `sip:${target}@${account.domain}`

    const call: CallContext = {
      accountId, callId, localTag, fromHeader,
      inviteBranch: '', inviteCSeq: 1, authRetried: false,
      requestUri, sdp,
      rtpSocket, negotiated: undefined, rtp: undefined,
      state: 'calling', direction: 'caller', targetNumber: target,
      localSdpPort: rtpPort, sessionId,
    }
    this.calls.set(callId, call)
    this.activeCallByAccount.set(accountId, callId)

    this.sendInvite(call, ctx, false)
    this.emit('callState', 'connecting')
    return callId
  }

  // Build and send the INVITE (initial or auth-retry) via a new client transaction.
  private sendInvite(call: CallContext, ctx: AccountContext, withAuth: boolean): void {
    const account = ctx.account
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const branch = this.generateBranch()
    if (withAuth) {
      call.inviteCSeq += 1
    }
    call.inviteBranch = branch
    call.state = 'calling'

    let msg =
      `INVITE ${call.requestUri} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: ${call.fromHeader}\r\n` +
      `To: <sip:${call.targetNumber}@${account.domain}>\r\n` +
      `Call-ID: ${call.callId}\r\n` +
      `CSeq: ${call.inviteCSeq} INVITE\r\n` +
      `Contact: <sip:${account.username}@${localIp}:${localPort};transport=${account.transport.toLowerCase()}>\r\n` +
      `Content-Type: application/sdp\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Allow: INVITE,ACK,CANCEL,OPTIONS,BYE,REFER,INFO\r\n`

    // Attach Authorization if this is a digest-auth retry.
    if (withAuth) {
      const authHdr = this.buildAuthHeaderForCall(call, ctx, 'INVITE', call.requestUri)
      if (authHdr) msg += authHdr
    }

    msg += `Content-Length: ${Buffer.byteLength(call.sdp, 'latin1')}\r\n\r\n${call.sdp}`

    // SipMessage-like snapshot for dialog derivation (CSeq must match this INVITE).
    const inviteRequest: SipMessage = {
      kind: 'request', method: 'INVITE', requestUri: call.requestUri,
      headers: [
        { name: 'Call-ID', raw: 'Call-ID', value: call.callId },
        { name: 'From', raw: 'From', value: call.fromHeader },
        { name: 'CSeq', raw: 'CSeq', value: `${call.inviteCSeq} INVITE` },
      ],
      body: call.sdp, raw: msg,
    }

    const onProvisional = (resp: SipMessage) => {
      const code = resp.statusCode || 0
      if (code === 180 || code === 181 || code === 182) {
        call.state = 'proceeding'
        this.emit('callState', 'ringing')
      } else if (code === 183) {
        call.state = 'early'
        // 183 may carry early media SDP — try to set up RTP.
        this.maybeStartRtp(call, resp)
        this.emit('callState', 'ringing')
      }
    }
    const onFinal = (resp: SipMessage) => {
      const code = resp.statusCode || 0
      // Ignore retransmissions of the final response once we've handled it.
      if (call.state === 'confirmed' || call.state === 'terminated') {
        if (code >= 200 && code < 300) {
          // Re-ACK a retransmitted 200 OK (our ACK may have been lost).
          this.sendAck(call, ctx, resp)
        }
        return
      }
      if (code === 0) {
        this.endCall(call, 'failed')
        this.emit('callState', 'ended')
        return
      }
      // Digest-auth challenge on INVITE: ACK it (hop-by-hop) and retry with credentials.
      if ((code === 401 || code === 407) && !call.authRetried) {
        this.sendAckForNon2xx(call, ctx, resp)
        if (this.handleInviteAuthChallenge(ctx, resp)) {
          call.authRetried = true
          this.sendInvite(call, ctx, true)
          return
        }
        // No credentials available — fall through to reject.
      }
      if (code >= 200 && code < 300) {
        // 200 OK — establish dialog, send ACK, start media.
        call.dialog = dialogFromUac2xx(inviteRequest, resp)
        call.state = 'confirmed'
        this.sendAck(call, ctx, resp)
        this.maybeStartRtp(call, resp)
        this.emit('callState', 'active')
      } else if (code >= 300) {
        // Non-2xx final — send hop-by-hop ACK (same branch as INVITE).
        this.sendAckForNon2xx(call, ctx, resp)
        this.endCall(call, 'rejected')
        this.emit('callState', 'ended')
      }
    }

    ctx.txLayer.sendClientTransaction({
      branch, method: 'INVITE', raw: msg,
      send: (r) => ctx.transport.send(r),
      isInvite: true,
      onFinal, onProvisional,
    })
  }

  // Parse a 401/407 challenge on an INVITE, update the cached AuthContext
  // (refreshing the nonce if it changed), and return the Authorization header
  // value (or empty string if no credentials are available).
  private handleInviteAuthChallenge(ctx: AccountContext, resp: SipMessage): boolean {
    const account = ctx.account
    const authHdr = getHeader(resp, resp.statusCode === 401 ? 'WWW-Authenticate' : 'Proxy-Authenticate')
    if (!authHdr) return false
    const challenge = parseChallenge(authHdr)
    if (!challenge) return false
    const existing = ctx.auth.get(challenge.realm)
    const authCtx = contextFromChallenge(account.authUser || account.username, account.password, challenge, existing)
    ctx.auth.set(challenge.realm, authCtx)
    console.log(`[NativeSIP] INVITE auth challenge (realm=${challenge.realm}) — retrying with credentials`)
    return true
  }

  // Build the Authorization/Proxy-Authorization header for an in-dialog request.
  private buildAuthHeaderForCall(call: CallContext, ctx: AccountContext, method: string, uri: string): string {
    const authCtx = ctx.auth.values().next().value
    if (!authCtx) return ''
    const challenge = {
      scheme: 'Digest',
      realm: authCtx.realm,
      nonce: authCtx.nonce,
      algorithm: authCtx.algorithm,
      qop: authCtx.qop ? [authCtx.qop] : undefined,
      opaque: authCtx.opaque,
      stale: false,
      params: {},
    }
    incrementNc(authCtx)
    return buildAuthorization({ method, uri, challenge, context: authCtx, body: call.sdp, isProxy: false })
  }

  private normalizeTarget(targetNumber: string): string {
    let t = targetNumber.trim()
    // Strip a leading sip: scheme if present.
    if (t.toLowerCase().startsWith('sip:')) t = t.substring(4)
    // Strip @domain if user pasted a full URI.
    const at = t.indexOf('@')
    if (at !== -1) t = t.substring(0, at)
    return t
  }

  // ---------------------------------------------------------------------------
  // ACK
  // ---------------------------------------------------------------------------

  private sendAck(call: CallContext, ctx: AccountContext, resp: SipMessage): void {
    // ACK for 2xx is a new transaction (new branch), routed via dialog.
    const account = ctx.account
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const branch = this.generateBranch()
    const route = call.dialog?.routeSet?.length
      ? call.dialog.routeSet.map(r => `Route: ${r}\r\n`).join('')
      : ''
    const toHdr = getHeader(resp, 'To') || ''
    const raw =
      `ACK ${call.dialog?.remoteTargetUri || `sip:${call.targetNumber}@${account.domain}`} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: ${call.fromHeader}\r\n` +
      `To: ${toHdr}\r\n` +
      `Call-ID: ${call.callId}\r\n` +
      `CSeq: ${call.inviteCSeq} ACK\r\n` +
      `${route}` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: 0\r\n\r\n`
    ctx.transport.send(raw)
  }

  private sendAckForNon2xx(call: CallContext, ctx: AccountContext, resp: SipMessage): void {
    // ACK for non-2xx reuses the INVITE branch (hop-by-hop).
    const account = ctx.account
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const toHdr = getHeader(resp, 'To') || ''
    const raw =
      `ACK ${`sip:${call.targetNumber}@${account.domain}`} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${call.inviteBranch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: ${call.fromHeader}\r\n` +
      `To: ${toHdr}\r\n` +
      `Call-ID: ${call.callId}\r\n` +
      `CSeq: ${call.inviteCSeq} ACK\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: 0\r\n\r\n`
    ctx.transport.send(raw)
  }

  // ---------------------------------------------------------------------------
  // Hangup (CANCEL if early, BYE if confirmed)
  // ---------------------------------------------------------------------------

  async hangup(accountId: string): Promise<void> {
    const ctx = this.accounts.get(accountId)
    const callId = this.activeCallByAccount.get(accountId)
    if (!ctx || !callId) return
    const call = this.calls.get(callId)
    if (!call) return

    if (call.state === 'calling' || call.state === 'proceeding' || call.state === 'early') {
      this.sendCancel(call, ctx)
    } else if (call.state === 'confirmed') {
      this.sendBye(call, ctx)
    }
    this.endCall(call, 'hungup')
    this.emit('callState', 'ended')
  }

  private sendCancel(call: CallContext, ctx: AccountContext): void {
    const account = ctx.account
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const branch = this.generateBranch()
    const requestUri = `sip:${call.targetNumber}@${account.domain}`
    const raw =
      `CANCEL ${requestUri} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: <sip:${account.username}@${account.domain}>;tag=${call.localTag}\r\n` +
      `To: <sip:${call.targetNumber}@${account.domain}>\r\n` +
      `Call-ID: ${call.callId}\r\n` +
      `CSeq: ${call.inviteCSeq} CANCEL\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: 0\r\n\r\n`
    ctx.txLayer.sendClientTransaction({
      branch, method: 'CANCEL', raw,
      send: (r) => ctx.transport.send(r),
      isInvite: false,
      onFinal: () => { /* expect 200 OK to CANCEL */ },
    })
    // Destroy the original INVITE transaction.
    ctx.txLayer.destroyClientTransaction(call.inviteBranch)
  }

  private sendBye(call: CallContext, ctx: AccountContext): void {
    if (!call.dialog) return
    const account = ctx.account
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const cseq = nextCSeq(call.dialog)
    const branch = this.generateBranch()
    const route = call.dialog.routeSet.length
      ? call.dialog.routeSet.map(r => `Route: ${r}\r\n`).join('')
      : ''
    const toTag = call.dialog.remoteTag ? `;tag=${call.dialog.remoteTag}` : ''
    const raw =
      `BYE ${call.dialog.remoteTargetUri} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: ${call.fromHeader}\r\n` +
      `To: <sip:${call.targetNumber}@${account.domain}>${toTag}\r\n` +
      `Call-ID: ${call.callId}\r\n` +
      `CSeq: ${cseq} BYE\r\n` +
      `${route}` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: 0\r\n\r\n`
    ctx.txLayer.sendClientTransaction({
      branch, method: 'BYE', raw,
      send: (r) => ctx.transport.send(r),
      isInvite: false,
      onFinal: () => {},
    })
  }

  // ---------------------------------------------------------------------------
  // Inbound call handling (simplified IST)
  // ---------------------------------------------------------------------------

  async answer(accountId: string, callId: string): Promise<void> {
    const ctx = this.accounts.get(accountId)
    const call = this.calls.get(callId)
    if (!ctx || !call) return
    // Build answer SDP, allocate RTP, send 200 OK.
    const rtpSocket = new RtpSocket()
    const rtpPort = await rtpSocket.bind()
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const account = ctx.account
    const sdp = buildSdp({
      localIp, rtpPort, payloadType: call.negotiated?.payloadType || '0',
      direction: 'sendrecv', telephoneEventPt: call.negotiated?.telephoneEventPt || '101',
      sessionId: call.sessionId || crypto.randomInt(0, 0x7fffffff), sessionVersion: 2,
    })
    call.rtpSocket = rtpSocket
    call.localSdpPort = rtpPort

    const toHdr = call.dialog ? `<sip:${account.username}@${localIp}:${localPort}>;tag=${call.localTag}` : ''
    const route = call.dialog?.routeSet?.length
      ? call.dialog.routeSet.map(r => `Route: ${r}\r\n`).join('')
      : ''
    const raw =
      `SIP/2.0 200 OK\r\n` +
      `Via: ${getHeader(callInviteSnapshot(call), 'Via') || ''}\r\n` +
      `From: ${getHeader(callInviteSnapshot(call), 'From') || ''}\r\n` +
      `To: ${toHdr}\r\n` +
      `Call-ID: ${call.callId}\r\n` +
      `CSeq: ${call.dialog?.remoteCSeq || 1} INVITE\r\n` +
      `Contact: <sip:${account.username}@${localIp}:${localPort};transport=${account.transport.toLowerCase()}>\r\n` +
      `${route}` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Type: application/sdp\r\n` +
      `Content-Length: ${Buffer.byteLength(sdp, 'latin1')}\r\n\r\n${sdp}`
    ctx.transport.send(raw)
    // Remember for retransmit on dup INVITE.
    ctx.txLayer.rememberServerResponse(call.inviteBranch, 'INVITE', raw, true)

    // Start RTP using the negotiated remote endpoint from the offer.
    this.startRtpFromNegotiated(call)
    call.state = 'confirmed'
    this.emit('callState', 'active')
  }

  async reject(accountId: string, callId: string): Promise<void> {
    const ctx = this.accounts.get(accountId)
    const call = this.calls.get(callId)
    if (!ctx || !call) return
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const raw =
      `SIP/2.0 486 Busy Here\r\n` +
      `Via: ${getHeader(callInviteSnapshot(call), 'Via') || ''}\r\n` +
      `From: ${getHeader(callInviteSnapshot(call), 'From') || ''}\r\n` +
      `To: <sip:${ctx.account.username}@${localIp}:${localPort}>;tag=${call.localTag}\r\n` +
      `Call-ID: ${call.callId}\r\n` +
      `CSeq: ${call.dialog?.remoteCSeq || 1} INVITE\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: 0\r\n\r\n`
    ctx.transport.send(raw)
    ctx.txLayer.rememberServerResponse(call.inviteBranch, 'INVITE', raw, false)
    this.endCall(call, 'rejected')
    this.emit('callState', 'ended')
  }

  // ---------------------------------------------------------------------------
  // Hold / Unhold / DTMF / Mute
  // ---------------------------------------------------------------------------

  async hold(accountId: string): Promise<void> {
    await this.reinvite(accountId, 'sendonly')
  }
  async unhold(accountId: string): Promise<void> {
    await this.reinvite(accountId, 'sendrecv')
  }

  private async reinvite(accountId: string, direction: 'sendrecv' | 'sendonly'): Promise<void> {
    const ctx = this.accounts.get(accountId)
    const callId = this.activeCallByAccount.get(accountId)
    if (!ctx || !callId) return
    const call = this.calls.get(callId)
    if (!call || !call.dialog) return
    const account = ctx.account
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const cseq = nextCSeq(call.dialog)
    const branch = this.generateBranch()
    const rtpPort = call.localSdpPort || 0
    const sdp = buildSdp({
      localIp, rtpPort, payloadType: call.negotiated?.payloadType || '0',
      direction, telephoneEventPt: call.negotiated?.telephoneEventPt || '101',
      sessionId: call.sessionId || 1, sessionVersion: (call.sessionId ? 3 : 2),
    })
    const route = call.dialog.routeSet.map(r => `Route: ${r}\r\n`).join('')
    const toTag = call.dialog.remoteTag ? `;tag=${call.dialog.remoteTag}` : ''
    const raw =
      `INVITE ${call.dialog.remoteTargetUri} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch};rport\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: ${call.fromHeader}\r\n` +
      `To: <sip:${call.targetNumber}@${account.domain}>${toTag}\r\n` +
      `Call-ID: ${call.callId}\r\n` +
      `CSeq: ${cseq} INVITE\r\n` +
      `Contact: <sip:${account.username}@${localIp}:${localPort};transport=${account.transport.toLowerCase()}>\r\n` +
      `${route}` +
      `Content-Type: application/sdp\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: ${Buffer.byteLength(sdp, 'latin1')}\r\n\r\n${sdp}`
    ctx.txLayer.sendClientTransaction({
      branch, method: 'INVITE', raw,
      send: (r) => ctx.transport.send(r),
      isInvite: true,
      onFinal: (resp) => {
        const code = resp.statusCode || 0
        if (code >= 200 && code < 300) {
          this.sendAck(call, ctx, resp)
          // Update negotiated direction.
          if (call.negotiated) call.negotiated.direction = direction
        }
      },
    })
  }

  sendDTMF(accountId: string, digit: string): void {
    const callId = this.activeCallByAccount.get(accountId)
    const call = callId ? this.calls.get(callId) : undefined
    if (!call || !call.rtp) return
    call.rtp.sendTelephoneEvent(digit)
  }

  mute(accountId: string, muted: boolean): void {
    const callId = this.activeCallByAccount.get(accountId)
    const call = callId ? this.calls.get(callId) : undefined
    if (!call || !call.rtp) return
    call.rtp.setMuted(muted)
  }

  // ---------------------------------------------------------------------------
  // Incoming message dispatch
  // ---------------------------------------------------------------------------

  private handleIncoming(raw: string, accountId: string, rinfo: { address: string; port: number }): void {
    const ctx = this.accounts.get(accountId)
    if (!ctx) return
    const firstLine = raw.split('\r\n', 1)[0]
    console.log(`[NativeSIP] <- ${rinfo.address}:${rinfo.port} ${firstLine}`)
    const msg = parseMessage(raw)
    if (!msg) return

    if (msg.kind === 'response') {
      const handled = ctx.txLayer.receiveResponse(msg)
      if (!handled) {
        // Could be a retransmitted 2xx to INVITE after the ICT was cleaned up.
        this.handleOrphanResponse(ctx, msg)
      }
      return
    }

    if (msg.kind === 'request') {
      this.handleIncomingRequest(ctx, msg)
    }
  }

  private handleOrphanResponse(ctx: AccountContext, resp: SipMessage): void {
    // A retransmitted 200 OK to INVITE — re-ACK to keep the server happy.
    const code = resp.statusCode || 0
    if (code === 200) {
      const cseqHdr = getHeader(resp, 'CSeq') || ''
      if (cseqHdr.includes('INVITE')) {
        // Find the call by Call-ID.
        const callId = getHeader(resp, 'Call-ID')
        const call = callId ? this.calls.get(callId) : undefined
        if (call && call.dialog) {
          this.sendAck(call, ctx, resp)
        }
      }
    }
  }

  private handleIncomingRequest(ctx: AccountContext, msg: SipMessage): void {
    const method = msg.method || ''
    const branch = getParam(msg, 'Via', 'branch') || ''
    const account = ctx.account

    // Dedup retransmissions.
    if (ctx.txLayer.seenServerBranch(branch)) {
      const cached = ctx.txLayer.getServerResponse(branch)
      if (cached) ctx.transport.send(cached)
      return
    }

    if (method === 'INVITE') {
      const toHdr = getHeader(msg, 'To') || ''
      const toHasTag = /tag=\S+/.test(toHdr)
      const callIdHdr = getHeader(msg, 'Call-ID') || ''
      const existingCall = callIdHdr ? this.calls.get(callIdHdr) : undefined
      if (toHasTag) {
        // In-dialog re-INVITE (session-timer refresh, RTP latch, hold/unhold).
        // Reply 200 OK preserving our current media parameters — never treat it
        // as a fresh incoming call, which would corrupt active-call state and
        // pop a spurious "incoming call" banner mid-conversation.
        if (existingCall) {
          this.handleReInvite(ctx, msg, existingCall, branch)
        } else {
          const resp = this.buildSimpleResponse(msg, 481, 'Call/Transaction Does Not Exist', ctx)
          ctx.transport.send(resp)
          ctx.txLayer.rememberServerResponse(branch, 'INVITE', resp, false)
        }
        return
      }

      const callId = callIdHdr || this.generateCallId()
      const fromHdr = getHeader(msg, 'From') || ''
      const remoteNumber = this.extractNumber(fromHdr)
      const localTag = this.generateTag()
      const dialog = dialogFromUasInvite(msg, localTag)
      const offer = msg.body ? parseSdp(msg.body) : null
      const negotiated = offer ? negotiate(offer) : undefined
      // For inbound calls, our From (sent on any in-dialog request we originate,
      // e.g. BYE) is our own identity with our local tag.
      const fromHeader = `<sip:${account.username}@${account.domain}>;tag=${localTag}`

      const call: CallContext = {
        accountId: account.id, callId, localTag, inviteBranch: branch, fromHeader,
        inviteCSeq: 0, authRetried: false,
        requestUri: '', sdp: '',
        dialog, negotiated: negotiated ?? undefined,
        state: 'early', direction: 'callee',
        targetNumber: remoteNumber,
        sessionId: crypto.randomInt(0, 0x7fffffff),
      }
      // Stash the original request for answer/reject to read Via/From.
      callInviteStore.set(callId, msg)
      this.calls.set(callId, call)
      this.activeCallByAccount.set(account.id, callId)

      // Send 100 Trying immediately.
      const trying = this.buildSimpleResponse(msg, 100, 'Trying', ctx)
      ctx.transport.send(trying)

      // Send 180 Ringing.
      const ringing = this.buildSimpleResponse(msg, 180, 'Ringing', ctx)
      ctx.transport.send(ringing)
      ctx.txLayer.rememberServerResponse(branch, 'INVITE', ringing, false)

      this.emit('incomingCall', account.id, remoteNumber, callId)
      return
    }

    if (method === 'BYE') {
      const resp = this.buildSimpleResponse(msg, 200, 'OK', ctx)
      ctx.transport.send(resp)
      ctx.txLayer.rememberServerResponse(branch, 'BYE', resp, false)
      const callId = getHeader(msg, 'Call-ID') || ''
      const call = callId ? this.calls.get(callId) : undefined
      if (call) {
        this.endCall(call, 'remote-bye')
        this.emit('callState', 'ended')
      }
      return
    }

    if (method === 'CANCEL') {
      const resp = this.buildSimpleResponse(msg, 200, 'OK', ctx)
      ctx.transport.send(resp)
      // Find the early call by Call-ID and respond 487 to the INVITE.
      const callId = getHeader(msg, 'Call-ID') || ''
      const call = callId ? this.calls.get(callId) : undefined
      if (call && call.state === 'early') {
        const inviteMsg = callInviteStore.get(callId)
        if (inviteMsg) {
          const resp487 = this.buildSimpleResponse(inviteMsg, 487, 'Request Terminated', ctx)
          ctx.transport.send(resp487)
          ctx.txLayer.rememberServerResponse(call.inviteBranch, 'INVITE', resp487, false)
        }
        this.endCall(call, 'cancelled')
        this.emit('callState', 'ended')
      }
      return
    }

    if (method === 'ACK') {
      // Absorb; nothing to do for now.
      return
    }

    if (method === 'OPTIONS') {
      const resp = this.buildSimpleResponse(msg, 200, 'OK', ctx)
      ctx.transport.send(resp)
      return
    }

    if (method === 'MESSAGE') {
      // RFC 3428 — instant message. Acknowledge, then surface text bodies.
      const resp = this.buildSimpleResponse(msg, 200, 'OK', ctx)
      ctx.transport.send(resp)
      ctx.txLayer.rememberServerResponse(branch, 'MESSAGE', resp, false)

      const contentType = getHeader(msg, 'Content-Type') || 'text/plain'
      const body = msg.body || ''
      // Ignore non-text payloads (e.g. application/im-iscomposing+xml typing hints).
      if (/text\/(plain|html)/i.test(contentType) && body.trim()) {
        const from = this.extractNumber(getHeader(msg, 'From') || '')
        this.emit('incomingMessage', account.id, from, body)
      }
      return
    }
  }

  // Respond to an in-dialog re-INVITE: keep using the existing RTP socket
  // and session parameters, possibly update the remote RTP endpoint from
  // the carrier-supplied SDP, and emit 200 OK with our current SDP. RFC 3261
  // §14 — never allocate a fresh Call-ID/dialog for an in-dialog re-INVITE.
  private handleReInvite(ctx: AccountContext, msg: SipMessage, call: CallContext, branch: string): void {
    const account = ctx.account
    const localIp = ctx.transport.localAddress
    const localPort = ctx.transport.localPort
    const rtpPort = call.localSdpPort || 0

    // Take the offer if any and refresh our negotiated parameters.
    if (msg.body) {
      const offer = parseSdp(msg.body)
      const neg = offer ? negotiate(offer) : undefined
      if (neg) {
        // Update remote RTP endpoint symmetrically if the carrier moved it.
        if (call.rtp && (neg.remoteRtpIp !== call.rtp.remoteAddr || neg.remoteRtpPort !== call.rtp.remotePort)) {
          call.rtp.setRemote(neg.remoteRtpIp, neg.remoteRtpPort)
        }
        call.negotiated = neg
      }
    }

    const sdp = buildSdp({
      localIp, rtpPort,
      payloadType: call.negotiated?.payloadType || '0',
      direction: 'sendrecv',
      telephoneEventPt: call.negotiated?.telephoneEventPt || '101',
      sessionId: call.sessionId || 1, sessionVersion: 3,
    })

    const via = getHeaders(msg, 'Via').map(h => `Via: ${h.value}\r\n`).join('')
    const fromHdr = getHeader(msg, 'From') || ''
    const toHdr = getHeader(msg, 'To') || ''
    const callId = getHeader(msg, 'Call-ID') || ''
    const cseq = getHeader(msg, 'CSeq') || ''
    const route = call.dialog?.routeSet?.length
      ? call.dialog.routeSet.map(r => `Route: ${r}\r\n`).join('')
      : ''

    const raw =
      `SIP/2.0 200 OK\r\n` +
      via +
      `From: ${fromHdr}\r\n` +
      `To: ${toHdr}\r\n` +
      `Call-ID: ${callId}\r\n` +
      `CSeq: ${cseq}\r\n` +
      `Contact: <sip:${account.username}@${localIp}:${localPort};transport=${account.transport.toLowerCase()}>\r\n` +
      `${route}` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Type: application/sdp\r\n` +
      `Content-Length: ${Buffer.byteLength(sdp, 'latin1')}\r\n\r\n${sdp}`
    ctx.transport.send(raw)
    ctx.txLayer.rememberServerResponse(branch, 'INVITE', raw, true)
  }

  private buildSimpleResponse(req: SipMessage, code: number, reason: string, ctx: AccountContext): string {
    const via = getHeaders(req, 'Via').map(h => `Via: ${h.value}\r\n`).join('')
    const from = getHeader(req, 'From')
    const toHdr = getHeader(req, 'To') || ''
    const toValue = toHdr.includes('tag=') ? toHdr : `${toHdr};tag=${ctx.localTag}`
    const callId = getHeader(req, 'Call-ID') || ''
    const cseq = getHeader(req, 'CSeq') || ''
    return (
      `SIP/2.0 ${code} ${reason}\r\n` +
      via +
      `From: ${from}\r\n` +
      `To: ${toValue}\r\n` +
      `Call-ID: ${callId}\r\n` +
      `CSeq: ${cseq}\r\n` +
      (code === 200 && (req.method === 'OPTIONS' || req.method === 'BYE' || req.method === 'CANCEL') ? `User-Agent: Zarsip/1.0\r\n` : '') +
      `Content-Length: 0\r\n\r\n`
    )
  }

  // ---------------------------------------------------------------------------
  // RTP setup
  // ---------------------------------------------------------------------------

  private maybeStartRtp(call: CallContext, resp: SipMessage): void {
    if (!resp.body) {
      console.warn('[NativeSIP] 2xx/183 has empty body — no SDP answer to negotiate RTP')
      return
    }
    const sdp = parseSdp(resp.body)
    console.log(`[NativeSIP] Remote SDP answer:\n${resp.body}`)
    const neg = negotiate(sdp)
    if (!neg) {
      console.warn('[NativeSIP] No negotiable audio in SDP answer')
      return
    }
    call.negotiated = neg
    this.startRtpFromNegotiated(call)
  }

  private startRtpFromNegotiated(call: CallContext): void {
    if (!call.negotiated || !call.rtpSocket) return
    const neg = call.negotiated
    if (!neg.remoteRtpIp || !neg.remoteRtpPort) {
      console.warn('[NativeSIP] SDP answer missing remote RTP endpoint')
      return
    }
    // 0.0.0.0 means the remote is holding / not yet ready to receive media.
    // Many carriers send c=IN IP4 0.0.0.0 in 183/200 when the callee hasn't
    // actually answered — sending RTP there is a black hole.
    if (neg.remoteRtpIp === '0.0.0.0') {
      console.warn(`[NativeSIP] Remote RTP IP is 0.0.0.0 (hold/early-media placeholder) — RTP will not be sent until carrier provides a real endpoint`)
    } else {
      console.log(`[NativeSIP] RTP -> ${neg.remoteRtpIp}:${neg.remoteRtpPort} (codec=${neg.codec} pt=${neg.payloadType})`)
    }
    // If early-media RTP was already started (183), tear it down before
    // re-binding on the 200 OK to avoid orphaned sessions/timers.
    if (call.rtp) {
      this.stopPlayoutPump(call.callId)
      call.rtp.close()
      call.rtp = undefined
    }
    const session = new RtpSession(call.rtpSocket, neg.remoteRtpIp, neg.remoteRtpPort, {
      payloadType: parseInt(neg.payloadType, 10) || 0,
      telephoneEventPt: neg.telephoneEventPt ? parseInt(neg.telephoneEventPt, 10) : 101,
      onIncomingRtp: () => this.onRemoteRtpReceived(),
    })
    call.rtp = session
    // Proactively pump 20ms frames to the renderer for playout.
    this.startPlayoutPump(call)
  }

  private playoutTimers: Map<string, NodeJS.Timeout> = new Map()
  private startPlayoutPump(call: CallContext): void {
    // Pump 20ms frames to the renderer so it can play them.
    const timer = setInterval(() => {
      if (!call.rtp) return
      const frame = call.rtp.nextFrame()
      this.sendRemoteFrame(frame)
    }, 20)
    this.playoutTimers.set(call.callId, timer)
  }

  private stopPlayoutPump(callId: string): void {
    const t = this.playoutTimers.get(callId)
    if (t) { clearInterval(t); this.playoutTimers.delete(callId) }
  }

  // ---------------------------------------------------------------------------
  // Call teardown
  // ---------------------------------------------------------------------------

  private endCall(call: CallContext, _reason: string): void {
    this.stopPlayoutPump(call.callId)
    if (call.rtp) { call.rtp.close(); call.rtp = undefined }
    if (call.rtpSocket) { call.rtpSocket.close(); call.rtpSocket = undefined }
    call.state = 'terminated'
    this.calls.delete(call.callId)
    this.activeCallByAccount.delete(call.accountId)
    callInviteStore.delete(call.callId)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractNumber(fromUri: string): string {
    const m = fromUri.match(/sip:([^@]+)@/) || fromUri.match(/sips:([^@]+)@/)
    return m ? m[1] : 'Unknown'
  }

  private generateCallId(): string {
    return crypto.randomBytes(12).toString('hex')
  }
  private generateTag(): string {
    return crypto.randomBytes(8).toString('hex')
  }
  private generateBranch(): string {
    return 'z9hG4bK-' + crypto.randomBytes(12).toString('hex')
  }

  cleanup(): void {
    for (const [, ctx] of this.accounts) {
      if (ctx.keepaliveTimer) clearTimeout(ctx.keepaliveTimer)
      ctx.transport.close()
    }
    for (const [, call] of this.calls) {
      this.endCall(call, 'shutdown')
    }
    this.accounts.clear()
  }
}

// Inbound INVITE request store — keeps the original message so answer/reject
// can read Via/From/CSeq/Contact without the facade having to thread it through.
const callInviteStore: Map<string, SipMessage> = new Map()
function callInviteSnapshot(call: CallContext): SipMessage {
  return callInviteStore.get(call.callId) || { kind: 'request', method: 'INVITE', headers: [], body: '', raw: '' }
}

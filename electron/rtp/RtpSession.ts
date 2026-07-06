// RTP session: packetizes outgoing PCMU from mic PCM frames and depacketizes
// inbound PCMU to remote PCM frames, with a tiny jitter buffer and symmetric-RTP.

import { EventEmitter } from 'events'
import * as crypto from 'crypto'
import { RtpSocket } from './RtpSocket'
import { pcmToUlaw, ulawToPcm } from './pcmu'

const PT_TELEPHONE_EVENT = 101
const SAMPLES_PER_FRAME = 160 // 20ms @ 8kHz

export interface RtpSessionOptions {
  payloadType: number
  telephoneEventPt?: number
  ssrc?: number
  onIncomingRtp?: () => void
}

export class RtpSession extends EventEmitter {
  private socket: RtpSocket
  private _remoteAddr: string
  private _remotePort: number
  private ssrc: number
  private seq: number
  private timestamp: number
  private payloadType: number
  private telephoneEventPt: number
  private muted = false
  private symmetricLocked = false
  private keepaliveTimer: NodeJS.Timeout | null = null
  private lastMicFrameAt = 0
  private onIncomingRtp?: () => void

  // Jitter buffer: a small ring keyed by sequence. v1 = 4 slots, silence on underrun.
  private jitterBuf: Map<number, Int16Array> = new Map()
  private nextPlaySeq: number | null = null
  private lastRtpSeq: number | null = null

  constructor(socket: RtpSocket, remoteAddr: string, remotePort: number, opts: RtpSessionOptions) {
    super()
    this.socket = socket
    this._remoteAddr = remoteAddr
    this._remotePort = remotePort
    this.ssrc = opts.ssrc ?? crypto.randomInt(0, 0xffffffff)
    this.seq = crypto.randomInt(0, 0xffff)
    this.timestamp = crypto.randomInt(0, 0xffffffff)
    this.payloadType = opts.payloadType
    this.telephoneEventPt = opts.telephoneEventPt ?? PT_TELEPHONE_EVENT
    this.onIncomingRtp = opts.onIncomingRtp

    this.socket.on('message', (buf: Buffer, rinfo: { address: string; port: number }) => {
      this.handleIncoming(buf, rinfo)
    })

    // Auto-pump silence RTP so the NAT pinhole stays open and carrier
    // RTP-activity guards stay satisfied before the mic bridge delivers the
    // first frame (typically 1–3 s after call setup) and during local mute.
    // Many SIP trunks tear the call down within ~5–10 s of zero RTP.
    this.lastMicFrameAt = Date.now()
    this.keepaliveTimer = setInterval(() => this.sendKeepaliveIfIdle(), 20)
  }

  get localPort(): number { return this.socket.port }
  get remoteAddr(): string { return this._remoteAddr }
  get remotePort(): number { return this._remotePort }

  // Send a frame of 160 16-bit PCM samples (mono, 8kHz).
  sendFrame(pcm: Int16Array): void {
    if (this.muted) return
    this.lastMicFrameAt = Date.now()
    if (pcm.length !== SAMPLES_PER_FRAME) {
      // Pad/truncate to 160.
      const fixed = new Int16Array(SAMPLES_PER_FRAME)
      const n = Math.min(SAMPLES_PER_FRAME, pcm.length)
      fixed.set(pcm.subarray(0, n))
      pcm = fixed
    }
    const payload = pcmToUlaw(pcm)
    const packet = this.buildRtpPacket(this.payloadType, payload, false)
    this.socket.send(packet, this._remotePort, this._remoteAddr)
    this.seq = (this.seq + 1) & 0xffff
    this.timestamp = (this.timestamp + SAMPLES_PER_FRAME) >>> 0
  }

  // Send RFC 4733 telephone-event digits.
  sendTelephoneEvent(digit: string): void {
    const eventCode = dtmfEventCode(digit)
    if (eventCode < 0) return
    // Three packets: two with volume, end bit on the last.
    const baseTs = this.timestamp
    const baseSeq = this.seq
    const durations = [SAMPLES_PER_FRAME, SAMPLES_PER_FRAME * 2, SAMPLES_PER_FRAME * 3]
    for (let i = 0; i < durations.length; i++) {
      const dur = durations[i]
      const isEnd = i === durations.length - 1
      const payload = Buffer.alloc(4)
      payload.writeUInt8(eventCode, 0)
      payload.writeUInt8((isEnd ? 0x80 : 0x00) | 0x0a, 1) // end bit + volume 10
      payload.writeUInt16BE(dur, 2)
      const packet = this.buildRtpPacket(this.telephoneEventPt, payload, i === 0, baseSeq + i, baseTs)
      this.socket.send(packet, this._remotePort, this._remoteAddr)
    }
    // Advance our seq/timestamp by the event duration.
    this.seq = (baseSeq + 3) & 0xffff
    this.timestamp = (baseTs + SAMPLES_PER_FRAME * 3) >>> 0
  }

  private buildRtpPacket(pt: number, payload: Buffer, marker: boolean, seqOverride?: number, tsOverride?: number): Buffer {
    const header = Buffer.alloc(12)
    header[0] = 0x80 // V=2, P=0, X=0, CC=0
    header[1] = (marker ? 0x80 : 0x00) | (pt & 0x7f)
    header.writeUInt16BE(seqOverride ?? this.seq, 2)
    header.writeUInt32BE(tsOverride ?? this.timestamp, 4)
    header.writeUInt32BE(this.ssrc >>> 0, 8)
    return Buffer.concat([header, payload])
  }

  private handleIncoming(buf: Buffer, rinfo: { address: string; port: number }): void {
    // Symmetric RTP: lock to the source of the first packet (NAT pinhole).
    if (!this.symmetricLocked) {
      this._remoteAddr = rinfo.address
      this._remotePort = rinfo.port
      this.symmetricLocked = true
    }
    if (buf.length < 12) return
    const v = (buf[0] >> 6) & 0x03
    if (v !== 2) return
    const pt = buf[1] & 0x7f
    const seq = buf.readUInt16BE(2)
    const payload = buf.subarray(12)

    if (pt === this.telephoneEventPt) {
      // Telephone event — emit for potential UI; ignore for audio.
      return
    }
    if (pt !== this.payloadType) return

    this.onIncomingRtp?.()
    const pcm = ulawToPcm(payload)
    this.jitterBuf.set(seq, pcm)
    if (this.lastRtpSeq === null) {
      this.lastRtpSeq = seq
      this.nextPlaySeq = seq
    } else {
      this.lastRtpSeq = seq
    }
    this.drain()
  }

  // Drain playable frames in order. Called on each new packet; the renderer's
  // 20ms playout clock also pulls via nextFrame().
  private drain(): void {
    if (this.nextPlaySeq === null) return
    // Keep the buffer bounded — drop frames older than expected-2.
    const expected = this.nextPlaySeq
    for (const k of this.jitterBuf.keys()) {
      // 16-bit wrap-aware: drop if too old.
      if (seqDelta(k, expected) < -4) this.jitterBuf.delete(k)
    }
  }

  // Renderer playout pulls one 160-sample frame every 20ms.
  nextFrame(): Int16Array {
    if (this.nextPlaySeq === null) {
      return new Int16Array(SAMPLES_PER_FRAME) // silence before first packet
    }
    const frame = this.jitterBuf.get(this.nextPlaySeq)
    if (frame) {
      this.jitterBuf.delete(this.nextPlaySeq)
      this.nextPlaySeq = (this.nextPlaySeq + 1) & 0xffff
      return frame
    }
    // Underrun — emit silence (no PLC in v1).
    this.nextPlaySeq = (this.nextPlaySeq + 1) & 0xffff
    return new Int16Array(SAMPLES_PER_FRAME)
  }

  setMuted(muted: boolean): void { this.muted = muted }

  // Send a 20 ms silence frame if the mic hasn't produced a frame recently.
  // Uses the codec-appropriate "no signal" codeword (0xFF for PCMU, 0x55 for PCMA).
  // Fires even when muted — the remote hears silence and the carrier still sees
  // RTP, so it cannot time the call out from inactivity.
  private sendKeepaliveIfIdle(): void {
    if (Date.now() - this.lastMicFrameAt < 60) return
    const fillByte = this.payloadType === 8 ? 0x55 : 0xff
    const payload = Buffer.alloc(SAMPLES_PER_FRAME, fillByte)
    const packet = this.buildRtpPacket(this.payloadType, payload, false)
    this.socket.send(packet, this._remotePort, this._remoteAddr)
    this.seq = (this.seq + 1) & 0xffff
    this.timestamp = (this.timestamp + SAMPLES_PER_FRAME) >>> 0
  }

  setRemote(addr: string, port: number): void {
    this._remoteAddr = addr
    this._remotePort = port
    this.symmetricLocked = false
  }

  close(): void {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null }
    this.socket.close()
    this.jitterBuf.clear()
    this.removeAllListeners()
  }
}

function dtmfEventCode(d: string): number {
  const map: Record<string, number> = { '0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'*':10,'#':11,'A':12,'B':13,'C':14,'D':15 }
  return map[d] ?? -1
}

// Signed delta accounting for 16-bit wraparound.
function seqDelta(a: number, b: number): number {
  let d = (a - b) & 0xffff
  if (d > 0x7fff) d -= 0x10000
  return d
}

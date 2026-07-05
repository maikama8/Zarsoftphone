// Audio bridge for native UDP calls: captures mic via getUserMedia + AudioWorklet
// at 8kHz mono, ships 160-sample (20ms) Int16 frames to the main process for
// RTP packetization, and plays back remote RTP frames (Int16) via a playout
// worklet. The 8kHz AudioContext avoids resampling; if 8kHz is refused we fall
// back to a 48kHz context and let Chromium's resampler handle it (worklets
// still emit/consume 160-sample frames at the context rate — for 48k that's
// ~3.33ms per frame, so we resample in the worklet to 8k by decimating 6:1).

const MIC_WORKLET_SRC = `
class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.accum = new Float32Array(0) // accumulated downsampled 8k samples
    this.leftover = new Float32Array(0)
    this.lastSample = 0
  }
  // Downsample from context rate to 8kHz by 6:1 (48k->8k) with a one-pole low-pass.
  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0] || input[0].length === 0) return true
    const inRate = sampleRate
    const outRate = 8000
    // Combine current quantum with leftover.
    const src = new Float32Array(this.leftover.length + input[0].length)
    src.set(this.leftover, 0)
    src.set(input[0], this.leftover.length)

    const ratio = inRate / outRate
    const out: number[] = []
    let pos = 0
    // Simple linear resampling — adequate for G.711 voice.
    while (pos + ratio <= src.length) {
      const idx = Math.floor(pos)
      const frac = pos - idx
      const s = src[idx] * (1 - frac) + (src[idx + 1] || src[idx]) * frac
      out.push(s)
      pos += ratio
    }
    this.leftover = src.subarray(Math.floor(pos))

    // Append to accumulator.
    const merged = new Float32Array(this.accum.length + out.length)
    merged.set(this.accum, 0)
    merged.set(out, this.accum.length)

    // Emit 160-sample frames.
    let offset = 0
    while (offset + 160 <= merged.length) {
      const frame = new Int16Array(160)
      for (let i = 0; i < 160; i++) {
        let s = merged[offset + i]
        // Clamp and convert to 16-bit PCM.
        s = Math.max(-1, Math.min(1, s))
        frame[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      this.port.postMessage(frame, [frame.buffer])
      offset += 160
    }
    this.accum = merged.subarray(offset)
    return true
  }
}
registerProcessor('mic-capture-processor', MicCaptureProcessor)
`

const REMOTE_WRAPPER = `
class RemotePlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []          // Float32Array(160) frames at 8kHz
    this.playBuffer = new Float32Array(0)
    this.readPos = 0
    this.port.onmessage = (e) => {
      const frame = e.data
      if (!(frame instanceof Int16Array)) return
      const f = new Float32Array(frame.length)
      for (let i = 0; i < frame.length; i++) f[i] = frame[i] / 32768
      this.queue.push(f)
      // Bound the queue to avoid runaway latency.
      while (this.queue.length > 20) this.queue.shift()
    }
  }
  process(inputs, outputs) {
    const output = outputs[0]
    if (!output || !output[0]) return true
    const channel = output[0]
    const ratio = sampleRate / 8000
    let written = 0
    while (written < channel.length) {
      if (this.playBuffer.length - this.readPos < 2) {
        if (this.queue.length > 0) {
          const f = this.queue.shift()
          const carry = this.playBuffer.length - this.readPos
          const next = new Float32Array(carry + f.length)
          if (carry > 0) next.set(this.playBuffer.subarray(this.readPos), 0)
          next.set(f, carry)
          this.playBuffer = next
          this.readPos = 0
        } else {
          for (let i = written; i < channel.length; i++) channel[i] = 0
          return true
        }
      }
      const idx = Math.floor(this.readPos)
      const frac = this.readPos - idx
      const s0 = this.playBuffer[idx] || 0
      const s1 = this.playBuffer[idx + 1] || s0
      channel[written] = s0 * (1 - frac) + s1 * frac
      written++
      this.readPos += ratio
      if (idx > 800) {
        this.playBuffer = this.playBuffer.subarray(idx)
        this.readPos -= idx
      }
    }
    this.playBuffer = this.playBuffer.subarray(Math.floor(this.readPos))
    this.readPos = 0
    return true
  }
}
registerProcessor('remote-playback-processor', RemotePlaybackProcessor)
`

function makeBlobUrl(src: string): string {
  const blob = new Blob([src], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
}

export class NativeAudioBridge {
  private context: AudioContext | null = null
  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private micWorklet: AudioWorkletNode | null = null
  private remoteWorklet: AudioWorkletNode | null = null
  private micPortListener: ((e: MessageEvent) => void) | null = null
  private remoteListener: ((frame: Int16Array) => void) | null = null
  private accountId: string | null = null

  async start(accountId: string): Promise<void> {
    this.accountId = accountId
    // Prefer 8kHz context; fall back to default rate.
    try {
      this.context = new AudioContext({ sampleRate: 8000 } as AudioContextOptions)
      await this.context.resume()
    } catch {
      this.context = new AudioContext()
      await this.context.resume()
    }
    console.log(`[NativeAudioBridge] AudioContext sampleRate=${this.context.sampleRate}`)

    // Load worklets.
    await this.context.audioWorklet.addModule(makeBlobUrl(MIC_WORKLET_SRC))
    await this.context.audioWorklet.addModule(makeBlobUrl(REMOTE_WRAPPER))

    // Capture mic.
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } as MediaTrackConstraints,
      video: false,
    })
    this.micSource = this.context.createMediaStreamSource(this.micStream)
    this.micWorklet = new AudioWorkletNode(this.context, 'mic-capture-processor')
    this.micSource.connect(this.micWorklet)
    // Do NOT connect mic worklet to destination — we don't want to hear ourselves.

    // Remote playback.
    this.remoteWorklet = new AudioWorkletNode(this.context, 'remote-playback-processor')
    this.remoteWorklet.connect(this.context.destination)

    // Wire mic frames -> main process.
    this.micPortListener = (e: MessageEvent) => {
      const frame = e.data as Int16Array
      if (frame && this.accountId) {
        window.electronAPI.rtp.sendMic(this.accountId, frame)
      }
    }
    this.micWorklet.port.addEventListener('message', this.micPortListener)
    this.micWorklet.port.start()

    // Wire remote frames -> worklet.
    this.remoteListener = (frame: Int16Array) => {
      this.remoteWorklet?.port.postMessage(frame)
    }
    window.electronAPI.rtp.onRemote(this.remoteListener)
  }

  setMuted(muted: boolean): void {
    if (!this.micSource) return
    // Toggle mic track enabled state.
    this.micStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
  }

  async stop(): Promise<void> {
    if (this.micPortListener && this.micWorklet) {
      this.micWorklet.port.removeEventListener('message', this.micPortListener)
      this.micPortListener = null
    }
    if (this.remoteListener) {
      window.electronAPI.rtp.removeRemoteListener()
      this.remoteListener = null
    }
    this.micSource?.disconnect()
    this.micWorklet?.disconnect()
    this.remoteWorklet?.disconnect()
    this.micStream?.getTracks().forEach(t => t.stop())
    this.micStream = null
    this.micSource = null
    this.micWorklet = null
    this.remoteWorklet = null
    if (this.context) {
      try { await this.context.close() } catch { /* ignore */ }
      this.context = null
    }
    this.accountId = null
  }
}

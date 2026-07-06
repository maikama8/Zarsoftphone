// Audio bridge for native UDP calls: captures mic via getUserMedia, runs
// resampling/playback in a static AudioWorklet module, ships 160-sample
// (20ms) Int16 mic frames to the main process for RTP packetization, and
// plays remote RTP frames from a jitter queue in the worklet.

export class NativeAudioBridge {
  private context: AudioContext | null = null
  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private micFramesSent = 0
  private accountId: string | null = null

  private remoteListener: ((frame: Int16Array) => void) | null = null

  async start(accountId: string): Promise<void> {
    this.accountId = accountId
    try {
      this.context = new AudioContext()
      await this.context.resume()
      this.log(`AudioContext sampleRate=${this.context.sampleRate}`)

      // Capture mic from default input device.
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as MediaTrackConstraints,
        video: false,
      })
      const track = this.micStream.getAudioTracks()[0]
      this.log(`Mic acquired: label="${track?.label}" state=${track?.readyState}`)

      await this.context.audioWorklet.addModule('/native-audio-worklet.js')
      this.worklet = new AudioWorkletNode(this.context, 'native-audio-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      this.worklet.port.onmessage = (event) => {
        const msg = event.data || {}
        if (msg.type !== 'mic' || !msg.frame || !this.accountId) return
        const frame = msg.frame as Int16Array
        try { window.electronAPI.rtp.sendMic(this.accountId, frame) } catch { /* gone */ }
        this.micFramesSent++
        if (this.micFramesSent % 100 === 1) {
          let sum = 0
          for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
          const r = Math.sqrt(sum / frame.length) / 32768
          this.log(`Sent mic frame #${this.micFramesSent} (RMS=${r.toFixed(4)})`)
        }
      }

      this.micSource = this.context.createMediaStreamSource(this.micStream)
      this.micSource.connect(this.worklet)
      this.worklet.connect(this.context.destination)

      // Listen for remote RTP frames from main process and push into ring.
      this.remoteListener = (frame: Int16Array) => {
        try { this.worklet?.port.postMessage({ type: 'remote', frame }) } catch { /* gone */ }
      }
      window.electronAPI.rtp.onRemote(this.remoteListener)

      this.log('Audio bridge started — mic + speaker ready')
    } catch (err) {
      this.log(`FAILED to start audio bridge: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
  }

  private log(msg: string): void {
    console.log(`[NativeAudioBridge] ${msg}`)
    try { window.electronAPI.log(msg) } catch { /* renderer gone */ }
  }

  setMuted(muted: boolean): void {
    if (!this.micStream) return
    this.micStream.getAudioTracks().forEach(t => { t.enabled = !muted })
  }

  async stop(): Promise<void> {
    if (this.remoteListener) {
      try { window.electronAPI.rtp.removeRemoteListener() } catch { /* gone */ }
      this.remoteListener = null
    }
    try { this.micSource?.disconnect() } catch { /* ignore */ }
    try { this.worklet?.disconnect() } catch { /* ignore */ }
    try { this.worklet?.port.close() } catch { /* ignore */ }
    this.micStream?.getTracks().forEach(t => t.stop())
    this.micStream = null
    this.micSource = null
    this.worklet = null
    if (this.context) {
      try { await this.context.close() } catch { /* ignore */ }
      this.context = null
    }
    this.accountId = null
    this.micFramesSent = 0
  }
}

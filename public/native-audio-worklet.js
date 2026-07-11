class NativeAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.micAccum = []
    this.micLeftover = []
    this.remoteRing = new Float32Array(8000)
    this.remoteWritePos = 0
    this.remoteReadPos = 0
    this.remoteSamplesAvailable = 0
    this.remoteResamplePhase = 0

    this.port.onmessage = (event) => {
      const msg = event.data || {}
      if (msg.type === 'remote' && msg.frame) this.enqueueRemoteFrame(msg.frame)
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    if (input && input.length > 0) this.processMicFrame(input)

    const output = outputs[0] && outputs[0][0]
    if (output) this.fillRemoteOutput(output)

    return true
  }

  processMicFrame(input) {
    const ratio = sampleRate / 8000
    const src = new Float32Array(this.micLeftover.length + input.length)
    src.set(this.micLeftover, 0)
    src.set(input, this.micLeftover.length)

    const out = []
    let pos = 0
    while (pos + ratio <= src.length) {
      const idx = Math.floor(pos)
      const frac = pos - idx
      const s = src[idx] * (1 - frac) + (src[idx + 1] || src[idx]) * frac
      out.push(s)
      pos += ratio
    }
    this.micLeftover = Array.from(src.subarray(Math.floor(pos)))

    const merged = this.micAccum.concat(out)
    let offset = 0
    while (offset + 160 <= merged.length) {
      const frame = new Int16Array(160)
      for (let i = 0; i < 160; i++) {
        let s = merged[offset + i]
        s = Math.max(-1, Math.min(1, s))
        frame[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      this.port.postMessage({ type: 'mic', frame }, [frame.buffer])
      offset += 160
    }
    this.micAccum = merged.slice(offset)
  }

  enqueueRemoteFrame(frame) {
    const cap = this.remoteRing.length
    for (let i = 0; i < frame.length; i++) {
      this.remoteRing[this.remoteWritePos] = frame[i] / 32768
      this.remoteWritePos = (this.remoteWritePos + 1) % cap
      if (this.remoteSamplesAvailable < cap) this.remoteSamplesAvailable++
      else this.remoteReadPos = (this.remoteReadPos + 1) % cap
    }
  }

  fillRemoteOutput(out) {
    const cap = this.remoteRing.length
    const ratio = 8000 / sampleRate
    for (let i = 0; i < out.length; i++) {
      if (this.remoteSamplesAvailable >= 2) {
        const i0 = this.remoteReadPos
        const i1 = (this.remoteReadPos + 1) % cap
        const s0 = this.remoteRing[i0]
        const s1 = this.remoteRing[i1]
        out[i] = s0 * (1 - this.remoteResamplePhase) + s1 * this.remoteResamplePhase
        this.remoteResamplePhase += ratio
        while (this.remoteResamplePhase >= 1) {
          this.remoteResamplePhase -= 1
          this.remoteReadPos = (this.remoteReadPos + 1) % cap
          this.remoteSamplesAvailable--
        }
      } else {
        out[i] = 0
      }
    }
  }
}

registerProcessor('native-audio-processor', NativeAudioProcessor)

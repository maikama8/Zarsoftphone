// G.711 µ-law (PCMU) codec, RFC 3551 §4.5.13. Table-based encode/decode.

// Standard µ-law decode table (0-255 -> signed 16-bit PCM).
const ULAW_DECODE: Int16Array = (() => {
  const t = new Int16Array(256)
  for (let i = 0; i < 256; i++) {
    let b = ~i & 0xff
    const sign = b & 0x80
    let exponent = (b >> 4) & 0x07
    let mantissa = b & 0x0f
    let sample = ((mantissa << 3) + 0x84) << exponent
    sample -= 0x84
    t[i] = sign ? -sample : sample
  }
  return t
})()

// Encode a 16-bit PCM sample to µ-law byte.
function pcmToUlawSample(sample: number): number {
  let bias = 0x84
  let clip = 32635
  let sign = 0
  if (sample < 0) { sample = -sample; sign = 0x80 }
  if (sample > clip) sample = clip
  sample += bias
  let exponent = 7
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--
  let mantissa = (sample >> (exponent + 3)) & 0x0f
  let ulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff
  return ulawByte
}

export function pcmToUlaw(pcm: Int16Array): Buffer {
  const out = Buffer.alloc(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcmToUlawSample(pcm[i])
  return out
}

export function ulawToPcm(buf: Buffer, length = buf.length): Int16Array {
  const out = new Int16Array(length)
  const n = Math.min(length, buf.length)
  for (let i = 0; i < n; i++) out[i] = ULAW_DECODE[buf[i]]
  return out
}

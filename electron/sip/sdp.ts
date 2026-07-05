// RFC 4566 SDP parser + RFC 3264 offer/answer negotiation.

export interface MediaLine {
  type: string // 'audio' | 'video'
  port: number
  protocol: string // 'RTP/AVP' | 'RTP/SAVP' | ...
  formats: string[] // payload types
  connection?: string // c= override IP
  rtpmap: Record<string, { codec: string; clockRate: number; channels?: number }>
  fmtp: Record<string, string>
  rtcpPort?: number
  ptime?: number
  direction: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive' | 'unknown'
  telephoneEventPt?: string
}

export interface SdpSession {
  connection?: string // session-level c= IP
  media: MediaLine[]
  raw: string
}

export function parseSdp(raw: string): SdpSession {
  const lines = raw.split(/\r?\n/)
  const session: SdpSession = { media: [], raw }
  let sessionConn: string | undefined
  let current: MediaLine | null = null
  let sessionDirection: MediaLine['direction'] = 'unknown'

  for (const line of lines) {
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq !== 1) continue // format: x=value
    const key = line[0]
    const value = line.substring(2)
    switch (key) {
      case 'c': {
        // c=IN IP4 1.2.3.4
        const m = value.match(/IN IP4 ([0-9.]+)/i) || value.match(/IN IP6 ([0-9a-fA-F:]+)/i)
        const ip = m ? m[1] : value
        if (current) current.connection = ip
        else sessionConn = ip
        break
      }
      case 'm': {
        // m=audio 10000 RTP/AVP 0 8 101
        const parts = value.split(/\s+/)
        current = {
          type: parts[0],
          port: parseInt(parts[1], 10),
          protocol: parts[2],
          formats: parts.slice(3).filter(Boolean),
          rtpmap: {},
          fmtp: {},
          direction: sessionDirection !== 'unknown' ? sessionDirection : 'sendrecv',
        }
        session.media.push(current)
        break
      }
      case 'a': {
        const colon = value.indexOf(':')
        const aname = colon === -1 ? value : value.substring(0, colon)
        const aval = colon === -1 ? '' : value.substring(colon + 1)
        if (!current) {
          // session-level attributes
          if (['sendrecv', 'sendonly', 'recvonly', 'inactive'].includes(aname)) {
            sessionDirection = aname as MediaLine['direction']
          }
          break
        }
        if (['sendrecv', 'sendonly', 'recvonly', 'inactive'].includes(aname)) {
          current.direction = aname as MediaLine['direction']
        } else if (aname === 'rtpmap') {
          // a=rtpmap:<pt> <codec>/<clockRate>[/<channels>]
          const sp = aval.indexOf(' ')
          const pt = aval.substring(0, sp)
          const rest = aval.substring(sp + 1)
          const slash = rest.indexOf('/')
          const codec = slash === -1 ? rest : rest.substring(0, slash)
          const afterSlash = slash === -1 ? '' : rest.substring(slash + 1)
          const clockRate = parseInt(afterSlash.split('/')[0], 10) || 8000
          const channels = afterSlash.includes('/') ? parseInt(afterSlash.split('/')[1], 10) : undefined
          current.rtpmap[pt] = { codec, clockRate, channels }
        } else if (aname === 'fmtp') {
          const sp = aval.indexOf(' ')
          const pt = aval.substring(0, sp)
          current.fmtp[pt] = aval.substring(sp + 1)
        } else if (aname === 'rtcp') {
          const m = aval.match(/(\d+)/)
          if (m) current.rtcpPort = parseInt(m[1], 10)
        } else if (aname === 'ptime') {
          current.ptime = parseInt(aval, 10)
        }
        break
      }
      default:
        break
    }
  }
  session.connection = sessionConn
  // Resolve telephone-event PT.
  for (const m of session.media) {
    for (const pt of Object.keys(m.rtpmap)) {
      if (m.rtpmap[pt].codec.toLowerCase() === 'telephone-event') {
        m.telephoneEventPt = pt
      }
    }
  }
  return session
}

export interface NegotiatedMedia {
  payloadType: string
  codec: 'PCMU' | 'PCMA' | string
  clockRate: number
  remoteRtpIp: string
  remoteRtpPort: number
  remoteRtcpPort?: number
  telephoneEventPt?: string
  direction: MediaLine['direction']
}

// Negotiate against a remote offer. We support PCMU (0) and PCMA (8) and telephone-event.
export function negotiate(offer: SdpSession): NegotiatedMedia | null {
  const audio = offer.media.find(m => m.type === 'audio' && m.port !== 0)
  if (!audio) return null

  // Pick first supported codec we support, preferring PCMU then PCMA.
  let chosen: { pt: string; codec: string; clockRate: number } | null = null
  const order = ['0', '8']
  for (const pt of order) {
    const map = audio.rtpmap[pt]
    if (audio.formats.includes(pt) && map) {
      chosen = { pt, codec: map.codec, clockRate: map.clockRate }
      break
    }
  }
  if (!chosen) {
    // Try by codec name if PT differs.
    for (const pt of audio.formats) {
      const map = audio.rtpmap[pt]
      if (!map) continue
      const c = map.codec.toUpperCase()
      if (c === 'PCMU') { chosen = { pt, codec: map.codec, clockRate: map.clockRate }; break }
      if (c === 'PCMA' && !chosen) { chosen = { pt, codec: map.codec, clockRate: map.clockRate } }
    }
  }
  if (!chosen) return null

  const remoteRtpIp = audio.connection || offer.connection || ''
  const remoteRtpPort = audio.port
  return {
    payloadType: chosen.pt,
    codec: chosen.codec,
    clockRate: chosen.clockRate,
    remoteRtpIp,
    remoteRtpPort,
    remoteRtcpPort: audio.rtcpPort,
    telephoneEventPt: audio.telephoneEventPt,
    direction: audio.direction,
  }
}

// Build our SDP offer/answer. For an answer, use the chosen PT only.
export function buildSdp(opts: {
  localIp: string
  rtpPort: number
  payloadType: string // '0' or '8'
  direction: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive'
  telephoneEventPt?: string
  sessionId?: number
  sessionVersion?: number
}): string {
  const sid = opts.sessionId ?? Math.floor(Date.now() / 1000)
  const ver = opts.sessionVersion ?? 1
  const codecName = opts.payloadType === '0' ? 'PCMU' : 'PCMA'
  const formats = opts.telephoneEventPt ? `${opts.payloadType} ${opts.telephoneEventPt}` : opts.payloadType
  let s = ''
  s += `v=0\r\n`
  s += `o=- ${sid} ${ver} IN IP4 ${opts.localIp}\r\n`
  s += `s=Zarsip\r\n`
  s += `c=IN IP4 ${opts.localIp}\r\n`
  s += `t=0 0\r\n`
  s += `m=audio ${opts.rtpPort} RTP/AVP ${formats}\r\n`
  s += `a=rtpmap:${opts.payloadType} ${codecName}/8000\r\n`
  if (opts.telephoneEventPt) {
    s += `a=rtpmap:${opts.telephoneEventPt} telephone-event/8000\r\n`
    s += `a=fmtp:${opts.telephoneEventPt} 0-15\r\n`
  }
  s += `a=ptime:20\r\n`
  s += `a=${opts.direction}\r\n`
  return s
}

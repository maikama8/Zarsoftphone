// RFC 3261 SIP message parser/serializer.
// Headers are stored as an array (not a Map) so duplicates (Via, Record-Route,
// WWW-Authenticate) survive. Lookup is case-insensitive (§7.3.1) and supports
// compact forms (§20: v→Via, f→From, t→To, i→Call-ID, m→Contact, l→Content-Length,
// c→Content-Type, s→Subject, k→Supported, u→Allow-Events, e→Accept-Encoding).

export interface SipHeader {
  name: string // canonical (compact expanded)
  raw: string // original name as received
  value: string
}

export interface SipMessage {
  kind: 'request' | 'response'
  method?: string
  requestUri?: string
  statusCode?: number
  reasonPhrase?: string
  headers: SipHeader[]
  body: string
  raw: string
}

const COMPACT: Record<string, string> = {
  v: 'Via',
  f: 'From',
  t: 'To',
  i: 'Call-ID',
  m: 'Contact',
  l: 'Content-Length',
  c: 'Content-Type',
  s: 'Subject',
  k: 'Supported',
  u: 'Allow-Events',
  e: 'Accept-Encoding',
  o: 'Event',
  b: 'Refer-To',
  q: 'RSeq',
  r: 'Refer-To',
  n: 'Subscription-State',
  x: 'Session-Expires',
  j: 'Reject-Contact',
  d: 'Request-Disposition',
}

function canonicalName(name: string): string {
  const lower = name.toLowerCase()
  for (const compact in COMPACT) {
    if (lower === compact) return COMPACT[compact]
  }
  // Title-case: "call-id" -> "Call-ID", "cseq" -> "CSeq", "www-authenticate" -> "WWW-Authenticate"
  const known: Record<string, string> = {
    'call-id': 'Call-ID',
    'cseq': 'CSeq',
    'via': 'Via',
    'from': 'From',
    'to': 'To',
    'contact': 'Contact',
    'content-length': 'Content-Length',
    'content-type': 'Content-Type',
    'max-forwards': 'Max-Forwards',
    'www-authenticate': 'WWW-Authenticate',
    'proxy-authenticate': 'Proxy-Authenticate',
    'authorization': 'Authorization',
    'proxy-authorization': 'Proxy-Authorization',
    'record-route': 'Record-Route',
    'route': 'Route',
    'user-agent': 'User-Agent',
    'allow': 'Allow',
    'supported': 'Supported',
    'expires': 'Expires',
    'server': 'Server',
    'reason': 'Reason',
    'rack': 'RAck',
    'rseq': 'RSeq',
    'session-expires': 'Session-Expires',
    'min-expires': 'Min-Expires',
    'require': 'Require',
    'proxy-require': 'Proxy-Require',
    'unsupported': 'Unsupported',
    'allow-events': 'Allow-Events',
    'event': 'Event',
    'subscription-state': 'Subscription-State',
    'refer-to': 'Refer-To',
    'referred-by': 'Referred-By',
    'replaces': 'Replaces',
    'p-asserted-identity': 'P-Asserted-Identity',
    'p-preferred-identity': 'P-Preferred-Identity',
    'privacy': 'Privacy',
    'date': 'Date',
    'warning': 'Warning',
    'retry-after': 'Retry-After',
    'accept': 'Accept',
    'accept-encoding': 'Accept-Encoding',
    'accept-language': 'Accept-Language',
    'alert-info': 'Alert-Info',
    'authentication-info': 'Authentication-Info',
    'call-info': 'Call-Info',
    'error-info': 'Error-Info',
    'in-reply-to': 'In-Reply-To',
    'mime-version': 'MIME-Version',
    'organization': 'Organization',
    'priority': 'Priority',
    'reply-to': 'Reply-To',
    'timestamp': 'Timestamp',
    'subject': 'Subject',
    'request-disposition': 'Request-Disposition',
  }
  return known[lower] || name
}

export function parseMessage(raw: string): SipMessage {
  // Some carriers send SIP responses with leading whitespace (e.g. "    SIP/2.0
  // 200 OK"). RFC 3261 §7.5 says SIP elements SHOULD ignore leading CRLF/SP on
  // incoming messages — trim it, otherwise responses are misclassified as
  // requests (method="SIP/2.0"), client transactions never see their 200 OK,
  // and retransmissions pile up until Timer F/B fires.
  const trimmed = raw.replace(/^[\r\n\s\0]+/, '')
  const crlf = trimmed.indexOf('\r\n')
  const firstLineEnd = crlf === -1 ? trimmed.length : crlf
  const firstLine = trimmed.substring(0, firstLineEnd)
  raw = trimmed

  // Find header/body boundary (\r\n\r\n)
  let boundary = raw.indexOf('\r\n\r\n')
  const headerBlock = boundary === -1 ? raw.substring(firstLineEnd + 2) : raw.substring(firstLineEnd + 2, boundary)
  const body = boundary === -1 ? '' : raw.substring(boundary + 4)

  // Parse headers, handling line folding (continuation lines starting with space/tab).
  const headers: SipHeader[] = []
  const rawLines = headerBlock.split('\r\n')
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i]
    // Folded continuation
    while (i + 1 < rawLines.length && (rawLines[i + 1].startsWith(' ') || rawLines[i + 1].startsWith('\t'))) {
      i++
      line += ' ' + rawLines[i].trim()
    }
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const rawName = line.substring(0, colon).trim()
    const value = line.substring(colon + 1).trim()
    headers.push({ name: canonicalName(rawName), raw: rawName, value })
  }

  if (firstLine.startsWith('SIP/2.0')) {
    const parts = firstLine.split(' ', 3)
    return {
      kind: 'response',
      statusCode: parseInt(parts[1], 10),
      reasonPhrase: parts.slice(2).join(' '),
      headers,
      body,
      raw,
    }
  } else {
    const sp1 = firstLine.indexOf(' ')
    const sp2 = firstLine.indexOf(' ', sp1 + 1)
    const method = firstLine.substring(0, sp1)
    const requestUri = sp2 === -1 ? firstLine.substring(sp1 + 1) : firstLine.substring(sp1 + 1, sp2)
    return {
      kind: 'request',
      method,
      requestUri,
      headers,
      body,
      raw,
    }
  }
}

export function getHeader(msg: SipMessage, name: string): string | undefined {
  const canon = canonicalName(name)
  for (const h of msg.headers) {
    if (h.name === canon) return h.value
  }
  return undefined
}

export function getHeaders(msg: SipMessage, name: string): SipHeader[] {
  const canon = canonicalName(name)
  return msg.headers.filter(h => h.name === canon)
}

// Parse a comma-separated header list (e.g. Via, Record-Route can be folded).
export function splitCommas(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '<' || c === '(') depth++
    else if (c === '>' || c === ')') depth--
    else if (c === ',' && depth === 0) {
      out.push(s.substring(start, i).trim())
      start = i + 1
    }
  }
  out.push(s.substring(start).trim())
  return out.filter(Boolean)
}

// Parse header parameters like ";tag=abc;lr" from the tail of a header value.
export function parseParams(value: string): { main: string; params: Record<string, string> } {
  // Strip angle-bracket URI; everything before the params is the "main".
  let main = value
  let paramPart = ''
  // Find first ';' not inside <>
  let depth = 0
  let firstSemi = -1
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '<') depth++
    else if (c === '>') depth--
    else if (c === ';' && depth === 0) { firstSemi = i; break }
  }
  if (firstSemi !== -1) {
    main = value.substring(0, firstSemi).trim()
    paramPart = value.substring(firstSemi + 1)
  }
  const params: Record<string, string> = {}
  if (paramPart) {
    const pieces = paramPart.split(';')
    for (const p of pieces) {
      const eq = p.indexOf('=')
      if (eq === -1) {
        const k = p.trim()
        if (k) params[k.toLowerCase()] = ''
      } else {
        const k = p.substring(0, eq).trim().toLowerCase()
        const v = p.substring(eq + 1).trim().replace(/^"(.*)"$/, '$1')
        params[k] = v
      }
    }
  }
  return { main: main.trim(), params }
}

export function getParam(msg: SipMessage, headerName: string, param: string): string | undefined {
  const v = getHeader(msg, headerName)
  if (!v) return undefined
  return parseParams(v).params[param.toLowerCase()]
}

// Serialize a message back to wire format.
export function serializeMessage(msg: SipMessage): string {
  let out: string
  if (msg.kind === 'response') {
    out = `SIP/2.0 ${msg.statusCode} ${msg.reasonPhrase || ''}\r\n`
  } else {
    out = `${msg.method} ${msg.requestUri} SIP/2.0\r\n`
  }
  for (const h of msg.headers) {
    out += `${h.raw || h.name}: ${h.value}\r\n`
  }
  // Ensure Content-Length present
  if (!msg.headers.some(h => h.name === 'Content-Length')) {
    out += `Content-Length: ${Buffer.byteLength(msg.body || '', 'utf8')}\r\n`
  }
  out += '\r\n'
  out += msg.body || ''
  return out
}

// Split a single SIP-grammar response into individual messages using Content-Length,
// for stream transports (TCP/TLS). Returns [completeMessages, leftoverBuffer].
export function splitStream(buffer: string): string[] {
  const messages: string[] = []
  let rest = buffer
  while (rest.length > 0) {
    const headerEnd = rest.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const headerBlock = rest.substring(0, headerEnd)
    // Find Content-Length (case-insensitive), compact 'l'
    const m = headerBlock.match(/^(?:l|content-length):\s*(\d+)/im)
    const contentLength = m ? parseInt(m[1], 10) : 0
    const totalLen = headerEnd + 4 + contentLength
    if (rest.length < totalLen) break // incomplete
    messages.push(rest.substring(0, totalLen))
    rest = rest.substring(totalLen)
  }
  return messages
}

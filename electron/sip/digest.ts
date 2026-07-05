// RFC 7616 / RFC 2617 HTTP Digest authentication for SIP.
// Supports MD5 and SHA-256, qop=auth (and auth-int), nc/cnonce, stale, opaque.

import * as crypto from 'crypto'

export interface AuthChallenge {
  scheme: string
  realm: string
  nonce: string
  algorithm?: string // 'MD5' | 'SHA-256' | 'MD5-sess' | 'SHA-256-sess'
  qop?: string[] // ['auth'] | ['auth','auth-int'] etc.
  opaque?: string
  stale?: boolean
  userhash?: boolean
  params: Record<string, string>
}

// Parse a challenge string like: Digest realm="...", nonce="abc", qop="auth", algorithm=MD5
export function parseChallenge(headerValue: string): AuthChallenge | null {
  const sp = headerValue.indexOf(' ')
  if (sp === -1) return null
  const scheme = headerValue.substring(0, sp).trim()
  const rest = headerValue.substring(sp + 1).trim()

  const params: Record<string, string> = {}
  // Tokenize the comma-separated key=value list, respecting quotes.
  let i = 0
  while (i < rest.length) {
    // skip whitespace and commas
    while (i < rest.length && /[\s,]/.test(rest[i])) i++
    const eq = rest.indexOf('=', i)
    if (eq === -1) break
    const key = rest.substring(i, eq).trim().toLowerCase()
    let j = eq + 1
    while (j < rest.length && /\s/.test(rest[j])) j++
    let value: string
    if (rest[j] === '"') {
      // quoted: read until unescaped quote
      let end = j + 1
      let buf = ''
      while (end < rest.length) {
        if (rest[end] === '\\' && end + 1 < rest.length) { buf += rest[end + 1]; end += 2; continue }
        if (rest[end] === '"') break
        buf += rest[end]; end++
      }
      value = buf
      j = end + 1
    } else {
      // token: read until comma
      let end = rest.indexOf(',', j)
      if (end === -1) end = rest.length
      value = rest.substring(j, end).trim()
      j = end
    }
    params[key] = value
    i = j
  }

  return {
    scheme,
    realm: params.realm || '',
    nonce: params.nonce || '',
    algorithm: params.algorithm || 'MD5',
    qop: params.qop ? params.qop.split(',').map(s => s.trim()) : undefined,
    opaque: params.opaque,
    stale: params.stale === 'true',
    userhash: params.userhash === 'true',
    params,
  }
}

export interface AuthContext {
  username: string
  password: string
  realm: string
  algorithm: string
  qop?: string
  opaque?: string
  nonce: string
  nc: number
  cnonce: string
}

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex')
}
function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function algHash(algorithm: string, s: string): string {
  if (algorithm.toLowerCase().includes('sha-256') || algorithm.toLowerCase().includes('sha256')) return sha256(s)
  return md5(s)
}

function h(algorithm: string, s: string): string {
  return algHash(algorithm, s)
}

function randomCnonce(): string {
  return crypto.randomBytes(8).toString('hex')
}

export interface BuildAuthOpts {
  method: string
  uri: string // Request-URI of the request being authorized
  challenge: AuthChallenge
  context: AuthContext
  body?: string // required for qop=auth-int
  isProxy?: boolean // Proxy-Authorization vs Authorization
}

// Compute the Authorization/Proxy-Authorization header value.
export function buildAuthorization(opts: BuildAuthOpts): string {
  const { method, uri, challenge, context, body, isProxy } = opts
  const algorithm = (challenge.algorithm || context.algorithm || 'MD5').toUpperCase()

  // HA1
  let ha1 = h(algorithm, `${context.username}:${challenge.realm}:${context.password}`)
  if (algorithm.toLowerCase().endsWith('-sess')) {
    ha1 = h(algorithm, `${ha1}:${challenge.nonce}:${context.cnonce}`)
  }

  // HA2
  let ha2: string
  const qop = challenge.qop && challenge.qop.length ? (challenge.qop.includes('auth') ? 'auth' : challenge.qop[0]) : undefined
  if (qop === 'auth-int') {
    const bodyHash = body ? algHash(algorithm, body) : algHash(algorithm, '')
    ha2 = h(algorithm, `${method}:${uri}:${bodyHash}`)
  } else {
    ha2 = h(algorithm, `${method}:${uri}`)
  }

  const ncStr = context.nc.toString(16).padStart(8, '0')

  let response: string
  if (qop) {
    response = h(algorithm, `${ha1}:${challenge.nonce}:${ncStr}:${context.cnonce}:${qop}:${ha2}`)
  } else {
    response = h(algorithm, `${ha1}:${challenge.nonce}:${ha2}`)
  }

  const hdrName = isProxy ? 'Proxy-Authorization' : 'Authorization'
  let val = `${challenge.scheme} username="${context.username}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${uri}", response="${response}"`
  if (algorithm) val += `, algorithm=${algorithm}`
  if (qop) val += `, qop=${qop}, nc=${ncStr}, cnonce="${context.cnonce}"`
  if (challenge.opaque) val += `, opaque="${challenge.opaque}"`
  if (challenge.userhash) val += `, userhash=true`
  return `${hdrName}: ${val}\r\n`
}

// Create or refresh an AuthContext from a challenge.
export function contextFromChallenge(username: string, password: string, challenge: AuthChallenge, existing?: AuthContext): AuthContext {
  const algorithm = (challenge.algorithm || 'MD5')
  // If stale, reuse nc/cnonce; otherwise fresh.
  if (existing && challenge.stale) {
    return { ...existing, nonce: challenge.nonce, realm: challenge.realm, algorithm, opaque: challenge.opaque }
  }
  return {
    username,
    password,
    realm: challenge.realm,
    algorithm,
    qop: challenge.qop && challenge.qop.length ? (challenge.qop.includes('auth') ? 'auth' : challenge.qop[0]) : undefined,
    opaque: challenge.opaque,
    nonce: challenge.nonce,
    nc: 1,
    cnonce: randomCnonce(),
  }
}

export function incrementNc(ctx: AuthContext): void {
  ctx.nc = (ctx.nc + 1) & 0xffffffff
  if (ctx.nc === 0) {
    // rollover -> new cnonce
    ctx.cnonce = randomCnonce()
    ctx.nc = 1
  }
}

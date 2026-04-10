import * as dgram from 'dgram'
import * as net from 'net'
import * as tls from 'tls'
import { EventEmitter } from 'events'
import * as crypto from 'crypto'

interface SipAccount {
  id: string
  username: string
  password: string
  domain: string
  server: string
  transport: 'UDP' | 'TCP' | 'TLS'
  port: number
  displayName?: string
}

interface SipMessage {
  method?: string
  statusCode?: number
  headers: Map<string, string>
  body: string
  raw: string
}

export class NativeSipService extends EventEmitter {
  private sockets: Map<string, dgram.Socket | net.Socket | tls.TLSSocket> = new Map()
  private accounts: Map<string, SipAccount> = new Map()
  private callIds: Map<string, number> = new Map()
  private tags: Map<string, string> = new Map()
  private branches: Map<string, string> = new Map()
  private currentCall: any = null

  constructor() {
    super()
  }

  async register(account: SipAccount): Promise<boolean> {
    try {
      console.log(`[NativeSIP] Registering ${account.username}@${account.domain} via ${account.transport}`)
      
      this.accounts.set(account.id, account)
      this.callIds.set(account.id, 1)
      this.tags.set(account.id, this.generateTag())
      
      // Create socket based on transport
      const socket = await this.createSocket(account)
      this.sockets.set(account.id, socket)
      
      // Send REGISTER
      await this.sendRegister(account)
      
      return true
    } catch (error) {
      console.error('[NativeSIP] Registration failed:', error)
      this.emit('registrationFailed', account.id, error)
      return false
    }
  }

  async unregister(accountId: string): Promise<void> {
    const socket = this.sockets.get(accountId)
    if (socket) {
      if (socket instanceof dgram.Socket) {
        socket.close()
      } else {
        socket.destroy()
      }
      this.sockets.delete(accountId)
    }
    this.accounts.delete(accountId)
  }

  async makeCall(accountId: string, targetNumber: string): Promise<void> {
    const account = this.accounts.get(accountId)
    if (!account) {
      throw new Error('Account not registered')
    }

    console.log(`[NativeSIP] Making call to ${targetNumber}`)
    
    const callId = this.generateCallId()
    const fromTag = this.generateTag()
    const branch = this.generateBranch()
    
    const invite = this.buildInvite(account, targetNumber, callId, fromTag, branch)
    await this.sendMessage(accountId, invite)
    
    this.emit('callState', 'ringing')
  }

  async hangup(accountId: string): Promise<void> {
    if (this.currentCall) {
      const bye = this.buildBye(this.currentCall)
      await this.sendMessage(accountId, bye)
      this.currentCall = null
      this.emit('callState', 'ended')
    }
  }

  private async createSocket(account: SipAccount): Promise<dgram.Socket | net.Socket | tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      let socket: dgram.Socket | net.Socket | tls.TLSSocket

      switch (account.transport) {
        case 'UDP':
          socket = dgram.createSocket('udp4')
          socket.on('message', (msg, rinfo) => {
            this.handleMessage(account.id, msg.toString(), rinfo)
          })
          socket.on('error', (err) => {
            console.error('[NativeSIP] UDP error:', err)
            reject(err)
          })
          socket.bind(() => {
            console.log(`[NativeSIP] UDP socket bound`)
            resolve(socket)
          })
          break

        case 'TCP':
          socket = net.createConnection({
            host: account.server,
            port: account.port
          })
          socket.on('data', (data) => {
            this.handleMessage(account.id, data.toString(), { address: account.server, port: account.port })
          })
          socket.on('error', (err) => {
            console.error('[NativeSIP] TCP error:', err)
            reject(err)
          })
          socket.on('connect', () => {
            console.log(`[NativeSIP] TCP connected to ${account.server}:${account.port}`)
            resolve(socket)
          })
          break

        case 'TLS':
          socket = tls.connect({
            host: account.server,
            port: account.port,
            rejectUnauthorized: false // For testing; use true in production
          })
          socket.on('data', (data) => {
            this.handleMessage(account.id, data.toString(), { address: account.server, port: account.port })
          })
          socket.on('error', (err) => {
            console.error('[NativeSIP] TLS error:', err)
            reject(err)
          })
          socket.on('secureConnect', () => {
            console.log(`[NativeSIP] TLS connected to ${account.server}:${account.port}`)
            resolve(socket)
          })
          break

        default:
          reject(new Error(`Unsupported transport: ${account.transport}`))
      }
    })
  }

  private async sendRegister(account: SipAccount): Promise<void> {
    const callId = this.generateCallId()
    const tag = this.tags.get(account.id) || this.generateTag()
    const branch = this.generateBranch()
    const cseq = this.callIds.get(account.id) || 1

    const localIp = this.getLocalIp()
    const localPort = this.getLocalPort(account.id)

    const message = 
      `REGISTER sip:${account.domain} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch}\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: <sip:${account.username}@${account.domain}>;tag=${tag}\r\n` +
      `To: <sip:${account.username}@${account.domain}>\r\n` +
      `Call-ID: ${callId}\r\n` +
      `CSeq: ${cseq} REGISTER\r\n` +
      `Contact: <sip:${account.username}@${localIp}:${localPort};transport=${account.transport.toLowerCase()}>\r\n` +
      `Expires: 600\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: 0\r\n\r\n`

    await this.sendMessage(account.id, message)
  }

  private buildInvite(account: SipAccount, target: string, callId: string, fromTag: string, branch: string): string {
    const localIp = this.getLocalIp()
    const localPort = this.getLocalPort(account.id)
    const cseq = (this.callIds.get(account.id) || 1) + 1
    this.callIds.set(account.id, cseq)

    const sdp = this.buildSDP(localIp)

    return (
      `INVITE sip:${target}@${account.domain} SIP/2.0\r\n` +
      `Via: SIP/2.0/${account.transport} ${localIp}:${localPort};branch=${branch}\r\n` +
      `Max-Forwards: 70\r\n` +
      `From: "${account.displayName || account.username}" <sip:${account.username}@${account.domain}>;tag=${fromTag}\r\n` +
      `To: <sip:${target}@${account.domain}>\r\n` +
      `Call-ID: ${callId}\r\n` +
      `CSeq: ${cseq} INVITE\r\n` +
      `Contact: <sip:${account.username}@${localIp}:${localPort}>\r\n` +
      `Content-Type: application/sdp\r\n` +
      `User-Agent: Zarsip/1.0\r\n` +
      `Content-Length: ${sdp.length}\r\n\r\n` +
      sdp
    )
  }

  private buildBye(call: any): string {
    // Simplified BYE message
    return `BYE ${call.requestUri} SIP/2.0\r\n` +
           `Via: ${call.via}\r\n` +
           `From: ${call.from}\r\n` +
           `To: ${call.to}\r\n` +
           `Call-ID: ${call.callId}\r\n` +
           `CSeq: ${call.cseq + 1} BYE\r\n` +
           `Content-Length: 0\r\n\r\n`
  }

  private buildSDP(localIp: string): string {
    const sessionId = Date.now()
    return (
      `v=0\r\n` +
      `o=- ${sessionId} ${sessionId} IN IP4 ${localIp}\r\n` +
      `s=Zarsip Call\r\n` +
      `c=IN IP4 ${localIp}\r\n` +
      `t=0 0\r\n` +
      `m=audio 10000 RTP/AVP 0 8 101\r\n` +
      `a=rtpmap:0 PCMU/8000\r\n` +
      `a=rtpmap:8 PCMA/8000\r\n` +
      `a=rtpmap:101 telephone-event/8000\r\n` +
      `a=sendrecv\r\n`
    )
  }

  private async sendMessage(accountId: string, message: string): Promise<void> {
    const socket = this.sockets.get(accountId)
    const account = this.accounts.get(accountId)
    
    if (!socket || !account) {
      throw new Error('Socket or account not found')
    }

    console.log(`[NativeSIP] Sending:\n${message}`)

    if (socket instanceof dgram.Socket) {
      const buffer = Buffer.from(message)
      socket.send(buffer, 0, buffer.length, account.port, account.server)
    } else {
      socket.write(message)
    }
  }

  private handleMessage(accountId: string, message: string, rinfo: any): void {
    console.log(`[NativeSIP] Received from ${rinfo.address}:${rinfo.port}:\n${message}`)
    
    const parsed = this.parseMessage(message)
    
    if (parsed.statusCode) {
      this.handleResponse(accountId, parsed)
    } else if (parsed.method) {
      this.handleRequest(accountId, parsed)
    }
  }

  private parseMessage(message: string): SipMessage {
    const lines = message.split('\r\n')
    const firstLine = lines[0]
    const headers = new Map<string, string>()
    
    let i = 1
    for (; i < lines.length; i++) {
      if (lines[i] === '') break
      const colonIndex = lines[i].indexOf(':')
      if (colonIndex > 0) {
        const key = lines[i].substring(0, colonIndex).trim()
        const value = lines[i].substring(colonIndex + 1).trim()
        headers.set(key, value)
      }
    }
    
    const body = lines.slice(i + 1).join('\r\n')
    
    // Parse first line
    if (firstLine.startsWith('SIP/2.0')) {
      const parts = firstLine.split(' ')
      return {
        statusCode: parseInt(parts[1]),
        headers,
        body,
        raw: message
      }
    } else {
      const parts = firstLine.split(' ')
      return {
        method: parts[0],
        headers,
        body,
        raw: message
      }
    }
  }

  private handleResponse(accountId: string, message: SipMessage): void {
    const statusCode = message.statusCode!
    
    if (statusCode === 200) {
      if (message.headers.get('CSeq')?.includes('REGISTER')) {
        console.log('[NativeSIP] Registration successful')
        this.emit('registered', accountId)
      } else if (message.headers.get('CSeq')?.includes('INVITE')) {
        console.log('[NativeSIP] Call answered')
        this.emit('callState', 'active')
      }
    } else if (statusCode === 401 || statusCode === 407) {
      console.log('[NativeSIP] Authentication required')
      this.handleAuthChallenge(accountId, message)
    } else if (statusCode === 180 || statusCode === 183) {
      console.log('[NativeSIP] Ringing')
      this.emit('callState', 'ringing')
    } else if (statusCode >= 400) {
      console.error(`[NativeSIP] Error response: ${statusCode}`)
      this.emit('error', statusCode)
    }
  }

  private handleRequest(accountId: string, message: SipMessage): void {
    const method = message.method!
    
    if (method === 'INVITE') {
      console.log('[NativeSIP] Incoming call')
      const from = message.headers.get('From') || ''
      const match = from.match(/sip:([^@]+)@/)
      const number = match ? match[1] : 'Unknown'
      this.emit('incomingCall', accountId, number)
    } else if (method === 'BYE') {
      console.log('[NativeSIP] Call ended by remote')
      this.emit('callState', 'ended')
    }
  }

  private handleAuthChallenge(accountId: string, message: SipMessage): void {
    const account = this.accounts.get(accountId)
    if (!account) return

    const wwwAuth = message.headers.get('WWW-Authenticate') || message.headers.get('Proxy-Authenticate')
    if (!wwwAuth) return

    console.log('[NativeSIP] Handling authentication challenge')
    // TODO: Implement digest authentication
    // This requires parsing the challenge and computing the response
    this.emit('authRequired', accountId)
  }

  private generateCallId(): string {
    return crypto.randomBytes(16).toString('hex')
  }

  private generateTag(): string {
    return crypto.randomBytes(8).toString('hex')
  }

  private generateBranch(): string {
    return 'z9hG4bK-' + crypto.randomBytes(16).toString('hex')
  }

  private getLocalIp(): string {
    const { networkInterfaces } = require('os')
    const nets = networkInterfaces()
    
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address
        }
      }
    }
    
    return '127.0.0.1'
  }

  private getLocalPort(accountId: string): number {
    const socket = this.sockets.get(accountId)
    if (socket instanceof dgram.Socket) {
      const addr = socket.address()
      return typeof addr === 'object' ? addr.port : 5060
    } else if (socket) {
      return (socket as any).localPort || 5060
    }
    return 5060
  }

  cleanup(): void {
    for (const [accountId] of this.sockets) {
      this.unregister(accountId)
    }
  }
}

// Per-account SIP transport (UDP/TCP/TLS) with Content-Length stream framing.

import * as dgram from 'dgram'
import * as net from 'net'
import * as tls from 'tls'
import { EventEmitter } from 'events'
import { splitStream } from './parser'
import * as os from 'os'

export interface TransportOptions {
  transport: 'UDP' | 'TCP' | 'TLS'
  server: string
  port: number
  servername?: string // SNI for TLS
  rejectUnauthorized?: boolean
}

export interface Rinfo {
  address: string
  port: number
}

// Reassembles a stream of `data` chunks into complete SIP messages by Content-Length.
export class Framer {
  private buffer = ''
  feed(chunk: string | Buffer, onMessage: (raw: string, rinfo: Rinfo) => void, rinfo: Rinfo): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('latin1')
    let msgs = splitStream(this.buffer)
    while (msgs.length > 0) {
      // Consume what splitStream could fully parse.
      const consumed = msgs.reduce((a, m) => a + m.length, 0)
      this.buffer = this.buffer.substring(consumed)
      for (const m of msgs) onMessage(m, rinfo)
      // Try to parse more from the remaining buffer.
      const next = splitStream(this.buffer)
      if (next.length === 0) break
      msgs = next
    }
  }
}

export class SipTransport extends EventEmitter {
  private socket: dgram.Socket | net.Socket | tls.TLSSocket | null = null
  private framer = new Framer()
  readonly localAddress: string
  localPort: number = 0
  private connected = false

  constructor(private opts: TransportOptions) {
    super()
    this.localAddress = getLocalIp()
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { transport, server, port } = this.opts
      const onMessage = (raw: string, rinfo: Rinfo) => this.emit('message', raw, rinfo)
      const onError = (err: Error) => {
        if (!this.connected) reject(err)
        else this.emit('error', err)
      }

      if (transport === 'UDP') {
        const s = dgram.createSocket('udp4')
        this.socket = s
        s.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
          // UDP datagrams are already framed — emit directly (no Content-Length split needed, but be safe).
          this.framer.feed(msg, onMessage, { address: rinfo.address, port: rinfo.port })
        })
        s.on('error', onError)
        s.bind(0, () => {
          const addr = s.address()
          this.localPort = typeof addr === 'object' ? addr.port : 0
          this.connected = true
          resolve()
        })
      } else if (transport === 'TCP') {
        const s = net.createConnection({ host: server, port })
        this.socket = s
        s.on('data', (data: Buffer) => this.framer.feed(data, onMessage, { address: server, port }))
        s.on('error', onError)
        s.on('connect', () => {
          this.localPort = s.localPort || 0
          this.connected = true
          resolve()
        })
      } else if (transport === 'TLS') {
        const s = tls.connect({
          host: server,
          port,
          servername: this.opts.servername || server,
          rejectUnauthorized: this.opts.rejectUnauthorized ?? true,
        })
        this.socket = s
        s.on('data', (data: Buffer) => this.framer.feed(data, onMessage, { address: server, port }))
        s.on('error', onError)
        s.on('secureConnect', () => {
          this.localPort = s.localPort || 0
          this.connected = true
          resolve()
        })
      } else {
        reject(new Error(`Unsupported transport: ${transport}`))
      }
    })
  }

  send(raw: string, port?: number, host?: string): void {
    if (!this.socket) throw new Error('transport not connected')
    const dstPort = port ?? this.opts.port
    const dstHost = host ?? this.opts.server
    const firstLine = raw.split('\r\n', 1)[0]
    console.log(`[NativeSIP] -> ${dstHost}:${dstPort} ${firstLine}`)
    if (this.socket instanceof dgram.Socket) {
      const buf = Buffer.from(raw, 'latin1')
      this.socket.send(buf, 0, buf.length, dstPort, dstHost)
    } else {
      ;(this.socket as net.Socket).write(raw, 'latin1')
    }
  }

  close(): void {
    if (!this.socket) return
    if (this.socket instanceof dgram.Socket) this.socket.close()
    else (this.socket as net.Socket).destroy()
    this.socket = null
    this.connected = false
  }
}

// Pick the local IPv4 that is most likely to reach `destHost`. For UDP we can't
// easily query the route, so prefer non-internal IPv4s, and prefer ones on a
// "normal" interface (en0/en1/Wi-Fi/Ethernet) over virtual/docker/bridge.
let cachedLocalIp: string | null = null
export function getLocalIp(): string {
  if (cachedLocalIp) return cachedLocalIp
  const nets = os.networkInterfaces()
  const candidates: { addr: string; priority: number }[] = []
  for (const name of Object.keys(nets)) {
    const list = nets[name]
    if (!list) continue
    for (const n of list) {
      if (n.family === 'IPv4' && !n.internal) {
        let priority = 5
        const lower = name.toLowerCase()
        if (/(wi-?fi|en0|en1|eth0|ethernet)/.test(lower)) priority = 10
        if (/(docker|veth|br-|virbr|vmnet|utun|tun|tap|ll\d+)/.test(lower)) priority = 1
        candidates.push({ addr: n.address, priority })
      }
    }
  }
  candidates.sort((a, b) => b.priority - a.priority)
  cachedLocalIp = candidates[0]?.addr || '127.0.0.1'
  return cachedLocalIp
}

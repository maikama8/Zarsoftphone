// UDP socket for RTP media, allocated from an ephemeral port range.

import * as dgram from 'dgram'
import { EventEmitter } from 'events'

export interface RtpRinfo {
  address: string
  port: number
}

export class RtpSocket extends EventEmitter {
  private socket: dgram.Socket | null = null
  port: number = 0

  async bind(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4')
      s.on('error', (err) => {
        this.emit('error', err)
        reject(err)
      })
      s.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        this.emit('message', msg, { address: rinfo.address, port: rinfo.port })
      })
      s.bind(0, () => {
        const addr = s.address()
        this.port = typeof addr === 'object' ? addr.port : 0
        this.socket = s
        resolve(this.port)
      })
    })
  }

  send(buf: Buffer, port: number, host: string): void {
    if (!this.socket) return
    this.socket.send(buf, 0, buf.length, port, host)
  }

  close(): void {
    if (this.socket) {
      try { this.socket.close() } catch { /* ignore */ }
      this.socket = null
    }
  }
}

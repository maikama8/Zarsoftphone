// RFC 3261 §17 transaction layer — client side (ICT/NICT) with retransmission
// and branch-keyed response matching. Server side is handled inline in the
// facade (simplified IST: retransmit 2xx on dup INVITE; NIST: respond + dedup).

import { EventEmitter } from 'events'
import type { SipMessage } from './parser'
import { getHeader, getParam } from './parser'

const T1 = 500
const T2 = 4000
const T4 = 5000
const TIMER_B = 64 * T1 // 32s — INVITE final timeout
const TIMER_F = 64 * T1 // 32s — non-INVITE final timeout

export type SendFn = (raw: string) => void

interface ClientTransaction {
  branch: string
  method: string
  raw: string
  send: SendFn
  onFinal: (resp: SipMessage) => void
  onProvisional?: (resp: SipMessage) => void
  retransmitTimer?: NodeJS.Timeout
  finalTimer?: NodeJS.Timeout
  retransmitInterval: number
  state: 'calling' | 'trying' | 'proceeding' | 'completed' | 'terminated'
  isInvite: boolean
}

export class TransactionLayer extends EventEmitter {
  private clientTxs: Map<string, ClientTransaction> = new Map()
  // Server-side dedup: branch -> last response sent (for retransmit on dup request).
  private serverTxs: Map<string, { method: string; response: string; t: NodeJS.Timeout }> = new Map()

  // Create a client transaction for an outgoing request. Returns the branch.
  sendClientTransaction(opts: {
    branch: string
    method: string
    raw: string
    send: SendFn
    isInvite: boolean
    onFinal: (resp: SipMessage) => void
    onProvisional?: (resp: SipMessage) => void
  }): string {
    const tx: ClientTransaction = {
      branch: opts.branch,
      method: opts.method,
      raw: opts.raw,
      send: opts.send,
      onFinal: opts.onFinal,
      onProvisional: opts.onProvisional,
      retransmitInterval: T1,
      state: opts.isInvite ? 'calling' : 'trying',
      isInvite: opts.isInvite,
    }
    this.clientTxs.set(opts.branch, tx)

    // Send immediately.
    opts.send(opts.raw)

    // Retransmission timer (Timer A for INVITE, Timer E for non-INVITE).
    this.scheduleRetransmit(tx)
    // Final timeout (Timer B / Timer F).
    tx.finalTimer = setTimeout(() => {
      if (tx.state === 'terminated') return
      tx.state = 'terminated'
      this.clearTimers(tx)
      this.clientTxs.delete(tx.branch)
      // Synthesize a 408-ish timeout — caller decides what to emit.
      opts.onFinal({ kind: 'response', statusCode: 0, reasonPhrase: 'Request Timeout', headers: [], body: '', raw: '' })
    }, opts.isInvite ? TIMER_B : TIMER_F)

    return opts.branch
  }

  private scheduleRetransmit(tx: ClientTransaction): void {
    if (tx.isInvite && (tx.state === 'proceeding' || tx.state === 'completed' || tx.state === 'terminated')) return
    if (!tx.isInvite && (tx.state === 'completed' || tx.state === 'terminated')) return
    tx.retransmitTimer = setTimeout(() => {
      if (tx.state === 'terminated') return
      tx.send(tx.raw)
      // Double up to T2.
      tx.retransmitInterval = Math.min(tx.retransmitInterval * 2, T2)
      this.scheduleRetransmit(tx)
    }, tx.retransmitInterval)
  }

  private clearTimers(tx: ClientTransaction): void {
    if (tx.retransmitTimer) clearTimeout(tx.retransmitTimer)
    if (tx.finalTimer) clearTimeout(tx.finalTimer)
  }

  // Match an incoming response to a client transaction by top Via branch.
  matchResponse(resp: SipMessage): ClientTransaction | undefined {
    const via = getHeader(resp, 'Via')
    if (!via) return undefined
    const branch = getParam(resp, 'Via', 'branch')
    if (branch) {
      const tx = this.clientTxs.get(branch)
      if (tx) return tx
    }
    // Fallback: match by CSeq method (less reliable).
    return undefined
  }

  // Feed an incoming response into the transaction layer.
  receiveResponse(resp: SipMessage): boolean {
    const tx = this.matchResponse(resp)
    if (!tx) return false
    const code = resp.statusCode || 0
    if (code >= 100 && code < 200) {
      if (tx.state === 'calling' || tx.state === 'trying') {
        tx.state = 'proceeding'
        // Stop INVITE retransmission on first provisional.
        if (tx.isInvite && tx.retransmitTimer) {
          clearTimeout(tx.retransmitTimer)
          tx.retransmitTimer = undefined
        }
        tx.onProvisional?.(resp)
      }
    } else if (code >= 200) {
      if (tx.state !== 'terminated') {
        tx.state = 'completed'
        this.clearTimers(tx)
        if (!tx.isInvite) {
          // Timer K: wait 5s then terminate (absorb retransmissions).
          tx.finalTimer = setTimeout(() => {
            tx.state = 'terminated'
            this.clientTxs.delete(tx.branch)
          }, T4)
        } else {
          // ICT: keep absorbing retransmitted 2xx (re-ACK handled by caller).
          // Mark terminated after a grace period.
          tx.finalTimer = setTimeout(() => {
            tx.state = 'terminated'
            this.clientTxs.delete(tx.branch)
          }, T4)
        }
        tx.onFinal(resp)
      }
    }
    return true
  }

  // Cancel/destroy a client transaction (e.g. CANCEL an INVITE). Does not send CANCEL.
  destroyClientTransaction(branch: string): void {
    const tx = this.clientTxs.get(branch)
    if (!tx) return
    tx.state = 'terminated'
    this.clearTimers(tx)
    this.clientTxs.delete(branch)
  }

  // --- Server-side dedup helpers ---

  // Returns true if we've already seen this branch (retransmitted request).
  seenServerBranch(branch: string): boolean {
    return this.serverTxs.has(branch)
  }

  // Remember the response we sent for a branch, and replay it on retransmission.
  rememberServerResponse(branch: string, method: string, responseRaw: string, isInvite2xx: boolean): void {
    const existing = this.serverTxs.get(branch)
    if (existing) clearTimeout(existing.t)
    const t = setTimeout(() => {
      this.serverTxs.delete(branch)
    }, isInvite2xx ? TIMER_B : T4)
    this.serverTxs.set(branch, { method, response: responseRaw, t })
  }

  // On a retransmitted server request, retrieve the last response we sent (for retransmit).
  getServerResponse(branch: string): string | undefined {
    return this.serverTxs.get(branch)?.response
  }

  clearServerBranch(branch: string): void {
    const e = this.serverTxs.get(branch)
    if (e) { clearTimeout(e.t); this.serverTxs.delete(branch) }
  }
}

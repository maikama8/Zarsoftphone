// RFC 3261 §12 dialog state.

import type { SipMessage } from './parser'
import { getHeader, parseParams, getHeaders } from './parser'

export interface DialogState {
  callId: string
  localTag: string
  remoteTag: string
  remoteTargetUri: string // Contact URI of peer
  routeSet: string[] // Record-Route, ordered for our role
  localCSeq: number
  remoteCSeq: number
  direction: 'caller' | 'callee'
  state: 'early' | 'confirmed' | 'terminated'
  // For INVITE dialog usage: the branch/branch-prefix of the original INVITE (for CANCEL).
  inviteBranch?: string
}

// Extract the URI inside a Contact/From/To header value (the <...> or the bare token).
export function extractUri(headerValue: string): string {
  const v = headerValue.trim()
  const lt = v.indexOf('<')
  const gt = v.indexOf('>')
  if (lt !== -1 && gt !== -1 && gt > lt) return v.substring(lt + 1, gt)
  // Bare URI without angle brackets: take up to first ';'
  const semi = v.indexOf(';')
  return (semi === -1 ? v : v.substring(0, semi)).trim()
}

function tagsFrom(value: string): { tag?: string } {
  return { tag: parseParams(value).params.tag }
}

// Build a dialog from a UAC 2xx response to our INVITE.
export function dialogFromUac2xx(inviteRequest: SipMessage, resp: SipMessage): DialogState {
  const callId = getHeader(inviteRequest, 'Call-ID') || ''
  const fromHdr = getHeader(inviteRequest, 'From') || ''
  const localTag = tagsFrom(fromHdr).tag || ''
  const toHdr = getHeader(resp, 'To') || ''
  const remoteTag = tagsFrom(toHdr).tag || ''
  const contact = getHeader(resp, 'Contact')
  const remoteTargetUri = contact ? extractUri(contact) : ''
  // Route set for UAC = Record-Route from response in received order.
  const routeSet = getHeaders(resp, 'Record-Route').map(h => h.value)
  const cseqHdr = getHeader(inviteRequest, 'CSeq') || ''
  const cseqNum = parseInt(cseqHdr.split(/\s+/)[0], 10) || 1
  return {
    callId, localTag, remoteTag, remoteTargetUri, routeSet,
    localCSeq: cseqNum, remoteCSeq: 0, direction: 'caller', state: 'confirmed',
  }
}

// Build a dialog from an inbound INVITE we received (UAS side).
export function dialogFromUasInvite(invite: SipMessage, localTag: string): DialogState {
  const callId = getHeader(invite, 'Call-ID') || ''
  const fromHdr = getHeader(invite, 'From') || ''
  const remoteTag = tagsFrom(fromHdr).tag || ''
  const contact = getHeader(invite, 'Contact')
  const remoteTargetUri = contact ? extractUri(contact) : (getHeader(invite, 'From') ? extractUri(getHeader(invite, 'From')!) : '')
  // Route set for UAS = Record-Route reversed.
  const routeSet = getHeaders(invite, 'Record-Route').map(h => h.value).reverse()
  const cseqHdr = getHeader(invite, 'CSeq') || ''
  const remoteCSeq = parseInt(cseqHdr.split(/\s+/)[0], 10) || 1
  return {
    callId, localTag, remoteTag, remoteTargetUri, routeSet,
    localCSeq: 0, remoteCSeq, direction: 'callee', state: 'early',
  }
}

export function nextCSeq(dialog: DialogState): number {
  dialog.localCSeq += 1
  return dialog.localCSeq
}

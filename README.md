# Zarsip

A compact, MicroSIP-style SIP softphone for macOS (and Windows/Linux) built with **Electron**, **React**, and **TypeScript**. Designed for speed and usability — small window, dense UI, no wasted space.

![Stack](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![Stack](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Stack](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/SIP.js-0.21-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Compact 340 × 620 window** — fits comfortably on any screen, no wasted space
- **Multiple SIP accounts** — add, enable/disable, and switch between accounts from the header dropdown
- **One-click calling** — type a number or click a contact, hit Call
- **Collapsible dial pad** — 3 × 4 DTMF pad that shows/hides on demand
- **Call controls** — mute, hold, DTMF, transfer, hangup in a single compact row
- **Incoming call banner** — compact bottom overlay (not a full-screen takeover)
- **Contacts** — searchable list with favorites, inline call/edit/delete
- **Call history** — filter by All / Incoming / Outgoing / Missed, click to redial
- **Transport support** — WSS · WS · UDP · TCP · TLS
- **WebRTC media** — STUN/TURN support, automatic mic/speaker routing
- **Local SQLite storage** — accounts, contacts, history with AES-encrypted passwords
- **Native macOS notifications** for incoming calls
- **Dark theme** with macOS system font

---

## Screenshots

> The app opens at 340 × 620 px — a slim vertical window similar to MicroSIP.

```
┌──────────────────────────────────────┐
│ ● ● ●  user@sip.example.com  ⚙  +  │  ← header: traffic lights + account switcher
├──────────────────────────────────────┤
│            +1 (555) 000-1234    ⌫   │  ← number input
├──────────────────────────────────────┤
│       [  📞 Call  ]   [⌨]          │  ← controls
├─────────┬────────┬────────┬──────────┤
│    1    │  2 ABC │  3 DEF │          │
│  4 GHI  │  5 JKL │  6 MNO │  dialpad │
│  7 PQRS │  8 TUV │  9 WXYZ│          │
│    *    │   0 +  │    #   │          │
├──────────────────────────────────────┤
│ Contacts │ History │ Messages        │  ← tabs
├──────────────────────────────────────┤
│ [A] Alice Smith   1001   📞         │
│ [B] Bob Jones     1002   📞         │  ← compact list
│ ...                                  │
└──────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| UI framework | React 18 + TypeScript |
| Desktop shell | Electron 28 |
| SIP / WebRTC | SIP.js 0.21 |
| Styling | TailwindCSS 3 |
| State | Zustand |
| Storage | better-sqlite3 (AES-encrypted passwords) |
| Build | Vite 5 + electron-builder |

---

## Getting Started

### Prerequisites

- Node.js 18+
- macOS (primary target), Windows and Linux supported via Electron

### Install

```bash
git clone https://github.com/maikama8/Zarsoftphone.git
cd Zarsoftphone
npm install
```

### Development

```bash
npm run dev
```

Opens the Electron window with Vite hot-reload and DevTools.

### Production Build

```bash
# macOS .dmg
npm run dist:mac

# Windows installer
npm run dist:win

# Linux AppImage
npm run dist:linux
```

Output goes to `release/`.

---

## SIP Account Setup

Click the **+** button in the top-right corner of the app (or open **Settings → Accounts → Add account**) and fill in:

| Field | Example |
|---|---|
| Display name | Work Phone |
| Username | 1001 |
| Password | ••••••• |
| SIP domain | sip.example.com |
| SIP server | sip.example.com |
| Transport | WSS (recommended for WebRTC) |
| Port | 443 (WSS) or 5060 (UDP/TCP) |

The account registers immediately after saving. A colored dot in the header shows registration status:
- **Green** — registered
- **Yellow** (pulsing) — registering
- **Red** — failed / offline

---

## Making and Receiving Calls

**Make a call:**
1. Type a number in the input field (or click a contact's phone icon)
2. Press **Call** or hit Enter

**Receive a call:**
- A compact banner appears at the bottom with the caller ID
- Click the **green** button to answer, **red** to decline

**During a call:**
- **Mute** / **Hold** / **DTMF pad** / **End** — all in one compact control row
- Live call timer and audio waveform indicator

---

## Project Structure

```
zarsoftphone/
├── electron/
│   ├── main.ts          # BrowserWindow, IPC handlers, system tray
│   ├── preload.ts       # contextBridge API exposed to renderer
│   └── database.ts      # SQLite CRUD + AES password encryption
├── src/
│   ├── components/
│   │   ├── TitleBar.tsx          # Compact header: traffic lights + account switcher
│   │   ├── AddAccountModal.tsx   # Add-account popup
│   │   ├── CompactContacts.tsx   # Dense contacts list
│   │   ├── CompactHistory.tsx    # Dense call history list
│   │   ├── CompactSettings.tsx   # Settings popup (accounts / audio / general)
│   │   └── IncomingCallModal.tsx # Incoming call compact banner
│   ├── pages/
│   │   └── Dialer.tsx            # Number input + controls + dial pad
│   ├── services/sip/
│   │   └── SipService.ts         # SIP.js wrapper (multi-account, WebRTC)
│   ├── store/
│   │   └── index.ts              # Zustand global state
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces
│   ├── App.tsx                   # Root layout
│   └── index.css                 # Tailwind + compact utility classes
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

---

## Configuration

### Supported SIP Servers

Works with any standard SIP server that supports WebSocket transport:

- **FreeSWITCH**
- **Asterisk** (with `chan_sip` or `PJSIP`)
- **Kamailio**
- **OpenSIPS**
- Any hosted SIP provider supporting WSS

### STUN / TURN

Add your STUN/TURN servers in **Settings → Accounts → Edit** (Advanced section) per account:

```
STUN: stun:stun.l.google.com:19302
TURN: turn:turn.example.com:3478
```

---

## Security Notes

- Passwords are stored encrypted with AES in the local SQLite database
- **Change the encryption key** in `electron/database.ts` before distributing
- Use **WSS** transport to encrypt SIP signaling
- Enable **SRTP** on your SIP server for encrypted media

---

## Roadmap

- [ ] Video calls
- [ ] Attended and blind call transfer
- [ ] Conference / 3-way calling
- [ ] Chat / instant messaging
- [ ] Presence and BLF
- [ ] Call recording
- [ ] Auto-provisioning
- [ ] Windows / Linux packaging CI
- [ ] Light theme

---

## License

[MIT](LICENSE)

---

## Credits

Built with [Electron](https://www.electronjs.org/), [React](https://react.dev/), [SIP.js](https://sipjs.com/), [TailwindCSS](https://tailwindcss.com/), [Zustand](https://github.com/pmndrs/zustand), and [Lucide Icons](https://lucide.dev/).

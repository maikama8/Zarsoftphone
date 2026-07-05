import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import CryptoJS from 'crypto-js'

const ENCRYPTION_KEY = 'zarsip-secret-key-change-in-production'

let db: Database.Database

export function initDatabase() {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'softphone.db')
  
  db = new Database(dbPath)

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      domain TEXT NOT NULL,
      server TEXT NOT NULL,
      transport TEXT DEFAULT 'WSS',
      port INTEGER DEFAULT 443,
      registration_expiry INTEGER DEFAULT 600,
      stun_server TEXT,
      turn_server TEXT,
      is_enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      sip_number TEXT NOT NULL,
      notes TEXT,
      avatar TEXT,
      is_favorite INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_history (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      name TEXT,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      duration INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      account_id TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Idempotent migrations for new columns (auth_user, realm, proxy).
  const cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]
  const hasCol = (name: string) => cols.some(c => c.name === name)
  if (!hasCol('auth_user')) db.exec("ALTER TABLE accounts ADD COLUMN auth_user TEXT")
  if (!hasCol('realm')) db.exec("ALTER TABLE accounts ADD COLUMN realm TEXT")
  if (!hasCol('proxy')) db.exec("ALTER TABLE accounts ADD COLUMN proxy TEXT")

  // Initialize default settings if not exists
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number }
  if (settingsCount.count === 0) {
    const defaultSettings = {
      general: {
        launchAtStartup: false,
        minimizeToTray: true,
        autoAnswer: false,
        startHidden: false,
      },
      audio: {
        ringtoneVolume: 80,
      },
      theme: 'dark',
      notifications: {
        enabled: true,
        showIncomingCalls: true,
      },
    }
    
    for (const [key, value] of Object.entries(defaultSettings)) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
    }
  }
}

// Encryption helpers
function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString()
}

function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY)
  return bytes.toString(CryptoJS.enc.Utf8)
}

// Account operations
export function getAccounts() {
  const accounts = db.prepare('SELECT * FROM accounts').all() as any[]
  return accounts.map(acc => ({
    ...acc,
    password: decrypt(acc.password),
    isEnabled: Boolean(acc.is_enabled),
    isDefault: Boolean(acc.is_default),
    transport: acc.transport as any,
    // Fix the snake_case round-trip: rename DB columns to the camelCase the UI uses.
    stunServer: acc.stun_server ?? null,
    turnServer: acc.turn_server ?? null,
    registrationExpiry: acc.registration_expiry ?? 600,
    authUser: acc.auth_user ?? acc.username,
    realm: acc.realm ?? null,
    proxy: acc.proxy ?? null,
  }))
}

export function addAccount(account: any) {
  const id = uuidv4()
  const stmt = db.prepare(`
    INSERT INTO accounts (
      id, display_name, username, password, domain, server,
      transport, port, registration_expiry, stun_server, turn_server,
      is_enabled, is_default, auth_user, realm, proxy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    account.displayName,
    account.username,
    encrypt(account.password),
    account.domain,
    account.server,
    account.transport,
    account.port,
    account.registrationExpiry,
    account.stunServer || null,
    account.turnServer || null,
    account.isEnabled ? 1 : 0,
    account.isDefault ? 1 : 0,
    account.authUser || account.username,
    account.realm || null,
    account.proxy || null
  )

  return id
}

export function updateAccount(id: string, account: any) {
  const updates: string[] = []
  const values: any[] = []
  
  if (account.displayName !== undefined) {
    updates.push('display_name = ?')
    values.push(account.displayName)
  }
  if (account.username !== undefined) {
    updates.push('username = ?')
    values.push(account.username)
  }
  if (account.password !== undefined) {
    updates.push('password = ?')
    values.push(encrypt(account.password))
  }
  if (account.domain !== undefined) {
    updates.push('domain = ?')
    values.push(account.domain)
  }
  if (account.server !== undefined) {
    updates.push('server = ?')
    values.push(account.server)
  }
  if (account.transport !== undefined) {
    updates.push('transport = ?')
    values.push(account.transport)
  }
  if (account.port !== undefined) {
    updates.push('port = ?')
    values.push(account.port)
  }
  if (account.registrationExpiry !== undefined) {
    updates.push('registration_expiry = ?')
    values.push(account.registrationExpiry)
  }
  if (account.stunServer !== undefined) {
    updates.push('stun_server = ?')
    values.push(account.stunServer)
  }
  if (account.turnServer !== undefined) {
    updates.push('turn_server = ?')
    values.push(account.turnServer)
  }
  if (account.authUser !== undefined) {
    updates.push('auth_user = ?')
    values.push(account.authUser)
  }
  if (account.realm !== undefined) {
    updates.push('realm = ?')
    values.push(account.realm)
  }
  if (account.proxy !== undefined) {
    updates.push('proxy = ?')
    values.push(account.proxy)
  }
  if (account.isEnabled !== undefined) {
    updates.push('is_enabled = ?')
    values.push(account.isEnabled ? 1 : 0)
  }
  if (account.isDefault !== undefined) {
    updates.push('is_default = ?')
    values.push(account.isDefault ? 1 : 0)
  }
  
  if (updates.length > 0) {
    values.push(id)
    db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  }
}

export function deleteAccount(id: string) {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

// Contact operations
export function getContacts() {
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY name').all() as any[]
  return contacts.map(c => ({
    ...c,
    isFavorite: Boolean(c.is_favorite),
    createdAt: c.created_at,
  }))
}

export function addContact(contact: any) {
  const id = uuidv4()
  const stmt = db.prepare(`
    INSERT INTO contacts (id, name, company, sip_number, notes, avatar, is_favorite, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    id,
    contact.name,
    contact.company || null,
    contact.sipNumber,
    contact.notes || null,
    contact.avatar || null,
    contact.isFavorite ? 1 : 0,
    Date.now()
  )
  
  return id
}

export function updateContact(id: string, contact: any) {
  const updates: string[] = []
  const values: any[] = []
  
  if (contact.name !== undefined) {
    updates.push('name = ?')
    values.push(contact.name)
  }
  if (contact.company !== undefined) {
    updates.push('company = ?')
    values.push(contact.company)
  }
  if (contact.sipNumber !== undefined) {
    updates.push('sip_number = ?')
    values.push(contact.sipNumber)
  }
  if (contact.notes !== undefined) {
    updates.push('notes = ?')
    values.push(contact.notes)
  }
  if (contact.isFavorite !== undefined) {
    updates.push('is_favorite = ?')
    values.push(contact.isFavorite ? 1 : 0)
  }
  
  if (updates.length > 0) {
    values.push(id)
    db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  }
}

export function deleteContact(id: string) {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id)
}

// Call history operations
export function getCallHistory() {
  const history = db.prepare('SELECT * FROM call_history ORDER BY timestamp DESC LIMIT 100').all() as any[]
  return history.map(h => ({
    ...h,
    accountId: h.account_id,
  }))
}

export function addCallHistory(call: any) {
  const id = uuidv4()
  const stmt = db.prepare(`
    INSERT INTO call_history (id, number, name, direction, status, duration, timestamp, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    id,
    call.number,
    call.name || null,
    call.direction,
    call.status,
    call.duration,
    call.timestamp,
    call.accountId
  )
  
  return id
}

// Settings operations
export function getSettings() {
  const rows = db.prepare('SELECT * FROM settings').all() as any[]
  const settings: any = {}
  
  for (const row of rows) {
    settings[row.key] = JSON.parse(row.value)
  }
  
  return settings
}

export function updateSettings(settings: any) {
  for (const [key, value] of Object.entries(settings)) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
  }
}

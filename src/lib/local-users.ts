/**
 * Local file-based user store.
 * Users are persisted to .data/users.json — no external backend required.
 */
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'

export interface LocalUser {
  id: string
  email: string
  name: string
  passwordHash: string
  createdAt: string
}

const DATA_DIR = path.join(process.cwd(), '.data')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf-8')
}

function readUsers(): LocalUser[] {
  ensureFile()
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as LocalUser[]
  } catch {
    return []
  }
}

function writeUsers(users: LocalUser[]) {
  ensureFile()
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8')
}

export function findUserByEmail(email: string): LocalUser | undefined {
  return readUsers().find(u => u.email.toLowerCase() === email.toLowerCase())
}

export function findUserById(id: string): LocalUser | undefined {
  return readUsers().find(u => u.id === id)
}

export async function createUser(email: string, password: string, name: string): Promise<LocalUser> {
  const users = readUsers()

  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('Пользователь с таким email уже существует')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const user: LocalUser = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    email,
    name: name || email.split('@')[0],
    passwordHash,
    createdAt: new Date().toISOString(),
  }

  users.push(user)
  writeUsers(users)
  return user
}

export async function verifyUser(email: string, password: string): Promise<LocalUser | null> {
  const user = findUserByEmail(email)
  if (!user) return null
  const valid = await bcrypt.compare(password, user.passwordHash)
  return valid ? user : null
}

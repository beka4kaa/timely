/**
 * contest-api.ts — typed client for the contest / task / leaderboard system.
 *
 * Follows the app's established pattern: direct calls to BACKEND_URL via
 * authFetch (which injects the X-User-Email header from the next-auth session).
 * Reused by the admin dashboard, contests pages, and leaderboards.
 */
"use client"

import { useCallback, useEffect, useState } from "react"
import { authFetch } from "@/lib/auth-fetch"
import { BACKEND_URL } from "@/lib/api-utils"

export type Difficulty = "easy" | "medium" | "hard"
export type SubmissionStatus = "pending" | "approved" | "rejected"

export interface Me {
  id: number
  email: string
  username: string
  name: string
  overall_elo: number
  is_staff: boolean
  is_moderator: boolean
  is_admin: boolean
  has_full_access: boolean
  ai_plan: "free" | "pro" | "max"
  authenticated?: boolean
}

export interface ContestTask {
  id: number
  title: string
  condition_text: string
  difficulty: Difficulty
  points: number
  status: string
  author_name: string
  created_at: string | null
}

export interface Submission {
  id: number
  student: number
  student_name: string
  student_email: string
  task: number
  task_title: string
  task_points: number
  file_url_or_code: string
  student_solution_image: string
  status: SubmissionStatus
  created_at: string
}

export interface Contest {
  id: number
  title: string
  description: string
  start_time: string
  end_time: string
  tasks: number[]
  task_details: ContestTask[]
  created_at: string
}

export interface LeaderboardUser {
  id: number
  username: string
  country_code: string | null
  city: string | null
  overall_elo: number
  ratings: { discipline_name: string; elo_score: number; tier_level: string }[]
}

export interface PrivateBoard {
  id: number
  name: string
  owner: number
  owner_name: string
  members: LeaderboardUser[]
  created_at: string
}

export interface AdminUser {
  id: number
  email: string
  username: string
  name: string
  overall_elo: number
  contribution_points: number
  is_staff: boolean
  is_superuser: boolean
  is_moderator: boolean
  is_admin: boolean
  has_full_access: boolean
  ai_plan: "free" | "pro" | "max"
  date_joined: string
  last_login: string | null
  submissions_total: number
  submissions_approved: number
  submissions_pending: number
  submissions_rejected: number
}

const url = (path: string) => `${BACKEND_URL}${path}`

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.error || body.detail || JSON.stringify(body)
    } catch {
      /* non-json error body */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

// ── current user / role ──────────────────────────────────────────────
export const getMe = async (): Promise<Me> => unwrap(await authFetch(url("/api/me/")))

// ── tasks ────────────────────────────────────────────────────────────
export const listTasks = async (): Promise<ContestTask[]> =>
  unwrap(await authFetch(url("/api/tasks/")))

export const createTask = async (data: Partial<ContestTask>): Promise<ContestTask> =>
  unwrap(await authFetch(url("/api/tasks/"), { method: "POST", body: JSON.stringify(data) }))

export const updateTask = async (id: number, data: Partial<ContestTask>): Promise<ContestTask> =>
  unwrap(await authFetch(url(`/api/tasks/${id}/`), { method: "PATCH", body: JSON.stringify(data) }))

// ── contests ─────────────────────────────────────────────────────────
export const listContests = async (): Promise<Contest[]> =>
  unwrap(await authFetch(url("/api/contests/")))

export const createContest = async (data: {
  title: string
  description?: string
  start_time: string
  end_time: string
  tasks: number[]
}): Promise<Contest> =>
  unwrap(await authFetch(url("/api/contests/"), { method: "POST", body: JSON.stringify(data) }))

// ── submissions ──────────────────────────────────────────────────────
export const listMySubmissions = async (): Promise<Submission[]> =>
  unwrap(await authFetch(url("/api/submissions/")))

export const createSubmission = async (data: {
  task: number
  file_url_or_code: string
}): Promise<Submission> =>
  unwrap(await authFetch(url("/api/submissions/"), { method: "POST", body: JSON.stringify(data) }))

export const listPendingSubmissions = async (): Promise<Submission[]> =>
  unwrap(await authFetch(url("/api/submissions/pending/")))

export const approveSubmission = async (id: number): Promise<Submission> =>
  unwrap(await authFetch(url(`/api/submissions/${id}/approve/`), { method: "POST" }))

export const rejectSubmission = async (id: number): Promise<Submission> =>
  unwrap(await authFetch(url(`/api/submissions/${id}/reject/`), { method: "POST" }))

// ── leaderboards ─────────────────────────────────────────────────────
export const listGlobalLeaderboard = async (): Promise<LeaderboardUser[]> =>
  unwrap(await authFetch(url("/api/leaderboard/")))

export const listPrivateBoards = async (): Promise<PrivateBoard[]> =>
  unwrap(await authFetch(url("/api/private-leaderboards/")))

export const createPrivateBoard = async (name: string): Promise<PrivateBoard> =>
  unwrap(await authFetch(url("/api/private-leaderboards/"), { method: "POST", body: JSON.stringify({ name }) }))

export const addBoardMember = async (
  id: number,
  member: { userId?: number; identifier?: string },
): Promise<PrivateBoard> =>
  unwrap(
    await authFetch(url(`/api/private-leaderboards/${id}/add-member/`), {
      method: "POST",
      body: JSON.stringify({ user_id: member.userId, identifier: member.identifier }),
    }),
  )

export interface UserSearchResult {
  id: number
  name: string
  username: string
  email: string
  overall_elo: number
}

export const searchUsers = async (q: string): Promise<UserSearchResult[]> =>
  unwrap(await authFetch(url(`/api/users/search/?q=${encodeURIComponent(q)}`)))

// ── admin users / access ────────────────────────────────────────────
export const listAdminUsers = async (q = ""): Promise<AdminUser[]> =>
  unwrap(await authFetch(url(`/api/admin/users/${q ? `?q=${encodeURIComponent(q)}` : ""}`)))

export const updateAdminUserAccess = async (
  id: number,
  data: Partial<Pick<AdminUser, "has_full_access" | "is_moderator" | "is_staff" | "ai_plan">>,
): Promise<AdminUser> =>
  unwrap(await authFetch(url(`/api/admin/users/${id}/access/`), { method: "PATCH", body: JSON.stringify(data) }))

// ── role hook ────────────────────────────────────────────────────────
export function useMe() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    getMe()
      .then((m) => setMe(m.authenticated === false ? null : m))
      .catch(() => setMe(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { me, loading, refresh }
}

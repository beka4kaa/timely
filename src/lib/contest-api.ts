/**
 * contest-api.ts — typed client for the contest / task / leaderboard system.
 *
 * Follows the app's established pattern: direct calls to BACKEND_URL via
 * authFetch (which attaches a token signed from the next-auth session).
 * Reused by the admin dashboard, contests pages, and leaderboards.
 */
"use client"

import { useCallback, useEffect, useState } from "react"
import { authFetch } from "@/lib/auth-fetch"
import { BACKEND_URL } from "@/lib/api-utils"
import { collectBoard } from "@/lib/rating-view"

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
  /** «О себе». Видит только сам ученик: в рейтинге и поиске этого поля нет. */
  bio: string
  /** Согласие показываться другим в рейтинге и поиске. Себя ученик видит всегда. */
  show_in_leaderboard: boolean
  /** Под этим именем ученика увидят другие. Адреса в нём нет. */
  public_username: string
  /** Свой город. Другим он не виден: в рейтинге этого поля нет. */
  city: string | null
  authenticated?: boolean
}

/** Задача из банка задач админки (старый раздел «Задачи»). */
export interface BankTask {
  id: number
  title: string
  condition_text: string
  difficulty: Difficulty
  points: number
  status: string
  author_name: string
  created_at: string | null
}

export type ContestTier = 1 | 2 | 3 | 4 | 5
export type ContestArtName =
  | "rings" | "throw" | "orbits" | "waves" | "sun" | "grid"
  | "cells" | "stars" | "triangles" | "spiral" | "steps" | "code"
export type ContestState = "upcoming" | "running" | "ended"

/**
 * Задача контеста глазами ученика. До начала задач нет вовсе, после начала есть номер,
 * баллы и есть ли PDF, а ответ, решение и текст для разбора приходят только после конца.
 */
export interface ContestTask {
  id: number
  number: number
  title: string
  points: number
  has_statement: boolean
  /** Текст условия есть только у старых задач без PDF. */
  condition_text: string
  answer?: string
  has_solution?: boolean
  review_text?: string
}

export interface MyTaskResult {
  task: number
  attempts: number
  solved: boolean
  last_answer: string
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
  reviewed_at: string | null
  created_at: string
}

export interface Contest {
  id: number
  title: string
  description: string
  start_time: string
  end_time: string
  tier: ContestTier
  art: ContestArtName
  state: ContestState
  /** Номера задач по порядку: сколько их, видно и до начала. */
  tasks: number[]
  task_count: number
  points_total: number
  task_details: ContestTask[]
  /** Свои попытки по задачам: только в ответе на один контест. */
  mine?: MyTaskResult[]
  created_at: string
}

export interface AnswerResult {
  correct: boolean
  points: number
  attempt: number
  solved: boolean
}

export interface StandingRow {
  place: number
  name: string
  me: boolean
  points: number
  solved: number
  penalty: number
  marks: Array<"solved" | "tried" | "none">
}

export interface AttemptRow {
  id: number
  /** Секунды от начала контеста. */
  at: number
  name: string
  me: boolean
  task: number
  correct: boolean
}

export interface ContestFileInfo {
  id: number
  name: string
  size: number
  pages: number
}

export interface AdminContestTask {
  id: number
  number: number
  title: string
  condition_text: string
  answer: string
  points: number
  statement: ContestFileInfo | null
  solution: ContestFileInfo | null
}

export interface AdminContest {
  id: number
  title: string
  description: string
  start_time: string
  end_time: string
  tier: ContestTier
  art: ContestArtName
  state: ContestState
  created_at: string
  is_published: boolean
  points_total: number
  tier_cap: number
  participants: number
  attempts: number
  can_delete: boolean
  /** Опубликован и уже начался: задачи, ответы, баллы, тир и начало не меняются. */
  locked: boolean
  tasks: AdminContestTask[]
}

export interface AdminContestInput {
  title: string
  description: string
  start_time: string
  end_time: string
  tier: ContestTier
  art: ContestArtName
  tasks: Array<{
    id?: number
    answer: string
    points: number
    statement_file: number | null
    solution_file: number | null
  }>
}

export interface ContestProblem {
  code: string
  field: string
  message: string
}

/** Отказ сервера по контестам: код для логики и текст, который можно показать. */
export class ContestApiError extends Error {
  status: number
  code: string
  problems: ContestProblem[]

  constructor(status: number, code: string, message: string, problems: ContestProblem[] = []) {
    super(message)
    this.name = "ContestApiError"
    this.status = status
    this.code = code
    this.problems = problems
  }
}

export interface LeaderboardUser {
  id: number
  username: string
  country_code: string | null
  overall_elo: number
  ratings: { discipline_name: string; elo_score: number; tier_level: string }[]
}

export interface LeaderboardPage {
  count: number
  next: string | null
  previous: string | null
  results: LeaderboardUser[]
}

export interface PrivateBoard {
  id: number
  name: string
  owner: number
  owner_name: string
  members: LeaderboardUser[]
  /** Код для вступления. Сервер отдаёт его только создателю. */
  invite_code?: string
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
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── current user / role ──────────────────────────────────────────────
export const getMe = async (): Promise<Me> => unwrap(await authFetch(url("/api/me/")))

/** Меняются только описание и показ в рейтинге: роли и баллы сервер через этот адрес не принимает. */
export const updateMe = async (data: Partial<Pick<Me, "bio" | "show_in_leaderboard">>): Promise<Me> =>
  unwrap(await authFetch(url("/api/me/"), { method: "PATCH", body: JSON.stringify(data) }))

// ── tasks ────────────────────────────────────────────────────────────
export const listTasks = async (): Promise<BankTask[]> =>
  unwrap(await authFetch(url("/api/tasks/")))

export const createTask = async (data: Partial<BankTask>): Promise<BankTask> =>
  unwrap(await authFetch(url("/api/tasks/"), { method: "POST", body: JSON.stringify(data) }))

export const updateTask = async (id: number, data: Partial<BankTask>): Promise<BankTask> =>
  unwrap(await authFetch(url(`/api/tasks/${id}/`), { method: "PATCH", body: JSON.stringify(data) }))

// ── contests ─────────────────────────────────────────────────────────
/** Ответ сервера или `ContestApiError` с кодом и списком проблем формы. */
export async function contestReply<T>(res: Response): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T
  let body: { error?: string; detail?: string; code?: string; problems?: ContestProblem[] } = {}
  try {
    body = await res.json()
  } catch {
    /* non-json error body */
  }
  throw new ContestApiError(
    res.status,
    body.code ?? "error",
    body.error ?? body.detail ?? res.statusText,
    Array.isArray(body.problems) ? body.problems : [],
  )
}

export const listContests = async (): Promise<Contest[]> =>
  unwrap(await authFetch(url("/api/contests/")))

export const getContest = async (id: number): Promise<Contest> =>
  contestReply(await authFetch(url(`/api/contests/${id}/`)))

export const answerTask = async (contestId: number, taskId: number, answer: string): Promise<AnswerResult> =>
  contestReply(
    await authFetch(url(`/api/contests/${contestId}/answer/`), {
      method: "POST",
      body: JSON.stringify({ task: taskId, answer }),
    }),
  )

export const getStandings = async (id: number): Promise<StandingRow[]> =>
  contestReply(await authFetch(url(`/api/contests/${id}/standings/`)))

export const getAttempts = async (id: number, mine = false): Promise<AttemptRow[]> =>
  contestReply(await authFetch(url(`/api/contests/${id}/attempts/${mine ? "?mine=1" : ""}`)))

// ── admin contests ───────────────────────────────────────────────────
export const listAdminContests = async (): Promise<AdminContest[]> =>
  contestReply(await authFetch(url("/api/admin/contests/")))

export const getAdminContest = async (id: number): Promise<AdminContest> =>
  contestReply(await authFetch(url(`/api/admin/contests/${id}/`)))

export const createAdminContest = async (input: AdminContestInput): Promise<AdminContest> =>
  contestReply(await authFetch(url("/api/admin/contests/"), { method: "POST", body: JSON.stringify(input) }))

export const updateAdminContest = async (id: number, input: AdminContestInput): Promise<AdminContest> =>
  contestReply(await authFetch(url(`/api/admin/contests/${id}/`), { method: "PATCH", body: JSON.stringify(input) }))

export const publishAdminContest = async (id: number): Promise<AdminContest> =>
  contestReply(await authFetch(url(`/api/admin/contests/${id}/publish/`), { method: "POST" }))

export const unpublishAdminContest = async (id: number): Promise<AdminContest> =>
  contestReply(await authFetch(url(`/api/admin/contests/${id}/unpublish/`), { method: "POST" }))

export const deleteAdminContest = async (id: number): Promise<void> =>
  contestReply(await authFetch(url(`/api/admin/contests/${id}/`), { method: "DELETE" }))

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
export const listGlobalLeaderboard = (): Promise<LeaderboardUser[]> =>
  collectBoard(async (page) => unwrap(await authFetch(url(`/api/leaderboard/?page=${page}`))))

/** Строка одного ученика из рейтинга: всё, что о нём можно показать другим. */
export const getLeaderboardUser = async (id: number): Promise<LeaderboardUser> =>
  unwrap(await authFetch(url(`/api/leaderboard/${id}/`)))

export const listPrivateBoards = async (): Promise<PrivateBoard[]> =>
  unwrap(await authFetch(url("/api/private-leaderboards/")))

export const createPrivateBoard = async (name: string): Promise<PrivateBoard> =>
  unwrap(await authFetch(url("/api/private-leaderboards/"), { method: "POST", body: JSON.stringify({ name }) }))

/** В группу вступают только сами, по коду от создателя: добавить другого человека нельзя. */
export const joinPrivateBoard = async (code: string): Promise<PrivateBoard> =>
  unwrap(await authFetch(url("/api/private-leaderboards/join/"), { method: "POST", body: JSON.stringify({ code }) }))

export const leavePrivateBoard = async (id: number): Promise<void> =>
  unwrap(await authFetch(url(`/api/private-leaderboards/${id}/leave/`), { method: "POST" }))

export const deletePrivateBoard = async (id: number): Promise<void> =>
  unwrap(await authFetch(url(`/api/private-leaderboards/${id}/`), { method: "DELETE" }))

/** Старый код перестаёт работать. */
export const resetBoardCode = async (id: number): Promise<PrivateBoard> =>
  unwrap(await authFetch(url(`/api/private-leaderboards/${id}/reset-code/`), { method: "POST" }))

export const removeBoardMember = async (id: number, userId: number): Promise<PrivateBoard> =>
  unwrap(
    await authFetch(url(`/api/private-leaderboards/${id}/remove-member/`), {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),
  )

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

  return { me, loading, refresh, setMe }
}

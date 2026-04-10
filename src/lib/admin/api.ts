type DashboardUsersResult = { users: unknown[] }
type DashboardSeasonsResult = { seasons: unknown[] }
import type { TeamQueueEntry } from './types'

type DashboardTeamsResult = { queue: TeamQueueEntry[]; approved: TeamQueueEntry[] }
type DashboardMatchesResult = { matches: unknown[] }

type JsonRequestOptions = {
  method?: string
  body?: unknown
  headers?: HeadersInit
  fallbackMessage: string
  includeHttpStatusInError?: boolean
}

type FormRequestOptions = {
  method: string
  body: FormData
  fallbackMessage: string
  includeHttpStatusInError?: boolean
}

function messageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = (payload as { message?: unknown }).message
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

async function parsePayload(response: Response): Promise<unknown> {
  try {
    return await response.clone().json()
  } catch {
    const text = await response.text().catch(() => '')
    return text ? { message: text } : {}
  }
}

function fallbackErrorMessage(
  payload: unknown,
  response: Response,
  fallbackMessage: string,
  includeHttpStatusInError: boolean
): string {
  const responseMessage = messageFromPayload(payload)
  if (responseMessage) return responseMessage
  if (includeHttpStatusInError) return `${fallbackMessage} (HTTP ${response.status})`
  return fallbackMessage
}

export async function adminJsonRequest<T>(
  input: string,
  {
    method = 'GET',
    body,
    headers,
    fallbackMessage,
    includeHttpStatusInError = false,
  }: JsonRequestOptions
): Promise<T> {
  const requestHeaders =
    body === undefined ? headers : { 'Content-Type': 'application/json', ...(headers ?? {}) }
  const response = await globalThis.fetch(input, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await parsePayload(response)

  if (!response.ok) {
    throw new Error(
      fallbackErrorMessage(payload, response, fallbackMessage, includeHttpStatusInError)
    )
  }

  return payload as T
}

export async function adminFormRequest<T>(
  input: string,
  { method, body, fallbackMessage, includeHttpStatusInError = false }: FormRequestOptions
): Promise<T> {
  const response = await globalThis.fetch(input, {
    method,
    body,
  })
  const payload = await parsePayload(response)

  if (!response.ok) {
    throw new Error(
      fallbackErrorMessage(payload, response, fallbackMessage, includeHttpStatusInError)
    )
  }

  return payload as T
}

export async function fetchAdminDashboardData(): Promise<{
  users: unknown[]
  seasons: unknown[]
  queue: TeamQueueEntry[]
  approved: TeamQueueEntry[]
  matches: unknown[]
}> {
  const [usersResult, seasonsResult, teamsResult, matchesResult] = await Promise.all([
    adminJsonRequest<DashboardUsersResult>('/api/admin/users', {
      fallbackMessage: 'Failed to fetch users',
    }),
    adminJsonRequest<DashboardSeasonsResult>('/api/admin/seasons', {
      fallbackMessage: 'Failed to fetch seasons',
    }),
    adminJsonRequest<DashboardTeamsResult>('/api/admin/teams', {
      fallbackMessage: 'Failed to fetch teams',
    }),
    adminJsonRequest<DashboardMatchesResult>('/api/admin/matches', {
      fallbackMessage: 'Failed to fetch matches',
    }),
  ])

  return {
    users: usersResult.users,
    seasons: seasonsResult.seasons,
    queue: teamsResult.queue,
    approved: teamsResult.approved,
    matches: matchesResult.matches,
  }
}

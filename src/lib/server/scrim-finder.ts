import { error } from '@sveltejs/kit'
import { createHash, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '$lib/supabase/admin'

export type ScrimSlotStatus = 'open' | 'pending_selection' | 'filled' | 'cancelled' | 'expired'
export type ScrimClaimStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn'
export type ScrimSlotType = 'open' | 'targeted'

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeTeamName(value: unknown) {
  const teamName = normalizeText(value)
  if (!teamName) throw error(400, 'Team name is required')
  if (teamName.length < 2 || teamName.length > 80)
    throw error(400, 'Team name must be 2-80 characters')
  return teamName
}

export function normalizeRepName(value: unknown) {
  const repName = normalizeText(value)
  if (!repName) throw error(400, 'Representative name is required')
  if (repName.length < 2 || repName.length > 80) {
    throw error(400, 'Representative name must be 2-80 characters')
  }
  return repName
}

export function normalizeDiscordHandle(value: unknown) {
  const handle = normalizeText(value)
  if (!handle) throw error(400, 'Discord handle is required')
  if (handle.length < 2 || handle.length > 64)
    throw error(400, 'Discord handle must be 2-64 characters')
  if (!/^[A-Za-z0-9._#-]+$/.test(handle)) {
    throw error(400, 'Discord handle contains invalid characters')
  }
  return handle
}

export function normalizeNotes(value: unknown, label = 'Notes') {
  const notes = normalizeText(value)
  if (!notes) return null
  if (notes.length > 1000) throw error(400, `${label} must be 1000 characters or less`)
  return notes
}

export function normalizeSlotType(value: unknown): ScrimSlotType {
  if (value === 'targeted') return 'targeted'
  return 'open'
}

export function normalizeTargetTeamName(slotType: ScrimSlotType, value: unknown) {
  const targetTeamName = normalizeText(value)
  if (slotType === 'targeted') {
    if (!targetTeamName) throw error(400, 'Target team name is required for targeted slots')
    if (targetTeamName.length < 2 || targetTeamName.length > 80) {
      throw error(400, 'Target team name must be 2-80 characters')
    }
    return targetTeamName
  }
  return null
}

export function parseScheduledAt(value: unknown) {
  const raw = normalizeText(value)
  if (!raw) throw error(400, 'Scheduled time is required')
  const date = new Date(raw)
  if (!Number.isFinite(date.getTime())) throw error(400, 'Invalid scheduled time')
  return date.toISOString()
}

export function ensureFutureScheduledAt(iso: string) {
  const scheduledMs = new Date(iso).getTime()
  const minMs = Date.now() + 60 * 1000
  if (scheduledMs < minMs)
    throw error(400, 'Scheduled time must be at least 1 minute in the future')
}

export function hashManageToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function generateManageToken() {
  const token = randomBytes(24).toString('hex')
  return { token, tokenHash: hashManageToken(token) }
}

export function buildManageUrl(origin: string, token: string) {
  return `${origin}/scrim-finder/manage/${token}`
}

export function matchesManageToken(
  token: string | null | undefined,
  hash: string | null | undefined
) {
  if (!token || !hash) return false
  return hashManageToken(token) === hash
}

export function isSameTeamName(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export async function expirePastSlots() {
  const nowIso = new Date().toISOString()
  const { error: expireError } = await supabaseAdmin
    .from('scrim_slots')
    .update({ status: 'expired' })
    .in('status', ['open', 'pending_selection'])
    .lt('scheduled_at', nowIso)

  if (expireError) {
    console.error('Failed to expire scrim slots:', expireError.message)
  }
}

export async function countPendingClaims(slotId: string) {
  const { count, error: countError } = await supabaseAdmin
    .from('scrim_slot_claims')
    .select('*', { count: 'exact', head: true })
    .eq('slot_id', slotId)
    .eq('status', 'pending')

  if (countError) throw error(500, 'Failed to count slot claims')
  return count ?? 0
}

export function mapPublicSlot(slot: any) {
  return {
    id: slot.id,
    slotType: slot.slot_type,
    status: slot.status,
    teamName: slot.team_name,
    repName: slot.rep_name,
    discordHandle: slot.discord_handle,
    targetTeamName: slot.target_team_name,
    scheduledAt: slot.scheduled_at,
    notes: slot.notes,
    createdAt: slot.created_at,
    pendingClaimsCount: slot.pendingClaimsCount ?? 0,
    acceptedClaim: slot.accepted_claim
      ? {
          id: slot.accepted_claim.id,
          teamName: slot.accepted_claim.team_name,
          repName: slot.accepted_claim.rep_name,
          discordHandle: slot.accepted_claim.discord_handle,
          message: slot.accepted_claim.message,
          createdAt: slot.accepted_claim.created_at,
        }
      : null,
  }
}

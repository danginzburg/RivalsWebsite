import { TEAM_BALANCE_RANKS } from '$lib/team-balance'

import type { AdminSelectOption } from './types'

export const bestOfOptions: AdminSelectOption[] = [
  { value: '3', label: 'BO3' },
  { value: '5', label: 'BO5' },
]

export const membershipRoleOptions: AdminSelectOption[] = [
  { value: 'player', label: 'Player' },
  { value: 'captain', label: 'Captain' },
  { value: 'substitute', label: 'Sub' },
  { value: 'coach', label: 'Coach' },
]

export const teamStatusOptions: AdminSelectOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'disbanded', label: 'Disbanded' },
]

export const matchStatusOptions: AdminSelectOption[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const streamPlatformOptions: AdminSelectOption[] = [
  { value: 'twitch', label: 'Twitch' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'kick', label: 'Kick' },
  { value: 'other', label: 'Other' },
]

export const streamStatusOptions: AdminSelectOption[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live', label: 'Live' },
  { value: 'ended', label: 'Ended' },
]

const rankOptions = TEAM_BALANCE_RANKS.map((rank) => rank.name)

export const rankSelectOptions: AdminSelectOption[] = [
  { value: '', label: 'Select rank' },
  ...rankOptions.map((rank) => ({ value: rank, label: rank })),
]

export const roleSelectOptions: AdminSelectOption[] = [
  { value: 'user', label: 'User' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'banned', label: 'Banned' },
  { value: 'admin', label: 'Admin' },
]

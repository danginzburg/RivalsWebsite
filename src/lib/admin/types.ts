import type { MatchStreamRow } from '$lib/server/db-rows'

export type AdminTabId =
  | 'users'
  | 'teams'
  | 'matches'
  | 'seasons'
  | 'accolades'
  | 'hall-of-fame'
  | 'moderation'
  | 'signups'

export type PlayerSignup = {
  id: string
  profile_id: string
  season_id: string | null
  display_name: string | null
  riot_tag: string | null
  discord_handle: string | null
  tracker_links: Array<{ label: string; url: string }>
  current_rank: string | null
  peak_rank: string | null
  tracker_current_score: number | null
  tracker_peak_score: number | null
  computed_value: number | null
  manual_value_override: number | null
  status: 'pending' | 'approved' | 'rejected'
  admin_notes: string | null
  created_at: string
  profile: { id: string; name: string; email: string | null }
}

export type SignupEditState = {
  displayName: string
  discordHandle: string
  currentRank: string
  peakRank: string
  trackerCurrentScore: string
  trackerPeakScore: string
  manualValueOverride: string
  adminNotes: string
}

export type CommentReport = {
  id: string
  status: 'pending' | 'resolved' | 'dismissed'
  reason: string | null
  created_at: string
  reporter: { id: string; name: string }
  comment: {
    id: string
    body: string
    is_deleted: boolean
    created_at: string
    entity_type: 'match' | 'player' | 'season'
    entity_id: string
    /** Season code, when the thread lives on an event page. */
    entity_slug?: string | null
    author: { id: string; name: string; banned_until: string | null }
  } | null
}

export type BestOfValue = '3' | '5'

export type AdminSelectOption = {
  label: string
  value: string
}

export type TeamQueueEntry = {
  id: string
  name: string
  tag: string | null
  logo_path: string | null
  logo_url?: string | null
  metadata?: {
    initial_roster?: Array<{ riot_id?: string; rank_label?: string }>
    org?: string | null
    about?: string | null
    match_import_names?: string[]
    leaderboard_import_tags?: string[]
  } | null
  approval_status: string
  status?: string | null
  approval_notes?: string | null
  roster_count?: number
  roster?: Array<{
    membership_id?: number | null
    profile_id: string
    player_name?: string | null
    role: string
    riot_id_base: string | null
    display_name: string | null
    email: string | null
  }>
  profiles?: { id?: string; display_name?: string | null; email?: string | null }[] | null
  captain_profile?: { display_name?: string | null; email?: string | null } | null
}

export type AdminPageDataExtras = {
  teamQueue?: TeamQueueEntry[]
}

export type ApprovedTeamEntry = TeamQueueEntry & {
  name: string
  tag: string | null
  logo_url: string | null
  captain_profile: { display_name: string | null; email: string | null } | null
  roster_count: number
  roster: Array<{
    membership_id?: number | null
    profile_id: string
    role: string
    riot_id_base: string | null
    display_name: string | null
    email: string | null
  }>
}

export type AdminUser = {
  id: string
  email: string | null
  display_name: string | null
  role: string
  riot_id_base: string | null
  created_at: string
}

export type AdminSeason = {
  id: string
  code: string
  name: string
  starts_on: string | null
  ends_on: string | null
  is_active: boolean | null
  metadata?: Record<string, unknown> | null
  logo_path?: string | null
  logo_url?: string | null
  /** Season results — surfaced on /events and the Hall of Fame. */
  summary?: string | null
  winner_team_id?: string | null
  runner_up_team_id?: string | null
  mvp_profile_id?: string | null
  final_leaderboard_batch_id?: string | null
}

export type HallOfFameEntry = {
  id: string
  entry_type: 'record' | 'moment' | 'award'
  title: string
  description: string | null
  stat_value: string | null
  stat_label: string | null
  media_url: string | null
  player_name: string | null
  profile_id: string | null
  team_id: string | null
  season_id: string | null
  is_published: boolean
  sort_order: number
  created_at: string
}

export type HallOfFameFormState = {
  entryType: 'record' | 'moment' | 'award'
  title: string
  description: string
  statValue: string
  statLabel: string
  mediaUrl: string
  playerName: string
  profileId: string
  teamId: string
  seasonId: string
  isPublished: boolean
  sortOrder: string
}

export type AdminTeamLite = {
  id: string
  name: string
  tag: string | null
}

export type AdminMatch = {
  id: string
  status: string | null
  approval_status: string | null
  best_of: number | null
  scheduled_at: string | null
  ended_at: string | null
  metadata:
    | { map_vetoes?: string[] | null; designation?: string | null }
    | Record<string, unknown>
    | null
  team_a_id: string
  team_b_id: string
  winner_team_id: string | null
  team_a_score: number | null
  team_b_score: number | null
  team_a: AdminTeamLite | AdminTeamLite[] | null
  team_b: AdminTeamLite | AdminTeamLite[] | null
  streams: MatchStreamRow[]
  vod_url: string | null
  season_id: string | null
}

export type TeamEditState = {
  name: string
  tag: string
  status: string
}

export type MatchEditState = {
  teamAId: string
  teamBId: string
  bestOf: string
  status: string
  scheduledAt: string
  teamAScore: string
  teamBScore: string
  winnerTeamId: string
  mapVetoes: string
  /** Optional label shown above the matchup, e.g. "Grand Finals". */
  designation: string
}

export type MatchStreamFormState = {
  platform: string
  streamUrl: string
  displayName: string
  status: string
  isPrimary: boolean
}

export type SeasonEditState = {
  code: string
  name: string
  startsOn: string
  endsOn: string
  isActive: boolean
  summary: string
  winnerTeamId: string
  runnerUpTeamId: string
  mvpProfileId: string
  finalLeaderboardBatchId: string
}

export type PendingRoleChange = {
  userId: string
  userName: string
  currentRole: string
  newRole: string
}

type ConfirmationFields = {
  title: string
  message: string
  confirmLabel: string
}

export type PendingActionConfirmation =
  | ({ kind: 'remove_team'; teamId: string; teamName: string } & ConfirmationFields)
  | ({
      kind: 'remove_player'
      teamId: string
      membershipId: number | null
      profileId: string
      riotId: string
      role: string
    } & ConfirmationFields)
  | ({
      kind: 'finalize_match'
      matchId: string
      teamAScore: string
      teamBScore: string
      winnerTeamId: string
    } & ConfirmationFields)
  | ({ kind: 'cancel_match'; matchId: string } & ConfirmationFields)
  | ({ kind: 'save_team'; teamId: string } & ConfirmationFields)
  | ({ kind: 'save_match'; matchId: string } & ConfirmationFields)
  | ({ kind: 'delete_match'; matchId: string } & ConfirmationFields)
  | ({ kind: 'delete_stream'; matchId: string; streamId: string } & ConfirmationFields)
  | ({
      kind: 'save_user_riot'
      userId: string
      userName: string
      riotIdBase: string
    } & ConfirmationFields)

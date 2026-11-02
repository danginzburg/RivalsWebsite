/** One account as compared on a signup. */
export type CheckedAccount = {
  riotId: string
  currentRank: string | null
  peakRank: string | null
  /** Ranked games since V26 Act 1. */
  games: number
  /** 0.35·C + 0.65·P with no rating bonus; null without both ranks. */
  baseScore: number | null
}

/** Stored as `player_signups.alt_check`. */
export type SignupAltCheck = {
  main: CheckedAccount
  alts: CheckedAccount[]
  /** The account the ranks came from. */
  usedRiotId: string
  /** The highest-scoring alt, when its base score beats the main's. */
  higherAlt: string | null
}

/**
 * Default rulebook content, shown only until an admin saves the rulebook from
 * /admin/content (stored in `site_content`). Edit it there, not here.
 */

export type RulebookSection = {
  /** URL-safe anchor id. Keep stable — links may point at it. */
  id: string
  title: string
  body: string
  subsections?: RulebookSection[]
}

export const RULEBOOK_UPDATED = '2026-08-09'

export const RULEBOOK_SECTIONS: RulebookSection[] = [
  {
    id: 'overview',
    title: 'League Overview',
    body: `Placeholder — describe what the league is, who it is for, and the format of a typical season.

Replace this text with the real overview section from the rulebook document.`,
  },
  {
    id: 'eligibility',
    title: 'Player Eligibility',
    body: `Placeholder — describe who can play in the league.

- Rank requirements
- Account requirements
- Region restrictions
- Age or conduct requirements`,
  },
  {
    id: 'teams',
    title: 'Teams & Rosters',
    body: `Placeholder — cover roster construction rules.

- Minimum and maximum roster size
- Substitute and coach rules
- Team average rank requirement
- Roster lock dates and transfer windows`,
  },
  {
    id: 'match-rules',
    title: 'Match Rules',
    body: `Placeholder — cover how matches are played.

- Series format (best of)
- Map pool and veto process
- Server and lobby settings
- Overtime rules`,
  },
  {
    id: 'scheduling',
    title: 'Scheduling & Forfeits',
    body: `Placeholder — cover when matches happen and what happens when they do not.

- Default match times
- Rescheduling procedure and deadlines
- Grace period before a forfeit is called
- No-show consequences`,
  },
  {
    id: 'conduct',
    title: 'Code of Conduct',
    body: `Placeholder — cover expected behavior and consequences.

- Sportsmanship expectations
- Prohibited behavior
- Reporting process
- Penalty structure`,
  },
  {
    id: 'playoffs',
    title: 'Playoffs',
    body: `Placeholder — cover the postseason format.

- Qualification criteria
- Seeding rules
- Bracket format
- Tiebreakers`,
  },
  {
    id: 'disputes',
    title: 'Disputes & Appeals',
    body: `Placeholder — cover how disagreements are resolved.

- How to file a dispute
- Evidence requirements
- Review timeline
- Appeal process`,
  },
]

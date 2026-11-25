/**
 * The bot's slash commands as registered with Discord. No imports, so the
 * registration script can load this file on its own. Run
 * `npm run discord:register` after changing anything here.
 */

/** Discord's application command option type for a string. */
const STRING_OPTION = 3

export const LINK_MATCH = {
  name: 'link-match',
  description: 'Link this scheduling thread to its match on the site',
  type: 1,
  // Usable in servers only, not DMs.
  contexts: [0],
  options: [
    {
      type: STRING_OPTION,
      name: 'match',
      description: 'The match this thread is for',
      required: true,
      autocomplete: true,
    },
  ],
} as const

export const SET_TIME = {
  name: 'set-time',
  description:
    'Set this match’s start time (Central time); players propose it for staff to approve',
  type: 1,
  contexts: [0],
  options: [
    {
      type: STRING_OPTION,
      name: 'date',
      description: 'The day, e.g. Fri, tomorrow, 11/28 or Nov 28',
      required: true,
      autocomplete: true,
    },
    {
      type: STRING_OPTION,
      name: 'time',
      description: 'Central time, e.g. 7pm or 7:30 PM',
      required: true,
      autocomplete: true,
    },
  ],
} as const

export const COMMANDS = [LINK_MATCH, SET_TIME]

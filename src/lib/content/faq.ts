/**
 * FAQ content. Edit these entries to update the /faq page.
 * Grouped by category; categories render in the order listed here.
 */

export type FaqEntry = {
  question: string
  answer: string
}

export type FaqCategory = {
  category: string
  entries: FaqEntry[]
}

export const FAQ_CONTENT: FaqCategory[] = [
  {
    category: 'Getting Started',
    entries: [
      {
        question: 'How do I join the league?',
        answer:
          'Placeholder — describe the signup process here, including where players register, what information they need to provide, and when signups open for each season.',
      },
      {
        question: 'What rank do I need to play?',
        answer:
          'Placeholder — explain rank eligibility and how the team average requirement works. Reference the Calculator page so players can check their team composition.',
      },
      {
        question: 'How do I link my Riot ID to my profile?',
        answer:
          'Placeholder — walk through setting the Riot ID base name in Account settings and explain that stats imports use this field for matching.',
      },
    ],
  },
  {
    category: 'Teams & Rosters',
    entries: [
      {
        question: 'How many players can be on a roster?',
        answer:
          'Placeholder — state the minimum and maximum roster size, plus any rules about substitutes and coaches.',
      },
      {
        question: 'Can I switch teams mid-season?',
        answer: 'Placeholder — describe the roster lock policy and any transfer windows.',
      },
      {
        question: 'How is team balance calculated?',
        answer:
          'Placeholder — explain the team average rank requirement and point players to the Calculator.',
      },
    ],
  },
  {
    category: 'Matches & Scheduling',
    entries: [
      {
        question: 'How are matches scheduled?',
        answer:
          'Placeholder — describe when matches are played, how times are set, and how teams coordinate.',
      },
      {
        question: 'What happens if a team no-shows?',
        answer: 'Placeholder — describe the forfeit policy and grace period.',
      },
      {
        question: 'How do I report a match result?',
        answer: 'Placeholder — walk through the result reporting process.',
      },
    ],
  },
  {
    category: 'Stats & Rankings',
    entries: [
      {
        question: 'How often are stats updated?',
        answer:
          'Placeholder — explain the stats import cadence and where players can view their numbers.',
      },
      {
        question: 'My stats are missing or wrong. What do I do?',
        answer: 'Placeholder — explain how to report stat issues, likely tied to Riot ID matching.',
      },
    ],
  },
]

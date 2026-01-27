<script>
  import herobackground from '$lib/assets/img/mvp.png'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import HeroSection from '$lib/components/HeroSection.svelte'
  import InfoSection from '$lib/components/InfoSection.svelte'
  import MatchesSection from '$lib/components/MatchesSection.svelte'
  import {
    UserPlus,
    BookOpen,
    Trophy,
    Calculator,
    BarChart3,
    Calendar,
    MessageSquare,
    Video,
    MessageCircle,
  } from 'lucide-svelte'

  // Team logos
  import tbb from '$lib/assets/teams/tbb.png'
  import jtrr from '$lib/assets/teams/jtrr.png'
  import crx from '$lib/assets/teams/crx.png'
  import pgn from '$lib/assets/teams/pgn.png'
  import ojs from '$lib/assets/teams/ojs.png'
  import hor from '$lib/assets/teams/hor.png'
  import fn3 from '$lib/assets/teams/fn3.png'
  import std from '$lib/assets/teams/std.png'
  import poor from '$lib/assets/teams/poor.png'
  import unc7 from '$lib/assets/teams/7unc.png'

  const infoItems = [
    {
      icon: UserPlus,
      title: 'Sign Up',
      description:
        'Sign up to participate in Season 4 of Throw City Rivals! Players of all skill levels are welcome.',
      href: 'https://docs.google.com/forms/d/e/1FAIpQLSd3u_6OueuKIxr_fRTIHmDwF_LxF_JsN_jMpyKpaAW3Zl7fBA/viewform',
    },
    {
      icon: BookOpen,
      title: 'Rulebook',
      description:
        'Read the official rules and guidelines for Season 4 of Throw City Rivals. Any changes will be updated here.',
      href: 'https://docs.google.com/document/d/1IckzrbvNamc-Suq3kgBCm-Umd_W_zpMFWiiHWg8dMTg/edit?tab=t.0#heading=h.b6aqs3g5z6lz',
    },
    {
      icon: Trophy,
      title: 'Map Rotation + Leaderboard',
      description: 'Map rotation details and current team standings.',
      href: 'https://docs.google.com/spreadsheets/d/15BLavKUxCIeDAup3GF4iaDrXqegFhGU2Cudyp55W4Ds/edit?gid=1220692241#gid=1220692241',
    },
    {
      icon: Calculator,
      title: 'Team Balance Calculator',
      description: 'Calculate and balance team compositions for fair play.',
      href: 'https://docs.google.com/spreadsheets/d/1arQ9sF0CU314FKBIjPM30UwGt_Go4qo6-HJSuLCgm_g/edit?gid=998869831#gid=998869831',
    },
    {
      icon: BarChart3,
      title: 'Individual player stats',
      description: 'Detailed statistics for individual player performance.',
      href: 'https://docs.google.com/spreadsheets/d/19kOEPepeyCWeo9QGhJkSJ_k6OaIxONUuh2CW6jdPMjg/edit?gid=1886421648#gid=1886421648',
    },
    {
      icon: Calendar,
      title: 'Match Schedule',
      description: 'Stay updated with the latest match schedules and results for Season 4.',
      href: '#',
    },
    {
      icon: MessageSquare,
      title: 'Feedback Forms',
      description:
        'We value your feedback! Share your thoughts and suggestions to help us improve Throw City Rivals.',
      href: 'https://docs.google.com/forms/d/e/1FAIpQLSeIIzM-gTC2H90YxnQmW16Lx0BEQpcQ5av2gT64R6KhLDgisA/viewform',
    },
    {
      icon: Video,
      title: 'Observer Sign Up',
      description:
        'Sign up to be an observer for Season 4 of Throw City Rivals. Help us capture the action and provide live coverage!',
      href: 'https://docs.google.com/forms/d/e/1FAIpQLSeCKFySz5sP-qrogaFu1erjUnibEMAP6nDuE0xODufs_5-tow/viewform',
    },
    {
      icon: MessageCircle,
      title: 'NA Discord',
      description:
        'Join our Discord community to stay updated on all Season 4 information and announcements.',
      href: 'https://discord.gg/AQtCv8Mk',
    },
  ]

  const matches = [
    {
      teamA: { name: 'The Big Black', abbr: 'TBB', logo: tbb },
      teamB: { name: 'Jame Time Rebuild Rebuild', abbr: 'JTRR', logo: jtrr },
      datetime: 'Jan 30, 7:00 PM',
      maps: ['Haven', 'Breeze', 'Abyss'],
      stream: 'https://twitch.tv/placeholder',
    },
    {
      teamA: { name: 'CloroX', abbr: 'CRX', logo: crx },
      teamB: { name: 'Winged Pigeons', abbr: 'PGN', logo: pgn },
      datetime: 'Jan 31, 6:30 PM',
      maps: ['Pearl', 'Split', 'Bind'],
      stream: 'https://twitch.tv/placeholder',
    },
    {
      teamA: { name: 'O. Jenk Simpsons', abbr: 'OJS', logo: ojs },
      teamB: { name: 'Hooters', abbr: 'HOR', logo: hor },
      datetime: 'Feb 1, 8:15 PM',
      maps: ['Corrode', 'Haven', 'Breeze'],
      stream: 'https://twitch.tv/placeholder',
    },
    {
      teamA: { name: 'FNTASTIC3', abbr: 'FN3', logo: fn3 },
      teamB: { name: 'Stranger Danger', abbr: 'STD', logo: std },
      datetime: 'Feb 2, 5:45 PM',
      maps: ['Abyss', 'Pearl', 'Split'],
      stream: 'https://twitch.tv/placeholder',
    },
    {
      teamA: { name: 'Preists of Oncoming Rivals', abbr: 'POOR', logo: poor },
      teamB: { name: '7uncles', abbr: '7UNC', logo: unc7 },
      datetime: 'Feb 3, 9:00 PM',
      maps: ['Bind', 'Corrode', 'Haven'],
      stream: 'https://twitch.tv/placeholder',
    },
  ]
</script>

<PageContainer>
  <HeroSection
    image={herobackground}
    title="Welcome to Throw City Rivals!"
    subtitle="Throw City Rivals finally got a home."
    description="One spot to see the brackets, the stats, and who's actually throwing."
  />

  <InfoSection items={infoItems} />

  <MatchesSection {matches} />
</PageContainer>

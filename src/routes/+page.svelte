<script>
  import herobackground from '$lib/assets/img/mvp.png'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import ContentSection from '$lib/components/ContentSection.svelte'
  import HeroSection from '$lib/components/HeroSection.svelte'
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
      teamA: { name: 'Team Apex', logo: 'LOGO-A' },
      teamB: { name: 'Team Nova', logo: 'LOGO-N' },
      datetime: 'Jan 30, 7:00 PM',
      maps: ['Map Alpha', 'Map Bravo', 'Map Charlie'],
      stream: 'https://twitch.tv/placeholder',
    },
    {
      teamA: { name: 'Crimson Crew', logo: 'LOGO-C' },
      teamB: { name: 'Azure Alliance', logo: 'LOGO-Z' },
      datetime: 'Jan 31, 6:30 PM',
      maps: ['Map Delta', 'Map Echo', 'Map Foxtrot'],
      stream: 'https://twitch.tv/placeholder',
    },
    {
      teamA: { name: 'Iron Giants', logo: 'LOGO-I' },
      teamB: { name: 'Silver Storm', logo: 'LOGO-S' },
      datetime: 'Feb 1, 8:15 PM',
      maps: ['Map Glacier', 'Map Harbor', 'Map Inferno'],
      stream: 'https://twitch.tv/placeholder',
    },
    {
      teamA: { name: 'Valor Vanguard', logo: 'LOGO-V' },
      teamB: { name: 'Shadow Squad', logo: 'LOGO-Q' },
      datetime: 'Feb 2, 5:45 PM',
      maps: ['Map Jungle', 'Map Kingdom', 'Map Lunar'],
      stream: 'https://twitch.tv/placeholder',
    },
    {
      teamA: { name: 'Echo Elite', logo: 'LOGO-E' },
      teamB: { name: 'Phoenix Rise', logo: 'LOGO-P' },
      datetime: 'Feb 3, 9:00 PM',
      maps: ['Map Mirage', 'Map Nexus', 'Map Outpost'],
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

  <ContentSection>
    <div class="responsive-grid">
      {#each infoItems as item}
        <div class="info-card">
          <div class="flex items-start gap-3">
            <span
              class="rounded-sm p-2"
              style="background-color: var(--accent); color: var(--text);"
            >
              <svelte:component this={item.icon} class="h-5 w-5" />
            </span>
            <div class="flex-1">
              <a
                href={item.href}
                class="text-lg font-semibold hover:underline"
                style="color: var(--title);"
                target={item.href.startsWith('http') ? '_blank' : undefined}
                rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              >
                {item.title}
              </a>
              <p class="text-sm" style="color: var(--text);">{item.description}</p>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </ContentSection>

  <ContentSection>
    <div class="flex w-full max-w-5xl flex-col gap-4">
      {#each matches as match}
        <div class="info-card">
          <!-- Team matchup: stacked on mobile, horizontal on sm+ -->
          <div class="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
            <!-- Team A -->
            <div
              class="flex w-full min-w-0 flex-1 items-center justify-center gap-3 sm:justify-start"
            >
              <span
                class="rounded-sm px-2 py-1 text-xs font-semibold"
                style="background-color: var(--accent); color: var(--text);"
                >{match.teamA.logo}</span
              >
              <p class="truncate text-lg font-semibold" style="color: var(--title);">
                {match.teamA.name}
              </p>
            </div>

            <!-- VS / BO3 indicator -->
            <div class="w-16 text-center">
              <p class="text-sm font-semibold" style="color: var(--text);">BO3</p>
            </div>

            <!-- Team B -->
            <div
              class="flex w-full min-w-0 flex-1 items-center justify-center gap-3 sm:justify-end"
            >
              <p class="truncate text-lg font-semibold sm:order-1" style="color: var(--title);">
                {match.teamB.name}
              </p>
              <span
                class="rounded-sm px-2 py-1 text-xs font-semibold sm:order-2"
                style="background-color: var(--accent); color: var(--text);"
                >{match.teamB.logo}</span
              >
            </div>
          </div>

          <!-- Match details: stacked on mobile, horizontal on sm+ -->
          <div
            class="mt-3 flex flex-col items-start gap-2 text-sm sm:mt-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
            style="color: var(--text);"
          >
            <span class="font-medium" style="color: var(--title);">{match.datetime}</span>
            <span class="hidden text-xs sm:inline" style="color: var(--text); opacity: 0.7;">•</span
            >
            <span class="text-xs sm:text-sm">Maps: {match.maps.join(' / ')}</span>
            <div class="flex items-center gap-2 sm:ml-auto">
              <label class="text-xs font-semibold" style="color: var(--text);">Stream:</label>
              <a
                href={match.stream}
                class="rounded px-2 py-1 text-xs underline sm:text-sm"
                style="color: var(--title);"
                rel="noreferrer"
              >
                Watch Live
              </a>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </ContentSection>
</PageContainer>

<script>
  import herobackground from '$lib/assets/img/mvp.png'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import ContentSection from '$lib/components/ContentSection.svelte'
  import HeroSection from '$lib/components/HeroSection.svelte'

  const infoItems = [
    {
      icon: 'ICON',
      title: 'Bracket Status',
      description: 'Placeholder description for bracket updates.',
    },
    {
      icon: 'ICON',
      title: 'Live Streams',
      description: 'Placeholder description for live stream info.',
    },
    {
      icon: 'ICON',
      title: 'Team Profiles',
      description: 'Placeholder description for team highlights.',
    },
    {
      icon: 'ICON',
      title: 'Player Stats',
      description: 'Placeholder description for player stats.',
    },
    {
      icon: 'ICON',
      title: 'Match History',
      description: 'Placeholder description for recent results.',
    },
    {
      icon: 'ICON',
      title: 'Upcoming Games',
      description: 'Placeholder description for scheduled games.',
    },
    {
      icon: 'ICON',
      title: 'Venue Details',
      description: 'Placeholder description for location info.',
    },
    {
      icon: 'ICON',
      title: 'Rules & Format',
      description: 'Placeholder description for rules summary.',
    },
    { icon: 'ICON', title: 'Highlights', description: 'Placeholder description for best plays.' },
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
              class="rounded-sm px-2 py-1 text-xs font-semibold"
              style="background-color: var(--accent); color: var(--text);">{item.icon}</span
            >
            <div class="flex-1">
              <p class="text-lg font-semibold" style="color: var(--title);">{item.title}</p>
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

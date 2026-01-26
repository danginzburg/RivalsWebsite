<script>
  import herobackground from '$lib/assets/img/mvp.png'

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

<div class="flex flex-col items-center justify-center p-8">
  <div
    class="relative m-4 flex flex-col items-center justify-center border-2 align-middle"
    style="width: 1500px; max-width: 90vw; border-color: var(--border);"
  >
    <img
      src={herobackground}
      alt="Hero Background"
      class="h-auto w-full"
      style="filter: saturate(0.6) blur(2px) brightness(0.7);"
    />
    <div
      class="absolute flex flex-col items-center justify-center rounded-lg px-8 py-6"
      style="background: rgba(9, 6, 9, 0.4); color: var(--text);"
    >
      <h1
        class="mb-6 text-6xl font-bold"
        style="color: var(--title); text-shadow: 0 3px 8px var(--accent);"
      >
        Welcome to Throw City Rivals!
      </h1>
      <h2
        class="text-2xl font-bold"
        style="color: var(--text); text-shadow: 0 3px 8px var(--accent);"
      >
        Throw City Rivals finally got a home.
      </h2>
      <p
        class="max-w-2xl text-center text-lg font-medium"
        style="text-shadow: 0 3px 8px var(--accent);"
      >
        One spot to see the brackets, the stats, and who's actually throwing.
      </p>
    </div>
  </div>

  <div
    class="m-4 flex min-h-60 flex-col items-center justify-center border-2 p-6 align-middle"
    style="width: 1500px; max-width: 90vw; border-color: var(--border); background-color: var(--secondary-background);"
  >
    <div class="grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
      {#each infoItems as item}
        <div
          class="rounded-lg border p-4"
          style="border-color: var(--border); background-color: rgba(0, 0, 0, 0.15); color: var(--text);"
        >
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
  </div>

  <div
    class="m-4 flex min-h-60 flex-col items-center justify-center border-2 p-4 align-middle"
    style="width: 1500px; max-width: 90vw; border-color: var(--border); background-color: var(--secondary-background);"
  >
    <div class="flex w-full max-w-5xl flex-col gap-4">
      {#each matches as match}
        <div
          class="rounded-lg border p-4"
          style="border-color: var(--border); background-color: rgba(0, 0, 0, 0.15); color: var(--text);"
        >
          <div class="flex items-center gap-4">
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <span
                class="rounded-sm px-2 py-1 text-xs font-semibold"
                style="background-color: var(--accent); color: var(--text);"
                >{match.teamA.logo}</span
              >
              <p class="truncate text-lg font-semibold" style="color: var(--title);">
                {match.teamA.name}
              </p>
            </div>
            <div class="w-16 text-center">
              <p class="text-sm font-semibold" style="color: var(--text);">BO3</p>
            </div>
            <div class="flex min-w-0 flex-1 items-center justify-end gap-3">
              <p class="truncate text-lg font-semibold" style="color: var(--title);">
                {match.teamB.name}
              </p>
              <span
                class="rounded-sm px-2 py-1 text-xs font-semibold"
                style="background-color: var(--accent); color: var(--text);"
                >{match.teamB.logo}</span
              >
            </div>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-3 text-sm" style="color: var(--text);">
            <span style="color: var(--title);">{match.datetime}</span>
            <span class="text-xs" style="color: var(--text); opacity: 0.7;">•</span>
            <span>Maps: {match.maps.join(' • ')}</span>
            <div class="ml-auto flex items-center gap-2">
              <label class="text-xs font-semibold" style="color: var(--text);">Stream:</label>
              <a
                href={match.stream}
                class="rounded px-2 py-1 text-sm underline"
                style="color: var(--title);"
                rel="noreferrer"
              >
                {match.stream}
              </a>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<script lang="ts">
  import herobackground from '$lib/assets/img/mvp.png'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import HeroSection from '$lib/components/HeroSection.svelte'
  import InfoSection from '$lib/components/InfoSection.svelte'
  import MatchesSection from '$lib/components/MatchesSection.svelte'
  import { BookOpen, Trophy, Calculator, BarChart3, Calendar, MessageCircle } from 'lucide-svelte'

  let { data } = $props() as { data: { matches?: any[] } }
  const matches = $derived(data.matches ?? [])

  const infoItems = [
    {
      icon: BookOpen,
      title: 'Rulebook',
      description:
        'Read the official rules and guidelines for Season 4 of Throw City Rivals. Any changes will be updated here.',
      href: '/rulebook',
    },
    {
      icon: Calendar,
      title: 'Matches',
      description: 'Upcoming matches, results, and match details.',
      href: '/matches',
    },
    {
      icon: Trophy,
      title: 'Leaderboard',
      description: 'Team standings based on match results.',
      href: '/leaderboard',
    },
    {
      icon: BarChart3,
      title: 'Stats',
      description: 'Player performance stats and weekly imports.',
      href: '/stats',
    },
    {
      icon: Calculator,
      title: 'Calculator',
      description: 'Balance calculator for fair team compositions.',
      href: '/team-balance',
    },
    {
      icon: MessageCircle,
      title: 'Discord',
      description:
        'Join our Discord community to stay updated on all Season 4 information and announcements.',
      href: 'https://discord.gg/AQtCv8Mk',
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

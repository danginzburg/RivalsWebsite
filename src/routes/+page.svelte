<script lang="ts">
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

  let { data } = $props() as { data: { matches?: any[] } }
  const matches = $derived(data.matches ?? [])

  const infoItems = [
    {
      icon: UserPlus,
      title: 'Sign Up',
      description:
        'Sign up to participate in Season 4 of Throw City Rivals! Players of all skill levels are welcome.',
      href: '/signup',
    },
    {
      icon: BookOpen,
      title: 'Rulebook',
      description:
        'Read the official rules and guidelines for Season 4 of Throw City Rivals. Any changes will be updated here.',
      href: '/rulebook',
    },
    {
      icon: Trophy,
      title: 'Leaderboard',
      description: 'Map rotation details and current team standings.',
      href: '/leaderboard',
    },
    {
      icon: Calculator,
      title: 'Team Balance Calculator',
      description: 'Calculate and balance team compositions for fair play.',
      href: '/team-balance',
    },
    {
      icon: BarChart3,
      title: 'Individual player stats',
      description: 'Detailed statistics for individual player performance.',
      href: '/stats',
    },
    {
      icon: Calendar,
      title: 'Match Schedule',
      description: 'Stay updated with the latest match schedules and results for Season 4.',
      href: '/matches',
    },
    {
      icon: MessageSquare,
      title: 'Feedback Forms',
      description:
        'We value your feedback! Share your thoughts and suggestions to help us improve Throw City Rivals.',
      href: '/feedback',
    },
    {
      icon: Video,
      title: 'Observer Sign Up',
      description:
        'Sign up to be an observer for Season 4 of Throw City Rivals. Help us capture the action and provide live coverage!',
      href: '/observer-signup',
    },
    {
      icon: MessageCircle,
      title: 'NA Discord',
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

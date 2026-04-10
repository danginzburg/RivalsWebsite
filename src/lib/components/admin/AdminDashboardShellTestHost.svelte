<script lang="ts">
  import AdminDashboardShell from './AdminDashboardShell.svelte'
</script>

<AdminDashboardShell
  activeTab="users"
  counts={{ users: 3, teams: 2, matches: 4, seasons: 1 }}
  isLoading={false}
  errorMessage="Something went wrong"
  successMessage="Saved successfully"
  onTabChange={() => {}}
  onRefresh={() => {}}
>
  Admin body content
</AdminDashboardShell>

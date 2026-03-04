<script lang="ts">
  import StatsImport from '$lib/components/admin/StatsImport.svelte'

  let { data } = $props() as { data: any }
</script>

<StatsImport {data} />

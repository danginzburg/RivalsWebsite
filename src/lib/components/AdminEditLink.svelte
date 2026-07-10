<script lang="ts">
  interface Props {
    href: string
    label: string
    class?: string
  }

  let {
    href,
    label,
    class: className = 'rounded-md px-3 py-2 text-xs font-semibold',
  }: Props = $props()
</script>

<a {href} class={className} style="background: rgba(59,130,246,0.2); color: #93c5fd;">
  {label}
</a>

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

<!--
  Hidden below the tablet breakpoint. These shortcuts sit in page headers where
  space is tightest, and every destination they lead to is a management screen
  meant for a large display — on a phone they only crowded the content.
-->
<a
  {href}
  class="admin-edit-link {className}"
  style="background: rgba(59,130,246,0.2); color: #93c5fd;"
>
  {label}
</a>

<style>
  .admin-edit-link {
    display: none;
  }

  @media (min-width: 768px) {
    .admin-edit-link {
      display: inline-flex;
      align-items: center;
    }
  }
</style>

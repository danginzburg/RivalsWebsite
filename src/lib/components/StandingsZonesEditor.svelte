<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { Plus, X, Loader2 } from 'lucide-svelte'
  import { invalidateAll } from '$app/navigation'
  import { adminJsonRequest } from '$lib/admin/api'
  import {
    STANDINGS_ZONE_TONES,
    ZONE_TONE_COLORS,
    type StandingsConfig,
    type StandingsZone,
    type StandingsZoneTone,
  } from '$lib/seasons/standingsZones'

  interface Props {
    seasonId: string
    config: StandingsConfig
    /** Ranked teams, in table order, for the lock-in pickers. */
    teams: Array<{ id: string; name: string; rank: number | null }>
    onClose: () => void
  }

  let { seasonId, config, teams, onClose }: Props = $props()

  // Editing a copy; nothing reaches the page until Save.
  // svelte-ignore state_referenced_locally
  let stage = $state(config.stage)
  // svelte-ignore state_referenced_locally
  let zones = $state<StandingsZone[]>(config.zones.map((z) => ({ ...z })))
  // svelte-ignore state_referenced_locally
  let locked = $state<Record<string, string>>({ ...config.locked })
  let isSaving = $state(false)
  let errorText = $state<string | null>(null)

  const toneOptions = STANDINGS_ZONE_TONES.map((tone) => ({
    value: tone,
    label: tone[0].toUpperCase() + tone.slice(1),
  }))

  const lockOptions = $derived([
    { value: '', label: 'By rank' },
    ...zones.filter((z) => z.label.trim()).map((z) => ({ value: z.id, label: z.label })),
  ])

  function newZoneId() {
    let n = zones.length
    while (zones.some((z) => z.id === `zone_${n}`)) n += 1
    return `zone_${n}`
  }

  function addZone() {
    const last = zones.at(-1)
    const from = last ? (last.to ?? last.from) + 1 : 1
    zones = [...zones, { id: newZoneId(), label: '', tone: 'gray', from, to: null }]
  }

  /** The common shape: top N to playoffs, the next M to LCQ, the rest out. */
  function applyPreset() {
    const total = teams.length || 12
    const playoffs = Math.min(6, total)
    const lcq = Math.min(4, Math.max(0, total - playoffs))
    const next: StandingsZone[] = [
      { id: 'playoffs', label: 'Playoffs', tone: 'green', from: 1, to: playoffs },
    ]
    if (lcq > 0) {
      next.push({ id: 'lcq', label: 'LCQ', tone: 'amber', from: playoffs + 1, to: playoffs + lcq })
    }
    if (playoffs + lcq < total) {
      next.push({
        id: 'eliminated',
        label: 'Eliminated',
        tone: 'red',
        from: playoffs + lcq + 1,
        to: null,
      })
    }
    zones = next
    locked = {}
  }

  function updateZone(index: number, patch: Partial<StandingsZone>) {
    zones = zones.map((z, i) => (i === index ? { ...z, ...patch } : z))
  }

  function removeZone(index: number) {
    const removed = zones[index]
    zones = zones.filter((_, i) => i !== index)
    locked = Object.fromEntries(Object.entries(locked).filter(([, id]) => id !== removed.id))
  }

  function setLock(teamId: string, zoneId: string) {
    const next = { ...locked }
    if (zoneId) next[teamId] = zoneId
    else delete next[teamId]
    locked = next
  }

  function rankInput(value: string): number | null {
    const n = Math.trunc(Number(value))
    return value.trim() && Number.isFinite(n) && n >= 1 ? n : null
  }

  async function save() {
    isSaving = true
    errorText = null
    try {
      await adminJsonRequest('/api/admin/seasons/standings', {
        method: 'PUT',
        body: { seasonId, config: { stage, zones, locked } },
        fallbackMessage: 'Failed to save standings zones',
      })
      await invalidateAll()
      onClose()
    } catch (err) {
      errorText = err instanceof Error ? err.message : 'Failed to save standings zones'
    } finally {
      isSaving = false
    }
  }
</script>

<section class="editor">
  <div class="editor-head">
    <div>
      <div class="editor-title">Standings zones</div>
      <div class="editor-hint">
        Who makes playoffs, LCQ, and so on. Zones cover rank ranges; lock a team in once its spot is
        decided.
      </div>
    </div>
    <button type="button" class="icon-btn" onclick={onClose} aria-label="Close editor">
      <X size={16} />
    </button>
  </div>

  <div class="editor-block">
    <div class="block-label">Stage</div>
    <div class="stage-toggle" role="radiogroup" aria-label="Tournament stage">
      <button
        type="button"
        role="radio"
        aria-checked={stage === 'regular'}
        class:on={stage === 'regular'}
        onclick={() => (stage = 'regular')}>Regular season</button
      >
      <button
        type="button"
        role="radio"
        aria-checked={stage === 'playoffs'}
        class:on={stage === 'playoffs'}
        onclick={() => (stage = 'playoffs')}>Playoffs</button
      >
    </div>
    <div class="editor-hint">
      Playoffs puts the season's bracket (from the pick'em setup) above the standings.
    </div>
  </div>

  <div class="editor-block">
    <div class="block-label">
      Zones
      <button type="button" class="link-btn" onclick={applyPreset}>
        Fill Playoffs / LCQ / Eliminated
      </button>
    </div>
    {#if zones.length === 0}
      <div class="editor-hint">No zones yet — the table shows plain ranks.</div>
    {/if}
    <div class="zone-list">
      {#each zones as zone, i (zone.id)}
        <div class="zone-row">
          <span class="swatch" style="background: {ZONE_TONE_COLORS[zone.tone]};"></span>
          <input
            class="admin-input zone-label"
            value={zone.label}
            placeholder="Label (e.g. Playoffs)"
            maxlength="40"
            oninput={(e) => updateZone(i, { label: (e.currentTarget as HTMLInputElement).value })}
          />
          <div class="zone-tone">
            <CustomSelect
              options={toneOptions}
              value={zone.tone}
              compact={true}
              onSelect={(value) => updateZone(i, { tone: value as StandingsZoneTone })}
            />
          </div>
          <label class="rank-field">
            Ranks
            <input
              class="admin-input rank-input"
              type="number"
              min="1"
              value={zone.from}
              oninput={(e) =>
                updateZone(i, {
                  from: rankInput((e.currentTarget as HTMLInputElement).value) ?? zone.from,
                })}
            />
            –
            <input
              class="admin-input rank-input"
              type="number"
              min="1"
              placeholder="end"
              value={zone.to ?? ''}
              oninput={(e) =>
                updateZone(i, { to: rankInput((e.currentTarget as HTMLInputElement).value) })}
            />
          </label>
          <button
            type="button"
            class="icon-btn"
            onclick={() => removeZone(i)}
            aria-label="Remove zone"
          >
            <X size={14} />
          </button>
        </div>
      {/each}
    </div>
    <button type="button" class="admin-btn admin-btn-sm mt-2" onclick={addZone}>
      <Plus size={13} /> Add zone
    </button>
  </div>

  {#if zones.length > 0 && teams.length > 0}
    <div class="editor-block">
      <div class="block-label">Locked in</div>
      <div class="editor-hint">
        A locked team shows in its zone whatever its rank — clinched a playoff spot, or out.
      </div>
      <div class="lock-grid">
        {#each teams as team (team.id)}
          <div class="lock-row">
            <span class="lock-rank">{team.rank ?? '—'}</span>
            <span class="lock-name">{team.name}</span>
            <div class="lock-select">
              <CustomSelect
                options={lockOptions}
                value={locked[team.id] ?? ''}
                compact={true}
                onSelect={(value) => setLock(team.id, value)}
              />
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if errorText}
    <div class="editor-error">{errorText}</div>
  {/if}

  <div class="editor-actions">
    <button type="button" class="admin-btn admin-btn-sm" onclick={onClose} disabled={isSaving}>
      Cancel
    </button>
    <button
      type="button"
      class="admin-btn admin-btn-neutral admin-btn-sm"
      onclick={save}
      disabled={isSaving}
    >
      {#if isSaving}<Loader2 size={13} class="animate-spin" />{/if}
      Save
    </button>
  </div>
</section>

<style>
  .editor {
    margin-bottom: 0.75rem;
    padding: 1rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .editor-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .editor-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
  }

  .editor-hint {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 0.25rem;
  }

  .block-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
    margin-bottom: 0.5rem;
  }

  .link-btn {
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
  }

  .link-btn:hover {
    color: var(--accent-text);
  }

  .stage-toggle {
    display: inline-flex;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }

  .stage-toggle button {
    padding: 0.375rem 0.875rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }

  .stage-toggle button.on {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.88);
    font-weight: 500;
  }

  /* Quieter fields than the admin dashboard's; this sits on a public page. */
  .editor .admin-input {
    border-color: rgba(255, 255, 255, 0.09);
    background: rgba(0, 0, 0, 0.18);
    color: rgba(255, 255, 255, 0.85);
  }

  .editor .admin-input:focus {
    border-color: rgba(255, 255, 255, 0.22);
    box-shadow: none;
  }

  .zone-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .zone-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .swatch {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 9999px;
    flex-shrink: 0;
    opacity: 0.75;
  }

  .zone-label {
    flex: 1;
    min-width: 9rem;
  }

  .zone-tone {
    width: 7rem;
  }

  .rank-field {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .rank-input {
    width: 4.25rem;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border-radius: 0.375rem;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
  }

  .lock-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: 0.375rem 1rem;
    margin-top: 0.5rem;
  }

  .lock-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.78);
  }

  .lock-rank {
    width: 1.5rem;
    text-align: right;
    color: rgba(255, 255, 255, 0.55);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .lock-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lock-select {
    width: 8.5rem;
    flex-shrink: 0;
  }

  .editor-error {
    font-size: 0.8125rem;
    color: #fca5a5;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>

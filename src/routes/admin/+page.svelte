<script lang="ts">
  import { page } from '$app/stores'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Shield, Users, Video, RefreshCw } from 'lucide-svelte'

  // Get data from server load
  let { data } = $props()

  let activeTab = $state<'players' | 'observers'>('players')
  let isLoading = $state(false)
  let errorMessage = $state<string | null>(null)

  let players = $state(data.players || [])
  let observers = $state(data.observers || [])

  async function refreshData() {
    isLoading = true
    errorMessage = null

    try {
      const response = await fetch('/api/admin/registrations')
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.message || 'Failed to fetch data')
      }
      const result = await response.json()
      players = result.players
      observers = result.observers
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to refresh data'
    } finally {
      isLoading = false
    }
  }
</script>

<PageContainer>
  <div class="admin-page-wrapper">
    <div class="admin-container">
      <div class="header-section">
        <Shield size={48} class="header-icon" />
        <h1 class="responsive-title mb-2 text-center">Admin Dashboard</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Manage player and observer registrations
        </p>
      </div>

      <div class="admin-content info-card info-card-surface">
        <!-- Tabs -->
        <div class="tabs-header">
          <button
            type="button"
            class="tab-button"
            class:active={activeTab === 'players'}
            onclick={() => (activeTab = 'players')}
          >
            <Users size={18} />
            <span>Players ({players.length})</span>
          </button>
          <button
            type="button"
            class="tab-button"
            class:active={activeTab === 'observers'}
            onclick={() => (activeTab = 'observers')}
          >
            <Video size={18} />
            <span>Observers ({observers.length})</span>
          </button>
          <button
            type="button"
            class="refresh-button"
            onclick={refreshData}
            disabled={isLoading}
            title="Refresh data"
          >
            <RefreshCw size={18} class={isLoading ? 'spinning' : ''} />
          </button>
        </div>

        {#if errorMessage}
          <div class="error-message">{errorMessage}</div>
        {/if}

        <!-- Players Tab -->
        {#if activeTab === 'players'}
          <div class="table-container">
            {#if players.length === 0}
              <div class="empty-state">No player registrations yet.</div>
            {:else}
              <!-- Mobile cards -->
              <div class="mobile-cards">
                {#each players as player}
                  <div class="mobile-card">
                    <div class="mobile-card-header">{player.riot_id}</div>
                    <div class="mobile-card-row">
                      <span class="mobile-card-label">Discord</span>
                      <span class="mobile-card-value">{player.profiles?.display_name || '—'}</span>
                    </div>
                    <div class="mobile-card-row">
                      <span class="mobile-card-label">Pronouns</span>
                      <span class="mobile-card-value">{player.pronouns}</span>
                    </div>
                    <div class="mobile-card-row">
                      <span class="mobile-card-label">Tracker Links</span>
                      <span class="mobile-card-value">
                        {#if player.tracker_links?.length > 0}
                          <div class="tracker-links">
                            {#each player.tracker_links as link, i}
                              <a href={link} target="_blank" rel="noopener noreferrer">
                                Link {i + 1}
                              </a>
                            {/each}
                          </div>
                        {:else}
                          —
                        {/if}
                      </span>
                    </div>
                  </div>
                {/each}
              </div>
              <!-- Desktop table -->
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Riot ID</th>
                    <th>Discord</th>
                    <th>Pronouns</th>
                    <th>Tracker Links</th>
                  </tr>
                </thead>
                <tbody>
                  {#each players as player}
                    <tr>
                      <td class="font-semibold">{player.riot_id}</td>
                      <td>{player.profiles?.display_name || '—'}</td>
                      <td>{player.pronouns}</td>
                      <td>
                        {#if player.tracker_links?.length > 0}
                          <div class="tracker-links">
                            {#each player.tracker_links as link, i}
                              <a href={link} target="_blank" rel="noopener noreferrer">
                                Link {i + 1}
                              </a>
                            {/each}
                          </div>
                        {:else}
                          —
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        {/if}

        <!-- Observers Tab -->
        {#if activeTab === 'observers'}
          <div class="table-container">
            {#if observers.length === 0}
              <div class="empty-state">No observer applications yet.</div>
            {:else}
              <!-- Mobile cards -->
              <div class="mobile-cards">
                {#each observers as observer}
                  <div class="mobile-card">
                    <div class="mobile-card-header">{observer.profiles?.display_name || '—'}</div>
                    <div class="mobile-card-row">
                      <span class="mobile-card-label">Experience</span>
                      <span class="mobile-card-value">
                        <span
                          class="badge"
                          class:yes={observer.has_previous_experience}
                          class:no={!observer.has_previous_experience}
                        >
                          {observer.has_previous_experience ? 'Yes' : 'No'}
                        </span>
                      </span>
                    </div>
                    <div class="mobile-card-row">
                      <span class="mobile-card-label">Can Stream 1080p60</span>
                      <span class="mobile-card-value">
                        <span
                          class="badge"
                          class:yes={observer.can_stream_quality}
                          class:no={!observer.can_stream_quality}
                        >
                          {observer.can_stream_quality ? 'Yes' : 'No'}
                        </span>
                      </span>
                    </div>
                    <div class="mobile-card-row">
                      <span class="mobile-card-label">Will Use Overlay</span>
                      <span class="mobile-card-value">
                        <span
                          class="badge"
                          class:yes={observer.willing_to_use_overlay}
                          class:no={!observer.willing_to_use_overlay}
                        >
                          {observer.willing_to_use_overlay ? 'Yes' : 'No'}
                        </span>
                      </span>
                    </div>
                    {#if observer.additional_info}
                      <div class="mobile-card-row">
                        <span class="mobile-card-label">Additional Info</span>
                        <span class="mobile-card-value">{observer.additional_info}</span>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
              <!-- Desktop table -->
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Discord</th>
                    <th>Experience</th>
                    <th>Can Stream 1080p60</th>
                    <th>Will Use Overlay</th>
                    <th>Additional Info</th>
                  </tr>
                </thead>
                <tbody>
                  {#each observers as observer}
                    <tr>
                      <td class="font-semibold">{observer.profiles?.display_name || '—'}</td>
                      <td>
                        <span
                          class="badge"
                          class:yes={observer.has_previous_experience}
                          class:no={!observer.has_previous_experience}
                        >
                          {observer.has_previous_experience ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td>
                        <span
                          class="badge"
                          class:yes={observer.can_stream_quality}
                          class:no={!observer.can_stream_quality}
                        >
                          {observer.can_stream_quality ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td>
                        <span
                          class="badge"
                          class:yes={observer.willing_to_use_overlay}
                          class:no={!observer.willing_to_use_overlay}
                        >
                          {observer.willing_to_use_overlay ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td class="additional-info">{observer.additional_info}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</PageContainer>

<style>
  .admin-page-wrapper {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 2rem 0.5rem;
    min-height: 60vh;
  }

  @media (min-width: 640px) {
    .admin-page-wrapper {
      padding: 2rem 1rem;
    }
  }

  .admin-container {
    width: 100%;
    max-width: 1200px;
  }

  .header-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 2rem;
  }

  .header-section :global(.header-icon) {
    color: var(--text);
    margin-bottom: 1rem;
    filter: drop-shadow(0 3px 8px var(--accent));
  }

  .admin-content {
    padding: 0;
    overflow: hidden;
  }

  .tabs-header {
    display: flex;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .tab-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0.75rem;
    background: none;
    border: none;
    color: var(--text);
    opacity: 0.6;
    cursor: pointer;
    transition: all 0.2s ease;
    border-bottom: 2px solid transparent;
    font-size: 0.85rem;
  }

  @media (min-width: 640px) {
    .tab-button {
      padding: 1rem 1.5rem;
      font-size: 1rem;
    }
  }

  .tab-button:hover {
    opacity: 0.8;
    background-color: rgba(255, 255, 255, 0.05);
  }

  .tab-button.active {
    opacity: 1;
    border-bottom-color: var(--accent);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .refresh-button {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    padding: 0.75rem;
    background: none;
    border: none;
    color: var(--text);
    opacity: 0.6;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  @media (min-width: 640px) {
    .refresh-button {
      padding: 1rem;
    }
  }

  .refresh-button:hover:not(:disabled) {
    opacity: 1;
    background-color: rgba(255, 255, 255, 0.05);
  }

  .refresh-button:disabled {
    cursor: not-allowed;
  }

  .refresh-button :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .error-message {
    padding: 1rem;
    background-color: rgba(248, 113, 113, 0.2);
    color: #f87171;
    text-align: center;
  }

  .table-container {
    overflow-x: auto;
    padding: 0.75rem;
  }

  @media (min-width: 640px) {
    .table-container {
      padding: 1rem;
    }
  }

  .empty-state {
    padding: 3rem;
    text-align: center;
    color: var(--text);
    opacity: 0.6;
  }

  /* Desktop table styles */
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    display: none;
  }

  @media (min-width: 768px) {
    .data-table {
      display: table;
    }
  }

  .data-table th,
  .data-table td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text);
  }

  .data-table th {
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    opacity: 0.7;
    white-space: nowrap;
  }

  .data-table tbody tr:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  /* Mobile card styles */
  .mobile-cards {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  @media (min-width: 768px) {
    .mobile-cards {
      display: none;
    }
  }

  .mobile-card {
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 0.5rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .mobile-card-header {
    font-weight: 600;
    color: var(--title);
    margin-bottom: 0.75rem;
    font-size: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .mobile-card-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 0.35rem 0;
    gap: 0.5rem;
  }

  .mobile-card-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .mobile-card-value {
    font-size: 0.9rem;
    color: var(--text);
    text-align: right;
    word-break: break-word;
  }

  .tracker-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .tracker-links a {
    color: #a78bfa;
    text-decoration: none;
    font-size: 0.85rem;
  }

  .tracker-links a:hover {
    text-decoration: underline;
  }

  .badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .badge.yes {
    background-color: rgba(74, 222, 128, 0.2);
    color: #4ade80;
  }

  .badge.no {
    background-color: rgba(248, 113, 113, 0.2);
    color: #f87171;
  }

  .additional-info {
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .additional-info:hover {
    white-space: normal;
    word-break: break-word;
  }

  .font-semibold {
    font-weight: 600;
  }
</style>

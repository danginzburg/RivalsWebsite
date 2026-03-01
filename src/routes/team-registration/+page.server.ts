// Team registration removed — return empty lists to keep page safe.
export const load = async () => {
  return {
    mySubmissions: [],
    registeredPlayers: [],
    invites: [],
    hasActiveMembership: false,
  }
}

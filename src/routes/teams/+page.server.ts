// Teams feature removed — hide teams list.
export const load = async () => {
  return {
    requiresLogin: false,
    team: null,
  }
}

/**
 * Final playoff places for seasons whose bracket the site cannot model, shown
 * on the event page in place of the bracket and used for career average finish
 * (finalPlacements.ts).
 *
 * Season 1's playoffs were a 6-team bracket of their own shape (two seeds
 * skipped round one, and the lower bracket was routed by hand), so there is no
 * pick'em bracket to read places from. Read off the final bracket:
 *
 *   R1         Pound 2–1 Serpent Kings, Sigmas 2–1 Crackhouse
 *   Upper SF   Pound 2–0 Pizza Party, Sigmas 2–0 FNTASTIC
 *   Upper F    Pound 2–1 Sigmas
 *   Lower      Crackhouse 2–1 Pizza Party, Serpent Kings 2–0 FNTASTIC
 *              Crackhouse 2–0 Serpent Kings, Sigmas 2–0 Crackhouse
 *   Grand F    Sigmas 3–0 Pound
 *
 * The teams that missed playoffs follow in regular-season order (no Season 1
 * standings are stored): RFK, Alpha Squad, FNC Academy.
 *
 * Keyed by season code, then team id. `size` is how many teams made playoffs;
 * places past it are non-playoff finishes, used for averages but not listed as
 * playoff results. "The Pound" is the team stored as Pups Kittens.
 */
export type FixedPlacement = { start: number; end: number }

export const FIXED_PLAYOFF_PLACEMENTS: Record<
  string,
  { size: number; places: Record<string, FixedPlacement> }
> = {
  rivals1: {
    size: 6,
    places: {
      '3603e41d-42a6-470e-b649-b20a7363e2c6': { start: 1, end: 1 }, // Sigmas of Shield
      'f922fea8-fc22-480f-befb-8510ecdb6ecb': { start: 2, end: 2 }, // The Pound (Pups Kittens)
      'f71b2ced-42ea-471c-98d9-011639a1887d': { start: 3, end: 3 }, // The Crackhouse
      '90d3c09e-36f8-4c4b-a2ba-daa19516074e': { start: 4, end: 4 }, // Serpent Kings
      '72e72e62-1f08-4258-8410-2caa4ee9087e': { start: 5, end: 6 }, // Pizza Party: Reheated
      '3fd34ae2-cde8-4cfb-b303-78256ff77653': { start: 5, end: 6 }, // FNTASTIC
      'f9fc9ca5-9225-4f5d-9fa9-b2798dd8087b': { start: 7, end: 7 }, // Robert F. Kennedy
      '3dda5bab-65f9-4edf-9ea3-fe3dd7e10b38': { start: 8, end: 8 }, // Alpha Squad
      '12a2e6b5-d0da-4222-8161-07f179311f6d': { start: 9, end: 9 }, // FNC Academy
    },
  },
}

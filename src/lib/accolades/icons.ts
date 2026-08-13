import goldMedal from '$lib/assets/accolades/gold_medal.svg'
import silverMedal from '$lib/assets/accolades/silver_medal.svg'
import bronzeMedal from '$lib/assets/accolades/bronze_medal.svg'
import trophy from '$lib/assets/accolades/trophy.svg'
import mvpTrophy from '$lib/assets/accolades/mvp_trophy.svg'
import pickemMedal from '$lib/assets/accolades/pickem_medal.svg'

export const builtInAccoladeIcons: Record<string, string> = {
  gold_medal: goldMedal,
  silver_medal: silverMedal,
  bronze_medal: bronzeMedal,
  trophy,
  mvp_trophy: mvpTrophy,
  // Bracket glyph on a purple medal: earned for predicting playoffs, not for
  // placing in them, so it deliberately does not read as gold/silver/bronze.
  pickem_medal: pickemMedal,
}

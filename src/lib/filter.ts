/**
 * Hard lines for every line an agent says: nothing about bodies, weight, looks, eating, race, religion, gender,
 * sexuality, disability, mental health, family or money; no slurs, threats or sexual content. This is a floor that
 * runs on any model-written text; the fixed templates never need it.
 */
const CATEGORIES: [string, RegExp][] = [
  ['body', /\b(fat|fatter|fattest|obese|obesity|overweight|chubby|skinny|ugly|hideous|chunky|weigh|weight|calories?|bmi|diet|dieting)\b/i],
  ['eating', /\b(binge\w*|purg\w+|starv\w+|anorexi\w+|bulimi\w+|eating disorder)\b/i],
  ['identity', /\b(race|racial|racist|ethnic\w*|religio\w+|muslim|jewish|christian|hindu|atheist|gay|lesbian|trans|transgender|queer|homosexual)\b/i],
  ['health', /\b(disabled|disability|handicap\w*|wheelchair|autis\w+|retard\w*|cripple\w*|depress\w+|anxiety|anxious|bipolar|schizo\w*|suicid\w+|self[- ]harm|therapy|therapist|mental)\b/i],
  ['family', /\b(your (mom|mother|dad|father|parents?|family)|divorce\w*|orphan\w*|abus\w+)\b/i],
  ['money', /\b(broke|poor|poverty|rich|cheap|afford|debt|loan)\b/i],
  ['threat', /\b(kill\w*|hurt you|beat you|stab\w*|shoot\w*|die|dead|murder\w*)\b/i],
  ['sexual', /\b(sex\w*|porn\w*|nude|naked|horny|slut|whore)\b/i],
  ['insult', /\b(bitch|bastard|idiot|stupid|loser|worthless)\b/i],
  ['link', /https?:\/\//i],
];

export const MAX_LINE = 320;

export function findViolations(text: string): string[] {
  const hits = CATEGORIES.filter(([, re]) => re.test(text)).map(([name]) => name);
  if (text.length > MAX_LINE) hits.push('length');
  return hits;
}

export function passesHardLines(text: string): boolean {
  return text.trim().length > 0 && findViolations(text).length === 0;
}

/** The model's line if it is safe, otherwise the fixed fallback. */
export function safeLine(text: string, fallback: string): string {
  return passesHardLines(text) ? text.trim() : fallback;
}

/**
 * Vehicle vocabulary used to bias Deepgram transcription toward the makes and
 * models we actually sell, so proper nouns like "Juke" / "Qashqai" / "Dacia"
 * stop being mis-transcribed as common words ("Duke") or phonetic guesses.
 *
 * On nova-3 these are passed as `keyterm` (model-driven contextual prompting,
 * preserves the capitalisation below). On nova-2 they are passed as `keywords`
 * with an intensifier. Capitalisation here is what nova-3 will emit, so keep it
 * correct (e.g. "X-Trail", "GT-R").
 *
 * Keep the list under Deepgram's 100-keyterm limit. A few entries (Note, Leaf,
 * Spring, Wind, Master) are also everyday English words — they're real models
 * customers ask for, but trim them here if you see over-correction.
 */
export const VEHICLE_KEYTERMS: string[] = [
  // Makes
  'Nissan',
  'Renault',
  'Dacia',

  // Nissan models (current + recent UK range)
  'Micra',
  'Juke',
  'Qashqai',
  'X-Trail',
  'Leaf',
  'Ariya',
  'Note',
  'Pulsar',
  'Navara',
  'Murano',
  'Pathfinder',
  'Townstar',
  'Primastar',
  'Interstar',
  'Almera',
  'Primera',
  'Terrano',
  'Patrol',
  'GT-R',
  '370Z',
  '350Z',
  'Skyline',
  'NV200',
  'e-NV200',
  'NV300',
  'NV400',
  'Cube',
  'Figaro',
  '100NX',
  'Sunny',
  'Bluebird',
  'Pixo',
  'Serena',
  'Elgrand',
  '200SX',
  '300ZX',
  'Nismo',
  'e-Power',

  // Renault models
  'Clio',
  'Captur',
  'Megane',
  'Scenic',
  'Grand Scenic',
  'Kadjar',
  'Koleos',
  'Arkana',
  'Austral',
  'Espace',
  'Twingo',
  'Zoe',
  'Kangoo',
  'Trafic',
  'Master',
  'Talisman',
  'Laguna',
  'Modus',
  'Twizy',
  'Rafale',
  'Symbioz',
  'Fluence',
  'Wind',
  'Renault 5',
  'Renault 4',
  'Avantime',
  'Vel Satis',
  'Latitude',
  'Safrane',
  'Grand Modus',
  'Grand Espace',
  'Express',
  'E-Tech',

  // Dacia models
  'Sandero',
  'Sandero Stepway',
  'Stepway',
  'Duster',
  'Logan',
  'Jogger',
  'Spring',
  'Lodgy',
  'Dokker',
  'Bigster',
  'Logan MCV',
];

/**
 * Deterministic post-transcription find-and-replace safety net for stubborn,
 * well-known mishears. This is a BLIND whole-word swap applied by Deepgram, so
 * only add mappings that are essentially always wrong in our call context
 * (e.g. a car dealership saying "Duke" virtually always means "Juke").
 *
 * Format: [from, to] → sent to Deepgram as `replace=from:to`.
 * Add cautiously — a bad entry will rewrite legitimate words.
 */
export const VEHICLE_REPLACEMENTS: Array<[string, string]> = [
  ['Duke', 'Juke'],
  // Suggested but left disabled (risk of hitting names/words) — enable if needed:
  // ['Cashcai', 'Qashqai'],
  // ['Kashkai', 'Qashqai'],
  // ['Dasha', 'Dacia'],
];

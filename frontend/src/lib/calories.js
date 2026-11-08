// Calories per cardio set: what the rower, bike or treadmill says you burned.
//
// A cardio interval is as long as a time, a distance or a calorie count, one of them, chosen in
// the exercise's settings (lib/cardio-length.js has the choice itself). A timed one is minutes at a speed, as every cardio set always was; a calorie
// one is the machine's count at a speed, with no minutes: { kcal: 50, speed: 10, done: true }, the
// slot { sets: 4, kcal: 50, speed: 10 }. A slot with a count is a calorie one (byKcal), whatever
// default minutes it may still carry. An older app that does not know the key leaves it alone
// (api/sync-stamps.js keepKeys).

// A long session on an air bike or a ski erg can pass 1,000; nothing a person does in one set
// reaches 5,000, so a number beyond that is a typo.
export const KCAL_MAX = 5000
export const KCAL_STEP = 5

/**
 * A typed or stepped count as it is stored: a whole number between 1 and 5,000. Nothing, or 0,
 * stays nothing, so the key goes rather than holding a count nobody typed.
 */
export function clampKcal(v) {
  if (v == null || v === '') return null
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(KCAL_MAX, n)
}

/** Whether a set (or a slot) carries a calorie count. */
export const hasKcal = s => clampKcal(s?.kcal) != null

/** What a new row takes over from the set (or the plan) it follows: its count, when it had one. */
export const kcalFrom = s => (hasKcal(s) ? { kcal: clampKcal(s.kcal) } : {})

/** Whether a cardio slot (or a session's target) measures its intervals in calories, not minutes. */
export const byKcal = cfg => hasKcal(cfg)

/** Whether a logged cardio set is a calorie one: a count and no minutes (lib/cardio-length.js). */
export const isKcalSet = s => hasKcal(s) && !(Number(s?.min) > 0)

/**
 * The calories a workout's done sets add up to: cardio sets with a count, warm-ups included
 * (a walk to warm up still burned what it burned). 0 when nothing was counted.
 */
export function workoutKcal(w) {
  let n = 0
  for (const e of Array.isArray(w?.entries) ? w.entries : []) {
    for (const s of Array.isArray(e?.sets) ? e.sets : []) {
      if (s && s.done && hasKcal(s)) n += clampKcal(s.kcal)
    }
  }
  return n
}

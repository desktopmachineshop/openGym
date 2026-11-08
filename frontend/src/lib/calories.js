// Calories per cardio set: what the rower, bike or treadmill says you burned.
//
// A cardio set is minutes at a speed; `kcal` is the machine's calorie count on top of it, a whole
// number on the set itself: { min: 10, speed: 0, kcal: 120, done: true }. Like the incline
// (lib/incline.js) it is optional everywhere. A set without it is one nobody counted, exactly what
// every set logged before this was, so nothing stored is rewritten and an older app that does not
// know the key leaves it alone (api/sync-stamps.js keepKeys).
//
// The exercise's settings can plan a count per interval (`kcal` on the slot, "row 4 x 50 kcal").
// That target is what turns the Calories column on in the workout; rows already carrying a count
// keep it on whatever the plan says.

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

/** Whether a cardio exercise shows the Calories column: its plan counts them, or a row already has. */
export const kcalShown = (target, sets) => hasKcal(target) || (Array.isArray(sets) && sets.some(hasKcal))

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

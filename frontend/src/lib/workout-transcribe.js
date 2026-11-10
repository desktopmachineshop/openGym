// A workout the Coach read back from a photo or pasted text (the `transcribe` job), turned into
// what the app trains from: the rows of the review sheet, then planned exercises for a freestyle
// session or a routine. Pure, and tested beside it (workout-transcribe.test.js), because this is
// where a stranger's whiteboard becomes the numbers someone walks up to the bar with.
//
// The Coach answers with names as written and, where it was sure, a library id
// (api/coach/core/validate.js validateTranscribe). An entry without an id is matched the way an
// import matches a name (lib/log-workout.js resolveExercise), so "shoulder press" means here what
// it means in an import; a name with no match or several is left for the person to pick.
//
// Nothing arrives logged: every set is planned and unticked, as if picked by hand. Weights are
// turned into the profile's unit when they were written in the other one; a weight that was not
// written is last time's for that exercise, or none.
import { EXIDX, isCardio } from './exercises.js'
import { resolveExercise } from './log-workout.js'
import { defaultConfig, lastEntryFor, barFloor } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { withMeaning } from './dumbbells.js'
import { warmupSource, withWarmupBlock } from './warmup-ramp.js'
import { dropGrid } from './plates.js'

const LB_TO_KG = 0.45359237
export const MAX_ROWS = 40
export const MAX_SETS = 50

/** A written weight in the profile's unit, to the tenth (the importer's precision). */
export function inProfileUnit(weight, unit, profileUnit) {
  const w = Number(weight)
  if (!Number.isFinite(w) || w < 0) return null
  const to = profileUnit === 'lb' ? 'lb' : 'kg'
  if (!unit || unit === to) return w
  return Math.round((unit === 'lb' ? w * LB_TO_KG : w / LB_TO_KG) * 10) / 10
}

const known = (S, id) => !!id && (Object.hasOwn(EXIDX, id) || (S.customEx || []).some(c => c && c.id === id))

/**
 * The review sheet's rows from a validated reading (`{ title?, exercises, unreadable }`): one per
 * exercise in the order written, each with its match and its sets in the profile's unit.
 * `match`: 'coach' (the Coach named a library id), 'name' (the name matched one exercise),
 * 'several' (it matched more than one: `candidates`), 'none' (nothing: pick one or drop it).
 */
export function reviewRows(S, reading) {
  const list = Array.isArray(reading?.exercises) ? reading.exercises.slice(0, MAX_ROWS) : []
  return list.map((ex, i) => {
    const name = String(ex?.name || '').trim()
    let id = null, match = 'none', candidates = []
    if (known(S, ex?.id)) { id = ex.id; match = 'coach' }
    else {
      const hit = resolveExercise(S, name)
      if (hit.id) { id = hit.id; match = 'name' }
      else {
        candidates = (hit.candidates || []).map(c => c.id).filter(Boolean).slice(0, 5)
        match = candidates.length > 1 ? 'several' : 'none'
      }
    }
    const sets = (Array.isArray(ex?.sets) ? ex.sets : []).slice(0, MAX_SETS).map(s => {
      const row = {}
      if (Number.isInteger(s?.seconds) && s.seconds > 0) row.seconds = s.seconds
      else if (Number.isInteger(s?.reps) && s.reps > 0) {
        row.reps = s.reps
        if (Number.isInteger(s.repsMax) && s.repsMax > s.reps) row.repsMax = s.repsMax
      }
      const w = s?.weight == null ? null : inProfileUnit(s.weight, s.unit, S.unit)
      if (w != null) row.weight = w
      return row
    })
    return {
      key: 'r' + i, name, id, match, candidates, sets,
      ...(typeof ex?.note === 'string' && ex.note.trim() ? { note: ex.note.trim().slice(0, 200) } : {}),
    }
  })
}

/** Rows that will be added: the ones with an exercise picked. */
export const readyRows = rows => (rows || []).filter(r => r && r.id)

// How an exercise is done, from what was written and what the exercise is: cardio is minutes, a
// written time is a hold, anything else is reps.
function modeOf(row) {
  if (isCardio(row.id)) return 'cardio'
  return row.sets.some(s => s.seconds != null) ? 'time' : 'reps'
}

/** The plan a row stands for: the exercise's own defaults, with what was written on top. */
export function rowConfig(row) {
  const mode = modeOf(row)
  const cfg = { ...defaultConfig(row.id, mode) }
  const sets = row.sets
  if (sets.length) cfg.sets = sets.length
  const first = sets[0] || {}
  if (mode === 'time' && first.seconds) cfg.sec = first.seconds
  if (mode === 'cardio' && first.seconds) cfg.min = Math.max(1, Math.round(first.seconds / 60))
  if (mode === 'reps') {
    const counted = sets.find(s => s.reps)
    if (counted?.repsMax) { cfg.repsMin = counted.reps; cfg.reps = counted.repsMax }
    else if (counted) cfg.reps = counted.reps
  }
  const weighed = sets.find(s => s.weight != null)
  if (weighed && mode !== 'cardio') cfg.weight = weighed.weight
  return cfg
}

/** One routine slot per ready row, in order: what the routine editor appends. */
export function routineExercises(rows) {
  return readyRows(rows).map(row => ({ id: row.id, ...rowConfig(row) }))
}

/**
 * One planned entry of a freestyle session per ready row, in order: the written sets as
 * unticked rows, the exercise's warm-ups as the app would build them, and the target a hand-picked
 * exercise gets (the meaning of a dumbbell weight included). A set without a written weight
 * opens at last time's for that set, or none; a set to failure ("max") opens at 0 reps, for the
 * person to fill in.
 */
export function sessionEntries(S, rows) {
  return readyRows(rows).map(row => {
    const cfg = rowConfig(row)
    const mode = cfg.mode || modeOf(row)
    const last = (lastEntryFor(S, row.id)?.sets || []).filter(s => !isWarmupRow(s))
    const lastW = i => { const s = last[i] || last[last.length - 1]; return s && Number(s.w) > 0 ? Number(s.w) : 0 }
    const written = row.sets.length ? row.sets : Array.from({ length: cfg.sets || 1 }, () => ({}))
    let sets = written.map((s, i) => {
      if (mode === 'cardio') return { min: s.seconds ? Math.max(1, Math.round(s.seconds / 60)) : (cfg.min || 20), speed: cfg.speed || 8, done: false }
      const w = s.weight != null ? s.weight : lastW(i)
      if (mode === 'time') return { sec: s.seconds || cfg.sec || 45, w, done: false }
      return { w, r: s.reps != null ? s.reps : (row.sets.length ? 0 : cfg.reps || 10), done: false }
    })
    const full = { ...cfg, id: row.id }
    if (mode === 'reps' && ['auto', 'own'].includes(warmupSource(S, full).kind)) {
      sets = withWarmupBlock(S, full, sets, { grid: dropGrid(S, full), floor: barFloor(S, row.id), unit: S.unit })
    }
    return {
      id: row.id,
      target: withMeaning(S, cfg, row.id),
      plan: null,
      sets,
      ...(row.note ? { note: row.note } : {}),
    }
  })
}

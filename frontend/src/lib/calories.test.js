// Calories per cardio set: optional on the set, planned per interval in the exercise's settings,
// and carried everywhere a cardio set is read back, with the session's total in the summaries.
import { describe, it, expect } from 'vitest'
import { KCAL_MAX, clampKcal, hasKcal, kcalFrom, kcalShown, workoutKcal } from './calories.js'
import { setLabel, buildSets, copyRowAt, exLine } from './history.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'
import { workoutText } from './workout-text.js'
import { parseWorkoutCSV } from './import-csv.js'
import { workoutRows, WORKOUT_COLUMNS } from './export-csv.js'

const ROWER = '1161'   // rowing (with rowing machine)
const TREADMILL = '2259'

describe('clampKcal', () => {
  it('keeps a whole number between 1 and the ceiling', () => {
    expect(clampKcal(120)).toBe(120)
    expect(clampKcal('87.6')).toBe(88)
    expect(clampKcal(99999)).toBe(KCAL_MAX)
  })
  it('leaves nothing, 0 and junk as nothing, so a cleared field drops the key', () => {
    for (const v of [null, undefined, '', 0, -5, 'lots', NaN]) expect(clampKcal(v)).toBe(null)
  })
})

describe('a calorie count on a cardio set', () => {
  it('knows which sets carry one and what a new row takes over', () => {
    expect(hasKcal({ kcal: 50 })).toBe(true)
    expect(hasKcal({ kcal: 0 })).toBe(false)
    expect(hasKcal(null)).toBe(false)
    expect(kcalFrom({ kcal: 50 })).toEqual({ kcal: 50 })
    expect(kcalFrom({})).toEqual({})
  })

  it('shows the column when the plan counts calories or a row already has some', () => {
    expect(kcalShown({ kcal: 50 }, [])).toBe(true)
    expect(kcalShown({}, [{ min: 10 }, { min: 10, kcal: 90 }])).toBe(true)
    expect(kcalShown({}, [{ min: 10 }])).toBe(false)
    expect(kcalShown(undefined, undefined)).toBe(false)
  })

  it('reads in the set label and the routine line, and an uncounted set reads as before', () => {
    expect(setLabel(ROWER, { min: 10, speed: 2, kcal: 120 })).toBe('10 min @ 2 km/h · 120 kcal')
    expect(setLabel(TREADMILL, { min: 30, speed: 5, incline: 6, kcal: 240 })).toBe('30 min @ 5 km/h · 6% incline · 240 kcal')
    expect(setLabel(ROWER, { min: 10, speed: 2 })).toBe('10 min @ 2 km/h')
    expect(exLine({ id: ROWER, sets: 4, min: 5, speed: 2, kcal: 50 }, 'kg')).toBe('4 × 5 min @ 2 km/h · 50 kcal')
  })

  it('opens at last time\'s count, else the plan\'s, and copies onto a copied row', () => {
    const cfg = { id: ROWER, sets: 1, min: 5, speed: 2, kcal: 50 }
    const last = sets => ({ exWeights: {}, workouts: [{ id: 'w1', d: '2026-10-01', start: 0, end: 1, entries: [{ id: ROWER, target: { sets: 1, min: 5, speed: 2 }, sets }] }] })
    expect(buildSets({ exWeights: {}, workouts: [] }, cfg)).toEqual([{ min: 5, speed: 2, kcal: 50, done: false }])
    expect(buildSets(last([{ min: 5, speed: 2, kcal: 62, done: true }]), cfg)).toEqual([{ min: 5, speed: 2, kcal: 62, done: false }])
    expect(buildSets({ exWeights: {}, workouts: [] }, { ...cfg, kcal: undefined })).toEqual([{ min: 5, speed: 2, done: false }])
    expect(copyRowAt([{ min: 5, speed: 2, kcal: 62, done: true }], 0)[1]).toEqual({ min: 5, speed: 2, kcal: 62, done: false })
  })

  it('travels in a shared plan, clamped', () => {
    const S = { unit: 'kg', customEx: [], routines: [{ id: 'r1', name: 'Row', ex: [{ id: ROWER, sets: 4, min: 5, speed: 2, kcal: 50 }] }] }
    const file = buildPlanBundle(S, 'Row')
    expect(file.routines[0].ex[0].kcal).toBe(50)
    file.routines[0].ex[0].kcal = 1e6
    expect(parsePlan(file, 'kg').routines[0].ex[0].kcal).toBe(KCAL_MAX)
    delete file.routines[0].ex[0].kcal
    expect(parsePlan(file, 'kg').routines[0].ex[0]).not.toHaveProperty('kcal')
  })
})

describe('a workout\'s calories', () => {
  const w = { id: 'w', d: '2026-10-01', start: 0, end: 30 * 60000, name: 'Cardio', vol: 0, entries: [
    { id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 5, done: true }] },
    { id: ROWER, target: { mode: 'cardio' }, sets: [
      { min: 2, speed: 2, kcal: 20, done: true, phase: 'warmup' },
      { min: 5, speed: 2, kcal: 55, done: true },
      { min: 5, speed: 2, kcal: 50, done: false },
    ] },
    { id: TREADMILL, target: { mode: 'cardio' }, sets: [{ min: 20, speed: 5, kcal: 140, done: true }, { min: 10, speed: 5, done: true }] },
  ] }

  it('adds up the done sets that counted any, warm-ups included', () => {
    expect(workoutKcal(w)).toBe(215)
    expect(workoutKcal({ entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }] })).toBe(0)
    expect(workoutKcal(null)).toBe(0)
  })

  it('is in the workout copied as text', () => {
    expect(workoutText(w, { unit: 'kg', nameOf: () => 'rower' })).toContain('5 min @ 2 km/h · 55 kcal')
  })

  it('round-trips through the CSV export and import', () => {
    const S = { unit: 'kg', customEx: [], workouts: [w] }
    const rows = workoutRows(S)
    const col = name => WORKOUT_COLUMNS.indexOf(name)
    expect(col('calories')).toBeGreaterThan(-1)
    for (const r of rows) expect(r).toHaveLength(WORKOUT_COLUMNS.length)
    const kcals = rows.map(r => r[col('calories')])
    expect(kcals).toEqual(['', '20', '55', '140', ''])
    const csv = [WORKOUT_COLUMNS, ...rows].map(r => r.map(v => String(v ?? '')).join(',')).join('\n')
    const back = parseWorkoutCSV(csv, { unit: 'kg' }).workouts[0]
    const rower = back.entries.find(e => e.id === ROWER)
    expect(rower.sets.map(s => s.kcal)).toEqual([20, 55])
    expect(back.entries.find(e => e.id === TREADMILL).sets[1]).not.toHaveProperty('kcal')
  })

  it('reads a Calories column from another app onto cardio sets only', () => {
    const head = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Calories'
    const csv = [head, '2026-01-22 10:00:00,Mixed,Rowing,1,0,0,1,600,98', '2026-01-22 10:00:00,Mixed,Bench Press (Barbell),1,60,5,0,0,30'].join('\n')
    const ws = parseWorkoutCSV(csv, { unit: 'kg' }).workouts
    const sets = ws.flatMap(x => x.entries.flatMap(e => e.sets))
    expect(sets.find(s => s.min > 0)).toMatchObject({ kcal: 98 })
    expect(sets.find(s => s.r > 0)).not.toHaveProperty('kcal')
  })
})

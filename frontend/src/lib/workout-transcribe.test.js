import { describe, it, expect } from 'vitest'
import { reviewRows, readyRows, rowConfig, routineExercises, sessionEntries, inProfileUnit } from './workout-transcribe.js'
import { isWarmupRow } from './workout-model.js'

// 0025 barbell bench press, 0043 barbell full squat, 0294 dumbbell biceps curl, 0463 front plank,
// 3666 walking on incline treadmill (cardio).
const S = (over = {}) => ({ unit: 'kg', workouts: [], routines: [], customEx: [], warmupAuto: 'off', ...over })
const reading = {
  title: 'Leg day',
  exercises: [
    { name: 'Back squat', id: '0043', sets: [{ reps: 5, weight: 100, unit: 'kg' }, { reps: 5, weight: 100, unit: 'kg' }] },
    { name: 'Bench press', id: null, sets: [{ reps: 8, repsMax: 12, weight: 135, unit: 'lb' }, { reps: 8, repsMax: 12, weight: 135, unit: 'lb' }] },
    { name: 'Plank', sets: [{ seconds: 60 }, { seconds: 45, weight: 10 }] },
    { name: 'Pull-ups', sets: [{ reps: 8 }, {}] },
    { name: 'Zorbatron flips', sets: [{ reps: 3 }] },
    { name: 'Treadmill', note: 'easy pace', sets: [{ seconds: 600 }] },
  ],
  unreadable: ['21-15-9 for time'],
}

describe('reviewRows: the Coach’s reading, matched and in the profile’s unit', () => {
  it('keeps the written order and matches each name the way an import does', () => {
    const rows = reviewRows(S(), reading)
    expect(rows.map(r => [r.name, r.id, r.match])).toEqual([
      ['Back squat', '0043', 'coach'],
      ['Bench press', '0025', 'name'],
      ['Plank', '0463', 'name'],
      ['Pull-ups', null, 'several'],
      ['Zorbatron flips', null, 'none'],
      ['Treadmill', '3666', 'name'],
    ])
    expect(rows[3].candidates).toEqual(['0652', '0841'])
    expect(rows[5].note).toBe('easy pace')
  })
  it('turns pounds into kilos (and back), to the tenth, and keeps what was not written out', () => {
    const rows = reviewRows(S(), reading)
    expect(rows[1].sets[0]).toEqual({ reps: 8, repsMax: 12, weight: 61.2 })
    expect(rows[2].sets).toEqual([{ seconds: 60 }, { seconds: 45, weight: 10 }])
    expect(rows[3].sets).toEqual([{ reps: 8 }, {}])
    expect(reviewRows(S({ unit: 'lb' }), reading)[0].sets[0].weight).toBe(220.5)
    expect(inProfileUnit(20, null, 'lb')).toBe(20)
    expect(inProfileUnit(-1, 'kg', 'kg')).toBe(null)
  })
  it('an id the Coach named that the app does not know is matched by name instead; a custom one is kept', () => {
    const rows = reviewRows(S({ customEx: [{ id: 'cx1', n: 'Sled push' }] }), { exercises: [{ name: 'Bench press', id: '99999', sets: [] }, { name: 'sled', id: 'cx1', sets: [] }] })
    expect(rows.map(r => [r.id, r.match])).toEqual([['0025', 'name'], ['cx1', 'coach']])
  })
  it('is empty for an answer with no exercises, and never more than the cap', () => {
    expect(reviewRows(S(), null)).toEqual([])
    expect(reviewRows(S(), { exercises: Array.from({ length: 60 }, () => ({ name: 'Squat', sets: [] })) })).toHaveLength(40)
  })
})

describe('routineExercises: slots appended to a routine', () => {
  it('one slot per exercise with a match, in order, with sets, reps or time, and weight', () => {
    const rows = reviewRows(S(), reading)
    expect(readyRows(rows)).toHaveLength(4)
    const ex = routineExercises(rows)
    expect(ex.map(e => e.id)).toEqual(['0043', '0025', '0463', '3666'])
    expect(ex[0]).toMatchObject({ id: '0043', sets: 2, reps: 5, weight: 100, mode: 'reps' })
    expect(ex[1]).toMatchObject({ sets: 2, repsMin: 8, reps: 12, weight: 61.2 })
    expect(ex[2]).toMatchObject({ mode: 'time', sets: 2, sec: 60, weight: 10 })
    expect(ex[3]).toMatchObject({ sets: 1, min: 10 })
  })
  it('a match picked by hand (the review sheet) is what is added', () => {
    const rows = reviewRows(S(), reading)
    rows[3].id = '0652'
    expect(routineExercises(rows).map(e => e.id)).toEqual(['0043', '0025', '0463', '0652', '3666'])
    expect(rowConfig(rows[3])).toMatchObject({ sets: 2, reps: 8 })
  })
  it('an exercise written without sets gets the app’s defaults for it', () => {
    expect(rowConfig({ id: '0025', sets: [] })).toMatchObject({ sets: 3, reps: 10, weight: 0 })
  })
})

describe('sessionEntries: a freestyle session filled in, nothing logged', () => {
  it('every set planned and unticked, as written', () => {
    const entries = sessionEntries(S(), reviewRows(S(), reading))
    expect(entries.map(e => e.id)).toEqual(['0043', '0025', '0463', '3666'])
    expect(entries.every(e => e.sets.every(s => s.done === false))).toBe(true)
    expect(entries[0].sets).toEqual([{ w: 100, r: 5, done: false }, { w: 100, r: 5, done: false }])
    expect(entries[1].sets[0]).toEqual({ w: 61.2, r: 8, done: false })
    expect(entries[2].sets).toEqual([{ sec: 60, w: 0, done: false }, { sec: 45, w: 10, done: false }])
    expect(entries[3].sets).toEqual([{ min: 10, speed: 8, done: false }])
    expect(entries[3].note).toBe('easy pace')
    expect(entries[0].target).toMatchObject({ sets: 2, reps: 5, weight: 100 })
    expect(entries[0].plan).toBe(null)
  })
  it('a set without a weight opens at last time’s for that set; a max set at 0 reps', () => {
    const st = S({ workouts: [{ id: 'w', d: '2026-11-01', entries: [{ id: '0652', sets: [{ w: 10, r: 8, done: true }, { w: 12.5, r: 6, done: true }] }] }] })
    const rows = reviewRows(st, reading)
    rows[3].id = '0652'
    const pull = sessionEntries(st, rows).find(e => e.id === '0652')
    expect(pull.sets).toEqual([{ w: 10, r: 8, done: false }, { w: 12.5, r: 0, done: false }])
  })
  it('warm-ups come the way the app builds them for a hand-picked exercise', () => {
    const st = S({ warmupAuto: 'all' })
    const [squat] = sessionEntries(st, reviewRows(st, reading))
    const warm = squat.sets.filter(isWarmupRow)
    expect(warm.length).toBeGreaterThan(0)
    expect(squat.sets.filter(s => !isWarmupRow(s))).toEqual([{ w: 100, r: 5, done: false }, { w: 100, r: 5, done: false }])
    expect(warm.every(s => s.done === false && s.w < 100)).toBe(true)
  })
  it('a dumbbell weight carries the meaning a hand-picked dumbbell exercise gets', () => {
    const st = S({ dbLoad: { '0294': { mode: 'each', _ts: 1 } } })
    const [curl] = sessionEntries(st, [{ id: '0294', sets: [{ reps: 10, weight: 12 }] }])
    expect(curl.sets).toEqual([{ w: 12, r: 10, done: false }])
    expect(curl.target.dbLoad).toBe('each')
    expect(sessionEntries(S(), [{ id: '0294', sets: [{ reps: 10 }] }])[0].target.dbLoad).toBe(undefined)
  })
})

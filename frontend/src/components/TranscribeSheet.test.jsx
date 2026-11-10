// @vitest-environment happy-dom
// The review of a workout the Coach read from a photo: what was written beside what it matched,
// a pick among several matches, a set or an exercise removed, and only what has an exercise is
// handed on. Answering resolves the reading on the server, either way.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ S: { unit: 'kg', workouts: [], customEx: [], routines: [] }, resolve: vi.fn(async () => ({ ok: true })) }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: mocks.S })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../lib/coach-api.js', () => ({
  resolvePending: (...a) => mocks.resolve(...a),
  useCoachStatus: () => ({}), requestTranscribe: vi.fn(), jobErrorText: c => c, isDeclined: () => false,
}))
vi.mock('../sheets.jsx', () => ({ exercisePicker: vi.fn(), startFilledWorkout: vi.fn() }))
vi.mock('../coach.css', () => ({}))

const { TranscribeReview } = await import('./TranscribeSheet.jsx')

const reading = {
  id: 'j1', kind: 'transcribe', title: 'Leg day',
  exercises: [
    { name: 'Back squat', id: '0043', sets: [{ reps: 5, weight: 100, unit: 'kg' }, { reps: 5, weight: 100, unit: 'kg' }] },
    { name: 'Pull-ups', sets: [{ reps: 8 }] },
    { name: 'Zorbatron flips', sets: [{ reps: 3 }] },
  ],
  unreadable: ['21-15-9 for time'],
}

let host, root
beforeEach(() => { mocks.resolve.mockClear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const buttons = text => [...host.querySelectorAll('button')].filter(b => b.textContent.trim() === text || b.getAttribute('aria-label') === text)
const click = async el => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

describe('checking a reading', () => {
  it('shows what was written, the match, the choices and what could not be read', async () => {
    await act(async () => { root.render(<TranscribeReview p={reading} confirmLabel={() => 'Start this workout'} onConfirm={() => {}} />) })
    const text = host.textContent
    expect(text).toContain('Leg day')
    expect(text).toContain('Written: Back squat')
    expect(text).toMatch(/barbell full squat/i)
    expect(text).toContain('Which one?')
    expect(text).toContain('No match in the library. Pick one, or remove it.')
    expect(text).toContain('21-15-9 for time')
    expect(text).not.toMatch(/—/)
  })

  it('hands on only the exercises with a match, as fixed, and resolves the reading', async () => {
    const onConfirm = vi.fn(), onDone = vi.fn()
    await act(async () => { root.render(<TranscribeReview p={reading} confirmLabel={n => `Add ${n}`} onConfirm={onConfirm} onDone={onDone} />) })
    expect(buttons('Add 1')).toHaveLength(1)
    // Pick the first of the pull-up candidates, drop a squat set, remove the unknown exercise.
    await click(host.querySelectorAll('.tr-ex')[1].querySelector('.tr-cands .chip'))
    await click(host.querySelectorAll('.tr-ex')[0].querySelectorAll('.tr-x')[1])
    await click(host.querySelectorAll('.tr-ex')[2].querySelector('[aria-label="Remove"]'))
    expect(host.querySelectorAll('.tr-ex')).toHaveLength(2)
    await click(buttons('Add 2')[0])
    const [rows] = onConfirm.mock.calls[0]
    expect(rows.map(r => [r.id, r.sets.length])).toEqual([['0043', 1], ['0652', 1]])
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ accepted: ['r0', 'r1'] }))
    expect(onDone).toHaveBeenCalled()
  })

  it('Cancel dismisses the reading and adds nothing', async () => {
    const onConfirm = vi.fn()
    await act(async () => { root.render(<TranscribeReview p={reading} confirmLabel={() => 'Go'} onConfirm={onConfirm} onDone={() => {}} />) })
    await click(buttons('Cancel')[0])
    expect(onConfirm).not.toHaveBeenCalled()
    expect(mocks.resolve).toHaveBeenCalledWith({ dismissed: true })
  })
})

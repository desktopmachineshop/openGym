// @vitest-environment happy-dom
// Calories per cardio set (lib/calories.js): a column on the cardio rows when the plan counts
// them or a row already has, typed rather than stepped when it is the fourth column, and stored
// on the set.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const TREADMILL = '2259'   // walking on treadmill
const BIKE = '2138'        // stationary bike, cardio
let root, container

function mount(id, sets, target = {}, more = {}) {
  if (root) unmount()
  const S = JSON.parse(JSON.stringify(DEF))
  S.active = {
    id: 'kcal-test', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Cardio', bw: null, cur: 0, ...more,
    entries: [{ id, target: { sets: 1, min: 20, speed: 5, ...target }, sets }],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
function unmount() {
  act(() => root.unmount())
  container.remove()
  root = null
}
afterEach(() => { if (root) unmount() })

const cells = () => container.querySelector('.setrow').querySelectorAll('.stp')
const kcalCell = () => container.querySelector('.setrow .stp.kc')
const stored = () => useStore.getState().S.active.entries[0].sets[0]
const heads = () => [...container.querySelectorAll('.sethead span')].map(s => s.textContent).filter(Boolean)
function type(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the calories column', () => {
  it('is not there until the plan counts calories', () => {
    mount(BIKE, [{ min: 20, speed: 25, done: false }])
    expect(cells()).toHaveLength(2)
    expect(kcalCell()).toBe(null)
  })

  it('is the third column on a bike that counts them, stepped, and stores on the set', () => {
    mount(BIKE, [{ min: 20, speed: 25, done: false }], { kcal: 150 })
    expect(cells()).toHaveLength(3)
    expect(heads()).toEqual(['Duration (min)', 'Speed (km/h)', 'Calories'])
    expect(kcalCell().querySelector('input').value).toBe('')
    act(() => kcalCell().querySelector('button[aria-label="Increase"]').click())
    expect(stored().kcal).toBe(5)
    type(kcalCell().querySelector('input'), '187')
    expect(stored().kcal).toBe(187)
    // Cleared, the key goes: an uncounted set again.
    type(kcalCell().querySelector('input'), '')
    expect('kcal' in stored()).toBe(false)
  })

  it('shows on any exercise whose rows already carry a count', () => {
    mount(BIKE, [{ min: 20, speed: 25, kcal: 140, done: true }])
    expect(kcalCell().querySelector('input').value).toBe('140')
  })

  it('sits after the incline on a treadmill, typed rather than stepped', () => {
    mount(TREADMILL, [{ min: 20, speed: 5, incline: 4, done: false }], { kcal: 100 })
    expect(cells()).toHaveLength(4)
    expect(heads()).toEqual(['Duration (min)', 'Speed (km/h)', 'Incline (%)', 'kcal'])
    expect(kcalCell().querySelector('button')).toBe(null)
    type(kcalCell().querySelector('input'), '210')
    expect(stored()).toMatchObject({ incline: 4, kcal: 210 })
  })

  it('copies the count onto a set added below', () => {
    mount(BIKE, [{ min: 20, speed: 25, kcal: 160, done: true }])
    const add = [...container.querySelectorAll('button')].find(b => /Add set/.test(b.textContent))
    act(() => add.click())
    expect(useStore.getState().S.active.entries[0].sets[1]).toMatchObject({ min: 20, speed: 25, kcal: 160, done: false })
  })

  it('has its own stepper in the focus view', () => {
    mount(BIKE, [{ min: 20, speed: 25, kcal: 100, done: false }], {}, { workoutView: 'focus' })
    const inc = container.querySelector('button[aria-label="Increase calories"]')
    expect(inc).not.toBe(null)
    act(() => inc.click())
    expect(stored().kcal).toBe(105)
    mount(BIKE, [{ min: 20, speed: 25, done: false }], {}, { workoutView: 'focus' })
    expect(container.querySelector('button[aria-label="Increase calories"]')).toBe(null)
  })
})

// @vitest-environment happy-dom
// A cardio exercise's settings take a calorie count per interval (lib/calories.js), next to its
// minutes and speed, and save it on the slot; 0 leaves calories uncounted.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

const ROWER = '1161'       // rowing (with rowing machine)
const mounted = []
function open(ex, existing) {
  useStore.setState({ S: structuredClone(DEF), user: null })
  const onSave = vi.fn()
  exConfigSheet(ex, existing, onSave, null, null)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const labels = () => [...host.querySelectorAll('.stp-l')].map(l => l.textContent.trim())
  const field = label => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === label)?.querySelector('input.num')
  const type = (el, value) => act(() => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
  return { labels, field, type, save, onSave }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('calories in a cardio exercise\'s settings', () => {
  it('offers Calories next to Minutes and Speed and saves it on the slot', () => {
    const v = open(EXIDX[ROWER], { sets: 4, min: 5, speed: 10 })
    expect(v.labels()).toEqual(expect.arrayContaining(['Minutes', 'Calories']))
    v.type(v.field('Calories'), '50')
    v.save()
    expect(v.onSave.mock.calls[0][0]).toMatchObject({ sets: 4, min: 5, speed: 10, kcal: 50 })
  })

  it('reopens with the saved count, and 0 leaves the key out', () => {
    const v = open(EXIDX[ROWER], { sets: 4, min: 5, speed: 10, kcal: 50 })
    expect(v.field('Calories').value).toBe('50')
    v.type(v.field('Calories'), '0')
    v.save()
    expect(v.onSave.mock.calls[0][0]).not.toHaveProperty('kcal')
  })

  it('a slot that never set one keeps the shape it had', () => {
    const v = open(EXIDX[ROWER], { sets: 1, min: 20, speed: 10 })
    v.save()
    expect(v.onSave.mock.calls[0][0]).not.toHaveProperty('kcal')
  })
})

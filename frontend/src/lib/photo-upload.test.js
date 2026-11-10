import { describe, it, expect } from 'vitest'
import { fitWithin, dataOf, smallestFitting, PHOTO_EDGE } from './photo-upload.js'

describe('a photo made small before it goes to the Coach', () => {
  it('the longest edge at 1568 px, the shape kept, never upscaled', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: PHOTO_EDGE, height: 1176 })
    expect(fitWithin(1170, 2532)).toEqual({ width: 725, height: PHOTO_EDGE })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 })
  })
  it('reads the base64 out of a data URL, and nothing out of anything else', () => {
    expect(dataOf('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ')
    expect(dataOf('blob:x')).toBe('')
  })
  it('steps the JPEG quality down until it fits, and gives up past the last step', () => {
    const tried = []
    const sizes = { 0.85: 900, 0.72: 600, 0.6: 300 }
    expect(smallestFitting(q => { tried.push(q); return 'x'.repeat(sizes[q] || 100) }, 500)).toEqual({ data: 'x'.repeat(300), quality: 0.6 })
    expect(tried).toEqual([0.85, 0.72, 0.6])
    expect(smallestFitting(() => 'x'.repeat(1000), 500)).toBe(null)
  })
})

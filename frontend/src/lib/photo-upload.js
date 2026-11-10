// A photo for the Coach (the `transcribe` job), made small before it leaves the phone.
//
// A phone camera's picture is 12 megapixels and several megabytes; a model reads a whiteboard just
// as well at 1568 px on the longest edge, which is also the size above which the Anthropic API
// scales an image down itself (and bills for the pixels either way). So the browser's own canvas
// redraws it there, as a JPEG, before it is sent: no library, nothing stored. EXIF orientation is
// applied by the browser when it decodes the picture, and EXIF itself (location, camera) does not
// survive the redraw, which is the right thing to lose on the way to a third party.
import { MAX_PHOTO_CHARS } from '../../../api/coach/core/photo.js'

export const PHOTO_EDGE = 1568
const QUALITIES = [0.85, 0.72, 0.6, 0.45]

/** The size a `width` × `height` picture is drawn at: the longest edge at most `max`, never upscaled. */
export function fitWithin(width, height, max = PHOTO_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 0)), h = Math.max(1, Math.round(Number(height) || 0))
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/** The base64 part of a data: URL, or '' for anything else. */
export const dataOf = url => {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(String(url || ''))
  return m ? m[2] : ''
}

/** The first JPEG quality whose output fits under `max` characters, from `encode(quality)`; null when none does. */
export function smallestFitting(encode, max = MAX_PHOTO_CHARS) {
  for (const q of QUALITIES) {
    const data = encode(q)
    if (data && data.length <= max) return { data, quality: q }
  }
  return null
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('not an image'))
      img.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}

/**
 * The photo as the Coach takes it: `{ type: 'image/jpeg', data }` (base64), plus `preview` (a data
 * URL for the sheet to show) and its size. Rejects with `code` 'invalid' for a file that is not a
 * picture and 'toolarge' for one that will not fit however small it is drawn.
 */
export async function photoForCoach(file, { edge = PHOTO_EDGE } = {}) {
  let img
  try { img = await decode(file) } catch { throw Object.assign(new Error('not an image'), { code: 'invalid' }) }
  const { width, height } = fitWithin(img.width || img.naturalWidth, img.height || img.naturalHeight, edge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // A transparent PNG screenshot drawn onto JPEG would go black where it is clear.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  if (typeof img.close === 'function') img.close()
  const fit = smallestFitting(q => dataOf(canvas.toDataURL('image/jpeg', q)))
  if (!fit) throw Object.assign(new Error('too large'), { code: 'toolarge' })
  return { type: 'image/jpeg', data: fit.data, preview: 'data:image/jpeg;base64,' + fit.data, width, height }
}

/* A photo for the Coach (the `transcribe` job), checked before it goes anywhere.
 *
 * Shared by the server's route and the phone's own Coach, so both refuse the same things. The app
 * downscales a photo before it sends one (frontend lib/photo-upload.js: the longest edge 1568 px,
 * JPEG), which lands well under these limits; they are here for a client that does not.
 *
 * A photo is base64 inside a JSON body, and the body is capped at 5 MB (server.js MAX_BODY, and
 * nginx's client_max_body_size in front of it). MAX_PHOTO_CHARS leaves room for the rest of the
 * request inside that, and stays under the 5 MB the Anthropic API takes for one image.
 *
 * Only the formats every provider that takes photos reads, and only when the bytes say so: the
 * declared type has to match the file's own signature, so a renamed file of anything else is not
 * passed on to a provider as a picture.
 */
export const MAX_PHOTO_CHARS = 4_000_000;     // base64 characters, about 3 MB of image
export const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// The first bytes of each format, as base64 of its leading bytes: FF D8 FF, 89 50 4E 47, and
// RIFF....WEBP (the size field in between varies, so WEBP is read from the decoded bytes).
const head = (data, n) => {
  try {
    const bin = typeof atob === 'function' ? atob(data.slice(0, 24)) : Buffer.from(data.slice(0, 24), 'base64').toString('binary');
    return Array.from(bin.slice(0, n), c => c.charCodeAt(0));
  } catch { return []; }
};
function signatureOf(data) {
  const b = head(data, 12);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const tag = i => String.fromCharCode(...b.slice(i, i + 4));
  if (b.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * `{ ok: true, photo: { type, data } }` with just those two fields, or `{ ok: false, code, error }`:
 * `code` is 'toolarge' for a photo over the limit and 'invalid' for anything that is not one.
 */
export function checkPhoto(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'invalid', error: 'a photo is { type, data } with the image as base64' };
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  const data = typeof raw.data === 'string' ? raw.data : '';
  if (!PHOTO_TYPES.includes(type)) return { ok: false, code: 'invalid', error: 'the photo must be a JPEG, PNG or WebP image' };
  if (!data) return { ok: false, code: 'invalid', error: 'the photo is empty' };
  if (data.length > MAX_PHOTO_CHARS) return { ok: false, code: 'toolarge', error: 'the photo is too large, send a smaller one' };
  if (data.length % 4 !== 0 || !BASE64.test(data)) return { ok: false, code: 'invalid', error: 'the photo is not base64' };
  if (signatureOf(data) !== type) return { ok: false, code: 'invalid', error: 'the photo is not the image type it says it is' };
  return { ok: true, photo: { type, data } };
}

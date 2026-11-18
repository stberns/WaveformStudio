export const metadataFields = [
  ['TPE1', 'Artist Name'], ['TIT2', 'Track Title'], ['TALB', 'Album Title'],
  ['TRCK', 'Track Number'], ['TYER', 'Year'], ['TCON', 'Genre'], ['COMM', 'Comments']
];

function utf16(text) {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, true);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true);
  return bytes;
}

export function tagMP3(audio, metadata) {
  const frames = [];
  let size = 0;
  for (const [id] of metadataFields) {
    const text = metadata[id]?.replaceAll('\0', '').trim();
    if (!text) continue;
    const value = utf16(text);
    // ID3v2.3 comments include a language code and an empty description.
    const prefix = id === 'COMM' ? [1, 101, 110, 103, 255, 254, 0, 0] : [1];
    const frame = new Uint8Array(10 + prefix.length + value.length);
    frame.set(Array.from(id, char => char.charCodeAt(0)));
    new DataView(frame.buffer).setUint32(4, prefix.length + value.length);
    frame.set(prefix, 10);
    frame.set(value, 10 + prefix.length);
    frames.push(frame);
    size += frame.length;
  }
  if (!size) return audio;
  const header = new Uint8Array([73, 68, 51, 3, 0, 0, size >> 21 & 127, size >> 14 & 127, size >> 7 & 127, size & 127]);
  return new Blob([header, ...frames, audio], {type: 'audio/mpeg'});
}

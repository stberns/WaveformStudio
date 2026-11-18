export const rate = 44100;
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const pcm = n => Math.round(clamp(n, -1, 1) * (n < 0 ? 32768 : 32767));
export function join(...parts) {
  const data = new Float32Array(parts.reduce((n, part) => n + part.length, 0));
  let cursor = 0;
  for (const part of parts) { data.set(part, cursor); cursor += part.length; }
  return data;
}
export function wav(channels) {
  const size = channels[0].length * channels.length * 2;
  const view = new DataView(new ArrayBuffer(44 + size));
  const tag = (offset, str) => [...str].forEach((c, i) => view.setUint8(offset+i, c.charCodeAt(0)));
  const u16 = (i, n) => view.setUint16(i, n, true);
  const u32 = (i, n) => view.setUint32(i, n, true);
  tag(0, 'RIFF'); u32(4, 36 + size); tag(8, 'WAVE'); tag(12, 'fmt ');
  u32(16, 16); u16(20, 1); u16(22, channels.length); u32(24, rate);
  u32(28, rate * channels.length * 2); u16(32, channels.length * 2); u16(34, 16);
  tag(36, 'data'); u32(40, size);
  let offset = 44;
  for (let i = 0; i < channels[0].length; i++) {
    for (const channel of channels) { view.setInt16(offset, pcm(channel[i]), true); offset += 2; }
  }
  return view.buffer;
}
export function effect(data, key, value) {
  const n = data.length;
  if (key === 'reverse') return data.slice().reverse();
  let peak = 0;
  if (key === 'normalize') for (const s of data) peak = Math.max(peak, Math.abs(s));
  const gain = key === 'normalize' ? (peak ? .89125 / peak : 1) : 10 ** (value / 20);
  const delay = Math.max(1, Math.round(value * rate / 1000));
  const result = new Float32Array(n);
  let low = 0, gatePeak = 0, gateGain = 0;
  const alpha = 1 - Math.exp(-2 * Math.PI * value / rate);
  for (let i = 0; i < n; i++) {
    const s = data[i];
    switch (key) {
      case 'gain': case 'normalize': result[i] = s * gain; break;
      case 'fadein': result[i] = s * i / Math.max(1, n - 1); break;
      case 'fadeout': result[i] = s * (n - 1 - i) / Math.max(1, n - 1); break;
      case 'echo': result[i] = s + (i >= delay ? .42 * result[i - delay] : 0); break;
      case 'lowpass': case 'highpass':
        low += alpha * (s - low);
        result[i] = key === 'lowpass' ? low : s - low;
        break;
      case 'compress':
        result[i] = Math.sign(s) * (Math.min(Math.abs(s), .25) + Math.max(0, Math.abs(s) - .25) / value);
        break;
      case 'gate':
        gatePeak = Math.max(Math.abs(s), gatePeak * .999);
        gateGain += ((gatePeak >= gain ? 1 : .04) - gateGain) * .008;
        result[i] = s * gateGain;
        break;
      case 'invert': result[i] = -s; break;
      case 'silence': result[i] = 0; break;
    }
  }
  return result;
}

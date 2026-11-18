importScripts('lame.min.js');
onmessage = ({data: {channels, rate, bitrate}}) => {
  try {
    const encoder = new lamejs.Mp3Encoder(channels.length, rate, bitrate);
    const parts = [];
    for (let offset = 0; offset < channels[0].length; offset += 1152) {
      const samples = channels.map(channel => Int16Array.from(channel.subarray(offset, offset + 1152),
        n => Math.round(Math.max(-1, Math.min(1, n)) * (n < 0 ? 32768 : 32767))));
      const frame = encoder.encodeBuffer(...samples);
      if (frame.length) parts.push(frame);
    }
    parts.push(encoder.flush());
    postMessage({ blob: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (error) { postMessage({ error: error.message }); }
};

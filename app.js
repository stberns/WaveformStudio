import {rate, clamp, join, wav, effect} from './audio.js';

import {metadataFields, tagMP3} from './metadata.js';

const $ = id => document.getElementById(id);
const effects = {
  gain: ['Amplify', 'Gain (dB)', 3, -48, 24], normalize: ['Normalize to −1 dB'],
  fadein: ['Fade in'], fadeout: ['Fade out'], compress: ['Compressor', 'Compression ratio', 4, 1, 20],
  highpass: ['High-pass filter', 'Cutoff (Hz)', 120, 20, 18000],
  lowpass: ['Low-pass filter', 'Cutoff (Hz)', 3500, 20, 18000],
  echo: ['Echo', 'Delay (ms)', 180, 10, 2000], reverse: ['Reverse'], invert: ['Invert polarity'], gate: ['Noise gate', 'Threshold (dB)', -42, -90, -6], speedChange: ['Change speed and pitch', 'Speed multiplier', 1.25, .25, 4]
};
const toolbars={
  transport:[['pause','Ⅱ','Pause'],['play','▶','Play'],['stop','■','Stop'],['start','|◀','Skip to start'],['end','▶|','Skip to end'],['record','●','Record microphone']],
  modes:[['select','Ⅰ','Selection tool'],['envelope','⋈','Envelope tool · add or drag gain points from either edge'],['draw','✎','Draw tool · edit samples'],['multi','✳','Multi-tool · select, Shift for envelope, Alt for move'],['zoom','⊕','Zoom tool · select an area'],['move','↔','Time shift tool · move track']],
  editTools:[['cut','✂','Cut'],['copy','▣','Copy'],['paste','▤','Paste'],['trim','⊣','Trim to selection'],['silence','◫','Silence selection']],
  historyTools:[['undo','↶','Undo'],['redo','↷','Redo']],
  zoomTools:[['in','⊕','Zoom in'],['out','⊖','Zoom out'],['zoomSelection','⇥','Fit selection'],['fit','⛶','Fit project'],['zoomToggle','⤢','Toggle zoom']]
};
const magnifier = 'M15 15l5 5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0';
const toolbarPaths = {
  select:'M7 3h3l2 2 2-2h3 M12 5v14 M7 21h3l2-2 2 2h3',
  envelope:'M3 19L8 15l8-7 5-3 M10 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  draw:'M4 16L16 4a2.8 2.8 0 0 1 4 4L8 20l-5 1z M14 6l4 4 M4 16l4 4',
  multi:'M12 3v18 M4 7l16 10 M20 7L4 17',
  zoom:magnifier,
  move:'M3 12h18 M7 8l-4 4 4 4 M17 8l4 4-4 4',
  in:magnifier+' M7 10h6 M10 7v6',
  out:magnifier+' M7 10h6',
  zoomSelection:'M3 8v8 M21 8v8 M6 12h2l2-5 2 10 2-8 2 3h2',
  fit:'M2 7v10 M22 7v10 M5 12h2l2-5 2 10 2-8 2 3h4',
  zoomToggle:'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M8 12h8'
};
for (const [bank,tools] of Object.entries(toolbars)) {
  for (const [key,icon,label] of tools) {
    const button=document.createElement('button');
    button.dataset.action=bank==='modes'?'mode-'+key:key;
    if (bank==='transport') button.id=key;
    if (bank==='modes') button.setAttribute('aria-pressed',String(key==='select'));
    if (toolbarPaths[key]) {
      button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${toolbarPaths[key]}"/></svg>`;
    } else {
      button.textContent=icon;
    }
    button.title=label; button.setAttribute('aria-label',label);
    $(bank).append(button);
  }
}
let mode='select', previousZoom;
const menus = {
  File: {openProject:'Open project…', saveProject:'Save project…', import:'Import audio…', demo:'Load demo', export:'Export audio…'},
  Edit: {undo:'Undo', redo:'Redo', cut:'Cut', copy:'Copy', paste:'Paste', remove:'Delete selection', trim:'Trim to selection', silence:'Silence', duplicate:'Duplicate selection', split:'Split to new track'},
  Select: {all:'Entire track', none:'Clear selection'},
  View: {in:'Zoom in', out:'Zoom out', zoomSelection:'Fit selection', fit:'Fit project', zoomToggle:'Toggle zoom'},
  Transport: {play:'Play', pause:'Pause', stop:'Stop', start:'Skip to start', end:'Skip to end', record:'Record microphone', monitor:'Monitor microphone'},
  Tracks: {rename:'Rename track…', deleteTrack:'Remove track', record:'Record microphone'},
  Generate: {tone:'Tone…', noise:'White noise…', generateSilence:'Silence…'},
  Effect: Object.fromEntries(Object.entries(effects).map(([key, item]) => [key, item[0]])),
  Analyze: {analyze:'Selection statistics…'},
  Help: {help:'Toolbar and keyboard shortcuts…'}
};
$('menus').innerHTML = Object.entries(menus).map(([name, items]) =>
  `<details><summary>${name}</summary><div class="dropdown">${Object.entries(items).map(([key,label]) => `<button data-action="${key}">${label}</button>`).join('')}</div></details>`).join('');
$('effects').innerHTML = Object.entries(effects).map(([key,item]) =>
  `<button data-action="${key}">${item[0]}<span aria-hidden="true">${item.length > 1 ? '…' : '↵'}</span></button>`).join('');

let tracks = [], active = null, selection = [0, 0], cursor = 0, zoom = 1, origin = 0;
let undo = [], redo = [], clipboard, audio, playing, recording, exporting = false, serial = 0;
const status = msg => { $('status').textContent = msg; };
const context = () => (audio ??= new AudioContext({sampleRate: rate}));
const length = track => track.channels[0].length / rate;
const duration = () => tracks.reduce((max, track) => Math.max(max, track.offset + length(track)), 0);
const selected = () => tracks.find(track => track.id === active);
const bounds = () => [...selection].sort((a,b) => a-b);
const hasRange = () => Math.abs(selection[1] - selection[0]) >= 1 / rate;
const time = seconds => {
  const ms = Math.round(Math.max(0,seconds) * 1000);
  return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
};
const visible = () => Math.max(1, duration() ? duration() * 1.06 : 30) / zoom;
const clampOrigin = () => { origin = clamp(origin, 0, Math.max(0, duration() - visible() * .6)); };
const defaultProjectName = 'Untitled Session';
const projectInput = $('project');
let projectName = defaultProjectName, metadata = {};
function setProjectName(name) {
  projectName = name.trim().slice(0,projectInput.maxLength) || defaultProjectName;
  projectInput.value = projectName;
}
function fileStem(name) {
  return name.replace(/[<>:"/\\|?*]/g,'_').replace(/[. ]+$/g,'') || defaultProjectName;
}
const snapshot = () => ({ tracks, active, selection, cursor, projectName, metadata });
function checkpoint() {
  stop();
  undo.push(snapshot());
  if (undo.length > 24) undo.shift();
  redo = [];
  historyButtons();
}
function restore(from, to) {
  if (!from.length) return;
  stop();
  to.push(snapshot());
  const prior=from.pop();
  ({tracks, active, selection, cursor, metadata} = prior);
  setProjectName(prior.projectName);
  clampOrigin();
  render();
}
function update(track, changes) {
  tracks = tracks.map(item => item.id === track.id ? {...item, ...changes} : item);
}
function add(name, channels, offset = 0) {
  const id = ++serial;
  tracks = [...tracks, {id, name, channels, offset, gain:0, pan:0, mute:false, solo:false}];
  active = id;
  selection = [offset,offset];
  cursor = offset;
}
async function importFiles(files) {
  if (!files.length) return;
  status('Reading audio…');
  const failures = [];
  const decoded = [];
  for (const file of files) {
    try {
      const buffer = await context().decodeAudioData(await file.arrayBuffer());
      decoded.push([file.name, Array.from({length:Math.min(2, buffer.numberOfChannels)}, (_, i) => buffer.getChannelData(i).slice())]);
    } catch { failures.push(file.name); }
  }
  if (decoded.length) {
    checkpoint();
    for (const [name, channels] of decoded) add(name, channels);
    origin = 0; zoom = 1; render();
  }
  status(failures.length ? `Could not open ${failures.join(', ')}` : `Imported ${decoded.length} audio ${decoded.length === 1 ? 'file' : 'files'}`);
}
function demo() {
  const phrase = [47,49,50,52,54,50,54];
  // MIDI note numbers in B minor. Each entry is an eighth note unless a length is supplied.
  const theme = [
    ...phrase.slice(0,-1), [54,2],
    53,49,[53,2], 52,48,[52,2],
    ...phrase,59,
    57,54,50,54,[57,4]
  ];
  const eighthNotes = theme.reduce((sum,note)=>sum+(Array.isArray(note)?note[1]:1),0);
  const passes = [
    {tempo:84, octave:0, level:.28},
    {tempo:112, octave:0, level:.42},
    {tempo:140, octave:12, level:.56},
    {tempo:168, octave:12, level:.68}
  ];
  const total = eighthNotes*passes.reduce((sum,pass)=>sum+30/pass.tempo,0);
  const left = new Float32Array(Math.ceil((total+.24)*rate));
  const right = new Float32Array(left.length);
  let start = 0;
  for (const {tempo,octave,level} of passes) {
    for (const note of theme) {
      const [pitch,length] = Array.isArray(note)?note:[note,1];
      const duration = 30/tempo*length;
      const frequency = 440*2**((pitch+octave-69)/12);
      const frame = Math.round(start*rate);
      for (let i=0; i<Math.round(duration*rate); i++) {
        const t = i/rate;
        const phase = 2*Math.PI*frequency*t;
        const gain = level*Math.min(1,t/.008,(duration-t)/.024)*Math.exp(-2.4*t);
        const tone = .65*Math.sin(phase)+.22*Math.sin(2*phase)+.10*Math.sin(3*phase);
        const bass = octave ? .16*Math.sin(phase/2) : 0;
        left[frame+i] = gain*(tone+bass);
        right[frame+i] = gain*(.94*tone+bass);
      }
      start+=duration;
    }
  }
  checkpoint();
  add('In the Hall of the Mountain King — Edvard Grieg', [left,right]);
  zoom=1; origin=0; render();
  status('Loaded Grieg’s In the Hall of the Mountain King');
}
function range(track, full = false) {
  const [a,b] = full && !hasRange() ? [track.offset, track.offset + length(track)] : bounds();
  return [a,b].map(t => clamp(Math.round((t-track.offset)*rate), 0, track.channels[0].length));
}
function ask(title, fields, label='Apply', configure) {
  $('dialogTitle').textContent = title;
  $('dialogBody').replaceChildren();
  for (const [name, caption, value, options] of fields) {
    const wrapper = document.createElement('label');
    wrapper.textContent = caption;
    const input = document.createElement(Array.isArray(options) ? 'select' : options?.multiline ? 'textarea' : 'input');
    input.name = name;
    if (Array.isArray(options)) {
      for (const [id,text] of options) input.add(new Option(text,id));
    } else if (options?.optional) {
      input.maxLength = 2048;
      if (options.multiline) input.rows = 3;
    } else if (options) {
      input.type='number'; input.min=options.min; input.max=options.max; input.step='any';
    }
    input.required=!options?.optional;
    input.value=value;
    wrapper.append(input);
    $('dialogBody').append(wrapper);
  }
  configure?.($('form'));
  $('confirm').textContent = label;
  $('dialog').returnValue = '';
  $('dialog').showModal();
  return new Promise(resolve => $('dialog').addEventListener('close', () => {
    resolve($('dialog').returnValue === 'ok' ? Object.fromEntries(new FormData($('form'))) : null);
  }, {once:true}));
}
function setRange(a,b) {
  selection = [clamp(a,0,duration()),clamp(b,0,duration())];
  cursor = Math.min(...selection);
  paint();
}
async function apply(key) {
  const track=selected();
  if (!track) return status('Import or select a track first');
  const [a,b]=range(track,true);
  if (a===b) return status('Select a range inside the track');
  const [label, caption, preset, min, max] = effects[key];
  const result = caption ? await ask(label,[['value',caption,preset,{min,max}]]) : {value:0};
  if (!result) return;
  checkpoint();
  let peak = 0;
  if (key === 'normalize') {
    for (const channel of track.channels) for (let i=a;i<b;i++) peak=Math.max(peak,Math.abs(channel[i]));
  }
  if (key === 'speedChange') {
    const channels=track.channels.map(channel=>{
      const size=Math.max(1,Math.round((b-a)/+result.value));
      const output=Float32Array.from({length:size},(_,i)=>{
        const position=Math.min(b-1,a+i*+result.value), left=Math.floor(position);
        return channel[left]+((channel[Math.min(b-1,left+1)]-channel[left])*(position-left));
      });
      return join(channel.subarray(0,a),output,channel.subarray(b));
    });
    update(track,{channels});selection=[track.offset+a/rate,track.offset+(a+channels[0].length-track.channels[0].length+b-a)/rate];
    render();status('Changed speed and pitch');return;
  }
  update(track, {channels:track.channels.map(channel => {
    const piece = channel.subarray(a,b);
    const processed = key === 'normalize' ? effect(piece,'gain',peak ? 20*Math.log10(.89125/peak) : 0) : effect(piece,key,+result.value);
    return join(channel.subarray(0,a),processed,channel.subarray(b));
  })});
  render(); status(`Applied ${label.toLowerCase()}`);
}
function edit(key) {
  const track=selected();
  if (!track) return status('Import or select a track first');
  const [a,b] = range(track);
  const msg = 'Drag over the waveform to select audio';
  if (key !== 'paste' && a===b) return status(msg);
  if (['copy','cut'].includes(key)) clipboard = track.channels.map(c => c.slice(a,b));
  if (key === 'copy') return status('Copied selection');
  if (key === 'paste' && !clipboard) return status('Copy or cut audio first');
  checkpoint();
  const clip = track.channels.map(c => c.slice(a,b));
  const start = track.offset + a/rate;
  if (key === 'duplicate' || key === 'split') {
    if (key === 'split') update(track,{channels:track.channels.map(c => join(c.subarray(0,a),new Float32Array(b-a),c.subarray(b)))});
    add(track.name + (key === 'split' ? ' (split)' : ' (copy)'),clip,start);
  } else if (key === 'trim') {
    update(track,{channels:clip,offset:start}); selection=[start,start]; cursor=start;
  } else if (key === 'paste') {
    update(track,{channels:track.channels.map((c,i) => join(c.subarray(0,a),clipboard[i] ?? clipboard[0],c.subarray(b)))});
    selection = [start,start+clipboard[0].length/rate]; cursor=start;
  } else if (key === 'silence') {
    update(track,{channels:track.channels.map(c => join(c.subarray(0,a),new Float32Array(b-a),c.subarray(b)))});
  } else if (b-a===track.channels[0].length) {
    tracks=tracks.filter(t=>t.id!==active); active=tracks[0]?.id; selection=[0,0]; cursor=0;
  } else {
    update(track,{channels:track.channels.map(c=>join(c.subarray(0,a),c.subarray(b)))});
    selection=[start,start]; cursor=start;
  }
  clampOrigin(); render(); status(({cut:'Cut',paste:'Pasted',remove:'Deleted',trim:'Trimmed',silence:'Silenced',duplicate:'Duplicated',split:'Split'})[key]+' selection');
}
function audible() {
  const solo=tracks.some(track=>track.solo);
  return tracks.filter(t=>!t.mute && (!solo || t.solo));
}
function envelopeGain(points, t) {
  if (!points.length) return 1;
  let left=0, right=points.length;
  while (left<right) {
    const midpoint=(left+right)>>>1;
    if (points[midpoint].t<t) left=midpoint+1;
    else right=midpoint;
  }
  if (right===points.length) return points.at(-1).gain;
  if (right===0) return points[0].gain;
  const a=points[right-1],b=points[right];
  return a.gain+(b.gain-a.gain)*(t-a.t)/(b.t-a.t);
}
function schedule(ctx, dest, start, end, speed=1) {
  const when=ctx.currentTime;
  const sources = [];
  for (const track of audible()) {
    const position=Math.max(start,track.offset);
    const stopAt=Math.min(end,track.offset+length(track));
    if (position>=stopAt) continue;
    const source=ctx.createBufferSource();
    const buffer=ctx.createBuffer(track.channels.length,track.channels[0].length,rate);
    track.channels.forEach((channel,i)=>buffer.copyToChannel(channel,i));
    source.buffer=buffer;
    const gain=ctx.createGain(), pan=ctx.createStereoPanner();
    const baseGain=10**(track.gain/20);
    const points=track.envelope??[];
    const localStart=position-track.offset, localEnd=stopAt-track.offset;
    const scheduleAt=t=>when+(track.offset+t-start)/speed;
    gain.gain.setValueAtTime(baseGain*envelopeGain(points,localStart),scheduleAt(localStart));
    for (const point of points) {
      if(point.t>localStart && point.t<localEnd) gain.gain.linearRampToValueAtTime(baseGain*point.gain,scheduleAt(point.t));
    }
    gain.gain.linearRampToValueAtTime(baseGain*envelopeGain(points,localEnd),scheduleAt(localEnd));
    pan.pan.value=track.pan/100;
    source.connect(gain).connect(pan).connect(dest);
    source.playbackRate.value=speed;
    source.start(when+(position-start)/speed,position-track.offset,stopAt-position);
    source.onended=()=>{source.disconnect();gain.disconnect();pan.disconnect();};
    sources.push(source);
  }
  return sources;
}
function stop() {
  if (!playing) return;
  for (const source of playing.sources) source.stop();
  playing=null;
  $('play').textContent='▶'; $('play').setAttribute('aria-label','Play');
}
async function play() {
  if (playing) {
    const current=playTime(); stop(); cursor=current; paint(); return;
  }
  if (!tracks.length) return status('Import audio to start playback');
  const ctx=context(); await ctx.resume();
  if (playing) return;
  const end=hasRange() ? bounds()[1] : duration();
  const start=cursor>=end ? (hasRange() ? bounds()[0] : 0) : cursor;
  if (start>=end) return;
  const speed=+$('speed').value;
  initOutput(ctx);
  playing={start,end,speed,when:ctx.currentTime,sources:schedule(ctx,outputGain,start,end,speed)};
  $('play').textContent='Ⅱ'; $('play').setAttribute('aria-label','Pause');
  requestAnimationFrame(tick);
}
const playTime=()=>Math.min(playing.end,playing.start+(audio.currentTime-playing.when)*playing.speed);
function tick() {
  if (!playing) return;
  if (playTime()>=playing.end) { cursor=hasRange()?bounds()[0]:0; stop(); paint(); return; }
  paint(); requestAnimationFrame(tick);
}
const recordingDialog = $('recordDialog');
function recordMessage(message) {
  $('recordStatus').textContent = message;
}
function finishRecording(take) {
  take.cleanup?.();
  if (recording !== take) return;
  recording = null;
  if (!monitoring) releaseMic();
  $('record').classList.remove('active');
  $('record').setAttribute('aria-pressed','false');
}
function micError(error) {
  if (window.self !== window.top) {
    $('openRecordingTab').hidden = false;
    return 'This embedded view could not access the microphone. Open Waveform Studio in its own tab and allow access there.';
  }
  if (error.name === 'NotAllowedError') return 'Microphone access was blocked. Allow microphone access in your browser site settings and try again.';
  if (error.name === 'NotFoundError') return 'No microphone found. Connect a microphone and try again.';
  return 'Could not open the microphone. Check the selected input and your device settings.';
}
function recordingError(take, message) {
  if (recording !== take) return;
  finishRecording(take);
  recordMessage(message);
  status(message);
  $('finishTake').textContent = 'Start recording';
  $('finishTake').disabled = true;
  $('recordInputLabel').hidden = true;
  $('allowMic').hidden = false;
}
async function prepareMic(deviceId = '') {
  if (recording) return;
  const request = recording = {};
  const select = $('recordInput');
  const allow = $('allowMic');
  allow.disabled = true;
  select.disabled = true;
  $('finishTake').disabled = true;
  recordMessage('Waiting for microphone access…');
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error();
    const ctx = context();
    await ctx.resume();
    if (recording !== request) return;
    const input = await microphone(deviceId);
    if (recording !== request) {
      if (!recording && !monitoring) releaseMic();
      return;
    }
    const devices = (await navigator.mediaDevices.enumerateDevices().catch(()=>[]))
      .filter(device=>device.kind === 'audioinput' && device.deviceId);
    if (recording !== request) return;
    select.replaceChildren(new Option('System default',''));
    devices.filter(device=>device.deviceId !== 'default').forEach((device,i)=>
      select.add(new Option(device.label || `Microphone ${i+1}`,device.deviceId)));
    select.value = devices.some(device=>device.deviceId === deviceId) ? deviceId : '';
    allow.hidden = true;
    $('recordInputLabel').hidden = false;
    $('finishTake').disabled = false;
    recordMessage('Speak to check the input levels, then select Start recording.');
    request.input = input;
  } catch (error) {
    recordingError(request,micError(error));
  } finally {
    allow.disabled = false;
    select.disabled = false;
  }
}
async function record() {
  if (!recordingDialog.open) {
    $('recordClock').textContent = time(0);
    $('finishTake').textContent = 'Start recording';
    $('finishTake').disabled = true;
    $('allowMic').hidden = false;
    $('recordInputLabel').hidden = true;
    $('openRecordingTab').hidden = window.self === window.top;
    recordMessage('Allow microphone access to choose your input and test the levels.');
    recordingDialog.showModal();
    return;
  }
  const take = recording;
  if (take?.recorder?.state === 'recording') {
    $('finishTake').disabled = true;
    recordMessage('Adding recording to the timeline…');
    take.recorder.stop();
    return;
  }
  if (!take?.input || take.recorder) return;
  try {
    const input = take.input;
    const ctx = context();
    stop();
    const destination = ctx.createMediaStreamDestination();
    input.gain.connect(destination);
    take.cleanup = () => {
      input.gain.disconnect(destination);
      destination.stream.getTracks().forEach(track=>track.stop());
    };
    const recorder = new MediaRecorder(destination.stream);
    take.recorder = recorder;
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => recordingError(take,'Recording failed. Try again.');
    recorder.onstop = async () => {
      if (recording !== take) return;
      try {
        const bytes = await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer();
        const buffer = await ctx.decodeAudioData(bytes);
        if (recording !== take) return;
        const channels = Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i).slice());
        finishRecording(take);
        checkpoint();
        add('Microphone recording',channels);
        origin=0; zoom=1; render();
        recordingDialog.close();
        status('Added microphone recording to the timeline');
      } catch {
        recordingError(take,'The recording could not be added. Try a longer take.');
      }
    };
    recorder.start();
    take.startedAt = performance.now();
    $('record').classList.add('active');
    $('record').setAttribute('aria-pressed','true');
    recordMessage('Recording…');
    $('finishTake').textContent = 'Stop and add track';
    $('recordInput').disabled = true;
    $('finishTake').disabled = false;
    $('finishTake').focus();
  } catch (error) {
    recordingError(take,error.name === 'NotAllowedError'
      ? 'Microphone access was denied. Allow microphone access in your browser, then try again.'
      : 'Microphone unavailable. Check that a microphone is connected, then try again.');
  }
}
$('finishTake').onclick = record;
$('allowMic').onclick = ()=>prepareMic();
$('recordInput').onchange = event=>{
  if (!recording?.input || recording.recorder) return;
  recording = null;
  prepareMic(event.target.value);
};
function cancelTake() {
  const take = recording;
  if (take) {
    if (take.recorder && take.recorder.state !== 'inactive') take.recorder.stop();
    finishRecording(take);
  }
  recordingDialog.close();
  status('Recording window closed');
}
$('discardTake').onclick = cancelTake;
recordingDialog.addEventListener('cancel',event=>{event.preventDefault();cancelTake();});
let outputGain, outputMeters, mic, openingMic, monitoring=false;
function meterNodes(ctx, source) {
  const split=ctx.createChannelSplitter(2);
  source.connect(split);
  return [0,1].map(i=>{
    const analyzer=ctx.createAnalyser();
    analyzer.fftSize=512;
    split.connect(analyzer,i);
    return {analyzer,buffer:new Float32Array(analyzer.fftSize)};
  });
}
function initOutput(ctx) {
  if (outputGain) return;
  outputGain=ctx.createGain();
  outputGain.gain.value=+$('volume').value/100;
  outputGain.connect(ctx.destination);
  outputMeters=meterNodes(ctx,outputGain);
}
async function microphone(deviceId) {
  if (mic && (deviceId === undefined || mic.deviceId === deviceId)) return mic;
  if (openingMic) {
    await openingMic;
    return microphone(deviceId);
  }
  if (mic) releaseMic();
  if (!openingMic) openingMic=(async()=>{
    const stream=await navigator.mediaDevices.getUserMedia({audio:deviceId ? {deviceId:{exact:deviceId}} : true});
    const ctx=context(),source=ctx.createMediaStreamSource(stream),gain=ctx.createGain();
    gain.channelCount=2;
    gain.channelCountMode='explicit';
    gain.gain.value=+$('micGain').value/100;
    source.connect(gain);
    const meters=meterNodes(ctx,gain);
    // Keep the input analysis graph running without playing microphone audio.
    const silent=ctx.createGain();
    silent.gain.value=0;
    for (const {analyzer} of meters) analyzer.connect(silent);
    silent.connect(ctx.destination);
    return (mic={stream,source,gain,meters,silent,deviceId:deviceId ?? ''});
  })().finally(()=>{openingMic=null;});
  return openingMic;
}
function releaseMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach(track=>track.stop());
  mic.source.disconnect();mic.gain.disconnect();mic.silent.disconnect();mic=null;
}
async function monitor() {
  if (monitoring) {
    monitoring=false;
    if (!recording) releaseMic();
  } else {
    await context().resume();
    await microphone();
    monitoring=true;
  }
  $('micMeter').setAttribute('aria-pressed',monitoring);
  $('micMeter').querySelector('.meter-label').hidden=monitoring;
}
$('volume').oninput=()=>{if(outputGain) outputGain.gain.value=+$('volume').value/100;};
$('micGain').oninput=()=>{if(mic) mic.gain.gain.value=+$('micGain').value/100;};
$('speed').oninput=()=>{$('speedValue').textContent=(+$('speed').value).toFixed(2)+'×';};
function showLevels(id, meters) {
  $(id).querySelectorAll('i').forEach((node,i)=>{
    let peak=0;
    const channel=meters?.[i];
    if (channel) {
      channel.analyzer.getFloatTimeDomainData(channel.buffer);
      for (const n of channel.buffer) peak=Math.max(peak,Math.abs(n));
    }
    node.style.setProperty('--level',clamp((20*Math.log10(peak)+54)/54*100,0,100)+'%');
  });
}
setInterval(()=>{
  showLevels('outMeter',playing?outputMeters:null);
  showLevels('micMeter',monitoring||recording?mic?.meters:null);
  if (recordingDialog.open) {
    showLevels('recordLevels',recording?.input ? mic?.meters : null);
    if (recording?.recorder?.state === 'recording') $('recordClock').textContent=time((performance.now()-recording.startedAt)/1000);
  }
},55);
async function generate(key) {
  const fields=[['seconds','Duration (seconds)',3,{min:.01,max:180}]];
  if (key==='tone') fields.push(['frequency','Frequency (Hz)',440,{min:20,max:20000}]);
  const name={tone:'Tone',noise:'White noise',generateSilence:'Silence'}[key];
  const result=await ask('Generate '+name.toLowerCase(),fields,'Generate');
  if (!result) return;
  const samples=Float32Array.from({length:Math.round(+result.seconds*rate)},(_,i)=>{
    if(key==='tone') return .5*Math.sin(2*Math.PI*i*(+result.frequency)/rate);
    return key==='noise'?.65*(2*Math.random()-1):0;
  });
  checkpoint();add(name,[samples],cursor);render();status('Generated '+name.toLowerCase());
}
function details(title, content) {
  $('dialogTitle').textContent=title;$('dialogBody').textContent=content;
  $('confirm').textContent='Done';$('dialog').showModal();
}
function analysis() {
  const track=selected();
  if (!track) return status('Select a track to analyze');
  const [a,b]=range(track,true);
  if (a===b) return status('The selected range is empty');
  let sum=0,peak=0;
  for(const channel of track.channels) for(let i=a;i<b;i++){
    sum+=channel[i]**2;peak=Math.max(peak,Math.abs(channel[i]));
  }
  const db=n=>n?(20*Math.log10(n)).toFixed(1):'−∞';
  details('Selection statistics',`Duration ${time((b-a)/rate)} · Peak ${db(peak)} dBFS · RMS ${db(Math.sqrt(sum/((b-a)*track.channels.length)))} dBFS`);
}
function encodeMP3(channels, bitrate) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker('mp3-worker.js');
    worker.onmessage=e=>{worker.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data.blob);};
    worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};
    worker.postMessage({channels,rate,bitrate},channels.map(c=>c.buffer));
  });
}
function download(blob,name) {
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download=name;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function saveProject() {
  if (!tracks.length) return status('Import or generate audio before saving');
  const manifest=tracks.map(({channels,...track})=>({...track, frames:channels[0].length, count:channels.length}));
  const meta=new TextEncoder().encode(JSON.stringify({format:'Waveform Studio',version:1,rate,tracks:manifest,metadata}));
  const header=new DataView(new ArrayBuffer(4));
  header.setUint32(0,meta.length,true);
  download(new Blob([header.buffer,meta,...tracks.flatMap(track=>track.channels)]),fileStem(projectName)+'.waveproject');
  status('Downloaded editable project');
}
async function openProject(file) {
  if (/\.aup3$/i.test(file.name)) {
    return details('Audacity project', 'Open this .aup3 file in Audacity and export the audio as WAV. You can then import the WAV into Waveform Studio.');
  }
  try {
    const data=await file.arrayBuffer(), view=new DataView(data), size=view.getUint32(0,true);
    if (size>data.byteLength-4) throw Error();
    const manifest=JSON.parse(new TextDecoder().decode(new Uint8Array(data,4,size)));
    if (manifest.format!=='Waveform Studio'||manifest.version!==1||manifest.rate!==rate||!Array.isArray(manifest.tracks)) throw Error();
    let offset=4+size;
    const loaded=manifest.tracks.map(track=>{
      const {name,frames,count,gain,pan,offset:start,mute,solo,envelope}=track;
      if(typeof name!=='string'||!Number.isSafeInteger(frames)||frames<1||
        ![1,2].includes(count)||!Number.isFinite(start)||start<0||
        !Number.isFinite(gain)||!Number.isFinite(pan)||offset+frames*count*4>data.byteLength) throw Error();
      const channels=Array.from({length:count},()=>{
        const channel=new Float32Array(data.slice(offset,offset+frames*4));
        offset+=frames*4; return channel;
      });
      return {id:++serial,name,channels,offset:start,envelope:Array.isArray(envelope)?envelope.filter(p=>p&&Number.isFinite(p.t)&&p.t>=0&&Number.isFinite(p.gain)&&p.gain>=0&&p.gain<=2).sort((a,b)=>a.t-b.t):[],gain:clamp(gain,-36,18),pan:clamp(pan,-100,100),mute:!!mute,solo:!!solo};
    });
    if(offset!==data.byteLength) throw Error();
    checkpoint();
    metadata=Object.fromEntries(metadataFields.flatMap(([id]) =>
      typeof manifest.metadata?.[id] === 'string' ? [[id, manifest.metadata[id].slice(0,2048)]] : []));
    tracks=loaded;active=loaded[0]?.id;selection=[0,0];cursor=0;origin=0;zoom=1;render();
    setProjectName(file.name.replace(/\.waveproject$/i,''));
    status('Opened editable project. Use Undo to restore the previous session.');
  } catch {status('Could not open this project. Choose a Waveform Studio project file.');}
}
function configureExport(form) {
  const format = form.elements.namedItem('format');
  const bitrate = form.elements.namedItem('bitrate');
  const panel = document.createElement('details');
  panel.className = 'export-metadata';
  const summary = document.createElement('summary');
  summary.textContent = 'Edit metadata';
  panel.append(summary);
  const inputs = metadataFields.map(([id])=>form.elements.namedItem(id));
  for (const input of inputs) panel.append(input.closest('label'));
  $('dialogBody').append(panel);
  function updateFormat() {
    const mp3 = format.value === 'mp3';
    panel.hidden = !mp3;
    bitrate.closest('label').hidden = !mp3;
    bitrate.disabled = !mp3;
    for (const input of inputs) input.disabled = !mp3;
  }
  format.addEventListener('change',updateFormat);
  updateFormat();
}
async function exportAudio() {
  if (!tracks.length) return status('Import audio before exporting');
  if (exporting) return;
  const scopes=[['mix','Entire mix']];
  if (hasRange()) scopes.push(['selection','Selected time range']);
  const result=await ask('Export audio',[
    ['name','File name',projectName === defaultProjectName ? selected()?.name.replace(/\.[^.]+$/,'') || defaultProjectName : fileStem(projectName)],
    ['format','Format','wav',[['wav','WAV · 16-bit PCM'],['mp3','MP3']]],
    ['bitrate','MP3 quality','192',[['128','128 kbps'],['192','192 kbps'],['320','320 kbps']]],
    ['scope','Range','mix',scopes],
    ...metadataFields.map(([id,caption])=>[id,caption,metadata[id] ?? '',{optional:true,multiline:id==='COMM'}])
  ],'Download',configureExport);
  if (!result) return;
  const [a,b]=result.scope==='selection'?bounds():[0,duration()];
  if (!audible().length) return status('Unmute a track before exporting');
  if (b-a<1/rate) return status('The export range is empty');
  const exportMetadata=Object.fromEntries(metadataFields.map(([id])=>[id,result[id] ?? '']));
  exporting=true; $('export').disabled=true; status('Rendering audio…');
  try {
    const offline=new OfflineAudioContext(2,Math.max(1,Math.round((b-a)*rate)),rate);
    schedule(offline,offline.destination,a,b);
    const rendered=await offline.startRendering();
    const channels=[rendered.getChannelData(0).slice(),rendered.getChannelData(1).slice()];
    const blob=result.format==='mp3'?tagMP3(await encodeMP3(channels,+result.bitrate),exportMetadata):new Blob([wav(channels)],{type:'audio/wav'});
    const name=fileStem(result.name.trim().replace(/\.(wav|mp3)$/i,''))+'.'+result.format;
    download(blob,name);
    if (result.format==='mp3') metadata=exportMetadata;
    status(`Downloaded ${name}`);
  } catch { status('Export failed. Try a shorter range or another format.'); }
  finally { exporting=false; $('export').disabled=!tracks.length; }
}
function surface(canvas) {
  const {width,height}=canvas.getBoundingClientRect();
  const dpr=devicePixelRatio || 1;
  const w=Math.round(width*dpr), h=Math.round(height*dpr);
  if (canvas.width!==w || canvas.height!==h) { canvas.width=w; canvas.height=h; }
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,width,height};
}
function grid(ctx,w,h,ruler=false) {
  const raw=visible()/Math.max(1,w/86);
  const magnitude=10**Math.floor(Math.log10(raw));
  const step=([1,2,5,10].find(n=>n*magnitude>=raw) || 10)*magnitude;
  ctx.lineWidth=1; ctx.font='10px monospace';
  for (let t=Math.ceil(origin/step)*step;t<=origin+visible();t+=step) {
    const x=Math.round((t-origin)/visible()*w)+.5;
    ctx.strokeStyle=ruler?waveformColors.tick:waveformColors.grid;
    ctx.beginPath();ctx.moveTo(x,ruler?h-8:0);ctx.lineTo(x,h);ctx.stroke();
    if (ruler) {ctx.fillStyle=waveformColors.label;ctx.fillText(step<1?t.toFixed(2)+'s':time(t).slice(0,5),x+4,16);}
  }
}
const waveformCache = new WeakMap();
function envelope(track, width) {
  const cached = waveformCache.get(track.channels);
  if (cached && cached.width === width && cached.origin === origin &&
      cached.span === visible() && cached.offset === track.offset) return cached;
  const span=visible();
  const values=track.channels.map(channel=>{
    const bins = [];
    for (let x=0;x<width;x++) {
      const a=Math.max(0,Math.floor((origin+x/width*span-track.offset)*rate));
      const b=Math.min(channel.length,Math.ceil((origin+(x+1)/width*span-track.offset)*rate));
      if (a>=b) continue;
      const stride=Math.max(1,Math.floor((b-a)/80));
      let lo=0,hi=0;
      for (let i=a;i<b;i+=stride) {lo=Math.min(lo,channel[i]);hi=Math.max(hi,channel[i]);}
      bins.push([x,lo,hi]);
    }
    return bins;
  });
  const entry={width,origin,span,offset:track.offset,values};
  waveformCache.set(track.channels,entry);
  return entry;
}
const unityRadius=.37, maxRadius=.48;
function envelopeRadius(gain) {
  return gain<=1 ? unityRadius*gain : unityRadius+(maxRadius-unityRadius)*(gain-1);
}
function envelopeFromRadius(radius) {
  return clamp(radius<=unityRadius ? radius/unityRadius : 1+(radius-unityRadius)/(maxRadius-unityRadius),0,2);
}
function paint() {
  const at = playing ? playTime() : cursor;
  const [a,b] = bounds();
  $('clock').textContent=time(at);
  for (const [id,n] of [['from',a],['to',b]]) if (document.activeElement!==$(id)) $(id).value=n.toFixed(3);
  const ruler=surface($('ruler'));
  ruler.ctx.clearRect(0,0,ruler.width,ruler.height);
  grid(ruler.ctx,ruler.width,ruler.height,true);
  for (const [index,canvas] of [...$('tracks').querySelectorAll('canvas')].entries()) {
    const track=tracks[index];
    if (!track) continue;
    const {ctx,width,height}=surface(canvas);
    const X=t=>(t-origin)*width/visible();
    ctx.fillStyle=waveformColors.backdrop;ctx.fillRect(0,0,width,height);
    const left = X(track.offset), clipWidth = X(track.offset+length(track))-left;
    ctx.fillStyle=track.id===active?waveformColors.active:waveformColors.clip;
    ctx.fillRect(left,0,clipWidth,height);
    grid(ctx,width,height);
    const laneHeight=height/track.channels.length;
    const points=track.envelope??[];
    const gains=points.length ? Array.from({length:Math.ceil(width)},(_,x)=>
      envelopeGain(points,origin+x*visible()/width-track.offset)) : null;
    const showEnvelope=(mode==='envelope' || (mode==='multi' && track.id===active)) || points.length;
    const {values}=envelope(track,Math.ceil(width));
    values.forEach((bins,i)=>{
      const middle=laneHeight*(i+.5), scale=laneHeight*.45;
      ctx.strokeStyle=waveformColors.center;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,middle+.5);ctx.lineTo(width,middle+.5);ctx.stroke();
      const upper=track.mute?waveformColors.muted:track.id===active?waveformColors.upper:waveformColors.quietUpper;
      const lower=track.mute?waveformColors.muted:track.id===active?waveformColors.lower:waveformColors.quietLower;
      for (const [x,lo,hi] of bins) {
        const gain=gains?.[x]??1;
        const above=clamp(hi*gain,0,1)*scale, below=clamp(-lo*gain,0,1)*scale;
        ctx.fillStyle=upper;ctx.fillRect(x,middle-above,1,Math.max(above,.65));
        ctx.fillStyle=lower;ctx.fillRect(x,middle,1,Math.max(below,.65));
      }
      if (!showEnvelope) return;
      for (const side of [-1,1]) {
        const y=gain=>middle+side*envelopeRadius(gain)*laneHeight;
        const clipStart=clamp(origin-track.offset,0,length(track));
        const clipEnd=clamp(origin+visible()-track.offset,0,length(track));
        if (clipEnd<=clipStart) continue;
        const shown=points.filter(p=>p.t>=clipStart&&p.t<=clipEnd);
        ctx.strokeStyle=waveformColors.line;ctx.lineWidth=1.25;ctx.beginPath();
        let prior={t:clipStart,gain:envelopeGain(points,clipStart)};
        ctx.moveTo(X(track.offset+prior.t),y(prior.gain));
        for (const point of [...shown,{t:clipEnd,gain:envelopeGain(points,clipEnd)}]) {
          if ((prior.gain-1)*(point.gain-1)<0) {
            const unityTime=prior.t+(point.t-prior.t)*(1-prior.gain)/(point.gain-prior.gain);
            ctx.lineTo(X(track.offset+unityTime),y(1));
          }
          ctx.lineTo(X(track.offset+point.t),y(point.gain));
          prior=point;
        }
        ctx.stroke();
        ctx.fillStyle=waveformColors.point;
        for(const point of shown) {
          ctx.beginPath();ctx.arc(X(track.offset+point.t),y(point.gain),3.5,0,Math.PI*2);ctx.fill();
        }
      }
    });
    if (track.id===active && a!==b) {
      ctx.fillStyle=waveformColors.selection;ctx.fillRect(X(a),0,X(b)-X(a),height);
      ctx.fillStyle=waveformColors.edge;ctx.fillRect(X(a),0,1,height);ctx.fillRect(X(b),0,1,height);
    }
    ctx.fillStyle=waveformColors.cursor;ctx.fillRect(X(at),0,1,height);
  }
}
function historyButtons() {
  document.querySelectorAll('[data-action="undo"]').forEach(b=>{b.disabled=!undo.length;});
  document.querySelectorAll('[data-action="redo"]').forEach(b=>{b.disabled=!redo.length;});
}
function render() {
  $('empty').hidden=!!tracks.length;
  $('duration').textContent=time(duration());
  $('count').textContent=String(tracks.length).padStart(2,'0');
  $('export').disabled=exporting||!tracks.length;
  $('tracks').replaceChildren();
  for (const track of tracks) {
    const row=document.createElement('section');
    row.className='track'+(track.id===active?' selected':'');
    row.innerHTML='<div class="track-controls"><div class="track-name"><button class="close-track" type="button" title="Close track">×</button><strong></strong><button title="Rename track" aria-label="Rename track">···</button></div><div class="track-buttons"><button>Mute</button><button>Solo</button></div></div><canvas class="clip" tabindex="0"></canvas>';
    const title=row.querySelector('strong');
    title.textContent=track.name;title.title=track.name;
    title.onclick=()=>{active=track.id;render();};
    const [close,rename,mute,solo]=row.querySelectorAll('button');
    close.setAttribute('aria-label', `Close track ${track.name}`);
    close.onclick=()=>removeTrack(track);
    rename.onclick=()=>{active=track.id; action('rename');};
    for (const [key,button] of [['mute',mute],['solo',solo]]) {
      button.classList.toggle('on',track[key]);button.setAttribute('aria-pressed',track[key]);
      button.onclick=()=>{checkpoint();update(track,{[key]:!track[key]});render();};
    }
    for (const [key,label,min,max] of [['gain','Gain',-36,18],['pan','Pan',-100,100]]) {
      const wrap=document.createElement('label');
      wrap.className='range';wrap.textContent=label;
      const input=document.createElement('input');
      input.type='range';input.min=min;input.max=max;input.value=track[key];input.title=label;
      const output=document.createElement('output');
      output.textContent=track[key];
      input.oninput=()=>{output.textContent=input.value;};
      input.onchange=()=>{checkpoint();update(track,{[key]:+input.value});};
      wrap.append(input,output);row.querySelector('.track-controls').append(wrap);
    }
    const canvas=row.querySelector('canvas');
    canvas.setAttribute('aria-label',`Waveform for ${track.name}`);
    let anchor, gesture, sourceChannels, lastPoint, controlIndex, handle;
    const position=e=>origin+(e.clientX-canvas.getBoundingClientRect().left)/canvas.clientWidth*visible();
    function drawAt(e) {
      const frame=clamp(Math.round((position(e)-track.offset)*rate),0,track.channels[0].length-1);
      const relative=clamp((e.clientY-canvas.getBoundingClientRect().top)/canvas.clientHeight,0,.99999)*sourceChannels.length;
      const lane=Math.floor(relative), sample=clamp((.5-(relative-lane))/.45,-1,1);
      if (lastPoint?.lane===lane) {
        const delta=frame-lastPoint.frame;
        for(let k=0;k<Math.abs(delta);k++){
          sourceChannels[lane][lastPoint.frame+k*Math.sign(delta)]=lastPoint.sample+(sample-lastPoint.sample)*k/Math.abs(delta);
        }
      }
      sourceChannels[lane][frame]=sample;
      lastPoint={lane,frame,sample};
      waveformCache.delete(sourceChannels);
      paint();
    }
    function clickLane(e) {
      const relative=clamp((e.clientY-canvas.getBoundingClientRect().top)/canvas.clientHeight,0,.999999)*track.channels.length;
      const lane=Math.floor(relative);
      return {lane, side:relative-lane<.5?-1:1};
    }
    function shape(e) {
      const relative=(e.clientY-canvas.getBoundingClientRect().top)/canvas.clientHeight*track.channels.length;
      const gain=envelopeFromRadius((relative-handle.lane-.5)*handle.side);
      const t=clamp(position(e)-track.offset,0,length(track));
      const points=(track.envelope??[]).filter((point,index)=>index!==controlIndex && Math.abs(point.t-t)>1/rate/2);
      update(track,{envelope:[...points,{t,gain}].sort((a,b)=>a.t-b.t)});
      paint();
    }
    canvas.onpointerdown=e=>{
      if (e.button!==0) return;
      stop(); canvas.setPointerCapture(e.pointerId);
      active=track.id;
      for (const r of $('tracks').children) r.classList.toggle('selected',r===row);
      gesture=mode==='multi'?(e.altKey?'move':e.shiftKey?'envelope':'select'):mode;
      anchor=e.shiftKey&&gesture==='select'?selection[0]:position(e);
      if (['draw','move','envelope'].includes(gesture)) checkpoint();
      if (gesture==='envelope') {
        handle=clickLane(e);
        const hit=7*visible()/canvas.clientWidth;
        let nearest=hit;
        controlIndex=-1;
        (track.envelope??[]).forEach((point,index)=>{
          const delta=Math.abs(track.offset+point.t-anchor);
          if(delta<nearest){nearest=delta;controlIndex=index;}
        });
        if(e.ctrlKey || e.metaKey) {
          update(track,{envelope:(track.envelope??[]).filter((_,i)=>i!==controlIndex)});
          gesture='envelope-remove';paint();
        } else shape(e);
      }
      if (gesture==='draw') {
        sourceChannels=track.channels.map(c=>c.slice());update(track,{channels:sourceChannels});drawAt(e);
      }
      if (['select','zoom'].includes(gesture)) setRange(anchor,position(e));
    };
    canvas.onpointermove=e=>{
      if (anchor===undefined) return;
      if (gesture==='move') {
        update(track,{offset:Math.max(0,track.offset+position(e)-anchor)});paint();
      } else if (gesture==='draw') drawAt(e);
      else if (gesture==='envelope') shape(e);
      else if (['select','zoom'].includes(gesture)) setRange(anchor,position(e));
    };
    canvas.onlostpointercapture=()=>{
      if (gesture==='zoom') action(hasRange()?'zoomSelection':'in');
      if (['move','draw','envelope','envelope-remove'].includes(gesture)) render();
      anchor=gesture=sourceChannels=lastPoint=undefined;
    };
    canvas.ondblclick=()=>{if (mode==='select'||mode==='multi') setRange(track.offset,track.offset+length(track));};
    canvas.onkeydown=e=>{
      active=track.id;
      if (e.key==='ArrowLeft'||e.key==='ArrowRight') {
        e.preventDefault();
        const next=(e.shiftKey?selection[1]:cursor)+(e.key==='ArrowLeft'?-.1:.1);
        setRange(e.shiftKey?selection[0]:next,next);
      }
    };
    $('tracks').append(row);
  }
  historyButtons();
  paint();
}
function removeTrack(track) {
  checkpoint();
  const index=tracks.findIndex(item=>item.id===track.id);
  tracks=tracks.filter(item=>item.id!==track.id);
  if (active===track.id) {
    active=(tracks[index] ?? tracks[index-1])?.id ?? null;
    cursor=0;
    selection=[0,0];
  } else {
    cursor=Math.min(cursor,duration());
    selection=selection.map(t=>Math.min(t,duration()));
  }
  clampOrigin();
  render();
  status('Track closed. Use Undo to restore it.');
}
async function action(key) {
  if (key.startsWith('mode-')) {
    mode=key.slice(5);
    $('modes').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.action===key)));
    document.querySelector('.workspace').dataset.mode=mode;
    paint();
    return;
  }
  if (effects[key]) return apply(key);
  if (['cut','copy','paste','remove','trim','silence','duplicate','split'].includes(key)) return edit(key);
  const track=selected();
  switch (key) {
    case 'import': $('file').click();break;
    case 'openProject': $('projectFile').click();break;
    case 'saveProject': return saveProject();
    case 'demo': demo();break;
    case 'export': return exportAudio();
    case 'play': return play();
    case 'pause': if(playing) return play(); break;
    case 'end': stop();setRange(duration(),duration());break;
    case 'monitor': return monitor();
    case 'tone': case 'noise': case 'generateSilence': return generate(key);
    case 'analyze': return analysis();
    case 'help': return details('Toolbar and keyboard shortcuts','Space plays or pauses. Drag to select audio. Shift extends selection. Use the time shift tool to reposition a track. Click or drag either the top or bottom envelope to add or move gain points. Ctrl-click or ⌘-click removes a point. The draw tool edits samples. Zoom in before drawing. Ctrl or ⌘ with X, C, V, Z or A cuts, copies, pastes, undoes or selects the track.');
    case 'zoomSelection': {
      if (!hasRange()) return status('Select a range to fit');
      const [a,b]=bounds();
      zoom=clamp(Math.max(1,duration()*1.06)/(b-a),1,8192);
      origin=a;clampOrigin();paint();break;
    }
    case 'zoomToggle': {
      const prior=previousZoom??[Math.min(4,Math.max(1,zoom*2)),origin];
      previousZoom=[zoom,origin];[zoom,origin]=prior;clampOrigin();paint();break;
    }
    case 'start': stop();setRange(0,0);break;
    case 'stop': if (recording?.recorder) return record(); stop();cursor=bounds()[0];paint();break;
    case 'record': return record();
    case 'undo': restore(undo,redo);status('Undo');break;
    case 'redo': restore(redo,undo);status('Redo');break;
    case 'all': if(track) setRange(track.offset,track.offset+length(track));break;
    case 'none': setRange(cursor,cursor);break;
    case 'in': case 'out': case 'fit':
      zoom=key==='fit'?1:clamp(zoom*(key==='in'?1.75:1/1.75),1,8192);
      origin=zoom===1?0:cursor-visible()*.32;
      clampOrigin();paint();break;
    case 'deleteTrack':
      if (track) removeTrack(track);
      break;
    case 'rename': {
      if (!track) return;
      const result=await ask('Rename track',[['name','Track name',track.name]],'Rename');
      if (!result?.name.trim()) return;
      checkpoint();update(track,{name:result.name.trim()});render();break;
    }
  }
}
function run(key) { Promise.resolve(action(key)).catch(()=>status('The action could not be completed.')); }
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');
  const menu=e.target.closest('details');
  document.querySelectorAll('nav details[open]').forEach(d=>{if(d!==menu||button)d.open=false;});
  if(button) run(button.dataset.action);
});
projectInput.addEventListener('blur',()=>{
  const name = projectInput.value.trim();
  if (name && name !== projectName) {
    checkpoint();
    setProjectName(name);
  } else {
    projectInput.value = projectName;
  }
});
projectInput.addEventListener('keydown',e=>{
  if (e.key !== 'Enter' && e.key !== 'Escape') return;
  if (e.isComposing) return;
  e.preventDefault();
  if (e.key === 'Escape') projectInput.value = projectName;
  projectInput.blur();
});
$('export').onclick=()=>run('export');
$('projectFile').onchange=()=>{const file=$('projectFile').files[0];$('projectFile').value='';if(file)openProject(file);};
$('file').onchange=()=>{const files=[...$('file').files];$('file').value='';importFiles(files);};
$('ruler').onpointerdown=e=>{
  const fraction=(e.clientX-$('ruler').getBoundingClientRect().left)/$('ruler').clientWidth;
  stop();const t=origin+fraction*visible();setRange(t,t);
};
for (const id of ['from','to']) $(id).onchange=()=>{stop();setRange(+$('from').value,+$('to').value);};
document.querySelector('.workspace').addEventListener('wheel',e=>{
  if (zoom===1 || (!e.shiftKey && Math.abs(e.deltaX)<Math.abs(e.deltaY))) return;
  e.preventDefault();
  origin+=(e.deltaX||e.deltaY)*visible()/$('ruler').clientWidth;
  clampOrigin();paint();
},{passive:false});
for (const type of ['dragover','drop']) document.addEventListener(type,e=>{
  if (!e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();document.body.classList.toggle('dragging',type==='dragover');
  if (type==='drop') {
    const files=[...e.dataTransfer.files];
    if(files.length===1 && /\.(waveproject|aup3)$/i.test(files[0].name)) openProject(files[0]);
    else importFiles(files);
  }
});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});
document.addEventListener('keydown',e=>{
  if ($('dialog').open || recordingDialog.open || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const key=e.key.toLowerCase();
  const command=(e.ctrlKey||e.metaKey)?({z:e.shiftKey?'redo':'undo',y:'redo',a:'all',x:'cut',c:'copy',v:'paste',o:'import'})[key]:
    ({' ':'play',delete:'remove',backspace:'remove',escape:'none'})[key];
  if (!command || (key===' ' && /BUTTON|SUMMARY|A/.test(e.target.tagName))) return;
  e.preventDefault();run(command);
});
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = $('theme');
  const next = theme === 'light' ? 'dark' : 'light';
  button.textContent = next === 'dark' ? '☾' : '☀';
  button.title = `Switch to ${next} mode`;
  button.setAttribute('aria-label',button.title);
  waveformColors = Object.fromEntries(Object.keys(waveformColors).map(name =>
    [name,getComputedStyle(document.documentElement).getPropertyValue(`--wave-${name}`).trim()]));
}
let waveformColors = {grid:'', tick:'', label:'', backdrop:'', active:'', clip:'', center:'', muted:'', upper:'', lower:'', quietUpper:'', quietLower:'', line:'', point:'', selection:'', edge:'', cursor:''};
let theme = 'dark';
try { if (localStorage.getItem('waveform-theme') === 'light') theme = 'light'; } catch {}
setTheme(theme);
$('theme').onclick=()=>{
  theme = theme === 'light' ? 'dark' : 'light';
  setTheme(theme);
  try { localStorage.setItem('waveform-theme',theme); } catch {}
  paint();
};
new ResizeObserver(paint).observe($('ruler'));
render();

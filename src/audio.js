// Piano output. The original sent MIDI (velocity 110) to the GarageBand grand piano.
// Here: the Salamander Grand Piano (Alexander Holm, CC-BY 3.0) in stimuli/salamander/,
// played with Tone.Sampler on jsPsych's own AudioContext, so the buffers the preload
// trial already decoded are reused rather than downloaded twice.

export const SAMPLE_NOTES = ['A0'];
for (let o = 1; o <= 7; o++) for (const n of ['C', 'D#', 'F#', 'A']) SAMPLE_NOTES.push(n + o);
SAMPLE_NOTES.push('C8');

export const sampleUrl = (note) => `stimuli/salamander/${note.replace('#', 's')}.mp3`;
export const SAMPLE_URLS = SAMPLE_NOTES.map(sampleUrl);

export class Piano {
  constructor() {
    this.ready = false;
  }

  /**
   * @param {AudioContext} context  jsPsych.pluginAPI.audioContext()
   * @param {(url: string) => Promise<AudioBuffer|null>} getBuffer  decoded buffer from the preload cache, or null
   */
  async load(context, getBuffer) {
    if (context) Tone.setContext(new Tone.Context(context));
    const urls = {};
    for (const note of SAMPLE_NOTES) {
      const url = sampleUrl(note);
      const buf = getBuffer ? await getBuffer(url) : null;
      urls[note] = buf || url; // falls back to Tone fetching the file itself
    }
    await new Promise((resolve, reject) => {
      this.sampler = new Tone.Sampler({ urls, release: 0.15, onload: resolve, onerror: reject }).toDestination();
      // Already-decoded buffers do not always fire onload; resolve once they report loaded.
      if (this.sampler.loaded) resolve();
    });
    this.ready = true;
  }

  async unlock() {
    await Tone.start();
  }

  now() {
    return Tone.getContext().currentTime;
  }

  play(evt) {
    if (!this.ready) return;
    // MIDI note numbers are 7-bit; the generator can exceed 127 only in octave 9.
    const midi = Math.max(0, Math.min(127, evt.note));
    const dur = Math.max(0.01, evt.durationMs / 1000);
    this.sampler.triggerAttackRelease(Tone.Frequency(midi, 'midi').toNote(), dur, evt.time, evt.velocity / 127);
  }

  // used by the sound check; returns the playback duration in seconds
  playNotes(midis, spacing = 0.45) {
    const t0 = this.now() + 0.1;
    midis.forEach((m, i) => this.sampler.triggerAttackRelease(Tone.Frequency(m, 'midi').toNote(), 0.35, t0 + i * spacing, 110 / 127));
    return (midis.length - 1) * spacing + 0.6;
  }
}

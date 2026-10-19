// Port of the timing graph in bouncing_ball.maxpat (Max/MSP).
//
// Original signal flow, per metro tick:
//   period    = 60000 / bpm                                  [expr 60000./$f1]
//   delayms   = random(0 .. int(jitter/100 * period) - 1)    [* 0.01] [* 1.] [random]
//   bouncelen = int(period) - delayms                        [expr $i2-$i1]
//   after delayms: noodler bang -> note
// Per note:
//   bounce height input = |note - previous note| (0 -> 1)    [p delta] [sel 0] [t 1]
//   height px           = int(scale(delta, 1,7 -> 20,100))   [scale 1. 7. 20. 100.] [pack f i]
//   spikiness           = scale(huron, -1.428,0.8 -> 0.2,0)  [scale -1.428 0.8 0.2 0.]
//   rotation (deg)      = 60 - note                          [scale 0 120 60. -60.]
//   MIDI note: velocity 110, duration bouncelen - 10 ms      [makenote 110 300] [- 10]
//   16th note -> reset: metro off, previous note := 60, noodler.reset()   [counter 15] [sel 1]
//
// Scheduling uses a short lookahead so audio onsets are sample-accurate.

import { Noodler } from './noodler.js';

const NOTES_PER_SEQUENCE = 16;
const LOOKAHEAD_S = 0.10;
const TIMER_MS = 20;

export function maxScale(x, inLo, inHi, outLo, outHi) {
  // Max [scale] with default (linear, unclamped) behaviour
  return outLo + (x - inLo) * (outHi - outLo) / (inHi - inLo);
}

export class Engine {
  /**
   * @param {object} opts
   * @param {() => number} opts.now      clock in seconds
   * @param {(evt) => void} opts.onNote  called at schedule time with the note event (evt.time is in the future)
   * @param {(evt) => void} opts.onNoteFired  called when the note's time arrives (for logging / UI)
   * @param {(playing:boolean) => void} opts.onPlayingChange
   */
  constructor({ now, onNote, onNoteFired, onPlayingChange, rng = Math.random }) {
    this.now = now;
    this.onNote = onNote || (() => {});
    this.onNoteFired = onNoteFired || (() => {});
    this.onPlayingChange = onPlayingChange || (() => {});
    this.rng = rng;
    this.noodler = new Noodler(rng);
    this.params = { bpm: 200, jitter: 0, scale: 37, interval: 50, updown: 50 };
    this.playing = false;
    this.deltaPrev = 60;       // [t 0 60] -> right inlet of [p delta]
    this.noteCount = 0;        // [counter 15]
    this.nextTick = 0;
    this.pending = [];         // scheduled notes not yet fired
    this.sequenceIndex = 0;
    this._timer = null;
    this.applyParams();
  }

  setParam(name, value) {
    this.params[name] = value;
    this.applyParams();
  }

  setParams(p) {
    Object.assign(this.params, p);
    this.applyParams();
  }

  applyParams() {
    this.noodler.intCurve = this.params.interval * 0.01;
    this.noodler.upDownThresh = this.params.updown * 0.01;
    this.noodler.setPcSet(this.params.scale);
  }

  // Space bar. The [gate] only passes a start while no sequence is playing.
  start() {
    if (this.playing) return false;
    this.playing = true;
    this.sequenceIndex += 1;
    this.ticksScheduled = 0;
    this.noteCount = 0; // equivalent to the free-running [counter 15]: every sequence is exactly 16 notes
    this.onPlayingChange(true);
    this.nextTick = this.now() + 0.05; // metro fires on start; small offset so the first onset is schedulable
    this._loop();
    this._timer = setInterval(() => this._loop(), TIMER_MS);
    return true;
  }

  _loop() {
    const now = this.now();
    // fire due notes (UI/logging side; audio/visuals were scheduled ahead)
    while (this.pending.length && this.pending[0].time <= now) {
      const evt = this.pending.shift();
      this.onNoteFired(evt);
      if (evt.last) this._reset();
    }
    if (!this.playing) return;
    while (this.ticksScheduled < NOTES_PER_SEQUENCE && this.nextTick < now + LOOKAHEAD_S) {
      this._tick(this.nextTick);
    }
  }

  _tick(t) {
    const period = 60000 / this.params.bpm;
    const range = Math.trunc(this.params.jitter * 0.01 * period);
    const delayms = range > 0 ? Math.floor(this.rng() * range) : 0;
    const bouncelen = Math.trunc(period) - delayms;
    this.nextTick = t + period / 1000;
    this.ticksScheduled += 1;
    this._note(t + delayms / 1000, bouncelen, period, delayms);
  }

  _note(time, bouncelen, period, delayms) {
    const { note, huron, dist } = this.noodler.bang();
    let delta = Math.abs(note - this.deltaPrev);
    this.deltaPrev = note;
    if (delta === 0) delta = 1;
    const bounceHeight = Math.trunc(maxScale(delta, 1, 7, 20, 100));
    const spikes = maxScale(huron, -1.428, 0.8, 0.2, 0);
    const rotation = maxScale(note, 0, 120, 60, -60);
    this.noteCount += 1;
    const last = this.noteCount % NOTES_PER_SEQUENCE === 0;
    const evt = {
      time, note, huron, interval_semitones: dist, bounceLength: bouncelen * 0.001,
      bounceHeight, spikes, rotation, durationMs: bouncelen - 10, velocity: 110,
      period, delayms, last, seq: this.sequenceIndex,
      index: ((this.noteCount - 1) % NOTES_PER_SEQUENCE) + 1,
      params: { ...this.params },
    };
    this.pending.push(evt);
    this.onNote(evt);
    if (last) {
      // reset happens at the 16th note's onset (see _loop); the noodler and
      // delta memory are reset now because nothing else is scheduled before then.
      this.deltaPrev = 60;
      this.noodler.reset();
    }
  }

  _reset() {
    this.playing = false;
    clearInterval(this._timer);
    this._timer = null;
    this.onPlayingChange(false);
  }

  stop() {
    // used only when leaving the task screen
    clearInterval(this._timer);
    this._timer = null;
    this.pending = [];
    this.playing = false;
  }
}

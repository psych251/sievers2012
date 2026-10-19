// Line-for-line port of noodler.js from the original Bouncing Ball software
// (github.com/beausievers/bouncingball, Sievers 2014, BSD-3-Clause).
// Original ran inside a Max/MSP [js] object; here it is a class so the state
// lives in one instance. Comments marked ORIG are from the original file.

export const PC_SET_ARRAY = [
  [[0, 1, 2, 3, 4], -5.884],
  [[0, 1, 2, 3, 5], -3.216],
  [[0, 2, 3, 4, 6], -3.095],
  [[0, 1, 2, 3, 6], -3.087],
  [[0, 1, 2, 4, 6], -2.449],
  [[0, 1, 2, 3, 7], -2.441],
  [[0, 1, 2, 4, 5], -2.248],
  [[0, 2, 4, 6, 8], -1.69],
  [[0, 1, 2, 6, 8], -1.674],
  [[0, 1, 2, 6, 7], -1.666],
  [[0, 1, 2, 4, 8], -1.481],
  [[0, 1, 2, 5, 6], -1.473],
  [[0, 1, 3, 4, 6], -1.065],
  [[0, 1, 2, 4, 7], -0.419],
  [[0, 1, 3, 5, 6], -0.419],
  [[0, 2, 3, 6, 8], -0.298],
  [[0, 1, 3, 6, 7], -0.29],
  [[0, 1, 3, 4, 7], -0.0969999999999997],
  [[0, 1, 3, 5, 7], 0.219],
  [[0, 1, 2, 5, 7], 0.227],
  [[0, 2, 3, 4, 7], 0.42],
  [[0, 2, 4, 5, 8], 0.541],
  [[0, 1, 4, 5, 7], 0.549],
  [[0, 1, 2, 5, 8], 0.549],
  [[0, 1, 3, 6, 9], 1.086],
  [[0, 1, 4, 6, 8], 1.187],
  [[0, 1, 5, 6, 8], 1.195],
  [[0, 3, 4, 5, 8], 1.388],
  [[0, 1, 3, 4, 8], 1.388],
  [[0, 1, 4, 7, 8], 1.517],
  [[0, 2, 3, 5, 8], 1.603],
  [[0, 2, 3, 5, 7], 2.12],
  [[0, 2, 4, 6, 9], 2.241],
  [[0, 1, 3, 6, 8], 2.249],
  [[0, 1, 4, 5, 8], 2.356],
  [[0, 1, 4, 6, 9], 2.571],
  [[0, 1, 3, 5, 8], 3.088],
  [[0, 2, 4, 7, 9], 4.788],
];

// Huron (1994) interval-class consonance, indexed by semitone distance 0-11.
export const HURON_TABLE = [1.428, -1.428, -0.582, 0.594, 0.386, 1.240, -0.453, 1.240, 0.386, 0.594, -0.582, -1.428];

export class Noodler {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.pcSet = [0, 2, 4, 7, 9];
    this.curPos = 0;
    this.curOct = 5;
    this.previousNote = 60;
    this.noteOffset = 0;
    this.intCurve = 0.5;     // inlet 1: interval choice articulation point (slider / 100)
    this.upDownThresh = 0.5; // inlet 2: probability of a downward step (slider / 100)
    this.needsReset = 1;
    this.note = 60;
  }

  // inlet 3
  setPcSet(i) {
    this.pcSet = PC_SET_ARRAY[i][0];
  }

  // ORIG: reset() needs to be called at the end of a trial, while resetVars()
  // needs to be called at the beginning.
  reset() {
    this.needsReset = 1;
  }

  resetVars() {
    this.curPos = 0;
    this.curOct = 5;
    this.noteOffset = Math.floor(12 * this.rng());
    const octBias = 12 * this.curOct;
    this.note = octBias + this.pcSet[this.curPos] + this.noteOffset;
    this.previousNote = this.note;
  }

  intervalCurve(x) {
    const a = this.intCurve;
    if (x <= a) {
      return ((1.0 - a) / (0.0 - a)) * x + 1;
    } else {
      return ((0.0 - a) / (1.0 - a)) * (x - 1.0);
    }
  }

  selectNextNote() {
    let interval = 0;
    const intChoice = this.intervalCurve(this.rng());
    if (intChoice <= 0.25) interval = 1;
    else if (intChoice > 0.25 && intChoice <= 0.50) interval = 2;
    else if (intChoice > 0.50 && intChoice <= 0.75) interval = 3;
    else if (intChoice > 0.75 && intChoice <= 1.0) interval = 4;

    const upDown = this.rng();
    if (upDown <= this.upDownThresh) interval = interval * -1;

    if ((interval + this.curPos) > 4) this.curOct += 1;
    else if ((interval + this.curPos) < 0) this.curOct -= 1;

    // ORIG: Loop at the extreme high and low edges
    if (this.curOct == 0) this.curOct = 1;
    else if (this.curOct == 10) this.curOct = 9;

    if ((this.curPos + interval) < 0) this.curPos = 5 + (this.curPos + interval);
    else this.curPos = (this.curPos + interval) % 5;

    const octBias = 12 * this.curOct;
    this.note = octBias + this.pcSet[this.curPos] + this.noteOffset;
    this.lastInterval = interval;
  }

  // ORIG playNote(): outlet 2 = Huron value of the melodic interval, outlet 0 = note.
  // Note: the original indexes huronTable with |note - previousNote| directly.
  // That distance never exceeds 11 except right after the octave clamp above;
  // there the original would send `undefined`. We wrap with % 12 instead.
  playNote() {
    const dist = Math.abs(this.note - this.previousNote);
    const huron = HURON_TABLE[dist % 12];
    this.previousNote = this.note;
    return { note: this.note, huron, dist };
  }

  // ORIG bang()
  bang() {
    if (this.needsReset == 1) {
      this.needsReset = 0;
      this.resetVars();
    }
    this.selectNextNote();
    return this.playNote();
  }
}

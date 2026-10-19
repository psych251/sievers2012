// jsPsych 8 plugin for the main task screen: practice (undirected play) -> "Start" ->
// express five emotions with save/load -> "Finish".
//
// Trial data (task "slider_task") stays small: the saved setting per emotion and summary
// counts. The process logs (10 Hz slider samples, interface events, every generated note)
// are handed to `on_logs` and written by experiment.js as separate "slider_log" rows, so no
// single Firestore document approaches the 1 MiB limit.
//
// Content (slider order, labels, ranges, emotion word lists and order) is the
// original US experiment's (SI Fig. S3A/B). The visual design is web-native and
// is laid out on a fixed design canvas that is scaled to the window, so every
// participant sees the same proportions.

import { Engine } from './engine.js';

export const EMOTIONS = [
  { key: 'happy', words: ['happy', 'merry', 'joyful', 'cheery', 'gleeful'] },
  { key: 'sad', words: ['sad', 'glum', 'melancholy', 'gloomy', 'sorrowful'] },
  { key: 'angry', words: ['angry', 'mad', 'furious', 'cross', 'enraged'] },
  { key: 'scared', words: ['scared', 'afraid', 'nervous', 'fearful', 'frightened'] },
  { key: 'peaceful', words: ['peaceful', 'content', 'calm', 'serene', 'tranquil'] },
];

// Fig. S3B slider labels (shown in lower case in Fig. S3A)
export const LABELS = {
  music: ['beats per minute', 'jitter', 'consonance', 'big/small interval probability', 'up/down probability'],
  movement: ['bounces per minute', 'jitter', 'smoothness', 'big/small bounce probability', 'lean back/front probability'],
};

// Slider order top to bottom, with the Max slider ranges (min, number of steps)
export const SLIDERS = [
  { key: 'bpm', min: 30, size: 371 },     // 30-400
  { key: 'jitter', min: 0, size: 100 },   // 0-99
  { key: 'scale', min: 0, size: 38 },     // 0-37 (index into 38 pc-sets, most dissonant first)
  { key: 'interval', min: 0, size: 101 }, // 0-100
  { key: 'updown', min: 0, size: 101 },   // 0-100 (probability of a downward step)
];

// [p playback] "randomize": random 370 + 30, random 99, random 37, random 100, random 100
export function randomSliders(rng = Math.random) {
  const r = (n) => Math.floor(rng() * n);
  return { bpm: r(370) + 30, jitter: r(99), scale: r(37), interval: r(100), updown: r(100) };
}

// design canvas (CSS px before scaling)
const CTRL_W = 820, BALL_W = 420, BALL_H = 504, GAP = 40;
const DESIGN_W = BALL_W + GAP + CTRL_W, DESIGN_H = 660;
const THUMB_R = 9; // thumb radius: the thumb centre travels between the track ends

const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.25" fill="currentColor"/><path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_EMPTY = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.6 2.2"/></svg>';

class WebSlider {
  constructor(parent, spec, label, onChange) {
    this.spec = spec;
    this.onChange = onChange;
    const row = document.createElement('div');
    row.className = 'ws-row';
    const id = `ws-${spec.key}`;
    row.innerHTML = `<label class="ws-label" id="${id}-label">${label}</label>
      <div class="ws" id="${id}" role="slider" tabindex="0" aria-labelledby="${id}-label"
           aria-valuemin="${spec.min}" aria-valuemax="${spec.min + spec.size - 1}">
        <div class="ws-track"><div class="ws-fill"></div></div><div class="ws-thumb"></div>
      </div>`;
    parent.appendChild(row);
    this.el = row.querySelector('.ws');
    this.fill = row.querySelector('.ws-fill');
    this.thumb = row.querySelector('.ws-thumb');
    this.value = spec.min;
    this._bind();
  }

  _valueFromEvent(e) {
    const rect = this.el.getBoundingClientRect();
    const s = rect.width / this.el.offsetWidth; // canvas scale
    const frac = (e.clientX - rect.left - THUMB_R * s) / (rect.width - 2 * THUMB_R * s);
    return Math.round(Math.max(0, Math.min(1, frac)) * (this.spec.size - 1)) + this.spec.min;
  }

  _bind() {
    // Absolute positioning like the original Max slider: clicking moves the thumb to the pointer.
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.el.focus({ preventScroll: true });
      this.el.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.el.classList.add('dragging');
      this._set(this._valueFromEvent(e), true);
    });
    this.el.addEventListener('pointermove', (e) => { if (this.dragging) this._set(this._valueFromEvent(e), true); });
    const end = (e) => {
      this.dragging = false;
      this.el.classList.remove('dragging');
      try { this.el.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      const max = this.spec.min + this.spec.size - 1;
      let v = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = this.value + step;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = this.value - step;
      else if (e.key === 'Home') v = this.spec.min;
      else if (e.key === 'End') v = max;
      if (v === null) return;
      e.preventDefault();
      this._set(Math.max(this.spec.min, Math.min(max, v)), true);
    });
  }

  _set(v, fromUser) {
    if (v === this.value && fromUser) return;
    this.value = v;
    const frac = (v - this.spec.min) / (this.spec.size - 1);
    const pos = `calc(${THUMB_R}px + ${frac} * (100% - ${2 * THUMB_R}px))`;
    this.thumb.style.left = pos;
    this.fill.style.width = pos;
    this.el.setAttribute('aria-valuenow', v);
    this.onChange(this.spec.key, v, fromUser);
  }

  set(v) { this._set(v, false); }
}

export function makeTaskPlugin(jsPsychModule) {
  const { ParameterType } = jsPsychModule;
  const info = {
    name: 'sievers-task',
    version: '2.0.0',
    parameters: {
      condition: { type: ParameterType.STRING, default: 'music' },
      piano: { type: ParameterType.OBJECT, default: null },          // Piano instance (music condition)
      ballFactory: { type: ParameterType.FUNCTION, default: null },  // (container) => BallView (movement condition)
      experiment_instructions: { type: ParameterType.HTML_STRING, default: '' },
      on_logs: { type: ParameterType.FUNCTION, default: () => {} },  // receives the process logs at the end
      practice_hint: { type: ParameterType.HTML_STRING, default: '' },
    },
    data: {},
  };

  class SieversTaskPlugin {
    static info = info;
    constructor(jsPsych) { this.jsPsych = jsPsych; }

    trial(display_element, trial) {
      const cond = trial.condition;
      const verb = cond === 'music' ? 'hear' : 'see';
      const t0 = performance.now();
      const tms = () => Math.round(performance.now() - t0);
      let phase = 'practice';
      let focus = null;              // emotion currently being worked on
      let playedSinceFocus = false;  // a sequence was started while `focus` was selected

      // trial data (one row)
      const data = {
        slider_labels: LABELS[cond],
        initial_sliders: null,
        practice_start_ms: 0,
        experiment_start_ms: null,
        finish_ms: null,
        saved: {},           // last save per emotion -> {bpm, jitter, scale, interval, updown, t_ms}
      };
      // process logs (written as separate rows); every row is an array, columns listed here
      const logs = {
        slider_samples: { columns: ['t_ms', 'phase', 'focus_emotion', 'bpm', 'jitter', 'scale', 'interval', 'updown'], rows: [] },
        ui_events: { columns: ['t_ms', 'phase', 'event', 'detail'], rows: [] },
        notes: { columns: ['seq', 'index', 'onset_ms', 'phase', 'focus_emotion', 'note', 'huron', 'delay_ms', 'bounce_len_ms', 'bounce_height', 'spikes', 'rotation', 'bpm', 'jitter', 'scale', 'interval', 'updown'], rows: [] },
        saves: { columns: ['t_ms', 'emotion', 'bpm', 'jitter', 'scale', 'interval', 'updown'], rows: [] },
      };
      const log = (event, detail = null) => logs.ui_events.rows.push([tms(), phase, event, detail]);

      // ---------- layout ----------
      display_element.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'task-root';
      root.innerHTML = `
        <div class="task-stage" style="width:${DESIGN_W}px;height:${DESIGN_H}px">
          ${cond === 'movement' ? `<div class="out-panel" style="width:${BALL_W}px;height:${BALL_H}px"></div>` : ''}
          <div class="ctrl" style="width:${CTRL_W}px">
            <div class="play-row">
              <button type="button" class="btn btn-play">${ICON_PLAY}<span>Play</span></button>
            </div>
            <div class="sliders"></div>
            <div class="lower">
              <div class="practice-view">
                <p class="practice-hint">${trial.practice_hint}</p>
                <button type="button" class="btn btn-primary btn-start">Start</button>
              </div>
              <div class="emotion-view" hidden>
                <div class="emo-grid"></div>
                <div class="emo-footer">
                  <p class="emo-help" aria-live="polite"></p>
                  <div class="finish-wrap"><span class="emo-count"></span><button type="button" class="btn btn-primary btn-finish" disabled>Finish</button></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="task-modal" hidden></div>`;
      display_element.appendChild(root);
      const $ = (sel) => root.querySelector(sel);
      const stage = $('.task-stage');

      const fit = () => {
        const s = Math.min(window.innerWidth / (DESIGN_W + 48), window.innerHeight / (DESIGN_H + 32));
        stage.style.transform = `translate(-50%, -50%) scale(${s})`;
      };
      fit();
      window.addEventListener('resize', fit);

      // ---------- sliders ----------
      const sliders = {};
      const engineRef = { engine: null };
      SLIDERS.forEach((spec, i) => {
        sliders[spec.key] = new WebSlider($('.sliders'), spec, LABELS[cond][i], (key, v) => {
          if (engineRef.engine) engineRef.engine.setParam(key, v);
          if (phase === 'experiment') render();
        });
      });
      const current = () => Object.fromEntries(SLIDERS.map((s) => [s.key, sliders[s.key].value]));
      const same = (a, b) => SLIDERS.every((s) => a[s.key] === b[s.key]);

      // ---------- emotion cards ----------
      const cards = {};
      EMOTIONS.forEach((emo) => {
        const card = document.createElement('div');
        card.className = 'emo-card';
        card.dataset.emotion = emo.key;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-pressed', 'false');
        card.innerHTML = `
          <div class="emo-head"><span class="emo-title">${emo.words[0]}</span><span class="emo-icon"></span></div>
          <div class="emo-syn">${emo.words.slice(1).join('<br>')}</div>
          <div class="emo-state"></div>
          <div class="emo-actions">
            <button type="button" class="btn btn-small btn-save" data-emotion="${emo.key}">Save</button>
            <button type="button" class="btn btn-small btn-ghost btn-load" data-emotion="${emo.key}">Load</button>
          </div>`;
        $('.emo-grid').appendChild(card);
        cards[emo.key] = card;
      });

      const select = (emo) => {
        if (focus === emo) return;
        focus = emo;
        playedSinceFocus = false;
        log('select', emo);
        render();
      };

      const render = () => {
        const cur = current();
        let nSaved = 0;
        for (const emo of EMOTIONS) {
          const card = cards[emo.key];
          const saved = data.saved[emo.key];
          const isFocus = focus === emo.key;
          if (saved) nSaved++;
          card.classList.toggle('is-focus', isFocus);
          card.classList.toggle('is-saved', !!saved);
          card.setAttribute('aria-pressed', String(isFocus));
          card.querySelector('.emo-icon').innerHTML = saved ? ICON_CHECK : ICON_EMPTY;
          let state = saved ? 'Saved' : 'Not saved yet';
          if (saved && isFocus && !same(cur, saved)) state = 'Changed since saving';
          card.querySelector('.emo-state').textContent = state;
          const save = card.querySelector('.btn-save');
          save.disabled = !(isFocus && playedSinceFocus);
          save.title = !isFocus ? `Select ${emo.key} to work on it` : (!playedSinceFocus ? `Press play to ${verb} this setting first` : `Save this setting for ${emo.key}`);
          const load = card.querySelector('.btn-load');
          load.disabled = !saved;
          load.title = saved ? `Bring back the setting you saved for ${emo.key}` : 'Available after you save';
        }
        $('.emo-count').textContent = `${nSaved} of 5 saved`;
        $('.btn-finish').disabled = nSaved < EMOTIONS.length;

        let help;
        if (!focus) help = 'Choose an emotion to work on.';
        else {
          const saved = data.saved[focus];
          if (!playedSinceFocus) help = `Working on <b>${focus}</b>. Press play to ${verb} the current setting.`;
          else if (saved && same(cur, saved)) help = `Saved <b>${focus}</b>. Choose another emotion, or keep adjusting.`;
          else help = `Adjust the sliders until it expresses <b>${focus}</b>, then click save.`;
        }
        if (nSaved === EMOTIONS.length && (!focus || (data.saved[focus] && same(cur, data.saved[focus])))) {
          help = 'All five emotions are saved. You can keep adjusting any of them, or click finish.';
        }
        $('.emo-help').innerHTML = help;
      };

      // ---------- modal ----------
      const modal = $('.task-modal');
      const showModal = (html, buttons) => new Promise((resolve) => {
        modal.innerHTML = `<div class="task-modal-box" role="dialog" aria-modal="true">${html}<div class="task-modal-buttons"></div></div>`;
        const bar = modal.querySelector('.task-modal-buttons');
        buttons.forEach((b, i) => {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = i === buttons.length - 1 ? 'btn btn-primary' : 'btn btn-ghost';
          el.textContent = b;
          el.addEventListener('click', () => { modal.hidden = true; resolve(i); });
          bar.appendChild(el);
        });
        modal.hidden = false;
        bar.lastChild.focus();
      });

      // ---------- engine / outputs ----------
      let clock;
      let ball = null;
      if (cond === 'music') {
        clock = () => trial.piano.now();
      } else {
        clock = () => performance.now() / 1000;
        ball = trial.ballFactory($('.out-panel'));
        ball.setClock(clock);
        ball.start();
      }
      // onsets are logged on the output clock (audio clock for music), offset to the task start
      const clock0 = clock() - (performance.now() - t0) / 1000;
      const toTaskMs = (tClock) => Math.round((tClock - clock0) * 1000);

      const playBtn = $('.btn-play');
      const setPlaying = (playing) => {
        playBtn.disabled = playing;
        playBtn.classList.toggle('is-playing', playing);
        playBtn.querySelector('span').textContent = playing ? 'Playing…' : 'Play';
      };

      const engine = new Engine({
        now: clock,
        onNote: (evt) => {
          if (cond === 'music') trial.piano.play(evt);
          else ball.schedule(evt);
          const p = evt.params;
          logs.notes.rows.push([evt.seq, evt.index, toTaskMs(evt.time), phase, focus, evt.note, evt.huron, evt.delayms, evt.bounceLength * 1000 | 0,
            evt.bounceHeight, +evt.spikes.toFixed(5), evt.rotation, p.bpm, p.jitter, p.scale, p.interval, p.updown]);
        },
        onPlayingChange: setPlaying,
      });
      engineRef.engine = engine;

      // random initial positions (SI: "the slider bars were automatically set to random positions")
      const init = randomSliders();
      data.initial_sliders = { ...init };
      for (const s of SLIDERS) sliders[s.key].set(init[s.key]);

      // Slider trace at 10 Hz, as in the original software ([coll recording] sampled every
      // 100 ms); a sample is written only when some slider changed since the last one.
      let lastSample = null;
      const sample = () => {
        const v = current();
        const key = SLIDERS.map((s) => v[s.key]).join(',');
        if (key === lastSample) return;
        lastSample = key;
        logs.slider_samples.rows.push([tms(), phase, focus, v.bpm, v.jitter, v.scale, v.interval, v.updown]);
      };
      sample();
      const sampler = setInterval(sample, 100);

      // ---------- input ----------
      playBtn.addEventListener('click', () => {
        if (cond === 'music') Tone.start();
        const ok = engine.start();
        log(ok ? 'play' : 'play_ignored', ok ? engine.sequenceIndex : null);
        if (ok && focus) { playedSinceFocus = true; render(); }
      });

      $('.btn-start').addEventListener('click', async () => {
        log('start_clicked');
        await showModal(trial.experiment_instructions, ['Begin']);
        phase = 'experiment';
        data.experiment_start_ms = tms();
        log('experiment_start');
        $('.practice-view').hidden = true;
        $('.emotion-view').hidden = false;
        render();
      });

      $('.emo-grid').addEventListener('click', (e) => {
        const card = e.target.closest('.emo-card');
        if (!card) return;
        const emo = card.dataset.emotion;
        const btn = e.target.closest('button');
        if (btn && btn.disabled) return;
        if (btn && btn.classList.contains('btn-save')) {
          const v = current();
          const t = tms();
          data.saved[emo] = { ...v, t_ms: t };
          logs.saves.rows.push([t, emo, v.bpm, v.jitter, v.scale, v.interval, v.updown]);
          log('save', emo);
          card.classList.remove('just-saved'); void card.offsetWidth; card.classList.add('just-saved');
          render();
        } else if (btn && btn.classList.contains('btn-load')) {
          const s = data.saved[emo];
          if (!s) return;
          select(emo);
          log('load', emo);
          for (const sp of SLIDERS) sliders[sp.key].set(s[sp.key]);
          render();
        } else {
          select(emo);
        }
      });
      $('.emo-grid').addEventListener('keydown', (e) => {
        const card = e.target.closest('.emo-card');
        if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(card.dataset.emotion); }
      });

      $('.btn-finish').addEventListener('click', async () => {
        const missing = EMOTIONS.filter((x) => !data.saved[x.key]).map((x) => x.key);
        log('finish_clicked', missing.join(','));
        if (missing.length) return;
        const choice = await showModal('<p>You have saved a setting for all five emotions.</p><p>Are you finished? You will not be able to come back to this screen.</p>', ['Keep working', 'Finish']);
        if (choice !== 1) return;
        end();
      });

      const end = () => {
        data.finish_ms = tms();
        log('finish');
        window.removeEventListener('resize', fit);
        engine.stop();
        if (ball) ball.stop();
        clearInterval(sampler);
        sample();
        const ev = logs.ui_events.rows;
        const count = (ph, name) => ev.filter((x) => x[1] === ph && x[2] === name).length;
        data.n_sequences_practice = count('practice', 'play');
        data.n_sequences_experiment = count('experiment', 'play');
        data.n_saves = count('experiment', 'save');
        data.n_loads = count('experiment', 'load');
        data.n_selects = count('experiment', 'select');
        data.practice_duration_ms = data.experiment_start_ms;
        data.experiment_duration_ms = data.finish_ms - data.experiment_start_ms;
        trial.on_logs(logs);
        display_element.innerHTML = '';
        this.jsPsych.finishTrial(data);
      };

      // test hook
      window.__task = { engine, sliders, data, logs, setSlider: (k, v) => sliders[k]._set(v, true), end, state: () => ({ focus, playedSinceFocus }) };
    }
  }
  return SieversTaskPlugin;
}

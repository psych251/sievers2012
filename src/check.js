// Phase 2 manipulation check (jsPsych 8 plugin): play back one of the participant's own saved
// settings and ask which emotion they saved it for.
//
// The setting is played through the same engine as the main task, so the participant hears
// (or sees) a new 16-note melody or 16-bounce movement generated from the saved slider values,
// exactly as Play did on the task screen. The answer buttons unlock once one full sequence has
// played; the participant may replay it as often as they like.
//
// Trial data: target_emotion, choice, correct, n_plays, rt (ms from the trial start), the
// played setting, and the generated notes ([seq, index, note, delay_ms] per note).

import { Engine } from './engine.js';
import { EMOTIONS, SLIDERS } from './task.js';

// same design canvas as the task screen
const BALL_W = 420, BALL_H = 504, GAP = 40, CTRL_W = 520;
const TASK_W = 1280, TASK_H = 660; // the task screen's design canvas (src/task.js)
const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>';

export function makeCheckPlugin(jsPsychModule) {
  const { ParameterType } = jsPsychModule;
  const info = {
    name: 'sievers-playback-check',
    version: '1.0.0',
    parameters: {
      condition: { type: ParameterType.STRING, default: 'music' },
      piano: { type: ParameterType.OBJECT, default: null },          // Piano instance (music)
      ballFactory: { type: ParameterType.FUNCTION, default: null },  // (container) => BallView (movement)
      setting: { type: ParameterType.OBJECT, default: null },        // {bpm, jitter, scale, interval, updown}
      target: { type: ParameterType.STRING, default: null },         // the emotion it was saved for
      prompt: { type: ParameterType.HTML_STRING, default: '' },
    },
    data: {},
  };

  class PlaybackCheckPlugin {
    static info = info;
    constructor(jsPsych) { this.jsPsych = jsPsych; }

    trial(display_element, trial) {
      const cond = trial.condition;
      const t0 = performance.now();
      const setting = Object.fromEntries(SLIDERS.map((s) => [s.key, trial.setting[s.key]]));
      const designW = (cond === 'movement' ? BALL_W + GAP : 0) + CTRL_W;
      const designH = cond === 'movement' ? BALL_H : 360;

      display_element.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'task-root check-root';
      root.dataset.target = trial.target; // for the test robot
      root.innerHTML = `
        <div class="task-stage" style="width:${designW}px;height:${designH}px">
          ${cond === 'movement' ? `<div class="out-panel" style="width:${BALL_W}px;height:${BALL_H}px"></div>` : ''}
          <div class="ctrl check-ctrl" style="width:${CTRL_W}px">
            <div class="check-prompt">${trial.prompt}</div>
            <div class="play-row"><button type="button" class="btn btn-play">${ICON_PLAY}<span>Play</span></button></div>
            <div class="check-choices">
              ${EMOTIONS.map((e) => `<button type="button" class="btn btn-ghost btn-choice" data-emotion="${e.key}" disabled>${e.words[0]}</button>`).join('')}
            </div>
          </div>
        </div>`;
      display_element.appendChild(root);
      const $ = (sel) => root.querySelector(sel);
      const stage = $('.task-stage');
      const fit = () => {
        // movement: the task screen's scale factor (its 1280 x 660 canvas), so the ball is drawn
        // at the same size as during the task; music: fit, never enlarged
        const s = cond === 'movement'
          ? Math.min(window.innerWidth / (TASK_W + 48), window.innerHeight / (TASK_H + 32))
          : Math.min(1, window.innerWidth / (designW + 48), window.innerHeight / (designH + 32));
        stage.style.transform = `translate(-50%, -50%) scale(${s})`;
      };
      fit();
      window.addEventListener('resize', fit);

      let clock, ball = null;
      if (cond === 'music') {
        clock = () => trial.piano.now();
      } else {
        clock = () => performance.now() / 1000;
        ball = trial.ballFactory($('.out-panel'));
        ball.setClock(clock);
        ball.start();
      }

      const notes = [];
      let nPlays = 0;
      const playBtn = $('.btn-play');
      const choices = [...root.querySelectorAll('.btn-choice')];
      const engine = new Engine({
        now: clock,
        onNote: (evt) => {
          if (cond === 'music') trial.piano.play(evt);
          else ball.schedule(evt);
          notes.push([evt.seq, evt.index, evt.note, evt.delayms]);
        },
        onPlayingChange: (playing) => {
          playBtn.disabled = playing;
          playBtn.classList.toggle('is-playing', playing);
          playBtn.querySelector('span').textContent = playing ? 'Playing…' : 'Play';
          // unlock the answers once a whole sequence has played
          if (!playing && nPlays > 0) choices.forEach((b) => { b.disabled = false; });
        },
      });
      engine.setParams(setting);

      playBtn.addEventListener('click', () => {
        if (cond === 'music') Tone.start();
        if (engine.start()) nPlays += 1;
      });

      choices.forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        const choice = b.dataset.emotion;
        window.removeEventListener('resize', fit);
        engine.stop();
        if (ball) ball.stop();
        display_element.innerHTML = '';
        this.jsPsych.finishTrial({
          target_emotion: trial.target,
          choice,
          correct: choice === trial.target,
          n_plays: nPlays,
          rt: Math.round(performance.now() - t0),
          ...setting,
          notes_json: JSON.stringify(notes),
        });
      }));
    }
  }
  return PlaybackCheckPlugin;
}

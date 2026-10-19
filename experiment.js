/*
 * Replication of Sievers, Polansky, Casey & Wheatley (2013, PNAS), US experiment.
 *
 * Design summary
 *   IVs:          modality (music vs movement), between subjects; emotion (angry, happy,
 *                 peaceful, sad, scared) and slider (rate, jitter, consonance/smoothness,
 *                 step size, direction), within subjects.
 *   DV:           the last saved setting of the five sliders for each emotion: one row per
 *                 emotion with task "emotion_setting" and fields emotion, bpm, jitter, scale,
 *                 interval, updown (slider ranges 30-400, 0-99, 0-37, 0-100, 0-100).
 *   Structure:    one open-ended practice phase, then one open-ended production screen; no time
 *                 limits and no fixed trial count. Each click of Play generates a 16-note melody
 *                 (music) or 16-bounce animation (movement) from the current slider settings.
 *   Randomization: modality assigned 50/50 at random; sliders start at random positions;
 *                 participants choose the order of emotions.
 *   Exclusions:   not completed; music group only, failing the sound check (fewer than 2 of 3
 *                 note-count trials correct, after up to 3 rounds; `audio_check_passed`).
 *
 * Timeline
 *    1. consent              course-wide consent text
 *    2. preload              piano samples (music group only)
 *    3. browser check        window at least 1000 x 600; Web Audio; WebGL (movement group)
 *    4. welcome              jsPsych instructions
 *    5. demographics         survey plugin (SurveyJS)
 *    6. sound check          volume setting + note-count check (music group only)
 *    7. program instructions jsPsych instructions, modality-specific
 *    8. slider task          custom plugin (src/task.js): practice, then the five emotions
 *    9. emotion settings     5 rows, the dependent measure
 *   10. process logs         slider trace, interface events, generated notes (several rows)
 *   11. exploratory survey   music/dance training, listening device, strategy
 *   12. feedback             Likert + free text (template)
 *   13. debrief              saves data, then shows thanks or redirects to Prolific
 *
 * The melody generator, timing and ball are ports of the authors' released software
 * (github.com/beausievers/bouncingball); see src/noodler.js, src/engine.js, src/ball.js.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
window.TEMPLATE_VERSION = "0.1.0";

const EXPERIMENT = {
  // Firestore path: experiments/<id>/participants/... Change it for each phase so pilot data
  // and real data never mix (e.g. "sievers2012-pilot-b", "sievers2012-final").
  id: "sievers2012-pilot-a",

  // Trials per Firestore write. About 30 rows per participant, so 1 is fine.
  chunk_size: 1,

  // Also store the complete jsPsych dataset on the participant document at the end.
  // DataSaver skips this automatically if it would exceed Firestore's document limit.
  save_full_data_at_end: true,

  // Prolific: if set, participants are redirected to Prolific when they finish.
  prolific_completion_code: "",

  // Contact shown in consent and debrief.
  contact_email: "stanfordpsych251@gmail.com",

  // This study has no keyboard trials: everything is answered with buttons and sliders.
  requires_keyboard: false,
  // It does need a mouse or trackpad and a desktop-sized window (five sliders and a 3D
  // animation side by side), so phones and tablets are still turned away before consent.
  requires_mouse: true,

  // Smallest browser window the slider screen is usable in (checked after consent).
  min_width: 1000,
  min_height: 600,
};

// True on anything with a mouse, trackpad, or stylus, including laptops with touchscreens.
// False on phones and tablets without a pointing device. See docs/student-guide.md "Devices".
function hasFinePointer() {
  return !!(window.matchMedia && window.matchMedia("(any-pointer: fine)").matches);
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (e) {
    return false;
  }
}

// `?emulator=1` in the URL sends data to the local emulator instead of the real project.
const URL_PARAMS = new URLSearchParams(window.location.search);
const USE_EMULATOR = URL_PARAMS.get("emulator") === "1";
// `?chunk_size=N` overrides the setting above; used by the test suite to exercise chunked writes.
const CHUNK_SIZE = Number(URL_PARAMS.get("chunk_size")) || EXPERIMENT.chunk_size;
// Test-only: `?cc=CODE` sets a Prolific completion code during emulator runs.
if (USE_EMULATOR && URL_PARAMS.get("cc")) EXPERIMENT.prolific_completion_code = URL_PARAMS.get("cc");
// `?condition=music` or `?condition=movement` forces the modality, for piloting and the test
// robot. Recorded as condition_source = "url"; Prolific links never carry it.
const FORCED_CONDITION = ["music", "movement"].includes(URL_PARAMS.get("condition")) ? URL_PARAMS.get("condition") : null;

// ---------------------------------------------------------------------------
// Boot: connect the saver first so even a crash in the first trial gets logged.
// ---------------------------------------------------------------------------
(async function main() {
  const needsPointingDevice = EXPERIMENT.requires_keyboard || EXPERIMENT.requires_mouse;
  const deviceSupported = !needsPointingDevice || hasFinePointer();

  const saver = await DataSaver.init({
    experiment_id: EXPERIMENT.id,
    chunk_size: CHUNK_SIZE,
    save_full_data_at_end: EXPERIMENT.save_full_data_at_end,
    use_emulator: USE_EMULATOR,
    contact_email: EXPERIMENT.contact_email,
  });
  window.__saver = saver; // for debugging and the automated test

  // Record the device verdict on the participant document before anything else, so a
  // participant turned away below is still visible in the data rather than simply absent.
  saver.updateParticipant({
    device_supported: deviceSupported,
    requires_keyboard: EXPERIMENT.requires_keyboard,
    requires_mouse: EXPERIMENT.requires_mouse,
  });

  if (!deviceSupported) {
    document.body.innerHTML =
      '<div id="device-unsupported" class="jspsych-content" style="max-width:640px;margin:15vh auto;font:16px/1.6 system-ui,sans-serif;">' +
      "<h2>Please use a computer</h2>" +
      "<p>This study needs a laptop or desktop computer with a mouse or trackpad, because it " +
      "uses sliders and a large screen layout. Phones and tablets cannot be used.</p>" +
      "<p>Please reopen this link on a laptop or desktop computer. If you were sent here from " +
      "Prolific, you can return the study and take it later on a computer; nothing has been recorded " +
      "against you.</p>" +
      "<p>Questions: <a href=\"mailto:" + EXPERIMENT.contact_email + "\">" + EXPERIMENT.contact_email + "</a></p></div>";
    return;
  }

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_data_update: (trial) => saver.onTrial(trial),
    on_finish: async () => {
      const el = jsPsych.getDisplayElement();
      el.innerHTML = '<div id="finish-message"><p class="thanks">Saving your responses…</p></div>';
      // finish() flushes remaining trials, marks the participant complete, and (only if
      // saving failed) appends a download-fallback box to the display element.
      const result = await saver.finish(jsPsych);
      const consentRow = jsPsych.data.get().filter({ task: "consent" }).values()[0];
      const consented = !consentRow || consentRow.consented !== false;
      const msg = document.getElementById("finish-message");

      if (!consented) {
        msg.innerHTML = "<h2 class='thanks'>Thank you</h2><p class='thanks'>You chose not to participate. " +
          "You may close this window" + (EXPERIMENT.prolific_completion_code ? " and return the study on Prolific" : "") + ".</p>";
        return;
      }
      // A browser-check exclusion ended the study early: jsPsych paints its exclusion message
      // over this screen after on_finish returns, so do not redirect to Prolific.
      if (exclusionReason) return;
      if (result.ok && EXPERIMENT.prolific_completion_code && !USE_EMULATOR) {
        msg.innerHTML = "<p class='thanks'>Saved. Returning you to Prolific…</p>";
        window.location.href =
          "https://app.prolific.com/submissions/complete?cc=" + EXPERIMENT.prolific_completion_code;
        return;
      }
      // In emulator/test runs we stay on the page instead of navigating to Prolific, so that
      // setting a completion code can never turn `npm test` or CI red. Live runs redirect above.
      msg.innerHTML =
        "<h2 class='thanks'>All done</h2>" +
        (result.ok ? "<p class='thanks'>Your responses were saved. Thank you for participating!</p>" : "") +
        (EXPERIMENT.prolific_completion_code
          ? "<p class='thanks'>Your completion code is <strong>" + EXPERIMENT.prolific_completion_code + "</strong>.</p>"
          : "");
    },
  });
  let exclusionReason = null;

  // Record the participant id and URL parameters on every trial row.
  jsPsych.data.addProperties({
    // Must be the run-scoped document id, so trial rows join to participants.csv on export.
    participant_id: saver.docId,
    prolific_pid: saver.params.PROLIFIC_PID || null,
    experiment_id: EXPERIMENT.id,
  });

  // Random assignment to modality, recorded on every trial and on the participant document.
  // (For exact counterbalancing you would need a server; random assignment is fine at course
  // sample sizes.)
  const condition = FORCED_CONDITION || jsPsych.randomization.sampleWithoutReplacement(["music", "movement"], 1)[0];
  const conditionSource = FORCED_CONDITION ? "url" : "random";
  jsPsych.data.addProperties({ condition: condition, condition_source: conditionSource });
  saver.updateParticipant({ condition: condition, condition_source: conditionSource });
  window.__condition = condition; // for the automated test
  const isMusic = condition === "music";

  // Task code (ES modules). three.js is only needed, and only downloaded, for the ball.
  const { makeTaskPlugin, LABELS, EMOTIONS } = await import("./src/task.js");
  const { Piano, SAMPLE_URLS } = await import("./src/audio.js");
  const BallView = isMusic ? null : (await import("./src/ball.js")).BallView;
  const SieversTaskPlugin = makeTaskPlugin(jsPsychModule);
  const piano = new Piano();

  // Any click or key press is a user gesture that may unlock audio (browsers start audio
  // contexts suspended). Tone.js runs on jsPsych's own audio context.
  if (isMusic) {
    const unlock = () => { if (piano.ready) Tone.start(); };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
  }

  // -------------------------------------------------------------------------
  // 1. Consent (course-wide IRB text; edit only the contact address)
  // -------------------------------------------------------------------------
  const consent = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="consent">
        <h2>Consent</h2>
        <p>By answering the following questions, you are participating in a study being performed by
        cognitive scientists in the Stanford Department of Psychology. If you have questions about
        this research, please contact us at <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.
        You must be at least 18 years old to participate. Your participation in this research is
        voluntary. You may decline to answer any or all of the following questions. You may decline
        further participation, at any time, without adverse consequences. Your anonymity is assured;
        the researchers who have requested your participation will not receive any personal
        information about you.</p>
      </div>`,
    choices: ["I agree to participate", "I do not agree"],
    data: { task: "consent" },
    on_finish: (data) => {
      data.consented = data.response === 0;
      if (!data.consented) {
        // No end message here: jsPsych would paint it over the screen that on_finish renders.
        jsPsych.abortExperiment();
      }
    },
  };

  // -------------------------------------------------------------------------
  // 2. Preload the piano samples (music group)
  // -------------------------------------------------------------------------
  const preload = {
    timeline: [{
      type: jsPsychPreload,
      audio: SAMPLE_URLS,
      message: "<p>Loading sounds…</p>",
      error_message: "<p>The study's sounds could not be loaded. Please check your connection and reload the page.</p>",
      data: { task: "preload" },
    }],
    conditional_function: () => isMusic,
  };

  // -------------------------------------------------------------------------
  // 3. Browser check
  // -------------------------------------------------------------------------
  const browserCheck = {
    type: jsPsychBrowserCheck,
    minimum_width: EXPERIMENT.min_width,
    minimum_height: EXPERIMENT.min_height,
    features: ["width", "height", "webaudio", "browser", "browser_version", "mobile", "os"],
    inclusion_function: (d) => {
      if (!d.webaudio) { exclusionReason = "no_webaudio"; return false; }
      if (!isMusic && !hasWebGL()) { exclusionReason = "no_webgl"; return false; }
      return true;
    },
    exclusion_message: (d) => {
      if (!exclusionReason) exclusionReason = "window_too_small";
      return `<h2>This browser cannot run the study</h2>
        <p>${exclusionReason === "window_too_small"
          ? `The study needs a browser window of at least ${EXPERIMENT.min_width} × ${EXPERIMENT.min_height} pixels.`
          : "Your browser does not support the audio or graphics features this study needs."}
        Please try again on a laptop or desktop computer with a current version of Chrome, Firefox, Safari or Edge,
        or return the study on Prolific. Questions:
        <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.</p>`;
    },
    window_resize_message: `<p>Please make your browser window larger (at least ${EXPERIMENT.min_width} × ${EXPERIMENT.min_height} pixels), or switch to full screen.</p>
      <p>The study will continue automatically once the window is large enough.</p>`,
    data: { task: "browser_check" },
    on_finish: (data) => {
      data.webgl = hasWebGL();
      data.excluded = !!exclusionReason;
      data.exclusion_reason = exclusionReason;
      if (exclusionReason) saver.updateParticipant({ exclusion_reason: exclusionReason });
    },
  };

  // -------------------------------------------------------------------------
  // 4. Welcome
  // -------------------------------------------------------------------------
  const welcome = {
    type: jsPsychInstructions,
    pages: [
      `<h2>Welcome</h2>
       <p>In this study you will use a simple computer program to ${isMusic ? "make music" : "make an animation"}.
       First you will answer a few questions about yourself${isMusic ? " and check your sound" : ""}. Then you will
       get to know the program and use it to express five emotions. At the end there are a few short questions.</p>`,
      `<p>Please complete the study in one sitting, in a quiet place, on a laptop or desktop computer.
       ${isMusic ? "You will need to hear sound, so please use headphones or turn on your speakers." : "The study has no sound."}
       Use the buttons or the arrow keys to move between pages.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions", page_set: "welcome" },
  };

  // -------------------------------------------------------------------------
  // 5. Demographics (template)
  // -------------------------------------------------------------------------
  const demographics = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [
        {
          elements: [
            // The consent text promises participants may decline any question, so nothing here is required.
            { type: "text", name: "age", title: "How old are you?", inputType: "number", min: 18, max: 120 },
            {
              type: "radiogroup", name: "gender", title: "What is your gender?",
              choices: ["Woman", "Man", "Non-binary"], showOtherItem: true, showNoneItem: true, noneText: "Prefer not to say",
            },
            { type: "boolean", name: "native_english", title: "Is English your first language?", labelTrue: "Yes", labelFalse: "No" },
          ],
        },
      ],
    },
    data: { task: "demographics" },
  };

  // -------------------------------------------------------------------------
  // 6. Sound check (music group). Not in the original lab study; it is the exclusion criterion.
  // -------------------------------------------------------------------------
  const audioSetup = {
    type: jsPsychCallFunction,
    async: true,
    func: (done) => {
      // Reuse the buffers the preload trial decoded, on jsPsych's audio context.
      const getBuffer = (url) => jsPsych.pluginAPI.getAudioPlayer(url)
        .then((p) => (p && p.webAudioBuffer) || null)
        .catch(() => null);
      piano.load(jsPsych.pluginAPI.audioContext(), getBuffer)
        .then(() => done({ loaded: true }))
        .catch((e) => {
          exclusionReason = "audio_failed";
          saver.updateParticipant({ exclusion_reason: exclusionReason });
          jsPsych.abortExperiment(`<h2>Sound could not be started</h2>
            <p>Your browser could not play the study's sounds. Please try another browser, or return the study on Prolific.
            Questions: <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.</p>`,
            { loaded: false, error: String(e) });
        });
    },
    data: { task: "audio_setup" },
    on_finish: (data) => { Object.assign(data, data.value || {}); delete data.value; },
  };

  const audioVolume = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `<h2>Sound check</h2>
      <p>This part of the study uses sound. Please put on headphones or turn on your speakers.</p>
      <p>Click <b>Play test sound</b> as many times as you like and set your volume to a comfortable level. Then click <b>Continue</b>.</p>`,
    choices: ["Play test sound", "Continue"],
    data: { task: "audio_volume" },
    on_finish: (data) => {
      if (data.response === 0) Tone.start().then(() => piano.playNotes([60, 64, 67, 72, 67, 64, 60], 0.3));
    },
  };
  const audioVolumeLoop = {
    timeline: [audioVolume],
    loop_function: (d) => d.values()[0].response === 0,
  };
  const audioCheckIntro = {
    type: jsPsychHtmlButtonResponse,
    stimulus: "<p>Next, you will hear three short sets of piano notes. After each one, report how many notes you heard.</p>",
    choices: ["Start"],
    data: { task: "audio_check_intro" },
  };

  let audioCheckAnswer = 0;
  let audioCheckRounds = 0;
  const audioCheckTrial = {
    type: jsPsychHtmlButtonResponse,
    // jsPsych evaluates this once per trial, before on_start, so the note count is drawn here.
    stimulus: () => {
      audioCheckAnswer = 2 + Math.floor(Math.random() * 4);
      return `<div class="audio-check" data-n-notes="${audioCheckAnswer}">
        <p>How many notes did you hear?</p><p class="small">The notes play once.</p></div>`;
    },
    choices: ["2", "3", "4", "5"],
    button_html: (choice) => `<button class="jspsych-btn" disabled>${choice}</button>`,
    on_load: () => {
      const pool = [57, 60, 62, 64, 67, 69, 72];
      const notes = Array.from({ length: audioCheckAnswer }, () => pool[Math.floor(Math.random() * pool.length)]);
      Tone.start().then(() => {
        const dur = piano.playNotes(notes, 0.5);
        setTimeout(() => document.querySelectorAll(".jspsych-btn").forEach((b) => (b.disabled = false)), dur * 1000);
      });
    },
    data: { task: "audio_check" },
    on_finish: (data) => {
      data.n_notes = audioCheckAnswer;
      data.choice = Number(data.response) + 2;
      data.correct = data.choice === audioCheckAnswer;
      data.round = audioCheckRounds + 1;
    },
  };
  const audioCheckRetry = {
    timeline: [{
      type: jsPsychHtmlButtonResponse,
      stimulus: "<p>Let's try that again. Please make sure your sound is on and loud enough.</p>",
      choices: ["Try again"],
      data: { task: "audio_check_retry" },
    }],
    conditional_function: () => audioCheckRounds > 0,
  };
  const audioCheckBlock = {
    timeline: [audioCheckRetry, audioCheckTrial, audioCheckTrial, audioCheckTrial],
    loop_function: (d) => {
      audioCheckRounds += 1;
      const nCorrect = d.filter({ task: "audio_check" }).values().filter((x) => x.correct).length;
      const passed = nCorrect >= 2;
      if (passed || audioCheckRounds >= 3) {
        // After 3 failed rounds the participant continues; the flag drives the exclusion rule.
        jsPsych.data.addProperties({ audio_check_passed: passed, audio_check_rounds: audioCheckRounds });
        saver.updateParticipant({ audio_check_passed: passed, audio_check_rounds: audioCheckRounds });
        return false;
      }
      return true;
    },
  };
  const soundCheck = {
    timeline: [audioSetup, audioVolumeLoop, audioCheckIntro, audioCheckBlock],
    conditional_function: () => isMusic,
  };

  // -------------------------------------------------------------------------
  // 7. Program instructions (replace the original experimenter's demonstration)
  // -------------------------------------------------------------------------
  const labelList = `<table class="label-demo">${LABELS[condition].map((l) => `<tr><td>•</td><td>${l}</td></tr>`).join("")}</table>`;
  const programInstructions = {
    type: jsPsychInstructions,
    pages: [
      isMusic
        ? `<h2>The program</h2>
           <p>The program plays short melodies on a piano. <b>Click Play to hear a melody.</b> Each melody is 16 notes long.</p>
           <p>Five sliders control the melody. Their labels are:</p>${labelList}
           <p>Click or drag on a slider to move it. You can move the sliders while a melody is playing, and the music changes right away.</p>`
        : `<h2>The program</h2>
           <p>The program shows a ball that bounces. <b>Click Play to make the ball move.</b> Each movement is 16 bounces long.</p>
           <p>Five sliders control the movement. Their labels are:</p>${labelList}
           <p>Click or drag on a slider to move it. You can move the sliders while the ball is moving, and the movement changes right away.</p>`,
      `<h2>Get used to the program</h2>
       <p>First, take as much time as you like to get used to the program. There is nothing to do yet except try it out:
       click Play, move the sliders, and ${isMusic ? "listen to how the music changes" : "watch how the movement changes"}.</p>
       <p>When you feel ready, click <b>Start</b> below the sliders. You will then get instructions for the main task.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions", page_set: "program" },
  };

  // -------------------------------------------------------------------------
  // 8. Slider task
  // -------------------------------------------------------------------------
  let taskLogs = null;
  const sliderTask = {
    type: SieversTaskPlugin,
    condition: condition,
    // Passed as a function: jsPsych deep-copies plain object parameters, which would break
    // the Tone.js objects inside the piano.
    piano: () => piano,
    ballFactory: (container) => new BallView(container),
    practice_hint: isMusic
      ? "Click <b>Play</b> to hear a melody. Move the sliders to change the music.<br>When you are ready to begin the task, click <b>Start</b>."
      : "Click <b>Play</b> to make the ball move. Move the sliders to change the movement.<br>When you are ready to begin the task, click <b>Start</b>.",
    experiment_instructions: `
      <p>Now use the program to express five emotions: <b>angry, happy, peaceful, sad,</b> and <b>scared</b>.</p>
      <p>Each emotion is shown at the top of a list of words with roughly the same meaning. Work on the emotions in any order and switch between them whenever you like. Take as much time as you need.</p>
      <p>Click an emotion to work on it. Click <b>Play</b> to ${isMusic ? "hear" : "see"} the current setting and adjust the sliders. When the ${isMusic ? "music" : "movement"} expresses that emotion, click <b>Save</b>. <b>Load</b> brings back the setting you saved for an emotion. You can save again at any time; only your last save for each emotion counts.</p>
      <p>When all five emotions are saved, click <b>Finish</b>.</p>`,
    on_logs: (logs) => { taskLogs = logs; },
    data: { task: "slider_task" },
  };

  // -------------------------------------------------------------------------
  // 9. Emotion settings: the dependent measure, one row per emotion
  // -------------------------------------------------------------------------
  const taskRow = () => jsPsych.data.get().filter({ task: "slider_task" }).values()[0] || {};
  const emotionSettings = {
    timeline: [{
      type: jsPsychCallFunction,
      func: () => {
        const emotion = jsPsych.evaluateTimelineVariable("emotion");
        const s = (taskRow().saved || {})[emotion] || {};
        const nSaves = taskLogs ? taskLogs.saves.rows.filter((r) => r[1] === emotion).length : null;
        return {
          emotion: emotion,
          bpm: s.bpm ?? null, jitter: s.jitter ?? null, scale: s.scale ?? null,
          interval: s.interval ?? null, updown: s.updown ?? null,
          save_t_ms: s.t_ms ?? null, n_saves: nSaves,
        };
      },
      data: { task: "emotion_setting" },
      on_finish: (data) => { Object.assign(data, data.value); delete data.value; },
    }],
    timeline_variables: EMOTIONS.map((e) => ({ emotion: e.key })),
  };

  // -------------------------------------------------------------------------
  // 10. Process logs, split into rows of at most ~200 kB each
  // -------------------------------------------------------------------------
  const logQueue = [];
  const buildLogQueue = () => {
    if (!taskLogs) return;
    for (const [name, log] of Object.entries(taskLogs)) {
      const parts = [];
      let cur = [], size = 0;
      for (const row of log.rows) {
        const len = JSON.stringify(row).length + 1;
        if (cur.length && size + len > 200000) { parts.push(cur); cur = []; size = 0; }
        cur.push(row); size += len;
      }
      parts.push(cur);
      parts.forEach((rows, i) => logQueue.push({
        log: name, part: i + 1, n_parts: parts.length, n_rows: rows.length,
        columns: log.columns, rows_json: JSON.stringify(rows),
      }));
    }
  };
  const processLogs = {
    timeline: [{
      type: jsPsychCallFunction,
      on_start: () => { if (!logQueue.length && taskLogs) buildLogQueue(); },
      func: () => logQueue.shift(),
      data: { task: "slider_log" },
      on_finish: (data) => { Object.assign(data, data.value); delete data.value; },
    }],
    conditional_function: () => !!taskLogs,
    loop_function: () => logQueue.length > 0,
  };

  // -------------------------------------------------------------------------
  // 11. Exploratory questions (after every confirmatory measure)
  // -------------------------------------------------------------------------
  const exploratory = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [{
        elements: [
          { type: "text", name: "music_years", title: "How many years of formal music training have you had (lessons on an instrument or voice)?", inputType: "number", min: 0, max: 90 },
          { type: "text", name: "dance_years", title: "How many years of formal dance training have you had?", inputType: "number", min: 0, max: 90 },
          ...(isMusic ? [{
            type: "radiogroup", name: "audio_device", title: "How did you listen to the sounds?",
            choices: ["Headphones", "External speakers", "Built-in laptop speakers"], showOtherItem: true,
          }] : []),
          { type: "comment", name: "strategy", title: "Briefly, how did you decide where to set the sliders for each emotion? (optional)" },
        ],
      }],
    },
    data: { task: "exploratory" },
  };

  // -------------------------------------------------------------------------
  // 12. Feedback (template)
  // -------------------------------------------------------------------------
  const feedback = {
    type: jsPsychSurveyLikert,
    questions: [
      {
        prompt: "How clear were the instructions?", name: "instructions_clear", required: false,
        labels: ["Very unclear", "Unclear", "Neutral", "Clear", "Very clear"],
      },
    ],
    data: { task: "feedback_likert" },
  };
  const comments = {
    type: jsPsychSurveyText,
    questions: [{ prompt: "Any comments about the study? (optional)", name: "comments", rows: 4 }],
    data: { task: "feedback_text" },
  };

  // -------------------------------------------------------------------------
  // 13. Debrief
  // -------------------------------------------------------------------------
  const debrief = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <h2>Debrief</h2>
      <p>Thank you. This study tests whether people express emotions with the same patterns of speed,
      regularity, step size, direction and roughness in music and in movement. Some participants used the program
      to make melodies and others used the same sliders to make a bouncing ball move; we will compare the settings
      the two groups chose for each emotion. It replicates a study by Sievers and colleagues (2013).
      If you have questions about this research, contact
      <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.
      Press the button to save your responses and finish.</p>`,
    choices: ["Finish"],
    data: { task: "debrief" },
  };

  await jsPsych.run([
    consent,
    preload,
    browserCheck,
    welcome,
    demographics,
    soundCheck,
    programInstructions,
    sliderTask,
    emotionSettings,
    processLogs,
    exploratory,
    feedback,
    comments,
    debrief,
  ]);
})();

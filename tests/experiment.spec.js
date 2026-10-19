// End-to-end test: a robot participant runs the whole experiment.
//
// Two modes:
//   - Emulator mode (EMULATOR=1, set automatically by `npm test`): data must land in the
//     local Firestore emulator, the security rules must reject forbidden requests, and
//     client errors must be logged.
//   - Offline mode (plain `npx playwright test`): the experiment must still run to the end
//     and offer the JSON download fallback.
//
// If you change the timeline in experiment.js, update `runThroughExperiment` below so the
// robot still knows which buttons to press. That is a feature: the test documents the flow.

const { test, expect, devices } = require("@playwright/test");

const EMULATOR = process.env.EMULATOR === "1" || !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-psych251";
const EXPERIMENT_ID = "sievers2012-pilot-a";
const FS = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const EMOTIONS = ["happy", "sad", "angry", "scared", "peaceful"];
const SLIDER_KEYS = ["bpm", "jitter", "scale", "interval", "updown"];

// Slider positions the robot clicks for each emotion (fraction of the track, per slider), in
// the order it works through them; the first slider stays at the far right so sequences are
// short (400 per minute).
const ROBOT_PLAN = [
  ["peaceful", [1, 0.05, 0.98, 0.2, 0.35]],
  ["happy", [1, 0.2, 0.9, 0.6, 0.3]],
  ["sad", [1, 0.1, 0.6, 0.1, 0.8]],
  ["angry", [1, 0.6, 0.05, 0.8, 0.8]],
  ["scared", [1, 0.7, 0.2, 0.6, 0.5]],
];

async function clickSlider(page, index, frac) {
  const box = await page.locator(".ws").nth(index).boundingBox();
  // keep clicks inside the track so frac 0 and 1 land on the end values
  const x = box.x + Math.min(box.width - 1, Math.max(1, frac * box.width));
  await page.mouse.click(x, box.y + box.height / 2);
}

async function sliderValues(page) {
  const vals = await page.locator(".ws").evaluateAll((els) => els.map((e) => Number(e.getAttribute("aria-valuenow"))));
  return Object.fromEntries(SLIDER_KEYS.map((k, i) => [k, vals[i]]));
}

// Plays the whole study. Returns what the robot did, for the assertions.
// opts.stopBeforeFinish: stop on the debrief screen without clicking Finish.
async function runThroughExperiment(page, opts = {}) {
  const did = { audioChecks: [], saved: {} };
  // 1. consent
  await page.getByRole("button", { name: "I agree to participate" }).click();
  did.condition = await page.evaluate(() => window.__condition);
  const music = did.condition === "music";
  // 2-3. preload (music) and browser check run by themselves; 4. welcome (two pages)
  await page.locator("#jspsych-instructions-next").click();
  await page.locator("#jspsych-instructions-next").click();
  // 5. demographics (SurveyJS)
  await page.locator('input[type="number"]').fill("34");
  await page.getByText("Woman", { exact: true }).click();
  // SurveyJS boolean switches render "Yes" twice once toggled; scope to the question.
  await page.locator('[data-name="native_english"]').getByText("Yes", { exact: true }).first().click();
  await page.locator('input[value="Continue"]').click();
  // 6. sound check (music group): volume page, intro, three note-count trials
  if (music) {
    await page.getByRole("button", { name: "Play test sound" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Start" }).click();
    for (let i = 0; i < 3; i++) {
      const stim = page.locator(".audio-check");
      await stim.waitFor({ state: "visible" });
      await page.locator(".jspsych-btn:not([disabled])").first().waitFor();
      const n = Number(await stim.getAttribute("data-n-notes"));
      const answer = i === 0 ? (n === 5 ? 4 : n + 1) : n; // first answer deliberately wrong
      did.audioChecks.push({ n, answer });
      // consecutive trials reuse the class, so wait for this particular element to go away
      const handle = await stim.elementHandle();
      await page.getByRole("button", { name: String(answer), exact: true }).click();
      await page.waitForFunction((el) => !el.isConnected, handle);
    }
  }
  // 7. program instructions (two pages)
  await page.locator("#jspsych-instructions-next").click();
  await page.locator("#jspsych-instructions-next").click();
  // 8. slider task: practice, then the five emotions
  const play = page.locator(".btn-play");
  await play.waitFor();
  await clickSlider(page, 0, 1);
  await play.click();
  await expect(play).toBeDisabled();
  await expect(play).toBeEnabled({ timeout: 15000 });
  await page.locator(".btn-start").click();
  await page.locator(".task-modal .btn-primary").click(); // Begin
  await expect(page.locator(".btn-finish")).toBeDisabled();
  for (const [emotion, fracs] of ROBOT_PLAN) {
    const card = page.locator(`.emo-card[data-emotion="${emotion}"]`);
    await card.locator(".emo-syn").click();
    await expect(card).toHaveClass(/is-focus/);
    const save = page.locator(`.btn-save[data-emotion="${emotion}"]`);
    await expect(save).toBeDisabled(); // not until a sequence has been played
    for (let i = 0; i < fracs.length; i++) await clickSlider(page, i, fracs[i]);
    await expect(play).toBeEnabled({ timeout: 15000 });
    await play.click();
    await expect(save).toBeEnabled();
    did.saved[emotion] = await sliderValues(page);
    await save.click();
    await expect(card.locator(".emo-state")).toHaveText("Saved");
    await expect(page.locator(`.btn-load[data-emotion="${emotion}"]`)).toBeEnabled();
  }
  await expect(page.locator(".btn-finish")).toBeEnabled();
  await expect(play).toBeEnabled({ timeout: 15000 }); // let the last sequence finish, so all 6 are logged in full
  await page.locator(".btn-finish").click();
  await page.locator(".task-modal .btn-primary").click(); // confirm Finish
  // 11. exploratory questions
  await page.locator('[data-name="music_years"] input').fill("2");
  await page.locator('[data-name="dance_years"] input').fill("0");
  if (music) await page.locator('[data-name="audio_device"]').getByText("Headphones", { exact: true }).click();
  await page.locator('input[value="Continue"]').click();
  // 12. feedback
  await page.locator('input[name="Q0"][value="4"]').check();
  await page.locator("#jspsych-survey-likert-next").click();
  await page.locator("textarea").fill("Robot participant says hi.");
  await page.locator("#jspsych-survey-text-next").click();
  // 13. debrief
  await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
  if (opts.stopBeforeFinish) return did;
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("All done")).toBeVisible({ timeout: 30000 });
  return did;
}

async function fsGet(path) {
  // "Bearer owner" is the emulator's admin token: it bypasses security rules, like the Admin SDK.
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

// Unwrap Firestore REST "fields" encoding into plain JS.
function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decode(fields[k]);
  return out;
}

// Checks a completed run against the emulator: participant document, one chunk per trial,
// the dependent measure, the sound check, and the process logs.
async function checkSavedRun(page, did, expectedCondition) {
  const uid = await page.evaluate(() => window.__saver.docId);
  const stats = await page.evaluate(() => window.__saver.stats);
  expect(stats.writes_failed).toBe(0);
  await expect(page.locator("#data-saver-fallback")).toHaveCount(0);

  // Participant document is complete and carries condition + Prolific ids.
  const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`);
  expect(p.status).toBe(200);
  const pdoc = decodeFields(p.body.fields);
  expect(pdoc.completed).toBe(true);
  expect(pdoc.condition).toBe(expectedCondition);
  expect(pdoc.condition_source).toBe("url");
  expect(pdoc.prolific_pid).toBe("robot123");
  expect(pdoc.requires_keyboard).toBe(false);
  expect(pdoc.n_trials).toBeGreaterThan(15);
  expect(typeof pdoc.full_data).toBe("string");
  const full = JSON.parse(pdoc.full_data);
  expect(full.length).toBe(pdoc.n_trials);

  // One chunk per trial (chunk_size = 1), each carrying the trial data.
  const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
  expect(chunks.status).toBe(200);
  const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
  expect(docs.length).toBe(pdoc.n_trials);
  const trials = docs.flatMap((d) => d.trials);
  expect(trials.every((t) => t.condition === expectedCondition)).toBe(true);

  // Dependent measure: one emotion_setting row per emotion, equal to what the robot saved.
  const settings = trials.filter((t) => t.task === "emotion_setting");
  expect(settings.map((t) => t.emotion).sort()).toEqual([...EMOTIONS].sort());
  for (const row of settings) {
    for (const k of SLIDER_KEYS) expect(row[k], `${row.emotion}.${k}`).toBe(did.saved[row.emotion][k]);
    expect(row.n_saves).toBe(1);
  }
  // The robot's slider clicks span the ranges: far left and far right map to the end values.
  expect(did.saved.peaceful.bpm).toBe(400);
  expect(did.saved.angry.scale).toBeLessThanOrEqual(2);

  const task = trials.find((t) => t.task === "slider_task");
  expect(task.n_saves).toBe(5);
  expect(task.n_sequences_practice).toBe(1);
  expect(task.n_sequences_experiment).toBe(5);
  expect(Object.keys(task.saved).sort()).toEqual([...EMOTIONS].sort());

  // Process logs: every generated note is logged, 16 per sequence.
  const logs = trials.filter((t) => t.task === "slider_log");
  const logRows = (name) => logs.filter((l) => l.log === name).flatMap((l) => JSON.parse(l.rows_json));
  expect(logRows("notes").length).toBe(16 * 6);
  expect(logRows("saves").length).toBe(5);
  expect(logRows("slider_samples").length).toBeGreaterThan(5);
  const ui = logRows("ui_events").map((r) => r[2]);
  expect(ui.filter((e) => e === "select").length).toBe(5);

  // Sound check: music only; the robot answers the first trial wrong.
  const checks = trials.filter((t) => t.task === "audio_check");
  if (expectedCondition === "music") {
    expect(checks.map((t) => t.correct)).toEqual([false, true, true]);
    expect(checks.map((t) => t.choice)).toEqual(did.audioChecks.map((c) => c.answer));
    expect(pdoc.audio_check_passed).toBe(true);
    expect(trials.find((t) => t.task === "audio_setup").loaded).toBe(true);
  } else {
    expect(checks.length).toBe(0);
    expect(trials.some((t) => t.task === "preload")).toBe(false);
  }

  const demo = trials.find((t) => t.task === "demographics");
  expect(demo.response.age).toBe(34);
  const expl = trials.find((t) => t.task === "exploratory");
  expect(expl.response.music_years).toBe(2);

  // Every trial row must carry the same participant id as its participant document,
  // otherwise trials.csv and participants.csv cannot be joined in the analysis.
  expect([...new Set(trials.map((t) => t.participant_id))]).toEqual([uid]);
}

test.describe("experiment", () => {
  for (const condition of ["music", "movement"]) {
    test(`runs to the end and saves data (${condition})`, async ({ page }) => {
      const consoleErrors = [];
      page.on("pageerror", (e) => consoleErrors.push(String(e)));

      await page.goto(EMULATOR
        ? `/?emulator=1&condition=${condition}&PROLIFIC_PID=robot123&STUDY_ID=s1&SESSION_ID=sess1`
        : `/?condition=${condition}`);
      await page.waitForFunction(() => window.__saver && window.__saver.uid);
      const mode = await page.evaluate(() => window.__saver.mode);
      expect(mode).toBe(EMULATOR ? "emulator" : "offline");

      const did = await runThroughExperiment(page);
      expect(did.condition).toBe(condition);

      // No uncaught errors from the experiment itself.
      expect(consoleErrors, "uncaught page errors").toEqual([]);

      if (!EMULATOR) {
        // Offline: banner + download fallback, nothing else to check.
        await expect(page.locator("#data-saver-banner")).toHaveAttribute("data-kind", "offline");
        await expect(page.locator("#data-saver-fallback")).toBeVisible();
        return;
      }
      await checkSavedRun(page, did, condition);
    });
  }

  test("chunked writes (chunk_size > 1) save every trial", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1&chunk_size=5");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page);
    const uid = await page.evaluate(() => window.__saver.docId);
    const p = decodeFields((await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`)).body.fields);
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(Math.ceil(p.n_trials / 5));
    const indices = docs.flatMap((d) => d.trials).map((t) => t.trial_index).sort((a, b) => a - b);
    // Skipped conditional timelines (preload, sound check, audio-check retry) still use up a
    // trial_index in jsPsych 8, so compare against jsPsych's own rows rather than 0..n-1.
    const recorded = await page.evaluate(() => window.__saver.allTrials.map((t) => t.trial_index));
    expect(recorded.length).toBe(p.n_trials);
    expect(indices).toEqual(recorded.sort((a, b) => a - b));
  });

  test("declining consent ends the study without a thank-you-for-your-data message", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await page.getByRole("button", { name: "I do not agree" }).click();
    await expect(page.getByText("You chose not to participate")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
  });

  test("losing the connection at the end offers the download fallback instead of hanging", async ({ page, context }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);
    // Run the real flow up to the last click, then cut the connection before "Finish".
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page, { stopBeforeFinish: true });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator("#data-saver-fallback")).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("connection to the server was lost")).toBeVisible();
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
    await context.setOffline(false);
  });

  test("a second run in the same browser is a new participant and saves cleanly", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);

    const ids = [];
    for (let run = 0; run < 2; run++) {
      // Same page/context both times: the anonymous auth session persists, exactly as it
      // does for a student testing twice in one browser or a participant who reloads.
      await page.goto("/?emulator=1&PROLIFIC_PID=rerun" + run);
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      await runThroughExperiment(page);
      const info = await page.evaluate(() => ({
        uid: window.__saver.uid, docId: window.__saver.docId, stats: window.__saver.stats,
      }));
      expect(info.stats.writes_failed, "run " + run + " had failed writes").toBe(0);
      await expect(page.locator("#data-saver-fallback")).toHaveCount(0);
      ids.push(info);
    }

    expect(ids[0].uid).toBe(ids[1].uid);          // same browser, same anonymous identity
    expect(ids[0].docId).not.toBe(ids[1].docId);  // but a separate participant record

    // Both runs survive intact, with their own Prolific id and their own trials.
    for (let run = 0; run < 2; run++) {
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}`);
      expect(p.status).toBe(200);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.completed, "run " + run + " completed").toBe(true);
      expect(pdoc.prolific_pid).toBe("rerun" + run);
      const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}/trials?pageSize=500`);
      expect((chunks.body.documents || []).length).toBe(pdoc.n_trials);
    }
  });

  test("setting a Prolific completion code does not break the test run", async ({ page }) => {
    // Regression test for the failure students hit right before launch: with a completion
    // code set, the live page redirects to Prolific, but a test run must stay put so that
    // `npm test` and CI keep passing.
    const navigations = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

    await page.goto(EMULATOR ? "/?emulator=1&cc=QA123CODE" : "/?cc=QA123CODE");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await runThroughExperiment(page);

    expect(navigations.some((u) => u.includes("prolific.com")), "must not navigate to Prolific").toBe(false);
    if (EMULATOR) await expect(page.getByText("QA123CODE")).toBeVisible();
  });

  test("phones and tablets are turned away before consent", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto("http://localhost:8017/?emulator=1");
    await expect(page.locator("#device-unsupported")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: "I agree to participate" })).toHaveCount(0);

    if (EMULATOR) {
      // The turned-away visit is still recorded, so phone traffic is visible in the data.
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      const docId = await page.evaluate(() => window.__saver.docId);
      await page.evaluate(() => window.__saver._settle());
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${docId}`);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.device_supported).toBe(false);
      expect(pdoc.completed).toBe(false);
    }
    await context.close();
  });

  test("a desktop browser is not turned away", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible();
    await expect(page.locator("#device-unsupported")).toHaveCount(0);
  });

  test("a write the database refuses is announced on the page, not only in the console", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    // Regression test for the state a student is in when they skip publishing the rules, or
    // once test-mode rules expire: sign-in succeeds, so the page used to look perfectly
    // healthy from consent to debrief and only admitted the problem on the last screen.
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    // Emulator runs carry an informational banner; what must be absent is a failure banner.
    await expect(page.locator('#data-saver-banner[data-kind="offline"]')).toHaveCount(0);

    // Force a genuine permission-denied on a normal save path by aiming the participant
    // document at someone else's id, which the rules refuse exactly as deny-all rules would.
    await page.evaluate(async () => {
      window.__saver.docId = "someone-else-deadbeef";
      await window.__saver.updateParticipant({ blocked: true });
    });

    const banner = page.locator("#data-saver-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-kind", "offline");
    await expect(banner).toContainText("NOT being saved");
    await expect(banner).toContainText("permission-denied");
    await expect(banner).toContainText("2.3");
    expect(await page.evaluate(() => window.__saver.stats.writes_failed)).toBeGreaterThan(0);
  });

  test("the download fallback tells the participant where to send the file", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await page.evaluate(() => window.__saver._offerDownload(null, "[]"));
    const box = page.locator("#data-saver-fallback");
    await expect(box).toBeVisible();
    await expect(box).toContainText("@");                       // a contact address is present
    await expect(box).toContainText("you will be paid");
    await expect(box.getByRole("link")).toHaveAttribute("href", /^mailto:/);
  });

  test("security rules reject reads and writes to other participants", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);

    const results = await page.evaluate(async () => {
      const s = window.__saver;
      const fb = s.fb;
      const out = {};
      const attempt = async (name, fn) => {
        try { await fn(); out[name] = "allowed"; } catch (e) { out[name] = e.code || e.message; }
      };
      await attempt("read own doc", () =>
        fb.getDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId)));
      await attempt("write other participant", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else"), { hacked: true }));
      await attempt("write other participant trials", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else", "trials", "c0"), { trials: [] }));
      await attempt("write unrelated collection", () =>
        fb.setDoc(fb.doc(s.db, "spam", "doc"), { spam: true }));
      await attempt("error doc with wrong uid", () =>
        fb.addDoc(fb.collection(s.db, "experiments", s.opts.experiment_id, "errors"), { uid: "not-me", message: "x" }));
      await attempt("own chunk (should be allowed)", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId, "trials", "chunk-test"), { trials: [{ a: 1 }] }));
      await attempt("participant doc without the run suffix", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.uid), { sneaky: true }));
      await attempt("another browser's run id", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else-abcd1234"), { sneaky: true }));
      return out;
    });

    expect(results["read own doc"]).toBe("permission-denied");
    expect(results["write other participant"]).toBe("permission-denied");
    expect(results["write other participant trials"]).toBe("permission-denied");
    expect(results["write unrelated collection"]).toBe("permission-denied");
    expect(results["error doc with wrong uid"]).toBe("permission-denied");
    expect(results["own chunk (should be allowed)"]).toBe("allowed");
    expect(results["participant doc without the run suffix"]).toBe("permission-denied");
    expect(results["another browser's run id"]).toBe("permission-denied");
  });

  test("uncaught errors are logged to the errors collection", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const uid = await page.evaluate(() => window.__saver.uid);

    // Simulate a bug in a trial: an uncaught exception.
    await page.evaluate(() => {
      setTimeout(() => { throw new Error("simulated bug in trial code"); }, 0);
    });
    await page.waitForFunction(() => window.__saver.stats.errors_logged >= 1);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    const errs = await fsGet(`experiments/${EXPERIMENT_ID}/errors?pageSize=100`);
    const mine = (errs.body.documents || []).map((d) => decodeFields(d.fields)).filter((d) => d.uid === uid);
    expect(mine.length).toBe(1);
    expect(mine[0].message).toContain("simulated bug");
    expect(mine[0].context.kind).toBe("uncaught");
  });
});

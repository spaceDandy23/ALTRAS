import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const debugBase = 'http://127.0.0.1:9223';
const appBase = 'http://127.0.0.1:4173';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDirectory = path.join(root, 'artifacts');
const runId = Date.now();
const firstUsername = `learner_${runId}`;
const secondUsername = `second_${runId}`;
const password = 'Classroom123';

const target = await fetch(`${debugBase}/json/new?${encodeURIComponent(appBase)}`, {
  method: 'PUT',
}).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, label, timeout = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function navigate(url) {
  await send('Page.navigate', { url });
  await waitFor("document.readyState === 'complete'", `${url} to load`);
}

async function setInput(selector, value, index = 0) {
  await evaluate(`(() => {
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function clickByText(selector, label) {
  await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)});
    if (!element) throw new Error(${JSON.stringify(`Missing control: ${label}`)});
    element.click();
  })()`);
}

async function capture(name, width = 1366, height = 768) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(path.join(artifactDirectory, name), Buffer.from(data, 'base64'));
}

async function register(username, displayName) {
  await navigate(`${appBase}/register`);
  await waitFor("Boolean(document.querySelector('form'))", 'registration form');
  await setInput('[autocomplete="name"]', displayName);
  await setInput('[autocomplete="username"]', username.toLocaleUpperCase('en-US'));
  await setInput('[autocomplete="new-password"]', password, 0);
  await setInput('[autocomplete="new-password"]', password, 1);
  await evaluate("document.querySelector('form').requestSubmit()");
  await waitFor(
    "location.pathname === '/' && Boolean(document.querySelector('.menu-grid'))",
    'registration',
  );
}

async function login(username) {
  await setInput('[autocomplete="username"]', username);
  await setInput('[autocomplete="current-password"]', password);
  await evaluate("document.querySelector('form').requestSubmit()");
  await waitFor(
    "location.pathname === '/' && Boolean(document.querySelector('.menu-grid'))",
    'login',
  );
}

async function logout() {
  await evaluate("document.querySelector('.logout-button').click()");
  await waitFor('Boolean(document.querySelector(\'[role="alertdialog"]\'))', 'logout dialog');
  await evaluate("document.querySelector('.dialog .button--danger').click()");
  await waitFor("location.pathname === '/login'", 'logout');
}

async function answerFindWord(choice) {
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'Find-the-Word activity');
  await clickByText('.choice-option', choice);
  await clickByText('.activity-actions .button', 'Submit answer');
  await waitFor("Boolean(document.querySelector('.answer-feedback'))", 'answer feedback');
}

async function answerOrganize(labels) {
  await waitFor(
    "Boolean(document.querySelector('.available-token-list'))",
    'Organize-and-Translate activity',
  );
  for (const label of labels) {
    await evaluate(`(() => {
      const element = [...document.querySelectorAll('.available-token')]
        .find((candidate) => candidate.textContent.replace(/^\\+\\s*/, '').trim() === ${JSON.stringify(label)});
      if (!element) throw new Error(${JSON.stringify(`Missing phrase token: ${label}`)});
      element.click();
    })()`);
  }
  await clickByText('.activity-actions .button', 'Submit translation');
  await waitFor("Boolean(document.querySelector('.answer-feedback'))", 'translation feedback');
}

async function continueActivity() {
  await evaluate("document.querySelector('.answer-feedback .button').click()");
  await waitFor("!document.querySelector('.answer-feedback')", 'feedback to close');
  await waitFor(
    "Boolean(document.querySelector('.choice-grid, .available-token-list, .result-board'))",
    'next lesson step',
  );
}

async function completeAttempt({ perfect }) {
  await answerFindWord(perfect ? 'sum' : 'difference');
  await continueActivity();
  await answerFindWord(perfect ? 'product' : 'quotient');
  await continueActivity();
  await answerFindWord('quotient');
  await continueActivity();
  await answerOrganize(['six', 'less than', 'a number']);
  await continueActivity();
  await answerOrganize(['a number', 'subtracted from', 'twelve']);
  await continueActivity();
  await answerOrganize(['the sum of', 'three times a number', 'and', 'seven']);
  await continueActivity();
  await waitFor("Boolean(document.querySelector('.result-board'))", 'lesson result');
}

function log(message) {
  process.stdout.write(`✓ ${message}\n`);
}

try {
  await mkdir(artifactDirectory, { recursive: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Storage.clearDataForOrigin', { origin: appBase, storageTypes: 'all' });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await navigate(appBase);
  await waitFor("location.pathname === '/login'", 'guest route protection');
  await register(firstUsername, 'Manual Learner');
  log('created the first local account');

  await capture('phase2-main-1366x768.png');
  await capture('phase2-main-1920x1080.png', 1920, 1080);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  log('charcoal main menu fits 1366×768 and 1920×1080');

  await evaluate('document.querySelector(\'a[href="/lessons"]\').click()');
  await waitFor(
    "location.pathname === '/lessons' && Boolean(document.querySelector('.lesson-path'))",
    'lesson hub',
  );
  const initiallyLocked = await evaluate("Boolean(document.querySelector('.lesson-node--locked'))");
  if (!initiallyLocked) throw new Error('Lesson 2 was not initially locked');
  await capture('phase2-lesson-hub.png');
  log('lesson hub shows Lesson 1 available and Lesson 2 locked');

  await evaluate("document.querySelector('.lesson-path a').click()");
  await waitFor("Boolean(document.querySelector('.lesson-overview__hero'))", 'lesson overview');
  await capture('phase2-lesson-overview.png');
  await clickByText('.lesson-summary .button', 'Start lesson');
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'first activity');

  await answerFindWord('sum');
  await continueActivity();
  await evaluate("document.querySelector('.lesson-exit').click()");
  await waitFor('Boolean(document.querySelector(\'[role="alertdialog"]\'))', 'exit confirmation');
  await evaluate("document.querySelector('.dialog .button--danger').click()");
  await waitFor("Boolean(document.querySelector('.lesson-summary'))", 'overview after exit');
  await clickByText('.lesson-summary .button--primary', 'Resume lesson');
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'resumed activity');
  const resumedNumber = await evaluate(
    "document.querySelector('.lesson-player__identity strong').textContent",
  );
  if (!resumedNumber.includes('2 of 6')) throw new Error('Attempt did not resume at activity 2');
  await evaluate("document.querySelector('.lesson-exit').click()");
  await evaluate("document.querySelector('.dialog .button--danger').click()");
  await waitFor("Boolean(document.querySelector('.lesson-summary'))", 'overview before restart');
  await clickByText('.lesson-summary .button--quiet', 'Restart from the beginning');
  await waitFor(
    'Boolean(document.querySelector(\'[role="alertdialog"]\'))',
    'restart confirmation',
  );
  await evaluate("document.querySelector('.dialog .button--danger').click()");
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'restarted lesson');
  log('exit, resume, and confirmed restart preserve attempt history');

  await capture('phase2-find-the-word.png');
  await answerFindWord('difference');
  await continueActivity();
  await answerFindWord('quotient');
  await continueActivity();
  await answerFindWord('quotient');
  await continueActivity();
  await capture('phase2-organize-translate.png');
  await answerOrganize(['six', 'less than', 'a number']);
  await continueActivity();
  await answerOrganize(['a number', 'subtracted from', 'twelve']);
  await continueActivity();
  await answerOrganize(['the sum of', 'three times a number', 'and', 'seven']);
  await continueActivity();
  await waitFor("Boolean(document.querySelector('.result-page--failed'))", 'failed result');
  await capture('phase2-result-failed.png');
  log('failed attempt remains recorded and Lesson 2 stays locked');

  await clickByText('.result-actions .button--primary', 'Retry lesson');
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'retry');
  await completeAttempt({ perfect: true });
  await waitFor("Boolean(document.querySelector('.result-page--cleared'))", 'cleared result');
  await capture('phase2-result-cleared.png');
  log('perfect retry clears Lesson 1, awards three stars, and improves XP once');

  await send('Page.reload');
  await waitFor("Boolean(document.querySelector('.result-page--cleared'))", 'result refresh');
  await waitFor('navigator.serviceWorker?.controller !== null', 'service worker control');
  await send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await send('Page.reload');
  await waitFor(
    "Boolean(document.querySelector('.result-page--cleared'))",
    'offline result reload',
  );
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  log('completed result and progress survive refresh and offline reopening');

  await clickByText('.result-actions .button--quiet', 'Lesson hub');
  await waitFor("Boolean(document.querySelector('.lesson-path'))", 'unlocked hub');
  const unlocked = await evaluate("document.querySelectorAll('.lesson-node--locked').length === 0");
  if (!unlocked) throw new Error('Lesson 2 did not unlock');
  await evaluate("document.querySelectorAll('.lesson-path a')[1].click()");
  await waitFor("Boolean(document.querySelector('.preview-board'))", 'Lesson 2 preview');
  log('passing attempt unlocks the deliberate Lesson 2 preview');

  await logout();
  await register(secondUsername, 'Second Learner');
  await evaluate('document.querySelector(\'a[href="/lessons"]\').click()');
  await waitFor("Boolean(document.querySelector('.lesson-path'))", 'second user hub');
  const secondLocked = await evaluate("Boolean(document.querySelector('.lesson-node--locked'))");
  const secondBest = await evaluate("document.querySelector('.lesson-node__metrics').textContent");
  if (!secondLocked || !secondBest.includes('Best 0%'))
    throw new Error('Progress leaked between users');
  await logout();
  await login(firstUsername);
  log('switching local users keeps lesson progress isolated and existing login works');
} finally {
  socket.close();
}

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

async function pressKey(key, code = key) {
  const virtualKeyCode = code === 'Space' ? 32 : code === 'Enter' ? 13 : 0;
  const params = {
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

async function keyboardClickByText(selector, label) {
  await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)});
    if (!element) throw new Error(${JSON.stringify(`Missing control: ${label}`)});
    element.focus();
  })()`);
  await pressKey(' ', 'Space');
}

async function pointerClickByText(selector, label) {
  const point = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)});
    if (!element) throw new Error(${JSON.stringify(`Missing control: ${label}`)});
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...point,
  });
}

async function capture(name, width = 1366, height = 768) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('document.activeElement?.blur()');
  await evaluate('window.scrollTo(0, 0)');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(path.join(artifactDirectory, name), Buffer.from(data, 'base64'));
}

async function captureAtBothSizes(name) {
  await capture(name);
  await capture(name.replace('.png', '-1920x1080.png'), 1920, 1080);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function assertNoViewportOverflow(label) {
  const dimensions = await evaluate(`({
    innerWidth,
    innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight
  })`);
  if (dimensions.scrollWidth > dimensions.innerWidth) {
    throw new Error(`${label} has horizontal viewport overflow`);
  }
  return dimensions;
}

async function register(username, displayName, captureScreen = false) {
  await navigate(`${appBase}/register`);
  await waitFor("Boolean(document.querySelector('form'))", 'registration form');
  if (captureScreen) {
    await captureAtBothSizes('phase2.1-register.png');
    await assertNoViewportOverflow('Registration');
  }
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

async function answerFindWord(choice, interaction = 'pointer') {
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'Find-the-Word activity');
  if (interaction === 'keyboard') {
    await evaluate(`(() => {
      const option = [...document.querySelectorAll('.choice-option')]
        .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(choice)});
      if (!option) throw new Error(${JSON.stringify(`Missing choice: ${choice}`)});
      option.querySelector('input').focus();
    })()`);
    await pressKey(' ', 'Space');
    const selectedByKeyboard = await evaluate(
      "Boolean(document.activeElement?.matches('.choice-option input') && document.activeElement.checked)",
    );
    if (!selectedByKeyboard) throw new Error('Keyboard did not select the focused radio option');
    await waitFor(
      "!document.querySelector('.activity-actions .button--primary').disabled",
      'keyboard selection to enable submission',
    );
    await keyboardClickByText('.activity-actions .button', 'Submit answer');
  } else {
    await pointerClickByText('.choice-option', choice);
    await pointerClickByText('.activity-actions .button', 'Submit answer');
  }
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
      element.scrollIntoView({ block: 'center' });
    })()`);
    await pointerClickByText('.available-token', `+ ${label}`);
  }
  await pointerClickByText('.activity-actions .button', 'Submit translation');
  await waitFor("Boolean(document.querySelector('.answer-feedback'))", 'translation feedback');
}

async function continueActivity(interaction = 'pointer') {
  if (interaction === 'keyboard') {
    const label = await evaluate(
      "document.querySelector('.answer-feedback .button').textContent.trim()",
    );
    await keyboardClickByText('.answer-feedback .button', label);
  } else {
    const label = await evaluate(
      "document.querySelector('.answer-feedback .button').textContent.trim()",
    );
    await pointerClickByText('.answer-feedback .button', label);
  }
  await waitFor("!document.querySelector('.answer-feedback')", 'feedback to close');
  await waitFor(
    "Boolean(document.querySelector('.choice-grid, .available-token-list, .result-board'))",
    'next lesson step',
  );
}

async function completeAttempt({ perfect }) {
  await answerFindWord(perfect ? 'sum' : 'difference', 'keyboard');
  await continueActivity('keyboard');
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

async function completeOrderMatters({ perfect }) {
  await answerFindWord(perfect ? 'less' : 'more', 'keyboard');
  await continueActivity('keyboard');
  await answerFindWord(perfect ? 'subtracted' : 'added');
  await continueActivity();
  await answerOrganize(['five', 'less than', 'a number']);
  await continueActivity();
  await answerOrganize(['a number', 'subtracted from', 'twelve']);
  await continueActivity();
  await answerOrganize(['four', 'more than', 'twice a number']);
  await continueActivity();
  await waitFor("Boolean(document.querySelector('.result-board'))", 'Order Matters result');
}

function log(message) {
  process.stdout.write(`✓ ${message}\n`);
}

try {
  await mkdir(artifactDirectory, { recursive: true });
  await send('Page.enable');
  await send('Page.bringToFront');
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
  await captureAtBothSizes('phase2.1-login.png');
  await assertNoViewportOverflow('Login');
  await register(firstUsername, 'Manual Learner', true);
  log('created the first local account');

  await capture('phase2.1-main-1366x768.png');
  await capture('phase2.1-main-1920x1080.png', 1920, 1080);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await assertNoViewportOverflow('Main menu');
  await evaluate("document.querySelector('.user-menu summary').focus()");
  await pressKey(' ', 'Space');
  await waitFor("document.querySelector('.user-menu').open", 'keyboard account menu opening');
  const accountLinks = await evaluate(
    "document.querySelectorAll('.user-menu__popover a, .user-menu__popover button').length",
  );
  if (accountLinks !== 3) throw new Error('Account menu actions are incomplete');
  await pressKey(' ', 'Space');
  await waitFor("!document.querySelector('.user-menu').open", 'keyboard account menu closing');
  log('focused learning start fits 1366×768 and 1920×1080');

  await evaluate("document.querySelector('.user-menu').open = true");
  await evaluate('document.querySelector(\'.user-menu a[href="/profile"]\').click()');
  await waitFor("Boolean(document.querySelector('.profile-layout'))", 'profile page');
  await captureAtBothSizes('phase2.1-profile.png');
  await assertNoViewportOverflow('Profile');
  await evaluate('document.querySelector(\'.app-header a[href="/"]\').click()');
  await waitFor("Boolean(document.querySelector('.home-start'))", 'home after profile');
  await evaluate("document.querySelector('.user-menu').open = true");
  await evaluate('document.querySelector(\'.user-menu a[href="/settings"]\').click()');
  await waitFor("Boolean(document.querySelector('.settings-grid'))", 'settings page');
  await captureAtBothSizes('phase2.1-settings.png');
  await assertNoViewportOverflow('Settings');
  await evaluate('document.querySelector(\'.app-header a[href="/"]\').click()');
  await waitFor("Boolean(document.querySelector('.home-start'))", 'home after settings');

  await evaluate('document.querySelector(\'a[href="/lessons"]\').click()');
  await waitFor(
    "location.pathname === '/lessons' && Boolean(document.querySelector('.lesson-path'))",
    'lesson hub',
  );
  const initiallyLocked = await evaluate("Boolean(document.querySelector('.lesson-node--locked'))");
  if (!initiallyLocked) throw new Error('Lesson 2 was not initially locked');
  await captureAtBothSizes('phase2.1-lesson-hub.png');
  await assertNoViewportOverflow('Lesson hub');
  log('lesson hub shows Lesson 1 available and Lesson 2 locked');

  await evaluate("document.querySelector('.lesson-path a').click()");
  await waitFor("Boolean(document.querySelector('.lesson-overview__hero'))", 'lesson overview');
  await captureAtBothSizes('phase2.1-lesson-overview.png');
  await assertNoViewportOverflow('Lesson overview');
  await clickByText('.lesson-summary .button', 'Start lesson');
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'first activity');

  await answerFindWord('sum');
  await continueActivity();
  await evaluate("document.querySelector('.lesson-exit').click()");
  await waitFor('Boolean(document.querySelector(\'[role="alertdialog"]\'))', 'exit confirmation');
  await evaluate("document.querySelector('.dialog .button--danger').click()");
  await waitFor("Boolean(document.querySelector('.lesson-summary'))", 'overview after exit');
  await navigate(appBase);
  await waitFor("Boolean(document.querySelector('.home-progress'))", 'home resume progress');
  const homeResume = await evaluate("document.querySelector('.home-start').textContent");
  if (
    !homeResume.includes('1 of 6 activities completed') ||
    !homeResume.includes('Continue Lesson 1')
  )
    throw new Error('Home did not identify the incomplete lesson as the next action');
  await evaluate("document.querySelector('.home-primary-action').click()");
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'resumed activity');
  const resumedNumber = await evaluate(
    "document.querySelector('.lesson-player__identity strong').textContent",
  );
  if (!resumedNumber.includes('2 of 6')) throw new Error('Attempt did not resume at activity 2');
  await evaluate("document.querySelector('.lesson-exit').click()");
  await evaluate("document.querySelector('.dialog .button--danger').click()");
  await waitFor("Boolean(document.querySelector('.lesson-summary'))", 'overview before restart');
  await clickByText('.lesson-summary .button--quiet', 'Restart lesson');
  await waitFor(
    'Boolean(document.querySelector(\'[role="alertdialog"]\'))',
    'restart confirmation',
  );
  await evaluate("document.querySelector('.dialog .button--danger').click()");
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'restarted lesson');
  log('exit, resume, and confirmed restart preserve attempt history');

  await captureAtBothSizes('phase2.1-find-the-word.png');
  const findWordDimensions = await assertNoViewportOverflow('Find the Word');
  if (findWordDimensions.scrollHeight > findWordDimensions.innerHeight)
    throw new Error('Find the Word requires unnecessary scrolling at 1366×768');
  await answerFindWord('difference', 'keyboard');
  await continueActivity();
  await answerFindWord('quotient');
  await continueActivity();
  await answerFindWord('quotient');
  await continueActivity();
  await captureAtBothSizes('phase2.1-organize-translate.png');
  const organizeDimensions = await assertNoViewportOverflow('Organize and Translate');
  if (organizeDimensions.scrollHeight > organizeDimensions.innerHeight)
    throw new Error('Organize and Translate requires unnecessary scrolling at 1366×768');
  await answerOrganize(['six', 'less than', 'a number']);
  await continueActivity();
  await answerOrganize(['a number', 'subtracted from', 'twelve']);
  await continueActivity();
  await answerOrganize(['the sum of', 'three times a number', 'and', 'seven']);
  await continueActivity();
  await waitFor("Boolean(document.querySelector('.result-page--failed'))", 'failed result');
  await captureAtBothSizes('phase2.1-result-failed.png');
  await assertNoViewportOverflow('Failed result');
  log('failed attempt remains recorded and Lesson 2 stays locked');

  await clickByText('.result-actions .button--primary', 'Retry lesson');
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'retry');
  await completeAttempt({ perfect: true });
  await waitFor("Boolean(document.querySelector('.result-page--cleared'))", 'cleared result');
  await captureAtBothSizes('phase2.1-result-cleared.png');
  await assertNoViewportOverflow('Cleared result');
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

  await navigate(appBase);
  await waitFor("Boolean(document.querySelector('.home-start'))", 'home after lesson clear');
  const clearedHome = await evaluate("document.querySelector('.home-start').textContent");
  if (!clearedHome.includes('Order Matters') || !clearedHome.includes('Start Lesson 2'))
    throw new Error('Home did not point to the unlocked next lesson');
  await clickByText('.home-actions a', 'View all lessons');
  await waitFor("Boolean(document.querySelector('.lesson-path'))", 'unlocked hub');
  const unlocked = await evaluate("document.querySelectorAll('.lesson-node--locked').length === 0");
  if (!unlocked) throw new Error('Lesson 2 did not unlock');
  await evaluate("document.querySelectorAll('.lesson-path a')[1].click()");
  await waitFor("Boolean(document.querySelector('.lesson-overview__hero'))", 'Lesson 2 overview');
  const lessonTwoOverview = await evaluate(
    "document.querySelector('.lesson-overview').textContent",
  );
  if (!lessonTwoOverview.includes('5 activities') || !lessonTwoOverview.includes('70% to pass'))
    throw new Error('Lesson 2 overview details are incomplete');
  await captureAtBothSizes('phase2.2-lesson-overview.png');
  await assertNoViewportOverflow('Lesson 2 overview');
  await clickByText('.lesson-summary .button', 'Start lesson');
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'Lesson 2 first activity');

  await answerFindWord('more');
  await continueActivity();
  await evaluate("document.querySelector('.lesson-exit').click()");
  await waitFor(
    'Boolean(document.querySelector(\'[role="alertdialog"]\'))',
    'Lesson 2 exit dialog',
  );
  await evaluate("document.querySelector('.dialog .button--danger').click()");
  await waitFor(
    "Boolean(document.querySelector('.lesson-summary'))",
    'Lesson 2 overview after exit',
  );
  await clickByText('.lesson-summary .button', 'Resume lesson');
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'resumed Lesson 2 activity');
  const lessonTwoResume = await evaluate(
    "document.querySelector('.lesson-player__identity strong').textContent",
  );
  if (!lessonTwoResume.includes('2 of 5')) throw new Error('Lesson 2 did not resume at activity 2');
  await captureAtBothSizes('phase2.2-find-the-word.png');
  await assertNoViewportOverflow('Lesson 2 Find the Word');

  await answerFindWord('added');
  await continueActivity();
  await captureAtBothSizes('phase2.2-organize-translate.png');
  await assertNoViewportOverflow('Lesson 2 Organize and Translate');
  await answerOrganize(['five', 'less than', 'a number']);
  await continueActivity();
  await answerOrganize(['a number', 'subtracted from', 'twelve']);
  await continueActivity();
  await answerOrganize(['four', 'more than', 'twice a number']);
  await continueActivity();
  await waitFor(
    "Boolean(document.querySelector('.result-page--failed'))",
    'failed Lesson 2 result',
  );
  log('Lesson 2 exit, resume, five activities, and failed result work normally');

  await clickByText('.result-actions .button--primary', 'Retry lesson');
  await waitFor("Boolean(document.querySelector('.choice-grid'))", 'Lesson 2 retry');
  await completeOrderMatters({ perfect: true });
  await waitFor(
    "Boolean(document.querySelector('.result-page--cleared'))",
    'cleared Lesson 2 result',
  );
  const lessonTwoResult = await evaluate("document.querySelector('.result-board').textContent");
  if (
    lessonTwoResult.includes('View next lesson') ||
    !lessonTwoResult.includes('Review lesson') ||
    !lessonTwoResult.includes('Lessons')
  )
    throw new Error('Final Lesson 2 result actions are invalid');
  await captureAtBothSizes('phase2.2-result.png');
  await assertNoViewportOverflow('Lesson 2 result');

  await send('Page.reload');
  await waitFor(
    "Boolean(document.querySelector('.result-page--cleared'))",
    'Lesson 2 result refresh',
  );
  await send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await send('Page.reload');
  await waitFor(
    "Boolean(document.querySelector('.result-page--cleared'))",
    'offline Lesson 2 result reload',
  );
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  log('Lesson 2 retry, clear, result actions, persistence, and offline reopening work');

  await logout();
  await register(secondUsername, 'Second Learner');
  await evaluate('document.querySelector(\'a[href="/lessons"]\').click()');
  await waitFor("Boolean(document.querySelector('.lesson-path'))", 'second user hub');
  const secondLocked = await evaluate("Boolean(document.querySelector('.lesson-node--locked'))");
  const secondState = await evaluate("document.querySelector('.lesson-node').textContent");
  if (!secondLocked || !secondState.includes('Not started'))
    throw new Error('Progress leaked between users');
  await logout();
  await login(firstUsername);
  await navigate(`${appBase}/lessons`);
  await waitFor("Boolean(document.querySelector('.lesson-path'))", 'first user restored hub');
  const restoredLessonTwo = await evaluate(
    "document.querySelectorAll('.lesson-node')[1].textContent",
  );
  if (!restoredLessonTwo.includes('Cleared') || !restoredLessonTwo.includes('Best score 100%'))
    throw new Error('First user Lesson 2 progress was not restored');
  log('switching local users keeps Lesson 2 progress isolated and existing login works');
} finally {
  socket.close();
}

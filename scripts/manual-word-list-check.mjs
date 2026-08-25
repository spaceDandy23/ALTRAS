import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const debugBase = 'http://127.0.0.1:9223';
const appBase = 'http://127.0.0.1:4173';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDirectory = path.join(root, 'artifacts');
const username = `word_list_${Date.now()}`;
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
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
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

async function setInput(selector, value) {
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function keyboardActivate(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function assertNoHorizontalOverflow(label) {
  const dimensions = await evaluate(`({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  if (dimensions.scrollWidth > dimensions.innerWidth) {
    throw new Error(`${label} has horizontal overflow`);
  }
}

async function capture(name, width, height) {
  await setViewport(width, height);
  await evaluate('window.scrollTo(0, 0)');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await assertNoHorizontalOverflow(`${width}x${height} Word list`);
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(path.join(artifactDirectory, name), Buffer.from(data, 'base64'));
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
  await setViewport(1366, 768);

  await navigate(`${appBase}/register`);
  await waitFor("Boolean(document.querySelector('form'))", 'registration form');
  await setInput('[autocomplete="name"]', 'Word List Reader');
  await setInput('[autocomplete="username"]', username);
  const passwords = await evaluate(`(() => {
    const fields = document.querySelectorAll('[autocomplete="new-password"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const field of fields) {
      setter.call(field, ${JSON.stringify(password)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return fields.length;
  })()`);
  if (passwords !== 2) throw new Error('Registration password fields are unavailable');
  await evaluate("document.querySelector('form').requestSubmit()");
  await waitFor(
    "location.pathname === '/' && Boolean(document.querySelector('.home-start'))",
    'registration',
  );

  const unexpectedHomeLinks = await evaluate(
    'document.querySelectorAll(\'a[href*="almanac"], a[href*="word-list"]\').length',
  );
  if (unexpectedHomeLinks !== 0) throw new Error('Almanac navigation leaked onto Home');
  await keyboardActivate('a[href="/lessons"]');
  await waitFor(
    "location.pathname === '/lessons' && Boolean(document.querySelector('.lesson-path'))",
    'lesson hub from Home',
  );
  await keyboardActivate('.lesson-hub__tools a[href="/lessons/almanac"]');
  await waitFor(
    "location.pathname === '/lessons/almanac' && Boolean(document.querySelector('.almanac-page'))",
    'Almanac from lesson hub',
  );
  if (
    (await evaluate("document.querySelector('.back-link').getAttribute('href')")) !== '/lessons'
  ) {
    throw new Error('Almanac does not return to Lessons');
  }
  const almanacState = await evaluate(`({
    comingNext: document.querySelector('.almanac-option--disabled')?.textContent,
    reviewLinks: document.querySelectorAll('a[href="/lessons/almanac/review"]').length,
    wordListLinks: document.querySelectorAll('a[href="/lessons/almanac/word-list"]').length
  })`);
  if (
    !almanacState.comingNext?.includes('Review') ||
    !almanacState.comingNext?.includes('Coming next') ||
    almanacState.reviewLinks !== 0 ||
    almanacState.wordListLinks !== 1
  ) {
    throw new Error('Almanac tool availability is incorrect');
  }
  await capture('phase2.3-almanac.png', 1366, 768);
  await capture('phase2.3-almanac-1920x1080.png', 1920, 1080);
  await keyboardActivate('a[href="/lessons/almanac/word-list"]');
  await waitFor(
    "location.pathname === '/lessons/almanac/word-list' && Boolean(document.querySelector('.word-list-page'))",
    'Word list from Almanac',
  );
  if (
    (await evaluate("document.querySelector('.back-link').getAttribute('href')")) !==
    '/lessons/almanac'
  ) {
    throw new Error('Word list does not return to Almanac');
  }
  log('Lessons → Almanac → Word list keyboard hierarchy works');

  await evaluate("document.querySelector('.word-list-search input').focus()");
  const visibleFocus = await evaluate(`(() => {
    const style = getComputedStyle(document.querySelector('.word-list-search input'));
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  })()`);
  if (!visibleFocus) throw new Error('Search focus is not visibly indicated');
  await setInput('.word-list-search input', '  SUBTRACTED FROM  ');
  await waitFor(
    "document.querySelectorAll('.word-list-group').length === 1 && Boolean(document.querySelector('.word-list-group--subtraction'))",
    'trimmed case-insensitive search',
  );
  const warningText = await evaluate(
    "document.querySelector('.word-list-guidance--warning').textContent",
  );
  if (!warningText.includes('n − 6') || !warningText.includes('12 − n')) {
    throw new Error('Order-sensitive guidance is incomplete');
  }
  await setInput('.word-list-search input', '');
  await waitFor("document.querySelectorAll('.word-list-group').length === 4", 'cleared search');
  log('search, trimming, case normalization, clearing, and visible focus work');

  await capture('phase2.3-word-list.png', 1366, 768);
  await capture('phase2.3-word-list-1920x1080.png', 1920, 1080);
  log('Word list has no horizontal overflow at both target sizes');

  await keyboardActivate('.back-link');
  await waitFor(
    "location.pathname === '/lessons/almanac' && Boolean(document.querySelector('.almanac-page'))",
    'Almanac return',
  );
  await keyboardActivate('.back-link');
  await waitFor(
    "location.pathname === '/lessons' && Boolean(document.querySelector('.lesson-path'))",
    'Lessons return',
  );
  log('Word list and Almanac return to their intended parent screens');

  await navigate(`${appBase}/lessons/almanac/word-list`);
  await waitFor("Boolean(document.querySelector('.word-list-page'))", 'direct Word list route');
  await send('Page.reload');
  await waitFor("Boolean(document.querySelector('.word-list-page'))", 'direct route refresh');
  if (
    (await evaluate("document.querySelector('.back-link').getAttribute('href')")) !==
    '/lessons/almanac'
  ) {
    throw new Error('Direct Word list route does not return to Almanac');
  }
  await waitFor('navigator.serviceWorker?.controller !== null', 'service worker control');
  await send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await send('Page.reload');
  await waitFor("Boolean(document.querySelector('.word-list-page'))", 'offline Word list reload');
  await setInput('.word-list-search input', 'ratio');
  await waitFor("Boolean(document.querySelector('.word-list-group--division'))", 'offline search');
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  log('direct refresh, session restoration, offline reopening, and offline search work');
} finally {
  socket.close();
}

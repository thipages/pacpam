import { Peer } from 'peerjs';
import { hashPassword } from '../../../src/core/auth.js';
import { TestDriver } from './test-driver.js';
import { TRANSITIONS, byKey, STATE_ORDER, HAPPY_EVENTS } from './transition-ids.js';

export const coveredIds = new Set();
const scenarioResults = [];

let counter = 0;
function uniqueAppId() {
  return `tpjs-${Date.now()}-${counter++}`;
}

function collectIds(...drivers) {
  const ids = new Set();
  for (const d of drivers) {
    for (const name of d.chatNames()) {
      for (const t of d.transitions(name)) {
        const tid = byKey.get(`${t.from}:${t.event}`);
        if (tid) ids.add(tid.id);
      }
    }
  }
  return ids;
}

function addCovered(ids) {
  for (const id of ids) coveredIds.add(id);
}

function idNum(id) {
  return parseInt(id.slice(1), 10);
}

function formatIds(ids) {
  return [...ids].sort((a, b) => idNum(a) - idNum(b)).map(id => `#${id}`).join(' ');
}

export default {
  name: 'Couverture PeerJS',
  run: peerjsCoverage,
  render: renderPeerDiagram
};

async function peerjsCoverage(driver, log) {
  await normalFlow(log);
  await peerUnavailable(log);
  await authFailed(log);
  await idTaken(log);
  await disconnectReady(log);
  await disconnectConnecting(log);
  await disconnectAuthenticating(log);
  await authTimeout(log);
  await closeAuthenticating(log);
  await pingTimeout(log);

  log('step', 'Bilan');
  log('pass', `${coveredIds.size} transitions couvertes via PeerJS`);
}

// #c1 #c2 #c6 #c7 #c12 #c18 #c25 #c30
async function normalFlow(log) {
  log('step', 'Flux normal');
  const d = new TestDriver(uniqueAppId(), 'secret', { rawAppId: true });
  try {
    const alice = d.createChat('ALICE');
    const bob = d.createChat('BOB');
    alice.start();
    bob.start();
    await Promise.all([
      d.waitForState('ALICE', 'READY'),
      d.waitForState('BOB', 'READY')
    ]);

    const waitConn = Promise.all([
      d.waitForState('ALICE', 'CONNECTED'),
      d.waitForState('BOB', 'CONNECTED')
    ]);
    bob.connectTo(alice.peerId);
    await waitConn;

    const bobRecv = d.waitForMessage('BOB');
    alice.send({ type: 'chat', text: 'hi', from: 'ALICE' });
    await bobRecv;

    const aliceRecv = d.waitForMessage('ALICE');
    bob.send({ type: 'chat', text: 'hi', from: 'BOB' });
    await aliceRecv;

    const waitDisc = Promise.all([
      d.waitForState('BOB', 'IDLE'),
      d.waitForState('ALICE', 'READY')
    ]);
    bob.disconnect();
    await waitDisc;

    const ids = collectIds(d);
    addCovered(ids);
    scenarioResults.push({ name: 'Flux normal', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    d.cleanup();
  }
}

// #c14 (ou #c13 si timeout)
async function peerUnavailable(log) {
  log('step', 'Peer inexistant');
  const d = new TestDriver(uniqueAppId(), 'secret', { rawAppId: true });
  try {
    const bob = d.createChat('BOB');
    bob.start();
    await d.waitForState('BOB', 'READY');

    bob.connectTo('NOBODY');
    // BOB passe synchroniquement en CONNECTING, puis revient en READY via PEER_UNAVAILABLE
    await d.waitForState('BOB', 'READY');

    const ids = collectIds(d);
    addCovered(ids);
    scenarioResults.push({ name: 'Peer inexistant', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    d.cleanup();
  }
}

// #c19 (+ potentiellement #c21 sur l'autre pair)
async function authFailed(log) {
  log('step', 'Mauvais mot de passe');
  const appId = uniqueAppId();
  const dA = new TestDriver(appId, 'passA', { rawAppId: true });
  const dB = new TestDriver(appId, 'passB', { rawAppId: true });
  try {
    const alice = dA.createChat('ALICE');
    const bob = dB.createChat('BOB');
    alice.start();
    bob.start();
    await Promise.all([
      dA.waitForState('ALICE', 'READY'),
      dB.waitForState('BOB', 'READY')
    ]);

    bob.connectTo('ALICE');

    // Attendre que les deux atteignent AUTHENTICATING
    await Promise.all([
      dA.waitForState('ALICE', 'AUTHENTICATING'),
      dB.waitForState('BOB', 'AUTHENTICATING')
    ]);

    // Attendre que les deux reviennent en READY après l'échec
    await Promise.all([
      dA.waitForState('ALICE', 'READY'),
      dB.waitForState('BOB', 'READY')
    ]);

    const ids = collectIds(dA, dB);
    addCovered(ids);
    scenarioResults.push({ name: 'Mauvais mot de passe', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    dA.cleanup();
    dB.cleanup();
  }
}

// #c3
async function idTaken(log) {
  log('step', 'ID déjà pris');
  const appId = uniqueAppId();
  const d1 = new TestDriver(appId, 'secret', { rawAppId: true });
  const d2 = new TestDriver(appId, 'secret', { rawAppId: true });
  try {
    const alice1 = d1.createChat('ALICE');
    alice1.start();
    await d1.waitForState('ALICE', 'READY');

    // Même PeerJS ID → ID_UNAVAILABLE
    d2.createChat('ALICE');
    d2.chat('ALICE').start();
    await d2.waitForState('ALICE', 'IDLE');

    const ids = collectIds(d2);
    addCovered(ids);
    scenarioResults.push({ name: 'ID déjà pris', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    d1.cleanup();
    d2.cleanup();
  }
}

// #c11
async function disconnectReady(log) {
  log('step', 'Disconnect depuis READY');
  const d = new TestDriver(uniqueAppId(), 'secret', { rawAppId: true });
  try {
    const alice = d.createChat('ALICE');
    alice.start();
    await d.waitForState('ALICE', 'READY');

    alice.disconnect();
    await d.waitForState('ALICE', 'IDLE');

    const ids = collectIds(d);
    addCovered(ids);
    scenarioResults.push({ name: 'Disconnect READY', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    d.cleanup();
  }
}

// #c17
async function disconnectConnecting(log) {
  log('step', 'Disconnect depuis CONNECTING');
  const d = new TestDriver(uniqueAppId(), 'secret', { rawAppId: true });
  try {
    const alice = d.createChat('ALICE');
    const bob = d.createChat('BOB');
    alice.start();
    bob.start();
    await Promise.all([
      d.waitForState('ALICE', 'READY'),
      d.waitForState('BOB', 'READY')
    ]);

    // connectTo est synchrone côté SM → BOB passe en CONNECTING immédiatement
    bob.connectTo(alice.peerId);
    // disconnect immédiat avant que la connexion WebRTC ne s'ouvre
    bob.disconnect();
    await d.waitForState('BOB', 'IDLE');

    const ids = collectIds(d);
    addCovered(ids);
    scenarioResults.push({ name: 'Disconnect CONNECTING', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    d.cleanup();
  }
}

// #c24
async function disconnectAuthenticating(log) {
  log('step', 'Disconnect depuis AUTHENTICATING');
  const d = new TestDriver(uniqueAppId(), 'secret', { rawAppId: true });
  try {
    const alice = d.createChat('ALICE');
    const bob = d.createChat('BOB');
    alice.start();
    bob.start();
    await Promise.all([
      d.waitForState('ALICE', 'READY'),
      d.waitForState('BOB', 'READY')
    ]);

    bob.connectTo(alice.peerId);
    await d.waitForState('BOB', 'AUTHENTICATING');
    bob.disconnect();
    await d.waitForState('BOB', 'IDLE');

    const ids = collectIds(d);
    addCovered(ids);
    scenarioResults.push({ name: 'Disconnect AUTHENTICATING', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    d.cleanup();
  }
}

// #c20
async function authTimeout(log) {
  log('step', 'Auth timeout');
  const appId = uniqueAppId();
  // Peer brut qui ne répond pas à l'auth
  const targetId = `${appId}-TARGET`;
  const rawPeer = new Peer(targetId);
  await new Promise((resolve, reject) => {
    rawPeer.on('open', resolve);
    rawPeer.on('error', reject);
  });

  // BOB avec authTimeout court
  const d = new TestDriver(appId, 'secret', {
    rawAppId: true,
    chatOptions: { networkOptions: { authTimeout: 500 } }
  });
  try {
    const bob = d.createChat('BOB');
    bob.start();
    await d.waitForState('BOB', 'READY');

    // Connecter à TARGET (peer brut, pas de réponse auth)
    bob.connectTo('TARGET');
    await d.waitForState('BOB', 'AUTHENTICATING');
    // Le timeout se déclenche car TARGET ne répond jamais
    await d.waitForState('BOB', 'READY');

    const ids = collectIds(d);
    addCovered(ids);
    scenarioResults.push({ name: 'Auth timeout', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    rawPeer.destroy();
    d.cleanup();
  }
}

// #c21
async function closeAuthenticating(log) {
  log('step', 'Close pendant AUTHENTICATING');
  const appId = uniqueAppId();
  // Peer brut qui ferme la connexion dès qu'elle s'ouvre
  const targetId = `${appId}-TARGET`;
  const rawPeer = new Peer(targetId);
  await new Promise((resolve, reject) => {
    rawPeer.on('open', resolve);
    rawPeer.on('error', reject);
  });
  rawPeer.on('connection', conn => {
    conn.on('open', () => conn.close());
  });

  const d = new TestDriver(appId, 'secret', { rawAppId: true });
  try {
    const bob = d.createChat('BOB');
    bob.start();
    await d.waitForState('BOB', 'READY');

    bob.connectTo('TARGET');
    await d.waitForState('BOB', 'AUTHENTICATING');
    // TARGET ferme la connexion → CLOSE → READY
    await d.waitForState('BOB', 'READY');

    const ids = collectIds(d);
    addCovered(ids);
    scenarioResults.push({ name: 'Close AUTHENTICATING', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    rawPeer.destroy();
    d.cleanup();
  }
}

// #c26
async function pingTimeout(log) {
  log('step', 'Ping timeout');
  const appId = uniqueAppId();
  const password = 'secret';
  const hash = await hashPassword(password);

  // Raw peer qui répond à l'auth mais ignore les pings
  const targetId = `${appId}-TARGET`;
  const rawPeer = new Peer(targetId);
  await new Promise((resolve, reject) => {
    rawPeer.on('open', resolve);
    rawPeer.on('error', reject);
  });
  rawPeer.on('connection', conn => {
    conn.on('data', data => {
      if (data.type === 'auth') {
        conn.send({ type: 'auth', hash, name: 'TARGET', timestamp: Date.now() });
      }
      // Ignore pings — pas de réponse pong
    });
  });

  // BOB avec ping/pong très courts
  const d = new TestDriver(appId, password, {
    rawAppId: true,
    chatOptions: { networkOptions: { pingInterval: 50, pongTimeout: 100 } }
  });
  try {
    const bob = d.createChat('BOB');
    bob.start();
    await d.waitForState('BOB', 'READY');

    bob.connectTo('TARGET');
    await d.waitForState('BOB', 'CONNECTED');
    // Pings sans réponse → PING_TIMEOUT → READY
    await d.waitForState('BOB', 'READY');

    const ids = collectIds(d);
    addCovered(ids);
    scenarioResults.push({ name: 'Ping timeout', ids: [...ids] });
    log('pass', formatIds(ids));
  } finally {
    rawPeer.destroy();
    d.cleanup();
  }
}

// Transitions non testables via PeerJS (erreurs réseau, timeouts internes)
const UNTESTABLE_IDS = new Set(['c4', 'c5', 'c8', 'c9', 'c10', 'c13', 'c15', 'c16', 'c22', 'c23', 'c27', 'c28', 'c29']);

function classFor(id) {
  if (coveredIds.has(id)) return 'peerjs';
  return 'untestable';
}

function renderPeerDiagram(container) {
  const untestableCount = UNTESTABLE_IDS.size;

  // Légende
  const legend = document.createElement('div');
  legend.className = 'sm-legend';
  legend.innerHTML = `<span class="sm-legend-item peerjs">\u2713 PeerJS (${coveredIds.size})</span><span class="sm-legend-item untestable">\u2717 Non testable (${untestableCount})</span>`;
  container.appendChild(legend);

  // Index des transitions par état source
  const byState = new Map();
  for (const t of TRANSITIONS) {
    if (!byState.has(t.from)) byState.set(t.from, []);
    byState.get(t.from).push(t);
  }

  const el = document.createElement('div');
  el.className = 'sm-timeline';

  for (let i = 0; i < STATE_ORDER.length; i++) {
    const state = STATE_ORDER[i];
    const transitions = byState.get(state) || [];
    const happyEvent = HAPPY_EVENTS[state];

    const node = document.createElement('div');
    node.className = 'sm-node';

    const name = document.createElement('div');
    name.className = 'sm-node-name';
    name.textContent = state;
    node.appendChild(name);

    for (const t of transitions) {
      if (t.event === happyEvent) continue;
      const cls = classFor(t.id);
      const dev = document.createElement('div');
      dev.className = `sm-dev ${cls}`;
      const selfLoop = t.from === t.to;
      const label = selfLoop ? `${t.event} \u21BA` : `${t.event} \u2192 ${t.to}`;
      dev.textContent = `#${t.id} ${label}`;
      node.appendChild(dev);
    }

    el.appendChild(node);

    const happyTransition = transitions.find(t => t.event === happyEvent);
    if (happyTransition) {
      const cls = classFor(happyTransition.id);
      const arrow = document.createElement('div');
      arrow.className = 'sm-arrow';
      arrow.innerHTML = `<span class="sm-arrow-line ${cls}">\u2502</span><span class="sm-arrow-label ${cls}">#${happyTransition.id} ${happyEvent}</span><span class="sm-arrow-line ${cls}">\u25BC</span>`;
      el.appendChild(arrow);
    }
  }

  container.appendChild(el);
}

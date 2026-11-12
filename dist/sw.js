const SHELL_CACHE = 'equicoach-shell-v6';
const STATE_CACHE = 'equicoach-pwa-state-v1';
const ENTRY_ANALYSIS_SAVED = '/__pwa-state/entry-analysis-saved';
const AI_QUEUE_DB = 'equicoach-ai-queue';
const AI_QUEUE_STORE = 'requests';
const AI_QUEUE_SYNC_TAG = 'equicoach-ai-queue';
let queueProcessing;
const APP_SHELL = [
  '/',
  '/index.html',
  '/profile.html',
  '/appcoach.html',
  '/equicoach.html',
  '/manifest.json',
  '/css/main.css',
  '/css/app.css',
  '/css/coach.css',
  '/css/form.css',
  '/js/pwa.js',
  '/js/app.js',
  '/js/form.js',
  '/js/modules/coach.js',
  '/js/modules/metadata.js',
  '/js/modules/ridetracking.js',
  '/img/logo.png',
  '/img/icons/appstore-images/ios/32.png',
  '/img/icons/appstore-images/ios/180.png',
  '/img/icons/appstore-images/android/launchericon-192x192.png',
  '/img/icons/appstore-images/android/launchericon-512x512.png'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith('equicoach-shell-') && name !== SHELL_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ENTRY_ANALYSIS_SAVED') {
    event.waitUntil((async () => {
      const cache = await caches.open(STATE_CACHE);
      await cache.put(
        new Request(new URL(ENTRY_ANALYSIS_SAVED, self.location.origin)),
        new Response('saved', { headers: { 'Content-Type': 'text/plain' } })
      );
      event.ports[0]?.postMessage({ saved: true });
    })());
    return;
  }

  if (event.data?.type === 'GET_AI_QUEUE') {
    event.waitUntil((async () => {
      const records = await getQueueRecords();
      event.ports[0]?.postMessage({
        type: 'AI_QUEUE_STATE',
        records: records.map(toPublicQueueRecord)
      });
    })());
    return;
  }

  if (event.data?.type === 'AI_REQUEST_ACK') {
    event.waitUntil(deleteQueueRecord(event.data.id));
    return;
  }

  if (event.data?.type === 'PROCESS_AI_QUEUE') {
    event.waitUntil((async () => {
      await processAIQueue();
      event.ports[0]?.postMessage({ type: 'AI_QUEUE_PROCESSED' });
    })());
  }
});

self.addEventListener('sync', event => {
  if (event.tag === AI_QUEUE_SYNC_TAG) {
    event.waitUntil(processAIQueue());
  }
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/coach' && event.request.method === 'POST') {
    event.respondWith(handleCoachRequest(event.request, event.clientId));
    return;
  }

  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event.request, url));
    return;
  }

  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
  }
});

async function handleNavigation(request, url) {
  if (url.pathname === '/profile.html') {
    const stateCache = await caches.open(STATE_CACHE);
    const saved = await stateCache.match(new Request(new URL(ENTRY_ANALYSIS_SAVED, self.location.origin)));
    if (saved) return Response.redirect(new URL('/appcoach.html', self.location.origin), 302);
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cache = await caches.open(SHELL_CACHE);
    const cachedPage = await cache.match(request) || await cache.match(url.pathname);
    if (cachedPage) return cachedPage;
    return new Response('Diese Seite ist offline nicht verfügbar.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function handleCoachRequest(request, clientId) {
  try {
    if (self.navigator.onLine === false) {
      return await queueCoachRequest(request, clientId);
    }
    return await fetch(request.clone());
  } catch (error) {
    return queueCoachRequest(request, clientId);
  }
}

async function queueCoachRequest(request, clientId) {
  try {
    const body = await request.clone().text();
    const parsedBody = JSON.parse(body);
    const record = {
      url: request.url,
      method: request.method,
      headers: Array.from(request.headers.entries()),
      body,
      question: typeof parsedBody.question === 'string' ? parsedBody.question : '',
      clientId,
      createdAt: Date.now(),
      status: 'pending'
    };
    const id = await addQueueRecord(record);
    await notifyClient(clientId, {
      type: 'AI_REQUEST_QUEUED',
      id,
      question: record.question
    });
    await scheduleQueueSync();
    return jsonResponse({
      queued: true,
      requestId: id,
      message: 'Die Anfrage wurde auf diesem Gerät gespeichert und wird bei Verbindung gesendet.'
    }, 202);
  } catch (error) {
    console.error('Die Offline-Anfrage konnte nicht gespeichert werden.', error);
    return jsonResponse({
      error: 'Die Anfrage konnte nicht lokal gespeichert werden. Bitte kopiere sie und versuche es erneut.'
    }, 503);
  }
}

function processAIQueue() {
  if (queueProcessing) return queueProcessing;
  queueProcessing = processPendingAIRequests().finally(() => {
    queueProcessing = null;
  });
  return queueProcessing;
}

async function processPendingAIRequests() {
  const records = await getQueueRecords();
  for (const record of records) {
    if (record.status !== 'pending') continue;

    let response;
    let responseBody;
    try {
      response = await fetch(new Request(record.url, {
        method: record.method,
        headers: new Headers(record.headers),
        body: record.body
      }));
      const responseText = await response.text();
      try {
        responseBody = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseBody = { error: 'Der KI-Endpunkt lieferte keine gültige JSON-Antwort.' };
      }
    } catch (error) {
      console.warn('Eine gespeicherte KI-Anfrage bleibt bis zum nächsten Verbindungsversuch in der Warteschlange.', error);
      await scheduleQueueSync();
      break;
    }

    const completed = {
      ...record,
      body: null,
      status: 'complete',
      result: { status: response.status, body: responseBody },
      completedAt: Date.now()
    };
    await updateQueueRecord(completed);
    await notifyClient(record.clientId, {
      type: 'AI_REQUEST_COMPLETE',
      ...toPublicQueueRecord(completed)
    });
  }
}

async function scheduleQueueSync() {
  if (!self.registration.sync) return;
  try {
    await self.registration.sync.register(AI_QUEUE_SYNC_TAG);
  } catch (error) {
    console.warn('Hintergrundsynchronisierung ist nicht verfügbar; die Anfrage wird beim nächsten Online-Aufruf gesendet.', error);
  }
}

function openQueueDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AI_QUEUE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(AI_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addQueueRecord(record) {
  const database = await openQueueDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AI_QUEUE_STORE, 'readwrite');
    const request = transaction.objectStore(AI_QUEUE_STORE).add(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getQueueRecords() {
  const database = await openQueueDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AI_QUEUE_STORE, 'readonly');
    const request = transaction.objectStore(AI_QUEUE_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function updateQueueRecord(record) {
  const database = await openQueueDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AI_QUEUE_STORE, 'readwrite');
    transaction.objectStore(AI_QUEUE_STORE).put(record);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function deleteQueueRecord(id) {
  const database = await openQueueDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AI_QUEUE_STORE, 'readwrite');
    transaction.objectStore(AI_QUEUE_STORE).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

function toPublicQueueRecord(record) {
  return {
    id: record.id,
    question: record.question,
    status: record.status,
    result: record.result || null
  };
}

async function notifyClient(clientId, message) {
  if (!clientId) return;
  const client = await self.clients.get(clientId);
  if (client) client.postMessage(message);
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

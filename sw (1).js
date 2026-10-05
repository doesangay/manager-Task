/* TaskFlow service worker: shows notifications and handles clicks.
   It also keeps a copy of the task summary so "periodic background sync"
   (installed PWAs on Chrome/Edge/Android) can remind you with the tab closed. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ---- tiny IndexedDB key/value store ----
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open('taskflow', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const kvGet = async k => {
  const d = await openDB();
  return new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
};
const kvSet = async (k, v) => {
  const d = await openDB();
  return new Promise(res => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); });
};

function buildNote(s) {
  const title = s.pending ? `${s.pending} task${s.pending === 1 ? '' : 's'} still pending` : 'All caught up';
  const body = (s.next ? `Next up: ${s.next}\n` : '') + `${s.done} of ${s.total} completed` + (s.overdue ? `, ${s.overdue} overdue` : '');
  return [title, {
    body,
    tag: 'taskflow-pending',
    renotify: true,
    requireInteraction: true,
    icon: s.icon || undefined,
    data: { url: './index.html?view=pending' },
    actions: [{ action: 'view', title: 'View pending' }, { action: 'dismiss', title: 'Dismiss' }]
  }];
}

// Page sends its latest summary here
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'state') e.waitUntil(kvSet('state', e.data.state));
});

async function remind() {
  const s = await kvGet('state');
  if (!s || s.muted || !s.pending) return;
  if (Date.now() - (s.last || 0) < s.interval * 60000) return;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (wins.some(w => w.visibilityState === 'visible' && w.focused)) return;
  s.last = Date.now();
  await kvSet('state', s);
  const [t, o] = buildNote(s);
  return self.registration.showNotification(t, o);
}

self.addEventListener('periodicsync', e => { if (e.tag === 'taskflow-reminder') e.waitUntil(remind()); });

// Ready for a real push server later
self.addEventListener('push', e => {
  e.waitUntil(kvGet('state').then(s => {
    const [t, o] = buildNote(s || { pending: 0, done: 0, total: 0 });
    return self.registration.showNotification(t, o);
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins[0];
      await w.focus();
      w.postMessage({ type: 'show-pending' });
    } else {
      await self.clients.openWindow((e.notification.data && e.notification.data.url) || './index.html?view=pending');
    }
  })());
});

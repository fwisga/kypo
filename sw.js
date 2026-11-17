// Service Worker untuk KYPO PWA Wrapper (v7)
// Menangani caching, streaming berkas share target ke Cache API (zero-memory overhead), dan penyajian instan share.html

var CACHE_NAME = 'kypo-cache-v7';
var PRECACHE_FILES = [
  './share.html',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico',
  './icon.svg'
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_FILES);
    }).catch(function(err) {
      console.warn('[KYPO SW] Precache warning:', err);
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME && cacheName !== 'kypo-shared-files') {
            console.log('[KYPO SW] Menghapus cache usang:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // Tangkap request HTTP POST dari Web Share Target Android
  if (req.method === 'POST') {
    event.respondWith((async function() {
      var files = [];
      var title = '';
      var text = '';

      try {
        var formData = await req.formData();
        
        // 1. Ekstrak berkas dari seluruh kemungkinan nama field Android
        var possibleKeys = ['files', 'file', 'media', 'photos', 'shared_files', 'files[]'];
        for (var k of possibleKeys) {
          var list = formData.getAll(k);
          if (list && list.length > 0) {
            for (var f of list) {
              if (f && (f.size > 0 || f.name || f instanceof Blob || (typeof File !== 'undefined' && f instanceof File))) {
                files.push(f);
              }
            }
          }
        }

        // 2. Jika belum ditemukan, periksa seluruh entri formData
        if (files.length === 0) {
          for (var entry of formData.entries()) {
            var val = entry[1];
            if (val && typeof val === 'object' && (val.size > 0 || val.name || val instanceof Blob || (typeof File !== 'undefined' && val instanceof File))) {
              files.push(val);
            }
          }
        }

        title = formData.get('title') || '';
        text = formData.get('text') || '';
      } catch (errForm) {
        console.error('[KYPO SW] Gagal membaca formData:', errForm);
      }

      // 3. Simpan berkas langsung ke Cache Storage 'kypo-shared-files' (Streaming murni, bebas OOM)
      try {
        var shareCache = await caches.open('kypo-shared-files');
        // Bersihkan berkas lama
        var oldKeys = await shareCache.keys();
        for (var oldK of oldKeys) {
          await shareCache.delete(oldK);
        }

        for (var i = 0; i < files.length; i++) {
          var fileItem = files[i];
          var fName = fileItem.name || ('Lampiran_' + (i + 1) + '.jpg');
          var fType = fileItem.type || 'application/octet-stream';
          var reqPath = '/__kypo_shared_file_' + i + '?name=' + encodeURIComponent(fName) + '&type=' + encodeURIComponent(fType) + '&size=' + fileItem.size + '&ts=' + Date.now();
          
          await shareCache.put(
            new Request(reqPath),
            new Response(fileItem, {
              headers: {
                'Content-Type': fType,
                'X-KYPO-Filename': encodeURIComponent(fName),
                'X-KYPO-Title': encodeURIComponent(title),
                'X-KYPO-Text': encodeURIComponent(text),
                'X-KYPO-Size': String(fileItem.size || 0)
              }
            })
          );
        }
      } catch (eCache) {
        console.error('[KYPO SW] Gagal menyimpan ke Cache Storage:', eCache);
      }

      // Cadangan ke IndexedDB
      try {
        await saveSharedFilesToIndexedDB(files, title, text);
      } catch (eIdb) {}

      // 4. Langsung layani share.html dengan status 200 OK dari cache (sangat ringan, <5ms)
      try {
        var cached = await caches.match('./share.html');
        if (cached) {
          return cached.clone();
        }
        var netRes = await fetch('./share.html');
        if (netRes && netRes.ok) {
          return netRes;
        }
      } catch (eServe) {
        console.warn('[KYPO SW] Serve share.html error:', eServe);
      }

      // Fallback redirect
      var targetUrl = new URL('share.html', self.location.href).href;
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' + targetUrl + '"></head><body><script>location.replace("' + targetUrl + '");<\/script></body></html>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
      );
    })());
    return;
  }

  // Permintaan GET standar
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) {
        fetch(req).then(function(networkRes) {
          if (networkRes && networkRes.status === 200 && req.method === 'GET' && url.origin === self.location.origin) {
            caches.open(CACHE_NAME).then(function(c) { c.put(req, networkRes); });
          }
        }).catch(function() {});
        return cached;
      }
      return fetch(req);
    }).catch(function() {
      if (req.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});

// Fungsi pembantu penyimpanan berkas sementara ke IndexedDB
function saveSharedFilesToIndexedDB(files, title, text) {
  return new Promise(function(resolve, reject) {
    try {
      var req = indexedDB.open('kypo_share_db', 1);
      
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('shared_files')) {
          db.createObjectStore('shared_files', { keyPath: 'id' });
        }
      };

      req.onsuccess = function(e) {
        var db = e.target.result;
        var tx = db.transaction('shared_files', 'readwrite');
        var store = tx.objectStore('shared_files');
        
        var safeList = [];
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          safeList.push({
            name: f.name || ('Lampiran_' + (i + 1) + '.jpg'),
            type: f.type || 'application/octet-stream',
            size: f.size || 0
          });
        }

        store.put({
          id: 'latest_share',
          timestamp: Date.now(),
          files: safeList,
          title: title || '',
          text: text || ''
        });

        tx.oncomplete = function() {
          db.close();
          resolve();
        };
        tx.onerror = function(err) {
          db.close();
          reject(err);
        };
      };

      req.onerror = function(err) {
        reject(err);
      };
    } catch(e) {
      reject(e);
    }
  });
}

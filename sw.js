// Service Worker untuk KYPO PWA Wrapper (v6)
// Menangani caching, penangkapan berkas multipart Android Share Target, dan injeksi instan ke share.html

var CACHE_NAME = 'kypo-cache-v6';
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
          if (cacheName !== CACHE_NAME && cacheName !== 'kypo-share-payload') {
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

// Helper aman konversi ArrayBuffer ke Base64 per chunk (menghindari stack overflow)
function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  var binary = '';
  var chunkSize = 0x8000; // 32KB per chunk
  for (var i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

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
        
        // 1. Ekstrak berkas dari seluruh kemungkinan nama field Android Share Target
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

        // 2. Jika belum ditemukan, periksa seluruh pasangan key-value di formData
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
        console.error('[KYPO SW] Gagal parse formData share target:', errForm);
      }

      // 3. Konversi seluruh berkas ke format aman Base64 & Data URL
      var safeFiles = [];
      if (files && files.length > 0) {
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          try {
            var buf = await f.arrayBuffer();
            var b64 = arrayBufferToBase64(buf);
            var mime = f.type || 'application/octet-stream';
            var dUrl = 'data:' + mime + ';base64,' + b64;
            safeFiles.push({
              name: f.name || ('Lampiran_Share_' + (i + 1) + (mime.includes('pdf') ? '.pdf' : '.jpg')),
              type: mime,
              size: f.size || buf.byteLength,
              base64: b64,
              dataUrl: dUrl
            });
          } catch(eBuf) {
            console.error('[KYPO SW] Gagal konversi arrayBuffer ke base64:', eBuf);
          }
        }
      }

      var sharePayload = {
        title: title || '',
        text: text || '',
        timestamp: Date.now(),
        files: safeFiles
      };

      // SALURAN REDUNDAN A: Simpan ke Cache API agar dapat diakses seketika via window.caches
      try {
        var shareCache = await caches.open('kypo-share-payload');
        await shareCache.put(
          new Request('/__kypo_latest_share__.json'),
          new Response(JSON.stringify(sharePayload), {
            headers: { 'Content-Type': 'application/json' }
          })
        );
      } catch(eCache) {}

      // SALURAN REDUNDAN B: Simpan ke IndexedDB
      try {
        await saveSharedFilesToIndexedDB(safeFiles, title, text);
      } catch(eIdb) {}

      // SALURAN UTAMA (0ms Latency): Ambil template share.html dan INJEKSIKAN payload langsung ke HTML!
      var targetHtml = '';
      try {
        var cached = await caches.match('./share.html');
        if (cached) {
          targetHtml = await cached.text();
        } else {
          var netRes = await fetch('./share.html');
          if (netRes && netRes.ok) {
            targetHtml = await netRes.text();
          }
        }
      } catch(eFetch) {}

      if (targetHtml) {
        // Injeksi data berkas langsung ke dalam variabel global di header share.html
        var injectionScript = '<script id="kypo-injected-data">window.__KYPO_INJECTED_SHARE__ = ' + JSON.stringify(sharePayload) + ';<\/script>';
        if (targetHtml.includes('</head>')) {
          targetHtml = targetHtml.replace('</head>', injectionScript + '</head>');
        } else {
          targetHtml = injectionScript + targetHtml;
        }

        return new Response(targetHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Fallback redirect jika pengambilan template gagal
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
        
        store.put({
          id: 'latest_share',
          timestamp: Date.now(),
          files: files,
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

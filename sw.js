// Service Worker untuk KYPO PWA Wrapper (v5)
// Menangani caching dan penangkapan Web Share Target API dari HP Android secara langsung tanpa redirect 303 yang rentan macet

var CACHE_NAME = 'kypo-cache-v5';
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
          if (cacheName !== CACHE_NAME) {
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
      try {
        var formData = await req.formData();
        var files = formData.getAll('files');
        if (!files || files.length === 0) {
          files = formData.getAll('shared_files');
        }
        if (!files || files.length === 0) {
          files = [];
          for (var entry of formData.entries()) {
            var val = entry[1];
            if (val && (val instanceof File || val instanceof Blob || (typeof val === 'object' && val.name))) {
              files.push(val);
            }
          }
        }
        var title = formData.get('title') || '';
        var text = formData.get('text') || '';
        
        if (files && files.length > 0) {
          // Konversi berkas ke struktur aman dengan ArrayBuffer agar tidak detached saat serialisasi IndexedDB
          var safeFiles = [];
          for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f instanceof Blob || f instanceof File) {
              try {
                var buf = await f.arrayBuffer();
                safeFiles.push({
                  name: f.name || ('Lampiran_Share_' + (i + 1) + '.jpg'),
                  type: f.type || 'application/octet-stream',
                  size: f.size || buf.byteLength,
                  buffer: buf
                });
              } catch (eBuf) {
                safeFiles.push(f);
              }
            } else {
              safeFiles.push(f);
            }
          }
          await saveSharedFilesToIndexedDB(safeFiles, title, text);
        }
      } catch (err) {
        console.error('[KYPO SW] Gagal mengekstrak berkas share target:', err);
      }
      
      // SOLUSI UTAMA ANTI-STUCK:
      // Sajikan halaman share.html langsung dengan status HTTP 200 OK!
      // Menghindari penggunaan Response.redirect(303) yang pada banyak varian Android WebAPK
      // sering digagalkan atau dialihkan paksa kembali ke start_url (index.html).
      try {
        var cached = await caches.match('./share.html');
        if (cached) {
          var cachedHtml = await cached.text();
          return new Response(cachedHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        var netRes = await fetch('./share.html');
        if (netRes && netRes.ok) {
          var netHtml = await netRes.text();
          return new Response(netHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
      } catch (eDirect) {
        console.warn('[KYPO SW] Direct share serve error, fallback to redirect:', eDirect);
      }

      // Fallback aman jika direct load gagal: respons HTML auto-replace seketika
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
        // Ambil dari cache dan update di background (stale-while-revalidate untuk aset lokal)
        fetch(req).then(function(networkRes) {
          if (networkRes && networkRes.status === 200 && req.method === 'GET' && url.origin === self.location.origin) {
            caches.open(CACHE_NAME).then(function(c) { c.put(req, networkRes); });
          }
        }).catch(function() {});
        return cached;
      }
      return fetch(req);
    }).catch(function() {
      // Jika offline dan permintaan berupa dokumen HTML, fallback ke share.html atau index.html
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

# Panduan Deployment Wrapper KYPO ke Netlify

Folder `wrapper` ini adalah website mandiri yang siap dideploy ke Netlify untuk aplikasi **KYPO - Keep your performance on fire!** (Sistem Informasi CKP BPS Kota Payakumbuh).

### Berkas di dalam folder ini:
1. `index.html` - Halaman wrapper responsif (iframe 100vh + splash screen loader KYPO bertema Deep Midnight Navy dengan logo baru KYPO dan api beranimasi hidup). Dilengkapi jembatan penangkap tombol Back Android (hardware/gesture back) dan pengiriman berkas Share Target ke Apps Script.
2. `sw.js` - Service Worker untuk Progressive Web App (PWA) dan penangkap HTTP POST Web Share Target API dari HP Android agar bebas dari error 404 Netlify.
3. `icon.svg` - Icon SVG resolusi tinggi dengan logo gabungan KYP dan api beresolusi tajam.
4. `icon-192.png` & `icon-512.png` - Icon PWA beresolusi tinggi (192px dan 512px) dengan desain rounded squircle elegan (logo gabungan KYP + api khas KYPO) untuk layar beranda Android, iOS, dan Desktop.
5. `favicon.ico` - Icon api khas KYPO untuk tab peramban.
6. `manifest.json` - Konfigurasi Progressive Web App (PWA) KYPO dengan Web Share Target API terintegrasi.
7. `_headers` & `_redirects` - Pengaturan header CORS, MIME Type otomatis, dan rewrite rule untuk Netlify.

---

### Cara Update / Re-Deploy ke Netlify (10 Detik):
1. Buka dashboard situs Anda di **[https://app.netlify.com](https://app.netlify.com)**.
2. Masuk ke situs KYPO yang sudah Anda buat sebelumnya di Netlify.
3. Klik tab **Deploys**.
4. Di bagian bawah terdapat kotak: **"Need to update your site? Drag and drop your site output folder here"**.
5. Tarik (*drag-and-drop*) seluruh folder **`wrapper`** ke kotak tersebut.
6. Netlify akan langsung memperbarui situs dalam beberapa detik.
7. Buka tautan Netlify Anda, dan splash screen beserta icon baru KYPO akan tampil modern, tajam, dan elegan!

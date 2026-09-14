# tribün360 V64 — Web + Vercel + Android APK

Bu repo tribün360 V63 ürün sürümünün dağıtım paketidir.

## Web
- Yerel çalışma: `node server.js`
- Sağlık testi: `http://localhost:3000/api/health`
- Vercel ayarı: `vercel.json`
- API fonksiyonları: `api/`
- Arayüz: `public/`

## Android
- Proje: `android/`
- GitHub Actions: `.github/workflows/android-apk.yml`
- Actions > Build tribün360 Android APK > Run workflow ekranında Vercel HTTPS adresi girilir.
- Çıktı: `tribun360-debug-apk` artifact'i içindeki `tribun360-debug.apk`.

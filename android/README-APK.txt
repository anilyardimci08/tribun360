tribün360 V63 — Android APK Projesi

Bu proje V63 web uygulamasını Android WebView içinde APK olarak paketlemek için hazırlandı.

ÖNEMLİ:
V63 yalnız statik HTML değildir; server.js üzerinden ESPN/API proxy ve normalize endpointleri kullanır.
Bu nedenle çalışan APK için backend'in telefondan erişilebilen bir HTTPS adrese deploy edilmesi gerekir.
Basitçe index.html'i APK içine koymak canlı skor, fikstür, kadro ve istatistik API'lerini bozardı; bu yüzden öyle paketlenmedi.

Üretim akışı:
1. Tribun360-V63-Pro-Urun-Paketi içindeki Node.js uygulamasını Vercel/başka bir Node sunucuya deploy edin.
2. app/build.gradle içindeki TRIBUN360_URL değerini deploy adresiyle değiştirin.
3. Android Studio ile projeyi açın.
4. Build > Build APK(s) veya ./gradlew assembleDebug.

Proje ayarları:
- Paket: com.tribun360.app
- minSdk: 24
- targetSdk: 35
- JavaScript/DOM storage açık
- Tam ekran web uygulaması, ActionBar yok

web-source/Tribun360-V63 klasörü mevcut web projesinin tam kopyasını içerir.

# İnce Bal — Profesyonel E-Ticaret Başlangıç Projesi

Bu proje gerçek satışa hazırlanmış, mobil uyumlu bir Node.js + Express e-ticaret sitesidir.

## İçerik
- Ürün kataloğu
- Sepet ve localStorage
- Kargo hesabı
- Müşteri/adres formu
- SQLite sipariş kaydı
- iyzico Checkout Form entegrasyon iskeleti
- iyzico ödeme callback ve ödeme sonucu sorgulama
- Güvenlik başlıkları (Helmet)
- Mobil uyumlu premium tasarım

## Kurulum
1. Node.js 20+ kurun.
2. Terminalde proje klasöründe `npm install`
3. `.env.example` dosyasını `.env` olarak kopyalayın.
4. iyzico API anahtarı ve Secret Key değerlerini `.env` içine girin.
5. `BASE_URL` değerini sitenin gerçek HTTPS adresi yapın.
6. `npm start`
7. `http://localhost:3000` adresini açın.

## Önemli
Ödeme bilgilerinin gerçekten alınabilmesi için iyzico hesabınızın canlı/production bilgilerinin tanımlanması gerekir. Test ortamında önce sandbox kullanmanız önerilir.

Canlıya çıkmadan önce:
- Gerçek ürün fotoğraflarını `public/images/` içine koyun.
- Şirket bilgilerini, iletişim bilgilerini ve yasal metinleri gerçek bilgilerinizle doldurun.
- Kargo firması entegrasyonu ekleyin.
- KVKK, Gizlilik, Mesafeli Satış ve Ön Bilgilendirme metinlerini hukuk/uzman kontrolünden geçirin.
- HTTPS ve alan adı kullanın.
- Sipariş yönetimi için güvenli bir admin paneli ekleyin.

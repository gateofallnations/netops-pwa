# NetOps Hub — PWA

نسخهی موبایلی NetOps Hub بدون نیاز به اکانت Apple Developer یا مک.

**آدرس:** https://gateofallnations.github.io/netops-pwa/

## نصب روی آیفون

1. Safari → باز کردن لینک بالا
2. دکمه Share → **Add to Home Screen**
3. مثل اپ معمولی از صفحهی خانه باز میشود

آپدیتها خودکاراند؛ نیازی به نصب APK/IPA نیست.

## معماری

| بخش | محل | کار |
|---|---|---|
| رابط | `index.html`, `styles.css`, `app.js` | داشبورد، سرورها، موجودی، دفتر تلفن، آکادمی، هلپدسک، جستجو، علاقهمندیها |
| مرجع | `reference_library.json` | ۱۶۵ مطلب CMD / CPL / کیوورد / چیتشیت (همان اندروید) |
| آفلاین | `sw.js` + localStorage | کشرابط و دادهها |
| API | `worker.js` | Cloudflare Worker خواندنی + ورود با PBKDF2 |
| استقرار API | `deploy_worker.py` | آپلود Worker با KV binding |

**امنیت:** توکن کلودفلر و هش رمزها هرگز به مرورگر نمیرسند. ورود از طریق
`POST /login` در Worker و تأیید PBKDF2 همانند اندروید انجام میشود.

## محدودیتها

- Face ID بومی و File Provider اندروید در PWA موجود نیستند.
- اعلانهایpush در iOS محدود به نسخههای جدید Safari و مجوز کاربراند.
- ویرایش تیکت/پیوست در مرحلهی فعلی فقطخواندنی است (مرحلهی بعد).

## استقرار مجدد Worker

```powershell
$env:CF_API_TOKEN='cfat_...'
python D:\NetOpsHub\pwa\deploy_worker.py
```

## اندروید و iOS بومی

اسکلت مشترک KMP در `D:\NetOpsHub\kmp` موجود است (قواعد SLA، ماتریس اولویت،
دستهها و ساعت کاری — تستها سبز). در صورت تهیهی حساب Apple Developerlater،
همان کدها برای iOS بومی هم قابل استفادهاند.

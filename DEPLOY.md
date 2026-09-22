# نشر MizanPro V2

## Render
1. ارفع المستودع إلى GitHub.
2. في Render اختر New > Blueprint واربط المستودع.
3. سيتم استخدام `render.yaml` لإنشاء قاعدة PostgreSQL وAPI.
4. تأكد من ظهور `/health` وإرجاع `version: 2.0.0`.

## Flutter Android
ابنِ AAB بهذه المتغيرات:
`flutter build appbundle --release --dart-define=API_URL=https://YOUR-API.onrender.com/api`

## Flutter Web
`flutter build web --release --dart-define=API_URL=https://YOUR-API.onrender.com/api`

## متطلبات الإنتاج
- تغيير JWT_SECRET بقيمة قوية.
- ربط نطاق HTTPS للـAPI والويب.
- إعداد نسخ احتياطية PostgreSQL.
- ربط بوابة دفع لخطة الاشتراك قبل بيع الخطط فعلياً.
- ربط API البنك المستهدف عندما يتوفر.

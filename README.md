# محوّل ميكروتك الذهبي → Firebase

ملف `server.js` يحاكي جميع نقاط نهاية `khalils.me` ويخزّن البيانات في
Firebase Realtime Database. بدون تبعيات — Node.js 18+ فقط.

## 1) إنشاء مشروع Firebase

1. ادخل https://console.firebase.google.com وأنشئ مشروعًا جديدًا (خطة Spark المجانية تكفي).
2. من القائمة: **Build → Realtime Database → Create Database**
   - اختر الموقع الأقرب، ثم **Start in test mode** (أو عدّل القواعد لاحقًا).
3. انسخ رابط قاعدة البيانات، شكله:
   `https://YOUR-PROJECT-default-rtdb.firebaseio.com`
   (قد يكون `.firebasedatabase.app` حسب المنطقة)
4. قواعد الأمان المقترحة للتجربة (Database → Rules):
   ```json
   { "rules": { ".read": true, ".write": true } }
   ```

## 2) تشغيل المحوّل محليًا (للتجربة)

```bash
set FB_DB=https://YOUR-PROJECT-default-rtdb.firebaseio.com
node server.js
```

جرّب: `curl http://localhost:8080/health`

## 3) نشره على استضافة مجانية

اختر واحدًا:

### Render (render.com) — مجاني
1. ارفع مجلد `firebase-adapter` لمستودع GitHub.
2. New → Web Service → اربط المستودع.
3. Start Command: `node server.js`
4. Environment Variables: `FB_DB` = رابط قاعدتك.
5. ستحصل على رابط مثل `https://xxx.onrender.com` — **أرسله لي** لأضعه في التطبيق.

### Railway / أي VPS
نفس الفكرة: `node server.js` مع متغير `FB_DB`.

## 4) ربط التطبيق

بعد حصولك على رابط الاستضافة، أخبرني به وسأ:
1. أستبدل `khalils.me` بالرابط الجديد في الكود (بما فيها سكربتات الراوتر).
2. أعيد بناء وتوقيع الـ APK.

## ملاحظات

- البيانات تُخزّن تحت: `users/`, `routers/`, `backups/`, `clouds/`, `images/`, `cards/`, `pages/`, `notify/`, `certs/`.
- الصور تُخزّن base64 داخل RTDB (حد ~16MB لكل عنصر).
- بعض الدلالات (أسعار الباقات `pages`) تحتاج إدخال بياناتك في RTDB يدويًا تحت `pages/default/`.

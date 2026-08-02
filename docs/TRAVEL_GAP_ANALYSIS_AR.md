# تحليل فجوة — الموديول الحالي مقابل متطلبات Fusion Travel

**المرجع:** `docs/TRAVEL_MODULE_REQUIREMENTS.md`  
**الكود المراجع:** `fusion_travel` **19.0.2.5.0** في `Jawher-Khashifa`  
**تنبيه:** مستودع `smartexsoftorg/fusion_travel` (المزعوم 19.0.6) غير متاح لهذه المراجعة.

---

## الحكم السريع

الموديول الحالي = **نواة Odoo جيدة لحجز Amadeus (Self-Service/REST) + محفظة + تذاكر محاسبية**.  
متطلبات Fusion = **منصة متعددة المزودين / متعددة المنتجات / FastAPI + Odoo**.

الفجوة ليست «باقات ناقصة» فقط — بل **تحول معماري**: من تكامل مزود واحد داخل Odoo إلى طبقة Orchestration محايدة للمزودين.

---

## 1) ما يغطيه الحالي جزئياً أو كلياً

| المتطلب | الحالة الحالية | ملاحظة |
|---------|----------------|--------|
| بحث/حجز طيران | جزئي | One-way/Return أساسي؛ Multi-city غير مكتمل كمنتج |
| فنادق | جزئي | بحث/حجز Amadeus موجود |
| Transfers | جزئي | Amadeus Transfers (ليس Car Rental) |
| PNR / Create Order | جزئي | حجز؛ الإصدار الحقيقي يعتمد consolidator |
| Void / Refund / Exchange | جزئي | نماذج تذاكر + حالات محاسبية؛ ليست دورة NDC كاملة |
| Wallet & Balance | قوي نسبياً | قفل + idempotency + تسوية محاسبية (2.5.0) |
| Booking history / Portal | جزئي | بوابة قراءة + موقع |
| Email | جزئي | قوالب؛ SMS غير موجود |
| Agent roles | جزئي | User / Accountant / Manager |
| Odoo ERP | موجود | الموديول نفسه |
| تقارير | جزئي | عبر Odoo؛ طوابير ticket/booking محدودة |
| أمن أساسي | محسّن في 2.5.0 | عروض خادم، تحقق قبل الدفع، ربط الرضيع |

---

## 2) فجوات حرجة مقابل المواصفات الجديدة

### معمارية (الأهم)
| المتطلب | الفجوة |
|---------|--------|
| Provider-agnostic adapters | الكود مربوط بمسار Amadeus مباشرة في `services/amadeus_*` |
| Parallel multi-provider search | مزود واحد؛ لا orchestration fan-out |
| FastAPI backend | غير موجود في هذا المستودع |
| Event-driven | غير موجود (cron بسيط فقط) |
| Clean Architecture / DDD | نماذج Odoo إجرائية؛ لا طبقة domain مستقلة |
| OpenAPI / Swagger | لا عقد API مستقل عن Odoo controllers |
| Docker / CI/CD جاهز للاختبارات | لا suite اختبارات آلية حقيقية |

### Phase 1 Flights
| المتطلب | الفجوة |
|---------|--------|
| Multi-city | غير مغطى كتدفق كامل |
| Amadeus NDC / IATI / Qatar NDC | غير موجود |
| Branded fares | غير موجود |
| Seat availability / maps | غير موجود |
| Fare rules UX | غير موجود |
| Ancillaries (seats/bags/meals/SSR) | غير موجود |
| Ticket issuance حقيقي متعدد المزودين | يعتمد consolidator خارجي |

### Customer / Agent
| المتطلب | الفجوة |
|---------|--------|
| Passenger profiles / saved travelers | بيانات مسافر على الحجز فقط |
| SMS | غير موجود |
| Agency credit limits | غير موجود كمنتج |
| Commission management متقدم | حقل عمولة أساسي |
| Booking/Ticket queues احترافية | عمليات/حالات؛ ليست طوابير عمل كاملة |

### Future + AI
| المتطلب | الفجوة |
|---------|--------|
| Hotels/Cars/… كمنتجات منصّة | فنادق/transfers مدمجة داخل نفس الموديول بدون kernel مشترك واضح |
| AI Travel Assistant hooks | غير موجود |

---

## 3) ماذا تفعلون بالكود الحالي؟

**لا ترموا `fusion_travel`.** استخدموه كـ:

1. **Odoo ERP / Ops surface** (شركاء، محفظة، قيود، تذاكر، بوابة، صلاحيات).  
2. **مرجع سلوك** لتدفقات Amadeus الحالية.  
3. **Adapter أول** خلف منفذ (`FlightProviderPort`) بعد استخراج المنطق من Odoo إلى FastAPI/domain.

### مسار موصى للفريق
```
P0  عرّفوا Ports + DTOs موحّدة
    └─ لفّوا Amadeus الحالي كـ Adapter #1
    └─ FastAPI orchestration (search parallel-ready)
    └─ Odoo يستهلك REST بدل استدعاء Amadeus مباشرة على المدى المتوسط

P1  Ticketing/void/refund/exchange + queues + reports على العقد الموحّد
P1.1 Branded fares + ancillaries
P2  Adapter ثاني (NDC أو IATI) لإثبات agnostic
P3  Hotels/Transfers كمنتجات منفصلة على نفس الـ kernel
P4  AI على نفس الـ APIs
```

---

## 4) قواعد قبول معمارية (Definition of Done للمنصة)

أي قصة جديدة تُرفض في المراجعة إذا:

1. استوردت SDK/عميل Amadeus داخل نموذج Odoo أو controller موقع جديد.  
2. نسخت منطق تسعير/حجز خاص بمزود داخل «business service» بدل Adapter.  
3. أضافت منتجاً (Hotel/Car/…) بدون المرور على محفظة/هوية/إشعارات المشتركة.  
4. بلا اختبارات idempotency لمسارات الدفع/الحجز.  
5. بلا تحديث OpenAPI.

---

## 5) رسالة جاهزة لفريق التطوير

استخدموا نص المتطلبات في:

`docs/TRAVEL_MODULE_REQUIREMENTS.md`

مع التأكيد التالي:

> ابنوا Travel كمنصة محايدة للمزودين.  
> منطق الأعمال لا يعتمد مباشرة على Amadeus أو أي مزود واحد.  
> كل مزود = Adapter واحد + طبقة Orchestration موحّدة.  
> Odoo = ERP/تشغيل. FastAPI = محرك البحث والتنسيق.  
> الموديول الحالي `fusion_travel` هو نقطة انطلاق للـ Adapter الأول وسطح Odoo — وليس الشكل النهائي للمنصة.

---

## 6) التحديثات غير المدمجة في Jawher-Khashifa (سياق)

| PR/فرع | ماذا يفعل | علاقته بالمواصفات |
|--------|-----------|-------------------|
| PR #1 + #3 | `fusion_travel` 19.0.2.5.0 | خط أساس Odoo الحالي |
| PR #2 `trip` 1.8.1 | إصلاحات أمنية على الموديول القديم | لا تدمجوه مع fusion في الإنتاج |
| `p1eir5` trip 1.7.2 | idempotency قديم | مغطى بشكل أقوى داخل fusion |

بعد فتح `smartexsoftorg/fusion_travel` (إن وُجدت 19.0.6): أعد هذا التحليل بـ diff مقابل تلك النسخة قبل أي إعادة كتابة كبيرة.

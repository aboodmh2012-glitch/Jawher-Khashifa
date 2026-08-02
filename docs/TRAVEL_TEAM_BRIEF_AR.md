# موجز لفريق التطوير — موديول Travel في Fusion

## المطلوب منهم

بناء **منصة Travel احترافية** لمشروع Fusion، وليس مجرد شاشة حجز مربوطة بـ Amadeus.

المواصفات الكاملة:

- `docs/TRAVEL_MODULE_REQUIREMENTS.md`
- تحليل الفجوة مقابل الكود الحالي: `docs/TRAVEL_GAP_ANALYSIS_AR.md`

## الشرط المعماري غير القابل للتفاوض

صمّموا الموديول كمنصة **محايدة للمزودين (provider-agnostic)**.

- منطق الأعمال **لا يعتمد مباشرة** على Amadeus أو أي مزود واحد.
- كل مزود (Amadeus GDS / Amadeus NDC / IATI / Qatar NDC / …) يُضاف عبر **Adapter**.
- طبقة **Orchestration** موحّدة للبحث المتوازي والتجميع والحجز والتذاكر.
- Odoo = ERP وتشغيل ووكلاء ومحاسبة.
- FastAPI = محرك البحث والتنسيق وواجهات REST الموثّقة.

بهذا يمكن إضافة أي مزود جديد دون إعادة كتابة منطق النظام.

## Phase 1 — Flights

بحث (One-way / Round-trip / Multi-city)، مزودون متعددون بالتوازي، Fare rules، Branded fares، المقاعد، الأمتعة، الفلاتر، الحجز، PNR، الإصدار، الاسترجاع، Void / Refund / Exchange، والخدمات الإضافية (Seats / Bags / Meals / SSR).

## Customer / Agent

ملفات ركاب، مسافرون محفوظون، محفظة، طرق دفع، سجل حجوزات، PDF، Email/SMS، عمولات، رصيد وكالة، حدود ائتمان، طوابير حجز/تذاكر، تقارير.

## منتجات مستقبلية يجب أن تتحملها المعمارية

Hotels · Car Rental · Transfers · Activities · Insurance · Visa · Cruise · Rail · Bus — ثم AI Travel Assistant فوق نفس الـ APIs.

## جودة الكود

Clean Architecture · DDD · SOLID · Repository · Unit/Integration tests · OpenAPI · Docker · CI/CD.

## وضع الكود الحالي

`fusion_travel` الحالي في المستودع هو **نقطة انطلاق** (سطح Odoo + مسار Amadeus)، وليس الهدف النهائي. لا تبنوا فوق استدعاءات Amadeus المباشرة كعقد دائم — استخرجوا Ports/Adapters أولاً.

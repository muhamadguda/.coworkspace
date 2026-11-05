"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button, Card, Segmented } from "@/components/ui";
import { useIsOwner } from "./hooks";

// How to use dot, for the counter and the owner. Button names match the app's labels.
type L = { ar: string; en: string };
type Section = { id: string; title: L; steps: L[]; tip?: L };

const STAFF: Section[] = [
  {
    id: "shift",
    title: { ar: "أول الشيفت", en: "Starting your shift" },
    steps: [
      { ar: "افتح dotcowork.space/staff وادخل برقم موبايلك والباسورد.", en: "Open dotcowork.space/staff and sign in with your phone number and password." },
      { ar: "دوس «ابدأ الشيفت» عشان التنبيهات تشتغل بصوت والشاشة متطفيش.", en: "Tap “Start shift” so alerts can play sound and the screen stays on." },
      { ar: "لو اليوم لسه مفتحش، اكتب الفلوس اللي في الدرج (رصيد البداية) وافتح اليوم.", en: "If the day isn't open yet, type the cash in the drawer (opening float) and open the day." },
      { ar: "من قايمة اسمك فوق: شغّل «تنبيهات على الجهاز ده» عشان توصلك الطلبات والحجوزات حتى لو الصفحة مقفولة.", en: "From your name menu at the top, turn on “Alerts on this device” to get orders and bookings even when the page is closed." },
    ],
    tip: { ar: "النت قطع؟ كمّل شغلك عادي. كل حاجة بتتحفظ على الجهاز وبتتبعت لوحدها لما النت يرجع. العلامة فوق بتقولك أونلاين ولا أوفلاين.", en: "Internet down? Keep working. Everything is saved on the device and sent by itself when the connection is back. The pill at the top shows online or offline." },
  },
  {
    id: "rooms",
    title: { ar: "الأوض والوقت", en: "Rooms and time" },
    steps: [
      { ar: "من «الأوض والترابيزات»: الأخضر فاضي والأحمر مشغول.", en: "In “Board”: green is free, red is in use." },
      { ar: "دوس على أوضة فاضية ← «ابدأ وقت». اختار صاحب الحجز برقم الموبايل، والنوع (مذاكرة، بلايستيشن…)، ومفتوح ولا مدة محددة.", en: "Tap a free room → “Start session”. Pick the booker by phone number, the mode (study, PlayStation…), and open-ended or fixed time." },
      { ar: "لو جالهم حد: «ضيف شخص». كل واحد ليه زيارة لوحده، والأوضة على صاحب الحجز إلا لو قسمتوها.", en: "Someone joins: “Add person”. Everyone gets their own bill; the room goes on the booker unless you split it." },
      { ar: "غيروا النشاط (مثلاً من مذاكرة لبلايستيشن)؟ «غيّر النوع». كل جزء بيتحسب بسعره.", en: "They switch activity (say study → PlayStation)? “Change mode”. Each part is billed at its own price." },
      { ar: "في الآخر: «اقفل واحسب». لو فيه وقت زيادة بعد السماح، تقدر تحسبه أو تسامح فيه. اختار مين يدفع الأوضة.", en: "At the end: “End and calculate”. If they stayed past the grace time you can charge it or let it go. Choose who pays the room." },
      { ar: "لو صاحب الحجز عنده باقة ساعات أو مكافأة، بتتخصم لوحدها من سعر الأوضة (تقدر تقفلها).", en: "If the booker has an hour bundle or a reward, it comes off the room price automatically (you can switch it off)." },
    ],
    tip: { ar: "حد ماشي بدري والأوضة لسه شغالة؟ من زيارته «ماشي دلوقتي · يدفع اللي عليه». صاحب الحجز ماشي؟ «انقل الحجز لحد تاني».", en: "Someone leaves early while the room runs? On their bill: “Leaving now · pay own items”. The booker leaves? “Hand over the booking”." },
  },
  {
    id: "orders",
    title: { ar: "الطلبات", en: "Orders" },
    steps: [
      { ar: "العملاء بيطلبوا من الكود اللي على الترابيزة. الطلب بيظهر في «الطلبات» مع صوت.", en: "Customers order from the QR code on their table. The order shows in “Orders” with a sound." },
      { ar: "«أكد» يضيفه على زيارتهم، أو «ارفض» مع السبب. لما يتقدم دوس «اتقدم».", en: "“Accept” adds it to their bill, or “Reject” with a reason. When it's delivered tap “Served”." },
      { ar: "«واتساب» على الطلب بيبعت للعميل إن طلبه جاهز.", en: "“WhatsApp” on an order tells the customer it's ready." },
      { ar: "عايز تطلب لحد بنفسك؟ من زيارته «ضيف طلب».", en: "Taking an order yourself? On their bill: “Add items”." },
      { ar: "صنف خلص؟ من «المتاح في المنيو» دوس عليه يبقى «خلص». الحاجات اللي ليها مخزون بتتقفل لوحدها لما توصل صفر.", en: "Out of something? In “Menu availability” tap it to mark it sold out. Items with tracked stock switch off by themselves at zero." },
      { ar: "وصل مخزون جديد؟ دوس على الصنف في قسم «المخزون» ← «وصل جديد» أو «جرد» أو «هالك».", en: "New stock arrived? Tap the item under “Stock” → “Restock”, “Count” or “Waste”." },
    ],
  },
  {
    id: "checkout",
    title: { ar: "الدفع وقفل الزيارة", en: "Checkout and payment" },
    steps: [
      { ar: "من «الزيارات» أو من على الأوضة: «ادفع واقفل». قفل الأوضة الأول لو كانت شغالة.", en: "From “Bills” or the room: “Checkout”. End the room first if it's still running." },
      { ar: "قسّم الدفع براحتك: كاش، إنستاباي، فودافون كاش، أو آجل (لحد حد الآجل بتاع العميل).", en: "Split the payment any way: Cash, InstaPay, Vodafone Cash, or Pay later (up to the customer's limit)." },
      { ar: "خصم؟ اكتب المبلغ أو النسبة والسبب. لو أكبر من المسموح، صاحب المكان يكتب رقمه والباسورد.", en: "Discount? Enter the amount or percent and a reason. Above your limit, the owner types their phone and password." },
      { ar: "شغّل «اطبع الإيصال» أو «ابعت الفاتورة واتساب» قبل ما تقفل.", en: "Turn on “Print receipt” or “Send receipt on WhatsApp” before closing." },
      { ar: "صنف غلط على الزيارة؟ دوس «تعديل صنف» قبل الدفع، وغيّر العدد أو «شيل الصنف» مع السبب.", en: "Wrong item on a bill? Tap “Edit item” before paying, change the quantity or “Remove item” with a reason." },
    ],
  },
  {
    id: "bookings",
    title: { ar: "الحجوزات", en: "Bookings" },
    steps: [
      { ar: "الحجوزات من الموبايل بتيجي «مستنية». «أكد» أو «ارفض»، وابعت للعميل واتساب بالتأكيد.", en: "Online bookings arrive as pending. “Confirm” or “Reject”, then send the customer a WhatsApp confirmation." },
      { ar: "حجز بالتليفون؟ «حجز جديد».", en: "Booking by phone? “New booking”." },
      { ar: "لما ييجوا: «ابدأ الوقت» من الحجز نفسه. مجوش؟ «مجاش».", en: "When they arrive: “Start session” from the booking. Didn't come? “No-show”." },
      { ar: "الأوضة اللي عليها حجز قريب بيبان عليها تنبيه في اللوحة.", en: "A room with a booking coming up shows a warning on the board." },
    ],
  },
  {
    id: "customers",
    title: { ar: "العملاء والآجل والباقات", en: "Customers, pay-later and bundles" },
    steps: [
      { ar: "دوّر بالموبايل أو الاسم أو الكود. القايمة بتوريك اللي عليهم فلوس.", en: "Search by phone, name or code. The list shows who owes money." },
      { ar: "حد بيسدد آجل؟ افتحه، اختار طريقة الدفع، واكتب المبلغ ← «سدّد». «فكّره بالباقي» بيبعتله واتساب.", en: "Someone paying their tab? Open them, pick the method, type the amount → “Pay off”. “Send a reminder” messages them on WhatsApp." },
      { ar: "بيع باقة ساعات: من العميل «بيع باقة». بتتضاف على زيارته وبتتدفع معاها.", en: "Selling an hour bundle: on the customer, “Sell bundle”. It's added to their bill and paid with it." },
      { ar: "العميل بيشوف زيارته ورصيد ساعاته وعدد زياراته من «زيارتي» على الموبايل برقمه والكود.", en: "Customers see their bill, prepaid time and visits under “My bill” on their phone, with their number and code." },
    ],
  },
  {
    id: "day",
    title: { ar: "آخر اليوم", en: "End of day" },
    steps: [
      { ar: "سحبت فلوس من الدرج (مشتريات مثلاً)؟ «سحب من الدرج» مع السبب.", en: "Took cash out (for supplies, say)? “Take cash out” with a reason." },
      { ar: "اقفل كل الأوض والزيارات المفتوحة.", en: "End all rooms and close all open bills." },
      { ar: "من «الدرج»: عِد الكاش واكتبه ← «اقفل اليوم». هتشوف الفرق لو فيه.", en: "In “Cash drawer”: count the cash, type it → “Close the day”. Any difference is shown." },
      { ar: "اطبع تقرير اليوم لو محتاجه.", en: "Print the day report if you need it." },
    ],
  },
];

const OWNER: Section[] = [
  {
    id: "o-setup",
    title: { ar: "التجهيز أول مرة", en: "First-time setup" },
    steps: [
      { ar: "«الإعدادات»: اسم المكان والعنوان وواتساب، وكلام آخر الإيصال.", en: "“Settings”: venue name, address, WhatsApp and the receipt footer." },
      { ar: "حساب الوقت: أقل مدة، السعر بيزيد كل كام دقيقة، والسماح بعد المدة المحددة، وساعة بداية اليوم الجديد.", en: "Billing rules: minimum time, the step the bill rounds up to, grace after a fixed time, and the hour a new business day starts." },
      { ar: "«أنواع الاستخدام والأسعار» للسعر العادي، و«أسعار كل أوضة» لو أوضة ليها سعر مختلف.", en: "“Modes & hourly prices” for the normal price, and “Prices per room” where a room costs differently." },
      { ar: "«الأوض والترابيزات»: ضيف وسمّي وامسح. اللي ليه زيارات قديمة بيتخبى بدل ما يتمسح.", en: "“Rooms & tables”: add, rename, delete. Anything with past bills is hidden instead of deleted." },
      { ar: "«اطبع كل الأكواد» واحطها على الترابيزات والأوض.", en: "“Print all QR codes” and put them on the tables and rooms." },
    ],
  },
  {
    id: "o-menu",
    title: { ar: "المنيو والمخزون", en: "Menu and stock" },
    steps: [
      { ar: "«المنيو»: أقسام وأصناف بالعربي والإنجليزي، صور، أسعار، واختيارات (سكر، لبن…).", en: "“Menu”: categories and items in Arabic and English, photos, prices and options (sugar, milk…)." },
      { ar: "للحاجات المتعدة (كانز، شيبسي…): شغّل «تابع المخزون» وحدد «نبهني لما يوصل»، وبعدين اعمل جرد أول مرة.", en: "For counted items (cans, crisps…): turn on “Track stock”, set “Warn me at”, then do a first count." },
    ],
  },
  {
    id: "o-growth",
    title: { ar: "الباقات والمكافآت والتقييمات", en: "Bundles, rewards and reviews" },
    steps: [
      { ar: "«الإعدادات ← باقات الساعات»: مثلاً ١٠ ساعات بسعر معين، صالحة ٣٠ يوم، لأي نوع أو نوع واحد.", en: "“Settings → Hour bundles”: e.g. 10 hours at a set price, valid 30 days, for any mode or one mode." },
      { ar: "«تقييمات ومكافآت»: حط لينك تقييم جوجل (من Google Business Profile) عشان يتبعت مع الفاتورة.", en: "“Reviews & rewards”: paste your Google review link (from Google Business Profile) so it goes out with receipts." },
      { ar: "حدد «ساعة ببلاش كل كام زيارة» ومدتها. المكافأة بتنزل لوحدها وبتتخصم زي الباقة. ٠ يقفلها.", en: "Set “Free time every N visits” and how long. Rewards are issued automatically and used like a bundle. 0 turns it off." },
    ],
  },
  {
    id: "o-team",
    title: { ar: "الموظفين والصلاحيات", en: "Team and permissions" },
    steps: [
      { ar: "«الموظفين»: ضيف موظف برقمه واسمه وباسورد. تقدر توقفه أو تغير الباسورد في أي وقت.", en: "“Team”: add staff with phone, name and a password. Pause them or reset the password anytime." },
      { ar: "حدد أقصى خصم للموظفين (نسبة ومبلغ) من الإعدادات. أكتر من كده محتاج موافقتك.", en: "Set the staff discount limit (percent and amount) in Settings. Anything above needs your approval." },
      { ar: "حد الآجل لكل عميل بتحدده من «العملاء».", en: "Each customer's pay-later limit is set in “Customers”." },
    ],
  },
  {
    id: "o-reports",
    title: { ar: "التقارير", en: "Reports" },
    steps: [
      { ar: "«التقارير» فوق خالص: «النهارده لحد دلوقتي» (المحصّل، الزيارات المفتوحة، أكتر أوضة وصنف، اللي قرب يخلص).", en: "Top of “Reports”: “Today so far” (collected, open bills, busiest room and item, what's running low)." },
      { ar: "تحتها: أي فترة، فلوس بطريقة الدفع، الأوض، أكتر الأصناف، الخصومات، الآجل، الدرج، والإلغاءات. «تصدير CSV» يفتح في إكسل.", en: "Below: any date range, money by method, rooms, top items, discounts, pay-later, drawer and cancellations. “Export CSV” opens in Excel." },
      { ar: "زيارة اتقفلت غلط؟ من «الزيارات» ← «افتح الزيارة تاني» مع السبب. الدفع القديم بيتلغي ويفضل متسجل.", en: "A bill closed by mistake? In “Bills” → “Reopen bill” with a reason. The old payment is voided and stays on record." },
    ],
  },
];

export function Guide() {
  const { lang } = useI18n();
  const isOwner = useIsOwner();
  const [who, setWho] = useState<"staff" | "owner">("staff");
  const sections = who === "owner" ? OWNER : STAFF;
  const L = (x: L) => (lang === "ar" ? x.ar : x.en);

  return (
    <div className="grid gap-4 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-3xl font-bold">{lang === "ar" ? "إزاي تستخدم dot" : "How to use dot"}</h2>
        <div className="flex items-center gap-2 print:hidden">
          {isOwner ? (
            <Segmented value={who} onChange={setWho} options={[{ value: "staff", label: lang === "ar" ? "الكاونتر" : "Counter" }, { value: "owner", label: lang === "ar" ? "صاحب المكان" : "Owner" }]} />
          ) : null}
          <Button size="sm" onClick={() => window.print()}>{lang === "ar" ? "اطبع" : "Print"}</Button>
        </div>
      </div>
      <nav className="flex flex-wrap gap-1.5 print:hidden">
        {sections.map((s) => (
          <button key={s.id} type="button" onClick={() => document.getElementById(`g-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} className="h-9 px-3 inline-flex items-center rounded-full border-2 border-line text-sm font-semibold">
            {L(s.title)}
          </button>
        ))}
      </nav>
      {sections.map((s, i) => (
        <Card key={s.id} id={`g-${s.id}`} className="p-4 grid gap-3 break-inside-avoid scroll-mt-28">
          <h3 className="font-display text-xl font-bold"><span className="num text-accent me-2">{i + 1}</span>{L(s.title)}</h3>
          <ol className="grid gap-2 list-decimal ps-6 marker:font-bold marker:text-muted">
            {s.steps.map((x, k) => <li key={k} className="leading-relaxed">{L(x)}</li>)}
          </ol>
          {s.tip ? <p className="text-sm border-s-4 border-accent ps-3 leading-relaxed">{L(s.tip)}</p> : null}
        </Card>
      ))}
    </div>
  );
}

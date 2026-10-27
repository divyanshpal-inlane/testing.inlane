# Additional payments, top-ups and payment traceability

> **Decision (2026-10-22): the team no longer records payments.** There is no "Record payment" / "Add paid info" anywhere
> (Sales Dashboard slot panel, Services & payments hub, Learner Management > Incomplete Payments, and the old Customer Info
> page). A service becomes Paid only when the customer pays through a payment link, so every payment comes from the gateway.
> The manual-entry code (dialog, proof upload, UTR checks, verification) and its schema (UTR / proof / recorded-by /
> verification columns, proof bucket) were removed, including from the migration. This is an app rule only: the database still
> lets an admin account write to `payment`, so it is not enforced by RLS.

## 1. Why a second payment link was blocked
- `create-learner-and-enrollment` throws "Learner already registered" for an existing phone.
- The only link action (`Send Payment Link`) re-sends the customer's *latest* enrollment, and `Edit plan` overwrites it. There
  was no way to add a second service.
- The payment backend already supports several enrollments per learner (`process-payment` keys course payments on learner +
  course; top-ups get their own `progress.type = "topup"` enrollment), so courses and top-ups need **no edge function change**.
  A licence service is different (see section 12): it has no course or lessons, so the payment functions need a small guarded
  change to take its fee online.
- `payment` had no unique, human-readable ID, no proof, and no link to the service it paid for.

## 2. Feasibility and status
| Requirement | Feasible | Status |
|---|---|---|
| 1. More payment links for an existing customer (another course) | Yes | Built |
| 1. Licence service (2W/4W LL/DL) for an existing customer | Yes | Built: its own service with its own payment link, or add it without a link and record the payment. **Needs 4 edge functions deployed (section 12)** |
| 2. Top-up classes link | Yes | Built |
| 3. Unique Payment ID and traceability (customer, link, service, payment) | Yes | Built (needs the migration). Manual proof / UTR entry was **removed** by the decision above |

## 3. The feature: "Services & payments" hub
One dialog per customer, opened from the Sales Dashboard slot panel, each Incomplete Payments row, or the new **Existing
customer** card on Learner Management (find by phone, **PAY-** Payment ID, **LNK-** Link ID, or UTR).

**Tab 1: Sell something** (no duplicate customer or lead; each service is its own enrollment)
- *Another course*: package, plan (full / 50:50 / custom), price prefilled from the course list and editable. A preview says
  exactly what the link will charge.
- *Top-up classes*: classes x per-class price (default Rs 599), total editable. One unpaid top-up per customer at a time (the
  payment backend reuses one pending top-up), so a second request updates it.
- *Licence service*: vehicle (2W/4W), need (LL / DL / LL+DL), fee. Creates an `rto_only` enrollment, the same shape the Create
  Learner form writes. One fixed fee, one payment.
- **Create & send link** (email + WhatsApp/SMS) or **Create & copy link** (paste it yourself) for all three kinds. Both are
  logged. There is no "add without a link": a service is paid through its link.

**Tab 2: Services & payments**
- Every service with status (Unpaid / Half paid / Paid), last link ("sent 2 h ago by X", `LNK-` code).
- Per service: **Copy link**, **Resend**, **Remove** (only while
  nothing is paid; two-step confirm).
- Under each service: its payments with Payment ID, amount and status.

## 4. Manual payment entry: REMOVED
Built and then removed on 2026-10-22: the "Add paid info" dialog (installment ticks, UTR, proof upload, duplicate-UTR check,
confirmation tick), `saveManualPaidInfo`, the proof / UTR helpers, the verification step, and the legacy "Add paid info" dialog
and handlers in `CustomerInfo.tsx`. Its schema is no longer in the migration (nothing was applied yet).

## 5. (Removed) Verification
There is no second-person verification any more: it only existed to double-check manual entries.

## 6. Traceability chain
Customer -> Link (`LNK-`, `payment_link_log`) -> Service (`enrollment`) -> Payment (`PAY-`, `payment.enrollment_id`) -> UTR +
gateway reference. Every payment is a gateway payment, so it gets the Payment ID and the enrollment link automatically (trigger)
with no edge function change.

## 7. Safety for the existing flow
- Links without `&enrollment=` behave as before (latest enrollment), except that a licence (`rto_only`) enrollment is never
  chosen as "latest" for a bare link, so it cannot hide the course being paid.
- Existing enrollments, payments and the customer row are never modified by a sale.
- The same course cannot be sold twice: a paid one is refused, an unpaid one tells the user to resend/edit instead.
- Without the migration, reads degrade gracefully (the Payment ID is derived from the id; link logging is skipped with a warning).
- Nothing in the app writes a payment except the payment functions (gateway) and the tentative-slot / link flows.

## 8. Deploy order
1. Apply `supabase/migrations/20261022_100000_payment_traceability.sql` (additive; rollback block inside).
2. Deploy the edge functions that carry the licence change (section 12): `process-payment`, `create-razorpay-order`,
   `payment-callback`, and every function that imports `_shared/complete-payment.ts` (`verify-razorpay-payment`,
   `razorpay-webhook`, `recover-razorpay-payment`). Deploy them BEFORE the frontend, or a licence link opened earlier cannot
   be paid. Courses, top-ups and demos are unaffected either way.
3. Deploy the frontend.
4. Smoke test (see section 11), in gateway TEST mode first.

## 9. Open questions
1. **Licence payment side effects.** A paid licence service only marks the enrollment paid + active. It does NOT unlock lessons,
   rewrite `progress`, or open the LL->DL journey that a course payment opens (a licence customer may already have one, or
   Operations opens it). Confirm that is what you want.
1b. **WhatsApp payment-link template.** `send-message` PAYMENT_LINK is sent with the service name and `duration = 1`. If the
   template prints "N hours", a licence message will read "1 hour". Check the template wording.
3. Top-up price: Rs 599 per class is the existing admin default. Confirm, or give the price list.
4. Gateway-paid rows carry a Payment ID; the gateway holds the transaction reference. Enough?
5. A customer who genuinely cannot use the link (cash, bank transfer): who handles that now, outside this app?

## 10. Timeline
- Migration + staging QA: 0.5 day. Frontend QA of every flow: 1 day.
- Licence online link: built; needs the edge function deploy and a test-mode payment (0.5-1 day with QA).

## 11. Test checklist (NOT yet run against a live database)
- Existing customer with a paid 4W course: sell a different course; expect a second enrollment, a link, one payment each.
- Same course again: refused. Top-up twice: one unpaid top-up updated.
- Licence service: appears as its own service; the customer's bare payment link still opens the course, not the licence.
- **Licence payment, gateway TEST mode, both gateways (ICICI and Razorpay):** create a licence service with a link; open it;
  the page shows the fixed fee and no course picker; pay. Expect the enrollment `payment_status = full_paid`, `status = active`,
  `unlocked_lessons` and `progress` untouched, the payment row linked (`payment.enrollment_id`), and no new
  `ll_applications` row. A tampered amount, another learner's enrollment, and an already paid licence service are all rejected
  by `process-payment` / `create-razorpay-order`. A normal course payment, a demo and a top-up still behave exactly as before.
- Find a learner by name or e-mail (no phone): the result list shows a masked number only.
- No screen offers "Record payment" / "Add paid info": check the Sales Dashboard slot panel, the Services & payments hub, Learner
  Management > Incomplete Payments, and Customer Info.
- A service stays Unpaid until the customer pays through its link, then turns Paid by itself.
- Find a customer by name / e-mail, and a payment by its PAY- / LNK- ID.
- Copy link and Resend write `payment_link_log` rows (channel copy / send).

## 12. Licence service payment: what changed in the payment functions
A licence service is an enrollment with `case_type = 'rto_only'`, no course and no lessons. The existing "course" payment path
assumes the opposite, so it is recognised and handled separately. Everything is gated on `case_type === 'rto_only'`; every
other enrollment and payment type follows the unchanged code.

| File | Change |
|---|---|
| `_shared/licence.ts` (new) | `isLicenceEnrollment`, `assertLicencePayable` (same learner, not already paid, fee set, amount matches within Rs 1). Unit tested: `tests/licence-payment.test.mjs`. |
| `process-payment` (ICICI) | Reads `enrollmentId`. For a course payment with no `courseId` that names a licence enrollment: validates it BEFORE creating the payment row (no orphan pending payment), then sets `enrollment.payment_id` to the new payment. |
| `create-razorpay-order` | Same, for Razorpay. |
| `_shared/complete-payment.ts` (Razorpay verify / webhook / recover) | If the payment's enrollment is a licence one: mark `payment_status = full_paid`, `status = active` and stop. Skips the lesson unlock, the `progress` rewrite and the LL-journey auto-open. A failed lookup falls through to the old course code, so an ordinary course payment cannot be broken by it. |
| `payment-callback` (ICICI return) | Same licence guard, mirrored (the repo keeps payment completion in these two places). |

Frontend: `PaymentPage` recognises a licence enrollment named in the link (`&enrollment=<id>`): fixed fee, no course picker, no
installments, pay button disabled if already paid. A bare link never selects a licence enrollment.

**Not run:** there is no Deno here, so the edge functions were only syntax-checked and their pure helper unit tested; no payment
was made against ICICI or Razorpay. Test in gateway test mode before production.

## 13. A tentative slot's payment label (Instructor Management and Sales Dashboard)
Both screens used to let people TYPE a payment status on a tentative slot ("Paid information" in Instructor Management, "Payment
Status" on the Sales booking form, and the CRM lead could set it too). That is manual payment information, so it is gone:

- The Sales booking form shows a read-only **Payment** line; Instructor Management's edit form shows read-only text and its new
  tentative form shows a note; the "Paid/Unpaid information is required" validation, the CRM auto-set, the edit handler and an unused
  `updatePaidInfoMutation` were removed. Existing rows keep whatever value they have.
- A new slot is **Unpaid**. Linking a slot to a service copies that service's payment status onto the slot, in both spellings the
  app reads (`payment_status` and Instructor Management's `paid_info`: "Unpaid" / "Half paid" / "Full paid"). `useSalesData`
  already normalises `paid_info` for slots created in Instructor Management.
- The learner panel shows the linked service's LIVE status. If the status stored on the slot differs (the customer has paid since),
  it is re-synced with one write, by a viewer who may edit the slot (silent, no toast).
- **Why "Not linked to a service yet" showed with a course on the slot:** the booking's own free-text course is a note, not a
  link. The box now says so, and suggests the learner's matching service (`suggestService` in `serviceBooking.ts`: the ONE service
  whose topics equal the text's; never a guess between several; top-ups and licences never match) so one click links it.
- Limit: a slot's stored label is refreshed when the slot is opened (and by an editor), not the instant the customer pays; a slot
  nobody opens keeps its last value.

## 14. Slots are linked to a service by default (no manual link box)
The amber "Not linked to a service yet" box (a manual drop-down + Link button) was removed. A slot with no link is now rare
because linking happens automatically:

| When | What links the slot |
|---|---|
| Booking form (new booking) | `useLearnerServicesByPhone` finds the learner by the form's phone; `defaultServiceFor(courseText, services, { allowSingle: true })` picks the matching service, else the only one. A required **Service for these classes** select appears when the learner has services (blocks save until chosen). The free-text Course select is hidden once a service is set; `course_name` is saved from the service label. |
| Learner created / service sold from a slot's panel | `SlotLearnerActions` links that slot to the new enrollment (`onCreated`, hub `onServiceCreated`). |
| Unlinked slot opened by an editor | `SlotServiceLink` links it silently when the match is unambiguous (`allowSingle` only if the slot names no course). |
| Linked slot opened by an editor | The stored payment label is re-synced to the service's live status. |

A customer with no learner yet is saved unlinked (nothing to link to) and links itself once the learner / service exists. It is never
a guess between several services. Pure rule + tests: `defaultServiceFor` in `serviceBooking.ts`, `tests/service-booking.test.mjs`.
Not retro-fitted: slots that stay ambiguous (several services, no matching course) remain unlinked until one of the events above.

## 15c. Find learner under the top bar; per-course schedule in History
- **Placement:** `FindLearnerPanel.tsx` now exports two parts. `FindLearnerSearch` is a full-width, wrapping bar rendered right after the
  `<header className="topbar">` (above `.shell-body`); `FindLearnerResult` is the opened learner (actions + History & orders) and takes the
  left column (`.slot-side`) in place of the slot panel while `lookupTarget` is set (close button, or any calendar click, restores it).
  The search box clears itself when the learner closes.
- **Per-course schedule:** in `LearnerHistory` each bookable order has an `OrderSchedule` dropdown (closed by default) listing that
  order's classes from `useOrderSlots` (linked + older-by-course; past, tentative and confirmed; cancelled/rejected excluded). The slot
  query now also selects the lesson number (`lesson:lesson_id(number)`); instructor names come from `useInstructorNames`. The Orders
  section is a plain list: every order one after another, each with its own dropdown (no tabs; tabs were built and then removed at the
  user's request). Pure helpers in `orderSlots.ts`: `slotStatus` (Tentative / Booked /
  Completed / Paused), `localDateOf` (no UTC shift); tested in `tests/order-slots.test.mjs`.
- Verified in headless Chromium with the real components and the database calls answered by the test script (two courses, 6 classes), at
  1366px and 1024px: bar under the top bar at full width, no overflow, right class counts per course.

## 15b. Class limit per order (gating the number of tentative slots)
A booking linked to an order may hold at most the classes the order has left.
- **Rule** (pure, `orderSlots.ts`, tested in `tests/order-slots.test.mjs`): `classBudget(total, slots, ownRowIds)` ->
  `{ total, bookedElsewhere, remaining }`; `moreAllowed(budget, selected)`; `overBy(budget, selected)`. `ownRowIds` are the classes of the
  booking being edited, so a booking never counts against itself. An unknown size (`total` null/0) limits nothing.
- **Size of an order:** `enrollment.progress.total_hours`, else `Courses.duration` (the figure History & orders shows). **Booked** = every
  class attributed to the order (linked or by course, tentative or confirmed, past or upcoming; cancelled/rejected ignored; same
  attribution as History: `fetchOrderSlots`).
- **Where it is enforced:** `useOrderBudget` / `fetchOrderBudget` (`sales-dashboard/orderBudget.ts`). Dashboard: `handleSlotSelect` refuses
  an extra class and a fresh start on a full order; `handleAddBulkSlots` keeps only what fits and reports the rest. Form: budget banner,
  **+ Add another class** / **Bulk Add** disabled at the limit, `validateForm` blocks save when over, and `createTentativeMutation`
  re-fetches the budget from the database before writing (covers a colleague booking meanwhile).
- **Limits:** a demo credit that shortens a course is not modelled (the course's full duration is used). Orders with no known size are
  unlimited. Two agents saving at the same instant can still race past the re-check (no database constraint backs it).

## 15a. Find learner placement, and name search returns every match
- **Placement:** `FindLearnerPanel` is its own tinted card (`<section>`), the first child of a new `.slot-side` column that also holds the
  slot / booking `aside.slot-panel`. `.slot-side` is the sticky, 400px, height-limited element; the panel fills what the card leaves
  (`min-height: 240px`), and while a learner is open the card takes the whole column and the slot panel is not rendered.
- **Name search is not capped.** `useLearnerSearch` pages through the database 1000 rows at a time (`.range`, ordered by
  `created_at desc, id desc` so pages never skip or repeat) until a page comes back short, and lists every match with a count. The only
  limit is a 10,000-row safety net (`MAX_RESULTS`) that no real 3+ letter search reaches; if it ever does the list says so. A search
  still needs 3+ characters (fewer would match nearly everyone).

## 15. History & orders: Book classes vs Edit slots
Each bookable order in History & orders reflects the classes booked against it:
- **Which classes belong to an order** (`useOrderSlots` + `assignSlotsToOrders` in `src/lib/sales-dashboard/orderSlots.ts`, tested in
  `tests/order-slots.test.mjs`): (1) *linked*: `tentative_details.enrollment_id` is the order; (2) *older classes*, attributed by
  course: the learner's classes (`Schedule.learner_id`) whose `course_id` equals the order's course, plus Instructor Management holds
  matched by the phone saved on the hold + course. A link always wins over the course; an order shared by two enrollments of one
  course goes to the newest. A top-up has no course, so only a link attaches classes to it. Cancelled / rejected classes are
  ignored. Past dates and Operations-confirmed classes count.
- **No classes booked**: **Book classes**. **Classes booked**: "N classes booked [of M] · next <date time>" (or "(earlier dates)",
  or "· confirmed" when all are confirmed) and **Edit slots** for the tentative ones. **Book classes is not offered** once any class is
  booked: more are added inside the edit form ("+ Add another class").
- **Edit slots** (`editOrderSlots` in `SalesDashboard`): checks edit permission (`getTentativePermissions`, reading either
  `payment_status` or Instructor Management's `paid_info` via `slotPaymentStatus`), loads the instructor's Schedule **with the classes'
  date range** (`loadInstructorRange` -> `doLoad({ range })`; the grid window normally starts tomorrow, so earlier classes were
  never loaded), then, once the class is in `data.blocks`, runs the normal `handleEditBooking` flow. 20 s timeout with a message.
  A later refresh returns that instructor to the normal window, which is fine: an opened edit keeps its own state.
- Confirmed (Operations) classes are counted but not editable here. The link is still not copied onto a class when Operations
  confirms it (open item), so a *confirmed top-up class* cannot be attributed to its top-up.

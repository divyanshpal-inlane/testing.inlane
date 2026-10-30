Subject: New in the Sales Dashboard — additional services, manual payments, and easier learner lookup

Hi team,

A set of updates to the Sales Dashboard and Learner Management are ready for review and release. PR: https://github.com/inlane/inlane-web-app/pull/524

Here's what's new, in plain terms:

**1. Sell more to an existing customer, right from their profile**
Open any learner and you'll find "Services & payments." From there you can sell them another course, top-up classes, or a licence service (RTO) — each with a one-click "Create & send link" or "Create & copy link" so you can WhatsApp/email it yourself.

**2. Record a payment the customer made outside the link**
If someone pays by cash, UPI, or bank transfer instead of using the payment link, you can now record it directly: pick how it was paid, enter the UTR (for UPI/bank transfer), the date, and attach a photo/screenshot as proof. The order is marked paid immediately and the customer gets the usual confirmation — no need to chase a link payment that already happened.

**3. "Find learner" is now two clear halves**
- **Left: Find learner** — search any existing customer by Lead ID, Name, or Phone to see their orders, payments, and booking history. No slot click needed.
- **Right: New learner** — create a brand-new learner and send their payment link, the same flow as Learner Management, without leaving the dashboard. Once created, you're taken straight into that learner's full profile (with Send Payment Link / Edit / Additional Service / Delete) and a clear **Back** button, so you can keep working on them immediately.

**4. History & Orders, improved**
Every learner's order list now shows how many classes are booked out of how many are allowed, with a direct "Edit slots" or "Book classes" button per order. Each order also has its own "Send payment link / Copy / Record manual payment" right where you need it.

**5. Booking limits enforced automatically**
The system now stops you from booking more classes than a learner has paid for — it shows a clear message and disables the button rather than letting the batch go over.

**6. Smaller fixes**
- Only active instructors show up on the booking grid (on-break/inactive instructors are hidden, as before).
- Slot details now look the same whether the class is pending, paused, booked, or completed.
- Fixed a scrolling glitch where the side panel would visibly shrink while scrolling.
- Licence-only services (RTO) are now paid for without accidentally unlocking driving lessons.

**What's already live:** the backend (database changes and payment functions) behind all of this is already running in production. This release is the dashboard catching up to it — once the PR is merged and deployed, these features will be visible to everyone.

**Please test before using on a real customer:** manual payment recording and licence-service payments haven't yet been tried against a live payment in production, so the first few should be double-checked.

Happy to walk anyone through the new screens — just ask.

Thanks,
[Your name]

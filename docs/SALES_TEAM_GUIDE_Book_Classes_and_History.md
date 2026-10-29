# Booking Classes for a Service, and the Learner History: Sales Team Guide

*For: Sales and iLeads team. No technical knowledge needed.*

This guide covers three things on the Sales Dashboard:

1. **Book classes** for a course or top-up you just sold.
2. The **History & orders** section in the left panel (everything a learner has bought and paid).
3. **Slots linked to a service by default**, so every class is traced to the order it belongs to.

---

## 0. Find a learner (no slot needed)

Just **below the top bar**, across the full width of the page, there is a **Find learner** bar. It is a separate, lightly coloured bar, so it is never confused with the booking form. The learner you open appears in the **left column**, where the slot panel normally is. Use it to open any learner, see their **History & orders**, send a payment link, sell a service or book classes, even if you have not clicked a slot.

Pick how to search with the three small tabs:

| Tab | What to type | What happens |
|---|---|---|
| **Lead ID** (default) | The Cratio Lead ID, then press **Find** (or Enter) | The learner's phone number is fetched from Cratio, and the learner is searched by that number. |
| **Name** | At least 3 letters of the name or e-mail | **Every** matching learner is listed (newest first), with a count such as "37 learners found". Scroll the list and pick one. A masked phone number is shown beside each name to tell people with the same name apart. |
| **Phone** | A 10-digit number, then **Find** | The learner with that number. |

Whichever tab you use, the learner is finally found by **phone number only**. The number is shown masked unless your account may see it.

You then see, in the panel: **Learner** (their status and buttons: Send Payment Link, Edit, Additional service, Delete) and, directly below, **History & orders**.

- If the lead or number has **no learner yet**, you see **Create New Learner**, pre-filled from the CRM lead.
- If a Cratio lead has **no phone number**, the box says so. Search by name instead.
- Press **x** on the grey bar to close the learner. Clicking any slot on the calendar also closes it and returns to the usual slot view.
- Pressing **Book classes** on an order closes the learner view and starts booking, as in section 1.
- If a booking form was open, it is only hidden, not lost. Close the learner and press **Back to booking form**.

---

## 1. Book classes for a service you sold

### From "Services & payments"
1. Open the learner's **Additional service** dialog (left panel, after you click one of their slots).
2. Sell **Another course** or **Top-up classes** and press **Create & send link** (or **Create & copy link**).
3. The **Services & payments** tab opens with a green message: *"Beginner Course added. Book its classes now?"* Press **Book classes**.
   - You can also press **Book classes** on any service card at any time.
4. The dialog closes and a banner appears: *"Booking classes for NAME: Beginner Course · 10 classes. Click any white (free) cell on the calendar to pick the first class."*
5. Click a **white (free) cell**. The booking form opens with the **learner, phone, email, service and payment status already filled in**. The form shows a blue line: *"For service: Beginner Course"*.
6. Add more classes with **+ Add another class** if the learner needs several, then save.

Press the **x** on the banner to cancel. Nothing is saved until you submit the form.

### From the learner's History & orders
Scroll to **History & orders** in the left panel (section 2). Each order shows one of two things:

- **No classes booked yet:** a **Book classes** button.
- **Classes already booked:** a line such as *"2 classes booked of 10 · next 26 Oct 5:30 PM"* and an **Edit slots** button. **There is no Book classes button** once classes are booked; to add more, press **Edit slots** and use **+ Add another class** in the form.

**Which classes count as booked for an order:** every class linked to that order, **and** older classes of the same learner for the same course that were booked before linking existed (for example holds made in Instructor Management, or classes Operations confirmed). Earlier dates count too.

**Edit slots** opens that booking in the booking form so you can move a class, remove one, or add another. It works for earlier dates as well (the app loads them for you). Things to know:
- You can only edit a booking you are allowed to edit (the creator, a super admin, or anyone while it is unpaid). Otherwise you see the reason instead.
- Classes **Operations has already confirmed** are counted but cannot be edited here. If all of an order's classes are confirmed you see *"... booked · confirmed"* and no button.

### You are not asked for the learner or service again
When you start from **Find learner**, from **History & orders** (Book classes / Edit slots), or when the form finds the learner by the phone number, the booking form already has the learner and the service filled in. It then shows only a blue line **"For service: Beginner Course"**. The **Existing learner** search box and the **Service for these classes** drop-down are **hidden**; there is nothing to pick. If the learner has more than one service, a small **Change** link on that blue line lets you pick a different one.

The **Existing learner** search box only appears when the form does not yet know who the customer is.

### From a free slot (no service started yet)
1. Click a **white (free) cell**. The booking form opens.
2. In **"Existing learner (book for one of their services)"**, type at least 3 letters of the learner's **name or e-mail** and **pick them from the list**. You do not need their phone number (the list shows a masked one only to tell namesakes apart).
3. The name, phone, email and address fill in automatically (the real number is copied for you and stays hidden if you may not see it). If the learner has services, pick one under **"This slot is for"** (if there is only one, it is chosen for you). Press **x** to choose a different learner.
4. Save as usual.

If nobody matches, check the spelling, or just fill the form normally. You can create the learner after booking.

The same name search is available in the learner panel when a booking has no phone number saved.

> A licence service (2W/4W LL, DL) has no **Book classes** button. It has no classes to book.

---

## 1a. You can only book the classes the order has left

Every course or top-up covers a fixed number of classes (for example a course of 10, or a top-up of 4). When you add or edit slots, the booking form shows what is left on that order, in the box above **+ Add another class**:

> **Beginner Course**: 10 classes · 5 already booked · **5 left**. 3 selected, 2 more can be added.

- The **already booked** number counts every other class on that order, including older classes and classes Operations has confirmed. The classes of the booking you are editing are **not** counted against themselves, so editing never "uses up" its own classes.
- When the booking holds all that is left, the box turns amber ("This booking uses all of them") and **+ Add another class** and **Bulk Add** are greyed out.
- **Bulk Add** adds only as many classes as fit and tells you how many were left out.
- If you somehow have more selected than the order allows, the box turns red ("remove 2") and **Create / Save** will not go through until you remove them.
- When you press **Create / Save**, the app checks the count **again against the live data**, in case a colleague booked on the same order a moment ago. If it no longer fits you get a clear message and nothing is saved.
- **Book classes** on an order that is already full says so, and points you to **Edit slots**.
- If the order's size is not known (no course length on record), nothing is limited and the box is not shown.

---

## 2a. Every course has its own schedule

In **History & orders**, the **Orders** section is a plain list: **every course the learner has, one after another** (no tabs). Each course has its own **Schedule** drop-down, closed by default, headed *"Schedule · 5 classes"* (or *"Schedule · 0 classes"* when nothing is booked yet). Click it to see **only that course's classes**, in date order. Each row shows:
- the day, date and time (for example *Wed 28 Oct · 5:30 PM – 6:30 PM*);
- the **class number** and the **instructor**;
- a status tag: **Tentative** (a hold), **Booked** (confirmed by Operations), **Completed**, or **Paused**.

Classes on earlier dates are shown faded, and today's class is marked **TODAY**. This includes older classes that were booked before slots were linked to orders (matched by the learner and the course). A licence service has no classes, so it has no Schedule.

---

## 2. The History & orders section

Click any **yellow (tentative) slot**. The learner opens in the left panel. **Learner** (who they are, and the buttons) is on top and **History & orders** is directly below it. Both are visible at once, so there is nothing to click to see the history.

**History & orders** shows, for your reference:

| Part | What you see |
|---|---|
| **Summary** | Number of **Orders**, total **Paid**, and **Outstanding** (ordered minus paid). |
| **Warning** | *"N manual payments awaiting verification"* when a colleague still has to verify. |
| **Orders** | Every course, top-up and licence service, newest first, with date, amount, classes and a **Paid / Half paid / Unpaid** tag. An order with no classes booked has **Book classes**; one with classes booked shows how many and **Edit slots** (no Book classes). |
| **Payments** | Every payment with its **Payment ID** (click to copy), amount, status, **UTR**, who recorded it, **View proof**, and whether it is **online**, **verified** or **awaiting verification**. |
| **Payment links sent** | Each link's ID, service, amount and when/by whom it was sent or copied. |

It is read-only, so you cannot change anything by accident.

---

## 3. Every slot is linked to a service by default

A booking can carry two different things, and they are easy to mix up:

| Thing | What it is |
|---|---|
| **Course written on the booking** | Only a note, for example *"Comprehensive/Beginner's course"*. It is **not** a link to anything. |
| **Service linked to the slot** | The learner's actual order. This is what makes the class count against that order and what decides the **Payment** label. |

From now on **slots are linked to the learner's service automatically. You do not link them by hand and there is no "Not linked" box to deal with.**

**When you book a slot** (the booking form):
- The form finds the learner by the phone number (from the CRM autofill, or the existing-learner search).
- If the learner has services, one is **chosen for you** (the one that matches the course, or their only service). The field is called **"Service for these classes"**. You can switch to another of their services. If they have several and none stands out, you **must choose one** before you can save.
- A linked slot has no separate **Course** field; its course is the service's name.
- If there is **no learner or no service yet**, you see a yellow note and the slot is saved. It **links itself** as soon as the service exists (see below).

**Later, a slot links itself when:**
- you create the learner or sell a service from that slot's panel;
- you open an old or unlinked slot and exactly one of the learner's services matches its course (or, if it names no course, the learner has exactly one service). If it would be a guess, nothing is linked and nothing is changed.

**Seeing it:** a linked slot shows a green **"Service: Beginner Course · Paid"** line in the Learner section. That is the order's **live** payment status; if the customer pays later, the slot's **Payment** label follows by itself the next time the slot is opened.

**Payment is never typed in.** It is not a field on the booking form (Sales Dashboard) or in Instructor Management. A slot shows **Unpaid** until it is linked, and then it shows its service's status. The customer pays through a payment link.

Linking checks that the slot has not changed meanwhile (for example confirmed by Operations). If it has, nothing is changed.

## 4. Questions

**Why does the form show "For service: ..." and can I remove it?**
It records which order these classes belong to. Press **Remove** next to it to book without a service.

**I pressed Book classes but nothing opened.**
Look for the blue-white banner near the top: you now click a **white cell** on the calendar. The booking form opens only after you pick a slot.

**I started "Book classes" but changed my mind.**
Press **x** on the banner. If you already picked 2 or more classes for another booking, the app asks before it replaces them.

**Can I book classes for a service that is still unpaid?**
Yes. The classes are saved as tentative holds and the service stays **Unpaid** until the customer pays or you record the payment.

**Where do the top-up or course classes show up afterwards?**
On the slot card (the service name), in the learner's **History & orders**, and in **Learner Management > Courses & services**.

**History & orders says "No orders yet".**
The learner has not bought anything yet. Use **Additional service** to sell one.

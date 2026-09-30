# Operations Action Required: Instructor Map vs DB Mismatches

**Date:** 2026-09-28  
**Prepared for:** Operations Team  
**Context:** New KMZ file (`Copy of Lane instructor driving zones.kmz`) has updated instructor zones. Current map (`public/instructors.kml`) and database have gaps.  
**Verified against:** Live instructor spreadsheet (91 rows in DB/Vite)

---

## 🔴 CRITICAL: Only 1 Instructor on Map Has No Database Record

| #   | Instructor Name (on Map) | Zone Area                               | DB Status                                        | Action Required                                           |
| --- | ------------------------ | --------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| 1   | **Rajesh M T**           | Near Nageshwar (point only, no polygon) | **NOT in DB** — not onboarded yet                | Ignore (not onboarded) or create DB record + draw polygon |
| 2   | **Syed Alishan**         | New zone                                | **NOT in DB** — Mysuru instructor, not onboarded | **Ignore** (per ops)                                      |

---

## ✅ CONFIRMED IN DB — All Map Polygons Have DB Records

| Map Polygon Name         | DB Row | DB Name                  | Status           | Area                   | Match Notes                        |
| ------------------------ | ------ | ------------------------ | ---------------- | ---------------------- | ---------------------------------- |
| Santhosh                 | Row 82 | Santhosh                 | Active, Online   | BTM Layout, JP Nagar   | **Exact match** — polygon near BTM |
| Mohammed Rafi            | Row 84 | Mohammed Rafi            | Active, Online   | Whitefield             | Exact match                        |
| Madhusudana B S          | Row 86 | Madhusudana B S          | Active, Online   | Kumaraswamy Layout     | Exact match                        |
| Yuvaraj M                | Row 87 | Yuvaraj M                | Active, Online   | Bellandur              | Exact match                        |
| Siddeshwara CS           | Row 91 | Siddeshwara CS           | Active, Online   | HSR Layout, Kudlu Gate | Exact match                        |
| Narasimhareddy           | Row 89 | Narasimhareddy           | Active, Online   | Yelahanka New Town     | Exact match                        |
| Mohan Kumar K S          | Row 90 | Mohan Kumar K S          | Active, Online   | Arekere, Bommanahalli  | Exact match                        |
| Prabhavathy Sadesh kumar | Row 88 | Prabhavathy Sadesh kumar | Active, Online   | Indiranagar            | Exact match                        |
| Saveen Kumar             | Row 64 | Saveen Kumar             | Active, On Break | Somasundarapalya       | Exact match                        |
| Suresh Babu              | Row 85 | Suresh Babu              | Active, On Break | Frazer Town            | Exact match                        |
| Amanulla Khan            | Row 83 | Amanulla Khan            | Active, Online   | HSR Layout             | Exact match                        |

**Backfill script confirmation:** 66/68 polygons resolved. Only 2 unmatched: `Syed Ahmed ameen` (now `Ameen / Arokia` duplicate) and `Mohammed Imran` (now split into two polygons).

---

## ⚠️ TWO SANTOSH INSTRUCTORS IN DB — Only One Has Polygon

| DB Row | Name          | Phone      | Status         | Area                 | Map Polygon                                            |
| ------ | ------------- | ---------- | -------------- | -------------------- | ------------------------------------------------------ |
| Row 13 | **K Santosh** | 6303929972 | Active, Online | Whitefield           | **NO polygon** (only point `Santhosh??` 13.65 km away) |
| Row 82 | **Santhosh**  | 8970883416 | Active, Online | BTM Layout, JP Nagar | **YES** — polygon `Santhosh` near BTM                  |

**Issue:** K Santosh (Whitefield) has no polygon on map. The point `Santhosh??` on map is 13.65 km from the Santhosh polygon — likely meant for K Santosh but misplaced.

**Action Needed:** Draw polygon for **K Santosh (Whitefield)** or confirm Whitefield coverage not needed.

---

## 🟠 DECISION NEEDED: Ameen / Arokia — Two Zones, Two DB Rows

**Current State:**

- **Map (new KMZ)** has **two separate polygons** both named `Ameen / Arokia`
- **Database** has **TWO rows** (from spreadsheet):
  - Row 45: `Ameen / Nithin` — **Inactive**, CV Raman Nagar
  - Row 75: `Ameen / Arokia` — **Active, On Break**, CV Raman Nagar
- System only supports **one service zone per instructor** (`UNIQUE(instructor_id)`)

**Options:**

| Option                                      | Description                                                                    | Pros                               | Cons                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------- |
| **A. Merge polygons**                       | Combine both zones into one service area for active instructor (Row 75)        | Simple, keeps single active record | May create odd-shaped zone             |
| **B. Keep two polygons for one instructor** | Requires schema change to allow multiple zones per instructor                  | Accurate if same person            | Code change needed                     |
| **C. Map each polygon to separate DB row**  | Polygon 1 → `Ameen / Arokia` (active), Polygon 2 → `Ameen / Nithin` (inactive) | Matches DB structure               | Inactive instructor won't be scheduled |

**Decision Required:** Which option? Confirm if Row 45 and Row 75 are same person or different people.

---

## 🟠 HIGH PRIORITY: Krupakar Daniel Dennish — Active Instructor, No Zone

| Instructor                  | Current DB Areas | Status         | Live Slots at Risk |
| --------------------------- | ---------------- | -------------- | ------------------ |
| **Krupakar Daniel Dennish** | Indiranagar      | Active, Online | **~79 slots**      |

**Issue:** No polygon drawn for Indiranagar in either old or new map.

**Action Required:** Draw polygon for Indiranagar area on map, or confirm Indiranagar coverage should be dropped.

---

## 🟡 CLEANUP: Remove These from New Map Before Use

| Item on Map                 | Type    | Action                                                       |
| --------------------------- | ------- | ------------------------------------------------------------ |
| `Point 126`                 | Point   | Delete                                                       |
| `Point 144`                 | Point   | Delete                                                       |
| `Polygon 148`               | Polygon | Delete                                                       |
| `Polygon 149`               | Polygon | Delete                                                       |
| `Untitled layer` (5 layers) | Layer   | Delete                                                       |
| `Abdul Salam??`             | Point   | Rename to `Abdul Salam` or delete                            |
| `Santhosh??`                | Point   | **Review** — may be misplaced pin for K Santosh (Whitefield) |

**Non-instructor layers** (keep or remove?):

- `Non-demand blackout`
- `Non-demand area - ...` (10 layers)

---

## 🟡 Point-Only Instructors (No Polygon = Not Findable by Location)

| Name on Map            | DB Row | DB Status            | Note                                                          |
| ---------------------- | ------ | -------------------- | ------------------------------------------------------------- |
| Nageshwar Sharma       | Row 58 | Inactive             | Excluded — OK                                                 |
| Rizwan ahmed           | Row 5  | Inactive             | Excluded — OK                                                 |
| Chandrashaker / kishor | Row 57 | Kishor S — Inactive  | No polygon                                                    |
| Mohammed Haseeb        | Row 31 | Inactive             | No polygon                                                    |
| Mohammed Ilyaz         | Row 35 | Inactive             | No polygon                                                    |
| Rohith BR              | Row 61 | Inactive             | No polygon                                                    |
| **Abdul Salam**        | Row 77 | **Active, On Break** | **Active but no polygon — not findable by area**              |
| **K Santosh**          | Row 13 | **Active, Online**   | **Active but no polygon — only misplaced point `Santhosh??`** |

**Action:** Draw polygons for **Abdul Salam** (Row 77) and **K Santosh** (Row 13) if they should be findable by location search.

---

## 📋 Summary of Ops Deliverables

| Item                                                          | Count   | Deadline        |
| ------------------------------------------------------------- | ------- | --------------- |
| Ameen/Arokia decision (A/B/C)                                 | 1       | Before map swap |
| Krupakar polygon (Indiranagar)                                | 1       | Before map swap |
| K Santosh polygon (Whitefield)                                | 1       | Before map swap |
| Abdul Salam polygon (for location search)                     | 1       | Before map swap |
| Confirmation to remove junk items                             | 7 items | Before map swap |
| Decision on `Santhosh??` point (keep for K Santosh or delete) | 1       | Before map swap |
| Rajesh M T — ignore (not onboarded)                           | —       | No action       |
| Syed Alishan — ignore (Mysuru, not onboarded)                 | —       | No action       |

---

## 🗺️ Map Replacement Process (For Reference)

Once Ops provides the above:

1. Dev cleans KMZ (removes junk, fixes `Santhosh??` point)
2. Dev replaces `public/instructors.kml` with cleaned version
3. Dev runs backfill script to generate migration
4. Migration applied to database
5. New map goes live

**No code changes needed from Ops side** — only data corrections in DB and map.

---

## Contact

**Dev Team:** [Your dev contact]  
**Map File:** `Copy of Lane instructor driving zones.kmz` (in Downloads)  
**Current Live Map:** `public/instructors.kml` in repository

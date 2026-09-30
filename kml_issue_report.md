# KML Issue Report — `public/instructors.kml`

**Audited:** 2026-09-29
**Source:** `Copy of Lane instructor driving zones.kmz` → `doc.kml` → cleaned → `public/instructors.kml`
**Reproduce:** `node scripts/audit-instructors-kml.mjs` (read-only; needs `.env` for the DB cross-check)

## What the file is

`public/instructors.kml` is **backfill input only**. It is _not_ on the runtime read path — the sales dashboard
matches against `instructor_service_zones` rows in Postgres. The KML matters because it is the source those rows
were generated from, so an error here silently becomes an error in the live grid.

|                                       | Value                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Placemarks                            | 130 (66 polygons, 64 points)                                                                                   |
| Polygons resolving to an `Instructor` | 66 / 66, all distinct (0 unmatched, 0 name collisions)                                                         |
| Vertices per ring                     | 6–29 open (7–30 as stored closed), avg 15.9                                                                    |
| Area per polygon                      | 5.37 – 27.65 km², median 15.78 km²                                                                             |
| Point placemarks used at runtime      | **0** — backfill skips them (centroids, not coverage)                                                          |
| Junk placemarks                       | 18 dropped by `scripts/clean-instructors-kml.mjs` (`Point 126/144`, `Polygon 148/149`, 14 `Non-demand area …`) |

## Summary

| #   | Severity | Issue                                                                    | Count                             | Runtime impact                      |
| --- | -------- | ------------------------------------------------------------------------ | --------------------------------- | ----------------------------------- |
| 1   | **High** | Near-duplicate zones — one instructor's polygon is ≥80% inside another's | 23 pairs                          | Wrong coverage served               |
| 2   | **High** | Active instructors with no service zone at all                           | 7 (1 real, 4 test, 2 intentional) | Never auto-matched                  |
| 3   | Medium   | Point placemark falls outside its own polygon                            | 12                                | None (points skipped)               |
| 4   | Medium   | Point-only placemarks — no polygon in the KML                            | 6                                 | None directly; 3 are orphaned names |
| 5   | Low      | Empty descriptions                                                       | 4 polygons, 23 points             | None                                |
| 6   | Low      | Descriptions containing pricing / sales text                             | 3                                 | None (stored, not matched)          |
| 7   | Info     | Every coordinate carries an altitude component                           | 130 / 130                         | None (loader drops it)              |
| 8   | Info     | Polygon with no companion point                                          | 8                                 | None                                |
| 9   | Info     | `Instructor.name` has leading/trailing whitespace (DB, not KML)          | 8 rows                            | Trimmed on read                     |

**No geometry defects.** 0 unclosed rings, 0 self-intersecting rings, 0 rings with <3 distinct vertices,
0 out-of-range or non-finite coordinates, 0 duplicate consecutive vertices, 0 polygons with zero or
suspiciously small area, 0 polygons sharing identical vertices, 0 fully-contained pairs, 0 duplicate names
resolving to a conflict. Every ring is a simple, closed, in-range polygon.

---

## 1. Near-duplicate zones (High)

23 polygon pairs overlap such that the **smaller polygon is ≥80% inside the larger**. These read as
copy-paste errors in the Google Earth layer: one instructor's zone was probably traced from another's.
Since matching is "all instructors whose polygon contains the learner", a wrong zone both over-serves
learners in the overlap and under-serves them outside it.

| Coverage of smaller | Shared area | Instructor A                       | Instructor B                           |
| ------------------- | ----------- | ---------------------------------- | -------------------------------------- |
| 100%                | 8.7 km²     | N Praveen (20.8 km²)               | **Jawed (8.7 km²)**                    |
| 100%                | 5.6 km²     | Shivamurthy (18.2 km²)             | **Raju (5.6 km²)**                     |
| 99%                 | 8.2 km²     | Rehan Khan (16.7 km²)              | **Prabhavathy Sadesh kumar (8.3 km²)** |
| 98%                 | 5.3 km²     | Ameen / Arokia (11.8 km²)          | **Adnan Shama (5.4 km²)**              |
| 98%                 | 10.5 km²    | **Salauddin (10.6 km²)**           | Iftekhar (17.1 km²)                    |
| 97%                 | 17.5 km²    | Anas (18.0 km²)                    | Mohammed Hassan (Suraj) (22.6 km²)     |
| 97%                 | 8.0 km²     | Mohammed Hassan (Suraj) (22.6 km²) | Prabhavathy Sadesh kumar (8.3 km²)     |
| 95%                 | 17.9 km²    | Mohammed Hassan (Suraj) (22.6 km²) | Abdul Salam (18.9 km²)                 |
| 94%                 | 17.0 km²    | Anas (18.0 km²)                    | Abdul Salam (18.9 km²)                 |
| 94%                 | 9.0 km²     | Revanth (9.6 km²)                  | Abhishek (11.5 km²)                    |
| 94%                 | 7.7 km²     | Prabhavathy Sadesh kumar (8.3 km²) | Abdul Salam (18.9 km²)                 |
| 92%                 | 15.4 km²    | Mohammed Hassan (Suraj) (22.6 km²) | Rehan Khan (16.7 km²)                  |
| 92%                 | 7.1 km²     | BABAJAN N (12.0 km²)               | Pratheesh sohan d souza (7.7 km²)      |
| 88%                 | 10.6 km²    | Kishan Kumar R (12.9 km²)          | Mohan Kumar K S (12.0 km²)             |
| 87%                 | 11.7 km²    | Saveen Kumar (13.8 km²)            | Siddeshwara CS (13.5 km²)              |
| 87%                 | 15.1 km²    | Santhosh (17.4 km²)                | Bhanu Prakash (21.3 km²)               |
| 85%                 | 14.9 km²    | Irshad Hussian (27.6 km²)          | Pradeep BK (17.6 km²)                  |
| 85%                 | 14.1 km²    | Rehan Khan (16.7 km²)              | Abdul Salam (18.9 km²)                 |
| 84%                 | 7.0 km²     | Anas (18.0 km²)                    | Prabhavathy Sadesh kumar (8.3 km²)     |
| 83%                 | 13.9 km²    | Anas (18.0 km²)                    | Rehan Khan (16.7 km²)                  |
| 82%                 | 7.5 km²     | Mohammed Imran A(HSR) (9.2 km²)    | Siddeshwara CS (13.5 km²)              |
| 81%                 | 5.7 km²     | BABAJAN N (12.0 km²)               | Mathi Manohar (7.1 km²)                |
| 81%                 | 9.8 km²     | Shivamurthy (18.2 km²)             | Mohan Kumar K S (12.0 km²)             |

A dense cluster around **Anas / Mohammed Hassan (Suraj) / Abdul Salam / Rehan Khan / Prabhavathy Sadesh kumar**
(5 instructors, 6 pairs) suggests one region was traced repeatedly. Percentage is measured on a 200×200 grid
over the intersection bounding box, so values at exactly 100% mean "the smaller ring is inside the larger to
within measurement error".

**Action for Ops:** re-trace the smaller polygon in each pair, or confirm the overlap is intentional
(e.g. two instructors genuinely covering the same locality).

Beyond these, 85 further pairs share ≥0.5 km² and 108 pairs share any area at all — some overlap between
neighbouring zones is expected and healthy; only the ≥80% cases warrant a look.

## 2. Active instructors with no service zone (High)

8 `Instructor` rows have no polygon in the KML. 7 are `active`:

| Instructor                       | Status   | Assessment                                          |
| -------------------------------- | -------- | --------------------------------------------------- |
| **Hidayat**                      | active   | **Real person with no coverage — needs a polygon**  |
| `ankit_ins`                      | active   | Test row                                            |
| `test_ins_hidayat_dont_delete`   | active   | Test row                                            |
| `test-instr-latehrs_dont_delete` | active   | Test row                                            |
| `Priyanka Jain (test)`           | active   | Test row                                            |
| `Amanulla Khan`                  | active   | Company backup — **intentional**, Ops-assigned only |
| `Krupakar Daniel Dennish`        | active   | Company backup — **intentional**, Ops-assigned only |
| `Ankit_ins_test`                 | on_break | Test row                                            |

A further 54 `inactive` instructors have no placemark at all, which is expected.

`test_dp` is a pre-existing mock zone row (4 pts, unclosed, `"MOCK test polygon - safe to delete"`) that exists
only in the DB, not the KML. Safe to delete with Ops approval.

## 3. Point placemarks outside their own polygon (Medium)

12 of 64 points do not fall inside the polygon carrying the same name. The point layer is therefore not a
reliable centroid of the zone it labels. **No runtime impact** — backfill skips point placemarks entirely
(`UNIQUE(instructor_id)` allows one row per instructor, and a centroid is not coverage). It does mean the
visible dot in Google Earth can disagree with the filled zone, which is how a hand-maintained layer drifts.

| Instructor    | Point vs. its own polygon                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| Santhosh      | 13.8 km away — point (12.99963, 77.49592), zone centred near (12.9184, 77.5924) |
| Anas          | 5.8 km                                                                          |
| Adnan Shama   | 5.8 km                                                                          |
| Yuvaraj M     | 5.6 km                                                                          |
| Vinod Kumar   | 5.3 km                                                                          |
| BABAJAN N     | 4.2 km — point sits on a shared vertex of the `P Rama Mohan` polygon            |
| Basavaling SH | 3.8 km                                                                          |
| Harish P      | 3.6 km                                                                          |
| A Sagar Rao   | 3.1 km                                                                          |
| K Santosh     | 3.0 km                                                                          |
| Chandan SK    | 2.6 km                                                                          |
| Arun M        | 2.2 km                                                                          |

`Santhosh` is the worst offender by an order of magnitude and looks like a genuinely wrong coordinate.

## 4. Point-only placemarks (Medium)

6 placemarks have a point but no polygon, so they contribute no coverage:

| Placemark                  | In the `Instructor` table? | Status              |
| -------------------------- | -------------------------- | ------------------- |
| Rohith BR                  | yes                        | inactive / disabled |
| Nadeem Ar                  | yes                        | inactive / disabled |
| Nageshwar Sharma           | yes                        | inactive / disabled |
| **Chandrashaker / kishor** | **no — orphan**            | n/a                 |
| **Rajesh M T**             | **no — orphan**            | n/a                 |
| **Syed Alishan**           | **no — orphan**            | n/a                 |

The 3 orphans are dead names in the KML that will never resolve to an instructor. Worth deleting in the next
export so the "every polygon resolves" invariant stays checkable.

## 5. Empty descriptions (Low)

27 placemarks have an empty description — **4 polygons** and 23 points.

- Polygons: **Jawed**, **Jobin Thomas**, **Mohammed Imran A(HSR)**, **Saveen Kumar**
  (these are real SQL `NULL`s in `instructor_service_zones.description`, not empty strings)
- Points: 23, mostly redundant with their polygon's note

Descriptions are stored for reference only; matching never reads them.

## 6. Pricing / sales text in service-area notes (Low)

3 polygons carry commercial content that does not belong in a service-area description. It is currently
surfaced in the instructor edit dialog and the onboarding review step, so sales pricing is visible wherever
the zone note is read.

| Instructor               | Description                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Adnan Shama              | `… \| 9000 - 10 class` (polygon); the point carries the full price list incl. `₹13,500`                                                    |
| Prabhavathy Sadesh kumar | `10 class - 9000 \| LL + DL Service: ₹4,000 Extra \| Total (Classes + LL + DL): ₹13,000 - 4 W Only and for 2 W - 2500 Extra - 15000 Final` |
| Mathi Manohar            | `10 class - 9000 \| LL + DL Service: ₹4,000 Extra \| Total (Classes + LL + DL): ₹13,000 - 4 W Only and for 2 W - 2500 Extra - 15000 Final` |

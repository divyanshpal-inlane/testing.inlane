# Instructor Name Ambiguity Report — Unresolved Issues Only

**Generated:** 2026-09-28  
**Context:** Analysis after comparing current `public/instructors.kml` vs new KMZ (`Copy of Lane instructor driving zones.kmz`) vs DB (130 instructors)

---

## 1. Polygons Without DB Instructor (Critical — Cannot Schedule)

These polygons exist in the **new KMZ** but have **no corresponding instructor in the DB**. Learners in these zones will find no instructors.

| #   | KMZ Polygon Name    | Type       | Area           | Notes                                                                 |
| --- | ------------------- | ---------- | -------------- | --------------------------------------------------------------------- |
| 1   | **Santhosh**        | Polygon    | Near BTM       | Also has `Santhosh??` point 13.65 km away — likely 2 different people |
| 2   | **Rajesh M T**      | Point only | Near Nageshwar | No polygon, no DB match                                               |
| 3   | **Mohammed Rafi**   | Polygon    | New in KMZ     | No DB match                                                           |
| 4   | **Madhusudana B S** | Polygon    | New in KMZ     | No DB match                                                           |
| 5   | **Yuvaraj M**       | Polygon    | New in KMZ     | No DB match                                                           |
| 6   | **Siddeshwara CS**  | Polygon    | New in KMZ     | No DB match                                                           |
| 7   | **Narasimhareddy**  | Polygon    | New in KMZ     | No DB match                                                           |
| 8   | **Mohan Kumar K S** | Polygon    | New in KMZ     | No DB match                                                           |
| 9   | **Syed Alishan**    | Polygon    | New in KMZ     | No DB match                                                           |

**Action Required:** Create DB instructor records for all 9, or remove polygons if invalid.

---

## 2. Multi-Polygon / Single DB Instructor (Schema Conflict)

### Ameen / Arokia — **Two Polygons, One DB Row**

| Polygon in KMZ | Raw Name                                          | Coordinates Area     |
| -------------- | ------------------------------------------------- | -------------------- |
| Polygon A      | `Ameen / Arokia` (first)                          | Kengeri              |
| Polygon B      | `Ameen / Arokia` (second, was `Syed Ahmed ameen`) | Adjacent/overlapping |

**DB State:** Single instructor `Ameen / Arokia` (id: `b0f53106-1f87-444f-9e9e-bcdf7c864076`)

**Constraint:** `instructor_service_zones` has `UNIQUE(instructor_id)` — only **one row per instructor** allowed.

**Options:**

- **Merge polygons** → Single service zone (recommended if same person)
- **Split DB row** → Create second instructor (e.g., `Arokia` separate from `Ameen`) — requires schema change to allow multiple zones
- **Pick one polygon** → Drop coverage for the other area

**Decision Needed:** Confirm with ops whether this is one instructor with two zones or two people sharing a DB row.

---

## 3. Aliases Still Needed in `KML_ALIASES` (Code)

After swapping to new KMZ, only **one alias** remains necessary:

```typescript
const KML_ALIASES: Record<string, string> = {
  "niteesh reddy": "nitheesh reddy", // KML: "Niteesh Reddy" → DB: "Nitheesh Reddy"
};
```

**File:** `src/lib/sales-dashboard/kml.ts:107-123` — reduce from 16 entries to 1.

---

## 4. Point-Only Instructors (No Polygon = Not Schedulable via Location Search)

These have **points in KMZ but no polygon**. They will **not appear** in location-based search (polygon ray-casting only). Name search still works.

| KMZ Point Name         | DB Match              | Status                           | Notes                            |
| ---------------------- | --------------------- | -------------------------------- | -------------------------------- |
| Nageshwar Sharma       | ✅ `Nageshwar Sharma` | on_break                         | Excluded by default              |
| Rizwan ahmed           | ✅ `Rizwan ahmed`     | on_break                         | Excluded by default              |
| Chandrashaker / kishor | ✅ `Kishor S`         | Point alias                      | No polygon                       |
| Mohammed Haseeb        | ✅ `Mohammed Haseeb`  | inactive                         | Point only                       |
| Mohammed Ilyaz         | ✅ `Mohammed llyaz`   | inactive                         | Point only                       |
| Rohith BR              | ✅ `Rohith BR`        | inactive                         | Point only                       |
| Abdul Salam??          | ❓ `Abdul Salam`      | Typo in name                     | Clean up                         |
| Santhosh??             | ❓ `Santhosh`         | Duplicate point far from polygon | Likely different person — remove |
| Point 126              | ❌ None               | Junk                             | Remove                           |
| Point 144              | ❌ None               | Junk                             | Remove                           |

---

## 5. DB Instructors at Risk of Losing Coverage (Map-First Model)

If system switches to **KML as source of truth** (polygon-based matching), these active instructors have **no polygon in either KML**:

| DB Instructor                  | Current DB Areas             | Status     | Impact                                |
| ------------------------------ | ---------------------------- | ---------- | ------------------------------------- |
| **Krupakar Daniel Dennish**    | Indiranagar                  | active/en  | **~79 live slots** — biggest casualty |
| Priyanka Jain (test)           | HSR Layout                   | active/en  | Test instructor                       |
| Paused Lessons Vaishnavi       | Adugodi                      | active/en  | Paused                                |
| test_ins_hidayat_dont_delete   | Adugodi/aavalahalli/Abbigere | active/en  | Test                                  |
| test-instr-latehrs_dont_delete | Jp nagar                     | active/en  | Test                                  |
| Hidayat                        | (none)                       | active/dis | No areas, no coords                   |

**Areas losing all coverage:** Adugodi, aavalahalli, Abbigere (only test instructors).

**Action:** Draw polygon for Krupakar (priority) or accept coverage loss.

---

## 6. Junk / Cleanup Items in New KMZ (Must Remove Before Swap)

| Item                        | Type    | Action                            |
| --------------------------- | ------- | --------------------------------- |
| `Point 126`                 | Point   | Remove                            |
| `Point 144`                 | Point   | Remove                            |
| `Polygon 148`               | Polygon | Remove                            |
| `Polygon 149`               | Polygon | Remove                            |
| `Untitled layer` ×5         | Layer   | Remove                            |
| `Non-demand blackout`       | Layer   | Keep? (non-instructor)            |
| `Non-demand area - ...` ×10 | Layer   | Keep? (non-instructor)            |
| `Abdul Salam??`             | Point   | Rename to `Abdul Salam` or remove |
| `Santhosh??`                | Point   | Remove (confusing duplicate)      |

---

## 7. Backfill Script Output (Current KML — For Reference)

```bash
$ node scripts/backfill-instructor-service-zones.mjs
Parsed 137 placemarks from public/instructors.kml (68 polygons, 69 points).
Loaded 130 instructors for name resolution.
Resolved 66/68 polygons to instructors (62 point-only placemarks skipped).
Unmatched polygon names (2):
  Syed Ahmed ameen      → Now "Ameen / Arokia" in new KMZ (duplicate polygon)
  Mohammed Imran        → Now split into two polygons in new KMZ (resolved)
```

---

## 8. Required Actions Summary

| Phase                        | Action                                                                                                                                                        | Owner   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **1. Clean KML**             | Extract `doc.kml` from KMZ, remove 9 junk items, replace `public/instructors.kml`                                                                             | Dev     |
| **2. Update Aliases**        | Reduce `KML_ALIASES` to single entry (`niteesh reddy`)                                                                                                        | Dev     |
| **3. Create DB Instructors** | Insert 9 missing instructors (Santhosh, Rajesh M T, Mohammed Rafi, Madhusudana B S, Yuvaraj M, Siddeshwara CS, Narasimhareddy, Mohan Kumar K S, Syed Alishan) | Ops/Dev |
| **4. Resolve Ameen/Arokia**  | Decide: merge polygons OR create 2nd instructor OR pick one zone                                                                                              | Ops     |
| **5. Draw Krupakar Polygon** | Add Indiranagar polygon for Krupakar Daniel Dennish                                                                                                           | Ops     |
| **6. Regenerate Migration**  | Run backfill script → new SQL migration                                                                                                                       | Dev     |
| **7. Verify & Deploy**       | `lint` → `type-check` → `build` → deploy migration → redeploy                                                                                                 | Dev     |

---

## 9. Files to Modify

| File                                                                        | Change                                       |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| `public/instructors.kml`                                                    | Replace with cleaned KMZ `doc.kml`           |
| `src/lib/sales-dashboard/kml.ts:107-123`                                    | Reduce `KML_ALIASES` to only `niteesh reddy` |
| `supabase/migrations/20260928_010000_backfill_instructor_service_zones.sql` | Regenerate after KML swap                    |
| DB: `Instructor` table                                                      | Insert 9+ new instructors                    |
| DB: `instructor_service_zones`                                              | Populated by backfill migration              |

---

**Blockers:** Ameen/Arokia decision (ops), 9 missing instructor records (ops), Krupakar polygon (ops).

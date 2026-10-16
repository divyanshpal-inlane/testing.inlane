# Active Learners Slow Loading - Root Cause Analysis

## Problem Statement

Active learners are loading very slowly after clicking the Schedule Management page.

---

## Root Causes

### 1. **Multiple Sequential Database Queries (N+1 Query Problem)**

**Location:** `src/routes/admin/schedules.tsx` (Lines 647-806)

**Issue:**
The `activeLearners` query performs multiple sequential database operations:

#### Step 1: Fetch All Active Enrollments with Pagination

```typescript
// Lines 662-675
for (let page = 0; ; page++) {
  const from = page * ENROLLMENT_PAGE; // 1000 per page
  const to = from + ENROLLMENT_PAGE - 1;
  const { data, error } = await supabase
    .from("enrollment")
    .select("learner_id, progress, Courses(total_lessons, duration)")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .range(from, to);
  // ...
}
```

**Performance Impact:**

- If there are 5000 active enrollments, this makes **5 sequential queries** (5 pages × 1000 records each)
- Each query waits for the previous one to complete
- Network latency multiplies: ~200-500ms per query = **1-2.5 seconds total**

---

#### Step 2: Batch Fetch Learners with All Their Schedules

```typescript
// Lines 684-742
const BATCH_SIZE = 50;
const batches: string[][] = [];
for (let i = 0; i < learnerIds.length; i += BATCH_SIZE) {
  batches.push(learnerIds.slice(i, i + BATCH_SIZE));
}

const batchResults = await Promise.allSettled(
  batches.map(async (batch) => {
    const { data, error } = await supabase
      .from("Learner")
      .select(
        `
        id, name, area, phone, email, preferred_start_date,
        preferred_completion_days, prefers_two_hour_classes,
        two_hour_days, DL_test_date, pick_up_location,
        created_at, address_lat, address_lng,
        schedules:Schedule(
          id, date, start_time, end_time, instructor_id,
          lesson_id, course_id, learner_id, status,
          started_at, ended_at,
          Lesson(id, number),
          Instructor(name)
        )
      `,
      )
      .in("id", batch)
      .order("created_at", { ascending: false });
    // ...
  }),
);
```

**Performance Impact:**

- If there are 500 unique learners → **10 batches** (500 ÷ 50)
- Each batch fetches **all schedules** for 50 learners (could be 10-50 schedules per learner)
- With `Promise.allSettled`, these run in parallel, but:
  - Database must join `Learner` → `Schedule` → `Lesson` → `Instructor` for each batch
  - Each learner might have 10-30 schedules
  - Total data transfer: 500 learners × 20 schedules avg × multiple joins = **massive data payload**
  - Processing time: **2-5 seconds** depending on data size

---

### 2. **Fetching Unnecessary Schedule Data**

**Issue:**
The query fetches **ALL schedules** for every active learner, even though:

- The Active Learners list only needs basic learner info and summary stats
- Individual schedule details are only needed when a learner is selected
- Most schedules are never viewed in the initial list

**Data Transferred:**

- For 500 learners with an average of 20 schedules each:
  - 500 × 20 = **10,000 schedule records**
  - Each schedule includes: date, times, instructor, lesson, course, status, etc.
  - Estimated payload: **2-5 MB of JSON data**

**Why This is Inefficient:**

```typescript
// Lines 1556-1596: The list only displays learner name and basic info
activeOnlyLearners?.filter(...).map((learner) => (
  <LearnerInfoCard
    learner={{
      id: learner.id || "",
      name: learner.name || "",
    }}
    // Schedule details are NOT displayed here!
  />
))
```

---

### 3. **Client-Side Processing After Data Fetch**

**Location:** Lines 756-804

After fetching all the data, the code performs heavy client-side processing:

```typescript
// Build demo learner set - O(n)
const demoLearnerIds = new Set(
  enrollmentData
    .filter((e: any) => e.progress?.type === "demo")
    .map((e: any) => e.learner_id),
);

// Build total lessons map - O(n)
const learnerTotalLessons: Record<string, number> = {};
enrollmentData.forEach((e: any) => {
  const total =
    e.Courses?.total_lessons ||
    e.Courses?.duration ||
    e.progress?.total_hours ||
    10;
  learnerTotalLessons[e.learner_id] = Math.max(
    learnerTotalLessons[e.learner_id] || 0,
    total,
  );
});

// Tag each learner - O(n × m) where m = avg schedules per learner
learnersWithSchedules.forEach((learner: any) => {
  learner.isDemo = demoLearnerIds.has(learner.id);
  const totalLessons = learnerTotalLessons[learner.id] || 10;
  const completedCount =
    learner.schedules?.filter((s: any) => s.status === "completed").length || 0;
  learner.totalLessons = totalLessons;
  learner.completedLessons = completedCount;
  learner.isAllCompleted = completedCount >= totalLessons;
  learner.hasTopupPending =
    learner.schedules?.some((s: any) => s.status === "pending_payment") ||
    false;
});

// Sort all learners - O(n log n)
learnersWithSchedules.sort((a, b) =>
  (b.created_at ?? "").localeCompare(a.created_at ?? ""),
);
```

**Performance Impact:**

- For 500 learners with 20 schedules each:
  - Filtering schedules: 500 × 20 = 10,000 iterations
  - Sorting: ~4,500 comparisons
  - Total processing time: **500ms - 1 second**

---

### 4. **Additional Query When Learner is Selected**

**Location:** Lines 1921-1998 (`LearnerSchedulesManager.syncData`)

When a learner is clicked, **another query** fetches the same data again:

```typescript
const { data, error } = await supabase
  .from("Learner")
  .select(
    `
    id, name, area, phone, email, pick_up_location, address_lat, address_lng,
    schedules:Schedule(
      id, date, start_time, end_time, instructor_id,
      status, course_id, started_at, ended_at,
      Lesson(id, number),
      Instructor(name)
    )
  `,
  )
  .eq("id", learnerId)
  .single();
```

**Why This is Redundant:**

- The data was already fetched in the `activeLearners` query
- Could reuse the cached data instead of making another database call

---

## Summary of Performance Bottlenecks

| Step                                    | Operation                     | Time Estimate     |
| --------------------------------------- | ----------------------------- | ----------------- |
| 1. Fetch enrollments (paginated)        | 5 queries × 300ms             | 1.5s              |
| 2. Fetch learners + schedules (batched) | 10 batches × 400ms (parallel) | 2-3s              |
| 3. Client-side processing               | Filter, map, sort             | 0.5-1s            |
| **Total initial load**                  |                               | **4-5.5 seconds** |
| 4. Click learner (redundant fetch)      | 1 query × 300ms               | +0.3s             |

---

## Current Architecture Flow

```
User clicks "Schedule Management"
    ↓
Query 1: Fetch enrollments (page 1)
    ↓
Query 2: Fetch enrollments (page 2)
    ↓
... (repeat for all pages)
    ↓
Query N: Fetch learners batch 1 (50 learners + ALL schedules)
Query N+1: Fetch learners batch 2 (50 learners + ALL schedules)
    ↓
... (10 batches in parallel)
    ↓
Client-side processing:
  - Build demo learner set
  - Calculate completion status for each learner
  - Sort by created_at
    ↓
Render Active Learners List (only shows name + basic info)
    ↓
User clicks a learner
    ↓
Query: Fetch same learner + schedules AGAIN (redundant)
    ↓
Render learner details
```

---

## Why It's Slow - The Real Problem

1. **Over-fetching**: Fetching 10,000+ schedule records when only 500 learner names are displayed
2. **Sequential pagination**: Enrollment queries run one after another instead of using aggregated query
3. **No database-side filtering**: All computation (demo status, completion %) happens client-side
4. **Large payload**: Transferring 2-5 MB of JSON data over the network
5. **Redundant queries**: Re-fetching learner data when already in memory
6. **No caching strategy**: Every page visit re-fetches everything (30s stale time is too short for large datasets)
7. **Multiple table joins**: Learner → Schedule → Lesson → Instructor for every batch

---

## Recommended Solutions (Priority Order)

### 1. **Lazy Load Schedules** (Easiest, High Impact)

- Initial query: Fetch only learner basic info + aggregate stats (completion count, demo status)
- Fetch full schedule details only when user clicks a learner
- **Expected improvement**: 70-80% faster (1-1.5s instead of 4-5.5s)

### 2. **Database View for Aggregates** (Medium Difficulty, High Impact)

- Create PostgreSQL view/function that pre-computes:
  - Completed lesson count
  - Total lessons
  - Demo status
  - Topup pending status
- **Expected improvement**: 50-60% faster

### 3. **Pagination/Virtual Scrolling** (Medium Difficulty, Medium Impact)

- Load learners in chunks (e.g., 50 at a time)
- Implement infinite scroll
- **Expected improvement**: Initial load 80% faster, but slower overall navigation

### 4. **Increase Cache Duration** (Easiest, Low Impact)

- Change staleTime from 30s to 5-10 minutes
- Add cache invalidation only when data changes
- **Expected improvement**: Instant on subsequent visits

### 5. **Optimize Enrollment Query** (Medium Difficulty, Medium Impact)

- Use database aggregate query instead of pagination loop
- Single query: `SELECT DISTINCT learner_id FROM enrollment WHERE status = 'active'`
- **Expected improvement**: 20-30% faster

---

## Next Steps

Please confirm which solution(s) you'd like me to implement. I recommend starting with #1 (Lazy Load Schedules) as it provides the biggest improvement with minimal code changes.

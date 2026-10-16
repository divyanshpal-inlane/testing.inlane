# Simple 5-Minute Fix for Infinite Scroll

## Current Status

- ✅ Request tabs (New/Reschedule/10th) already use infinite query
- ❌ Just need to add sentinel UI
- ❌ Active/Completed tabs need conversion

## Quick Fix Steps

### Step 1: Add Sentinel Refs (1 line)

Find line ~808 (after `const completedLearners = activeLearners?.learners || [];`)

Add these 2 lines:

```typescript
const requestsSentinelRef = useInfiniteScrollSentinel(
  hasNextRequestsPage,
  isFetchingNextRequestsPage,
  fetchNextRequestsPage,
);
const learnersSentinelRef = useInfiniteScrollSentinel(
  hasNextLearnersPage,
  isFetchingNextLearnersPage,
  fetchNextLearnersPage,
);
```

### Step 2: Add Sentinels to Request Tabs (Copy-paste 3 times)

Search for these 3 ScrollArea closings in request tabs and add before `</ScrollArea>`:

**New Schedules** (~line 1100):
**Reschedule** (~line 1215):
**10th Lesson** (~line 1290):

Add this code BEFORE each `</ScrollArea>`:

```tsx
{
  hasNextRequestsPage && (
    <div ref={requestsSentinelRef} className="py-4 text-center">
      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
    </div>
  );
}
```

### Step 3: Test

```bash
npm run dev
```

Scroll down in New/Reschedule/10th tabs - they should load more!

---

## For Active/Completed (Bonus - if you want to complete it)

The old pagination still works. If you want infinite scroll there too, you need to:

1. Convert the useQuery to useInfiniteQuery (complex)
2. Remove Previous/Next buttons
3. Add sentinel

But the requests tabs will work with infinite scroll RIGHT NOW after Steps 1-3 above!

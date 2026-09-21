# Manual Changes Still Needed for Infinite Scroll

## What's Already Done ✅

- Infinite query hooks created and integrated
- Pagination state removed
- Sentinel hooks added
- Request tabs converted to infinite loading
- Active learners query converted to infinite

## What You Need To Add Manually

### 1. Add Sentinels to ALL 5 Tabs

Search for these patterns and add the sentinel code BEFORE `</ScrollArea>`:

#### Pattern to find:

```tsx
                    ))}
                  </ScrollArea>
```

#### Code to add (adjust the ref and data check for each tab):

**For New/Reschedule/10th Lesson tabs (use requestsSentinelRef):**

```tsx
{
  hasNextRequestsPage && (
    <div
      ref={requestsSentinelRef}
      className="py-4 text-center text-sm text-gray-500"
    >
      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
      <p className="mt-1">Loading more...</p>
    </div>
  );
}
```

**For Active/Completed tabs (use learnersSentinelRef):**

```tsx
{
  hasNextLearnersPage && (
    <div
      ref={learnersSentinelRef}
      className="py-4 text-center text-sm text-gray-500"
    >
      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
      <p className="mt-1">Loading more learners...</p>
    </div>
  );
}
```

### 2. Remove Pagination Controls

Find lines with `currentPage` and `itemsPerPage` in render code.
Delete the entire pagination button sections.

Replace with simple count:

```tsx
`Showing ${items.length} of ${totalCount}`;
```

### 3. Remove setCurrentPage calls

Find and remove any:

```typescript
setCurrentPage(0);
```

The infinite query auto-resets when filters change.

## Test After Changes

```bash
npm run dev
```

Visit all 5 tabs and test scrolling!

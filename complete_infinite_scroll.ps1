# Complete infinite scroll implementation
$ErrorActionPreference = "Stop"
$file = "src/routes/admin/schedules.tsx"

Write-Host "Reading schedules.tsx..." -ForegroundColor Cyan
$content = Get-Content $file -Raw

# 1. Replace the old pagination query for Active Learners
Write-Host "Step 1: Converting Active Learners to infinite query..." -ForegroundColor Yellow
$oldQueryPattern = '(?s)  // Pagination state\s+const \[currentPage, setCurrentPage\] = useState\(0\);\s+const \[itemsPerPage\] = useState\(20\);\s+const \[activeTab, setActiveTab\] = useState<"active" \| "completed">\("active"\);\s+// Fetch learners with active enrollment using database-level pagination\s+const \{\s+data: activeLearners,\s+isLoading: isLoadingActiveLearners,\s+refetch: refetchActiveLearners,\s+\} = useQuery\(\{\s+queryKey: \[\s+"activeLearners",\s+currentPage,\s+searchTerm,\s+selectedFilterInstructorId,\s+activeTab,\s+\],'

$newQuery = @'
  // Active tab state
  const [activeTab, setActiveTab] = useState<"active" | "completed">("active");

  // Infinite query for active/completed learners
  const {
    data: learnersData,
    isLoading: isLoadingActiveLearners,
    refetch: refetchActiveLearners,
    fetchNextPage: fetchNextLearnersPage,
    hasNextPage: hasNextLearnersPage,
    isFetchingNextPage: isFetchingNextLearnersPage,
  } = useInfiniteQuery({
    queryKey: [
      "activeLearners-infinite",
      searchTerm,
      selectedFilterInstructorId,
      activeTab,
    ],
'@

if ($content -match $oldQueryPattern) {
    $content = $content -replace $oldQueryPattern, $newQuery
    Write-Host "  ✓ Replaced pagination state and query signature" -ForegroundColor Green
} else {
    Write-Host "  ✗ Could not find old query pattern" -ForegroundColor Red
}

Write-Host "`nSaving changes to $file..." -ForegroundColor Cyan
$content | Set-Content $file -NoNewline

Write-Host "`n✅ Phase 1 complete!" -ForegroundColor Green
Write-Host "Next: Run this script again for Phase 2 (updating query parameters)" -ForegroundColor Cyan
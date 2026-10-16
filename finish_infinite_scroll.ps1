# Complete the infinite scroll implementation
$file = "src/routes/admin/schedules.tsx"
$content = Get-Content $file -Raw

Write-Output "Applying remaining infinite scroll changes..."

# 1. Replace pagination controls in Active Learners tab (first occurrence)
$content = $content -replace '(?s)\{/\* Pagination Controls \*/\}\s+<div className="mt-2 flex items-center justify-between text-xs text-gray-600">.*?</div>\s+</div>(\s+</CardHeader>\s+<CardContent className="p-3 pt-0">\s+<ScrollArea className="h-\[calc\(100vh-320px\)\]">)', '{/* Simple count display */}
                  <div className="mt-2 text-xs text-gray-600">
                    {isLoadingActiveLearners ? (
                      "Loading..."
                    ) : (
                      `Showing ${activeLearners?.learners.length || 0} of ${activeLearners?.totalCount || 0}`
                    )}
                  </div>$1'

# 2. Add sentinel to Active Learners ScrollArea
$content = $content -replace '(\)\)}\s+)\s+(</ScrollArea>\s+</CardContent>\s+</Card>\s+</div>\s+</TabsContent>\s+\{/\* Completed Learners Tab \*/\})', '$1
                    
                    {/* Infinite scroll sentinel */}
                    {hasNextLearnersPage && (
                      <div ref={learnersSentinelRef} className="py-4 text-center text-sm text-gray-500">
                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        <p className="mt-1">Loading more learners...</p>
                      </div>
                    )}
                    
                    {!hasNextLearnersPage && activeLearners?.learners && activeLearners.learners.length > 0 && (
                      <div className="py-4 text-center text-sm text-gray-400">
                        No more learners
                      </div>
                    )}
                  $2'

# 3. Replace pagination in Completed Learners tab
$content = $content -replace '(?s)Completed Learners \{activeTab === "completed".*?\{/\* Pagination Controls \*/\}\s+<div className="mt-2 flex items-center justify-between text-xs text-gray-600">.*?</div>\s+</div>(\s+</CardHeader>)', 'Completed Learners {activeTab === "completed" ? (activeLearners?.totalCount || 0) : ""}
                </CardTitle>
                <div className="mt-2 text-xs text-gray-600">
                    {isLoadingActiveLearners ? (
                      "Loading..."
                    ) : (
                      `Showing ${activeLearners?.learners.length || 0} of ${activeLearners?.totalCount || 0}`
                    )}
                  </div>$1'

Write-Output "Saving changes..."
$content | Set-Content $file -NoNewline

Write-Output "Done! Infinite scroll implementation completed."
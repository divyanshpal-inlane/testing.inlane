import { format } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  Phone as PhoneIcon,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import {
  KAMWithInstructorCount,
  useAllInstructorsForAssignment,
  useAssignInstructorsToKAM,
  useCreateKAM,
  useDeleteKAM,
  useKAMAssignedInstructors,
  useKAMs,
  useUnassignInstructorFromKAM,
} from "@/queries/kam";

export default function KAMManagement() {
  const {
    data: kams,
    isLoading,
    isFetching,
    error: loadError,
    refetch,
  } = useKAMs();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [drawerKam, setDrawerKam] = useState<KAMWithInstructorCount | null>(
    null,
  );
  const [confirmDeleteKam, setConfirmDeleteKam] =
    useState<KAMWithInstructorCount | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (kams ?? []).filter((k) => {
      if (!q) return true;
      const hay =
        `${k.name ?? ""} ${k.phone ?? ""} ${k.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [kams, search]);

  const deleteKam = useDeleteKAM();

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Key Account Managers
              </h1>
              <p className="text-sm text-muted-foreground">
                Create KAMs and assign instructors to them.
              </p>
            </div>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add KAM
          </Button>
        </div>

        {/* Search bar */}
        <Card>
          <CardContent className="p-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search KAM name, phone, email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardContent>
        </Card>

        {/* List */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : loadError ? (
              <div className="space-y-2 p-6 text-center text-sm">
                <p className="font-medium text-destructive">
                  Couldn’t load KAMs.
                </p>
                <p className="text-muted-foreground">
                  {loadError instanceof Error
                    ? loadError.message
                    : String(loadError)}
                </p>
                <p className="text-xs text-muted-foreground">
                  If this mentions a missing table, the KAM migration
                  (20260527_add_kam_domain.sql) hasn’t been applied to this
                  database yet.
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {kams && kams.length === 0
                  ? "No KAMs yet. Click “Add KAM” to create one."
                  : "No KAMs match your search."}
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map((kam) => (
                  <div
                    key={kam.id}
                    className="flex items-center gap-3 p-3 hover:bg-muted/30"
                  >
                    <button
                      type="button"
                      onClick={() => setDrawerKam(kam)}
                      className="flex flex-1 flex-col items-start text-left"
                    >
                      <span className="font-medium">{kam.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {kam.phone ?? "no phone"} · {kam.email ?? "no email"} ·
                        created {format(new Date(kam.created_at), "d MMM yyyy")}
                      </span>
                    </button>
                    <Badge variant="outline" className="gap-1">
                      <Users className="h-3 w-3" />
                      {kam.instructor_count} instructor
                      {kam.instructor_count === 1 ? "" : "s"}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDrawerKam(kam)}
                    >
                      Manage
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmDeleteKam(kam)}
                      aria-label={`Delete ${kam.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {kams?.length ?? 0} total · showing {filtered.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            Refresh
          </Button>
        </div>
      </div>

      <AddKamDialog open={addOpen} onOpenChange={setAddOpen} />

      <KamDetailDrawer kam={drawerKam} onClose={() => setDrawerKam(null)} />

      <Dialog
        open={!!confirmDeleteKam}
        onOpenChange={(open) => !open && setConfirmDeleteKam(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete KAM?</DialogTitle>
            <DialogDescription>
              This will remove{" "}
              <span className="font-medium">{confirmDeleteKam?.name}</span> and
              detach all {confirmDeleteKam?.instructor_count ?? 0} assigned
              instructor
              {confirmDeleteKam?.instructor_count === 1 ? "" : "s"}. The
              instructors themselves are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteKam(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteKam.isPending}
              onClick={() => {
                if (!confirmDeleteKam) return;
                deleteKam.mutate(confirmDeleteKam.id, {
                  onSuccess: () => {
                    toast({
                      title: "KAM deleted",
                      description: `${confirmDeleteKam.name} was removed.`,
                    });
                    setConfirmDeleteKam(null);
                  },
                  onError: (e) =>
                    toast({
                      title: "Could not delete KAM",
                      description: e instanceof Error ? e.message : String(e),
                      variant: "destructive",
                    }),
                });
              }}
            >
              {deleteKam.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddKamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useCreateKAM();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const reset = () => {
    setName("");
    setPhone("");
    setEmail("");
  };

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    create.mutate(
      { name, phone, email },
      {
        onSuccess: (kam) => {
          toast({
            title: "KAM added",
            description: `${kam.name} can now be assigned instructors.`,
          });
          reset();
          onOpenChange(false);
        },
        onError: (e) =>
          toast({
            title: "Could not add KAM",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Key Account Manager</DialogTitle>
          <DialogDescription>
            Create a KAM record so you can assign instructors to it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="kam-name">Name</Label>
            <Input
              id="kam-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rahul Iyer"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kam-phone">Phone (optional)</Label>
            <Input
              id="kam-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 9XXXXXXXXX"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kam-email">Email (optional)</Label>
            <Input
              id="kam-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kam@example.com"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            Create KAM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KamDetailDrawer({
  kam,
  onClose,
}: {
  kam: KAMWithInstructorCount | null;
  onClose: () => void;
}) {
  const open = !!kam;
  const kamId = kam?.id ?? null;
  const { data: assigned, isLoading } = useKAMAssignedInstructors(kamId);
  const { data: allInstructors } = useAllInstructorsForAssignment();
  const assign = useAssignInstructorsToKAM();
  const unassign = useUnassignInstructorFromKAM();
  const { toast } = useToast();

  const [pickerSearch, setPickerSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const assignedIds = useMemo(
    () => new Set((assigned ?? []).map((a) => a.id_instructor)),
    [assigned],
  );

  const candidates = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return (allInstructors ?? [])
      .filter((i) => !assignedIds.has(i.id_instructor))
      .filter((i) => {
        if (!q) return true;
        return `${i.name ?? ""} ${i.phone ?? ""}`.toLowerCase().includes(q);
      });
  }, [allInstructors, assignedIds, pickerSearch]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmAssign = () => {
    if (!kamId || picked.size === 0) return;
    const ids = Array.from(picked);
    assign.mutate(
      { kamId, instructorIds: ids },
      {
        onSuccess: () => {
          toast({
            title: "Instructors assigned",
            description: `${ids.length} instructor${
              ids.length === 1 ? "" : "s"
            } added to ${kam?.name}.`,
          });
          setPicked(new Set());
          setPickerSearch("");
        },
        onError: (e) =>
          toast({
            title: "Could not assign",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setPicked(new Set());
          setPickerSearch("");
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-full max-w-none sm:max-w-xl lg:max-w-2xl"
      >
        {kam && (
          <>
            <SheetHeader>
              <SheetTitle>{kam.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-3">
                {kam.phone && (
                  <a
                    href={`tel:${kam.phone}`}
                    className="flex items-center gap-1 hover:underline"
                  >
                    <PhoneIcon className="h-3 w-3" /> {kam.phone}
                  </a>
                )}
                {kam.email && <span>{kam.email}</span>}
                <span>{assigned?.length ?? 0} instructor(s) assigned</span>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {/* Assigned list */}
              <Card>
                <CardHeader className="p-3">
                  <CardTitle className="text-sm">
                    Assigned instructors
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="flex h-20 items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (assigned?.length ?? 0) === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      No instructors assigned yet.
                    </div>
                  ) : (
                    <ScrollArea className="h-64" style={{ height: "256px" }}>
                      <div className="divide-y">
                        {(assigned ?? []).map((a) => (
                          <div
                            key={a.id_instructor}
                            className="flex items-center justify-between gap-2 px-3 py-2"
                          >
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                {a.name ?? "(unnamed)"}
                              </span>
                              {a.phone && (
                                <span className="text-[11px] text-muted-foreground">
                                  {a.phone}
                                </span>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Remove"
                              disabled={unassign.isPending}
                              onClick={() =>
                                unassign.mutate(
                                  {
                                    kamId: kam.id,
                                    instructorId: a.id_instructor,
                                  },
                                  {
                                    onError: (e) =>
                                      toast({
                                        title: "Could not remove",
                                        description:
                                          e instanceof Error
                                            ? e.message
                                            : String(e),
                                        variant: "destructive",
                                      }),
                                  },
                                )
                              }
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>

              {/* Assignment picker */}
              <Card>
                <CardHeader className="p-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <UserPlus className="h-4 w-4" />
                    Assign more instructors
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-3">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search instructor name or phone"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <ScrollArea
                    className="h-72 rounded border"
                    style={{ height: "288px" }}
                  >
                    {candidates.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">
                        {(allInstructors?.length ?? 0) === 0
                          ? "No instructors in the system."
                          : "All instructors already assigned or no matches."}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {candidates.map((i) => {
                          const isPicked = picked.has(i.id_instructor);
                          return (
                            <label
                              key={i.id_instructor}
                              className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40"
                            >
                              <input
                                type="checkbox"
                                checked={isPicked}
                                onChange={() => togglePick(i.id_instructor)}
                              />
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">
                                  {i.name ?? "(unnamed)"}
                                </span>
                                {i.phone && (
                                  <span className="text-[11px] text-muted-foreground">
                                    {i.phone}
                                  </span>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {picked.size} selected
                    </span>
                    <Button
                      size="sm"
                      onClick={confirmAssign}
                      disabled={picked.size === 0 || assign.isPending}
                    >
                      {assign.isPending && (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      )}
                      Assign {picked.size > 0 ? picked.size : ""}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

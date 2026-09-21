import { Loader2, Plus, Search, Shield, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  PermissionKey,
  useAllAdmins,
  useCurrentAdmin,
} from "@/queries/adminPermissions";
import {
  useCreateUser,
  useDeleteUser,
  usePaginatedUsers,
  USER_PERMISSIONS,
  USERS_PAGE_SIZE,
  UserWithPermissions,
  useUpdateUserPermissions,
} from "@/queries/userManagement";

export default function UserManagement() {
  const { toast } = useToast();
  const { data: currentAdmin, isLoading: currentAdminLoading } =
    useCurrentAdmin();
  const isSuperAdmin = !!currentAdmin?.is_super_admin;
  // Admin list is only needed by super admins (filter dropdown + "Created by" label)
  const { data: allAdmins } = useAllAdmins();
  const createUser = useCreateUser();
  const updatePermissions = useUpdateUserPermissions();
  const deleteUser = useDeleteUser();

  // Search / admin filter / pagination state
  const [searchTerm, setSearchTerm] = useState("");
  // "" = All Users (mirrors the instructor filter convention in schedules.tsx)
  const [selectedAdminId, setSelectedAdminId] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);

  // Only regular admins (not super admins) can own users, so they are the
  // only meaningful filter options.
  const filterableAdmins = useMemo(
    () => (allAdmins || []).filter((admin) => !admin.is_super_admin),
    [allAdmins],
  );
  const adminNameById = useMemo(
    () => new Map((allAdmins || []).map((admin) => [admin.id, admin.name])),
    [allAdmins],
  );

  // Super admin: filter by the selected admin (or all users when none selected).
  // Regular admin: always scoped to their own users (User.created_by_admin_id).
  const effectiveAdminId = isSuperAdmin
    ? selectedAdminId || null
    : (currentAdmin?.id ?? null);

  // The list is only fetched once we know who the current admin is
  const canViewUsers =
    !!currentAdmin && (isSuperAdmin || !!currentAdmin.is_admin);

  const {
    data: usersPage,
    isLoading: usersLoading,
    isFetching: usersFetching,
    isError: usersError,
  } = usePaginatedUsers({
    page: currentPage,
    searchTerm,
    adminId: effectiveAdminId,
    enabled: canViewUsers,
  });

  const displayUsers = usersPage?.users ?? [];
  const totalCount = usersPage?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / USERS_PAGE_SIZE));
  const hasActiveFilters = searchTerm.trim() !== "" || selectedAdminId !== "";

  // Reset to page 1 whenever search or admin filter changes
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };
  const handleAdminFilterChange = (value: string) => {
    setSelectedAdminId(value === "all" ? "" : value);
    setCurrentPage(1);
  };

  // Clamp the page if the total shrinks (e.g. last user on the page was deleted)
  useEffect(() => {
    if (usersPage && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [usersPage, currentPage, totalPages]);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithPermissions | null>(
    null,
  );
  const [newUserForm, setNewUserForm] = useState({
    name: "",
    phone: "",
    password: "",
    permissions: [] as PermissionKey[],
  });
  const [editPermissions, setEditPermissions] = useState<PermissionKey[]>([]);
  const [phoneError, setPhoneError] = useState("");

  // Validate phone number - must be exactly 10 digits
  const isValidPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    return digits.length === 10;
  };

  const handlePhoneChange = (value: string) => {
    setNewUserForm((prev) => ({
      ...prev,
      phone: value,
    }));

    if (value && !isValidPhone(value)) {
      setPhoneError("Phone number must be exactly 10 digits");
    } else {
      setPhoneError("");
    }
  };

  // Check if current user is admin
  // (the user list has its own inline loading state so the search/filter
  // controls stay mounted while pages are fetched)
  if (currentAdminLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentAdmin?.is_admin && !currentAdmin?.is_super_admin) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <Shield className="h-6 w-6" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Only Admins can manage users.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleCreateUser = async () => {
    try {
      await createUser.mutateAsync(newUserForm);
      setShowCreateDialog(false);
      setNewUserForm({ name: "", phone: "", password: "", permissions: [] });
      toast({
        title: "Success",
        description: "User created successfully!",
      });
    } catch (error: unknown) {
      console.error("Error creating user:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create user";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleUpdatePermissions = async () => {
    if (!selectedUser) return;
    try {
      await updatePermissions.mutateAsync({
        userId: selectedUser.id,
        permissions: editPermissions,
      });
      setShowEditDialog(false);
      setSelectedUser(null);
      toast({
        title: "Success",
        description: "Permissions updated successfully!",
      });
    } catch (error: unknown) {
      console.error("Error updating permissions:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update permissions";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    try {
      await deleteUser.mutateAsync(selectedUser.id);
      setShowDeleteDialog(false);
      setSelectedUser(null);
      toast({
        title: "Success",
        description: "User deleted successfully!",
      });
    } catch (error: unknown) {
      console.error("Error deleting user:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete user";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (user: UserWithPermissions | any) => {
    setSelectedUser(user as UserWithPermissions);
    setEditPermissions(user.permissions);
    setShowEditDialog(true);
  };

  const openDeleteDialog = (user: UserWithPermissions | any) => {
    setSelectedUser(user as UserWithPermissions);
    setShowDeleteDialog(true);
  };

  const toggleNewPermission = (permission: PermissionKey) => {
    setNewUserForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const toggleEditPermission = (permission: PermissionKey) => {
    setEditPermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((p) => p !== permission)
        : [...prev, permission],
    );
  };

  const selectAllPermissions = (isNew: boolean) => {
    // Only allow selecting permissions that the current admin has
    const adminPermissions = currentAdmin?.permissions || [];
    if (isNew) {
      setNewUserForm((prev) => ({ ...prev, permissions: adminPermissions }));
    } else {
      setEditPermissions(adminPermissions);
    }
  };

  const clearAllPermissions = (isNew: boolean) => {
    if (isNew) {
      setNewUserForm((prev) => ({ ...prev, permissions: [] }));
    } else {
      setEditPermissions([]);
    }
  };

  return (
    <div
      className="min-h-screen bg-white p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
      }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                User Management
              </h1>
              <p className="mt-1 text-muted-foreground">
                Create and manage users with specific permissions
              </p>
            </div>
          </div>
          {!currentAdmin?.is_super_admin && (
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          )}
        </div>

        {/* Search + Admin filter */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <Input
              placeholder="Search"
              className="pl-9"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          {isSuperAdmin && (
            <Select
              value={selectedAdminId || "all"}
              onValueChange={handleAdminFilterChange}
            >
              <SelectTrigger className="w-full sm:w-[260px]">
                <SelectValue placeholder="All Users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {filterableAdmins.map((admin) => (
                  <SelectItem key={admin.id} value={admin.id}>
                    {admin.name || admin.phone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {usersLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
              Loading users...
            </CardContent>
          </Card>
        ) : usersError ? (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-red-600">
                Failed to load users. Please try again.
              </p>
            </CardContent>
          </Card>
        ) : displayUsers.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">
                {hasActiveFilters
                  ? "No users match your search or filter."
                  : isSuperAdmin
                    ? "No users to display."
                    : "You haven't created any users yet."}
              </p>
              {!isSuperAdmin && !hasActiveFilters && (
                <Button
                  className="mt-4"
                  onClick={() => setShowCreateDialog(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First User
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div
            className={`space-y-4 ${usersFetching ? "opacity-60 transition-opacity" : ""}`}
          >
            {displayUsers.map((user) => (
              <Card key={user.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                        <Users className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{user.name}</CardTitle>
                        <CardDescription>
                          {user.phone}
                          {isSuperAdmin &&
                            adminNameById.get(user.created_by_admin_id) && (
                              <>
                                {" · Created by "}
                                {adminNameById.get(user.created_by_admin_id)}
                              </>
                            )}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(user)}
                      >
                        Edit Permissions
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => openDeleteDialog(user)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {user.permissions.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        No permissions assigned
                      </span>
                    ) : (
                      user.permissions.map((perm) => (
                        <span
                          key={perm}
                          className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700"
                        >
                          {USER_PERMISSIONS[perm]?.label || perm}
                        </span>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Pagination Controls */}
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing{" "}
                {Math.min((currentPage - 1) * USERS_PAGE_SIZE + 1, totalCount)}{" "}
                to {Math.min(currentPage * USERS_PAGE_SIZE, totalCount)} of{" "}
                {totalCount} users
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={currentPage === 1 || usersFetching}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  }
                  disabled={currentPage >= totalPages || usersFetching}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Create User Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Add a new user with specific permissions
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="User name"
                  value={newUserForm.name}
                  onChange={(e) =>
                    setNewUserForm((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  placeholder="10-digit phone number"
                  value={newUserForm.phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  className={phoneError ? "border-red-500" : ""}
                />
                {phoneError && (
                  <p className="text-xs text-red-500">{phoneError}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min 6 characters"
                  value={newUserForm.password}
                  onChange={(e) =>
                    setNewUserForm((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Permissions</Label>
                  <div className="space-x-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => selectAllPermissions(true)}
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => clearAllPermissions(true)}
                    >
                      Clear All
                    </Button>
                  </div>
                </div>
                <div className="max-h-60 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {Object.values(USER_PERMISSIONS)
                    .filter((perm) => {
                      // Exclude unwanted permissions
                      const excludedPermissions = [
                        "kam_management",
                        "instructor_matrix",
                        "lessons_dashboard",
                        "admin_management",
                      ];
                      if (excludedPermissions.includes(perm.key)) return false;
                      // Only show permissions that admin has
                      return currentAdmin?.permissions?.includes(
                        perm.key as PermissionKey,
                      );
                    })
                    .map((perm) => (
                      <div
                        key={perm.key}
                        className="flex items-start space-x-3 rounded p-2 hover:bg-gray-50"
                      >
                        <Checkbox
                          id={`new-${perm.key}`}
                          checked={newUserForm.permissions.includes(
                            perm.key as PermissionKey,
                          )}
                          onCheckedChange={() =>
                            toggleNewPermission(perm.key as PermissionKey)
                          }
                        />
                        <div className="flex-1">
                          <label
                            htmlFor={`new-${perm.key}`}
                            className="cursor-pointer text-sm font-medium"
                          >
                            {perm.label}
                          </label>
                          <p className="text-xs text-muted-foreground">
                            {perm.description}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateUser}
                disabled={
                  createUser.isPending ||
                  !newUserForm.name ||
                  !newUserForm.phone ||
                  !newUserForm.password ||
                  !isValidPhone(newUserForm.phone)
                }
              >
                {createUser.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Permissions Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Permissions</DialogTitle>
              <DialogDescription>
                Update permissions for {selectedUser?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="flex items-center justify-between pb-2">
                <Label>Permissions</Label>
                <div className="space-x-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => selectAllPermissions(false)}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => clearAllPermissions(false)}
                  >
                    Clear All
                  </Button>
                </div>
              </div>
              <div className="max-h-60 space-y-2 overflow-y-auto rounded-lg border p-3">
                {Object.values(USER_PERMISSIONS)
                  .filter((perm) => {
                    // Exclude unwanted permissions
                    const excludedPermissions = [
                      "kam_management",
                      "instructor_matrix",
                      "lessons_dashboard",
                      "admin_management",
                    ];
                    if (excludedPermissions.includes(perm.key)) return false;
                    // Only show permissions that admin has
                    return currentAdmin?.permissions?.includes(
                      perm.key as PermissionKey,
                    );
                  })
                  .map((perm) => (
                    <div
                      key={perm.key}
                      className="flex items-start space-x-3 rounded p-2 hover:bg-gray-50"
                    >
                      <Checkbox
                        id={`edit-${perm.key}`}
                        checked={editPermissions.includes(
                          perm.key as PermissionKey,
                        )}
                        onCheckedChange={() =>
                          toggleEditPermission(perm.key as PermissionKey)
                        }
                      />
                      <div className="flex-1">
                        <label
                          htmlFor={`edit-${perm.key}`}
                          className="cursor-pointer text-sm font-medium"
                        >
                          {perm.label}
                        </label>
                        <p className="text-xs text-muted-foreground">
                          {perm.description}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowEditDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdatePermissions}
                disabled={updatePermissions.isPending}
              >
                {updatePermissions.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete User</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete {selectedUser?.name}? This
                action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteUser}
                disabled={deleteUser.isPending}
              >
                {deleteUser.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

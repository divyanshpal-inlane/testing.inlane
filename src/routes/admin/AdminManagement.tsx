import {
  Loader2,
  Plus,
  Shield,
  ShieldCheck,
  Trash2,
  UserCog,
} from "lucide-react";
import { useState } from "react";

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
import { useToast } from "@/components/ui/use-toast";
import {
  ADMIN_PERMISSIONS,
  AdminWithPermissions,
  PermissionKey,
  useAllAdmins,
  useCreateAdmin,
  useCurrentAdmin,
  useDeleteAdmin,
  useUpdateAdminPermissions,
} from "@/queries/adminPermissions";

export default function AdminManagement() {
  const { toast } = useToast();
  const { data: currentAdmin, isLoading: currentAdminLoading } =
    useCurrentAdmin();
  const { data: admins, isLoading: adminsLoading } = useAllAdmins();
  const createAdmin = useCreateAdmin();
  const updatePermissions = useUpdateAdminPermissions();
  const deleteAdmin = useDeleteAdmin();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedAdmin, setSelectedAdmin] =
    useState<AdminWithPermissions | null>(null);
  const [newAdminForm, setNewAdminForm] = useState({
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
    setNewAdminForm((prev) => ({
      ...prev,
      phone: value,
    }));

    if (value && !isValidPhone(value)) {
      setPhoneError("Phone number must be exactly 10 digits");
    } else {
      setPhoneError("");
    }
  };

  // Check if current user is super admin
  if (currentAdminLoading || adminsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentAdmin?.is_super_admin) {
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
              Only the Super Admin can access this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleCreateAdmin = async () => {
    try {
      await createAdmin.mutateAsync(newAdminForm);
      setShowCreateDialog(false);
      setNewAdminForm({ name: "", phone: "", password: "", permissions: [] });
      toast({
        title: "Success",
        description: "Admin created successfully!",
      });
    } catch (error: unknown) {
      console.error("Error creating admin:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create admin";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleUpdatePermissions = async () => {
    if (!selectedAdmin) return;
    try {
      await updatePermissions.mutateAsync({
        adminId: selectedAdmin.id,
        permissions: editPermissions,
      });
      setShowEditDialog(false);
      setSelectedAdmin(null);
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

  const handleDeleteAdmin = async () => {
    if (!selectedAdmin) return;
    try {
      await deleteAdmin.mutateAsync(selectedAdmin.id);
      setShowDeleteDialog(false);
      setSelectedAdmin(null);
      toast({
        title: "Success",
        description: "Admin deleted successfully!",
      });
    } catch (error: unknown) {
      console.error("Error deleting admin:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete admin";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (admin: AdminWithPermissions) => {
    setSelectedAdmin(admin);
    setEditPermissions(admin.permissions);
    setShowEditDialog(true);
  };

  const openDeleteDialog = (admin: AdminWithPermissions) => {
    setSelectedAdmin(admin);
    setShowDeleteDialog(true);
  };

  const toggleNewPermission = (permission: PermissionKey) => {
    setNewAdminForm((prev) => ({
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
    const allKeys = Object.keys(ADMIN_PERMISSIONS).filter(
      (key) => key !== "admin_management",
    ) as PermissionKey[];
    if (isNew) {
      setNewAdminForm((prev) => ({ ...prev, permissions: allKeys }));
    } else {
      setEditPermissions(allKeys);
    }
  };

  const clearAllPermissions = (isNew: boolean) => {
    if (isNew) {
      setNewAdminForm((prev) => ({ ...prev, permissions: [] }));
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
            <ShieldCheck className="h-8 w-8 text-purple-600" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Admin Management
              </h1>
              <p className="mt-1 text-muted-foreground">
                Create and manage admin accounts and permissions
              </p>
            </div>
          </div>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Admin
          </Button>
        </div>

        <div className="space-y-4">
          {admins?.map((admin) => (
            <Card key={admin.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full ${
                        admin.is_super_admin ? "bg-purple-100" : "bg-blue-100"
                      }`}
                    >
                      {admin.is_super_admin ? (
                        <ShieldCheck className="h-5 w-5 text-purple-600" />
                      ) : (
                        <UserCog className="h-5 w-5 text-blue-600" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-lg">
                        {admin.name}
                        {admin.is_super_admin && (
                          <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                            Super Admin
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription>{admin.phone}</CardDescription>
                    </div>
                  </div>
                  {!admin.is_super_admin && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(admin)}
                      >
                        Edit Permissions
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => openDeleteDialog(admin)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  {admin.is_super_admin && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled>
                        Edit Permissions
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {admin.is_super_admin ? (
                    <span className="text-sm text-muted-foreground">
                      Has access to all features
                    </span>
                  ) : admin.permissions.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                      No permissions assigned
                    </span>
                  ) : (
                    admin.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700"
                      >
                        {ADMIN_PERMISSIONS[perm]?.label || perm}
                      </span>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Create Admin Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Admin</DialogTitle>
              <DialogDescription>
                Add a new admin user with specific permissions
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Admin name"
                  value={newAdminForm.name}
                  onChange={(e) =>
                    setNewAdminForm((prev) => ({
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
                  value={newAdminForm.phone}
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
                  value={newAdminForm.password}
                  onChange={(e) =>
                    setNewAdminForm((prev) => ({
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
                  {Object.values(ADMIN_PERMISSIONS)
                    .filter((perm) => perm.key !== "admin_management")
                    .map((perm) => (
                      <div
                        key={perm.key}
                        className="flex items-start space-x-3 rounded p-2 hover:bg-gray-50"
                      >
                        <Checkbox
                          id={`new-${perm.key}`}
                          checked={newAdminForm.permissions.includes(
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
                onClick={handleCreateAdmin}
                disabled={
                  createAdmin.isPending ||
                  !newAdminForm.name ||
                  !newAdminForm.phone ||
                  !newAdminForm.password ||
                  !isValidPhone(newAdminForm.phone)
                }
              >
                {createAdmin.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create Admin
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
                Update permissions for {selectedAdmin?.name}
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
                {Object.values(ADMIN_PERMISSIONS)
                  .filter((perm) => perm.key !== "admin_management")
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
              <DialogTitle>Delete Admin</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete {selectedAdmin?.name}? This
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
                onClick={handleDeleteAdmin}
                disabled={deleteAdmin.isPending}
              >
                {deleteAdmin.isPending ? (
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

import type { Metadata } from "next";
import { updateCustomerAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";

import { requireStaffPage } from "@/lib/auth/session";
import { SYSTEM_ROLES, ROLE_KEYS, type RoleKey } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/utils";
import { listStaffUsers } from "@/services/admin";

export const metadata: Metadata = { title: "Staff & roles" };

const STAFF_ROLES = ROLE_KEYS.filter((k) => SYSTEM_ROLES[k].isStaff) as RoleKey[];

export default async function StaffAdmin() {
  await requireStaffPage("staff.manage");
  const staff = await listStaffUsers();
  return (
    <>
      <AdminHeader title="Staff & roles" description="Manage staff accounts and role-based access. Only super administrators can change staff roles." />
      <Section title="Staff accounts">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Change role</th></tr></thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id}>
                  <td><div className="font-medium">{u.name}</div><div className="text-xs text-faint">{u.phone ?? ""}</div></td>
                  <td className="text-muted">{u.email}</td>
                  <td><span className="badge">{u.roleName}</span></td>
                  <td>{u.isSuspended ? <span className="badge badge-red">Suspended</span> : <span className="badge badge-green">Active</span>}</td>
                  <td className="text-muted whitespace-nowrap">{formatDate(u.lastLoginAt, true)}</td>
                  <td>
                    <ActionForm action={updateCustomerAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select name="role" defaultValue={u.roleKey} className="input !py-1.5 !text-sm min-w-40" aria-label={`Role for ${u.name}`}>
                        {STAFF_ROLES.map((r) => <option key={r} value={r}>{SYSTEM_ROLES[r].name}</option>)}
                      </select>
                      <SubmitButton className="btn-sm">Save</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
              {!staff.length ? <tr><td colSpan={6} className="py-8 text-center text-muted">No staff accounts found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Role permissions" className="mt-6">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Role</th><th>Description</th><th>Permissions</th></tr></thead>
            <tbody>
              {STAFF_ROLES.map((r) => (
                <tr key={r}>
                  <td className="font-medium">{SYSTEM_ROLES[r].name}</td>
                  <td className="text-muted">{SYSTEM_ROLES[r].description}</td>
                  <td className="text-xs text-faint">{SYSTEM_ROLES[r].permissions.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

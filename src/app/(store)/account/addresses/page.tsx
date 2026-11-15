import type { Metadata } from "next";
import { deleteAddressAction, saveAddressAction } from "@/actions/account";
import { AddressFields } from "@/components/store/address-fields";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { displayPhone } from "@/lib/nigeria";
import { listAddresses } from "@/services/account";

export const metadata: Metadata = { title: "My addresses" };

export default async function AddressesPage() {
  const user = await requireUser("/account/addresses");
  const addresses = await listAddresses(user.id);
  return (
    <div className="space-y-6">
      {addresses.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="card p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{a.label ?? a.fullName}</p>
                {a.isDefault ? <span className="badge badge-gold">Default</span> : null}
              </div>
              <address className="mt-2 text-sm leading-relaxed text-muted not-italic">
                {a.fullName}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.state}<br />{displayPhone(a.phone)}
              </address>
              <details className="mt-4">
                <summary className="link cursor-pointer text-sm">Edit</summary>
                <ActionForm action={saveAddressAction} className="mt-4 space-y-4">
                  <AddressFields a={a} prefix={a.id} />
                  <SubmitButton className="btn-sm">Save address</SubmitButton>
                </ActionForm>
              </details>
              <ActionForm action={deleteAddressAction} className="mt-3">
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton className="btn-ghost btn-sm" confirm="Remove this address?">Remove</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel p-5 text-sm text-muted">You have no saved addresses yet. Add one below to check out faster.</p>
      )}
      <section className="panel p-5 sm:p-6" aria-labelledby="new-addr">
        <h2 id="new-addr" className="text-lg font-semibold">Add a new address</h2>
        <ActionForm action={saveAddressAction} resetOnSuccess className="mt-4 space-y-4">
          <AddressFields prefix="new" a={{ fullName: user.name, phone: user.phone ?? "" }} />
          <SubmitButton>Save address</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}

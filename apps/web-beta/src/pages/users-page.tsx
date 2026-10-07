import { Eye, EyeOff, Loader2, Pencil, Plus, RefreshCw, Shield, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, type Column } from "@/components/data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import { formatDateTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import type { AdminLogEntry, ManagedRole, ManagedUser } from "@/lib/users";
import { errorText, FeedbackLine, Field, NativeSelect, type Feedback } from "./accounting-shared";

const roleLabels: Record<string, "roleAdmin" | "roleEmployee" | "roleCargoOperator"> = {
  admin: "roleAdmin",
  owner: "roleAdmin",
  calisan: "roleEmployee",
  kargo_operatoru: "roleCargoOperator",
};

function useRoleName() {
  const { t } = useTranslation();
  return (role: string | undefined) => {
    const key = role ? roleLabels[role] : undefined;
    return key ? t(`users.${key}`) : (role ?? "-");
  };
}

const emptyForm = { email: "", first_name: "", last_name: "", phone: "", password: "", role: "" as ManagedRole | "", sip_username: "", sip_password: "" };
type UserForm = typeof emptyForm;

/** /kullanicilar — legacy KullanicilarPage (`/admin/users`, admin-only): list, create, edit (incl. SIP extension), activate/deactivate, delete. */
export function UsersPage() {
  const { t, i18n } = useTranslation();
  const { api, user: me } = useAuth();
  const roleName = useRoleName();
  const users = useQuery("users:list", () => api.listUsers());
  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);
  const roles: ManagedRole[] = users.data?.roles.length ? users.data.roles : ["admin", "calisan", "kargo_operatoru"];

  useEffect(() => {
    if (users.data) setRows(users.data.data);
  }, [users.data]);

  const needle = query.trim().toLocaleLowerCase("tr-TR");
  const visible = needle ? rows.filter((row) => [`${row.first_name} ${row.last_name}`, row.email, row.phone].some((value) => value?.toLocaleLowerCase("tr-TR").includes(needle))) : rows;

  async function toggleActive(row: ManagedUser) {
    const next = !row.is_active;
    setRows((prev) => prev.map((item) => (item.public_id === row.public_id ? { ...item, is_active: next } : item)));
    try {
      await api.updateUser(row.public_id, { is_active: next });
    } catch (error) {
      setRows((prev) => prev.map((item) => (item.public_id === row.public_id ? { ...item, is_active: row.is_active } : item)));
      setFeedback({ tone: "error", text: t("users.statusFailed", { error: errorText(error) }) });
    }
  }

  async function remove(row: ManagedUser) {
    const name = `${row.first_name} ${row.last_name}`.trim();
    if (!window.confirm(`${t("users.deleteTitle")}\n${t("users.deleteBody", { name })}`)) return;
    try {
      await api.deactivateUser(row.public_id);
      setRows((prev) => prev.filter((item) => item.public_id !== row.public_id));
      setFeedback({ tone: "success", text: t("users.deleted") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("users.deleteFailed", { error: errorText(error) }) });
    }
  }

  const isSelf = (row: ManagedUser) => row.public_id === me?.public_id;
  const columns: Column<ManagedUser>[] = [
    {
      key: "user",
      header: t("users.colUser"),
      mobile: "title",
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block font-medium">
            {row.first_name} {row.last_name}
            {isSelf(row) && <span className="ml-1.5 text-xs text-muted-foreground">({t("users.you")})</span>}
          </span>
          <span className="block break-all text-xs text-muted-foreground">{row.email}</span>
          {row.phone && <span className="block text-xs text-muted-foreground">{row.phone}</span>}
        </span>
      ),
    },
    {
      key: "role",
      header: t("users.colRole"),
      mobile: "badge",
      cell: (row) => (
        <Badge tone={row.role === "admin" || row.role === "owner" ? "info" : "neutral"}>
          <Shield className="size-3" aria-hidden="true" />
          {roleName(row.role)}
        </Badge>
      ),
    },
    {
      key: "sip",
      header: t("users.colSip"),
      cell: (row) =>
        row.sip_username ? (
          <span data-testid="user-sip">
            {row.sip_username} <span className="text-xs text-muted-foreground">· {row.sip_password_configured ? t("users.sipPasswordSet") : t("users.sipPasswordMissing")}</span>
          </span>
        ) : (
          "-"
        ),
    },
    {
      key: "status",
      header: t("users.colStatus"),
      cell: (row) => (
        <label className={cn("inline-flex min-h-11 items-center gap-2 md:min-h-0", isSelf(row) && "opacity-60")} title={row.is_active ? t("users.deactivate") : t("users.activate")}>
          <input type="checkbox" role="switch" className="h-11 w-5 accent-primary md:size-5" checked={row.is_active} disabled={isSelf(row)} onChange={() => void toggleActive(row)} data-testid="user-active" />
          <span className={row.is_active ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>{row.is_active ? t("users.active") : t("users.inactive")}</span>
        </label>
      ),
    },
    { key: "seen", header: t("users.colLastLogin"), cell: (row) => (row.last_seen_at ? formatDateTime(row.last_seen_at, i18n.language) : "-") },
    {
      key: "actions",
      header: t("users.colActions"),
      cell: (row) => (
        <span className="flex gap-2">
          <Button variant="outline" className="min-h-11 md:min-h-9" onClick={() => setEditing(row)} data-testid="user-edit">
            <Pencil className="size-4" aria-hidden="true" />
            {t("users.edit")}
          </Button>
          <Button variant="outline" size="icon" className="size-11 text-destructive md:size-9" aria-label={t("users.delete")} title={t("users.delete")} disabled={isSelf(row)} onClick={() => void remove(row)} data-testid="user-delete">
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <section data-testid="page-users">
      <PageHeader
        title={t("users.pageTitle")}
        description={t("users.pageSubtitle")}
        actions={
          <Button className="min-h-11" onClick={() => { setFeedback(null); setEditing("new"); }} data-testid="user-new">
            <Plus className="size-4" aria-hidden="true" />
            {t("users.newUser")}
          </Button>
        }
      />
      <div className="mb-3 flex flex-col gap-2">
        <Input className="h-11 sm:max-w-sm md:h-9" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("users.searchPlaceholder")} aria-label={t("users.searchPlaceholder")} data-testid="user-search" />
        <FeedbackLine feedback={feedback} testId="users-feedback" />
      </div>
      {users.error && !users.data ? (
        <ErrorState onRetry={users.reload} />
      ) : (
        <DataList testId="users" rows={visible} columns={columns} rowKey={(row) => row.public_id} loading={users.loading} />
      )}
      <UserSheet
        target={editing}
        roles={roles}
        onClose={() => setEditing(null)}
        onSaved={(saved, created) => {
          setRows((prev) => (created ? [...prev, saved] : prev.map((item) => (item.public_id === saved.public_id ? saved : item))));
          setFeedback({ tone: "success", text: created ? t("users.created", { name: saved.first_name }) : t("users.updated") });
          setEditing(null);
        }}
      />
    </section>
  );
}

function UserSheet({ target, roles, onClose, onSaved }: { target: ManagedUser | "new" | null; roles: ManagedRole[]; onClose: () => void; onSaved: (user: ManagedUser, created: boolean) => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const roleName = useRoleName();
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const creating = target === "new";
  const existing = target && target !== "new" ? target : null;

  useEffect(() => {
    setFeedback(null);
    setShowPassword(false);
    setForm(
      existing
        ? { ...emptyForm, first_name: existing.first_name, last_name: existing.last_name, phone: existing.phone ?? "", role: (roles as string[]).includes(existing.role) ? (existing.role as ManagedRole) : "", sip_username: existing.sip_username ?? "" }
        : emptyForm,
    );
  }, [target]);

  const set = (field: keyof UserForm) => (event: { target: { value: string } }) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    if (creating) {
      if (!form.email.trim() || !form.first_name.trim() || !form.password) return setFeedback({ tone: "error", text: t("users.requiredFields") });
      if (form.password.length < 6) return setFeedback({ tone: "error", text: t("users.passwordMinLength") });
    }
    setSaving(true);
    try {
      if (creating) {
        const { user } = await api.createUser({ email: form.email.trim(), first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim() || null, password: form.password, role: form.role || "calisan" });
        onSaved(user, true);
      } else if (existing) {
        const { user } = await api.updateUser(existing.public_id, {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone.trim() || null,
          ...(form.role ? { role: form.role } : {}),
          sip_username: form.sip_username.trim() || null,
          // A blank SIP password keeps the stored (encrypted) one.
          ...(form.sip_password ? { sip_password: form.sip_password } : {}),
        });
        onSaved(user, false);
      }
    } catch (error) {
      setFeedback({ tone: "error", text: t(creating ? "users.createFailed" : "users.updateFailed", { error: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={target !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("users.close")} className="w-[min(30rem,100vw)] overflow-y-auto p-0" data-testid="user-sheet">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{creating ? t("users.newUser") : t("users.editUser")}</SheetTitle>
          <SheetDescription className="break-all">{existing?.email ?? t("users.pageSubtitle")}</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-3 p-4" onSubmit={(event) => void submit(event)} data-testid="user-form">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={`${t("users.firstName")}${creating ? " *" : ""}`}>
              <Input className="h-11 md:h-9" value={form.first_name} onChange={set("first_name")} data-testid="user-first-name" />
            </Field>
            <Field label={t("users.lastName")}>
              <Input className="h-11 md:h-9" value={form.last_name} onChange={set("last_name")} data-testid="user-last-name" />
            </Field>
          </div>
          {creating && (
            <Field label={`${t("users.email")} *`}>
              <Input className="h-11 md:h-9" type="email" value={form.email} onChange={set("email")} data-testid="user-email" />
            </Field>
          )}
          <Field label={t("users.phone")}>
            <Input className="h-11 md:h-9" type="tel" value={form.phone} placeholder="05xx xxx xx xx" onChange={set("phone")} data-testid="user-phone" />
          </Field>
          {creating && (
            <Field label={`${t("users.password")} *`}>
              <span className="flex gap-2">
                <Input className="h-11 md:h-9" type={showPassword ? "text" : "password"} autoComplete="new-password" value={form.password} placeholder={t("users.passwordPlaceholder")} onChange={set("password")} data-testid="user-password" />
                <Button type="button" variant="outline" size="icon" className="size-11 shrink-0 md:size-9" aria-label={t("users.showPassword")} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </Button>
              </span>
            </Field>
          )}
          <Field label={t("users.role")}>
            <NativeSelect value={form.role} onChange={set("role")} data-testid="user-role">
              <option value="">{creating ? roleName("calisan") : t("users.keepRole")}</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {roleName(role)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {existing && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("users.sipUsername")}>
                <Input className="h-11 md:h-9" value={form.sip_username} onChange={set("sip_username")} data-testid="user-sip-username" />
              </Field>
              <Field label={t("users.sipPassword")}>
                <Input
                  className="h-11 md:h-9"
                  type="password"
                  autoComplete="new-password"
                  value={form.sip_password}
                  placeholder={existing.sip_password_configured ? t("users.sipPasswordPlaceholder") : t("users.sipPassword")}
                  onChange={set("sip_password")}
                  data-testid="user-sip-password"
                />
              </Field>
            </div>
          )}
          <FeedbackLine feedback={feedback} testId="user-form-feedback" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
              {t("users.cancel")}
            </Button>
            <Button type="submit" className="min-h-11" disabled={saving} data-testid="user-save">
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {creating ? t("users.create") : t("users.save")}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** /islem-loglari — legacy AyarlarPage "İşlem Logları" tab (`/admin/logs`, last 100 entries) with search and module filter. */
export function ActivityLogsPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const logs = useQuery("users:logs", () => api.listAdminLogs(100));
  const [query, setQuery] = useState("");
  const [module, setModule] = useState("");
  const rows = logs.data?.data ?? [];
  const modules = [...new Set(rows.map((row) => row.module))].sort();
  const needle = query.trim().toLocaleLowerCase("tr-TR");
  const visible = rows.filter(
    (row) => (!module || row.module === module) && (!needle || [row.actor_name, row.action, row.module, row.entity_id].some((value) => value?.toLocaleLowerCase("tr-TR").includes(needle))),
  );
  const columns: Column<AdminLogEntry>[] = [
    { key: "action", header: t("users.colAction"), mobile: "title", cell: (row) => <span className="font-medium">{row.action}</span> },
    { key: "module", header: t("users.colModule"), mobile: "badge", cell: (row) => <Badge tone="neutral">{row.module}</Badge> },
    { key: "date", header: t("users.colDate"), cell: (row) => formatDateTime(row.created_at, i18n.language) },
    { key: "user", header: t("users.colUser"), cell: (row) => row.actor_name ?? "-" },
    { key: "record", header: t("users.colRecord"), cell: (row) => <span className="break-all font-mono text-xs">{row.entity_id ?? "-"}</span> },
  ];

  return (
    <section data-testid="page-activity-logs">
      <PageHeader
        title={t("users.logsTitle")}
        description={t("users.logsSubtitle")}
        actions={
          <Button variant="outline" className="min-h-11" onClick={logs.reload} disabled={logs.loading} data-testid="logs-refresh">
            <RefreshCw className={cn("size-4", logs.loading && "animate-spin")} aria-hidden="true" />
            {t("users.refresh")}
          </Button>
        }
      />
      <Card className="mb-3 flex flex-col gap-2 p-3 sm:flex-row">
        <Input className="h-11 md:h-9" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("users.logSearch")} aria-label={t("users.logSearch")} data-testid="logs-search" />
        <NativeSelect className="sm:w-56" value={module} aria-label={t("users.logModule")} onChange={(event) => setModule(event.target.value)} data-testid="logs-module">
          <option value="">{t("users.logAllModules")}</option>
          {modules.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
      </Card>
      {logs.error && !logs.data ? <ErrorState onRetry={logs.reload} /> : <DataList testId="logs" rows={visible} columns={columns} rowKey={(row) => String(row.id)} loading={logs.loading} />}
    </section>
  );
}

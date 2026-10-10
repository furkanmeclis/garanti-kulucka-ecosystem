import { ListTodo, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  text: string;
  done: boolean;
}

const storageKey = (user: string) => `garanti-beta-dashboard-todo:${user}`;

function readTasks(user: string, defaults: Task[]): Task[] {
  try {
    const raw = window.localStorage.getItem(storageKey(user));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Task[];
    return Array.isArray(parsed) ? parsed.filter((task) => typeof task?.text === "string") : defaults;
  } catch {
    return defaults;
  }
}

/** Legacy Pano "Yapılacaklar": a personal checklist kept in this browser (the legacy list lived in page state only). */
export function TodoCard({ userKey }: { userKey: string }) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>(() =>
    readTasks(userKey, [
      { id: "d1", text: t("dashboard.todoDefault1"), done: false },
      { id: "d2", text: t("dashboard.todoDefault2"), done: true },
      { id: "d3", text: t("dashboard.todoDefault3"), done: false },
    ]),
  );
  const [draft, setDraft] = useState("");
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(userKey), JSON.stringify(tasks));
    } catch {
      /* storage unavailable: the list still works for this visit */
    }
  }, [tasks, userKey]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setTasks((current) => [...current, { id: `t${Date.now()}`, text, done: false }]);
    setDraft("");
  };
  const open = tasks.filter((task) => !task.done).length;

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5" data-testid="dashboard-todo">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold sm:text-base">
          <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
            <ListTodo className="size-4" aria-hidden="true" />
          </span>
          {t("dashboard.todoTitle")}
        </h2>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums" data-testid="dashboard-todo-count">
          {open}
        </span>
      </div>
      <form onSubmit={add} className="flex gap-2">
        <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("dashboard.todoPlaceholder")} aria-label={t("dashboard.todoPlaceholder")} className="h-11 text-base lg:h-9 lg:text-sm" data-testid="dashboard-todo-input" />
        <Button type="submit" size="icon" className="shrink-0 lg:size-9" disabled={!draft.trim()} aria-label={t("dashboard.todoAdd")} data-testid="dashboard-todo-add">
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      </form>
      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.todoEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tasks.map((task) => (
            <li key={task.id} className={cn("group flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted/60", task.done && "opacity-60")} data-testid="dashboard-todo-item">
              <Checkbox
                checked={task.done}
                onCheckedChange={(checked) => setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, done: checked === true } : item)))}
                aria-label={t("dashboard.todoToggle", { task: task.text })}
              />
              <span className={cn("min-w-0 flex-1 break-words text-sm", task.done && "line-through")}>{task.text}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground opacity-100 hover:text-destructive lg:size-8 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                aria-label={t("dashboard.todoDelete")}
                onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Eye, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminListStates,
  AdminPage,
  AdminTable,
  ConfirmDialog,
  Field,
  FilterSelect,
  MobileRow,
  Pager,
  SearchField,
  StatusBadge,
  TextField,
  Toolbar,
  usePaged,
  type Column,
} from "@/components/admin/ui";
import { ErrorState, ListSkeleton, StateSwitcher, useMockLoad } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { adminCategories, type AdminCategory } from "@/lib/admin-mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({
    meta: [{ title: "Categories — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: CategoriesAdmin,
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function CategoriesAdmin() {
  const loading = useMockLoad(500);
  const [items, setItems] = useState(adminCategories);
  const [q, setQ] = useState("");
  const [visibility, setVisibility] = useState("all");
  const [state, setState] = useState("ready");
  const [editing, setEditing] = useState<AdminCategory | "new" | null>(null);
  const [confirm, setConfirm] = useState<AdminCategory | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((c) => {
      const hit =
        !term ||
        c.name.toLowerCase().includes(term) ||
        c.slug.includes(term) ||
        c.description.toLowerCase().includes(term);
      const visHit = visibility === "all" || (visibility === "visible" ? c.visible : !c.visible);
      return hit && visHit;
    });
  }, [items, q, visibility]);

  const { page, setPage, pages, slice, total, perPage } = usePaged(filtered, 8);
  const s = loading ? "loading" : state;
  const totalGames = items.reduce((sum, c) => sum + c.games, 0);

  const toggleVisible = (c: AdminCategory) => {
    setItems((list) => list.map((x) => (x.id === c.id ? { ...x, visible: !x.visible } : x)));
    toast.success(`${c.name} ${c.visible ? "hidden from browse" : "visible in browse"}`);
  };

  const columns: Column<AdminCategory>[] = [
    {
      key: "name",
      head: "Category",
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{c.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">/{c.slug}</p>
        </div>
      ),
    },
    {
      key: "desc",
      head: "Description",
      className: "max-w-md",
      cell: (c) => (
        <span className="line-clamp-2 text-sm text-muted-foreground">{c.description}</span>
      ),
    },
    {
      key: "games",
      head: "Games",
      className: "text-right",
      cell: (c) => <span className="font-mono text-sm tabular">{c.games}</span>,
    },
    {
      key: "share",
      head: "Share of catalog",
      cell: (c) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(c.games / totalGames) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular">
            {Math.round((c.games / totalGames) * 100)}%
          </span>
        </div>
      ),
    },
    {
      key: "status",
      head: "Status",
      cell: (c) => (
        <StatusBadge tone={c.visible ? "success" : "muted"}>
          {c.visible ? "visible" : "hidden"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      head: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (c) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${c.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(c)}>
                <Pencil />
                Edit category
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/categories/$slug" params={{ slug: c.slug }}>
                  <Eye />
                  View public page
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleVisible(c)}>
                {c.visible ? "Hide from browse" : "Show in browse"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setConfirm(c)}>
                <Trash2 />
                Delete category
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="Categories"
      subtitle={`${items.length} categories · ${totalGames} games. Categories group the catalog in Explore and search.`}
      actions={
        <>
          <div className="hidden md:block">
            <StateSwitcher value={state} onChange={setState} />
          </div>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            New category
          </Button>
        </>
      }
    >
      <Toolbar>
        <SearchField
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search categories"
          label="Search categories"
        />
        <FilterSelect
          label="Category visibility"
          value={visibility}
          onChange={(v) => {
            setVisibility(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All categories" },
            { value: "visible", label: "Visible" },
            { value: "hidden", label: "Hidden" },
          ]}
        />
      </Toolbar>

      {s === "loading" ? (
        <ListSkeleton rows={8} avatar={false} />
      ) : s === "error" ? (
        <ErrorState onRetry={() => setState("ready")} />
      ) : s === "empty" || filtered.length === 0 ? (
        <AdminListStates
          state="empty"
          emptyTitle="No categories match"
          emptyBody="Try another search term or create a new category."
          action={
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus />
              New category
            </Button>
          }
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={slice}
            rowKey={(c) => c.id}
            onRow={(c) => setEditing(c)}
            mobileRow={(c) => (
              <MobileRow ariaLabel={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    /{c.slug} · {c.games} games
                  </p>
                </div>
                <StatusBadge tone={c.visible ? "success" : "muted"}>
                  {c.visible ? "visible" : "hidden"}
                </StatusBadge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </MobileRow>
            )}
          />
          <Pager
            page={page}
            pages={pages}
            setPage={setPage}
            total={total}
            perPage={perPage}
            label="categories"
          />
        </>
      )}

      <CategoryDialog
        value={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSave={(cat, isNew) => {
          setItems((list) =>
            isNew ? [...list, cat] : list.map((c) => (c.id === cat.id ? cat : c)),
          );
          toast.success(isNew ? `${cat.name} created` : `${cat.name} updated`);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this category?"
        description={`${confirm?.name} has ${confirm?.games} games. They will be moved to “Uncategorised” and the category page will stop working.`}
        confirmLabel="Delete category"
        destructive
        onConfirm={() => {
          if (confirm) {
            setItems((list) => list.filter((c) => c.id !== confirm.id));
            toast.success(`${confirm.name} deleted`);
          }
          setConfirm(null);
        }}
      />
    </AdminPage>
  );
}

function CategoryDialog({
  value,
  onOpenChange,
  onSave,
}: {
  value: AdminCategory | "new" | null;
  onOpenChange: (o: boolean) => void;
  onSave: (c: AdminCategory, isNew: boolean) => void;
}) {
  const isNew = value === "new";
  const current = value && value !== "new" ? value : null;
  const [name, setName] = useState(current?.name ?? "");
  const [slug, setSlug] = useState(current?.slug ?? "");
  const [description, setDescription] = useState(current?.description ?? "");
  const [visible, setVisible] = useState(current?.visible ?? true);
  const [games, setGames] = useState(current?.games ?? 0);
  const [lastKey, setLastKey] = useState<string | null>(current?.id ?? null);

  // Re-seed the form when a different category is opened.
  const key = value === "new" ? "new" : (current?.id ?? null);
  if (key !== lastKey) {
    setLastKey(key);
    setName(current?.name ?? "");
    setSlug(current?.slug ?? "");
    setDescription(current?.description ?? "");
    setVisible(current?.visible ?? true);
    setGames(current?.games ?? 0);
  }

  return (
    <Dialog open={!!value} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "New category" : `Edit ${current?.name}`}</DialogTitle>
          <DialogDescription>
            Categories appear in Explore, search filters and game details.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <TextField
            id="cat-name"
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (isNew) setSlug(slugify(e.target.value));
            }}
            placeholder="e.g. Word"
            maxLength={32}
          />
          <TextField
            id="cat-slug"
            label="URL slug"
            value={slug}
            onChange={(e) => setSlug(slugify(e.target.value))}
            placeholder="word"
            hint="lowercase"
          />
          <Field id="cat-desc" label="Description">
            <Textarea
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={140}
              className="bg-surface-2"
              placeholder="Letters, anagrams and vocabulary races."
            />
          </Field>
          {!isNew && (
            <TextField
              id="cat-games"
              label="Game count"
              value={String(games)}
              onChange={(e) => setGames(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
              hint="mock value"
            />
          )}
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
            <Label htmlFor="cat-visible" className="flex-1 font-normal">
              <span className="block text-sm">Visible in browse</span>
              <span className="text-xs text-muted-foreground">
                Hidden categories stay on existing games
              </span>
            </Label>
            <Switch id="cat-visible" checked={visible} onCheckedChange={setVisible} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || !slug.trim()}
            onClick={() => {
              if (!name.trim() || !slug.trim()) {
                toast.error("Name and slug are required");
                return;
              }
              onSave(
                {
                  id: current?.id ?? `cat-${Math.random().toString(36).slice(2, 7)}`,
                  name: name.trim(),
                  slug: slug.trim(),
                  description: description.trim(),
                  games,
                  visible,
                },
                isNew,
              );
            }}
            className={cn(!name.trim() && "opacity-50")}
          >
            {isNew ? "Create category" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

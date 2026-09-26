import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder,
  MoreHorizontal,
  Plus,
  Rss,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { describeFeedError } from '@rss/shared';
import { FeedProblem } from '@/components/feed/FeedProblem';
import { FeedSettingsDialog } from '@/components/feed/FeedSettingsDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { folderDrop, HAS_CHILDREN_MESSAGE } from '@/lib/folder-drop';
import { useMarkAllRead } from '@/lib/mark-all-read';
import { notify } from '@/lib/notify';
import {
  byFolderName,
  canReorder,
  dropIndex,
  feedMatches,
  folderChoices,
  makeFeedComparator,
  makeFolderComparator,
  type FeedSort,
} from '@/lib/feed-order';
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useRefreshFeed,
  useSubscriptions,
  useUnsubscribe,
  useUpdateFolder,
  useUpdateSubscription,
  type FolderRow,
  type SubscriptionRow,
} from '@/lib/folders';
import { setFoldersExpanded, toggleFolderExpanded, useExpandedFolders } from '@/lib/sidebar-expanded';
import { cn } from '@/lib/utils';

type DragData =
  | { type: 'feed'; subscriptionId: string; folderId: string | null }
  | { type: 'folder'; folderId: string; parentId: string | null }
  | { type: 'dropzone'; folderId: string | null };

/** Outside manual order, rows do not make room while you drag: a drop there
 *  only moves a feed to another folder, and never reorders (#27). */
const noShift: SortingStrategy = () => null;

/** Where the pointer was at the drop, or null for a keyboard drag. */
function pointerY(event: DragEndEvent): number | null {
  const start = event.activatorEvent;
  const y =
    'touches' in start && (start as TouchEvent).touches.length > 0
      ? (start as TouchEvent).touches[0]!.clientY
      : 'clientY' in start
        ? (start as MouseEvent).clientY
        : null;
  return y === null ? null : y + event.delta.y;
}

/** A folder's own row, not its open contents, which its sortable node includes. */
function rowBox(folderId: string) {
  const row = document.querySelector(`[data-folder-row="${folderId}"]`);
  return row ? row.getBoundingClientRect() : null;
}

/**
 * When a press becomes a drag (#21). A mouse drags after 4 px of travel. A
 * touch must be held still (5 px tolerance) for 250 ms first, so a swipe
 * scrolls the list and never picks a row up.
 */
const DRAG_ACTIVATION = {
  mouse: { distance: 4 },
  touch: { delay: 250, tolerance: 5 },
} as const;

interface FolderTreeProps {
  activeFeedId?: string;
  activeFolderId?: string;
  onSelectFeed: (feedId: string) => void;
  onSelectFolder: (folderId: string) => void;
  countByFeed: Map<string, number>;
  /** Unread per folder, child folders included (server rollup, #25). */
  countByFolder?: Map<string, number>;
  sort: FeedSort;
  /** When true, hide feeds (and now-empty folders) that have no unread items. */
  hideRead?: boolean;
  /** The "New folder" field, when the sidebar "+" menu opens it (#35). */
  creatingFolder?: boolean;
  onCreatingFolderChange?: (creating: boolean) => void;
}

const NO_COUNTS = new Map<string, number>();

export function FolderTree({
  activeFeedId,
  activeFolderId,
  onSelectFeed,
  onSelectFolder,
  countByFeed,
  countByFolder = NO_COUNTS,
  sort,
  hideRead = false,
  creatingFolder,
  onCreatingFolderChange,
}: FolderTreeProps) {
  const { data: foldersData } = useFolders();
  const { data: feedsData } = useSubscriptions();
  const folders = foldersData?.items ?? [];
  const subs = feedsData?.items ?? [];

  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const updateSub = useUpdateSubscription();
  const unsubscribe = useUnsubscribe();
  // The same Mark all read as the top bar: Undo on a toast (#26).
  const markAll = useMarkAllRead();
  const feedName = (feedId: string) => {
    const s = subs.find((x) => x.feedId === feedId);
    return s ? (s.customTitle ?? s.title ?? s.feedUrl) : 'this feed';
  };

  const expanded = useExpandedFolders();
  const [editing, setEditing] = useState<{ kind: 'folder' | 'feed'; id: string } | null>(null);
  const [settingsSub, setSettingsSub] = useState<SubscriptionRow | null>(null);
  const [localCreating, setLocalCreating] = useState(false);
  const creating = creatingFolder ?? localCreating;
  const setCreating = onCreatingFolderChange ?? setLocalCreating;
  // The folder that gets a new subfolder (#28), shown as an input inside it.
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const startSubfolder = (parentId: string) => {
    if (!expanded.has(parentId)) toggleFolderExpanded(parentId);
    setCreatingIn(parentId);
  };
  const createSubfolder = (name: string) => {
    if (creatingIn && name.trim()) createFolder.mutate({ name: name.trim(), parentId: creatingIn });
    setCreatingIn(null);
  };
  // The row-menu button that opened the feed-settings dialog, so focus returns
  // to it on close. Captured while the menu is still open (the menu item that was
  // clicked is gone by the time the dialog closes).
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const openFeedSettings = (sub: SubscriptionRow) => {
    settingsTrigger.current = document.querySelector<HTMLElement>(
      '[data-state="open"][aria-haspopup="menu"]',
    );
    // Let the menu finish closing (and its own focus handling) before the dialog
    // mounts, so the dialog's focus trap is not fought by the closing menu.
    setTimeout(() => setSettingsSub(sub), 0);
  };

  // Feeds follow the sort mode (by name, by unread count, or manual). Folders
  // are alphabetical except in manual mode. Because counts come from a live
  // query, marking read re-sorts on the next render for free. Shared with the
  // keyboard layer via feed-order so next/prev-feed steps through the exact
  // order shown here.
  const byFeed = makeFeedComparator(sort, countByFeed);
  const byFolder = makeFolderComparator(sort);
  const reorder = canReorder(sort);
  const strategy = reorder ? verticalListSortingStrategy : noShift;

  // In hide-read mode a feed is shown only if it has unread items - except the
  // feed you are currently reading, which stays put so it never vanishes from
  // under you as you mark its last item read, and a failing feed, which
  // usually has nothing unread and would hide its warning too (#29).
  // A filter (#46) shows only the feeds that match, read or not, each inside
  // its folders, which open for it. The saved expand state is not touched, so
  // clearing the filter puts the tree back as it was.
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const feedVisible = (s: SubscriptionRow) =>
    query
      ? feedMatches(s, query)
      : !hideRead ||
        (countByFeed.get(s.feedId) ?? 0) > 0 ||
        s.feedId === activeFeedId ||
        s.lastError !== null;
  const feedsIn = (folderId: string | null) =>
    subs.filter((s) => s.folderId === folderId && feedVisible(s)).sort(byFeed);
  // A folder is shown while it (or a child folder) still has a visible feed, or
  // it is the folder currently in view.
  const folderHasVisible = (id: string): boolean =>
    (!query && (!hideRead || id === activeFolderId)) ||
    feedsIn(id).length > 0 ||
    folders.some((c) => c.parentId === id && feedsIn(c.id).length > 0);
  const openFolders = query ? new Set(folders.map((f) => f.id)) : expanded;
  const noMatches = query !== '' && !folders.some((f) => folderHasVisible(f.id)) && feedsIn(null).length === 0;
  // Collapse all / expand all (#46): Alt-click on a chevron, or the folder menu.
  const setAllExpanded = (open: boolean) => setFoldersExpanded(folders.map((f) => f.id), open);
  const anyExpanded = folders.some((f) => expanded.has(f.id));
  const allExpanded = folders.every((f) => expanded.has(f.id));
  const childrenOf = (id: string) =>
    folders.filter((f) => f.parentId === id && folderHasVisible(f.id)).sort(byFolder);
  const rootFolders = folders
    .filter((f) => f.parentId === null && folderHasVisible(f.id))
    .sort(byFolder);
  const hasChildren = (id: string) => folders.some((f) => f.parentId === id);
  // "Move to" lists every root folder, also ones hidden by unread only.
  const allRoots = folders.filter((f) => f.parentId === null).sort(byFolderName);
  // Unread only hid every feed: say why the tree is empty (#35).
  const allCaughtUp =
    !query && hideRead && subs.length > 0 && rootFolders.length === 0 && feedsIn(null).length === 0;

  const toggle = toggleFolderExpanded;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: DRAG_ACTIVATION.mouse }),
    useSensor(TouchSensor, { activationConstraint: DRAG_ACTIVATION.touch }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const a = active.data.current as DragData | undefined;
    const o = over.data.current as DragData | undefined;
    if (!a || !o) return;
    // Failures surface as toasts from the mutations' meta (lib/queryClient.ts).

    if (a.type === 'feed') {
      // A feed row, a folder row, or a folder body: the drop names the folder.
      const folderId = o.folderId;
      let position: number | undefined;
      if (o.type === 'feed') {
        if (o.subscriptionId === a.subscriptionId) return;
        // Only manual order places the feed at the row it was dropped on.
        // Otherwise the sort decides where it shows, so only a move counts.
        if (reorder) {
          const scope = subs
            .filter((s) => s.folderId === folderId)
            .sort(byFeed)
            .map((s) => s.subscriptionId);
          position = dropIndex(scope, a.subscriptionId, o.subscriptionId);
        } else if (folderId === a.folderId) {
          return;
        }
      }
      if (folderId === a.folderId && position === undefined) return;
      updateSub.mutate({ id: a.subscriptionId, folderId, position });
      return;
    }

    if (a.type === 'folder') {
      if (o.type === 'folder') {
        const dragged = folders.find((f) => f.id === a.folderId);
        const target = folders.find((f) => f.id === o.folderId);
        if (!dragged || !target) return;
        const drop = folderDrop({
          dragged,
          target,
          draggedHasChildren: hasChildren(dragged.id),
          reorder,
          y: pointerY(event),
          header: rowBox(target.id),
        });
        if (drop.kind === 'blocked') notify.info(drop.message);
        if (drop.kind === 'nest') updateFolder.mutate({ id: dragged.id, parentId: target.id });
        if (drop.kind === 'reorder') {
          const scope = folders
            .filter((f) => f.parentId === dragged.parentId)
            .sort(byFolder)
            .map((f) => f.id);
          updateFolder.mutate({ id: dragged.id, position: dropIndex(scope, dragged.id, target.id) });
        }
      } else if (o.type === 'dropzone' && o.folderId === null && a.parentId !== null) {
        updateFolder.mutate({ id: a.folderId, parentId: null });
      }
    }
  }

  const submitEdit = (value: string) => {
    const name = value.trim();
    if (editing && name) {
      if (editing.kind === 'folder') updateFolder.mutate({ id: editing.id, name });
      else updateSub.mutate({ id: editing.id, title: name });
    }
    setEditing(null);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="mt-1 space-y-0.5 text-sm">
        {subs.length >= FILTER_MIN_FEEDS && <FeedFilter value={filter} onChange={setFilter} />}
        {noMatches && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No feeds match “{filter.trim()}”.</p>
        )}

        {/* Root folders (each collapsible, holding its feeds and child folders) */}
        <SortableContext
          items={rootFolders.map((f) => `folder:${f.id}`)}
          strategy={strategy}
        >
          {rootFolders.map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              reorder={reorder}
              depth={0}
              expanded={openFolders.has(folder.id)}
              onToggle={() => toggle(folder.id)}
              onSetAllExpanded={setAllExpanded}
              anyExpanded={anyExpanded}
              allExpanded={allExpanded}
              isActive={activeFolderId === folder.id}
              onSelect={() => onSelectFolder(folder.id)}
              childFolders={childrenOf(folder.id)}
              feeds={feedsIn(folder.id)}
              feedsInChild={feedsIn}
              expandedSet={openFolders}
              onToggleChild={toggle}
              activeFeedId={activeFeedId}
              onSelectFeed={onSelectFeed}
              countByFeed={countByFeed}
              countByFolder={countByFolder}
              editing={editing}
              setEditing={setEditing}
              submitEdit={submitEdit}
              // These take the folder: a child FolderNode gets the same props,
              // so a closure over `folder` would act on the parent (#28).
              onDelete={(f) => {
                if (confirm(`Delete folder "${f.name}"? Its feeds move out, not away.`)) {
                  deleteFolder.mutate(f.id);
                }
              }}
              onMarkRead={(f) => markAll({ folderId: f.id }, f.name)}
              moveTargets={allRoots}
              hasChildren={hasChildren}
              onMove={(id, parentId) => updateFolder.mutate({ id, parentId })}
              creatingIn={creatingIn}
              onNewSubfolder={startSubfolder}
              onCreateSubfolder={createSubfolder}
              onCancelSubfolder={() => setCreatingIn(null)}
              onRenameFeed={(id) => setEditing({ kind: 'feed', id })}
              onEditFeed={openFeedSettings}
              onUnsubscribe={(id) => unsubscribe.mutate(id)}
              onMarkFeedRead={(feedId) => markAll({ feedId }, feedName(feedId))}
            />
          ))}
        </SortableContext>

        {allCaughtUp && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            All caught up. Feeds with nothing unread are hidden.
          </p>
        )}

        {/* Unfoldered feeds, and the drop target for moving back to root */}
        <RootZone>
          <SortableContext
            items={feedsIn(null).map((s) => `feed:${s.subscriptionId}`)}
            strategy={strategy}
          >
            {feedsIn(null).map((sub) => (
              <FeedNode
                key={sub.subscriptionId}
                sub={sub}
                reorder={reorder}
                depth={0}
                isActive={activeFeedId === sub.feedId}
                onSelect={() => onSelectFeed(sub.feedId)}
                unread={countByFeed.get(sub.feedId) ?? 0}
                isEditing={editing?.kind === 'feed' && editing.id === sub.subscriptionId}
                onSubmitEdit={submitEdit}
                onCancelEdit={() => setEditing(null)}
                onRename={() => setEditing({ kind: 'feed', id: sub.subscriptionId })}
                onEditSettings={() => openFeedSettings(sub)}
                onUnsubscribe={() => unsubscribe.mutate(sub.subscriptionId)}
                onMarkRead={() => markAll({ feedId: sub.feedId }, feedName(sub.feedId))}
              />
            ))}
          </SortableContext>
        </RootZone>

        {creating ? (
          <InlineInput
            placeholder="Folder name"
            onSubmit={(name) => {
              if (name.trim()) createFolder.mutate(name.trim());
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
          >
            <Plus className="size-3.5" /> New folder
          </button>
        )}
      </div>

      {settingsSub && (
        <FeedSettingsDialog
          sub={settingsSub}
          restoreFocusRef={settingsTrigger}
          onOpenChange={(open) => !open && setSettingsSub(null)}
        />
      )}
    </DndContext>
  );
}

/** With fewer feeds than this, the whole list fits on screen, so no filter. */
const FILTER_MIN_FEEDS = 10;

/** The feed filter above the tree (#46). Escape clears it. */
function FeedFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-1 px-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // With text in it, Escape only clears the filter, and must not also
          // reach the page shortcuts (which close the reader).
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder="Filter feeds"
        aria-label="Filter feeds"
        className="h-7 w-full rounded-md border border-input bg-background pr-7 pl-7 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear the filter"
          title="Clear the filter (Esc)"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function RootZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'zone:root',
    data: { type: 'dropzone', folderId: null } satisfies DragData,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn('min-h-8 rounded-md', isOver && 'bg-accent/50 ring-1 ring-ring')}
    >
      {children}
    </div>
  );
}

interface FolderNodeProps {
  folder: FolderRow;
  /** Manual order: a drop reorders. Otherwise it only moves (#27). */
  reorder: boolean;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  /** Expand or collapse every folder (#46). */
  onSetAllExpanded: (open: boolean) => void;
  anyExpanded: boolean;
  allExpanded: boolean;
  isActive: boolean;
  onSelect: () => void;
  childFolders: FolderRow[];
  feeds: SubscriptionRow[];
  feedsInChild: (folderId: string | null) => SubscriptionRow[];
  expandedSet: Set<string>;
  onToggleChild: (id: string) => void;
  activeFeedId?: string;
  onSelectFeed: (feedId: string) => void;
  countByFeed: Map<string, number>;
  countByFolder: Map<string, number>;
  editing: { kind: 'folder' | 'feed'; id: string } | null;
  setEditing: (e: { kind: 'folder' | 'feed'; id: string } | null) => void;
  submitEdit: (value: string) => void;
  onDelete: (folder: FolderRow) => void;
  onMarkRead: (folder: FolderRow) => void;
  /** Root folders, for "Move to". */
  moveTargets: FolderRow[];
  hasChildren: (folderId: string) => boolean;
  onMove: (folderId: string, parentId: string | null) => void;
  /** The folder showing a "new subfolder" input, if any. */
  creatingIn: string | null;
  onNewSubfolder: (parentId: string) => void;
  onCreateSubfolder: (name: string) => void;
  onCancelSubfolder: () => void;
  onRenameFeed: (subscriptionId: string) => void;
  onEditFeed: (sub: SubscriptionRow) => void;
  onUnsubscribe: (subscriptionId: string) => void;
  onMarkFeedRead: (feedId: string) => void;
}

function FolderNode(props: FolderNodeProps) {
  const { folder, reorder, depth, expanded, editing } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `folder:${folder.id}`,
    data: {
      type: 'folder',
      folderId: folder.id,
      parentId: folder.parentId,
    } satisfies DragData,
  });
  const strategy = reorder ? verticalListSortingStrategy : noShift;

  const isEditing = editing?.kind === 'folder' && editing.id === folder.id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-50')}
    >
      <div
        data-folder-row={folder.id}
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5',
          props.isActive ? 'bg-accent font-medium' : 'hover:bg-accent',
        )}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        <button
          onClick={(e) => (e.altKey ? props.onSetAllExpanded(!expanded) : props.onToggle())}
          aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
          title={
            expanded
              ? 'Collapse folder (Alt-click: collapse all folders)'
              : 'Expand folder (Alt-click: expand all folders)'
          }
          className="shrink-0 rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Drag folder ${folder.name}`}
          title={reorder ? `Drag to reorder or move ${folder.name}` : `Drag to move ${folder.name}`}
        >
          <Folder className="size-4 shrink-0 text-muted-foreground" />
        </span>

        {isEditing ? (
          <InlineInput
            defaultValue={folder.name}
            onSubmit={props.submitEdit}
            onCancel={() => props.setEditing(null)}
          />
        ) : (
          <button
            onClick={props.onSelect}
            onDoubleClick={() => props.setEditing({ kind: 'folder', id: folder.id })}
            className="min-w-0 flex-1 truncate text-left"
          >
            {folder.name}
          </button>
        )}
        {!isEditing && (props.countByFolder.get(folder.id) ?? 0) > 0 && (
          <span
            className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal tabular-nums text-muted-foreground"
            aria-label={`${props.countByFolder.get(folder.id)} unread`}
          >
            {props.countByFolder.get(folder.id)}
          </span>
        )}

        <RowMenu label={`Folder actions for ${folder.name}`}>
          {(afterClose) => (
            <>
              <DropdownMenuItem
                onSelect={() => afterClose(() => props.setEditing({ kind: 'folder', id: folder.id }))}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onMarkRead(folder)}>Mark all read</DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* One level only, as the API allows (#28). */}
              <DropdownMenuItem
                disabled={folder.parentId !== null}
                onSelect={() => afterClose(() => props.onNewSubfolder(folder.id))}
              >
                New subfolder
              </DropdownMenuItem>
              <MoveToMenu
                folder={folder}
                targets={props.moveTargets}
                hasChildren={props.hasChildren(folder.id)}
                onMove={(parentId) => props.onMove(folder.id, parentId)}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={props.allExpanded} onSelect={() => props.onSetAllExpanded(true)}>
                Expand all folders
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!props.anyExpanded} onSelect={() => props.onSetAllExpanded(false)}>
                Collapse all folders
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={() => props.onDelete(folder)}>
                Delete folder
              </DropdownMenuItem>
            </>
          )}
        </RowMenu>
      </div>

      {expanded && (
        <FolderContents folderId={folder.id}>
          {props.creatingIn === folder.id && (
            <InlineInput
              placeholder="Subfolder name"
              onSubmit={props.onCreateSubfolder}
              onCancel={props.onCancelSubfolder}
            />
          )}
          <SortableContext
            items={props.childFolders.map((f) => `folder:${f.id}`)}
            strategy={strategy}
          >
            {props.childFolders.map((child) => (
              <FolderNode
                {...props}
                key={child.id}
                folder={child}
                depth={depth + 1}
                expanded={props.expandedSet.has(child.id)}
                onToggle={() => props.onToggleChild(child.id)}
                childFolders={[]}
                feeds={props.feedsInChild(child.id)}
              />
            ))}
          </SortableContext>

          <SortableContext
            items={props.feeds.map((s) => `feed:${s.subscriptionId}`)}
            strategy={strategy}
          >
            {props.feeds.map((sub) => (
              <FeedNode
                key={sub.subscriptionId}
                sub={sub}
                reorder={reorder}
                depth={depth + 1}
                isActive={props.activeFeedId === sub.feedId}
                onSelect={() => props.onSelectFeed(sub.feedId)}
                unread={props.countByFeed.get(sub.feedId) ?? 0}
                isEditing={editing?.kind === 'feed' && editing.id === sub.subscriptionId}
                onSubmitEdit={props.submitEdit}
                onCancelEdit={() => props.setEditing(null)}
                onRename={() => props.onRenameFeed(sub.subscriptionId)}
                onEditSettings={() => props.onEditFeed(sub)}
                onUnsubscribe={() => props.onUnsubscribe(sub.subscriptionId)}
                onMarkRead={() => props.onMarkFeedRead(sub.feedId)}
              />
            ))}
          </SortableContext>
        </FolderContents>
      )}
    </div>
  );
}

/** Droppable body of an expanded folder, so empty folders can accept a drop. */
function FolderContents({ folderId, children }: { folderId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `zone:${folderId}`,
    data: { type: 'dropzone', folderId } satisfies DragData,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn('ml-3 min-h-6 space-y-0.5', isOver && 'rounded-md bg-accent/50 ring-1 ring-ring')}
    >
      {children}
    </div>
  );
}

interface FeedNodeProps {
  sub: SubscriptionRow;
  reorder: boolean;
  depth: number;
  isActive: boolean;
  onSelect: () => void;
  unread: number;
  isEditing: boolean;
  onSubmitEdit: (value: string) => void;
  onCancelEdit: () => void;
  onRename: () => void;
  onEditSettings: () => void;
  onUnsubscribe: () => void;
  onMarkRead: () => void;
}

function FeedNode({
  sub,
  reorder,
  depth,
  isActive,
  onSelect,
  unread,
  isEditing,
  onSubmitEdit,
  onCancelEdit,
  onRename,
  onEditSettings,
  onUnsubscribe,
  onMarkRead,
}: FeedNodeProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `feed:${sub.subscriptionId}`,
      data: {
        type: 'feed',
        subscriptionId: sub.subscriptionId,
        folderId: sub.folderId,
      } satisfies DragData,
    });

  // A favicon that fails to load must fall back to the generic icon, not
  // vanish: the icon keeps titles aligned across rows. Keyed by URL so a
  // corrected favicon (feed URL change) gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // When this row becomes the active feed (e.g. from n/p keyboard nav), pull it
  // into view. `nearest` scrolls the sidebar minimally and is a no-op if it is
  // already visible, so clicks and drags do not jump the list.
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);
  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    rowRef.current = node;
  };

  const label = sub.customTitle ?? sub.title ?? sub.feedUrl;

  return (
    <div
      ref={setRefs}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        paddingLeft: `${depth * 0.75}rem`,
      }}
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5',
        isActive ? 'bg-accent' : 'hover:bg-accent',
        isDragging && 'opacity-50',
      )}
      title={sub.feedUrl}
      // The whole row is a drag surface: a mouse needs 4px of travel and a
      // touch a 250ms hold (DRAG_ACTIVATION), so clicks, taps, and swipes to
      // scroll still select/open/scroll.
      // Suppressed while renaming, or selecting text in the inline input
      // would drag the row. Keyboard drag stays on the icon handle: it is
      // the registered activator node, so Enter/Space bubbling up from the
      // row's buttons is rejected by the keyboard sensor.
      {...(isEditing ? undefined : listeners)}
    >
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Drag ${label}`}
        title={reorder ? `Drag to reorder or move ${label}` : `Drag to move ${label} to another folder`}
      >
        {sub.faviconUrl && sub.faviconUrl !== failedSrc ? (
          <img
            src={sub.faviconUrl}
            alt=""
            className="size-4 rounded-sm"
            onError={() => setFailedSrc(sub.faviconUrl)}
          />
        ) : (
          <Rss className="size-4 text-muted-foreground" />
        )}
      </span>

      {isEditing ? (
        <InlineInput defaultValue={label} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />
      ) : (
        <>
          <button
            onClick={onSelect}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 truncate text-left',
              // Firehose feeds (SPEC-022) sit back; precious ones lean in.
              sub.attention === 'firehose' && 'text-muted-foreground',
            )}
          >
            {sub.attention === 'precious' && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
                title="Must-read feed"
              />
            )}
            <span className="truncate">{label}</span>
          </button>
          {sub.lastError && <FeedErrorButton sub={sub} onEdit={onEditSettings} />}
          {unread > 0 && sub.attention !== 'firehose' && (
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                sub.attention === 'precious'
                  ? 'bg-primary/15 font-medium text-primary'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {unread}
            </span>
          )}
        </>
      )}

      <RowMenu label={`Feed actions for ${label}`}>
        {(afterClose) => (
          <>
            <DropdownMenuItem onSelect={onEditSettings}>Edit…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => afterClose(onRename)}>Rename</DropdownMenuItem>
            <FeedMoveToMenu sub={sub} />
            {sub.siteUrl && (
              <DropdownMenuItem asChild>
                <a href={sub.siteUrl} target="_blank" rel="noopener noreferrer">
                  Open website
                </a>
              </DropdownMenuItem>
            )}
            <RefreshFeedItem subscriptionId={sub.subscriptionId} />
            <DropdownMenuItem onSelect={onMarkRead}>Mark all read</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={onUnsubscribe}>
              Unsubscribe
            </DropdownMenuItem>
          </>
        )}
      </RowMenu>
    </div>
  );
}

/**
 * "Move to" for a feed (#45): the keyboard and touch way to file it, with
 * subfolders indented under their parent. The menu content mounts only while
 * open, so these hooks cost nothing on the other rows.
 */
function FeedMoveToMenu({ sub }: { sub: SubscriptionRow }) {
  const { data } = useFolders();
  const updateSub = useUpdateSubscription();
  const choices = folderChoices(data?.items ?? []);
  const move = (folderId: string | null) => updateSub.mutate({ id: sub.subscriptionId, folderId });
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
      <DropdownMenuSubContent {...stopDrag}>
        <DropdownMenuItem disabled={sub.folderId === null} onSelect={() => move(null)}>
          No folder
        </DropdownMenuItem>
        {choices.map(({ folder, depth }) => (
          <DropdownMenuItem
            key={folder.id}
            disabled={folder.id === sub.folderId}
            className={depth ? 'pl-6' : undefined}
            onSelect={() => move(folder.id)}
          >
            {folder.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Fetch just this feed now (#45), the same call as "Retry now" (#29). */
function RefreshFeedItem({ subscriptionId }: { subscriptionId: string }) {
  const refresh = useRefreshFeed();
  return <DropdownMenuItem onSelect={() => refresh.mutate(subscriptionId)}>Refresh this feed</DropdownMenuItem>;
}

/**
 * The red triangle on a failing feed (#29). A click or a tap opens why it
 * fails and the fixes, so mouse and touch users alike can read it without a
 * hover tooltip or the Edit dialog.
 */
function FeedErrorButton({ sub, onEdit }: { sub: SubscriptionRow; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const { summary } = describeFeedError(sub.lastError ?? '');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:p-1.5"
          aria-label={`Feed problem: ${summary}`}
          title={summary}
        >
          <AlertTriangle className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent {...stopDrag}>
        <FeedProblem
          sub={sub}
          onEdit={() => {
            setOpen(false);
            onEdit();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Actions menu. Visible on hover, on keyboard focus, and always on touch
 * screens, which have no hover (#21). Never hover-only.
 */
function RowMenu({
  label,
  children,
}: {
  label: string;
  /** `afterClose(fn)` runs `fn` once the menu has closed. */
  children: (afterClose: (fn: () => void) => void) => React.ReactNode;
}) {
  // Rename and New subfolder open a text field that takes focus. While the
  // menu closes, it puts focus back on its button, which would blur the field,
  // and a blur cancels it. So those actions wait until the menu has closed,
  // and then focus stays where the field puts it.
  const pending = useRef<(() => void) | null>(null);
  const afterClose = (fn: () => void) => {
    pending.current = fn;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className="size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      {/* The menu is portalled, but React still bubbles its presses up to the
          row's drag listeners. A few px of travel during the click then starts
          a drag, and dnd-kit swallows the click, so the item never fires. Keep
          menu presses out of the mouse and touch drag sensors. */}
      <DropdownMenuContent
        align="end"
        {...stopDrag}
        onCloseAutoFocus={(e) => {
          const fn = pending.current;
          if (!fn) return;
          pending.current = null;
          e.preventDefault();
          fn();
        }}
      >
        {children(afterClose)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();
/** Keeps menu presses out of the row's mouse and touch drag sensors. */
const stopDrag = { onPointerDown: stop, onMouseDown: stop, onTouchStart: stop };

/**
 * "Move to": the keyboard and touch way to nest a folder, or take it out
 * (#28). A folder with subfolders cannot go inside another folder, and the
 * menu says so instead of offering targets that would fail.
 */
function MoveToMenu({
  folder,
  targets,
  hasChildren,
  onMove,
}: {
  folder: FolderRow;
  targets: FolderRow[];
  hasChildren: boolean;
  onMove: (parentId: string | null) => void;
}) {
  const into = targets.filter((t) => t.id !== folder.id && t.id !== folder.parentId);
  if (folder.parentId === null && into.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
      <DropdownMenuSubContent {...stopDrag}>
        {folder.parentId !== null && (
          <DropdownMenuItem onSelect={() => onMove(null)}>Top level</DropdownMenuItem>
        )}
        {hasChildren ? (
          <DropdownMenuItem disabled>{HAS_CHILDREN_MESSAGE}</DropdownMenuItem>
        ) : (
          into.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => onMove(t.id)}>
              {t.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function InlineInput({
  defaultValue = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  // Enter or Escape closes the input, and the unmount can then fire a blur.
  // Only the first of these may act.
  const done = useRef(false);
  const finish = (act: () => void) => {
    if (done.current) return;
    done.current = true;
    act();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finish(() => onSubmit(value));
    if (e.key === 'Escape') finish(onCancel);
  };
  // #43: a click away keeps a new name. Only Escape throws it away.
  const onBlur = () => {
    const changed = value.trim() !== '' && value.trim() !== defaultValue.trim();
    finish(changed ? () => onSubmit(value) : onCancel);
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

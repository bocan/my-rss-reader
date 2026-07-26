import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder,
  MoreHorizontal,
  Plus,
  Rss,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FeedSettingsDialog } from '@/components/feed/FeedSettingsDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMarkRead } from '@/lib/articles';
import { byFolderName, makeFeedComparator, type FeedSort } from '@/lib/feed-order';
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useSubscriptions,
  useUnsubscribe,
  useUpdateFolder,
  useUpdateSubscription,
  type FolderRow,
  type SubscriptionRow,
} from '@/lib/folders';
import { toggleFolderExpanded, useExpandedFolders } from '@/lib/sidebar-expanded';
import { cn } from '@/lib/utils';

type DragData =
  | { type: 'feed'; subscriptionId: string; folderId: string | null; index: number }
  | { type: 'folder'; folderId: string; parentId: string | null; index: number }
  | { type: 'dropzone'; folderId: string | null };

interface FolderTreeProps {
  activeFeedId?: string;
  activeFolderId?: string;
  onSelectFeed: (feedId: string) => void;
  onSelectFolder: (folderId: string) => void;
  countByFeed: Map<string, number>;
  sort: FeedSort;
  /** When true, hide feeds (and now-empty folders) that have no unread items. */
  hideRead?: boolean;
}

export function FolderTree({
  activeFeedId,
  activeFolderId,
  onSelectFeed,
  onSelectFolder,
  countByFeed,
  sort,
  hideRead = false,
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
  const markRead = useMarkRead();

  const expanded = useExpandedFolders();
  const [editing, setEditing] = useState<{ kind: 'folder' | 'feed'; id: string } | null>(null);
  const [settingsSub, setSettingsSub] = useState<SubscriptionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Folders are always alphabetical. Feeds follow the sort mode (by name, or by
  // unread count). Because counts come from a live query, marking read re-sorts
  // on the next render for free. Shared with the keyboard layer via feed-order so
  // next/prev-feed steps through the exact order shown here.
  const byFeed = makeFeedComparator(sort, countByFeed);

  // In hide-read mode a feed is shown only if it has unread items - except the
  // feed you are currently reading, which stays put so it never vanishes from
  // under you as you mark its last item read.
  const feedVisible = (s: SubscriptionRow) =>
    !hideRead || (countByFeed.get(s.feedId) ?? 0) > 0 || s.feedId === activeFeedId;
  const feedsIn = (folderId: string | null) =>
    subs.filter((s) => s.folderId === folderId && feedVisible(s)).sort(byFeed);
  // A folder is shown while it (or a child folder) still has a visible feed, or
  // it is the folder currently in view.
  const folderHasVisible = (id: string): boolean =>
    !hideRead ||
    id === activeFolderId ||
    feedsIn(id).length > 0 ||
    folders.some((c) => c.parentId === id && feedsIn(c.id).length > 0);
  const childrenOf = (id: string) =>
    folders.filter((f) => f.parentId === id && folderHasVisible(f.id)).sort(byFolderName);
  const rootFolders = folders
    .filter((f) => f.parentId === null && folderHasVisible(f.id))
    .sort(byFolderName);
  const hasChildren = (id: string) => folders.some((f) => f.parentId === id);

  const toggle = toggleFolderExpanded;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Mirror of the API depth-1 rule, so a drop never triggers a 400. */
  const canNest = (draggedId: string, targetFolder: FolderRow) =>
    draggedId !== targetFolder.id && targetFolder.parentId === null && !hasChildren(draggedId);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const a = active.data.current as DragData | undefined;
    const o = over.data.current as DragData | undefined;
    if (!a || !o) return;
    setError(null);

    if (a.type === 'feed') {
      let folderId: string | null;
      let position: number | undefined;
      if (o.type === 'feed') {
        folderId = o.folderId;
        position = o.index;
      } else if (o.type === 'folder') {
        folderId = o.folderId; // dropped onto a folder row: move into it
        position = undefined;
      } else {
        folderId = o.folderId;
        position = undefined;
      }
      if (folderId === a.folderId && position === a.index) return;
      updateSub.mutate(
        { id: a.subscriptionId, folderId, position },
        { onError: () => setError('Could not move that feed.') },
      );
      return;
    }

    if (a.type === 'folder') {
      if (o.type === 'folder') {
        const target = folders.find((f) => f.id === o.folderId);
        if (!target) return;
        if (o.parentId === a.parentId) {
          if (o.index === a.index) return;
          updateFolder.mutate(
            { id: a.folderId, position: o.index },
            { onError: () => setError('Could not reorder that folder.') },
          );
        } else if (canNest(a.folderId, target)) {
          updateFolder.mutate(
            { id: a.folderId, parentId: target.id },
            { onError: () => setError('Could not move that folder.') },
          );
        }
      } else if (o.type === 'dropzone' && o.folderId === null && a.parentId !== null) {
        updateFolder.mutate(
          { id: a.folderId, parentId: null },
          { onError: () => setError('Could not move that folder.') },
        );
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
        {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}

        {/* Root folders (each collapsible, holding its feeds and child folders) */}
        <SortableContext
          items={rootFolders.map((f) => `folder:${f.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {rootFolders.map((folder, index) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              index={index}
              depth={0}
              expanded={expanded.has(folder.id)}
              onToggle={() => toggle(folder.id)}
              isActive={activeFolderId === folder.id}
              onSelect={() => onSelectFolder(folder.id)}
              childFolders={childrenOf(folder.id)}
              feeds={feedsIn(folder.id)}
              feedsInChild={feedsIn}
              expandedSet={expanded}
              onToggleChild={toggle}
              activeFeedId={activeFeedId}
              onSelectFeed={onSelectFeed}
              countByFeed={countByFeed}
              editing={editing}
              setEditing={setEditing}
              submitEdit={submitEdit}
              onDelete={() => {
                if (confirm(`Delete folder "${folder.name}"? Its feeds move out, not away.`)) {
                  deleteFolder.mutate(folder.id, {
                    onError: () => setError('Could not delete that folder.'),
                  });
                }
              }}
              onMarkRead={() => markRead.mutate({ folderId: folder.id })}
              onRenameFeed={(id) => setEditing({ kind: 'feed', id })}
              onEditFeed={openFeedSettings}
              onUnsubscribe={(id) => unsubscribe.mutate(id)}
              onMarkFeedRead={(feedId) => markRead.mutate({ feedId })}
            />
          ))}
        </SortableContext>

        {/* Unfoldered feeds, and the drop target for moving back to root */}
        <RootZone>
          <SortableContext
            items={feedsIn(null).map((s) => `feed:${s.subscriptionId}`)}
            strategy={verticalListSortingStrategy}
          >
            {feedsIn(null).map((sub, index) => (
              <FeedNode
                key={sub.subscriptionId}
                sub={sub}
                index={index}
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
                onMarkRead={() => markRead.mutate({ feedId: sub.feedId })}
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
  index: number;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
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
  editing: { kind: 'folder' | 'feed'; id: string } | null;
  setEditing: (e: { kind: 'folder' | 'feed'; id: string } | null) => void;
  submitEdit: (value: string) => void;
  onDelete: () => void;
  onMarkRead: () => void;
  onRenameFeed: (subscriptionId: string) => void;
  onEditFeed: (sub: SubscriptionRow) => void;
  onUnsubscribe: (subscriptionId: string) => void;
  onMarkFeedRead: (feedId: string) => void;
}

function FolderNode(props: FolderNodeProps) {
  const { folder, index, depth, expanded, editing } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `folder:${folder.id}`,
    data: {
      type: 'folder',
      folderId: folder.id,
      parentId: folder.parentId,
      index,
    } satisfies DragData,
  });

  const isEditing = editing?.kind === 'folder' && editing.id === folder.id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-50')}
    >
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5',
          props.isActive ? 'bg-accent font-medium' : 'hover:bg-accent',
        )}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        <button
          onClick={props.onToggle}
          aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
          title={expanded ? 'Collapse folder' : 'Expand folder'}
          className="shrink-0 rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Drag folder ${folder.name}`}
          title={`Drag to reorder ${folder.name}`}
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

        <RowMenu label={`Folder actions for ${folder.name}`}>
          <DropdownMenuItem onSelect={() => props.setEditing({ kind: 'folder', id: folder.id })}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onMarkRead}>Mark all read</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={props.onDelete}>
            Delete folder
          </DropdownMenuItem>
        </RowMenu>
      </div>

      {expanded && (
        <FolderContents folderId={folder.id}>
          <SortableContext
            items={props.childFolders.map((f) => `folder:${f.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {props.childFolders.map((child, childIndex) => (
              <FolderNode
                {...props}
                key={child.id}
                folder={child}
                index={childIndex}
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
            strategy={verticalListSortingStrategy}
          >
            {props.feeds.map((sub, feedIndex) => (
              <FeedNode
                key={sub.subscriptionId}
                sub={sub}
                index={feedIndex}
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
  index: number;
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
  index,
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
        index,
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
      // The whole row is a pointer drag surface: activation needs 4px of
      // travel (sensor config above), so plain clicks still select/open.
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
        title={`Drag to reorder or move ${label}`}
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
          <button onClick={onSelect} className="min-w-0 flex-1 truncate text-left">
            {label}
          </button>
          {sub.lastError && (
            <span
              className="shrink-0 text-destructive"
              title={`This feed failed to update: ${sub.lastError}`}
              aria-label={`Feed error: ${sub.lastError}`}
            >
              <AlertTriangle className="size-3.5" />
            </span>
          )}
          {unread > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
              {unread}
            </span>
          )}
        </>
      )}

      <RowMenu label={`Feed actions for ${label}`}>
        <DropdownMenuItem onSelect={onEditSettings}>Edit…</DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={onMarkRead}>Mark all read</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={onUnsubscribe}>
          Unsubscribe
        </DropdownMenuItem>
      </RowMenu>
    </div>
  );
}

/** Actions menu. Visible on hover AND on keyboard focus, never hover-only. */
function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className="size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
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
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSubmit(value);
    if (e.key === 'Escape') onCancel();
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onCancel}
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

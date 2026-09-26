import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FeedSort } from '@/lib/feed-order';
import type { SubscriptionRow } from '@/lib/folders';
import { FolderTree } from './folder-tree';

const markRead = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mark-all-read', () => ({ useMarkAllRead: () => markRead }));

const sub: SubscriptionRow = {
  subscriptionId: 's1',
  feedId: 'f1',
  title: 'Dave Rupert',
  customTitle: null,
  feedUrl: 'https://daverupert.com/rss',
  siteUrl: null,
  faviconUrl: null,
  folderId: null,
  position: 0,
  viewMode: null,
  sortOrder: null,
  articleView: null,
  hideFromAll: false,
  inBlogroll: false,
  attention: 'normal',
  websubState: 'inactive',
  websubLeaseExpiresAt: null,
  fetchIntervalSec: null,
  lastFetchedAt: null,
  lastError: null,
  lastSuccessAt: null,
  unreadCount: 3,
};

function renderTree(sort: FeedSort = 'name') {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['folders'], { items: [] });
  qc.setQueryData(['feeds'], { items: [sub] });
  render(
    <QueryClientProvider client={qc}>
      <FolderTree
        onSelectFeed={vi.fn()}
        onSelectFolder={vi.fn()}
        countByFeed={new Map([['f1', 3]])}
        sort={sort}
      />
    </QueryClientProvider>,
  );
}

// #27: the drag handle says what a drop will do in each sort mode.

test('only manual order offers "reorder" on the drag handle', () => {
  renderTree('name');
  expect(screen.getByLabelText('Drag Dave Rupert')).toHaveAttribute(
    'title',
    'Drag to move Dave Rupert to another folder',
  );
});

test('manual order says a drag reorders', () => {
  renderTree('manual');
  expect(screen.getByLabelText('Drag Dave Rupert')).toHaveAttribute(
    'title',
    'Drag to reorder or move Dave Rupert',
  );
});

test('"Mark all read" fires even when the pointer moves a few px during the click', () => {
  renderTree();
  const trigger = screen.getByRole('button', { name: 'Feed actions for Dave Rupert' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = screen.getByRole('menuitem', { name: 'Mark all read' });

  // A real click on a trackpad: down, a small wobble past the 4px drag
  // threshold, up, click. The row's drag sensor must not steal it.
  const at = (x: number) => ({ clientX: x, clientY: 0, button: 0, isPrimary: true, pointerId: 1 });
  fireEvent.pointerDown(item, at(0));
  fireEvent.mouseDown(item, at(0));
  fireEvent.pointerMove(document, at(10));
  fireEvent.mouseMove(document, at(10));
  fireEvent.pointerUp(document, at(10));
  fireEvent.mouseUp(document, at(10));
  fireEvent.click(item);

  // The same Undo-able mark as the top bar (#26), named for the toast.
  expect(markRead).toHaveBeenCalledWith({ feedId: 'f1' }, 'Dave Rupert');
});

test('"Rename" from a feed menu shows a focused input that stays open', async () => {
  renderTree();
  const trigger = screen.getByRole('button', { name: 'Feed actions for Dave Rupert' });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  await act(() => new Promise((r) => setTimeout(r, 20)));
  expect(screen.getByDisplayValue('Dave Rupert')).toHaveFocus();
});

// #43: a click away keeps the new name. Only Escape throws it away.
describe('inline rename', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function startRename() {
    renderTree();
    const trigger = screen.getByRole('button', { name: 'Feed actions for Dave Rupert' });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    return screen.getByDisplayValue('Dave Rupert');
  }
  const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');

  test('a blur saves a changed name', async () => {
    const input = await startRename();
    fireEvent.change(input, { target: { value: 'Dave' } });
    fireEvent.blur(input);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(String(patches()[0]![0])).toBe('/api/feeds/s1');
    expect(JSON.parse(patches()[0]![1].body)).toEqual({ title: 'Dave' });
    expect(screen.queryByDisplayValue('Dave')).toBeNull();
  });

  test('Escape throws the new name away, and the blur after it does not save', async () => {
    const input = await startRename();
    fireEvent.change(input, { target: { value: 'Dave' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(patches()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Dave Rupert' })).toBeInTheDocument();
  });

  test('Enter saves once, even when a blur follows', async () => {
    const input = await startRename();
    fireEvent.change(input, { target: { value: 'Dave' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(patches()).toHaveLength(1));
  });

  test('a blur with the name unchanged saves nothing', async () => {
    fireEvent.blur(await startRename());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(patches()).toHaveLength(0);
    expect(screen.queryByDisplayValue('Dave Rupert')).toBeNull();
  });

  test('a blur with the name cleared saves nothing', async () => {
    const input = await startRename();
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.blur(input);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(patches()).toHaveLength(0);
  });
});

// #25: folder badges.

test('folders show their unread count, collapsed or not, and hide a zero', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const folder = (id: string, name: string, parentId: string | null = null) => ({
    id, userId: 'u1', name, parentId, position: 0, viewMode: null, createdAt: '',
  });
  qc.setQueryData(['folders'], {
    items: [folder('d1', 'Tech'), folder('d2', 'CSS', 'd1'), folder('d3', 'Quiet')],
  });
  qc.setQueryData(['feeds'], { items: [{ ...sub, folderId: 'd2' }] });
  render(
    <QueryClientProvider client={qc}>
      <FolderTree
        onSelectFeed={vi.fn()}
        onSelectFolder={vi.fn()}
        countByFeed={new Map([['f1', 3]])}
        // The server's rollup: the parent includes its child folder.
        countByFolder={new Map([['d1', 3], ['d2', 3], ['d3', 0]])}
        sort="name"
      />
    </QueryClientProvider>,
  );
  // Tech is collapsed (nothing expanded yet) and still shows its count.
  expect(screen.getByRole('button', { name: 'Tech' }).parentElement).toHaveTextContent('Tech3');
  expect(screen.getByLabelText('3 unread')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Quiet' }).parentElement).not.toHaveTextContent(/\d/);
});

// #28: subfolders.

describe('subfolders', () => {
  const folder = (id: string, name: string, parentId: string | null = null) => ({
    id, userId: 'u1', name, parentId, position: 0, viewMode: null, createdAt: '',
  });
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderFolders() {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    qc.setQueryData(['folders'], {
      items: [folder('d1', 'Tech'), folder('d2', 'CSS', 'd1'), folder('d3', 'News')],
    });
    qc.setQueryData(['feeds'], { items: [] });
    render(
      <QueryClientProvider client={qc}>
        <FolderTree onSelectFeed={vi.fn()} onSelectFolder={vi.fn()} countByFeed={new Map()} sort="name" />
      </QueryClientProvider>,
    );
    // The expanded set is a module store that outlives each test: start collapsed.
    for (const b of screen.queryAllByRole('button', { name: 'Collapse folder' })) fireEvent.click(b);
  }
  // Focus first, as a keyboard user would. With nothing focused, jsdom fires a
  // window blur when the menu takes focus, and Radix closes a menu on that.
  const openMenu = (name: string) => {
    const trigger = screen.getByRole('button', { name: `Folder actions for ${name}` });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
  };
  const sent = (method: string) => {
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
    return call && { url: String(call[0]), body: call[1].body && JSON.parse(call[1].body) };
  };
  // The expanded set is a module store, so it carries over between tests.
  const expand = (name: string) => {
    const toggle = within(screen.getByRole('button', { name }).parentElement!).queryByRole(
      'button',
      { name: 'Expand folder' },
    );
    if (toggle) fireEvent.click(toggle);
  };

  test('"Rename" from the menu shows an input that stays open', async () => {
    renderFolders();
    openMenu('News');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByDisplayValue('News')).toHaveFocus();
  });

  test('"New subfolder" asks for a name inside the folder and creates it there', async () => {
    renderFolders();
    openMenu('Tech');
    fireEvent.click(screen.getByRole('menuitem', { name: 'New subfolder' }));

    const input = await screen.findByPlaceholderText('Subfolder name');
    fireEvent.change(input, { target: { value: 'Rust' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(sent('POST')).toBeDefined());
    expect(sent('POST')).toEqual({ url: '/api/folders', body: { name: 'Rust', parentId: 'd1' } });
  });

  test('a subfolder cannot have its own subfolder', () => {
    renderFolders();
    expand('Tech');
    openMenu('CSS');
    expect(screen.getByRole('menuitem', { name: 'New subfolder' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('"Move to" puts a top-level folder inside another', async () => {
    renderFolders();
    openMenu('News');
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Move to' }), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tech' }));
    await waitFor(() => expect(sent('PATCH')).toEqual({ url: '/api/folders/d3', body: { parentId: 'd1' } }));
  });

  test('a folder with subfolders is told why it cannot move', async () => {
    renderFolders();
    openMenu('Tech');
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Move to' }), { key: 'ArrowRight' });
    expect(
      await screen.findByRole('menuitem', { name: 'A folder with subfolders cannot go inside another folder.' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  test("a subfolder's own menu acts on the subfolder, not its parent", async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderFolders();
    expand('Tech');
    openMenu('CSS');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete folder' }));
    await waitFor(() => expect(sent('DELETE')?.url).toBe('/api/folders/d2'));
    expect(confirm).toHaveBeenCalledWith('Delete folder "CSS"? Its feeds move out, not away.');
  });
});

// #29: broken feeds.

describe('a failing feed', () => {
  const broken = { ...sub, lastError: 'getaddrinfo EAI_AGAIN daverupert.com' };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => broken }) as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderBroken(hideRead: boolean) {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    qc.setQueryData(['folders'], { items: [] });
    qc.setQueryData(['feeds'], { items: [broken] });
    render(
      <QueryClientProvider client={qc}>
        <FolderTree
          onSelectFeed={vi.fn()}
          onSelectFolder={vi.fn()}
          countByFeed={new Map([['f1', 0]])}
          sort="name"
          hideRead={hideRead}
        />
      </QueryClientProvider>,
    );
  }

  test('stays visible in unread-only mode, with nothing unread', () => {
    renderBroken(true);
    expect(screen.getByRole('button', { name: 'Dave Rupert' })).toBeInTheDocument();
  });

  test('its warning opens on a click, says why in plain words, and can retry', async () => {
    renderBroken(false);
    const warning = screen.getByRole('button', {
      name: 'Feed problem: Could not look up the site. This is often a short network problem.',
    });
    act(() => warning.focus());
    fireEvent.click(warning);

    expect(await screen.findByText('getaddrinfo EAI_AGAIN daverupert.com')).toBeInTheDocument();
    expect(screen.getByText('Last tried never. Last worked never.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/feeds/s1/refresh', expect.objectContaining({ method: 'POST' })),
    );
  });
});

// #21: phones.

const row = () => screen.getByTitle(sub.feedUrl);
const touch = (y: number) => ({ touches: [{ clientX: 0, clientY: y }] });

test('the row menu button is always shown on touch screens', () => {
  renderTree();
  const trigger = screen.getByRole('button', { name: 'Feed actions for Dave Rupert' });
  // Hidden until hover for a mouse, always visible for a coarse pointer.
  expect(trigger).toHaveClass('opacity-0', 'pointer-coarse:opacity-100');
});

describe('touch drag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('a swipe to scroll never picks a row up', () => {
    renderTree();
    fireEvent.touchStart(row(), touch(100));
    act(() => vi.advanceTimersByTime(50));
    // Touch events stay on the element first touched, as in a browser.
    fireEvent.touchMove(row(), touch(160)); // moved before the hold ended
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchMove(row(), touch(220));
    expect(row()).not.toHaveClass('opacity-50');
    fireEvent.touchEnd(row(), touch(220));
  });

  test('a long press, then a move, still drags', () => {
    renderTree();
    fireEvent.touchStart(row(), touch(100));
    act(() => vi.advanceTimersByTime(300));
    fireEvent.touchMove(row(), touch(140));
    expect(row()).toHaveClass('opacity-50');
    fireEvent.touchEnd(row(), touch(140));
  });
});

// #35: empty sidebar states, and "New folder" from the "+" menu.

function renderWith(props: Partial<React.ComponentProps<typeof FolderTree>>, unread = 0) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(['folders'], { items: [] });
  qc.setQueryData(['feeds'], { items: [sub] });
  render(
    <QueryClientProvider client={qc}>
      <FolderTree
        onSelectFeed={vi.fn()}
        onSelectFolder={vi.fn()}
        countByFeed={new Map([['f1', unread]])}
        sort="name"
        {...props}
      />
    </QueryClientProvider>,
  );
}

test('unread only with nothing unread says "All caught up"', () => {
  renderWith({ hideRead: true });
  expect(screen.getByText(/All caught up/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Dave Rupert' })).toBeNull();
});

test('no "All caught up" while a feed is still shown', () => {
  renderWith({ hideRead: true }, 2);
  expect(screen.queryByText(/All caught up/)).toBeNull();
});

test('the parent can open the "New folder" field, and hears when it closes', () => {
  const onCreatingFolderChange = vi.fn();
  renderWith({ creatingFolder: true, onCreatingFolderChange });
  const input = screen.getByPlaceholderText('Folder name');
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(onCreatingFolderChange).toHaveBeenCalledWith(false);
});

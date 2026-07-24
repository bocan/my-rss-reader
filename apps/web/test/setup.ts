import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not expose a usable Storage in this environment, and Node 26's own
 * experimental `localStorage` global is inert without --localstorage-file.
 * Install a small in-memory Storage so components that persist display
 * preferences behave in tests the way they do in a browser.
 */
class MemoryStorage implements Storage {
  #data = new Map<string, string>();

  get length(): number {
    return this.#data.size;
  }
  clear(): void {
    this.#data.clear();
  }
  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.#data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, String(value));
  }
}

if (!window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}

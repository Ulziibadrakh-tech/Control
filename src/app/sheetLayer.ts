/**
 * Which modal sheet is on top. A modal <dialog> makes the rest of the page
 * inert, so toasts are rendered inside the top sheet while one is open:
 * otherwise an "Undo" button could be visible but impossible to press.
 */
type Listener = () => void;

const stack: HTMLElement[] = [];
const listeners = new Set<Listener>();
const emit = () => {
  for (const l of [...listeners]) l();
};

export const sheetLayer = {
  push(el: HTMLElement): void {
    stack.push(el);
    emit();
  },
  remove(el: HTMLElement): void {
    const i = stack.lastIndexOf(el);
    if (i >= 0) stack.splice(i, 1);
    emit();
  },
  top(): HTMLElement | null {
    return stack[stack.length - 1] ?? null;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

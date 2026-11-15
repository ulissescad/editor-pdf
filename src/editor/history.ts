// Desfazer/refazer por instantâneos. Os objetos são pequenos (JSON), então guardar cópias é simples e seguro.

export class History<T> {
  #past: string[] = [];
  #future: string[] = [];
  #current: string;

  constructor(initial: T, private limit = 100) {
    this.#current = JSON.stringify(initial);
  }

  /** Registra um novo estado. Ignora se nada mudou. Retorna true se registrou. */
  push(state: T): boolean {
    const s = JSON.stringify(state);
    if (s === this.#current) return false;
    this.#past.push(this.#current);
    if (this.#past.length > this.limit) this.#past.shift();
    this.#current = s;
    this.#future = [];
    return true;
  }

  undo(): T | null {
    const prev = this.#past.pop();
    if (prev === undefined) return null;
    this.#future.push(this.#current);
    this.#current = prev;
    return JSON.parse(prev);
  }

  redo(): T | null {
    const next = this.#future.pop();
    if (next === undefined) return null;
    this.#past.push(this.#current);
    this.#current = next;
    return JSON.parse(next);
  }

  reset(state: T) {
    this.#past = [];
    this.#future = [];
    this.#current = JSON.stringify(state);
  }

  get canUndo() { return this.#past.length > 0; }
  get canRedo() { return this.#future.length > 0; }
}

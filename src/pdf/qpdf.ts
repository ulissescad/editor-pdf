// Senhas (PLANO.md, item 2.7): qpdf compilado para WebAssembly, baixado só quando a ferramenta é usada.
// Proteger criptografa com AES-256; desbloquear exige a senha correta (ou nenhuma, quando o PDF só tem
// restrições do “dono”, como bloquear impressão ou cópia).

/** O que usamos do módulo Emscripten do qpdf (as tipagens do pacote são incompletas). */
export interface QpdfModule {
  callMain(args: string[]): number;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
}
type Factory = (opts: Record<string, unknown>) => Promise<QpdfModule>;

let messages: string[] = [];
let instance: Promise<QpdfModule> | null = null;
let loader: () => Promise<QpdfModule> = async () => {
  const [{ default: create }, { default: wasmUrl }] = await Promise.all([
    import('@neslinesli93/qpdf-wasm'),
    import('@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'),
  ]);
  return (create as unknown as Factory)({
    locateFile: () => wasmUrl,
    noInitialRun: true,
    print: (s: string) => messages.push(s),
    printErr: (s: string) => messages.push(s),
  });
};

/** Troca o carregador (testes em Node, que leem o .wasm do disco). */
export function setQpdfLoader(fn: (log: (s: string) => void) => Promise<QpdfModule>) {
  loader = () => fn((s) => messages.push(s));
  instance = null;
}

/** Baixa e inicia o qpdf (uma vez por página aberta). */
export function loadQpdf(): Promise<QpdfModule> {
  if (!instance) {
    instance = loader();
    instance.catch(() => { instance = null; });
  }
  return instance;
}

interface Run { code: number; out?: Uint8Array; log: string }

let seq = 0;

/** Roda o qpdf com o arquivo de entrada em `in.pdf` e devolve `out.pdf` (se `output`). */
async function run(input: Uint8Array, args: (inPath: string, outPath: string) => string[], output = true): Promise<Run> {
  const q = await loadQpdf();
  const id = ++seq;
  const inPath = `/in-${id}.pdf`, outPath = `/out-${id}.pdf`;
  messages = [];
  q.FS.writeFile(inPath, input);
  let code: number;
  try {
    code = q.callMain(args(inPath, outPath));
  } catch (err) {
    // exit() do Emscripten pode chegar como exceção com o código de saída
    code = (err as { status?: number }).status ?? 1;
    instance = null; // recomeça com uma instância nova
  }
  let out: Uint8Array | undefined;
  // Código 3 = terminou com avisos (o arquivo de saída é válido)
  if (output && (code === 0 || code === 3)) {
    try { out = q.FS.readFile(outPath).slice(); } catch { out = undefined; }
  }
  for (const p of [inPath, outPath]) { try { q.FS.unlink(p); } catch { /* não existe */ } }
  return { code, out, log: messages.join('\n') };
}

export type Encryption = 'none' | 'password' | 'restrictions';

/** O PDF tem senha para abrir (“password”), só restrições do dono (“restrictions”) ou nada. */
export async function encryptionOf(bytes: Uint8Array): Promise<Encryption> {
  // --requires-password: 0 = precisa de senha, 3 = criptografado sem senha para abrir, 2 = sem criptografia.
  // Esta versão do qpdf também devolve 2 quando não consegue abrir sem senha; o /Encrypt do trailer
  // (que nunca é criptografado) desfaz a dúvida.
  const { code } = await run(bytes, (i) => ['--requires-password', i], false);
  if (code === 0) return 'password';
  if (code === 3) return 'restrictions';
  if (code === 2) return hasEncryptDict(bytes) ? 'password' : 'none';
  throw new Error('Não foi possível ler o PDF');
}

const ENCRYPT = /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/;

/** O trailer (ou o dicionário do xref, no fim ou no começo do arquivo) aponta para um /Encrypt. */
export function hasEncryptDict(bytes: Uint8Array): boolean {
  const latin = (a: number, b: number) => new TextDecoder('latin1').decode(bytes.subarray(a, b));
  return ENCRYPT.test(latin(Math.max(0, bytes.length - 64_000), bytes.length)) || ENCRYPT.test(latin(0, 64_000));
}

export interface Permissions {
  print: boolean;   // imprimir
  copy: boolean;    // copiar texto e imagens
  modify: boolean;  // alterar, comentar, preencher e organizar páginas
}

export const ALL_ALLOWED: Permissions = { print: true, copy: true, modify: true };

/** Senha aleatória do “dono” (quem abre com a senha comum não pode tirar as restrições). */
function randomOwner(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
}

/** Argumentos do qpdf para criptografar com AES-256 (exportado para os testes). */
export function encryptArgs(user: string, owner: string, p: Permissions): string[] {
  const restrict: string[] = [];
  if (!p.print) restrict.push('--print=none');
  if (!p.copy) restrict.push('--extract=n');
  if (!p.modify) restrict.push('--modify=none', '--annotate=n', '--form=n', '--assemble=n');
  return ['--encrypt', user, owner, '256', ...restrict, '--'];
}

export class WrongPasswordError extends Error {
  constructor() { super('Senha incorreta'); this.name = 'WrongPasswordError'; }
}

/**
 * Protege com senha (AES-256). Sem restrições, a senha do dono é a mesma senha; com restrições, é
 * aleatória, para que a senha de abrir não sirva para tirá-las. Um PDF que já tem senha precisa ser
 * desbloqueado antes (`current` é a senha atual, se houver).
 */
export async function protect(bytes: Uint8Array, password: string, p: Permissions = ALL_ALLOWED, current = ''): Promise<Uint8Array> {
  if (!password) throw new Error('Senha vazia');
  const restricted = !p.print || !p.copy || !p.modify;
  const owner = restricted ? randomOwner() : password;
  const { code, out, log } = await run(bytes, (i, o) => [
    ...(current ? [`--password=${current}`] : []), ...encryptArgs(password, owner, p), i, o,
  ]);
  if (out) return out;
  if (/invalid password/i.test(log) || (code === 2 && hasEncryptDict(bytes))) throw new WrongPasswordError();
  throw new Error(`qpdf falhou (${code}): ${log}`);
}

/** Tira a senha e as restrições. Senha errada → WrongPasswordError. */
export async function unlock(bytes: Uint8Array, password = ''): Promise<Uint8Array> {
  const { code, out, log } = await run(bytes, (i, o) => [`--password=${password}`, '--decrypt', i, o]);
  if (out) return out;
  // Falhou: senha errada (o caso comum) ou arquivo com defeito
  if (/invalid password/i.test(log) || (code === 2 && hasEncryptDict(bytes))) throw new WrongPasswordError();
  throw new Error(`qpdf falhou (${code}): ${log}`);
}

// Passar arquivos de uma ferramenta para outra (ex.: “Juntar” → “Organizar”) sem sair da página.
// Os bytes ficam só na memória desta aba.
import { hrefFor } from '../lib/routes';

export interface ToolFile { name: string; bytes: Uint8Array }
/** Arquivo gerado por uma ferramenta. */
export interface OutFile { name: string; bytes: Uint8Array; mime: string }

let pending: { tool: string; files: ToolFile[] } | null = null;

export function sendToTool(tool: string, files: ToolFile[]) {
  pending = { tool, files };
  location.hash = hrefFor({ name: 'tool', id: tool });
}

/** Arquivos enviados para esta ferramenta (uma vez só). */
export function takeFiles(tool: string): ToolFile[] {
  if (pending?.tool !== tool) return [];
  const files = pending.files;
  pending = null;
  return files;
}

/** Lê arquivos escolhidos: PDFs (pelo nome, tipo ou conteúdo). Devolve os aceitos e os recusados. */
export async function readPdfFiles(list: FileList | File[] | null | undefined) {
  const { readPdf } = await import('../editor/session');
  const ok: ToolFile[] = [];
  const rejected: string[] = [];
  for (const f of [...(list ?? [])]) {
    const bytes = await readPdf(f);
    if (bytes) ok.push({ name: /\.pdf$/i.test(f.name) ? f.name : `${f.name}.pdf`, bytes });
    else rejected.push(f.name);
  }
  return { ok, rejected };
}

/** Mensagem amigável para falhas ao abrir PDFs. */
export function openError(err: unknown, name?: string): string {
  const e = err as { name?: string };
  const which = name ? `“${name}”` : 'Este arquivo';
  if (e?.name === 'EncryptedError' || e?.name === 'PasswordException') {
    return `${which} é protegido por senha. A ferramenta “Desbloquear PDF” chega numa próxima versão.`;
  }
  return `Não foi possível abrir ${name ? which : 'este arquivo'}. Verifique se é um PDF válido.`;
}

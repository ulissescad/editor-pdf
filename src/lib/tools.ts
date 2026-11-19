import type { Component } from 'svelte';
import { tk } from './i18n.svelte';
import Merge from '@lucide/svelte/icons/merge';
import Split from '@lucide/svelte/icons/split';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import Minimize2 from '@lucide/svelte/icons/minimize-2';
import Images from '@lucide/svelte/icons/images';
import FileImage from '@lucide/svelte/icons/file-image';
import Signature from '@lucide/svelte/icons/signature';
import Lock from '@lucide/svelte/icons/lock';
import LockOpen from '@lucide/svelte/icons/lock-open';
import Droplets from '@lucide/svelte/icons/droplets';
import ListOrdered from '@lucide/svelte/icons/list-ordered';
import Crop from '@lucide/svelte/icons/crop';
import Eraser from '@lucide/svelte/icons/eraser';
import Layers from '@lucide/svelte/icons/layers';
import Info from '@lucide/svelte/icons/info';
import ScanLine from '@lucide/svelte/icons/scan-line';
import GitCompare from '@lucide/svelte/icons/git-compare-arrows';

export type Milestone = 'M2' | 'M3' | 'M5' | 'M6';

export interface Tool {
  id: string;            // usado na rota: #/ferramenta/<id>
  name: string;          // em português (chave de tradução): mostre com t(tool.name)
  description: string;
  icon: Component;
  milestone: Milestone;  // marco do PLANO.md em que a ferramenta fica pronta
  ready: boolean;
}

// Ordem: as mais usadas primeiro (pesquisa no PLANO.md, seção 10)
export const TOOLS: Tool[] = [
  { id: 'juntar', name: tk('Juntar PDF'), description: tk('Combine vários PDFs em um só, na ordem que quiser.'), icon: Merge, milestone: 'M3', ready: true },
  { id: 'dividir', name: tk('Dividir PDF'), description: tk('Separe páginas ou intervalos em arquivos diferentes.'), icon: Split, milestone: 'M3', ready: true },
  { id: 'comprimir', name: tk('Comprimir PDF'), description: tk('Diminua o tamanho do arquivo mantendo a qualidade.'), icon: Minimize2, milestone: 'M5', ready: true },
  { id: 'assinar', name: tk('Assinar PDF'), description: tk('Desenhe, digite ou use a foto da sua assinatura.'), icon: Signature, milestone: 'M2', ready: true },
  { id: 'organizar', name: tk('Organizar páginas'), description: tk('Reordene, gire, exclua e insira páginas.'), icon: LayoutGrid, milestone: 'M3', ready: true },
  { id: 'imagens-para-pdf', name: tk('Imagens para PDF'), description: tk('Transforme fotos e imagens em um PDF.'), icon: Images, milestone: 'M3', ready: true },
  { id: 'pdf-para-imagens', name: tk('PDF para imagens'), description: tk('Salve cada página como JPG ou PNG.'), icon: FileImage, milestone: 'M3', ready: true },
  { id: 'digitalizar', name: tk('Digitalizar'), description: tk('Fotografe um documento e endireite as páginas.'), icon: ScanLine, milestone: 'M6', ready: true },
  { id: 'comparar', name: tk('Comparar PDFs'), description: tk('Veja o que mudou no texto entre duas versões.'), icon: GitCompare, milestone: 'M6', ready: true },
  { id: 'proteger', name: tk('Proteger com senha'), description: tk('Criptografe o PDF com uma senha (AES-256).'), icon: Lock, milestone: 'M5', ready: true },
  { id: 'desbloquear', name: tk('Desbloquear PDF'), description: tk('Remova a senha de um PDF que você pode abrir.'), icon: LockOpen, milestone: 'M5', ready: true },
  { id: 'marca-dagua', name: tk('Marca d’água'), description: tk('Aplique texto ou imagem em todas as páginas.'), icon: Droplets, milestone: 'M5', ready: true },
  { id: 'numerar', name: tk('Numerar páginas'), description: tk('Adicione números de página no formato que quiser.'), icon: ListOrdered, milestone: 'M5', ready: true },
  { id: 'recortar', name: tk('Recortar margens'), description: tk('Corte as bordas das páginas.'), icon: Crop, milestone: 'M5', ready: true },
  { id: 'tarjar', name: tk('Tarjar informações'), description: tk('Remova de verdade textos sensíveis.'), icon: Eraser, milestone: 'M5', ready: true },
  { id: 'achatar', name: tk('Achatar PDF'), description: tk('Torne campos e anotações parte fixa da página.'), icon: Layers, milestone: 'M5', ready: true },
  { id: 'propriedades', name: tk('Propriedades'), description: tk('Edite título, autor e assunto do documento.'), icon: Info, milestone: 'M5', ready: true },
];

export const findTool = (id: string): Tool | undefined => TOOLS.find((t) => t.id === id);

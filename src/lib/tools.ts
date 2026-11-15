import type { Component } from 'svelte';
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

export type Milestone = 'M2' | 'M3' | 'M5';

export interface Tool {
  id: string;            // usado na rota: #/ferramenta/<id>
  name: string;
  description: string;
  icon: Component;
  milestone: Milestone;  // marco do PLANO.md em que a ferramenta fica pronta
  ready: boolean;
}

// Ordem: as mais usadas primeiro (pesquisa no PLANO.md, seção 10)
export const TOOLS: Tool[] = [
  { id: 'juntar', name: 'Juntar PDF', description: 'Combine vários PDFs em um só, na ordem que quiser.', icon: Merge, milestone: 'M3', ready: true },
  { id: 'dividir', name: 'Dividir PDF', description: 'Separe páginas ou intervalos em arquivos diferentes.', icon: Split, milestone: 'M3', ready: true },
  { id: 'comprimir', name: 'Comprimir PDF', description: 'Diminua o tamanho do arquivo mantendo a qualidade.', icon: Minimize2, milestone: 'M5', ready: false },
  { id: 'assinar', name: 'Assinar PDF', description: 'Desenhe, digite ou use a foto da sua assinatura.', icon: Signature, milestone: 'M2', ready: true },
  { id: 'organizar', name: 'Organizar páginas', description: 'Reordene, gire, exclua e insira páginas.', icon: LayoutGrid, milestone: 'M3', ready: true },
  { id: 'imagens-para-pdf', name: 'Imagens para PDF', description: 'Transforme fotos e imagens em um PDF.', icon: Images, milestone: 'M3', ready: true },
  { id: 'pdf-para-imagens', name: 'PDF para imagens', description: 'Salve cada página como JPG ou PNG.', icon: FileImage, milestone: 'M3', ready: true },
  { id: 'proteger', name: 'Proteger com senha', description: 'Criptografe o PDF com uma senha (AES-256).', icon: Lock, milestone: 'M5', ready: false },
  { id: 'desbloquear', name: 'Desbloquear PDF', description: 'Remova a senha de um PDF que você pode abrir.', icon: LockOpen, milestone: 'M5', ready: false },
  { id: 'marca-dagua', name: 'Marca d’água', description: 'Aplique texto ou imagem em todas as páginas.', icon: Droplets, milestone: 'M5', ready: false },
  { id: 'numerar', name: 'Numerar páginas', description: 'Adicione números de página no formato que quiser.', icon: ListOrdered, milestone: 'M5', ready: false },
  { id: 'recortar', name: 'Recortar margens', description: 'Corte as bordas das páginas.', icon: Crop, milestone: 'M5', ready: false },
  { id: 'tarjar', name: 'Tarjar informações', description: 'Remova de verdade textos sensíveis.', icon: Eraser, milestone: 'M5', ready: false },
  { id: 'achatar', name: 'Achatar PDF', description: 'Torne campos e anotações parte fixa da página.', icon: Layers, milestone: 'M5', ready: false },
  { id: 'propriedades', name: 'Propriedades', description: 'Edite título, autor e assunto do documento.', icon: Info, milestone: 'M5', ready: false },
];

export const findTool = (id: string): Tool | undefined => TOOLS.find((t) => t.id === id);

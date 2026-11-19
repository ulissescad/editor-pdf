# Editor de PDF online — plano (GitHub Pages, mobile, 100% no navegador)

_15/11/2026 · substitui o plano anterior (a pesquisa de funcionalidades está resumida na seção 10)_

## Andamento

| Marco | Situação |
|---|---|
| **M0 · Fundação** | ✅ Concluído em 15/11/2026. Vite 8 + Svelte 5 + TS; pdf.js 6.4 e @cantoo/pdf-lib 2.11 servidos pelo próprio site; CSP; PWA offline; deploy por GitHub Actions; 11 testes unitários e 30 de ponta a ponta (computador, Android e iPhone emulados), incluindo “zero requisições externas” e offline. Os testes de viabilidade passaram: **@cantoo/pdf-lib** grava texto, preserva formulários e anexa/recupera o projeto (base do item 1.6); **qpdf-wasm** protege com AES-256 e desbloqueia com a senha (base do 2.7). Achado: o pdf.js 6 mudou `getFieldObjects()`/`getAttachments()` para `Map` (já corrigido no editor v1). |
| M1 · Editor no celular | 🔧 Em andamento. Editor refeito em Svelte dentro do site (`#/editor`), com modelo de objetos, desfazer/refazer, pinça, miniaturas, busca, rascunho automático (IndexedDB), PDF reeditável (camada marcada + anexo `editor-projeto.json`), compartilhar e imprimir. Fontes Arimo/Tinos/Cousine servidas pelo site garantem as mesmas quebras de linha em qualquer aparelho. Falta: teste em celular real. |
| M2 · Preencher e assinar | 🔧 Em andamento. Feito em 15/11/2026: assinatura por desenho (traço suavizado, mais fino quando rápido), digitada (Dancing Script, Great Vibes, Caveat) e por foto (limiar automático de Otsu + ajuste de sensibilidade, recorte no traço), guardada no aparelho (IndexedDB, até 8); imagens (orientação da foto respeitada, reduzidas a 2400 px, JPEG ou PNG conforme a transparência); símbolos vetoriais ✓ ✗ ● ○ (mesmo desenho na tela e no PDF) e data de hoje; **detecção de campos** por regras (células vazias, rótulo “:” com espaço à direita ou embaixo, caixinhas, sublinhados, linha de assinatura), que acha 14 de 14 campos no PEI sintético, com bordas traçadas ou no estilo do Word; ferramenta **Campos** (texto ou caixa de seleção, nome, tamanho, várias linhas) que vira **AcroForm de verdade** no PDF baixado, já preenchido; ferramenta “Assinar PDF” na página inicial; **fontes extras** nas caixas de texto (Open Sans com itálico, Caveat manuscrita, Dancing Script cursiva), embutidas no PDF com o @cantoo/fontkit, só com os caracteres usados (o PDF usa o WOFF da fonte, porque o fontkit não recorta WOFF2; a tela usa o WOFF2, com as mesmas medidas), e funcionando offline. Testes: 31 unitários e 88 de ponta a ponta (computador, Android e iPhone emulados). Falta: validar a detecção com o PEI real e assinar no celular real. Caracteres fora das fontes (ex.: ✓ dentro de um texto) continuam trocados por “?”; para marcar, use os Símbolos. |
| M3 · Páginas | 🔧 Em andamento. Feito em 15/11/2026: ferramentas **Juntar** (ordem por arrastar ou botões), **Dividir** (intervalos como “1-3, 5, 8-”, uma página por arquivo ou escolher páginas; vários arquivos saem num ZIP), **Organizar páginas** (reordenar arrastando pela alça, girar, excluir, duplicar, página em branco, adicionar outro PDF), **Imagens → PDF** (JPG/PNG/WebP e câmera do celular; A4, Carta ou tamanho da imagem; orientação e margem) e **PDF → imagens** (JPG ou PNG, 96/150/300 ppp, todas ou algumas páginas). Todas montam o PDF por um “plano de páginas” comum (`src/pdf/plan.ts` e `pages.ts`), que **mantém os formulários funcionando** (o `copyPages` do pdf-lib perde o /AcroForm; campos repetidos entre arquivos viram “nome_2”), não arrasta as outras páginas do arquivo pelos widgets (extrair uma página não fica do tamanho do original) e **leva junto os objetos do editor** (o PDF montado continua reeditável). PDFs com senha só do dono abrem; com senha de abertura, aviso. No editor, **“Organizar páginas”** faz o mesmo no documento aberto, com “Desfazer”. O editor passou a tratar **páginas giradas** (/Rotate): caixas, assinaturas e campos aparecem e são criados em pé, e giram junto quando a página é girada depois. Reordenar foi feito sem SortableJS (alça com toque, mouse em qualquer ponto). Testes: 52 unitários e 135 de ponta a ponta (3 perfis). Falta: teste em celular real (arrastar com o dedo só foi testado em emulação de mouse). |
| M4 · Anotar | 🔧 Em andamento. Feito em 15/11/2026: **Destacar, Sublinhar e Riscar** pela geometria do texto do pdf.js (`src/editor/textsel.ts`): arrastar sobre as linhas marca do caractere tocado até o caractere final, um toque marca a palavra, e fora do texto (PDF digitalizado) desenha um retângulo; a largura de cada caractere vem do canvas, então a marca começa e termina no caractere certo, e funciona com texto girado. Viram **anotações de verdade** (Highlight/Underline/StrikeOut com /QuadPoints e o texto marcado em /Contents) com aparência própria (/AP; destaque em multiplicação a 50%). **Caneta** à mão livre (traço suavizado, traços seguidos viram um objeto só, opção marca-texto translúcida), **Formas** (retângulo, elipse, linha, seta) e **Corretivo** (retângulo branco, com aviso de que não apaga o texto: isso é a “Tarja” do M5) são desenho vetorial na camada do editor, com os mesmos caminhos na tela (SVG) e no PDF (`src/editor/draw.ts`). **Notas** viram anotação Text com o comentário e o ícone desenhado igual em todo leitor. Nas ferramentas de desenho, no celular, **um dedo desenha e dois dedos rolam e dão zoom**; um segundo dedo no meio do traço cancela o traço. Na tela, destaques e marca-texto ficam numa camada com `mix-blend-mode: multiply`, como no PDF. Tudo volta editável ao reabrir (as anotações levam a marca do editor e são removidas e recriadas; anotações de outros programas ficam). Conferido renderizando o PDF gerado no pdf.js. Testes: 68 unitários e 138 de ponta a ponta passando (3 perfis; inclui toque real por CDP no Android emulado). Falta: conferir no Acrobat, no leitor do Chrome (pdfium) e no leitor do celular, e testar o desenho com o dedo num celular real. |
| M5 · Otimizar e proteger | 🔧 Em andamento. Feito em 15/11/2026: as 9 ferramentas, numa moldura comum (`src/tools/OneFileTool.svelte`: escolher → opções → resultado, com atalho “Desbloquear este PDF” quando o arquivo tem senha). **Comprimir** leve (`src/pdf/compress.ts`): fotos JPEG e imagens sem perdas em RGB/cinza (inclusive com preditor PNG) reduzidas para 150 ppp em relação à maior página e recodificadas em JPEG pelo canvas, só quando ficam ao menos 10% menores; fluxos sem compressão viram Flate; objetos sem uso saem; object streams. Forte: páginas viram JPEG de 110 ppp, com aviso. Nunca entrega arquivo maior (devolve o original). Um PDF de 2 fotos de celular caiu mais de 40% com o texto intacto (teste e2e). **Proteger/Desbloquear** (`src/pdf/qpdf.ts`): qpdf em WebAssembly baixado só quando usado (1,3 MB, entra no cache offline); AES-256, restrições de imprimir/copiar/alterar (com restrições, a senha do dono é aleatória); desbloquear exige a senha certa, e PDFs só com restrições do dono são liberados direto. Achado: esta versão do qpdf devolve o código 2 (e não 0) em `--requires-password` para PDFs com senha, e escreve os erros direto no console; a detecção usa o `/Encrypt` do trailer. **Marca d’água** e **Números** (`src/pdf/stamp.ts`) desenham no quadro “em pé” da página vista, certos em páginas giradas; marca de texto (diagonal ou horizontal, centro ou mosaico, por cima ou por baixo do conteúdo, opacidade) ou imagem; números em 6 posições, 5 formatos, capa sem número e número inicial; prévia real (a página com o resultado, desenhada pelo pdf.js). **Recortar** (`src/pdf/crop.ts`): /CropBox a partir de margens em mm na página vista ou automático (limites do conteúdo nos pixels, ignorando sujeira), com prévia da área. **Tarja** (`src/pdf/redact.ts` + `raster.ts`): arrastar sobre a página (um dedo desenha; a página inteira cabe na tela) e busca no texto sem acentos/maiúsculas ou por padrões (CPF, CNPJ, e-mail, telefone), inclusive em trechos partidos e páginas giradas; cada página com tarja vira imagem de 200 ppp e o conteúdo original dela não vai para o arquivo; opção de apagar as propriedades. Conferido extraindo o texto: nada do que foi tarjado sobra. **Achatar** (`src/pdf/flatten.ts`): cada anotação visível é desenhada com a própria aparência (/AP, estado /AS, /Matrix) e sai; campos sem aparência ganham uma; links ficam; o projeto do editor sai (reabre como PDF comum). **Propriedades** (`src/pdf/meta.ts`): editar ou remover tudo; o XMP antigo sai para os leitores não mostrarem os valores velhos. O editor também oferece “Desbloquear” ao abrir PDF com senha. Testes: 92 unitários e 177 de ponta a ponta passando (3 perfis; os 54 novos do M5 incluem senha errada, PDF com senha levado ao “Desbloquear”, tarja verificada extraindo o texto e zero requisições externas com o qpdf). Falta: conferir no Acrobat e num celular real (desenhar a tarja com o dedo, compressão de fotos grandes no iPhone). |
| M6 · Opcionais | 🔧 Em andamento. Feito em 18/11/2026: **Digitalizar** (`src/tools/ScanTool.svelte`, `CornerEditor.svelte`, `src/pdf/perspective.ts`): foto ou câmera → 4 cantos marcados à mão (arrastar, com lupa, ou setas do teclado; cantos cruzados são recusados) → homografia com interpolação bilinear; a proporção real da folha é recuperada da perspectiva (Zhang & He) e encaixa em A4/Carta quando é quase igual; filtros Documento (tira sombras pelo brilho local do papel, mantendo as cores), Original, Cinza e Preto e branco, com prévia; várias páginas, reordenar, girar, reajustar. **Comparar PDFs** (`src/tools/CompareTool.svelte`, `src/pdf/textdiff.ts`, `compare.ts`): diff de palavras próprio em vez do jsdiff (âncoras de palavras únicas + Myers com limite, 200 mil palavras em menos de 3 s no teste), números e palavras hifenizadas no fim da linha contam inteiros, opção de ignorar maiúsculas e acentos; lista das diferenças, páginas lado a lado (uma por vez no celular) com as marcas, e PDFs marcados para baixar. Compara só o texto; PDF sem texto recebe aviso. **Receber arquivos** (`public/share-target.js`, `src/lib/incoming.ts`): *share target* (o service worker guarda o arquivo num cache local, apagado assim que a página o pega) e *file handlers* com `launchQueue`; um PDF abre no editor, vários vão para Juntar, imagens para Imagens para PDF. Testes: 133 unitários e 214 de ponta a ponta passando (3 perfis; 20 ignorados por não se aplicarem ao perfil). O compartilhamento foi testado simulando o POST do sistema e o “Abrir com” simulando o `launchQueue`. Falta: instalar o site e testar num Android real (“Compartilhar”), no Chrome/Edge do computador (“Abrir com”) e digitalizar fotos reais de câmera, inclusive no iPhone. |

## 0. Resumo

- **O que é:** um site estático no GitHub Pages que reúne as funções de PDF mais usadas: preencher, assinar, anotar, organizar páginas, juntar, dividir, comprimir, converter imagens, proteger e outras. Tudo é processado **no aparelho de quem usa**.
- **Regras do projeto:**
  - nenhum servidor e nenhuma IA;
  - **nenhuma requisição a terceiros**: as bibliotecas e fontes ficam no próprio site, e uma política de segurança (CSP) bloqueia o resto;
  - funciona **offline** depois da primeira visita (PWA instalável).
- **Pensado primeiro para o celular**, com barra inferior, painéis que sobem de baixo e gestos de toque, e expandido para o computador.
- **Tecnologia:** Vite + TypeScript + Svelte 5. Bibliotecas: pdf.js para exibir o PDF, pdf-lib (fork mantido) para alterá-lo e qpdf em WebAssembly para senhas. Testes com Vitest e Playwright, e deploy por GitHub Actions.
- **Entrega em 7 marcos (M0–M6).** Cada marco é publicado no ar ao terminar. Estimativa total: **25 a 30 dias de trabalho focado**.

## 1. Princípios e requisitos

| # | Requisito | Como garantir |
|---|---|---|
| R1 | **Sem servidor:** todo o processamento acontece no navegador | Hospedagem estática no GitHub Pages; operações pesadas em Web Workers |
| R2 | **Sem IA nem “adjacentes”** | Nada de OCR por rede neural, resumo, tradução ou detecção por modelo. A detecção de campos usa só regras geométricas (seção 2, item 1.8) |
| R3 | **Resolve tudo internamente:** zero requisições externas | Bibliotecas, fontes, cMaps e WASM dentro do site. CSP por `<meta>` com `default-src 'self'`. Um teste automatizado falha se o site fizer qualquer requisição para fora (seção 6) |
| R4 | **Privacidade:** o arquivo nunca sai do aparelho | Consequência de R1 e R3. Sem analytics e sem cookies. Rascunhos guardados só no IndexedDB local |
| R5 | **Responsivo, pensado primeiro para o celular** | Funciona de 360 px a 1920 px. Alvos de toque de pelo menos 44 px. Gestos de pinça e arraste. Teclado virtual não cobre o campo em edição |
| R6 | **Offline e instalável** | Service worker (Workbox) guarda o site no aparelho; manifest com ícones |
| R7 | **Fiel ao que se vê** | O PDF gerado é igual à tela em qualquer aparelho. Para isso, as fontes são do próprio site e têm medidas idênticas às fontes do PDF (seção 8, risco 3) |
| R8 | **Português (pt-BR) e acessível** | Textos em pt-BR, navegação por teclado, rótulos ARIA e contraste AA. Tema claro e escuro |

## 2. Escopo de funções

Todas as funções abaixo rodam inteiramente no navegador. **Lib** indica a biblioteca principal. O marco indica quando entra.

### Editor (abrir um PDF e trabalhar nele)

| Função | Como, no navegador | Lib | Marco |
|---|---|---|---|
| 1.1 Ver PDF: zoom, pinça, rolagem, miniaturas, ir para página, buscar (Ctrl+F) | Visualizador do pdf.js com gestos próprios para toque | pdf.js | M1 |
| 1.2 Preencher formulários (texto, caixa de seleção, rádio, lista, XFA) | Camada de formulário do pdf.js + `saveDocument()` | pdf.js | M1 *(já existe)* |
| 1.3 Caixas de texto (mover, redimensionar, fonte, tamanho, N/I, cor, alinhamento) | Objetos próprios gravados com pdf-lib *(já existe; migrar)* | pdf-lib | M1 |
| 1.4 Desfazer/refazer · copiar, colar e duplicar | Pilha de comandos sobre o modelo de objetos | — | M1 |
| 1.5 Rascunho automático e “continuar de onde parou” | IndexedDB, com o hash do arquivo como chave | idb-keyval | M1 |
| 1.6 PDF reeditável (reabrir o PDF baixado com os objetos ainda editáveis) | Projeto em JSON embutido como **anexo** no PDF | pdf-lib | M1 |
| 1.7 Assinatura: desenhar, digitar (fonte cursiva) ou foto (fundo removido por limiar de cor); guardar no aparelho | Canvas → PNG; objeto de imagem | signature_pad | M2 |
| 1.8 Detectar campos em PDFs sem formulário (o caso do PEI) | Regras: rótulos terminados em “:” (texto do pdf.js) + retângulos vazios das tabelas (operações de desenho do pdf.js) → sugere caixas | pdf.js | M2 |
| 1.9 Criar PDF preenchível (campos AcroForm de verdade) | `form.createTextField` etc. sobre os campos sugeridos ou desenhados | pdf-lib | M2 |
| 1.10 Imagens, símbolos (✓ ✗ ●) e data de hoje | Objetos de imagem e de texto | pdf-lib | M2 |
| 1.11 Destacar, sublinhar e riscar texto | Seleção pela geometria do texto (funciona com toque) → anotações Highlight/Underline/StrikeOut | pdf.js + pdf-lib | M4 |
| 1.12 Caneta (desenho livre), formas, setas, corretivo branco | Traços suavizados → caminho vetorial | perfect-freehand | M4 |
| 1.13 Comentários (notas adesivas) | Anotação Text do PDF | pdf-lib | M4 |
| 1.14 Imprimir · compartilhar (WhatsApp, e-mail) | `print()` do PDF final · Web Share API com arquivo, com download como alternativa | — | M1 |

### Ferramentas (fluxo rápido: escolher arquivo(s) → opções → baixar ou compartilhar, com “abrir no editor” ao final)

| Função | Como, no navegador | Lib | Marco |
|---|---|---|---|
| 2.1 **Juntar** PDFs (com reordenação) | `copyPages` | pdf-lib | M3 |
| 2.2 **Dividir / extrair** páginas (intervalos, uma página por arquivo) | `copyPages` + ZIP | pdf-lib, fflate | M3 |
| 2.3 **Organizar** páginas: reordenar arrastando, girar, excluir, duplicar, inserir página em branco | Grade de miniaturas com arraste por toque | pdf-lib, SortableJS | M3 |
| 2.4 **Imagens → PDF** (JPG/PNG/WebP; câmera do celular; margem e orientação) | `embedJpg`/`embedPng`; WebP convertido via canvas | pdf-lib | M3 |
| 2.5 **PDF → Imagens** (JPG/PNG, escolha de DPI, ZIP) | Página renderizada em canvas → `toBlob` | pdf.js, fflate | M3 |
| 2.6 **Comprimir** (leve/forte, mostrando o tamanho antes e depois) | Leve: recomprime as imagens JPEG internas, reduzindo resolução e qualidade, mais object streams. Forte: transforma as páginas em imagens, e o texto deixa de ser selecionável (avisando antes). Nunca entrega um arquivo maior que o original | pdf-lib, pdf.js | M5 |
| 2.7 **Proteger com senha / desbloquear** (desbloquear exige a senha correta) | qpdf compilado para WebAssembly, carregado só quando a ferramenta é usada | qpdf-wasm | M5 |
| 2.8 Marca d’água (texto ou imagem, com opacidade) | `drawText`/`drawImage` com `opacity` | pdf-lib | M5 |
| 2.9 Números de página (posição, formato “1 de N”) | `drawText` | pdf-lib | M5 |
| 2.10 Recortar margens | `setCropBox` | pdf-lib | M5 |
| 2.11 **Tarja** (remoção real de informação sensível) | A página vira imagem com a tarja pintada; o texto por baixo é removido de verdade | pdf.js, pdf-lib | M5 |
| 2.12 Achatar (campos e anotações viram conteúdo fixo) | `form.flatten()` + desenho das anotações na página | pdf-lib | M5 |
| 2.13 Editar propriedades (título, autor, assunto) | `setTitle` etc. | pdf-lib | M5 |
| 2.14 Digitalizar com a câmera (recorte manual dos 4 cantos, correção de perspectiva, filtro “documento”) | Matemática de homografia em canvas, sem detecção automática por IA | — | M6 *(opcional)* |
| 2.15 Comparar dois PDFs (diferenças de texto) | Texto do pdf.js + algoritmo de diff próprio (`src/pdf/textdiff.ts`) | pdf.js | M6 *(opcional)* |

### Fora do escopo (e por quê)

| Função | Motivo |
|---|---|
| PDF ↔ Word, Excel, PowerPoint; Office → PDF | Sem servidor, só com um LibreOffice compilado para o navegador (dezenas de MB) e com fidelidade baixa. Viola o espírito de R1. |
| OCR (tornar pesquisável um PDF digitalizado) | Roda no navegador (tesseract.js), mas é um modelo de rede neural: cai em “IA ou adjacentes” (R2). *Reavaliar se você quiser.* |
| Resumir, traduzir, “conversar com o PDF” | IA (R2). |
| Assinatura digital com certificado (ICP-Brasil / gov.br) | Exige certificado e validação de cadeia; risco jurídico. O site deve indicar o assinador do gov.br para validade plena. |
| Pedir assinatura a outras pessoas, links de compartilhamento, nuvem | Precisam de servidor. |
| Editar o texto original do PDF (trocar palavras já impressas) | Fidelidade muito baixa no navegador. O caminho é o “corretivo” mais uma caixa de texto. |

## 3. Arquitetura

### Pilha

| Camada | Escolha | Motivo |
|---|---|---|
| Build | **Vite** + TypeScript | Divide o código para que cada ferramenta carregue só quando usada; copia os assets do pdf.js; gera o service worker (`vite-plugin-pwa`) |
| Interface | **Svelte 5** | Pacote pequeno, sem runtime pesado, e muitas telas e estados para organizar. *(Alternativa: TypeScript puro; ver decisões na seção 9)* |
| Exibir PDF | `pdfjs-dist` (servido pelo próprio site) | Já em uso; formulários, texto, miniaturas, busca |
| Alterar PDF | `@cantoo/pdf-lib` + `@pdf-lib/fontkit` | Fork mantido do pdf-lib (o original está parado desde 2021). Fontkit para embutir as fontes do site |
| Senhas | `qpdf` em WASM (`@neslinesli93/qpdf-wasm` ou `pdfstudio`; escolher no M0) | Criptografar e descriptografar com AES-256 sem servidor |
| Apoio | `fflate` (ZIP), `idb-keyval` (IndexedDB), `signature_pad`, `perfect-freehand`, `SortableJS`, `comlink` (Workers) | Todas MIT/Apache, pequenas e servidas pelo próprio site. *No M3, o reordenar foi feito sem SortableJS (`src/tools/sortable.ts`).* |
| Fontes (OFL, servidas pelo site) | **Liberation Sans/Serif/Mono** (mesmas medidas de Arial/Times/Courier), uma fonte cursiva para a assinatura digitada e uma sem serifa moderna | Fidelidade entre tela e PDF em qualquer aparelho (R7) |

### Estrutura do repositório

```
/
├─ index.html                 # casca do app + CSP + manifest
├─ src/
│  ├─ main.ts, App.svelte     # roteador por hash (#/editor, #/juntar…), tema, atualização do PWA
│  ├─ viewer/                 # pdf.js: visualizador, gestos (pinça/arraste), miniaturas, busca
│  ├─ objects/                # modelo e renderização dos objetos: texto, imagem, assinatura, desenho, forma, destaque, nota
│  ├─ editor/                 # seleção, alças, desfazer/refazer, barra de ferramentas, painel de propriedades
│  ├─ pdf/                    # gravação: objetos→PDF, fontes, anexo do projeto, formulários
│  ├─ tools/<ferramenta>/     # uma pasta por ferramenta (juntar, dividir, comprimir…), carregada sob demanda
│  ├─ workers/pdf.worker.ts   # operações pesadas (comlink): comprimir, juntar, rasterizar, qpdf
│  ├─ storage/                # rascunhos, assinaturas salvas, preferências
│  └─ ui/                     # componentes: painel inferior, diálogo, seletor de arquivo, aviso
├─ public/                    # ícones, fontes, manifest; cmaps e standard_fonts do pdf.js copiados no build
├─ tests/ unit/ e2e/ fixtures/ (PDFs de teste gerados por script; nenhum documento real)
└─ .github/workflows/deploy.yml
```

### Modelo de dados (base de tudo)

```ts
type Obj = {
  id: string; page: number;                 // página (0-based) do documento atual
  kind: 'text'|'image'|'signature'|'ink'|'shape'|'highlight'|'note';
  rect: { x: number; y: number; w: number; h: number }; // em pt do PDF; x,y = canto superior esquerdo
  rotation?: 0|90|180|270;
  style: { font?, size?, bold?, italic?, color?, align?, stroke?, fill?, opacity? };
  data: { text?, imageId?, path?, quads? };  // imagens ficam num store separado (blob)
};
type Project = { version: 1; fileHash: string; objects: Obj[]; formValues: Record<string, unknown> };
```
- Todas as ferramentas que mexem em páginas (organizar, juntar, girar) **remapeiam os objetos** pela tabela de páginas.
- O `Project` é o que vai para o rascunho no IndexedDB e para o anexo `editor-projeto.json` dentro do PDF (item 1.6).

### Fluxo de gravação do PDF
1. pdf.js `saveDocument()` grava os valores dos formulários.
2. O resultado vai para o Worker, onde o pdf-lib desenha os objetos com recorte na caixa e as quebras de linha medidas na tela, embute as fontes e anexa o projeto.
3. O arquivo final é entregue como download, pelo compartilhamento do sistema ou para impressão.

## 4. Experiência de uso (pensada primeiro para o celular)

### Telas
1. **Início:** um cartão grande “Abrir PDF para editar”, que também aceita arrastar e soltar, e a grade de ferramentas (Juntar, Dividir, Organizar, Comprimir, Imagens→PDF, PDF→Imagens, Assinar, Proteger, Desbloquear, Marca d’água, Números, Recortar, Tarja, Achatar, Propriedades). Abaixo, “Continuar de onde parou” com os rascunhos salvos.
2. **Editor:** o visualizador com as ferramentas de edição.
3. **Ferramenta:** um passo a passo de 3 etapas: arquivos → opções → resultado (baixar, compartilhar ou abrir no editor).

### Layout do editor

```
CELULAR (≤ 768 px)                       COMPUTADOR (> 768 px)
┌──────────────────────────┐            ┌────────────────────────────────────────────────┐
│ ←  PEI.pdf     ↶ ↷  ⤓  ⋮ │            │ ← PEI.pdf   ↶ ↷  − 100% +  Buscar   Compartilhar ⤓ │
├──────────────────────────┤            ├──────┬──────────────────────────────┬──────────┤
│                          │            │ mini │                              │ Proprie- │
│        página            │            │ atu- │          página              │ dades do │
│   (pinça = zoom,         │            │ ras  │                              │ objeto   │
│    1 dedo = rolar,       │            │      │                              │          │
│    no modo caneta:       │            │      │                              │          │
│    1 dedo desenha,       │            │      │                              │          │
│    2 dedos rolam)        │            ├──────┴──────────────────────────────┴──────────┤
├──────────────────────────┤            │ Texto  Assinar  Símbolos  Imagem  Caneta  Destacar  Formas  Páginas │
│ ⌨ Texto ✍ Assinar ✓ ✎ … │ ← barra    └────────────────────────────────────────────────┘
└──────────────────────────┘   inferior
 Propriedades do objeto selecionado = painel que sobe de baixo (fonte, tamanho, cor, excluir)
```

### Detalhes de toque e celular
- Alças de pelo menos 44 px em telas de toque. Toque longo num objeto abre o menu (duplicar, excluir, trazer para frente).
- **Teclado virtual:** a API `visualViewport` rola a tela para manter visível a caixa em edição.
- **Assinatura:** quadro de desenho em tela cheia na horizontal, com botões “Limpar” e “Usar”.
- **Receber PDF de outros apps:**
  - no Android, com o PWA instalado, o site aparece em “Compartilhar” (*share target*): o service worker recebe o arquivo e abre no editor;
  - no computador, o site pode ser registrado para abrir arquivos .pdf (*file handlers*, Chrome e Edge).
- **Enviar:** um botão “Compartilhar” abre o compartilhamento nativo (WhatsApp, e-mail, Drive), com download como alternativa (iOS antigo, Firefox).
- **Arquivos grandes:** aviso acima de cerca de 50 MB no celular. As operações pesadas mostram progresso e podem ser canceladas.

## 5. Hospedagem e deploy (GitHub Pages)

| Item | Decisão |
|---|---|
| Repositório | Público no plano gratuito, ou privado no Pro/Team. **O site fica público nos dois casos.** Nenhum dado de usuário passa pelo GitHub |
| Publicação | GitHub Actions: `npm ci` → `npm test` → testes e2e → `vite build` → `actions/upload-pages-artifact` → `actions/deploy-pages`. Em Settings → Pages: Source = GitHub Actions |
| Caminho | `https://<usuário>.github.io/<repo>/`: `base: '/<repo>/'` no Vite, e escopo e `start_url` do PWA relativos. Domínio próprio é opcional (arquivo `CNAME`) |
| Rotas | Por hash (`#/juntar`), o que evita erro 404 no Pages ao recarregar uma rota |
| Segurança | O Pages não permite configurar cabeçalhos, então a CSP vai numa `<meta>`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'`. pdf.js configurado com `isEvalSupported: false` |
| Cache e atualização | Arquivos com hash no nome; o service worker avisa “Nova versão disponível — atualizar” |
| Limites do Pages | Site de até 1 GB e cerca de 100 GB/mês de banda (limite flexível). O site deve ficar em **menos de 15 MB** no total, com qpdf e fontes carregados sob demanda |

## 6. Qualidade e testes

- **Unitários (Vitest):** conversões de coordenadas, remapeamento de páginas, pilha de desfazer, serialização do projeto e geração de intervalos (“1-3, 5”).
- **E2E (Playwright, no CI), em 3 perfis:** computador 1280 px, Pixel 7 e iPhone 14, emulados. Para cada função, o roteiro é:
  1. executar a ação pela interface;
  2. baixar o resultado;
  3. **reabrir o PDF gerado** e conferir páginas, textos (pdf.js), campos (pdf-lib) e anexos.
- **Teste “zero requisições externas”:** o Playwright registra todas as requisições durante os roteiros, e qualquer host diferente do próprio site reprova o build (R3).
- **Testes de offline:** depois da primeira visita, desligar a rede e abrir o editor, juntar e baixar.
- **Arquivos de teste:** gerados por script (formulário AcroForm, PDF sem campos parecido com o PEI, páginas giradas, PDF com senha, imagens grandes). **Nenhum documento real vai para o repositório público.**
- **Orçamentos:** JavaScript inicial de até 250 KB compactado, sem contar o pdf.js. Abrir um PDF de 50 páginas no celular de teste em menos de 2 s até a primeira página. Lighthouse para celular: Performance ≥ 85, Acessibilidade ≥ 95, PWA instalável.
- **Antes de cada marco:** teste manual num **Android real e num iPhone real**, onde o comportamento de toque, teclado e download difere do emulador.

## 7. Marcos

| Marco | Entrega (publicada no ar) | Pronto quando | Esforço |
|---|---|---|---|
| **M0 · Fundação** | Repositório, Vite+Svelte+TS, bibliotecas servidas pelo site, CSP, PWA básico, deploy pelo Actions, tela inicial com grade (ferramentas “em breve”), testes de fumaça e de zero requisições externas. Testes de viabilidade: `@cantoo/pdf-lib` substitui o pdf-lib sem regressão; pacote qpdf-wasm criptografa e descriptografa AES-256 | O site abre em `github.io/<repo>`, funciona offline e não faz nenhuma requisição externa | 2–3 dias |
| **M1 · Editor no celular** | Migração do editor atual (formulários e caixas de texto) para o novo modelo; layout responsivo; pinça e gestos; miniaturas; busca; desfazer/refazer; rascunho automático; PDF reeditável; compartilhar e imprimir | O fluxo do PEI (preencher, fechar, reabrir, baixar, reabrir o baixado e editar) passa nos 3 perfis e num celular real | 5–6 dias |
| **M2 · Preencher e assinar** | Assinatura (desenho, digitação e foto), imagens, símbolos e data, fontes extras, detecção de campos, criação de PDF preenchível | Assinar o PEI no celular com o dedo. A detecção sugere pelo menos 80% dos campos do PEI | 5–6 dias |
| **M3 · Páginas** | Organizar, juntar, dividir/extrair, imagens→PDF (com câmera), PDF→imagens | Juntar 3 PDFs, reordenar, girar e excluir no celular, com os objetos do editor acompanhando as páginas | 3–4 dias |
| **M4 · Anotar** | Destacar, sublinhar e riscar (com toque), caneta, formas, corretivo, notas | As anotações aparecem iguais no Chrome, no Acrobat e no leitor do celular | 4–5 dias |
| **M5 · Otimizar e proteger** | Comprimir, senha (proteger e desbloquear), marca d’água, números, recortar, tarja, achatar, propriedades | Compressão “leve” reduz um PDF de fotos em 40% ou mais; a tarja não deixa texto recuperável (verificado extraindo o texto) | 5–6 dias |
| **M6 · Opcionais** | Digitalizar com a câmera (perspectiva manual), comparar PDFs, *share target* e *file handlers* | — | 3–4 dias |

**Ordem:** M0 → M1 → M2 seguem nessa sequência, porque M1 e M2 dependem do modelo de objetos. Depois do M2, os marcos M3, M4 e M5 são independentes e podem ser feitos em qualquer ordem ou em paralelo.

## 8. Riscos

| # | Risco | Mitigação |
|---|---|---|
| 1 | **Memória no celular (principalmente iOS):** PDFs grandes travam a aba | Renderizar só as páginas visíveis (o pdf.js já faz isso); Workers; aviso de tamanho; liberar os canvas depois de usar; testes em aparelho real |
| 2 | **Compressão mais fraca que a de serviços com servidor (Ghostscript)** | Mostrar o ganho real e nunca entregar um arquivo maior. Avisar no modo “forte” que o texto deixa de ser selecionável |
| 3 | **Fidelidade das fontes entre aparelhos:** o Android não tem Arial, e as quebras de linha mudariam | Servir as fontes Liberation (mesmas medidas de Helvetica/Times/Courier) pelo próprio site e usá-las tanto na tela quanto no PDF |
| 4 | **Destacar texto com toque:** a seleção nativa do celular é ruim sobre o pdf.js | Seleção própria pela geometria do texto (arrastar sobre as linhas) |
| 5 | **Bibliotecas sem manutenção ou com falhas** | Fork mantido do pdf-lib; versões fixas com lockfile; Dependabot; nenhuma dependência carregada de CDN |
| 6 | **Limitações do iOS** (sem *share target*, PWA mais restrito) | Funções extras são progressivas: se a API não existe, o botão não aparece. O núcleo funciona em qualquer navegador moderno |
| 7 | **Expectativa de validade jurídica da assinatura** | Aviso claro: “assinatura eletrônica simples”, com link para o assinador do gov.br |

## 9. Decisões pendentes (com a recomendação)

1. **Interface:** Svelte 5 *(recomendado)* ou TypeScript puro (sem framework, mais verboso com tantas telas).
2. **Repositório:** público no plano gratuito *(recomendado; o código não tem segredos)* ou privado (exige plano pago, e o site continua público).
3. **Nome e endereço:** `<usuário>.github.io/<repo>` ou domínio próprio.
4. **OCR:** fora do escopo por ser rede neural *(recomendado, por R2)*, ou incluir como opcional carregado sob demanda.
5. **Versão em arquivo único** (como o “Editor de PDF.html” em Downloads): descontinuar, porque o PWA offline cumpre o papel *(recomendado)*, ou manter um build extra com `vite-plugin-singlefile`.

## 10. Base da pesquisa (resumo)

- As funções mais usadas, segundo dados dos próprios fabricantes, são **comprimir (34%)**, **assinar (19%)** e **PDF→Word (16%)** no Smallpdf. 63% das visualizações são no celular, mas 72% das edições ainda acontecem no computador.
- A ordem das ferramentas do iLovePDF é Juntar, Dividir, Comprimir, Converter, Editar, PDF↔JPG, Assinar…, e entre as novidades está a detecção automática de campos. Os apps de leitura (Acrobat Reader) destacam **preencher e assinar** e **anotar**.
- Dessas, ficam de fora só as conversões para Office e as funções de IA. Todo o resto cabe no navegador.

## Fontes

- [Smallpdf — PDF Statistics & Usage in 2025](https://smallpdf.com/pdf-statistics)
- [iLovePDF — ferramentas](https://www.ilovepdf.com/pt)
- [Ahrefs — palavras-chave de pdf.io](https://ahrefs.com/websites/pdf.io)
- [Adobe Acrobat Reader — App Store](https://apps.apple.com/app/apple-store/id469337564)
- [PCWorld — Best free PDF editors](https://www.pcworld.com/article/702374/best-free-pdf-editors.html)
- [GitHub Docs — limites do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [MDN — share_target (manifest)](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/share_target)
- [web.dev — Receber dados compartilhados (Web Share Target)](https://web.dev/web-share-target)
- [jsDelivr — @cantoo/pdf-lib (módulo de segurança)](https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.7.1/src/core/security/PDFSecurity.ts)
- [DEV — Desbloquear PDF no navegador com qpdf WebAssembly](https://dev.to/linmingren/building-a-browser-based-pdf-unlock-tool-with-qpdf-webassembly-361a)
- [jsDelivr — pdfstudio (qpdf.wasm no navegador)](https://cdn.jsdelivr.net/npm/pdfstudio@0.4.0/README.md)
- [Nutrient — pdf.js + pdf-lib para manipular páginas](https://www.nutrient.io/blog/pdfjs-pdf-page-manipulation-pdf-lib/)
- [DEV — Comprimir PDF no navegador com pdf-lib e Web Workers](https://dev.to/shaishav_patel_271fdcd61a/compress-pdf-in-the-browser-without-a-server-how-it-works-pdf-lib-web-workers-14pb)

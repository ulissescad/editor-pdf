# Editor de PDF

Preencha, assine, anote e organize PDFs **direto no navegador**. Sem servidor, sem IA e sem nenhuma requisição a terceiros:
os arquivos nunca saem do aparelho de quem usa. Funciona offline e pode ser instalado no celular (PWA).

O plano completo, com as funções e os marcos, está em [PLANO.md](PLANO.md).

## Situação atual (marco M4)

- **Editor** (`#/editor`), pensado primeiro para o celular:
  - preencher formulários (AcroForm e XFA);
  - caixas de texto: mover, redimensionar, fonte, tamanho, negrito, itálico, alinhamento e cor; além das fontes
    padrão do PDF, Open Sans, Caveat (manuscrita) e Dancing Script (cursiva), embutidas no PDF só com os caracteres usados;
  - **assinatura**: desenhar com o dedo, digitar o nome (3 letras cursivas) ou usar a foto da assinatura no papel
    (o fundo é removido); as assinaturas ficam guardadas no aparelho para reutilizar;
  - **imagens**, **símbolos** (✓ ✗ ● ○) e **data de hoje** com um toque;
  - **detectar campos** em PDFs sem formulário (só regras geométricas, sem IA) e **criar campos** à mão:
    o PDF baixado sai com campos de formulário de verdade, já preenchidos;
  - **anotar**: destacar, sublinhar e riscar o texto arrastando o dedo sobre as linhas (um toque marca a palavra),
    caneta à mão livre (com marca-texto), retângulo, elipse, linha, seta, corretivo branco e notas (comentários).
    Destaques e notas saem como anotações de verdade do PDF (aparecem na lista de comentários de outros leitores);
    no celular, um dedo desenha e dois dedos rolam;
  - **organizar páginas** do documento aberto (reordenar, girar, excluir, duplicar, página em branco): o que você
    escreveu acompanha as páginas; páginas giradas são editadas em pé;
  - desfazer/refazer, copiar, colar e duplicar;
  - pinça para zoom, miniaturas, busca e indicador de página;
  - **rascunho automático** no próprio navegador (“Continuar de onde parou”);
  - **PDF reeditável**: o PDF baixado, reaberto aqui, volta com textos, imagens, assinaturas, símbolos e anotações editáveis;
  - baixar, compartilhar (WhatsApp, e-mail…) e imprimir.
- **Ferramentas prontas**: Assinar PDF, **Juntar PDF**, **Dividir PDF** (intervalos, uma página por arquivo ou
  escolher páginas; vários arquivos saem num ZIP), **Organizar páginas**, **Imagens para PDF** (com a câmera do celular)
  e **PDF para imagens** (JPG ou PNG). Os formulários continuam preenchíveis depois de juntar ou dividir, e PDFs
  feitos no editor continuam reeditáveis. As demais ferramentas chegam no marco M5.
- Bibliotecas, fontes, CMaps e WebAssembly servidos pelo próprio site, com CSP que bloqueia qualquer outra origem.
- Offline depois da primeira visita (service worker) e instalável.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie este projeto para a branch `main`.
2. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada push na `main` roda os testes e, se passarem, publica em `https://<usuário>.github.io/<repositório>/`.
   O caminho base é detectado automaticamente pelo nome do repositório.
4. **Domínio próprio (opcional):** configure o domínio em Settings → Pages e crie a variável de repositório
   `BASE_PATH` com o valor `/` (Settings → Secrets and variables → Actions → Variables).

> O site publicado é público mesmo que o repositório seja privado (Pages em repositório privado exige plano pago).
> Nenhum dado de usuário passa pelo GitHub: todo o processamento acontece no navegador.

## Desenvolvimento

Requer Node.js 22.12 ou mais novo.

```bash
npm install
npm run dev          # servidor local com recarga automática
npm run check        # tipos (TypeScript + Svelte)
npm test             # testes unitários e de viabilidade (pdf-lib, qpdf)
npx playwright install chromium webkit   # só na primeira vez
npm run test:e2e     # testes de ponta a ponta: computador, Android e iPhone (emulados)
npm run build        # gera o site em dist/
npm run icons        # regenera os ícones a partir de public/logo.svg
```

Os testes de ponta a ponta usam o build de produção servido em `/editor-pdf/`, como no GitHub Pages, e reprovam se o site
fizer **qualquer requisição para fora** ou se houver violação da política de segurança.

Os PDFs de teste são gerados por script (`npm run fixtures`). **Não versione PDFs reais:** o `.gitignore` bloqueia `*.pdf`.

## Estrutura

```
index.html, src/main.ts, src/App.svelte   página inicial e rotas (#/editor, #/ferramenta/<id>)
src/editor/                               editor: estado, objetos, visualizador (pdf.js), caixas, assinatura, detecção de campos,
                                          páginas giradas (geom.ts)
src/pdf/                                  abertura (pdf.js), gravação/reabertura do PDF e montagem de páginas (pdf-lib)
src/tools/                                ferramentas: juntar, dividir, organizar, imagens ↔ PDF (carregadas sob demanda)
src/storage/                              rascunhos automáticos e assinaturas guardadas (IndexedDB)
src/lib/                                  catálogo de ferramentas, rotas, PWA
config/site.ts                            caminho base e política de segurança (CSP)
tests/unit, tests/e2e, tests/fixtures     testes e geração de PDFs sintéticos
.github/workflows/deploy.yml              testes + publicação no GitHub Pages
```

## Bibliotecas

pdf.js (Apache-2.0) · @cantoo/pdf-lib (MIT) · Svelte (MIT) · Lucide (ISC) · Workbox/vite-plugin-pwa (MIT) ·
@cantoo/fontkit (MIT) · fflate (MIT) · fontes Arimo, Tinos, Cousine, Open Sans, Dancing Script, Great Vibes e Caveat (OFL, via Fontsource) ·
qpdf-wasm (ISC, usado a partir do M5; hoje só nos testes de viabilidade)

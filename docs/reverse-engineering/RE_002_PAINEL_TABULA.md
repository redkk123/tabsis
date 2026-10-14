# RE-002 — O painel de tabulação do TabWin 4.15, observado e decompilado

**Data:** 2026-10-13
**Binário:** `TabWin415.exe`, PE32 i386, 1.927.680 bytes,
SHA-256 `0E29A44DE78D164CE13FAA73EC74B76C77041FCF3D8BF6374A893B5E6A713F02`
(o mesmo do RE-000; continua fora do repositório).
**Dados:** `RDAC2401.dbc` (SIH/RD, Acre, jan/2024, SHA-256 `41B7AD58…638429`),
`RD2008.DEF` e as CNV do pacote `TAB_SIH`.

## Por que este relatório

O professor pediu foco em **tabulação**, destaque para **Linhas, Colunas,
Incremento e Seleções**, e entendimento de DEF, CNV, DBC e DBF. Os relatórios
anteriores mapearam métodos (RE-000) e o formato `.TAB` (RE-001). Este olha o
**painel** — a tela onde a tabulação é montada — e as regras que ele aplica,
com três fontes que se conferem entre si:

1. **O programa rodando.** TabWin 4.15 sob Wine 10.0 (Ubuntu 26.04, sem
   privilégio de administrador), numa tela virtual Xvfb, dirigido por cliques
   sintéticos (XTEST). Cada afirmação "o TabWin faz X" abaixo tem uma captura
   em [`telas/`](./telas/).
2. **Os formulários Delphi.** Os 40 `TPF0` dos recursos `RCDATA` do executável
   decodificados para texto: a tela exata, com nomes de controles, legendas,
   dicas e valores padrão ([`ferramentas/TTABULA.dfm.txt`](./ferramentas/TTABULA.dfm.txt),
   [`ferramentas/TTELA_PRINCIPAL-menus.txt`](./ferramentas/TTELA_PRINCIPAL-menus.txt)).
3. **O código.** [rea](https://github.com/morluto/rea) 6.4.0 com o motor Ghidra
   12.1.4 (JDK 21): busca de textos, referências cruzadas e decompilação das
   rotinas que importavam.

## Achados

### 1. A diretiva `X` do DEF é Linha + Coluna + Seleção

Era o único buraco declarado na especificação do DEF (DEF_SPEC_R01 §7). O
`RD2008.DEF` usa `X` em 47 opções (`XMunicípio internação,MUNIC_MOV,1,CNV\br_municip.cnv`
e afins). No TabWin, "Município internação" aparece nas três listas
([01](./telas/01-painel-rd2008.png)); num DEF de teste, `XSexo X` aparece por
último nas três, depois das linhas `L`, `C` e `S` declaradas antes dele
([04](./telas/04-painel-teste-x.png)).

**No TabSis:** o leitor de DEF trata `X` como Linha + Coluna + Seleção. Antes
ele guardava a linha como desconhecida, e as 47 opções sumiam do painel.
A diretiva `?` (`?\TAB\RD.HLP`, o arquivo de ajuda do botão "Ajuda") também
passou a ser lida.

### 2. O painel, controle por controle

Do formulário `TTabula` (geometria em pixels no `.dfm.txt`):

| Controle | O que é | Padrão observado |
| --- | --- | --- |
| `ListLinha` | Linhas | primeira opção do DEF |
| `ListColunas` | Colunas | **"Não ativa"** |
| `ListIncr` (múltipla) | Incremento | **Frequência**, sempre a primeira, depois os `I` |
| `ListInicial` → `ListSelecao` | Seleções disponíveis → ativas (botões Incluir/Excluir) | nenhuma |
| `ListCategSel` (múltipla) | Categorias da seleção ativa marcada | nenhuma marcada |
| `cbSupLin` / `cbSupCol` | Suprimir linhas / colunas zeradas | linhas **não**, colunas **sim** |
| `NaoClassificado` | Ignorar / Incluir / Discriminar | Ignorar |
| `ckTestaCRC`, `cbGrava` | Testar CRC, Salvar registros | desligados |
| `EspecArquivos` + `ListArquivos` | padrão do `A` do DEF e os arquivos que casam | nomes originais (`RDAC2401.dbc`) |

Incluir uma seleção a tira das disponíveis ([02](./telas/02-selecao-uf.png)).
As categorias aparecem na ordem da CNV.

### 3. As recusas, com as palavras do TabWin

- Coluna ativa com dois incrementos: **"Múltiplas colunas é incompatível com
  múltiplos incrementos"** ([08](./telas/08-erro-colunas-incrementos.png)).
  O motor do TabSis já recusava a combinação; agora a mensagem é a mesma.
- Seleção ativa sem categoria: **"Nenhuma categoria selecionada em Raça
  parcial"** ([09](./telas/09-erro-sem-categoria.png)).

### 4. "Não classificados"

Observado com uma CNV parcial (`RACA1.CNV`: só `01` Branca e `03` Parda; o
RDAC2401 tem também `02`, `04` e `05`, 1.015 registros):

| Opção | Resultado | Captura |
| --- | --- | --- |
| Ignorar (0) | Branca 260, Parda 3.040; Total 3.300 | — |
| Incluir (1) | + uma linha **"Não classificados" 1.015**; Total 4.315 | [05](./telas/05-nao-classificados-incluir.png) |
| Discriminar (2), CNV curta | igual a Ignorar (!) | [06](./telas/06-discriminar-cnv-curta.png) |
| Discriminar (2), CNV literal `2 2 L` | + uma linha por código: **05** 118, **02** 72, **04** 825 — na ordem em que aparecem no arquivo | [07](./telas/07-discriminar-cnv-literal.png) |

O terceiro caso parecia defeito até a decompilação. A rotina que classifica
cada registro (início `0x53A718`, achada pelas referências à string "Não
classificados") faz, para a linha:

```c
if ((nCategorias < categoria) && (0 < modo)) {          // código sem correspondência
  if (modo == 1) categoria = linhaExtra;                 // Incluir: uma linha só
  else if (modo == 2 && cnvLiteral == 1 && ...) {         // Discriminar
    if (!achaNaLista(codigo)) { novaLinha(codigo); }      // uma linha por código
  }
}
```

e, para a coluna, com qualquer modo maior que zero, dá à coluna extra o rótulo
"Não classificados" — Discriminar e Incluir viram a mesma coluna única. Na
montagem (início `0x53BA04`), o modo é `NaoClassificado.ItemIndex`, e a
capacidade de linhas é `n + 1` (Ignorar/Incluir) ou `n + máximo + 1`
(Discriminar). O teste no programa real com a CNV literal confirmou a leitura.

**No TabSis:** `unclassifiedPolicy` ganhou `discriminate-codes` (só age em CNV
literal ou tabela DBF; ordem de primeira aparição); o painel traduz
Ignorar/Incluir/Discriminar exatamente assim.

### 5. O log, que é também o topo do `.TAB`

Cada tabulação abre uma janela "Log" ([03](./telas/03-log-e-tabela.png),
[11](./telas/11-tres-incrementos.png)):

```text
[Opções]
DEF=C:\TabWin\G001\TESTE.DEF
PATH=C:\TabWin\G001\RD*.DBC
Linha=Sexo
Coluna=Caráter                ← só com coluna ativa
Incremento=Freqüência         ← uma linha por incremento
Incremento=Valor Total
Suprime_Linhas_Zeradas=true
Suprime_Colunas_Zeradas=true
Não_Classificados=0           ← 0 Ignorar, 1 Incluir, 2 Discriminar
[Seleções_Ativas]
Raça parcial: Branca|Parda    ← categorias separadas por "|"
[Arquivos]
RDAC2401.dbc
Registros_Processados= 4315
Tempo_Decorrido= 0:00
```

É o mesmo texto que abre um `.TAB` salvo (depois de `NEW`, `Titulo1=` e
`Titulo2=`, ver RE-001). O código que escreve `Não_Classificados=` está em
`0x53C948`.

**No TabSis:** `packages/formats/src/tabwin-log.ts` lê e escreve esse formato;
o painel gera o log a cada execução e "Restaurar consulta" remonta o painel a
partir de um log colado ou de um `.TAB`.

### 6. Título e subtítulo

Título = primeira linha de comentário do DEF. Subtítulo =
`<incrementos separados por espaço>[ por <coluna>] segundo <linha>`:
"Freqüência por Caráter segundo Sexo"; "Freqüência Valor Total Obitos segundo
Sexo" ([10](./telas/10-coluna-com-selecao.png), [11](./telas/11-tres-incrementos.png)).
Com coluna, a tabela ganha a coluna **Total** à direita.

### 7. Operações que faltavam: `%percentagem` e `Normalizar`

Decompilados os métodos publicados `percentagem1Click` (`0x5651CC`) e
`Normalizar1Click` (`0x5652C4`):

- **%percentagem:** coluna nova = valor ÷ total da coluna × 100; cabeçalho
  `%` + nome; total da coluna nova = 100.
- **Normalizar:** coluna nova = (x − média) ÷ desvio padrão **amostral**
  (n − 1), sobre todas as linhas; cabeçalho `Z` + nome; total zero.

**No TabSis:** operações `percent-of-total` e `normalize`, no menu Operações.

### 8. O CRC do DBC

Os 4 bytes entre o cabeçalho e o trecho comprimido de um `.dbc` são o
**CRC-32 (o do zip), little-endian, do DBF inteiro descomprimido**. Conferido
em RDAC2401, DOINF23, DNAC2023 e DENGBR25. É o que a caixa "Testar CRC" do
painel (`ckTestaCRC`, `bTestaCRCClick` em `0x4B5BC0`) confere.

**No TabSis:** `packages/acquisition/src/dbc-crc.ts` e a caixa "Testar CRC"
no painel.

## Conferência dos números

`npm run verify:painel -- <pasta com RDAC2401.dbc, SEXO.CNV, CARINT.CNV>`
monta o painel do TabSis com o DEF e as CNV de teste (guardados em
`fixtures/oracle/painel-2026-10-13/expected.json`) e compara com o que o
TabWin mostrou: **6/6 casos iguais**, incluindo Valor Total 3.360.215,90 e a
ordem 05, 02, 04 do Discriminar.

## Como refazer

### Wine sem administrador

```bash
apt-get download wine wine64 libwine wine-common fonts-wine libz-mingw-w64 libcapi20-3t64
for d in *.deb; do dpkg -x "$d" ~/.local/opt/wine-root; done
```

Três ajustes, porque o build do Debian guarda caminhos absolutos:
`WINEDATADIR`/`WINEDLLPATH` apontando para a raiz extraída; o caminho
`/usr/local/share/wine/nls` do `wineserver` trocado por um link curto; e o
`zlib1.dll` (do `libz-mingw-w64`) copiado para `system32`/`syswow64` do
prefixo. O TabWin 32-bit roda no modo WoW64 novo, sem bibliotecas i386. Para
janelas confiáveis sem gerenciador de janelas, a área de trabalho virtual do
Wine (`HKCU\Software\Wine\Explorer\Desktops`).

### Telas e cliques

`Xvfb :77` (de `apt-get download xvfb`), e os scripts de
[`ferramentas/`](./ferramentas/): `shot.py` (captura), `x.py` (clique, duplo
clique, Ctrl+clique, tecla, digitação via XTEST), `wins.py` (lista janelas),
`dfm.py` + `dfm2txt.py` (extrai e decodifica os formulários Delphi).

### rea + Ghidra

```bash
export JAVA_HOME=<jdk-21> GHIDRA_INSTALL_DIR=<ghidra_12.1.4> GHIDRA_HEADLESS_MAXMEM=3G
node scripts/rea.mjs search  TabWin415.exe "classificad" --provider ghidra --format json
node scripts/rea.mjs xrefs   TabWin415.exe 0x53ac50      --provider ghidra --format json
REA_GHIDRA_SEED_FILE=ghidra-seeds.tsv \
node scripts/rea.mjs decompile TabWin415.exe --procedure=0x53a718 --provider ghidra --format json
```

Duas armadilhas que custaram tempo e ficam anotadas:

- O Ghidra corta as strings no `ã` em Windows-1252 ("o classificados"). A
  referência aponta para o começo real da string, dois bytes antes; para uma
  `ShortString` Delphi, um byte antes disso (o comprimento).
- A análise automática não cria função em boa parte do código Delphi. Sem
  função, `decompile` recusa o endereço. A saída é dar **sementes**
  ([`ferramentas/ghidra-seeds.tsv`](./ferramentas/ghidra-seeds.tsv)): o início
  provável é o prólogo `55 8B EC` logo depois de um `ret`.

Cada chamada do rea abre uma sessão nova do Ghidra: cerca de 2,5 minutos de
análise para este executável.

## O que continua em aberto

- O número máximo de linhas extras do Discriminar (`PTR_0057371C`) não foi
  medido. O TabSis não limita.
- Seleção por tabela DBF (ex.: "Hospital AC (CNES)") no painel usa os códigos
  brutos; o TabWin real não foi comparado nesse caso.
- `Testar CRC` em `.dbf` solto não se aplica (só o DBC tem CRC gravado).

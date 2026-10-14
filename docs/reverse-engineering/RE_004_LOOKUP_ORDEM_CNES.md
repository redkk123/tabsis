# RE-004 — Texto no lugar da posição, CNV no formato N, ordem do Discriminar e CNES

Data: 2026-10-14. Programa de referência: TabWin 4.15 (`TabWin415.exe`) no
Wine 10, a mesma montagem do [RE-002](./RE_002_PAINEL_TABULA.md). Dados:
`RDAC2401.dbc` (SIH, Acre, jan/2024, 4.315 registros) e as CNV do `TAB_SIH`.

## Por que olhar

O `RD2008.DEF` oficial tem seis linhas como

```
LSubTp FAEC                ,FAEC_TP   ,DS_TPFIN     ,CNV\TP_FINAN.CNV
LProcedimentos obstétricos    ,PROC_REA  ,IP_DSCR   ,CNV\PROCOBS2b.CNV
```

O terceiro campo deveria ser a posição inicial (um número) e é um nome de
campo. Com `.DBF` no quarto campo seria o lookup em DBF (RE-003, D1–D4); com
`.CNV` não há documentação. O SINAN tem o mesmo (`NotSurtoNet.def`:
`XAgravos Surto notif,ID_AGRAVO,NM_AGRAVO,agravsurt.cnv`). O TabSis mostrava
essas opções em cinza ("ainda não funciona no TabSis").

## T1 — o terceiro campo é ignorado ([painel](./telas/20-def-lookup-cnv-no-painel.png), [tabela](./telas/21-lookup-cnv-subtp-faec.png))

`AAEXT.DEF` com as duas formas lado a lado, Discriminar:

```
LSubTp FAEC,FAEC_TP,DS_TPFIN,CNV\TP_FINAN.CNV
LProc obs,PROC_REA,IP_DSCR,CNV\PROCOBS2b.CNV
LSubTp FAEC 1,FAEC_TP,1,CNV\TP_FINAN.CNV
LProc obs 1,PROC_REA,1,CNV\PROCOBS2b.CNV
```

As tabelas salvas (`.TAB`) da forma com texto e da forma com `1` são idênticas
byte a byte, fora o nome da linha — nas duas variáveis. **O TabWin ignora o
texto e lê a CNV a partir da posição 1.**

**No TabSis:** texto no terceiro campo + `.CNV` no quarto vira uma opção de
conversão comum, posição 1 (`ignoredThirdField` guarda o texto). Outras
extensões, sem caso medido, continuam guardadas sem executar.

## T1, de quebra — duas diferenças que não eram do DEF

A conferência das duas tabelas contra o TabSis achou mais duas coisas:

1. **Formato N com `L`.** `TP_FINAN.CNV` começa com `N 101 6 L`. O TabSis
   tratava o `N` como um modo de comparação à parte e ignorava o `L`. O `N`
   só alarga as colunas (sequência 6–9, descrição 12–111, códigos 113+); a
   comparação segue a regra de sempre (`L`, ou código com mais de 4
   caracteres = literal). Agora `newFormat` diz o layout e `mode` a
   comparação.
2. **Branco entre vírgulas.** A linha 101 do `TP_FINAN.CNV` é
   `000000-999999,      ,`. Os 3.642 registros sem `FAEC_TP` caem nela no
   TabWin: na CNV literal, espaços entre vírgulas são o código em branco
   (até então só o branco no começo da lista contava, como `  ,` no SIM).

Os goldens (inclusive o G012, que é formato N), o painel, o DBF lookup e o
SIM/SINASC/SIA/SINAN continuam sem diferença.

## T2 — a ordem do Discriminar num DBC ([tela](./telas/22-ordem-de-leitura-dbc.png))

Com as duas correções acima, `Proc obs` ainda divergia só na **ordem** das
linhas discriminadas: quase a ordem em que os códigos aparecem no arquivo,
com 40 trocas locais em 381.

A decompilação de `0x53A718` (RE-002) mostra que o código novo entra na
própria lista literal da CNV (`0x47405c` procura, `0x474120` insere) com o
número da próxima linha. A ordem das linhas é, então, a ordem em que o TabWin
**lê** os registros. Para ver essa ordem: Discriminar sobre `N_AIH` (único por
registro) com uma CNV `1 13 L` que não reconhece nada (`AIHL.CNV`,
`AAORD.DEF`). O TabWin lista os 4.315 registros:

```
1 2 3 4 5 · 7 8 9 10 11 6 · 13 14 15 16 17 12 · 19 … 23 18 · …
```

O registro tem 702 bytes. O 6º ocupa os bytes 3.510–4.211 dos dados, e
atravessa a fronteira de 4.096; o 12º atravessa 8.192; o 18º, 12.288. **O
TabWin descomprime o DBC em pedaços de 4.096 bytes e, em cada pedaço, processa
primeiro os registros inteiros e depois o que vinha partido do anterior.** O
modelo reproduz os 4.315 sem exceção. O mesmo arquivo descomprimido (`.DBF`,
`AAORE.DEF`) sai exatamente na ordem do arquivo.

**No TabSis:** `tabwinReadPosition` (`packages/core/src/read-order.ts`) dá a
posição de leitura de cada registro (DBC em pedaços; DBF, Parquet e registros
soltos na ordem do arquivo; vários arquivos um depois do outro). O acumulador
guarda, para cada código do Discriminar, a menor posição em que apareceu, e
ordena as linhas por ela. A contagem não muda; só a ordem.

## CNES conferido no TabWin

Com o `TAB_CNES.zip` oficial e o Acre de jan/2025 (`STAC2501.dbc`, 1.467
estabelecimentos; `LTAC2501.dbc`, 276 registros de leitos).

**Três dos 15 DEFs do CNES eram recusados inteiros pelo TabSis.** O TabWin os
abre ([painel](./telas/23-cnes-estabelecimento-no-painel.png)) e lista as
linhas-título como opções:

- `X* EQUIPES_AC *,    , TITULO , TITULO_REFERENTES_A_EQUIPES_DO_UF`
  (Equipes.def): opção sem campo;
- `I* ATENDIMIMENTO PRESTADO *, ATEND_PR,` (Estabelecimento.def,
  DadosComplementares.def): incremento com vírgula sobrando.

**No TabSis:** as duas formas abrem; a linha-título aparece em cinza no painel
("título de seção do DEF, não é uma variável"), como as de 3 campos
(`X* DADOS GERAIS *, TITULO, LINHA_COMENTARIO_…`).

Doze tabelas salvas pelo TabWin, com Incluir (`verify:sim-sinasc … CNES=`):

| Caso | Variável | O que exercita |
| --- | --- | --- |
| C0 | Natureza Jurídica (`NATJUR.CNV`, formato N) | subtotais N; `    -zzzz` (abaixo) |
| C1 | Esfera Jurídica | subtotais |
| C2 | Tipo de Estabelecimento | CNV comum |
| C3 | Retenção Tributos Estabel. | campo vazio em todos |
| C4 | Ambulatorial Atenção Básica | código lido de GESPRG1E+GESPRG1M |
| C5 | Serviço Social | SERAP02P+SERAP02T |
| C6 | INTERNAÇÃO | AP01CV01…AP01CV04 (4 campos) |
| C7 | INT. Seguro Próprio/Terceiro | AP01CV03+AP01CV04 |
| L0–L3 | Leitos: Tipo/Especialidade, Especialidade, Hosp/Complementar, Retenção | `G QT_EXIST` + incremento Quantidade Leitos SUS |

Onze bateram de saída. O C0 diferia num estabelecimento (`NAT_JUR` 8885, que
nenhuma linha cobre): o TabWin o põe em "--- Não especificado ou ignorado",
cuja linha tem o código `    -zzzz`.

### Teste H — hífen no começo do código da CNV curta

[`ferramentas/re004-cnv-hifen.py`](./ferramentas/re004-cnv-hifen.py): CNV `2 3`
com a linha 1 testada e a linha 2 = `100`; registros 050, 100, 300, 700, 999,
A01, K01 e branco com pesos 1…128.

| Código da linha 1 | TabWin | Quem caiu |
| --- | ---: | --- |
| `-zzz` | 0 | — |
| `-500` | 128 | só o branco |
| `500-` | 128 | só o branco |
| `---` | 128 | só o branco |
| `   -500` (espaços antes) | 165 | branco, A01, 300, 050 |
| `000-500` (controle) | 165 | o mesmo |
| `   -zzz` (espaços antes) | 253 | tudo menos o 100 — até o K01 |
| `000-zzz` | 253 | o mesmo |

**Espaços antes do hífen são o início da faixa: o branco.** `    -zzzz` pega
tudo o que as outras linhas não pegam — é a linha "pega o resto" de 57 linhas
das CNVs oficiais (NATJUR, TP_ESTAB, BR_UFS, FONTEREM…). E a faixa passa do 999
quando a ponta tem letra (`zzz` = 2600; K01 = 1001).

O hífen colado no começo (`-500`, `---`) só pega o branco, e `-zzz` não pega
nem ele. Explicado pela decompilação, abaixo.

**No TabSis:** com isso o CNES fica 12/12.

## Como o TabWin lê a lista de códigos da CNV curta (decompilado)

Três rotinas, achadas a partir de quem chama a inserção da lista literal:

- **CnvCarrega** (`0x47737c`, ~8 KB): para cada linha, pega a área de códigos
  como está (`Copy(linha, 61 ou 113, …)`, sem aparar) e a percorre:
  lê um código, avança; se o próximo caractere é vírgula, espaço ou o fim,
  registra; se é hífen, lê o fim e preenche a faixa; vírgula avança; **espaço
  encerra a lista**.
- **CnvLeCodigo** (`0x477314`): `Copy(área, posição, tamanho do código)` — no
  fim da linha o pedaço sai mais curto, sem espaço completando.
- **CnvIndiceCurto** (`0x476c24`): se o primeiro caractere é espaço, todo
  espaço vira `0`; se é letra (`A`…`z`, também `[ \ ] ^ _ \``), vale
  `maiúscula − 0x40` vezes 10^(resto) e sai da frente; o resto passa pelo
  `Val` do Delphi, e se falhar todo não-dígito vira `0`.

Daí os casos do teste H: `-500` é lido como `-50` (= −50, índice que não
existe) e depois `0` (o branco); `---` vira `000`; `-zzz` vira `0` (sem
registro, porque vem `z` depois) e `z` (= 26). E o hífen **não** vale 13, como
o RE-003 supunha.

### Teste I e teste J — as consequências, medidas

[`ferramentas/re004-cnv-leitura.py`](./ferramentas/re004-cnv-leitura.py):

| CNV | TabWin | Por quê |
| --- | --- | --- |
| `050, 300` | só 050 (e o dado `*50`) | o espaço depois da vírgula encerra a lista |
| linha-título sem código | o branco | lista vazia registra o índice 0 |
| `*50` | 050 e `*50` | `*` não é letra: `Val` falha, vira `050` |
| `1 5` | 105 | espaço no meio vira 0 |
| `A15` no fim da linha, CNV de 4 | o dado `0115` | o pedaço é `A15` = 100 + 15; o dado `A15 ` (com o espaço do campo) é 1150 |
| título com espaços, CNV de 4 | o branco | `    ` vira `0000` |

**No TabSis:** a CNV curta guarda a área de códigos crua de cada linha
(`shortArea`) e a tabela é montada pelo mesmo laço, com a mesma conversão
(`cnv-match.ts`). Goldens, segundos goldens, painel, DBF lookup, RDAC2401 e
SIM/SINASC/SIA/SINAN/CNES seguem sem diferença.

## Incremento com cara de título

`I* LEITO HOSPITALAR *, LEITHOSP` (Estabelecimento.def do CNES) não é título:
o TabWin soma o campo `LEITHOSP` (indicador `1`/`0` do arquivo) — 31 no
STAC2501. O TabSis faz o mesmo; o caso entrou no `verify:sim-sinasc` (40/40).

## Conferência

`npm run verify:re003 -- <pasta>`: 9/9 (os 7 do RE-003 + SubTp FAEC e Proc
obs, com Discriminar). A sequência medida está em
`fixtures/oracle/re004-ordem-dbc/expected.json` e é o teste
`tests/read-order.test.mjs`.

`verify:sim-sinasc` com `CNES=<pasta>`: 39/39 (SIM, SINASC, SIA, SINAN e os 12
do CNES).

## O que não foi medido

- Registro maior que 4.096 bytes num DBC (fica na ordem do arquivo).
- Terceiro campo com texto e recurso que não é `.CNV` nem `.DBF`.
- A linha-título `X** DADOS DO PACIENTE **,,,` do `Atencao_Domiciliar.def`
  (SIA), que o TabSis mostra em cinza.
- Espaços + hífen em CNV literal (só a curta foi medida).

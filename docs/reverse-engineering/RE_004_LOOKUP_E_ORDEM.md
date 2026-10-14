# RE-004 — Texto no lugar da posição, CNV no formato N e a ordem do Discriminar

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

## Conferência

`npm run verify:re003 -- <pasta>`: 9/9 (os 7 do RE-003 + SubTp FAEC e Proc
obs, com Discriminar). A sequência medida está em
`fixtures/oracle/re004-ordem-dbc/expected.json` e é o teste
`tests/read-order.test.mjs`.

## O que não foi medido

- Registro maior que 4.096 bytes num DBC (fica na ordem do arquivo).
- Terceiro campo com texto e recurso que não é `.CNV` nem `.DBF`.
- A linha-título `X** DADOS DO PACIENTE **,,,` do `Atencao_Domiciliar.def`
  (SIA), que o TabSis mostra em cinza.

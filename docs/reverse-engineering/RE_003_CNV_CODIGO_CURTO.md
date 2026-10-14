# RE-003 — Como o TabWin lê o código curto da CNV

Data: 2026-10-14. Programa de referência: TabWin 4.15 (`TabWin415.exe`) no
Wine 10, a mesma montagem do [RE-002](./RE_002_PAINEL_TABULA.md).

## Por que olhar

O Help do TabWin v2 (versão impressa, distribuída pela Vigilância em Saúde de
MG) diz, sobre a CNV de código curto (até 4 posições):

> "Como as letras de A até J são mapeadas sobre os dígitos de 0 a 9, é possível
> aceitar códigos que usem letras ou números na primeira posição, mas não
> ambos."

O TabSis comparava o código como texto. Se o TabWin converte a letra em
número, os dois dão tabelas diferentes: `A01` e `101`, por exemplo, seriam o
mesmo código para o TabWin e códigos diferentes para o TabSis.

## O experimento

DBFs e CNVs pequenos, feitos para isso, com um peso diferente em cada registro
(1, 2, 4, 8…) num campo lido pela diretiva `G` do DEF. A soma de cada linha da
tabela do TabWin diz exatamente quais registros caíram nela. Não classificados
em **Incluir**, para nada sumir.

Os arquivos saem de [`ferramentas/re003-cnv-curta.py`](./ferramentas/re003-cnv-curta.py)
(`python3 re003-cnv-curta.py <pasta G001>`); os DEFs são `RE3T1.DEF` a
`RE3T4.DEF`. Cada teste foi rodado duas vezes, em sessões diferentes do
TabWin, com o mesmo resultado.

### T1 — letra contra faixa ([tela](./telas/12-cnv-curta-t1-letra-vs-faixa.png))

CNV `3 3`: `Letra A01` = `A01`, `Faixa 100-199` = `100-199`, `Faixa 900-999` = `900-999`.

| Linha | TabWin | Quem caiu |
| --- | ---: | --- |
| Letra A01 | 0 | — |
| Faixa 100-199 | 137 | `A01` (1) + `a01` (8) + `105` (128) |
| Faixa 900-999 | 256 | `950` |
| Não classificados | 118 | `001`, `B05`, `K01`, `J99`, `Z99` |

`A01` virou o código 101 nos dois lados. A linha da faixa, que vem depois,
ganhou (na CNV curta, quem vem depois ganha). Pelo Help, `J99` teria virado
999 e caído na faixa 900-999; não caiu.

### T2 — dado com letra × CNV de dígitos, e o contrário ([tela 1](./telas/13-cnv-curta-t2-dado-letra.png), [tela 2](./telas/14-cnv-curta-t2-cnv-letra.png))

| Dado | Caiu em |
| --- | --- |
| `@01` | 001 |
| `A01`, `a01` | 101 |
| `B01` | 201 |
| `I01` | 901 |
| `J01`, `j01`, `K01`, `S01`, `T01`, `Z01` | não classificados |

E a CNV escrita com letras (`A01` … `J01`) pegou os dados `101` … `901`; a
linha `J01` ficou com 0, e o dado `001` ficou sem classificação.

### T3 — letras além do J, e letra no meio ([tela](./telas/15-cnv-curta-t3-letras-no-meio.png))

| Linha da CNV | TabWin | Quem caiu |
| --- | ---: | --- |
| `J01` | 1 | `J01` |
| `K01` | 2 | `K01` |
| `Z01` | 4 | `Z01` |
| `1A1` | 0 | — |
| `a01` | 0 | — |
| `` `01 `` | 0 | — |
| `1 1` | 312 | `1A1` (8) + `101` (16) + `a01` (32) + `1 1` (256) |
| `001` | 704 | `@01` (64) + `001` (128) + ` 01` (512) |
| Não classificados | 1.024 | `01 ` |

`J`, `K` e `Z` não são "inválidos": casam com eles mesmos e com mais nada.
Fora da primeira posição, letra e espaço valem 0.

### T4 — campo em branco ([tela](./telas/16-cnv-curta-t4-branco.png))

| Linha | TabWin | Quem caiu |
| --- | ---: | --- |
| `000` | 15 | `   ` (1) + `0  ` (2) + `00 ` (4) + `000` (8) |
| `001` | 16 | `  1` |
| `100` | 32 | `A  ` |

**Campo em branco é o código 000.** Numa CNV como a de meses (`00,13-99` =
Ignorado), o mês em branco vai para Ignorado.

## A regra

O código curto vira um número de `codeLength` dígitos:

- o código tem sempre `codeLength` caracteres; o que falta à direita é
  espaço, como no campo de largura fixa do DBF;
- **1ª posição:** dígito vale ele mesmo; qualquer outro caractere vale os 5
  bits baixos do código ASCII: `A`/`a` = 1 … `I` = 9, `J` = 10 … `Z` = 26,
  `@`, `` ` `` e espaço = 0;
- **demais posições:** dígito vale ele mesmo, qualquer outra coisa vale 0.

Vale igual para o dado e para os códigos escritos na CNV. O Help errou por uma
letra (A = 1, não 0) e na restrição ("até J"): o programa aceita até o Z, só
que a partir do J o código não coincide com nenhum código numérico.

## O que mudou no TabSis

`packages/formats/src/cnv-match.ts` (`shortCodeIndex`): a CNV curta passa a
ser uma tabela de consulta direta índice → categoria, montada uma vez por CNV
na ordem do arquivo (quem vem depois sobrescreve). Isso também deixa a
classificação mais rápida (uma consulta por registro, em vez de percorrer as
regras).

- Campo de texto em branco (nulo) numa CNV curta agora é o código 000, como no
  TabWin.
- A CNV literal (`L`, ou código com mais de 4 posições) e a de faixas (`F`)
  não mudaram.
- **Campo numérico (DBF tipo N) continua pela comparação de texto.** O TabWin
  lê os caracteres do campo alinhado à direita; aqui o leitor já entrega o
  número, sem a largura original, e adivinhar o alinhamento poderia classificar
  errado em silêncio. Fica em aberto até um caso real pedir.

Conferido depois da mudança: `npm test` (843), `verify:painel` 6/6,
`verify:goldens` e `verify:goldens:second` (10 casos) sem nenhuma diferença.
Um teste antigo esperava `AA` como não classificado numa CNV `00-99`; pela
regra medida, `AA` é o código 10 e cai em `00-99`. O teste passou a usar `ZZ`
(código 260).

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
- Campo numérico (DBF tipo N): resolvido depois, com a estrutura do registro
  (ver "Dado real", abaixo). Sem cabeçalho de DBF (CSV), continua pela
  comparação de texto.

Conferido depois da mudança: `npm test` (843), `verify:painel` 6/6,
`verify:goldens` e `verify:goldens:second` (10 casos) sem nenhuma diferença.
Um teste antigo esperava `AA` como não classificado numa CNV `00-99`; pela
regra medida, `AA` é o código 10 e cai em `00-99`. O teste passou a usar `ZZ`
(código 260).

## Dado real: RDAC2401 com o RD2008.DEF (2026-10-14)

Para conferir em dado do DATASUS, procurei no `RD2008.DEF` as variáveis em
que a tabela mudaria, e tabulei essas mesmas no TabWin, salvando cada tabela
como `.TAB` pelo próprio programa (esperado em
[`fixtures/oracle/re003-rdac2401/expected.json`](../../fixtures/oracle/re003-rdac2401/expected.json);
`npm run verify:re003 -- <pasta com RDAC2401.dbc e CNV/>`).

Apareceram duas coisas que o teste com arquivos de mentira não mostrava:

**1. O código atravessa para o campo seguinte.** `COD_IDADE` tem 1 caractere e
as CNVs de idade (`IDADEBAS`, `IDADEPUB`, `IDADE18`, `IDADEDET`) têm código de
3. O TabWin lê 3 caracteres a partir de `COD_IDADE` **no registro de largura
fixa**, entrando em `IDADE` (2): o registro `426` é unidade 4 (anos), idade 26.
O TabSis lia só o `4`. Resultado na Faixa etária (18) do RDAC2401:

| | <1a | 1-4a | 5-9a | … | 80e+a | Ign |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| TabWin 4.15 | 184 | 168 | 130 | … | 187 | 0 |
| TabSis antes | 184 | 0 | 0 | … | 3 | 4.128 |
| TabSis agora | 184 | 168 | 130 | … | 187 | 0 |

Quem tabulava a faixa etária do SIH pelo DEF oficial no TabSis recebia quase
tudo como "Ign". Os casos de referência anteriores não usavam essa variável.

**2. `----` não é código.** As linhas-título das CNVs de Sensíveis à Atenção
Básica têm `----` no lugar dos códigos. Lido como código curto, `-` vale 13 e
`----` viraria o mesmo código de `M000`; o TabWin não classifica `M000` ali. O
hífen é separador de faixa: código que começa com hífen, ou faixa com uma ponta
vazia, é ignorado.

E a parte que o teste anterior previu se confirmou: CID de 3 caracteres
(`N39 `) numa CNV de 4 é lido com o espaço valendo 0 (`N390`) e cai na
categoria certa — antes ficava sem classificação.

| Variável | TabWin × TabSis |
| --- | --- |
| Faixa etária (5), (9), (18), Idade detalhada | iguais (lê `COD_IDADE`+`IDADE`) |
| Sensíveis Atenção Básica 1, 2, 3 | iguais |

### Como o TabSis faz

O plano passa a dizer, para cada Linha, Coluna ou Seleção com CNV, quais campos
do registro o código atravessa (`recordSpan`: nome, tipo, largura e decimais,
tirados do cabeçalho do DBF por `withRecordLayout`). O executor remonta o
trecho do registro como estava escrito — texto à esquerda, número à direita
com as casas decimais, branco como espaços — e lê `codeLength` caracteres a
partir da posição. Campo de texto que comporta o código continua como antes.
Como o `recordSpan` fica no plano, a receita salva reproduz a mesma leitura, e a
leitura só das colunas usadas (Parquet, cache) já inclui o campo vizinho.

Isso também fecha a lacuna do campo numérico em CNV curta: com a largura do
campo, o número é lido alinhado à direita, como o TabWin.

## Tabela DBF relacionada: Linha e Seleção (2026-10-14)

Linhas do DEF como `LHospital AC (CNES),CNES,NOMEFANT,DBF\TCNESAC.DBF`: o nome
na tabela vem de outro DBF. A Linha já tinha caso de referência (G015); faltava
a Seleção e o que acontece com código que não está no DBF. Quatro casos no
`RDAC2401`, salvos pelo TabWin (`fixtures/oracle/re003-dbf-lookup`,
`npm run verify:dbf-lookup`):

| Caso | TabWin | TabSis |
| --- | --- | --- |
| D1 — Linha Sexo, Seleção de 2 hospitais (2000083 e 2000296) | Masculino 24, Feminino 250, total 274 | igual |
| D2 — Linha "HU's MEC EBSERH" (`HUF_MEC.DBF`, nacional), Incluir | todos os HUs com 0, "Não classificados" 4.315 | igual |
| D3 — a mesma, Discriminar | uma linha por CNES, só o código, na ordem em que aparece | igual |
| D4 — Linha Hospital AC, Incluir, nenhum código fora do DBF | **sem** linha "Não classificados" | mostrava a linha com 0 → corrigido |

O D4 confirma o Help ("Se não houver, essa linha não será incluída") e o T4
acima, que também não tinha a linha: com Incluir, "Não classificados" só
aparece quando há algum.

Diferença que fica, de propósito: o `HUF_MEC.DBF` está em CP850, e o TabWin
mostra "Säo Paulo" onde o arquivo diz "São Paulo" (a conversão de acentos dele
erra o `ã`). O TabSis mostra "São". A comparação usa o código CNES do começo
do rótulo.

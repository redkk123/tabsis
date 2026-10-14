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

## SIM e SINASC com os DEF e CNV oficiais (2026-10-14)

Pacotes auxiliares oficiais `OBITOS_CID10_TAB.zip` e `NASC_NOV_TAB.zip` e
dados do Acre (`DOAC2024.dbc`, 4.267 óbitos; `DNAC2022.dbc`, 14.483 nascidos
vivos), todos de `ftp.datasus.gov.br/dissemin/publicos`. Uma varredura de todas
as variáveis dos DEFs oficiais (`scripts/varrer-def.mjs`) apontou onde a leitura antiga e a atual
divergiam; essas variáveis foram tabuladas no TabWin e salvas como `.TAB`
(`fixtures/oracle/re003-sim-sinasc`, `npm run verify:sim-sinasc -- <pasta SIM>
<pasta SINASC>`). Começou em 10/16 e terminou em **16/16**, depois de quatro
correções:

| Achado | No TabWin | Correção no TabSis |
| --- | --- | --- |
| **Código "em branco"**: `MESES.CNV` do SIM tem a linha `branco` com código `  ,`; `HORAOBITO.CNV` tem `Ign` com `    ,`; `diasINVEST1.cnv`, `Sem informação` com `   ,` | o branco vai para essa linha (3.451 em "branco" no Mês de investigação) | o leitor aparava os espaços e jogava o código fora; agora espaços antes da vírgula são o código "em branco" (vale 000, e ganha do `00-99` por vir depois) |
| **Recuo dos rótulos** (`CID10_BR.CNV`: `  001 Doencas…`, `    004.1 …`) | mostra o recuo, que é a hierarquia | o rótulo só é aparado no fim; a tabela mostra o recuo |
| **Linha-subtotal com códigos próprios** (`001-031` = `A000-B999` pega a sepse `A41`, que nenhum filho cobre) | conta no Total (4.267) | contava na linha mas não no Total (3.976); agora a linha guarda `directTotal`, somado no Total |
| **Subtotal com texto** (`E249,` no `CID10_04_ST.CNV` e outros `_ST`) | abre o arquivo | recusava o arquivo inteiro; agora a categoria fica sem subtotal, com aviso |

Confirmado também no SINASC:
- **País de residência**: `CODPAISRES` (3) com `PAIS.CNV` literal de 8 — o
  TabWin atravessa os campos e não acha nenhum país (BRASIL = 0, "Não
  classificados" = 14.483), igual ao TabSis desde a leitura atravessada;
- **Ano de recebimento** em branco → "2000" (o `00` do `ANO.CNV`);
- **Anomalia** `Q02X` → "Outras anomalias" (o `X` da 4ª posição vale 0).

E sobre o DEF:
- **`x` minúsculo** (linha 410 do `Obito_1996_CID10.def`): o TabWin lista em
  Linhas, Colunas e Seleções, como `X`; o TabSis já fazia igual.
- **`MUNICDF.CNV`** começa com um `s` solto no cabeçalho: o TabWin recusa
  ("'s' is not a valid integer value", tela 18), como o TabSis. O arquivo
  oficial está quebrado.

## SIA e SINAN (2026-10-14)

`TAB_SIA.zip` + `PAAC2501.dbc` (produção ambulatorial do Acre, jan/2025, com
`G` = quantidade aprovada) e `TAB_SINANNET.zip` + `HANSBR23.dbc`
(hanseníase, Brasil, 2023), do FTP do DATASUS. Mesma varredura, mesmo
verificador (`npm run verify:sim-sinasc -- SIM=… SINASC=… SIA=… SINAN=…`):
**26 de 27 iguais ao TabWin**, mais uma diferença conhecida e documentada.

**O DEF oficial do SIA não abria no TabSis.** A linha
`L + NOME FANTASIA , TITULO , LINHA_COMENTARIO_…` tem 3 campos; o TabSis
recusava o arquivo inteiro. O TabWin lista a opção e só reclama se alguém a
usar, lendo o 3º campo como a tabela ("Tabela de conversão não encontrada",
tela 19). Agora é igual: a opção aparece em cinza no painel, dizendo qual
tabela falta.

**Campo de data (DBF tipo D) não classificava nada.** "Ano da Alta" e "Mês da
Alta" (`DTALTA_N`, data) comparavam o texto `2024-02-20T00:00…` com a CNV. Com
a leitura de largura fixa a data vira `AAAAMMDD`, como o TabWin lê: iguais.

**CNV literal: vale a última ocorrência, não a primeira.** O `CODOCO.CNV` do
SIA (literal) repete no pai os códigos dos filhos (`1K,1R,1S` no pai, `1K` no
filho). Com "a primeira vale" (do Help), tudo ia para o pai e os filhos
ficavam com 0; o TabWin dá aos filhos. Testes T5/T6
([`ferramentas/re003-cnv-literal.py`](./ferramentas/re003-cnv-literal.py)):

| CNV | Resultado no TabWin |
| --- | --- |
| `LITDUP` (`3 2 L`): `AA` na 1ª e na 2ª linha | `AA` na 2ª |
| `LITSUB`: pai `AA,BB`, filhos `AA` e `BB` | filhos com os registros, pai com a soma |
| `LONGDUP` (`2 6`, sem L): `120040` na 1ª e na 2ª | na 2ª |
| `l` minúsculo no cabeçalho | igual ao `L` |

**Faixas no CNV literal são comparação de texto, com os espaços.** O número
N(2) vem alinhado à direita (`" 7"`, `"10"`), e o TabWin não apara o código da
CNV (T6):

| Faixa | Pega (de 0 a 20) |
| --- | --- |
| `" 7-48"` | 7 a 20 |
| `"07-48"` | 10 a 20 |
| `"7 -48"` | nada |
| `" 1- 5"` | 1 a 5 |
| `"01-05"` | nada |
| `"1 -5 "` | 10 a 20 |
| `" 7- 9"`, `" 7-15"` | 7 a 9, 7 a 15 |

E lista que começa com vírgula (`,00-99`) tem o código em branco também no
literal.

**A diferença que fica.** `nudosePB.cnv` (SINAN) é literal e tem, na mesma
linha, três faixas que se sobrepõem (`07-48,7 -48, 7-48`). Sobrepostas, o
resultado do TabWin depende da ordem (T7: `07-48` antes de `" 7-48"` deixa 8 a
20 sem classificação; na ordem inversa, tudo classifica) — efeito da estrutura
de busca dele, não uma regra documentável. O Help diz que CNV literal não
aceita faixas. Reproduzir exigiria decompilar a rotina; está marcado no
verificador como diferença conhecida (H1).

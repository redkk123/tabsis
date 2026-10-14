# Guia dos arquivos: DBC, DBF, DEF, CNV (e o Parquet do TabSis)

Para quem usa o TabWin há anos e quer saber o que mudou, e para quem nunca
abriu um DBC e quer entender o que está fazendo. Os exemplos são do SIH/RD do
Acre, janeiro de 2024 (`RDAC2401.dbc`, `RD2008.DEF`).

## Em uma frase cada

| Arquivo | O que é | Quem faz | O TabSis… |
| --- | --- | --- | --- |
| `.DBF` | A tabela de dados: uma linha por registro (internação, óbito, nascimento). | DATASUS | lê direto |
| `.DBC` | O mesmo DBF, comprimido pelo DATASUS. | DATASUS | descomprime no navegador |
| `.DEF` | O "cardápio" da tabulação: o que aparece em Linhas, Colunas, Incremento e Seleções. | DATASUS (ou você) | monta o painel a partir dele |
| `.CNV` | A tabela de conversão: código → nome, e códigos → grupos. | DATASUS (ou você) | aplica nas linhas, colunas e seleções |
| `.parquet` | O DBC convertido para um formato mais leve, por coluna. | TabSis | lê e tabula igual ao DBC |

**O nome do arquivo diz o que ele é.** `RDAC2401.dbc` = **RD** (AIH reduzida,
SIH) · **AC** (Acre) · **24** (2024) · **01** (janeiro). `DOINF23.dbc` = óbitos
infantis (SIM) de 2023. `DNBR2024.dbc` = nascidos vivos (SINASC), Brasil, 2024.
O TabSis mostra sempre o nome original do DATASUS — é por ele que as pessoas
se entendem.

## DBF — a tabela

Formato dBase, de 1980. Um cabeçalho declara os campos — nome (até 10
letras), tipo e tamanho — e depois vêm os registros, todos do mesmo tamanho.

| Tipo | Significa | Exemplo no RD |
| --- | --- | --- |
| `C` texto | código ou texto, guardado como escrito | `SEXO` = `3`, `MUNIC_RES` = `120040` |
| `N` número | com ou sem casas decimais | `VAL_TOT` = `47.27`, `MORTE` = `0` |
| `D` data | AAAAMMDD | — |
| `L` lógico | sim/não | — |

Detalhe que importa: **código é texto**. `MES_CMPT` vale `01`, não `1`; é por
isso que a CNV compara pelos caracteres.

No TabSis: botão **Ver registros do arquivo**, no painel, mostra os campos com
tipo e tamanho e as primeiras 50 linhas.

## DBC — o DBF comprimido

O DATASUS comprime o DBF com o algoritmo *PKWARE DCL Implode* e grava antes o
cabeçalho do DBF, sem compressão, e depois **4 bytes de CRC-32** do DBF inteiro.
O CRC é o que permite saber se o arquivo descomprimiu certo: a caixa **Testar
CRC** do painel (a mesma do TabWin) confere esses 4 bytes. Arquivo baixado pela
metade ou corrompido não passa.

## DEF — o cardápio da tabulação

Arquivo de texto (Windows-1252). Cada linha começa com uma letra que diz o que
ela é:

```text
;Movimento de AIH - Arquivos Reduzidos          ← 1ª linha com ";" = título da tabela
ADADOS\RD*.DBC                                  ← A: quais arquivos de dados
?\TAB\RD.HLP                                    ← ?: arquivo de ajuda
IValor Total                   ,VAL_TOT         ← I: incremento (soma este campo)
LRegião e UF internação       ,MUNIC_MOV ,1 ,CNV\br_regiaouf.cnv   ← L: aparece em Linhas
CUF internação                ,MUNIC_MOV ,1 ,CNV\br_ufsigla.cnv    ← C: em Colunas
SUF internação                ,MUNIC_MOV ,1 ,CNV\br_ufalfa.cnv     ← S: em Seleções
XMunicípio internação         ,MUNIC_MOV ,1 ,CNV\br_municip.cnv    ← X: nas três
LHospital AC (CNES),CNES      , NOMEFANT  ,DBF\TCNESAC.DBF         ← nome vem de outro DBF
```

| Letra | Vai para | Observação |
| --- | --- | --- |
| `A` | — | padrão dos arquivos (`RD*.DBC`) |
| `I` | Incremento | soma o campo; Frequência (contar registros) é sempre a primeira |
| `L` | Linhas | |
| `C` | Colunas | |
| `S` | Seleções | |
| `X` | Linhas, Colunas **e** Seleções | medido no TabWin 4.15 real (RE-002) |
| `D` / `T` | Linhas+quadro / Linhas+Colunas+quadro | herança do TABDOS |
| `G` | — | cada registro vale o número deste campo, não 1 |
| `?` | — | ajuda do botão "Ajuda" |
| `;` ou espaço | — | comentário |

Os campos depois da letra: **nome na tela, campo do DBF, posição inicial,
CNV**. A posição inicial permite usar parte do campo: `DT_INTER,5,MESES.CNV`
pega o mês de uma data AAAAMMDD.

No TabSis: o **Painel de tabulação** é montado do DEF, com os nomes exatamente
como estão escritos e na ordem do arquivo. Opção cuja CNV não foi carregada
aparece em cinza dizendo qual arquivo falta.

## CNV — a tabela de conversão

```text
3 1                                                  ← 3 categorias, código de 1 posição
      3  Ignorado                                           0-9
      1  Masculino                                          1
      2  Feminino                                           2,3
```

Colunas fixas: **4–7** número da categoria (que também é a ordem na tabela),
**10–59** nome, **61 em diante** códigos (`01,03` lista; `10-19` faixa).

Regras que pegam gente experiente:

- **Quem vem depois ganha.** Acima, `1` cai primeiro em "Ignorado" (0-9) e
  depois em "Masculino"; vale Masculino. É assim que se faz "o resto é
  Ignorado".
- **Subtotal:** número nas colunas 1–3 aponta a linha que soma esta. "Região
  Norte" soma as UFs dela; o Total não conta duas vezes.
- **`L` no cabeçalho** (`5 2 L`): código tratado como texto (siglas de UF).
  Códigos com mais de 4 posições já são tratados assim.
- **Código curto (até 4 posições, sem `L`) vira número.** Na 1ª posição,
  letra vale a posição no alfabeto (`A` = 1 … `Z` = 26); nas outras, o que
  não for dígito vale 0. Então `A01` e `101` são o mesmo código, e **campo em
  branco é `000`** (cai em "Ignorado" se a CNV tiver `00`). O Help antigo diz
  "A a J valem 0 a 9"; o programa real faz assim — medido em
  [RE-003](../reverse-engineering/RE_003_CNV_CODIGO_CURTO.md).
- **`F` / `Faixas`** (`6 14 Faixas`): os códigos são limites superiores de
  faixas de valor (`99.99`, `499.99`…), para variáveis contínuas.
- **Código em branco:** espaços antes da vírgula (`  ,`) são o código do
  campo em branco — é assim que `MESES.CNV` do SIM tem a linha "branco".
- **Recuo:** espaços no começo do nome mostram a hierarquia (`  001 …` dentro
  de `001-031 …`); o TabSis mantém, como o TabWin.
- **Não classificados:** código que nenhuma linha da CNV cobre. No painel:
  - *Ignorar* — o registro sai da tabela;
  - *Incluir* — entra numa linha "Não classificados";
  - *Discriminar* — cada código vira uma linha com o próprio código, **só em
    CNV literal** (`L` ou código longo); em CNV curta age como Ignorar. É o que
    o TabWin faz (decompilado e conferido, RE-002).

## Parquet — o formato leve do TabSis

O DBC comprime o arquivo inteiro de uma vez: para tabular um campo é preciso
descomprimir e ler todos os outros. O Parquet guarda **cada coluna separada e
comprimida**:

| Arquivo | DBC | Parquet | |
| --- | ---: | ---: | ---: |
| RDAC2401 (4.315 registros) | 306 KB | 175 KB | 57% |
| DOINF23 (32.017) | 3,4 MB | 1,6 MB | 47% |
| DENGBR25 (1.643.215) | 64,7 MB | 31,5 MB | 49% |

E a tabela sai **igual**: o conversor grava cada valor com o tipo que o leitor
de DBF produz, leva dentro o cabeçalho do DBF e o SHA-256 do DBC de origem, e
um verificador compara registro a registro (os três arquivos acima: idênticos).
Detalhes em [FORMATO_LEVE_PARQUET.md](./FORMATO_LEVE_PARQUET.md).

O Parquet também abre no R (`arrow::read_parquet`), no Python
(`pandas.read_parquet`) e no DuckDB, o que o DBC não faz sem pacote especial.

## O log do TabWin (a "receita")

Toda tabulação gera um log como este, igual ao da janela "Log" do TabWin e ao
topo de um `.TAB`:

```text
[Opções]
Linha=Sexo
Coluna=Caráter atendimento
Incremento=Freqüência
Suprime_Linhas_Zeradas=false
Suprime_Colunas_Zeradas=true
Não_Classificados=0
[Seleções_Ativas]
UF internação: Acre
[Arquivos]
RDAC2401.dbc
```

No painel, em **Log do TabWin**: copiar, colar um log antigo ou abrir um
`.TAB`, e **Restaurar consulta** para remontar a tabulação.

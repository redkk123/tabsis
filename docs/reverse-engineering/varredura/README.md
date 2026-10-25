# Varredura TabSis × TabWin

Cada variável de Linha de um DEF oficial é tabulada no **TabWin 4.15 real**
(Wine, tela virtual) e no **TabSis**, e as duas tabelas são comparadas linha a
linha — rótulo, valor e Total. É a conferência ampla que faltava: até aqui, ~100
tabelas tinham sido conferidas à mão.

## Como roda

1. `ferramentas/abrir_tabwin.sh <pasta>` reabre o TabWin com a pasta de dados
   (G001, SIM, NASC, SINAN…) no `TabWin.ini`.
2. `ferramentas/varrer_tabwin.py <DEF> <dados> <prefixo>`: para cada linha `L`
   do DEF cujo recurso (CNV/DBF) existe na pasta, escreve um DEF de uma
   variável só (`AAAnnn.DEF`), abre no TabWin, executa e salva
   `C:\TabWin\saida\<prefixo><nnn>.tab`. Truques que o robô precisa:
   - o seletor de DEF não relê a pasta: entrar e sair de uma subpasta força a
     releitura;
   - o TabWin guarda o DEF aberto pelo nome: um nome novo por variável;
   - com tabela aberta, ele pergunta "Salvar Tabela Atual?": a barra azul da
     pergunta é detectada por um pixel (`pixel.py`) e o robô responde Não;
   - a tabela salva é conferida (`Linha=`), para não aceitar a anterior.
3. `scripts/comparar-varredura.mjs <prefixo>.jsonl <saida> <pasta> <dados> <relatorio.md>`
   monta a mesma consulta pelo painel do TabSis e compara.

Padrões do painel nas duas pontas: Frequência, sem Colunas, não suprime linhas
zeradas, suprime colunas zeradas, Não classificados = Ignorar.

## Resultados

| DEF | Dados | Variáveis | Iguais | Relatório |
| --- | --- | ---: | ---: | --- |
| SIH `RD2008.DEF` | `RDAC2401.dbc` (4.315 AIH) | 116 | **116** | [SIH_RD2008.md](./SIH_RD2008.md) |
| SIM `Obito_1996_CID10.def` | `DOAC2024.dbc` (óbitos do Acre, 2024) | 335 (+3 que o próprio TabWin recusa) | **335** | [SIM_Obito_1996_CID10.md](./SIM_Obito_1996_CID10.md) |
| SINASC `NASCIDO.def` | `DNAC2022.dbc` (nascidos vivos do Acre, 2022) | 241 (+11 que o TabWin recusa) | **241** | [SINASC_NASCIDO.md](./SINASC_NASCIDO.md) |
| SINAN `HansNET.def` | `HANSBR23.dbc` (hanseníase, Brasil, 2023) | 39 (+2 que o TabWin recusa) | **39** | [SINAN_HansNET.md](./SINAN_HansNET.md) |
| SIA `Producao_Ambulatorial.DEF` | `PAAC2501.dbc` (154.136 procedimentos) | 65 (+2) | **65** | [SIA_Producao_Ambulatorial.md](./SIA_Producao_Ambulatorial.md) |
| CNES `Estabelecimento.def` | `STAC2501.dbc` | 29 (+2 linhas-título) | **29** | [CNES_Estabelecimento.md](./CNES_Estabelecimento.md) |
| CNES `Leitos_Especialidade.def` | `LTAC2501.dbc` | 15 | **15** | [CNES_Leitos.md](./CNES_Leitos.md) |
| **Total** | | **840** | **840** | |

## O que a varredura achou (e foi corrigido)

- **Número de categoria repetido na CNV** (`CID10GRUPO.CNV` repete 24, 25 e
  26): o TabWin usa o **último** rótulo e subtotal e **soma** os códigos das
  duas linhas; o TabSis usava o primeiro rótulo e o primeiro pai — "Neoplasias
  malignas de localizações especificadas" dava 114 em vez de 50.
- **Números que o cabeçalho conta e nenhuma linha define** viram linhas em
  branco no TabWin (276 no cabeçalho, 261 definidas): o TabSis agora também.
- **Aspas dentro do rótulo** (`"In Natura"` na `CNAE.CNV`): o TabWin as tira
  ao salvar o `.tab`; o TabSis trocava por apóstrofo.
- **Linha que é subtotal dela mesma** (`CID10_01_ST.CNV`, `CID10_09_ST.CNV`,
  `CID10_12_ST.CNV` do SIM: "0455 0455"): o TabSis recusava a tabela ("ciclo
  de subtotal"); o TabWin tabula, e a linha soma os filhos e depois a si mesma
  — dobra (B190 = 2 e B199 = 1 dão 6 na linha "0537 0537"). O TabSis agora faz
  igual, e um ciclo maior não derruba mais a tabela.
- **Nome da variável com no máximo 30 caracteres** ("Região de Saúde (CIR) de
  Resid.", 31, vira "…de Resid"; confirmado com nomes de 29, 31 e 40): o TabSis
  agora corta igual (painel, título e `.tab`).
- **Tabelas DBF (SIA)**, quatro regras que o TabSis não tinha:
  - sem campo com o nome do campo dos dados, a chave é o **primeiro campo** do
    DBF (`PA_CNPJ_CC` em `S_FORNEC.DBF` casa pelo `FOR_CNPJ`) — o TabSis recusava;
  - o valor casa pelo **começo, do tamanho da chave**: procedimento de 10
    dígitos no grupo `03`, subgrupo `0301`, forma `030101` — o TabSis dava zero;
  - nome de campo **sem diferença de maiúsculas** (`ds_cbo`) — a CBO saía sem nome;
  - DEF que **repete o par rótulo/DBF** (`CD_DESCR, DBF\S_CID.DBF, CD_DESCR,
    DBF\S_CID.DBF`) agrupa pelo rótulo e mostra só ele: 14.705 códigos da CID
    viram 14.257 linhas, como no TabWin;
  - registro com quebra de linha dentro do nome (`TB_GRUPO.DBF`, grupo 09)
    fica de fora, como no TabWin.
- Onde o TabSis é **mais certo** que o TabWin (não muda contagem): acentos de
  DBF em CP850 ou UTF-8, que o TabWin mostra quebrados ("IMPORTAÃÃO",
  "SÝndrome"), e CNVs com tabulação no meio do nome (`CIRBR.cnv` do SINASC),
  que o TabWin recusa e o TabSis lê.
- O que o próprio TabWin recusa: `MUNICDF.CNV`
  ("'s' is not a valid integer value"), campo que não existe no arquivo
  (`CODINST` no SIM, `NUMERODN` no SINASC disseminado: "Tabulação cancelada").

## Parte 2 — Colunas, vários Incrementos e Seleções (2026-10-24)

A parte 1 só tabulava Linhas com Frequência. A parte 2 sorteia **combinações**
de cada DEF e compara o `.tab` inteiro — título, log (Linha, Coluna,
Incremento, `[Seleções_Ativas]`) e cada célula, com a coluna e a linha Total.

### Como roda

1. `scripts/gerar-combos-varredura.mjs <pasta> <DEF> <dados> <n> <combos.json>`
   sorteia (semente fixa) uma Linha, às vezes uma Coluna, 0–3 Incrementos (só
   um com Coluna: o TabWin recusa "Múltiplas colunas é incompatível com
   múltiplos incrementos") e às vezes uma Seleção. Para a Seleção não zerar a
   tabela, escolhe categorias com registro entre as 7 primeiras da lista (as
   que cabem na tela do painel); de vez em quando, de propósito, uma vazia.
   Quem calcula os números é o TabWin; o TabSis só escolhe o que marcar.
2. `ferramentas/varrer_combos.py <combos.json> <dados> <prefixo>` escreve um DEF
   só com aquelas linhas (uma entrada por lista do painel), marca Coluna,
   Incrementos (Ctrl+clique) e a Seleção (Incluir + categorias), executa e
   salva. `ferramentas/cadeia_combos.sh` roda as bases uma depois da outra.
3. `scripts/comparar-combos.mjs <prefixo>.jsonl <saida> <pasta> <dados>` monta
   o mesmo painel no TabSis, grava o `.tab` pelo exportador do aplicativo e
   compara os dois arquivos.

### Resultados

| Base | Combinações tabuladas | Com Coluna | 2+ Incrementos | Com Seleção | Iguais |
| --- | ---: | ---: | ---: | ---: | ---: |
| SIH `RD2008.DEF` | 57 de 60 | 23 | 22 | 28 | **57** ([SIH_combinacoes.md](./SIH_combinacoes.md)) |
| SIM `Obito_1996_CID10.def` | 49 de 50 | 23 | — (o DEF não tem incremento) | 25 | **49** ([SIM_combinacoes.md](./SIM_combinacoes.md)) |
| SINASC `NASCIDO.def` | 48 de 50 | 27 | — (idem) | 22 | **48** ([SINASC_combinacoes.md](./SINASC_combinacoes.md)) |
| SINAN `HansNET.def` | 40 de 40 | 22 | 11 | 22 | **40** ([SINAN_combinacoes.md](./SINAN_combinacoes.md)) |
| SIA `Producao_Ambulatorial.DEF` | 40 de 40 | 23 | 9 | 18 | **40** ([SIA_combinacoes.md](./SIA_combinacoes.md)) |
| CNES `Estabelecimento.def` | 30 de 30 | 16 | 11 | 15 | **30** ([CNES_combinacoes.md](./CNES_combinacoes.md)) |
| **Total** | **264 de 270** | 134 | 53 | 130 | **264** |

As 6 sem tabela: o TabWin demorou mais de 5 minutos (seleção numa CID grande)
ou recusou a tabulação (CNV de CIR com tabulação no meio do nome, já conhecida
da parte 1). Mais **32 sondas** feitas à mão para isolar cada regra abaixo
(`SONDA`–`SONDF`, `LARG`), todas iguais.

### O que a parte 2 achou (e foi corrigido)

- **Nenhuma coluna com valor** (Seleção que não pega nada, ou Coluna só com não
  classificados): o TabWin não deixa a tabela sem colunas — põe uma coluna
  **DUMMY** zerada e escreve `NENHUM REGISTRO SELECIONADO` entre o log e a
  matriz. O TabSis devolvia zero colunas. Sem Coluna, nada disso acontece.
- **Total de cada coluna deslocado** quando colunas zeradas eram suprimidas e a
  Linha tinha subtotais com valor direto (CID10 cap 19S × Idade detalhada, sem
  a coluna "7 anos"): o total direto das linhas-subtotal não era filtrado junto.
- **`[Seleções_Ativas]` com várias categorias**: juntas por `|`, e a linha quebra
  antes de chegar a 80 caracteres — a categoria seguinte abre uma linha recuada
  com 4 espaços, sem o `|`; vale até para a primeira (se `Nome: categoria`
  passar de 79, fica só `Nome:`). Medido: 79 cabe, 80 quebra. O TabSis juntava
  tudo numa linha.
- **Seleção com CNV de faixas numéricas** (`PERM.CNV`, "F"): na Linha o TabWin
  classifica o valor; na Seleção ele lê o **texto do registro** a partir do
  índice igual à posição do DEF (contado do zero: um caractere adiante) e entra
  no campo seguinte. Com `DIAS_PERM` posição 2 lê `"  0"` + `MORTE`: os 6 óbitos
  com 0 dia caem em "1 dia", e quem ficou 1 dia vira "10" (8–14 dias). Posição 1
  dá o próprio valor. CNV literal em campo numérico não muda (IDADE posição 2).
- **Campo do DEF com outra caixa** (`CODMUNres`, `seriescmae` no SIM): o TabWin
  acha o campo; o TabSis zerava a Linha e a Seleção.
- **Nome do Incremento também com no máximo 30 caracteres**
  ("Qt.Leito Repouso/Obs.Indiferen." vira "…Indiferen").
- **CNV literal com código `" -9"`** (uma coluna adiante, `ORGEXPED.CNV` e
  `CLASAVAL.CNV` do CNES): o TabWin lê como **faixa do branco até "9"**, que
  pega os campos em branco — a linha/coluna "não informado" (1.064
  estabelecimentos); o TabSis descartava o código. A faixa para no primeiro
  código já definido antes dela (o modelo de tabela ordenada que o TabSis já
  tinha reproduz isso; sondas com CNVs de teste confirmaram as quatro ordens).

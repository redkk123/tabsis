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

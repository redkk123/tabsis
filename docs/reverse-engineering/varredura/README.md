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

## O que a varredura achou (e foi corrigido)

- **Número de categoria repetido na CNV** (`CID10GRUPO.CNV` repete 24, 25 e
  26): o TabWin usa o **último** rótulo e subtotal e **soma** os códigos das
  duas linhas; o TabSis usava o primeiro rótulo e o primeiro pai — "Neoplasias
  malignas de localizações especificadas" dava 114 em vez de 50.
- **Números que o cabeçalho conta e nenhuma linha define** viram linhas em
  branco no TabWin (276 no cabeçalho, 261 definidas): o TabSis agora também.
- **Aspas dentro do rótulo** (`"In Natura"` na `CNAE.CNV`): o TabWin as tira
  ao salvar o `.tab`; o TabSis trocava por apóstrofo.
- Observado, sem mudar contagem: o TabWin tira o ponto final do nome da
  variável ("…de Resid." → "…de Resid").

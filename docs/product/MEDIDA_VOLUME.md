# Medida de volume — vários anos juntos (2026-10-23)

Pergunta: o TabSis aguenta vários anos de um arquivo grande abertos ao mesmo
tempo, no navegador, com o mapa no tempo?

## Como foi medido

- `scripts/gerar-dbf-sintetico.py`: 5 arquivos `DENGBR20.dbf` … `DENGBR24.dbf`,
  **1,5 milhão de registros cada (7,5 milhões no total)**, 192 MB cada
  (960 MB juntos), com os campos da notificação do SINAN (município de
  residência com códigos reais do IBGE, data de notificação, semana, sexo,
  idade, raça, classificação, evolução) e um enchimento até 128 bytes por
  registro. Dados inventados: servem para medir tempo e memória.
- `e2e/volume.spec.ts` (só roda com `TABSIS_VOLUME_DIR=<pasta>`), Chromium sem
  tela do Playwright, máquina de 8 núcleos e 11 GB de RAM. Memória = soma do RSS
  dos processos do navegador de teste.

## Resultado

| Passo | Tempo | Memória do navegador |
| --- | ---: | ---: |
| Página aberta | 0,4 s | 570 MB |
| Abrir os 5 arquivos num gesto, juntar e 1ª tabela | 32,4 s | 1.692 MB |
| Tabela Linhas = Ano (5 leituras, uma por arquivo) | 3,6 s | 1.722 MB |
| Tabela Sexo × Mês de notificação | 9,2 s | 1.800 MB |
| Mapa do Brasil por estado | 0,1 s | 1.811 MB |
| Mapa: os 5 anos lidos para o controle Período | 6,5 s | 1.893 MB |
| Mapa: os meses de notificação (uma leitura cruzada) | 10,7 s | 1.926 MB |
| Mapa: foco em São Paulo | 0,1 s | 1.952 MB |

## Com dados reais (2026-10-23, download autorizado pelo Red)

Dengue nacional do SINAN (`SINAN/DADOS/FINAIS`, mais de 100 campos por
registro), arquivos DBC originais, mesma máquina:

| Conjunto | Registros | Abrir e juntar + 1ª tabela | Linhas = Ano | Sexo × Mês | Mapa por ano | Mapa por mês | Memória máx. |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DENGBR22 + 23 + 25 (190 MB de DBC) | 4.694.266 | 26,5 s | 15,4 s | 14,3 s | 9,1 s | 15,4 s | 1.121 MB |
| DENGBR23 + 24 (346 MB de DBC; 2024 é o maior ano) | 8.210.880 | 49,8 s | 25,7 s | 25,2 s | 14,2 s | 25,7 s | 1.312 MB |

O DBC fica guardado comprimido e é lido em lotes a cada pergunta, por isso a
memória cresce bem menos que o número de registros. O maior ano de dengue
(274 MB de DBC, 6,6 milhões de registros) abre dentro do limite de 512 MB por
arquivo, que vale para o DBC, não para o DBF descomprimido.

**População real do IBGE** (`IBGE/POPTCU/POPTBR23.zip` e
`IBGE/POPSVS/POPSBR23.zip`): o TabSis achou sozinho as colunas nos dois
formatos — `MUNIC_RES`/`POPULACAO`/`ANO` (TCU, 5.570 linhas) e
`COD_MUN`/`POP`/`ANO` (SVS por sexo e idade, 902.340 linhas somadas por
município). Dengue 2023 por UF: de 37 a 3.572 notificações por 100 mil
habitantes.

**Defeitos achados com os dados reais, corrigidos:**

- A primeira tabela automática do SINAN era por `MUNICIPIO`, que no SINAN é o
  município do **hospital**; o mapa seguia essa tabela e mostrava só as
  internações (MG com 7.760 em vez de 406.525), sem dizer. Agora a primeira
  tabela começa pelo município de residência, e o mapa sempre diz qual
  variável da tabela está pintando.
- A população do SVS (902 mil linhas) passava do limite de leitura de 500 mil
  e vinha em `.zip`: agora lê tudo e aceita o `.zip` do DATASUS.

## Defeito achado e corrigido nesta medida

Com arquivos grandes, abrir vários de uma vez recusava o 2º arquivo ("Outra
leitura DBC/DBF ainda está em andamento"): as leituras de fundo do 1º (mapa,
datas) ainda estavam rodando. Com os arquivos pequenos dos testes elas
terminam antes, e o defeito não aparecia. Agora o arquivo seguinte espera a
leitura em andamento, e as leituras de fundo ficam para depois do último
arquivo do gesto.

## O que esta medida não diz

- **Arquivo real é mais largo.** A notificação real do SINAN tem mais de 100
  campos (registros de 500 a 700 bytes, não 128). O TabSis só decodifica os
  campos que cada pergunta usa, então o tempo cresce menos que o tamanho, mas a
  memória dos arquivos guardados cresce junto com eles.
- **DBC custa a descompressão**, que estes DBF não pagam.
- **Limite por arquivo: 512 MB de DBC.** O maior ano de dengue (2024) tem
  274 MB e cabe; um arquivo maior pede o recorte por UF no catálogo, ou o
  Parquet leve.
- Feito com dados reais: ver a seção acima.

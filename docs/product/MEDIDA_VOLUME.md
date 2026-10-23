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
- **Limite por arquivo: 512 MB.** Um arquivo nacional de um ano muito grande
  (dengue de 2024, por exemplo) pode passar disso; aí o caminho é o recorte por
  UF no próprio catálogo, ou o Parquet leve.
- Próximo passo, com autorização para baixar: repetir com 3 a 5 anos reais de
  um agravo nacional do SINAN.

# Plano — Laboratório e microdados sem código

Data: 2026-10-27. Status: proposta para discussão. Implementado até agora: itens 1 e 2 dos pedidos abaixo, e o começo do 3 (aba Microdados com definição de caso por códigos).

## Onde estamos

**No TabSis** já existe boa parte de um "low code" para microdados, mas cada
peça está numa aba diferente e só uma parte é visual:

| O que existe | Onde | Limite hoje |
| --- | --- | --- |
| Transformar dados: filtrar linhas, recodificar, derivar coluna, escolher colunas, juntar com outro arquivo, deduplicar, agrupar e resumir, texto (maiúsculas, recorte, preencher), código IBGE | barra lateral, "Transformar dados" | uma lista de etapas em formulário; não mostra o efeito de cada etapa nos dados |
| "Ver código equivalente" (R e Python) | dentro de Transformar dados | só mostra o código; não leva ao Lab |
| Painel do TabWin (Linhas, Colunas, Incremento, Seleções), igual ao TabWin: 840/840 variáveis e 264/264 combinações conferidas | área principal | — |
| Estatística (descritivas, correlação, regressão, padronização de taxas), Investigar (anomalias), Comparar tabelas, Consulta SQL (DuckDB) | abas do resultado | cada uma é uma tela isolada; o resultado não vira etapa reaproveitável |
| Taxa por 100 mil com população do IBGE, mapa por município/região de saúde, séries por ano/mês/semana | Mapa | — |
| Pacote para o Lab (`dados.csv` + `PROVENIENCIA.json`) | exportação | leva a **tabela**, não os microdados |

**No Laboratório** (`tabweb.me/lab`, repositório `tabwin-lab`):

- cadernos `.twlab` com células de Python (Pyodide) e R (webR), executados no navegador;
- execução canônica (reinicia e roda tudo em ordem) com registro de procedência;
- dados locais limitados a 32 MB por arquivo e 64 MB por sessão;
- abre o pacote do TabSis.

**O que falta, em uma frase:** dá para fazer quase tudo, mas é preciso saber
onde fica cada coisa, e o caminho de "abri um DBC" até "tenho um gráfico,
uma taxa e um código que reproduz isso" passa por quatro telas e um arquivo
exportado à mão.

## Objetivo

Quem não programa consegue ir do microdado à análise publicável sem
escrever código. Quem programa recebe, de graça, o código equivalente em
R/Python no Lab. As duas pessoas chegam ao mesmo número, conferível.

## Princípios (valem para todas as fases)

1. **O número do TabSis não muda de lugar.** Toda etapa visual compila para
   o mesmo motor que hoje bate com o TabWin; o low code é uma interface, não
   um segundo motor.
2. **Cada etapa mostra o efeito.** Contagem de linhas antes e depois e uma
   amostra de 10 registros, como uma planilha: quem não programa confere
   olhando.
3. **Código equivalente sempre.** Cada receita gera R e Python. Um teste
   automático roda esse código no Lab e confere que o resultado é o mesmo
   (hoje o código só é mostrado; ninguém confere que roda).
4. **Procedência de ponta a ponta:** arquivo do DATASUS (hash), etapas,
   versão do TabSis.
5. **Os dados não saem do aparelho.** O Lab continua no navegador; o TabSis
   Local entra quando o volume não cabe.

## Pedidos do Red (2026-10-27), nesta ordem

1. **Liberdade para usar o Python do Lab com os dados do TabSis.** FEITO:
   o botão "Abrir no Python" (grupo Exportar) abre o Lab numa aba nova com os
   microdados da tabela atual (Seleções e transformações já aplicadas) em
   `/data` e um caderno pronto: carrega com pandas, refaz a tabela e lista as
   transformações em Python como comentário. O caderno anterior vai para a
   recuperação. Limite: 32 MB (o do Lab); acima disso, a mensagem sugere
   Seleções ou o item 2. Conferido no Pyodide de verdade: o `groupby` dá os
   mesmos números da tabela.
2. **Liberdade para baixar o Python e rodar no computador**, em Windows, Linux
   e macOS, **sem atrito de código e sem npm**. FEITO: "Rodar no computador"
   baixa um `.zip` com `dados/`, `analise.py`, `analise.ipynb`,
   `requirements.txt` e um arquivo de dois cliques por sistema
   (`Rodar no Windows.bat`, `Rodar no Mac.command`, `rodar-linux.sh`). O
   arquivo acha um Python 3.9+ e chama `preparar_e_rodar.py`, que cria um
   `.venv` só da pasta, instala os pacotes uma vez e roda a análise. Sem
   Python, abre o python.org. Limite de 512 MB. Conferido no Linux (a análise
   dá os mesmos números da tabela). Windows e macOS: só revisão do script,
   falta testar numa máquina real. Possível próximo passo, se o Python
   instalado à parte atrapalhar: o TabSis Local com Python embutido.
3. **Separar o laboratório de microdados do laboratório de código.**
   - Microdados: low code, sem escrever nada (as receitas da Fase 1).
   - Código: o Lab atual.
   - Caso real que motivou: a pesquisa de doença de Chagas precisou baixar só
     o CID B57. O SINAN não tem agravo próprio para Chagas crônica, só
     "tripanossomíase", que inclui a doença do sono (B56). O laboratório de
     microdados precisa permitir escolher CIDs à mão (lista ou faixa, por
     exemplo B57.0–B57.5 sem B56) sobre SIM, SIH e SINAN, e salvar essa
     definição de caso como receita reaproveitável.
   - COMEÇADO (decisão do Red: aba "Microdados" dentro do TabSis): a aba já
     tem a definição de caso por códigos. Prefixo, faixa, excluir por cima,
     prévia por código e aviso de código que não aparece. O resultado vira uma
     Seleção comum, e as definições ficam guardadas no navegador.
   - FEITO (2026-10-27): a Seleção guarda a regra (filtro `code-rules` no
     motor, com o código R/Python equivalente), e não a lista de códigos que
     apareceram; vai na receita `.twrecipe` e reabre com outros anos. Uma
     regra por campo. Atalhos: RIDE-DF (LC 163/2018) e faixa etária no código
     do SINAN. Município → UF, região e macrorregião de saúde já existiam como
     CNV (`public/cnv`).
   - Falta: "caso novo/confirmado" por agravo. Ficou de fora de propósito: é
     definição clínica, e o motor não embute significado clínico. Ela segue
     pelas Seleções comuns (no caso da LTA, `CLA_TIPO_N = 1` e
     `EVOLUCAO ≠ 6`). Um modelo pronto, com a fonte citada, entra na Fase 3
     (cadernos-modelo).

## Fases

### Fase 1 — "Receitas" visuais para microdados (TabSis)

Transformar a lista de etapas atual numa receita visual.

- Cada etapa num cartão com: o que faz em português ("manter só residentes no
  DF"), linhas antes → depois, amostra dos registros. Cartões arrastáveis;
  desligar uma etapa mostra o efeito na hora.
- **Etapas prontas para a saúde**, montadas em cima das que já existem:
  - faixa etária a partir de `NU_IDADE_N` / `IDADEMAE` (com os códigos de
    unidade do DATASUS);
  - "caso novo / confirmado" por agravo (as regras dos cadernos de análise
    do Ministério, como a da LTA usada no resumo de 2016–2025);
  - município de residência → UF / região de saúde / macrorregião / RIDE
    (as tabelas oficiais já estão em `public/cnv`);
  - datas → ano, mês, semana epidemiológica;
  - juntar anos com campos diferentes (já resolvido no conjunto aberto).
- A receita salva em `.twrecipe` (o formato já existe) e reabre com outros anos.
- **Medida de sucesso:** refazer, só com cliques, a análise do resumo de LTA
  (casos novos da forma cutânea 2016–2025, DF e Entorno × Brasil, sexo, faixa
  etária, raça/cor). Ela deve dar os mesmos números que o script Python de
  `resumo-leishmaniose` (131.581 no Brasil; 1.246 no DF e Entorno; 265 no DF;
  981 no Entorno). Uma pessoa de fora do projeto refaz em até 15 minutos com o
  manual.
- **Andamento (2026-10-28):** primeira parte feita. A aba Microdados abre com
  a **receita**: cada Seleção vira um cartão em português, com quantos
  registros sobram depois dele, e dá para desligar (sem perder), reordenar e
  remover. Etapas prontas com a fonte citada: *Caso novo (LTA)* (Caderno de
  Indicadores LT/LV, MS 2018, indicador 1), *Forma cutânea/mucosa*, *DF e
  Entorno (RIDE-DF)*. Conferido com os 10 arquivos reais: 153.302 notificações
  → 131.581 casos novos cutâneos → 1.246 no DF e Entorno, iguais ao script.
  Para isso, juntar anos passou a aceitar campos que mudaram de tipo (o
  LTANBR25 mudou quatro campos administrativos): entram como texto, com aviso.
  Depois (mesmo dia): amostra de registros por etapa ("ver registros", com o
  campo da etapa em destaque), etapas de idade (SINAN) e de período (ano de
  qualquer data do arquivo), arrastar os cartões para reordenar (setas no
  celular), receita salva com as etapas desligadas, e o roteiro de 15 minutos
  no manual. **Fase 1 concluída.** Próxima: Fase 3 (cadernos-modelo), a pedido
  do Red; a Fase 2 (ponte com o Lab) entra quando os cadernos precisarem.

### Fase 2 — Ponte de verdade com o Laboratório

- "Abrir no Lab" (botão) leva **a receita + os microdados filtrados**, e não só
  a tabela, para um caderno novo com:
  - uma célula que carrega os dados;
  - uma célula com o código equivalente da receita (R ou Python, à escolha);
  - uma célula com a tabela do TabSis, para comparar.
- Primeira célula do caderno confere sozinha: "a sua receita em Python dá
  o mesmo que o TabSis" (verde/vermelho).
- **Limites de volume:**
  - até 64 MB, os dados vão pela memória;
  - acima disso, Parquet (só as colunas usadas; o formato leve já existe);
  - acima do que o navegador aguenta, o TabSis Local entrega os arquivos da
    pasta para o Lab, como já faz para o site.
- **Medida de sucesso:** 20 receitas de exemplo, uma por sistema e agravo
  frequente. O código gerado roda no Lab e bate com o TabSis em todas
  (teste automático, como a varredura do TabWin).

### Fase 3 — Modelos de análise prontos ("cadernos-modelo")

Cadernos que a pessoa só preenche (agravo, local, período):

| Modelo | O que entrega |
| --- | --- |
| Série temporal e tendência | coeficiente por ano, variação anual (Prais-Winsten, que o resumo de LTA deixou como pendência), gráfico |
| Perfil epidemiológico | tabela 1 (sexo, idade, raça/cor, escolaridade) com teste de comparação contra o Brasil |
| Mapa e conglomerados | coeficiente por município, suavização bayesiana empírica, Moran global e local |
| Comparação de regiões | razão de taxas padronizadas por idade, com intervalo de confiança |
| Qualidade do dado | completude por campo e por ano (o que o resumo chamou de "sem evolução registrada") |

Cada modelo sai com o texto da metodologia já escrito (fonte, definição de
caso, população, método), em português, para colar em resumo ou artigo — o
que hoje foi feito à mão no resumo do CONBRASP.

- **Medida de sucesso:** o modelo "série temporal + perfil" refaz os números
  do resumo de LTA e gera um parágrafo de Metodologia equivalente ao entregue.
- **Andamento (2026-10-28), em R (decisão do Red):** o primeiro modelo,
  **série temporal + perfil**, está feito. Na aba Microdados, "Caderno em R:
  série e perfil" manda ao Laboratório (webR) três CSV pequenos — casos por ano
  e município, população do IBGE por ano e município, contagens do perfil — e
  um caderno de 6 células só com R base (roda também no RStudio): coeficiente
  por ano e médio, VPA por mínimos quadrados e por Prais-Winsten (IC95%),
  série em texto, tabela 1 com qui-quadrado (região × restante do Brasil) e
  os parágrafos de Metodologia e Resultados. A receita é a definição de caso;
  a etapa de município de residência vira a região. **Medida de sucesso
  batida** com os 10 arquivos reais: Brasil 131.581 (6,30), DF e Entorno 1.246
  (2,70), VPA por mínimos quadrados −5,1% (−8,8 a −1,3) e 0,1% (−9,9 a 11,3),
  iguais ao resumo; Prais-Winsten −5,0% (−9,0 a −0,8) e 0,1% (−10,9 a 12,5).
  No caminho, corrigido no Lab (tabwin-lab#2): a saída do R perdia as quebras
  de linha.
- **Depois (mesmo dia):** **qualidade do dado** (completude por campo e ano,
  escala de Romero & Cunha; uma passada pelo arquivo no worker) e **mapa e
  conglomerados** (Bayes empírico global, Moran global e LISA com 999
  permutações; vizinhança por fronteira tirada do br_municip.MAP). Conferidos
  com a LTA real. Falta **comparação de regiões** (razão padronizada por
  idade): precisa da população por faixa etária e município, que a API de
  agregados do IBGE tem só no Censo; fica para quando houver essa fonte.

### Fase 4 — Compartilhar e reproduzir

- Pacote de análise: receita + caderno + procedência + versão. Quem recebe,
  abre e chega no mesmo número (hash dos arquivos do DATASUS conferido; se o
  DATASUS republicou o arquivo, isso é dito).
- Opcional: publicar a análise como página (sem os microdados), para anexar a
  um trabalho.

## Ordem sugerida e tamanho

| Fase | Tamanho | Depende de |
| --- | --- | --- |
| 1. Receitas visuais | 2 a 3 semanas | — |
| 2. Ponte com o Lab | 2 semanas | 1 |
| 3. Cadernos-modelo | 1 semana por modelo | 2 |
| 4. Compartilhar | 1 semana | 2 |

Começar pela **Fase 1 com a análise de LTA como caso-guia**: ela já tem os
números conferidos por dois leitores independentes, então serve de gabarito.

## Riscos

- **Dois motores divergindo:** a receita visual e o código R/Python podem dar
  números diferentes sem ninguém ver. É por isso que o teste automático da
  Fase 2 vem antes dos modelos.
- **Volume no navegador:** Pyodide/webR têm memória limitada. O caminho de
  Parquet e do TabSis Local precisa estar pronto antes de prometer "qualquer
  arquivo".
- **Estatística mal usada:** modelos prontos facilitam conclusões erradas.
  Cada modelo diz o que ele não mede, por exemplo "tendência não
  significativa não é ausência de tendência".
- **Repositório do Lab separado:** a ponte da Fase 2 é um formato documentado
  (como o pacote atual), não importação de código entre os repositórios.

## Decisões que precisam de você

1. Começar pela Fase 1 (TabSis) ou pela Fase 3 (modelos no Lab, que dá
   resultado visível mais rápido para os trabalhos acadêmicos)?
2. Linguagem padrão dos cadernos-modelo: R (mais comum na epidemiologia) ou
   Python?
3. Quais agravos e sistemas entram primeiro nas receitas prontas? Sugestão:
   LTA, dengue, SINASC e SIM.

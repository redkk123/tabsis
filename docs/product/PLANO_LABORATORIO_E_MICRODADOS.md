# Plano — Laboratório e microdados sem código

Data: 2026-10-27. Status: proposta para discussão; nada daqui está implementado.

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
  (casos novos 2016–2025, DF e Entorno × Brasil, sexo, faixa etária,
  raça/cor, forma clínica). Ela deve dar os mesmos números que o script
  Python de `resumo-leishmaniose` (139.171; 1.391; 326; 1.065). Uma pessoa de
  fora do projeto refaz em até 15 minutos com o manual.

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

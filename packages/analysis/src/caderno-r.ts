/**
 * Caderno-modelo em R (Fase 3 do plano do laboratório): série temporal com
 * tendência e perfil dos casos, região × Brasil.
 *
 * O TabSis monta três tabelas pequenas (casos por ano e município, população
 * do IBGE por ano e município, contagens do perfil) e este módulo escreve o
 * caderno que as lê. Só R base: roda no Laboratório (webR, no navegador) e no
 * RStudio, sem instalar pacote. A estatística fica à vista no código, para
 * quem revisa conferir:
 *
 * - coeficiente de detecção = casos ÷ população × 100 mil, por ano, e o médio
 *   do período (soma dos casos ÷ soma das populações);
 * - variação percentual anual pela regressão do logaritmo do coeficiente:
 *   mínimos quadrados (a do resumo de LTA) e Prais-Winsten, que corrige a
 *   autocorrelação de primeira ordem (Antunes & Cardoso, 2015);
 * - perfil: n (%) por categoria, região × restante do Brasil, qui-quadrado de
 *   Pearson;
 * - um parágrafo de Metodologia e um de Resultados com os números.
 */

export interface CadernoSerieEPerfil {
  titulo: string;
  /** Frases da definição de caso, na ordem da receita ("Incluir Tipo de entrada · CLA_TIPO_N · 1 valor(es)"). */
  definicaoDeCaso: string[];
  /** O que é contado, para o texto: "casos novos de leishmaniose tegumentar americana". */
  agravo: string;
  /** Municípios da região (6 dígitos); vazio = só o Brasil. */
  regiao: string[];
  nomeDaRegiao: string;
  arquivos: string[];
  /** Variáveis do perfil presentes em perfil.csv, na ordem da tabela 1. */
  variaveisDoPerfil: Array<{ campo: string; rotulo: string }>;
  geradoEm: string;
}

export interface CelulaR {
  runtime: 'r';
  code: string;
}

/** Texto R entre aspas, com escape do que pode quebrar a string. */
function aspas(texto: string): string {
  return `"${texto.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

function vetor(itens: readonly string[], porLinha = 10): string {
  if (!itens.length) return 'character(0)';
  const linhas: string[] = [];
  for (let i = 0; i < itens.length; i += porLinha) linhas.push(itens.slice(i, i + porLinha).map(aspas).join(', '));
  return `c(\n  ${linhas.join(',\n  ')}\n)`;
}

export function cadernoSerieEPerfil(opcoes: CadernoSerieEPerfil): { title: string; cells: CelulaR[] } {
  const definicao = opcoes.definicaoDeCaso.length ? opcoes.definicaoDeCaso.map((frase) => `#   - ${frase}`).join('\n') : '#   (nenhuma Seleção: todos os registros)';
  const celulas: string[] = [];

  celulas.push(`# ${opcoes.titulo}
# Caderno-modelo do TabSis: série temporal e perfil. Gerado em ${opcoes.geradoEm}.
# Arquivos: ${opcoes.arquivos.join(', ')}
# Definição de caso (receita do TabSis):
${definicao}
# Só R base: roda no Laboratório do TabSis (webR) e no RStudio.
# No RStudio, troque "/data/" pela pasta onde estão os três CSV.

casos <- read.csv2("/data/casos.csv", colClasses = c("integer", "character", "numeric"))
populacao <- read.csv2("/data/populacao.csv", colClasses = c("integer", "character", "numeric"))
perfil <- read.csv2("/data/perfil.csv", colClasses = c("character", "character", "character", "character", "numeric"))

# Municípios da região (código IBGE de 6 dígitos). Troque à vontade.
NOME_REGIAO <- ${aspas(opcoes.nomeDaRegiao)}
REGIAO <- ${vetor(opcoes.regiao)}
VARIAVEIS_PERFIL <- ${vetor(opcoes.variaveisDoPerfil.map((variavel) => variavel.campo), 8)}
ROTULOS_PERFIL <- ${vetor(opcoes.variaveisDoPerfil.map((variavel) => variavel.rotulo), 4)}
AGRAVO <- ${aspas(opcoes.agravo)}
ANOS <- sort(unique(casos$ano))
# Números em português: vírgula decimal e ponto de milhar.
br <- function(x, casas = 1) formatC(x, format = "f", digits = casas, big.mark = ".", decimal.mark = ",")
milhar <- function(x) formatC(x, format = "d", big.mark = ".", decimal.mark = ",")
cat(milhar(sum(casos$casos)), " casos em ", length(ANOS), " anos (", min(ANOS), " a ", max(ANOS), "); ",
    sum(casos$casos[casos$municipio == ""]), " sem município de residência (contam só no Brasil); ",
    length(REGIAO), " municípios em ", NOME_REGIAO, "\\n", sep = "")`);

  celulas.push(`# Coeficiente de detecção por ano: casos ÷ população × 100 mil.
serie <- function(codigos = NULL) {
  c_ <- if (is.null(codigos)) casos else casos[casos$municipio %in% codigos, ]
  p_ <- if (is.null(codigos)) populacao else populacao[populacao$municipio %in% codigos, ]
  n <- sapply(ANOS, function(a) sum(c_$casos[c_$ano == a]))
  p <- sapply(ANOS, function(a) sum(p_$populacao[p_$ano == a]))
  data.frame(ano = ANOS, casos = n, populacao = p, coeficiente = n / p * 1e5)
}
media <- function(s) sum(s$casos) / sum(s$populacao) * 1e5
brasil <- serie()
regiao <- if (length(REGIAO)) serie(REGIAO) else NULL

tabela <- data.frame(ano = ANOS, casos_brasil = brasil$casos, coef_brasil = round(brasil$coeficiente, 2))
if (!is.null(regiao)) {
  tabela$casos_regiao <- regiao$casos
  tabela$coef_regiao <- round(regiao$coeficiente, 2)
}
print(tabela, row.names = FALSE)
cat(sprintf("\\nTotal: Brasil %s casos, coeficiente médio %s por 100 mil", milhar(sum(brasil$casos)), br(media(brasil), 2)))
if (!is.null(regiao)) cat(sprintf("; %s %s casos, %s por 100 mil", NOME_REGIAO, milhar(sum(regiao$casos)), br(media(regiao), 2)))
cat("\\n")`);

  celulas.push(`# Tendência: variação percentual anual (VPA) do coeficiente, IC95%.
# Mínimos quadrados do logaritmo (como no resumo) e Prais-Winsten, que corrige
# a autocorrelação entre anos seguidos (Antunes & Cardoso, Epidemiol Serv Saude 2015).
vpa_minimos_quadrados <- function(coef) {
  x <- seq_along(coef) - 1
  s <- summary(lm(log(coef) ~ x))$coefficients
  t <- qt(0.975, length(coef) - 2)
  100 * (exp(s[2, 1] + c(0, -1, 1) * t * s[2, 2]) - 1)
}
prais_winsten <- function(coef, tolerancia = 1e-8, maximo = 200) {
  if (any(coef <= 0)) stop("Há ano sem caso: o logaritmo não existe. Junte anos ou use um modelo de contagem.")
  y <- log(coef); x <- seq_along(y) - 1; n <- length(y)
  b <- coef(lm(y ~ x)); rho <- 0
  for (i in seq_len(maximo)) {
    e <- y - b[1] - b[2] * x
    novo <- max(-0.99, min(0.99, sum(e[-1] * e[-n]) / sum(e[-n]^2)))
    a <- sqrt(1 - novo^2)
    ys <- c(a * y[1], y[-1] - novo * y[-n])
    um <- c(a, rep(1 - novo, n - 1))
    xs <- c(a * x[1], x[-1] - novo * x[-n])
    ajuste <- lm(ys ~ 0 + um + xs)
    b <- coef(ajuste)
    if (abs(novo - rho) < tolerancia) break
    rho <- novo
  }
  s <- summary(ajuste)$coefficients
  t <- qt(0.975, n - 2)
  list(vpa = 100 * (exp(s[2, 1] + c(0, -1, 1) * t * s[2, 2]) - 1), rho = novo, p = s[2, 4])
}
classificar <- function(ic) if (ic[2] > 0) "crescente" else if (ic[3] < 0) "decrescente" else "estacionária"
linha_tendencia <- function(nome, s) {
  mq <- vpa_minimos_quadrados(s$coeficiente)
  pw <- prais_winsten(s$coeficiente)
  data.frame(grupo = nome,
    vpa_minimos_quadrados = sprintf("%s%% (%s a %s)", br(mq[1]), br(mq[2]), br(mq[3])),
    vpa_prais_winsten = sprintf("%s%% (%s a %s)", br(pw$vpa[1]), br(pw$vpa[2]), br(pw$vpa[3])),
    rho = br(pw$rho, 2), p_valor = format.pval(pw$p, digits = 3),
    tendencia = classificar(pw$vpa))
}
tendencias <- linha_tendencia("Brasil", brasil)
if (!is.null(regiao)) tendencias <- rbind(tendencias, linha_tendencia(NOME_REGIAO, regiao))
for (i in seq_len(nrow(tendencias))) with(tendencias[i, ], cat(sprintf(
  "%s: %s\\n  Prais-Winsten: VPA %s (rho = %s; p = %s)\\n  Mínimos quadrados: VPA %s\\n",
  grupo, tendencia, vpa_prais_winsten, rho, p_valor, vpa_minimos_quadrados)))`);

  celulas.push(`# A série em texto (o Laboratório mostra texto). No RStudio, o gráfico:
#   plot(ANOS, brasil$coeficiente, type = "o", ylim = c(0, max(c(brasil$coeficiente, regiao$coeficiente))),
#        xlab = "Ano", ylab = "Casos por 100 mil hab."); if (!is.null(regiao)) lines(ANOS, regiao$coeficiente, type = "o", col = 2)
barras <- function(nome, s) {
  cat(nome, "(casos por 100 mil hab.)\\n")
  escala <- 40 / max(s$coeficiente)
  for (i in seq_along(ANOS)) cat(sprintf("  %d %6s %s\\n", ANOS[i], br(s$coeficiente[i], 2), strrep("#", round(s$coeficiente[i] * escala))))
}
barras("Brasil", brasil)
if (!is.null(regiao)) barras(NOME_REGIAO, regiao)`);

  celulas.push(`# Perfil dos casos (tabela 1): n (%) por categoria, região × restante do Brasil,
# com o qui-quadrado de Pearson (com categorias muito pequenas, prefira juntar categorias).
faixa_sinan <- function(codigo) {  # NU_IDADE_N: o 1º dígito é a unidade (4 = anos; horas, dias e meses = 0 ano)
  unidade <- substr(codigo, 1, 1)
  anos <- ifelse(unidade == "4", suppressWarnings(as.numeric(substr(codigo, 2, 4))), ifelse(unidade %in% c("1", "2", "3"), 0, NA))
  as.character(cut(anos, c(-Inf, 9, 19, 39, 59, Inf), labels = c("0-9", "10-19", "20-39", "40-59", "60 ou mais")))
}
tabela1 <- function(variavel, rotulo) {
  d <- perfil[perfil$variavel == variavel, ]
  if (variavel == "NU_IDADE_N") d$rotulo <- faixa_sinan(d$codigo)
  d$rotulo[is.na(d$rotulo) | d$rotulo == ""] <- "Ignorado/em branco"
  br <- tapply(d$casos[d$grupo == "brasil"], d$rotulo[d$grupo == "brasil"], sum)
  br <- br[br > 0]
  rg <- tapply(d$casos[d$grupo == "regiao"], d$rotulo[d$grupo == "regiao"], sum)[names(br)]
  rg[is.na(rg)] <- 0
  p <- if (sum(rg) > 0 && length(br) > 1) format.pval(suppressWarnings(chisq.test(rbind(rg, br - rg)))$p.value, digits = 3) else ""
  data.frame(variavel = c(rotulo, rep("", length(br) - 1)), categoria = names(br),
    brasil = sprintf("%s (%s%%)", milhar(as.integer(br)), formatC(100 * br / sum(br), format = "f", digits = 1, decimal.mark = ",")),
    regiao = sprintf("%s (%s%%)", milhar(as.integer(rg)), formatC(100 * rg / max(1, sum(rg)), format = "f", digits = 1, decimal.mark = ",")),
    p_valor = c(p, rep("", length(br) - 1)))
}
if (length(VARIAVEIS_PERFIL)) {
  tabela_perfil <- do.call(rbind, Map(tabela1, VARIAVEIS_PERFIL, ROTULOS_PERFIL))
  names(tabela_perfil)[4] <- NOME_REGIAO
  # Um bloco por variável, para caber na tela; a tabela inteira fica em tabela_perfil.
  largura <- max(nchar(tabela_perfil$categoria), 9) + 2
  for (bloco in split(tabela_perfil, cumsum(tabela_perfil$variavel != ""))) {
    cat(sprintf("\\n%s%s\\n", bloco$variavel[1], if (nzchar(bloco$p_valor[1])) paste0(" (qui-quadrado: p = ", bloco$p_valor[1], ")") else ""))
    cat(sprintf("  %-*s %18s %18s\\n", largura, "Categoria", "Brasil", NOME_REGIAO))
    for (j in seq_len(nrow(bloco))) cat(sprintf("  %-*s %18s %18s\\n", largura, bloco$categoria[j], bloco$brasil[j], bloco[[4]][j]))
  }
} else cat("Nenhuma variável de perfil neste arquivo.\\n")`);

  celulas.push(`# Texto para o resumo: Metodologia e Resultados com os números acima.
pw_br <- prais_winsten(brasil$coeficiente)
metodologia <- sprintf(paste0(
  "Estudo ecológico de série temporal com os %s notificados no Sistema de Informação de Agravos de Notificação ",
  "entre %d e %d, extraídos do DATASUS. Compararam-se %s e o Brasil quanto ao coeficiente de detecção por 100 mil ",
  "habitantes (população do IBGE: estimativas anuais e Censo 2022), à variação percentual anual, estimada por ",
  "regressão de Prais-Winsten do logaritmo do coeficiente (IC95%%), e ao perfil dos casos, comparado com o restante ",
  "do país pelo teste qui-quadrado de Pearson."), AGRAVO, min(ANOS), max(ANOS),
  if (is.null(regiao)) "as unidades" else NOME_REGIAO)
resultados <- sprintf("O Brasil registrou %s casos, com coeficiente médio de %s por 100 mil e tendência %s (VPA %s%%; IC95%%: %s a %s).",
  milhar(sum(brasil$casos)), br(media(brasil)), classificar(pw_br$vpa), br(pw_br$vpa[1]), br(pw_br$vpa[2]), br(pw_br$vpa[3]))
if (!is.null(regiao)) {
  pw_rg <- prais_winsten(regiao$coeficiente)
  resultados <- paste(resultados, sprintf("%s somou %s casos, com coeficiente médio de %s por 100 mil e tendência %s (VPA %s%%; IC95%%: %s a %s).",
    NOME_REGIAO, milhar(sum(regiao$casos)), br(media(regiao)), classificar(pw_rg$vpa), br(pw_rg$vpa[1]), br(pw_rg$vpa[2]), br(pw_rg$vpa[3])))
}
cat("Metodologia:", strwrap(metodologia, 100), sep = "\\n")
cat("\\n\\nResultados:", strwrap(resultados, 100), sep = "\\n")
cat("\\n")`);

  return { title: opcoes.titulo.slice(0, 120), cells: celulas.map((code) => ({ runtime: 'r' as const, code })) };
}

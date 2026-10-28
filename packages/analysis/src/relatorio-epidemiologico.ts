/**
 * Relatório epidemiológico: um HTML único (abre sem internet, vai por e-mail)
 * com os números-resumo, o mapa do coeficiente por município, o gráfico por
 * ano, as tabelas ano a ano e por município, o perfil e "Como foi feito" — o
 * mesmo desenho do relatório da leishmaniose (resumo-leishmaniose), montado a
 * partir da receita do TabSis, para qualquer agravo.
 *
 * Este módulo só calcula e escreve: recebe contagens, populações e geometria
 * já prontas (o app as monta) e devolve o HTML. Assim os números são
 * conferíveis num teste sem navegador.
 */

export interface GrupoDoRelatorio {
  /** 'BR', 'REG', 'NUC' (núcleo, ex.: DF), 'PER' (periferia, ex.: Entorno). */
  id: string;
  nome: string;
  casos: number[];
  populacao: number[];
}

export interface MunicipioDoRelatorio {
  codigo: string;
  nome: string;
  casos: number;
  /** Soma das populações dos anos (o coeficiente médio usa a soma). */
  populacaoSoma: number;
  /** Casos (de qualquer residência) com o local provável de infecção neste município. */
  infeccoes?: number;
  partes: Array<Array<[number, number]>>;
}

export interface PerfilDoRelatorio {
  titulo: string;
  /** Contagem por grupo (ids de {@link GrupoDoRelatorio}). */
  linhas: Array<{ rotulo: string; porGrupo: Record<string, number> }>;
}

export interface DadosDoRelatorio {
  titulo: string;
  subtitulo: string;
  agravo: string;
  anos: number[];
  fontePopulacao: string[];
  grupos: GrupoDoRelatorio[];
  municipios: MunicipioDoRelatorio[];
  /** Municípios de fora da região, só para o fundo do mapa. */
  contexto: Array<Array<Array<[number, number]>>>;
  /** Contornos dos estados, por cima do mapa. */
  estados: Array<Array<Array<[number, number]>>>;
  /** Grupos que entram no perfil (na ordem das colunas). */
  gruposDoPerfil: string[];
  perfil: PerfilDoRelatorio[];
  /** Autóctones do município de residência, por grupo (TPAUTOCTO = 1). */
  autoctonia?: Record<string, { autoctones: number; total: number }>;
  definicaoDeCaso: string[];
  /** Como a região foi definida (municípios e campo), para "Como foi feito". */
  regiao?: string;
  arquivos: string[];
  geradoEm: string;
}

export interface Tendencia {
  vpa: number;
  inferior: number;
  superior: number;
}

const T975 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/** t de Student (0,975) com `gl` graus de liberdade. */
export function t975(gl: number): number {
  if (gl < 1) return Number.NaN;
  return gl <= 30 ? T975[gl]! : 1.96 + 2.4 / gl;
}

/** Mínimos quadrados de y = a·u + b·x (u e x dados); devolve b e o erro-padrão de b. */
function regressao(u: number[], x: number[], y: number[]): { a: number; b: number; ep: number } {
  const n = y.length;
  let uu = 0; let ux = 0; let xx = 0; let uy = 0; let xy = 0;
  for (let i = 0; i < n; i += 1) { uu += u[i]! ** 2; ux += u[i]! * x[i]!; xx += x[i]! ** 2; uy += u[i]! * y[i]!; xy += x[i]! * y[i]!; }
  const det = uu * xx - ux * ux;
  const a = (xx * uy - ux * xy) / det;
  const b = (uu * xy - ux * uy) / det;
  let sq = 0;
  for (let i = 0; i < n; i += 1) sq += (y[i]! - a * u[i]! - b * x[i]!) ** 2;
  return { a, b, ep: Math.sqrt((sq / (n - 2)) * (uu / det)) };
}

/** Variação percentual anual pela regressão do logaritmo do coeficiente (mínimos quadrados), IC95%. */
export function vpaMinimosQuadrados(coeficientes: number[]): Tendencia | null {
  if (coeficientes.length < 3 || coeficientes.some((c) => !(c > 0))) return null;
  const y = coeficientes.map(Math.log);
  const x = y.map((_, i) => i);
  const { b, ep } = regressao(y.map(() => 1), x, y);
  const t = t975(y.length - 2);
  const pct = (v: number) => 100 * (Math.exp(v) - 1);
  return { vpa: pct(b), inferior: pct(b - t * ep), superior: pct(b + t * ep) };
}

/** A mesma variação por Prais-Winsten (corrige a autocorrelação de primeira ordem), como no caderno em R. */
export function vpaPraisWinsten(coeficientes: number[]): Tendencia | null {
  if (coeficientes.length < 4 || coeficientes.some((c) => !(c > 0))) return null;
  const y = coeficientes.map(Math.log);
  const n = y.length;
  const x = y.map((_, i) => i);
  let { a, b } = regressao(y.map(() => 1), x, y);
  let rho = 0;
  let ajuste = { a, b, ep: 0 };
  for (let iteracao = 0; iteracao < 200; iteracao += 1) {
    const e = y.map((valor, i) => valor - a - b * x[i]!);
    let num = 0; let den = 0;
    for (let i = 1; i < n; i += 1) { num += e[i]! * e[i - 1]!; den += e[i - 1]! ** 2; }
    const novo = Math.max(-0.99, Math.min(0.99, num / den));
    const raiz = Math.sqrt(1 - novo ** 2);
    const ys = y.map((valor, i) => (i === 0 ? raiz * valor : valor - novo * y[i - 1]!));
    const us = y.map((_, i) => (i === 0 ? raiz : 1 - novo));
    const xs = x.map((valor, i) => (i === 0 ? raiz * valor : valor - novo * x[i - 1]!));
    ajuste = regressao(us, xs, ys);
    ({ a, b } = ajuste);
    const parou = Math.abs(novo - rho) < 1e-8;
    rho = novo;
    if (parou) break;
  }
  const t = t975(n - 2);
  const pct = (v: number) => 100 * (Math.exp(v) - 1);
  return { vpa: pct(ajuste.b), inferior: pct(ajuste.b - t * ajuste.ep), superior: pct(ajuste.b + t * ajuste.ep) };
}

function br(valor: number, casas = 1): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function esc(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tendenciaEmTexto(t: Tendencia | null): string {
  return t ? `${br(t.vpa)}% ao ano (IC95%: ${br(t.inferior)} a ${br(t.superior)})` : 'sem tendência calculável (ano sem caso)';
}

function classificar(t: Tendencia | null): string {
  if (!t) return 'sem tendência calculável';
  return t.inferior > 0 ? 'tendência de alta' : t.superior < 0 ? 'tendência de queda' : 'sem tendência significativa';
}

/** Classes de cor fixas e arredondadas, escolhidas pelo maior coeficiente municipal. */
function classesDeCor(maximo: number): Array<{ ate: number; rotulo: string }> {
  const degraus = maximo > 100 ? [2, 10, 50] : maximo > 20 ? [1, 5, 20] : maximo > 5 ? [0.5, 2, 5] : [0.2, 1, 2];
  const f = (v: number) => br(v, v < 1 ? 1 : 0);
  return [
    { ate: degraus[0]!, rotulo: `até ${f(degraus[0]!)}` },
    { ate: degraus[1]!, rotulo: `${f(degraus[0]!)} a ${f(degraus[1]!)}` },
    { ate: degraus[2]!, rotulo: `${f(degraus[1]!)} a ${f(degraus[2]!)}` },
    { ate: Number.POSITIVE_INFINITY, rotulo: `mais de ${f(degraus[2]!)}` },
  ];
}

const CSS = `:root {
  color-scheme: light;
  --surface: #ffffff;
  --surface-1: #fcfcfb;
  --surface-2: #f4f3f0;
  --line: #e4e2dc;
  --grid: #ecebe7;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #77746d;
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --series-3: #1baf7a;
  --series-4: #eda100;
  --seq-0: #f0efec;
  --seq-1: #cde2fb;
  --seq-2: #6da7ec;
  --seq-3: #256abf;
  --seq-4: #0d366b;
  --ctx: #f7f6f3;
  --ctx-line: #dedcd6;
  --uf-line: #9a978f;
  --sea: #fbfaf8;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface: #121211;
    --surface-1: #1a1a19;
    --surface-2: #232321;
    --line: #34332f;
    --grid: #2a2a27;
    --text-primary: #f0efec;
    --text-secondary: #c3c2b7;
    --text-muted: #9c9a92;
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
    --seq-0: #383835;
    --seq-1: #b7d3f6;
    --seq-2: #5598e7;
    --seq-3: #2a78d6;
    --seq-4: #184f95;
    --ctx: #1f1f1d;
    --ctx-line: #2f2e2b;
    --uf-line: #6f6d66;
    --sea: #161615;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #121211; --surface-1: #1a1a19; --surface-2: #232321; --line: #34332f; --grid: #2a2a27;
  --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #9c9a92;
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500;
  --seq-0: #383835; --seq-1: #b7d3f6; --seq-2: #5598e7; --seq-3: #2a78d6; --seq-4: #184f95;
  --ctx: #1f1f1d; --ctx-line: #2f2e2b; --uf-line: #6f6d66; --sea: #161615;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--text-primary);
  font: 15px/1.5 "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 28px 16px 48px; }
h1 { font-size: 26px; line-height: 1.2; margin: 0 0 6px; }
h2 { font-size: 18px; margin: 0 0 4px; }
.sub, .nota { color: var(--text-secondary); margin: 0 0 14px; }
.nota { font-size: 13px; color: var(--text-muted); }
section { background: var(--surface-1); border: 1px solid var(--line); border-radius: 10px; padding: 18px; margin: 18px 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 18px 0; }
.tile { background: var(--surface-1); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.tile b { display: block; font-size: 26px; line-height: 1.15; font-variant-numeric: tabular-nums; }
.tile span { display: block; color: var(--text-secondary); font-size: 13px; margin-top: 4px; }
.duas { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 18px; align-items: start; }
@media (max-width: 820px) { .duas { grid-template-columns: 1fr; } }
.mapa { width: 100%; height: auto; display: block; border-radius: 8px; border: 1px solid var(--line); }
.mapa .mar { fill: var(--sea); }
.mapa .ctx { fill: var(--ctx); stroke: var(--ctx-line); stroke-width: .5; }
.mapa .uf { fill: none; stroke: var(--uf-line); stroke-width: 1.3; pointer-events: none; }
.mapa .mun { stroke: var(--surface-1); stroke-width: 1.2; cursor: pointer; }
.mapa .mun:hover, .mapa .mun:focus { stroke: var(--text-primary); stroke-width: 2; outline: none; }
.z { fill: var(--seq-0); } .c1 { fill: var(--seq-1); } .c2 { fill: var(--seq-2); } .c3 { fill: var(--seq-3); } .c4 { fill: var(--seq-4); }
.mapa .rot { font-size: 12.5px; font-weight: 600; text-anchor: middle; fill: #1f1e1b; paint-order: stroke;
  stroke: #ffffff; stroke-width: 3px; stroke-linejoin: round; pointer-events: none; }
.mapa .rot.esc { fill: #ffffff; stroke: #0d366b; }
.mapa .rot.val { font-weight: 700; }
.leg { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; font-size: 13px; color: var(--text-secondary); margin-top: 10px; }
.leg i { display: inline-block; width: 16px; height: 11px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.leg .linha i { height: 3px; border-radius: 2px; vertical-align: 3px; }
.tip { position: fixed; pointer-events: none; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 10px; font-size: 13px; box-shadow: 0 6px 18px rgba(0,0,0,.14); z-index: 10; min-width: 160px; display: none; }
.tip b { display: block; margin-bottom: 2px; }
.tip .k { color: var(--text-secondary); }
.tip .sw { display: inline-block; width: 10px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: 3px; }
.grafico { width: 100%; height: auto; display: block; }
.grafico .grid { stroke: var(--grid); stroke-width: 1; }
.grafico .eixo { fill: var(--text-muted); font-size: 12px; }
.grafico .serie { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.grafico .ponto { stroke: var(--surface-1); stroke-width: 2; }
.grafico .rotulo { font-size: 12px; fill: var(--text-secondary); }
.grafico .cruz { stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 3 3; }
.tabela-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; font-variant-numeric: tabular-nums; }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; white-space: normal; }
thead th { color: var(--text-secondary); font-weight: 600; background: var(--surface-2); position: sticky; top: 0; }
tr.tot td { font-weight: 600; background: var(--surface-2); }
tr.sec th { text-align: left; background: var(--surface-2); color: var(--text-primary); padding-top: 10px; }
td.fonte-pop { color: var(--text-muted); font-size: 12px; }
details { margin-top: 10px; }
summary { cursor: pointer; color: var(--text-secondary); font-weight: 600; }
ul { padding-left: 20px; margin: 8px 0; }
li { margin: 4px 0; color: var(--text-secondary); }
li b { color: var(--text-primary); }`;

export function relatorioEpidemiologico(dados: DadosDoRelatorio): string {
  const media = (g: GrupoDoRelatorio) => g.casos.reduce((s, v) => s + v, 0) / g.populacao.reduce((s, v) => s + v, 0) * 1e5;
  const total = (g: GrupoDoRelatorio) => g.casos.reduce((s, v) => s + v, 0);
  const taxas = (g: GrupoDoRelatorio) => g.casos.map((c, i) => (g.populacao[i] ? (c / g.populacao[i]!) * 1e5 : 0));
  const grupo = (id: string) => dados.grupos.find((g) => g.id === id);
  const brasil = grupo('BR')!;
  const regiao = grupo('REG');
  const nucleo = grupo('NUC');
  const periferia = grupo('PER');
  const periodo = `${dados.anos[0]}–${dados.anos.at(-1)}`;

  // Números do topo.
  const tiles: string[] = [
    `<div class="tile"><b>${br(total(brasil), 0)}</b><span>casos no Brasil · média de ${br(media(brasil))} por 100 mil</span></div>`,
  ];
  if (regiao) tiles.push(`<div class="tile"><b>${br(total(regiao), 0)}</b><span>casos em ${esc(regiao.nome)} · média de ${br(media(regiao))} por 100 mil</span></div>`);
  if (regiao && periferia) tiles.push(`<div class="tile"><b>${br(media(periferia))}</b><span>por 100 mil em ${esc(periferia.nome)}, que tem ${br((100 * total(periferia)) / Math.max(1, total(regiao)))}% dos casos da região</span></div>`);
  const autoc = dados.autoctonia;
  if (nucleo) {
    const a = autoc?.[nucleo.id];
    tiles.push(`<div class="tile"><b>${br(media(nucleo))}</b><span>por 100 mil em ${esc(nucleo.nome)}${a?.total ? `; só ${br((100 * a.autoctones) / a.total)}% dos casos se infectaram no próprio município` : ''}</span></div>`);
  } else if (regiao) {
    const maior = [...dados.municipios].sort((x, y) => y.casos / Math.max(1, y.populacaoSoma) - x.casos / Math.max(1, x.populacaoSoma))[0];
    if (maior) tiles.push(`<div class="tile"><b>${br((maior.casos / Math.max(1, maior.populacaoSoma)) * 1e5)}</b><span>por 100 mil em ${esc(maior.nome)}, o maior coeficiente da região</span></div>`);
  }

  // Mapa: equirretangular local, caixa da região com 0,3° de folga.
  let mapa = '<p class="nota">Sem região na receita: o mapa por município aparece quando a receita tem uma etapa de município de residência.</p>';
  let legenda = '';
  if (dados.municipios.length) {
    const pontos = dados.municipios.flatMap((m) => m.partes.flat());
    const xs = pontos.map((p) => p[0]); const ys = pontos.map((p) => p[1]);
    const x0 = Math.min(...xs) - 0.3; const x1 = Math.max(...xs) + 0.3; const y0 = Math.min(...ys) - 0.3; const y1 = Math.max(...ys) + 0.3;
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    const W = 720; const H = (W * (y1 - y0)) / ((x1 - x0) * k);
    const P = (x: number, y: number) => `${(((x - x0) / (x1 - x0)) * W).toFixed(1)},${(((y1 - y) / (y1 - y0)) * H).toFixed(1)}`;
    // Pontos que caem no mesmo décimo de pixel saem: o arquivo fica pequeno sem mudar o desenho.
    const caminho = (partes: Array<Array<[number, number]>>) => partes.map((anel) => {
      const pontos = anel.map(([x, y]) => P(x, y)).filter((ponto, i, todos) => i === 0 || ponto !== todos[i - 1]);
      return pontos.length > 2 ? `M${pontos.join('L')}Z` : '';
    }).join('');
    const dentro = (partes: Array<Array<[number, number]>>) => partes.some((anel) => anel.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1));
    const coef = (m: MunicipioDoRelatorio) => (m.populacaoSoma ? (m.casos / m.populacaoSoma) * 1e5 : 0);
    const classes = classesDeCor(Math.max(0, ...dados.municipios.map(coef)));
    const classe = (v: number) => (v === 0 ? 'z' : `c${classes.findIndex((c) => v <= c.ate) + 1}`);
    const fundo = dados.contexto.filter(dentro).map((partes) => `<path class="ctx" d="${caminho(partes)}"/>`).join('');
    const ufs = dados.estados.filter(dentro).map((partes) => `<path class="uf" d="${caminho(partes)}"/>`).join('');
    const areas = dados.municipios.map((m) => `<path class="mun ${classe(coef(m))}" d="${caminho(m.partes)}" tabindex="0" data-nome="${esc(m.nome)}" data-casos="${m.casos}" data-taxa="${coef(m).toFixed(2)}" data-lpi="${m.infeccoes ?? ''}"/>`).join('');
    mapa = `<svg class="mapa" viewBox="0 0 ${W} ${H.toFixed(0)}" role="img" aria-label="Mapa do coeficiente médio de detecção por município"><rect class="mar" width="${W}" height="${H.toFixed(0)}"/>${fundo}${ufs}${areas}</svg>`;
    legenda = `<div class="leg"><b style="color:var(--text-primary)">Casos por 100 mil hab.</b><span><i style="background:var(--seq-0)"></i>0</span>${classes.map((c, i) => `<span><i style="background:var(--seq-${i + 1})"></i>${c.rotulo}</span>`).join('')}</div>`;
  }

  // Onde a infecção acontece e as tendências.
  const itens: string[] = [];
  const comInfeccao = dados.municipios.filter((m) => m.infeccoes !== undefined);
  if (comInfeccao.length) {
    const totalInf = comInfeccao.reduce((s, m) => s + (m.infeccoes ?? 0), 0);
    const top = [...comInfeccao].sort((a, b) => (b.infeccoes ?? 0) - (a.infeccoes ?? 0)).slice(0, 3);
    const top3 = top.reduce((s, m) => s + (m.infeccoes ?? 0), 0);
    if (totalInf) itens.push(`<li><b>${br((100 * top3) / totalInf)}%</b> das ${br(totalInf, 0)} infecções adquiridas na região ocorreram em ${top.map((m) => `${esc(m.nome)} (${br(m.infeccoes ?? 0, 0)})`).join(', ')}.</li>`);
  }
  if (nucleo && autoc?.[nucleo.id]?.total) itens.push(`<li>Em <b>${esc(nucleo.nome)}</b>, só ${br((100 * autoc[nucleo.id]!.autoctones) / autoc[nucleo.id]!.total)}% dos casos foram autóctones do município de residência.</li>`);
  const tendencias = dados.grupos.map((g) => ({ g, mq: vpaMinimosQuadrados(taxas(g)), pw: vpaPraisWinsten(taxas(g)) }));
  for (const { g, mq } of tendencias.filter(({ g }) => g.id === 'BR' || g.id === 'REG')) {
    itens.push(`<li><b>${esc(g.nome)}</b>: ${classificar(mq)}, ${tendenciaEmTexto(mq)}.</li>`);
  }

  // Tabelas.
  const ano = dados.anos.map((a, i) => `<tr><td>${a}</td>${dados.grupos.map((g) => `<td>${br(g.casos[i] ?? 0, 0)}</td><td>${br(taxas(g)[i] ?? 0)}</td>`).join('')}<td class="fonte-pop">${esc(dados.fontePopulacao[i] ?? '')}</td></tr>`).join('')
    + `<tr class="tot"><td>${periodo}</td>${dados.grupos.map((g) => `<td>${br(total(g), 0)}</td><td>${br(media(g), 2)}</td>`).join('')}<td></td></tr>`
    + `<tr class="tot"><td>Variação anual</td>${tendencias.map(({ mq }) => `<td colspan="2">${mq ? `${br(mq.vpa)}% (${br(mq.inferior)} a ${br(mq.superior)})` : '—'}</td>`).join('')}<td></td></tr>`
    + `<tr class="tot"><td>Prais-Winsten</td>${tendencias.map(({ pw }) => `<td colspan="2">${pw ? `${br(pw.vpa)}% (${br(pw.inferior)} a ${br(pw.superior)})` : '—'}</td>`).join('')}<td></td></tr>`;
  const anosDoPeriodo = Math.max(1, dados.anos.length);
  const municipios = [...dados.municipios].sort((a, b) => b.casos / Math.max(1, b.populacaoSoma) - a.casos / Math.max(1, a.populacaoSoma))
    .map((m) => `<tr><td>${esc(m.nome)}</td><td>${br(m.casos, 0)}</td><td>${br(m.populacaoSoma / anosDoPeriodo, 0)}</td><td>${br(m.populacaoSoma ? (m.casos / m.populacaoSoma) * 1e5 : 0)}</td><td>${m.infeccoes === undefined ? '—' : br(m.infeccoes, 0)}</td></tr>`).join('');
  const gruposDoPerfil = dados.gruposDoPerfil.map((id) => grupo(id)).filter((g): g is GrupoDoRelatorio => Boolean(g));
  const perfil = dados.perfil.map((bloco) => {
    const totais = Object.fromEntries(gruposDoPerfil.map((g) => [g.id, bloco.linhas.reduce((s, l) => s + (l.porGrupo[g.id] ?? 0), 0)]));
    return `<tr class="sec"><th colspan="${gruposDoPerfil.length + 1}">${esc(bloco.titulo)}</th></tr>` + bloco.linhas.map((l) => `<tr><td>${esc(l.rotulo)}</td>${gruposDoPerfil.map((g) => `<td>${totais[g.id] ? `${br((100 * (l.porGrupo[g.id] ?? 0)) / totais[g.id]!)}%` : '—'}</td>`).join('')}</tr>`).join('');
  }).join('');

  const series = dados.grupos.map((g, i) => ({ id: g.id, nome: g.nome, cor: `var(--series-${i + 1})`, taxa: taxas(g), casos: g.casos }));
  const json = JSON.stringify({ anos: dados.anos, series }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(dados.titulo)}</title>
<style>
${CSS}
</style>
</head>
<body>
<main>
  <h1>${esc(dados.titulo)}</h1>
  <p class="sub">${esc(dados.subtitulo)}</p>
  <div class="tiles">${tiles.join('')}</div>
  <section class="duas">
    <div>
      <h2>Coeficiente médio por município</h2>
      <p class="nota">Toque ou passe o mouse num município para ver os números.</p>
      ${mapa}
      ${legenda}
    </div>
    <div>
      <h2>Onde a infecção acontece e a tendência</h2>
      <ul>${itens.join('')}</ul>
    </div>
  </section>
  <section>
    <h2>Coeficiente de detecção por ano</h2>
    <p class="nota">Casos por 100 mil habitantes. Passe o mouse ou o dedo sobre o gráfico para ver cada ano.</p>
    <svg class="grafico" id="grafico" viewBox="0 0 960 360" role="img" aria-label="Coeficiente de detecção por ano"></svg>
    <div class="leg" id="leg-grafico"></div>
  </section>
  <section>
    <h2>Casos e coeficientes por ano</h2>
    <div class="tabela-wrap"><table>
      <thead><tr><th rowspan="2">Ano</th>${dados.grupos.map((g) => `<th colspan="2">${esc(g.nome)}</th>`).join('')}<th rowspan="2">População</th></tr>
      <tr>${dados.grupos.map(() => '<th>Casos</th><th>/100 mil</th>').join('')}</tr></thead>
      <tbody>${ano}</tbody>
    </table></div>
    <p class="nota">Variação anual estimada pela regressão do logaritmo do coeficiente (mínimos quadrados e Prais-Winsten), com IC95%.</p>
  </section>
  ${dados.municipios.length ? `<section>
    <h2>Municípios</h2>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Município</th><th>Casos (residência)</th><th>População média</th><th>/100 mil</th><th>Infecções no município</th></tr></thead>
      <tbody>${municipios}</tbody>
    </table></div>
    <p class="nota">"Infecções no município": casos (de qualquer residência) cujo local provável de infecção é o município.</p>
  </section>` : ''}
  ${perfil ? `<section>
    <h2>Perfil dos casos</h2>
    <div class="tabela-wrap"><table>
      <thead><tr><th></th>${gruposDoPerfil.map((g) => `<th>${esc(g.nome)}</th>`).join('')}</tr></thead>
      <tbody>${perfil}</tbody>
    </table></div>
  </section>` : ''}
  <section>
    <h2>Como foi feito</h2>
    <ul>
      <li><b>Fonte:</b> ${esc(dados.arquivos.join(', '))} (DATASUS). Ano = ano do arquivo.</li>
      <li><b>Definição de caso (receita do TabSis):</b> ${dados.definicaoDeCaso.length ? esc(dados.definicaoDeCaso.join('; ')) : 'todos os registros'}.</li>
      ${dados.regiao ? `<li><b>Região:</b> ${esc(dados.regiao)}. Caso conta onde a pessoa mora.</li>` : ''}
      <li><b>População:</b> IBGE — estimativas anuais e Censo 2022 (ano sem estimativa usa a série mais próxima).</li>
      <li><b>Coeficiente médio:</b> casos do período divididos pela soma das populações anuais, × 100 mil. Caso sem município de residência válido conta só no Brasil.</li>
      <li><b>Gerado pelo TabSis</b> (tabweb.me) em ${esc(dados.geradoEm)}.</li>
    </ul>
  </section>
</main>
<div class="tip" id="tip"></div>
<script>
const DADOS = ${json};
const fmt = (v, c = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const tip = document.getElementById('tip');
function mostrar(html, x, y) {
  tip.innerHTML = html; tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + 'px';
  tip.style.top = Math.max(8, y - r.height - 12) + 'px';
}
const esconder = () => { tip.style.display = 'none'; };
document.querySelectorAll('.mapa .mun').forEach((el) => {
  const texto = () => '<b>' + el.dataset.nome + '</b><span class="k">Coeficiente:</span> ' + fmt(Number(el.dataset.taxa)) + ' por 100 mil<br>'
    + '<span class="k">Casos (residência):</span> ' + fmt(Number(el.dataset.casos), 0)
    + (el.dataset.lpi !== '' ? '<br><span class="k">Infecções no município:</span> ' + fmt(Number(el.dataset.lpi), 0) : '');
  el.addEventListener('pointermove', (e) => mostrar(texto(), e.clientX, e.clientY));
  el.addEventListener('pointerleave', esconder);
  el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); mostrar(texto(), r.left + r.width / 2, r.top + r.height / 2); });
  el.addEventListener('blur', esconder);
});
const svg = document.getElementById('grafico');
const W = 960, H = 360, m = { t: 16, r: 130, b: 34, l: 44 };
const anos = DADOS.anos;
const maxY = Math.max(1, Math.ceil(Math.max(...DADOS.series.flatMap((s) => s.taxa)) / 2) * 2);
const passo = maxY > 20 ? 5 : maxY > 8 ? 2 : maxY > 3 ? 1 : 0.5;
const x = (i) => m.l + i * (W - m.l - m.r) / Math.max(1, anos.length - 1);
const y = (v) => H - m.b - v / maxY * (H - m.t - m.b);
const NS = 'http://www.w3.org/2000/svg';
const add = (tag, attrs, pai = svg) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); pai.appendChild(e); return e; };
for (let v = 0; v <= maxY + 1e-9; v += passo) {
  add('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) });
  add('text', { class: 'eixo', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }).textContent = fmt(v, passo < 1 ? 1 : 0);
}
anos.forEach((a, i) => { add('text', { class: 'eixo', x: x(i), y: H - 10, 'text-anchor': 'middle' }).textContent = a; });
const fins = [];
for (const s of DADOS.series) {
  add('path', { class: 'serie', stroke: s.cor, d: s.taxa.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join('') });
  s.taxa.forEach((v, i) => add('circle', { class: 'ponto', cx: x(i), cy: y(v), r: 4, fill: s.cor }));
  fins.push({ s, yv: y(s.taxa.at(-1)) });
}
fins.sort((a, b) => a.yv - b.yv);
for (let i = 1; i < fins.length; i++) if (fins[i].yv - fins[i - 1].yv < 14) fins[i].yv = fins[i - 1].yv + 14;
for (const f of fins) add('text', { class: 'rotulo', x: x(anos.length - 1) + 10, y: f.yv + 4 }).textContent = f.s.nome;
document.getElementById('leg-grafico').innerHTML = DADOS.series.map((s) => '<span class="linha"><i style="background:' + s.cor + '"></i>' + s.nome + '</span>').join('');
const cruz = add('line', { class: 'cruz', y1: m.t, y2: H - m.b, visibility: 'hidden' });
const area = add('rect', { x: m.l - 10, y: 0, width: W - m.l - m.r + 20, height: H, fill: 'transparent' });
area.addEventListener('pointermove', (e) => {
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const loc = p.matrixTransform(svg.getScreenCTM().inverse());
  const i = Math.max(0, Math.min(anos.length - 1, Math.round((loc.x - m.l) / ((W - m.l - m.r) / Math.max(1, anos.length - 1)))));
  cruz.setAttribute('x1', x(i)); cruz.setAttribute('x2', x(i)); cruz.setAttribute('visibility', 'visible');
  mostrar('<b>' + anos[i] + '</b>' + DADOS.series.map((s) => '<span class="sw" style="background:' + s.cor + '"></span>' + s.nome + ': ' + fmt(s.taxa[i]) + ' <span class="k">(' + fmt(s.casos[i], 0) + ' casos)</span>').join('<br>'), e.clientX, e.clientY);
});
area.addEventListener('pointerleave', () => { cruz.setAttribute('visibility', 'hidden'); esconder(); });
</script>
</body>
</html>
`;
}

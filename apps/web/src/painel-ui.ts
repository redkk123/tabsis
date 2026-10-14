/**
 * O painel de tabulação, desenhado como o do TabWin.
 *
 * Quem usou o TabWin a vida inteira procura quatro coisas: **Linhas**,
 * **Colunas**, **Incremento** e **Seleções**. Elas ficam aqui, juntas, no topo
 * da tela, com os nomes exatamente como o `.DEF` os escreve e na ordem do
 * arquivo. Quem nunca usou lê, em cada bloco, uma frase dizendo para que serve,
 * e embaixo vê a tabela descrita em português ("Frequência por Caráter
 * segundo Sexo") antes de executar.
 *
 * Toda a regra mora em `packages/core/src/painel.ts`, que é testado e foi
 * conferido contra o TabWin 4.15 real. Este módulo só desenha e repassa.
 */

import type { CnvDefinition } from '../../../packages/formats/src/cnv-model.ts';
import type { DefDefinition } from '../../../packages/formats/src/def-model.ts';
import {
  formatTabwinElapsed,
  parseTabwinLog,
  serializeTabwinLog,
} from '../../../packages/formats/src/tabwin-log.ts';
import { describeDatasusFile } from '../../../packages/formats/src/datasus-file-names.ts';
import { datasusFieldEntry } from '../../../packages/formats/src/datasus-field-dictionary.ts';
import type {
  CompatibilityProfile,
  DimensionLookupDefinition,
  TabulationResult,
  TabulationSpec,
} from '../../../packages/core/src/model.ts';
import {
  FREQUENCIA_ID,
  PainelErro,
  catalogoDoDef,
  catalogoDosCampos,
  categoriasDoEixo,
  estadoDoLog,
  estadoInicial,
  logDoPainel,
  nomeBaseDoRecurso,
  specDoPainel,
  subtituloDoPainel,
  type PainelCatalogo,
  type PainelEixo,
  type PainelEstado,
} from '../../../packages/core/src/painel.ts';

export interface PainelArquivo {
  name: string;
  size: number;
}

export interface PainelDeps {
  defs(): ReadonlyMap<string, DefDefinition>;
  defAtivo(): string;
  escolherDef(nome: string): void;
  conversoes(): ReadonlyMap<string, CnvDefinition>;
  lookups(): ReadonlyMap<string, DimensionLookupDefinition>;
  /** Campos do arquivo aberto; `null` quando não há arquivo. */
  campos(): Array<{ name: string; type: string; length?: number; decimalCount?: number }> | null;
  rotuloDoCampo(campo: string): string;
  /** Sem DEF, o campo que a abertura escolheu como plausível (UF, município…). */
  campoInicial?(): string | undefined;
  arquivos(): PainelArquivo[];
  valoresDistintos(campo: string): Promise<{ values: string[]; truncated: boolean }>;
  /** As primeiras linhas do arquivo, só com os campos pedidos ("Ver arquivo .DBF"). */
  primeirosRegistros?(campos: string[], limite: number): Promise<Array<Record<string, unknown>>>;
  /** "Salvar registros": grava em DBF os registros que entraram na última tabela. */
  salvarRegistros?(): Promise<void>;
  /** "Testar CRC": confere cada DBC aberto contra o CRC-32 gravado nele. */
  testarCrc?(): Promise<Array<{ name: string; report: { ok: boolean; stored: string; computed: string } | null }>>;
  perfil(): CompatibilityProfile;
  executar(spec: TabulationSpec, info: { titulo?: string; subtitulo: string; linha: string; arquivos: string[] }): Promise<TabulationResult | null>;
  aviso(mensagem: string, erro?: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

const NOMES_DE_TIPO: Record<string, string> = { C: 'texto', N: 'número', F: 'número', D: 'data', L: 'sim/não', I: 'inteiro' };

/** "texto (6)", "número (10,2)": o tipo e o tamanho do campo como o DBF declara. */
function tipoDoCampo(campo: { type: string; length?: number; decimalCount?: number }): string {
  const nome = NOMES_DE_TIPO[campo.type] ?? campo.type;
  if (!campo.length) return nome;
  return campo.decimalCount ? `${nome} (${campo.length},${campo.decimalCount})` : `${nome} (${campo.length})`;
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Bloco {
  raiz: HTMLElement;
  corpo: HTMLElement;
}

function bloco(numero: string, titulo: string, dica: string, modificador: string): Bloco {
  const corpo = el('div', { className: 'painel-bloco-corpo' });
  const raiz = el('section', { className: `painel-bloco painel-bloco--${modificador}` },
    el('header', { className: 'painel-bloco-cabecalho' },
      el('span', { className: 'painel-bloco-numero', ariaHidden: 'true' }, numero),
      el('div', {}, el('h3', {}, titulo), el('p', {}, dica)),
    ),
    corpo,
  );
  return { raiz, corpo };
}

export interface Painel {
  /** Refaz as listas a partir do DEF, das CNV e do arquivo carregados agora. */
  atualizar(): void;
  /** Põe um log do TabWin (ou o topo de um `.TAB`) no painel. */
  restaurar(texto: string): void;
  /** Executa o estado atual (o padrão do TabWin, se ninguém mexeu). Diz se houve tabela. */
  executarAgora(): Promise<boolean>;
  /** O log do TabWin da última tabela feita pelo painel ('' sem nenhuma). */
  logAtual(): string;
}

/** "DADOS\\RD*.DBC" → "Feito para arquivos RD… (ex.: RDAC2401.dbc)". */
function padraoEmPortugues(padrao: string): string {
  const nome = padrao.replace(/\\/g, '/').split('/').pop() ?? padrao;
  const prefixo = nome.split('*')[0] ?? '';
  return prefixo
    ? `Este DEF é feito para os arquivos que começam com ${prefixo} (${nome})`
    : `Este DEF é feito para os arquivos ${nome}`;
}

export function criarPainel(raiz: HTMLElement, deps: PainelDeps): Painel {
  let catalogo: PainelCatalogo | null = null;
  let estado: PainelEstado | null = null;
  /** Categorias de campo bruto já lidas do arquivo, por id de eixo. */
  const valoresLidos = new Map<string, Array<{ id: string; label: string }>>();
  let selecaoEmFoco: string | null = null;
  let ultimoLog = '';
  /**
   * Enquanto ninguém mexeu, o painel segue o padrão do TabWin a cada recarga:
   * as CNV chegam uma a uma, e sem isto a "primeira linha disponível" seria a
   * da primeira CNV que terminou de carregar, não a primeira do DEF.
   */
  let tocado = false;

  // ---- Estrutura -------------------------------------------------------
  const defSelect = el('select', { id: 'painel-def', className: 'painel-def' });
  const defNota = el('p', { className: 'painel-def-nota' });
  const arquivosLista = el('ul', { className: 'painel-arquivos', ariaLabel: 'Arquivos da tabulação' });
  const padraoNota = el('p', { className: 'painel-padrao' });
  const verRegistros = el('button', { type: 'button', className: 'text-button', id: 'painel-ver-registros', title: 'Mostra os campos e as primeiras linhas do arquivo, como "Ver arquivo .DBF" do TabWin' }, 'Ver registros do arquivo');
  const registrosDialogo = el('dialog', { className: 'painel-registros', id: 'painel-registros' });

  const linhasBusca = el('input', { type: 'search', className: 'painel-busca', placeholder: 'Procurar…', ariaLabel: 'Procurar nas linhas' });
  const linhasLista = el('select', { id: 'painel-linhas', size: 9, ariaLabel: 'Linhas' });
  const colunasBusca = el('input', { type: 'search', className: 'painel-busca', placeholder: 'Procurar…', ariaLabel: 'Procurar nas colunas' });
  const colunasLista = el('select', { id: 'painel-colunas', size: 9, ariaLabel: 'Colunas' });
  const incrementosLista = el('div', { id: 'painel-incrementos', className: 'painel-checklist', role: 'group', ariaLabel: 'Incremento' });
  // Embaixo de Linhas e Colunas: o que a escolha vai virar ("5 linhas: < 7d ·
  // 07-27 · …"). Um nome do DEF como "Fx.Etar.Infant.1" não diz nada a quem
  // nunca o viu; as categorias dizem.
  const previaLinhas = el('p', { className: 'painel-previa', id: 'painel-previa-linhas', ariaLive: 'polite' });
  const previaColunas = el('p', { className: 'painel-previa', id: 'painel-previa-colunas', ariaLive: 'polite' });
  /**
   * Opções que não dá para usar com estes arquivos (campo que não existe, CNV
   * que não foi aberta) ficam fora das listas até a pessoa pedir: misturadas,
   * em cinza e com o motivo cortado, só confundiam.
   */
  let mostrarIndisponiveis = false;
  const botaoIndisponiveis = (): HTMLButtonElement => el('button', { type: 'button', className: 'text-button painel-indisponiveis' });
  const indisponiveisLinhas = botaoIndisponiveis();
  const indisponiveisColunas = botaoIndisponiveis();
  const indisponiveisSelecoes = botaoIndisponiveis();

  const disponiveisLista = el('select', { id: 'painel-selecoes-disponiveis', size: 6, ariaLabel: 'Seleções disponíveis' });
  const ativasLista = el('select', { id: 'painel-selecoes-ativas', size: 6, ariaLabel: 'Seleções ativas' });
  const incluirBotao = el('button', { type: 'button', className: 'secondary-button', id: 'painel-incluir', title: 'Incluir a seleção marcada entre as ativas' }, 'Incluir →');
  const excluirBotao = el('button', { type: 'button', className: 'secondary-button', id: 'painel-excluir', title: 'Tirar a seleção marcada das ativas' }, '← Excluir');
  const categoriasTitulo = el('h4', { className: 'painel-categorias-titulo' }, 'Categorias selecionadas');
  const categoriasBusca = el('input', { type: 'search', className: 'painel-busca', placeholder: 'Localizar categoria', ariaLabel: 'Localizar categoria' });
  const categoriasLista = el('div', { id: 'painel-categorias', className: 'painel-checklist painel-checklist--categorias', role: 'group', ariaLabel: 'Categorias selecionadas' });
  const marcarTodas = el('button', { type: 'button', className: 'text-button' }, 'Marcar todas');
  const limparCategorias = el('button', { type: 'button', className: 'text-button' }, 'Limpar');

  const suprimirLinhas = el('input', { type: 'checkbox', id: 'painel-suprimir-linhas' });
  const suprimirColunas = el('input', { type: 'checkbox', id: 'painel-suprimir-colunas' });
  const testarCrc = el('input', { type: 'checkbox', id: 'painel-testar-crc' });
  const salvarRegistros = el('input', { type: 'checkbox', id: 'painel-salvar-registros' });
  /**
   * Arquivos desmarcados na lista "Arquivos" (o TabWin tabula só os marcados).
   * Guarda os desmarcados, não os marcados, para que um arquivo novo entre
   * marcado, como no TabWin.
   */
  const arquivosDesmarcados = new Set<string>();
  const arquivosMarcados = (): PainelArquivo[] => deps.arquivos().filter((arquivo) => !arquivosDesmarcados.has(arquivo.name));
  /** Arquivos cujo CRC já foi conferido nesta sessão (nome + tamanho), e o resultado. */
  const crcConferido = new Map<string, boolean>();
  const naoClassIgnorar = el('input', { type: 'radio', name: 'painel-nao-classificados', value: 'ignorar', id: 'painel-nc-ignorar' });
  const naoClassIncluir = el('input', { type: 'radio', name: 'painel-nao-classificados', value: 'incluir', id: 'painel-nc-incluir' });
  const naoClassDiscriminar = el('input', { type: 'radio', name: 'painel-nao-classificados', value: 'discriminar', id: 'painel-nc-discriminar' });

  const resumo = el('p', { className: 'painel-resumo', id: 'painel-resumo', ariaLive: 'polite' });
  const erro = el('p', { className: 'painel-erro', id: 'painel-erro', role: 'alert' });
  erro.hidden = true;
  const executarBotao = el('button', { type: 'button', className: 'primary-button painel-executar', id: 'painel-executar' },
    el('span', {}, 'Executar'), el('span', { ariaHidden: 'true' }, '→'));

  const logTexto = el('textarea', { id: 'painel-log', className: 'painel-log', spellcheck: false, rows: 10, ariaLabel: 'Log no formato do TabWin' });
  const logCopiar = el('button', { type: 'button', className: 'secondary-button' }, 'Copiar log');
  const logRestaurar = el('button', { type: 'button', className: 'secondary-button', id: 'painel-restaurar', title: 'Refaz o painel a partir do log colado acima' }, 'Restaurar consulta');
  const logArquivo = el('input', { type: 'file', accept: '.tab,.TAB,.log,.txt', hidden: true, id: 'painel-log-arquivo' });
  const logAbrir = el('button', { type: 'button', className: 'secondary-button', title: 'Lê o log do topo de um .TAB salvo pelo TabWin' }, 'Abrir .TAB…');
  const logDetalhes = el('details', { className: 'painel-log-detalhes', id: 'painel-log-detalhes' },
    el('summary', {}, 'Log do TabWin ', el('span', {}, 'copiar, colar e restaurar consulta')),
    el('p', { className: 'painel-ajuda' },
      'O mesmo texto da janela "Log" do TabWin 4.15 e do topo de um arquivo .TAB. Cole aqui um log antigo, ou abra um .TAB, e use ',
      el('b', {}, 'Restaurar consulta'), ' para remontar o painel.'),
    logTexto,
    el('div', { className: 'painel-log-acoes' }, logCopiar, logAbrir, logRestaurar, logArquivo),
  );

  const linhas = bloco('1', 'Linhas', 'O que vira cada linha da tabela: município, sexo, faixa etária…', 'linhas');
  linhas.corpo.append(linhasBusca, linhasLista, previaLinhas, indisponiveisLinhas);
  const colunas = bloco('2', 'Colunas', 'Opcional. Abre cada linha em colunas (ex.: por sexo). "Não ativa" = uma coluna só.', 'colunas');
  colunas.corpo.append(colunasBusca, colunasLista, previaColunas, indisponiveisColunas);
  const incremento = bloco('3', 'Incremento', 'O número de cada célula: Frequência conta os registros; os outros somam um valor.', 'incremento');
  incremento.corpo.append(incrementosLista);
  const selecoes = bloco('4', 'Seleções', 'Filtros (opcional). Escolha uma variável, clique em Incluir e marque as categorias que entram — ex.: só um município. Duplo clique também inclui ou exclui.', 'selecoes');
  selecoes.corpo.append(
    el('div', { className: 'painel-selecoes-grade' },
      el('div', { className: 'painel-sublista' }, el('label', { htmlFor: 'painel-selecoes-disponiveis' }, 'Disponíveis'), disponiveisLista, indisponiveisSelecoes),
      el('div', { className: 'painel-selecoes-botoes' }, incluirBotao, excluirBotao),
      el('label', { className: 'painel-sublista' }, el('span', {}, 'Ativas'), ativasLista),
    ),
    el('div', { className: 'painel-categorias' },
      categoriasTitulo,
      categoriasBusca,
      categoriasLista,
      el('div', { className: 'painel-categorias-acoes' }, marcarTodas, limparCategorias),
    ),
  );

  // Cada opção diz em poucas palavras o que faz: quem vem do TabWin reconhece
  // o nome, quem nunca usou entende sem abrir o manual.
  const opcao = (caixa: HTMLElement, nome: string, oQueFaz: string, titulo?: string): HTMLElement =>
    el('label', { className: 'check-label painel-opcao', ...(titulo ? { title: titulo } : {}) }, caixa,
      el('span', {}, nome, el('small', { className: 'painel-opcao-ajuda' }, oQueFaz)));
  const opcoes = el('div', { className: 'painel-opcoes' },
    opcao(suprimirLinhas, 'Suprimir linhas zeradas', 'esconde as linhas com 0'),
    opcao(suprimirColunas, 'Suprimir colunas zeradas', 'esconde as colunas com 0'),
    opcao(salvarRegistros, 'Salvar registros', 'baixa os registros usados na tabela (DBF)',
      'Depois de tabular, grava num DBF os registros que passaram pelas Seleções, como a caixa do TabWin'),
    opcao(testarCrc, 'Testar CRC', 'confere se o arquivo DBC não está corrompido',
      'Antes de tabular, confere se cada DBC descomprime exatamente no DBF original (CRC-32 gravado no arquivo), como a caixa do TabWin'),
    el('fieldset', { className: 'painel-nao-classificados', title: 'Registros cujo código não está na tabela de conversão (CNV)' },
      el('legend', {}, 'Não classificados ', el('small', { className: 'painel-opcao-ajuda' }, 'códigos que a tabela de conversão não reconhece')),
      opcao(naoClassIgnorar, 'Ignorar', 'ficam fora da tabela'),
      opcao(naoClassIncluir, 'Incluir', 'somados numa linha "Não classificados"'),
      opcao(naoClassDiscriminar, 'Discriminar', 'uma linha para cada código',
        'Uma linha para cada código sem correspondência (só em CNV literal, como no TabWin)'),
    ),
  );

  raiz.replaceChildren(
    el('div', { className: 'painel-topo' },
      el('div', { className: 'painel-titulo' },
        el('span', { className: 'eyebrow' }, 'Painel de tabulação'),
        el('h2', {}, 'Monte a tabela'),
      ),
      el('label', { className: 'painel-def-campo', title: 'O DEF é o "cardápio" do sistema: diz o que pode ir em Linhas, Colunas, Incremento e Seleções, com os nomes do TabWin' },
        el('span', {}, 'Definição (DEF) ', el('small', { className: 'painel-opcao-ajuda' }, 'o "cardápio" de variáveis')), defSelect, defNota),
      el('div', { className: 'painel-arquivos-campo' }, el('span', {}, 'Arquivos de dados'), arquivosLista, padraoNota, verRegistros),
    ),
    el('div', { className: 'painel-grade' }, linhas.raiz, colunas.raiz, incremento.raiz, selecoes.raiz),
    opcoes,
    el('div', { className: 'painel-rodape' }, resumo, executarBotao),
    erro,
    logDetalhes,
    registrosDialogo,
  );

  // ---- Renderização ----------------------------------------------------
  function recursos() {
    const conversoes = deps.conversoes();
    const lookups = deps.lookups();
    return {
      conversao: (arquivo: string) => [...conversoes.keys()].find((nome) => nomeBaseDoRecurso(nome) === nomeBaseDoRecurso(arquivo)),
      lookup: (arquivo: string) => [...lookups.keys()].find((nome) => nomeBaseDoRecurso(nome) === nomeBaseDoRecurso(arquivo)),
    };
  }

  function montarCatalogo(): PainelCatalogo | null {
    const campos = deps.campos();
    const defNome = deps.defAtivo();
    const def = defNome ? deps.defs().get(defNome) : undefined;
    if (def) {
      const nomes = campos ? new Set(campos.map((campo) => campo.name.toUpperCase())) : undefined;
      return catalogoDoDef(def, recursos(), nomes);
    }
    if (!campos) return null;
    return catalogoDosCampos(campos, (campo) => deps.rotuloDoCampo(campo));
  }

  function rotuloOpcao(eixo: PainelEixo): string {
    return eixo.disponivel ? eixo.label : `${eixo.label} — ${eixo.motivo ?? 'indisponível'}`;
  }

  /** O botão que mostra ou esconde as indisponíveis de uma lista. */
  function rotularIndisponiveis(botao: HTMLButtonElement, quantas: number): void {
    botao.hidden = quantas === 0;
    botao.textContent = mostrarIndisponiveis
      ? 'Esconder as que não dá para usar'
      : `+ ${quantas} que não dá para usar com estes arquivos`;
    botao.title = 'Variáveis do DEF cujo campo não existe nestes arquivos, ou cuja tabela de conversão (CNV) não foi aberta';
  }

  function preencherLista(lista: HTMLSelectElement, eixos: readonly PainelEixo[], escolhido: string | null, filtro: string, naoAtiva = false, botao?: HTMLButtonElement): void {
    const termo = semAcento(filtro.trim());
    lista.replaceChildren();
    if (naoAtiva) lista.add(new Option('Não ativa', '', false, escolhido === null));
    const fora: PainelEixo[] = [];
    for (const eixo of eixos) {
      const visivel = !termo || semAcento(`${eixo.label} ${eixo.field}`).includes(termo) || eixo.id === escolhido;
      if (!visivel) continue;
      if (!eixo.disponivel) { fora.push(eixo); continue; }
      const option = new Option(eixo.label, eixo.id, false, eixo.id === escolhido);
      // Passar o mouse diz o que a opção é: as categorias que ela gera
      // ("Oport invetig (120d)" → "Até 120 dias (invest oportuna) · 121 a 150 dias…").
      option.title = dicaDaOpcao(eixo);
      lista.add(option);
    }
    // As indisponíveis, quando pedidas, vão juntas no fim, num grupo com nome.
    if (mostrarIndisponiveis && fora.length) {
      const grupo = document.createElement('optgroup');
      grupo.label = 'Não dá para usar com estes arquivos';
      for (const eixo of fora) {
        const option = new Option(rotuloOpcao(eixo), eixo.id);
        option.disabled = true;
        option.title = eixo.motivo ?? '';
        grupo.append(option);
      }
      lista.append(grupo);
    }
    if (botao) rotularIndisponiveis(botao, fora.length);
  }

  /** O sistema dos arquivos abertos, pelo nome (`DOINF23.dbc` → SIM): escolhe o dicionário. */
  function sistemaDosArquivos(): string | undefined {
    return deps.arquivos().map((arquivo) => describeDatasusFile(arquivo.name)?.system).find(Boolean);
  }

  /** O que o dicionário oficial do DATASUS diz do campo, quando diz. */
  function explicacao(campo: string): ReturnType<typeof datasusFieldEntry> {
    return campo ? datasusFieldEntry(campo, sistemaDosArquivos()) : undefined;
  }

  /** Amostra de categorias por tabela (CNV ou DBF já lido), feita uma vez só. */
  const amostras = new WeakMap<object, string>();

  function dicaDaOpcao(eixo: PainelEixo): string {
    const recurso = eixo.conversionId ? deps.conversoes().get(eixo.conversionId)
      : eixo.lookupId ? deps.lookups().get(eixo.lookupId) : undefined;
    let amostra = recurso ? amostras.get(recurso) : undefined;
    if (amostra === undefined) {
      amostra = amostraDe(eixo);
      if (recurso) amostras.set(recurso, amostra);
    }
    const origem = [eixo.field && `campo ${eixo.field}`, eixo.resourceFile && `tabela ${eixo.resourceFile.replace(/\\/g, '/').split('/').pop()}`].filter(Boolean).join(', ');
    const oficial = explicacao(eixo.field);
    return [
      `${eixo.label}: ${amostra}`,
      oficial ? `${oficial.entry.label} — ${oficial.entry.description}` : '',
      origem,
    ].filter(Boolean).join('\n');
  }

  function amostraDe(eixo: PainelEixo): string {
    const categorias = categoriasDe(eixo);
    return categorias?.length
      ? `${categorias.slice(0, 5).map((categoria) => categoria.label.trim()).join(' · ')}${categorias.length > 5 ? ` … (${categorias.length.toLocaleString('pt-BR')} ao todo)` : ''}`
      : 'um item para cada valor do campo';
  }

  /** "5 linhas: < 7d · 07-27 · 28d-<1 · Ign <1 · Ign", e de onde vêm. */
  function renderPrevia(destino: HTMLElement, eixo: PainelEixo | undefined, papel: 'linhas' | 'colunas'): void {
    destino.replaceChildren();
    if (!eixo) {
      destino.append(papel === 'colunas' ? 'Sem colunas: uma coluna só, com o total de cada linha.' : '');
      return;
    }
    const categorias = categoriasDe(eixo);
    const origem = [eixo.field && `campo ${eixo.field}`, eixo.resourceFile && `tabela ${eixo.resourceFile.replace(/\\/g, '/').split('/').pop()}`].filter(Boolean).join(', ');
    if (categorias?.length) {
      const amostra = categorias.slice(0, 6).map((categoria) => categoria.label.trim()).join(' · ');
      destino.append(el('b', {}, `${categorias.length.toLocaleString('pt-BR')} ${papel}: `), amostra, categorias.length > 6 ? ' …' : '');
    } else {
      destino.append(el('b', {}, `Uma ${papel === 'linhas' ? 'linha' : 'coluna'} para cada valor`), ' que aparecer no arquivo');
    }
    if (origem) destino.append(el('small', {}, origem));
    // A explicação oficial do campo, quando o dicionário do DATASUS a tem:
    // "STDONOVA" vira "DO nova — Se a declaração de óbito é do modelo novo".
    const oficial = explicacao(eixo.field);
    if (oficial) {
      destino.append(el('span', {
        className: 'painel-previa-dicionario',
        title: [oficial.entry.values && `Valores: ${oficial.entry.values}`, `Fonte: ${oficial.source}`].filter(Boolean).join('\n'),
      }, el('b', {}, `${oficial.entry.label}: `), oficial.entry.description));
    }
  }

  function renderDef(): void {
    const defs = deps.defs();
    const ativo = deps.defAtivo();
    defSelect.replaceChildren(new Option('Sem DEF — campos do próprio arquivo', ''));
    for (const [nome, def] of [...defs].sort(([a], [b]) => a.localeCompare(b))) {
      const descricao = def.description?.trim();
      defSelect.add(new Option(descricao ? `${nome} — ${descricao}` : nome, nome, false, nome === ativo));
    }
    defSelect.value = defs.has(ativo) ? ativo : '';
    const def = defs.get(ativo);
    defNota.textContent = def
      ? `${new Set(def.options.map((option) => option.label)).size} variáveis para cruzar${def.increments.length ? ` e ${def.increments.length} ${def.increments.length === 1 ? 'valor' : 'valores'} para somar` : ''}`
      : defs.size
        ? 'Escolha o DEF para ver as variáveis com os nomes do TabWin.'
        : 'Sem DEF, as listas mostram os campos do arquivo. Abra o .DEF e as .CNV do sistema para ver os nomes do TabWin.';
  }

  function renderArquivos(): void {
    const arquivos = deps.arquivos();
    arquivosLista.replaceChildren(
      ...(arquivos.length
        ? arquivos.map((arquivo) => {
          const crc = crcConferido.get(`${arquivo.name}:${arquivo.size}`);
          const marcado = !arquivosDesmarcados.has(arquivo.name);
          // Com um arquivo só não há o que escolher; com vários, cada um vira
          // uma caixa, como a lista de seleção múltipla do TabWin.
          const caixa = arquivos.length > 1
            ? [el('input', {
              type: 'checkbox', checked: marcado, title: 'Entra na tabulação',
              onchange: (evento: Event) => {
                if ((evento.target as HTMLInputElement).checked) arquivosDesmarcados.delete(arquivo.name);
                else arquivosDesmarcados.add(arquivo.name);
                renderArquivos();
              },
            })]
            : [];
          // O nome original primeiro (é por ele que as pessoas se entendem), e
          // logo abaixo o que ele é, para quem não decorou as siglas.
          const descricao = describeDatasusFile(arquivo.name)?.summary;
          return el('li', { title: `${arquivo.name} · ${formatarBytes(arquivo.size)}`, className: [crc === false ? 'painel-crc-falhou' : '', marcado ? '' : 'painel-arquivo-fora'].join(' ').trim() },
            el('label', { className: 'painel-arquivo' }, ...caixa, el('b', {}, arquivo.name)), el('small', {}, formatarBytes(arquivo.size)),
            ...(descricao ? [el('small', { className: 'painel-arquivo-descricao' }, descricao)] : []),
            ...(crc === undefined ? [] : [el('small', { className: crc ? 'painel-crc-ok' : 'painel-crc-erro' }, crc ? 'CRC ok' : 'CRC não confere')]));
        })
        : [el('li', { className: 'painel-vazio' }, 'Nenhum arquivo de dados aberto')]),
    );
    padraoNota.textContent = catalogo?.padraoArquivos ? padraoEmPortugues(catalogo.padraoArquivos) : '';
    padraoNota.hidden = !catalogo?.padraoArquivos;
    verRegistros.hidden = !arquivos.length || !deps.primeirosRegistros;
  }

  function renderIncrementos(): void {
    if (!catalogo || !estado) return;
    incrementosLista.replaceChildren();
    for (const incremento of catalogo.incrementos) {
      const caixa = el('input', { type: 'checkbox', value: incremento.id, checked: estado.incrementos.includes(incremento.id) });
      caixa.addEventListener('change', () => {
        if (!estado) return;
        const marcados = new Set(estado.incrementos);
        if (caixa.checked) marcados.add(incremento.id); else marcados.delete(incremento.id);
        // Mantém a ordem da lista, que é a ordem das colunas no TabWin (G017).
        estado.incrementos = catalogo!.incrementos.map((item) => item.id).filter((id) => marcados.has(id));
        renderResumo();
      });
      const detalhe = incremento.measure.kind === 'sum'
        ? `soma o campo ${incremento.measure.field ?? ''}`
        : (incremento.measure.weightField ? `conta pelo campo ${incremento.measure.weightField}` : 'conta os registros');
      incrementosLista.append(el('label', { className: 'check-label' }, caixa, el('span', {}, incremento.label, el('small', {}, detalhe))));
    }
  }

  function categoriasDe(eixo: PainelEixo): Array<{ id: string; label: string }> | null {
    return categoriasDoEixo(eixo, deps.conversoes(), deps.lookups()) ?? valoresLidos.get(eixo.id) ?? null;
  }

  function renderSelecoes(): void {
    if (!catalogo || !estado) return;
    const ativas = new Set(estado.selecoes.map((selecao) => selecao.eixo));
    preencherLista(disponiveisLista, catalogo.selecoes.filter((eixo) => !ativas.has(eixo.id)), null, '', false, indisponiveisSelecoes);
    ativasLista.replaceChildren();
    for (const selecao of estado.selecoes) {
      const eixo = catalogo.selecoes.find((item) => item.id === selecao.eixo);
      if (!eixo) continue;
      const contagem = selecao.categorias.length ? ` (${selecao.categorias.length})` : ' (nenhuma)';
      ativasLista.add(new Option(`${eixo.label}${contagem}`, eixo.id, false, eixo.id === selecaoEmFoco));
    }
    if (selecaoEmFoco && !ativas.has(selecaoEmFoco)) selecaoEmFoco = null;
    void renderCategorias();
  }

  async function renderCategorias(): Promise<void> {
    categoriasLista.replaceChildren();
    const selecao = estado?.selecoes.find((item) => item.eixo === selecaoEmFoco);
    const eixo = selecao ? catalogo?.selecoes.find((item) => item.id === selecao.eixo) : undefined;
    marcarTodas.disabled = !eixo;
    limparCategorias.disabled = !eixo;
    categoriasBusca.disabled = !eixo;
    if (!selecao || !eixo) {
      categoriasTitulo.textContent = 'Categorias selecionadas';
      categoriasLista.append(el('p', { className: 'painel-vazio' },
        estado?.selecoes.length ? 'Clique numa seleção ativa para marcar as categorias.' : 'Inclua uma seleção para filtrar a tabela.'));
      return;
    }
    categoriasTitulo.textContent = `Categorias de ${eixo.label}`;
    let lista = categoriasDe(eixo);
    if (!lista) {
      categoriasLista.append(el('p', { className: 'painel-vazio' }, 'Lendo os valores do arquivo…'));
      try {
        const lidos = await deps.valoresDistintos(eixo.field);
        lista = lidos.values.map((valor) => ({ id: valor, label: valor || '(em branco)' }));
        valoresLidos.set(eixo.id, lista);
      } catch (motivo) {
        categoriasLista.replaceChildren(el('p', { className: 'painel-erro' }, motivo instanceof Error ? motivo.message : String(motivo)));
        return;
      }
      if (selecaoEmFoco !== eixo.id) return;
      categoriasLista.replaceChildren();
    }
    const termo = semAcento(categoriasBusca.value.trim());
    const marcadas = new Set(selecao.categorias);
    for (const categoria of lista) {
      if (termo && !semAcento(`${categoria.label} ${categoria.id}`).includes(termo)) continue;
      const caixa = el('input', { type: 'checkbox', value: categoria.id, checked: marcadas.has(categoria.id) });
      caixa.addEventListener('change', () => {
        const atual = new Set(selecao.categorias);
        if (caixa.checked) atual.add(categoria.id); else atual.delete(categoria.id);
        selecao.categorias = lista!.map((item) => item.id).filter((id) => atual.has(id));
        atualizarContagemAtiva();
        renderResumo();
      });
      categoriasLista.append(el('label', { className: 'check-label' }, caixa, el('span', {}, categoria.label)));
    }
    if (!categoriasLista.children.length) categoriasLista.append(el('p', { className: 'painel-vazio' }, 'Nenhuma categoria com esse nome.'));
  }

  function atualizarContagemAtiva(): void {
    if (!catalogo || !estado) return;
    for (const option of [...ativasLista.options]) {
      const selecao = estado.selecoes.find((item) => item.eixo === option.value);
      const eixo = catalogo.selecoes.find((item) => item.id === option.value);
      if (!selecao || !eixo) continue;
      option.text = `${eixo.label}${selecao.categorias.length ? ` (${selecao.categorias.length})` : ' (nenhuma)'}`;
    }
  }

  function renderResumo(): void {
    erro.hidden = true;
    if (!catalogo || !estado || !deps.campos()) {
      resumo.textContent = 'Abra um arquivo de dados (DBC ou DBF) para tabular.';
      executarBotao.disabled = true;
      return;
    }
    executarBotao.disabled = false;
    const partes = [subtituloDoPainel(catalogo, estado, 'modern')];
    for (const selecao of estado.selecoes) {
      const eixo = catalogo.selecoes.find((item) => item.id === selecao.eixo);
      if (!eixo) continue;
      const lista = categoriasDe(eixo);
      const nomes = selecao.categorias.map((id) => lista?.find((item) => item.id === id)?.label ?? id);
      partes.push(`${eixo.label}: ${nomes.length ? (nomes.length > 4 ? `${nomes.slice(0, 4).join(', ')} e mais ${nomes.length - 4}` : nomes.join(', ')) : 'nenhuma categoria marcada'}`);
    }
    resumo.replaceChildren(el('b', {}, 'Vai tabular: '), partes.join(' · '));
  }

  function renderTudo(): void {
    renderDef();
    renderArquivos();
    if (!catalogo || !estado) {
      for (const lista of [linhasLista, colunasLista, disponiveisLista, ativasLista]) lista.replaceChildren();
      incrementosLista.replaceChildren();
      categoriasLista.replaceChildren();
      renderResumo();
      return;
    }
    preencherLista(linhasLista, catalogo.linhas, estado.linha, linhasBusca.value, false, indisponiveisLinhas);
    preencherLista(colunasLista, catalogo.colunas, estado.coluna, colunasBusca.value, true, indisponiveisColunas);
    renderPrevias();
    renderIncrementos();
    renderSelecoes();
    suprimirLinhas.checked = estado.suprimirLinhasZeradas;
    suprimirColunas.checked = estado.suprimirColunasZeradas;
    naoClassIgnorar.checked = estado.naoClassificados === 'ignorar';
    naoClassIncluir.checked = estado.naoClassificados === 'incluir';
    naoClassDiscriminar.checked = estado.naoClassificados === 'discriminar';
    renderResumo();
  }

  function renderPrevias(): void {
    if (!catalogo || !estado) return;
    renderPrevia(previaLinhas, catalogo.linhas.find((eixo) => eixo.id === estado!.linha), 'linhas');
    renderPrevia(previaColunas, catalogo.colunas.find((eixo) => eixo.id === estado!.coluna), 'colunas');
  }

  function existe(lista: readonly PainelEixo[], id: string | null): boolean {
    return id === null || lista.some((eixo) => eixo.id === id && eixo.disponivel);
  }

  function atualizar(): void {
    const anterior = catalogo;
    catalogo = montarCatalogo();
    raiz.hidden = !catalogo && !deps.defs().size;
    if (!catalogo) {
      estado = null;
      renderTudo();
      return;
    }
    if (!estado || !tocado || anterior?.origem !== catalogo.origem || !existe(catalogo.linhas, estado.linha)) {
      // Troca de DEF ou de arquivo: começa como o TabWin começa.
      estado = estadoInicial(catalogo);
      const campo = catalogo.origem === 'campos' ? deps.campoInicial?.() : undefined;
      const eixoDoCampo = campo ? catalogo.linhas.find((eixo) => eixo.field === campo) : undefined;
      if (eixoDoCampo) estado.linha = eixoDoCampo.id;
      valoresLidos.clear();
      selecaoEmFoco = null;
    } else {
      if (!existe(catalogo.colunas, estado.coluna)) estado.coluna = null;
      estado.incrementos = estado.incrementos.filter((id) => catalogo!.incrementos.some((item) => item.id === id));
      if (!estado.incrementos.length) estado.incrementos = [FREQUENCIA_ID];
      estado.selecoes = estado.selecoes.filter((selecao) => catalogo!.selecoes.some((eixo) => eixo.id === selecao.eixo));
    }
    renderTudo();
  }

  // ---- Eventos ---------------------------------------------------------
  // Qualquer escolha feita à mão congela o estado; trocar o DEF libera de novo.
  raiz.addEventListener('change', (evento) => { if (evento.target !== defSelect) tocado = true; });
  raiz.addEventListener('click', (evento) => {
    if ((evento.target as HTMLElement).closest('.painel-selecoes-botoes, .painel-categorias-acoes')) tocado = true;
  });
  defSelect.addEventListener('change', () => { tocado = false; deps.escolherDef(defSelect.value); });
  linhasBusca.addEventListener('input', () => catalogo && estado && preencherLista(linhasLista, catalogo.linhas, estado.linha, linhasBusca.value, false, indisponiveisLinhas));
  colunasBusca.addEventListener('input', () => catalogo && estado && preencherLista(colunasLista, catalogo.colunas, estado.coluna, colunasBusca.value, true, indisponiveisColunas));
  for (const botao of [indisponiveisLinhas, indisponiveisColunas, indisponiveisSelecoes]) {
    botao.addEventListener('click', () => {
      mostrarIndisponiveis = !mostrarIndisponiveis;
      renderTudo();
    });
  }
  linhasLista.addEventListener('change', () => {
    if (!estado || !linhasLista.value) return;
    estado.linha = linhasLista.value;
    renderPrevias();
    renderResumo();
  });
  colunasLista.addEventListener('change', () => {
    if (!estado) return;
    estado.coluna = colunasLista.value || null;
    renderPrevias();
    renderResumo();
  });

  function incluirSelecao(): void {
    if (!estado || !disponiveisLista.value) return;
    const id = disponiveisLista.value;
    if (!estado.selecoes.some((selecao) => selecao.eixo === id)) estado.selecoes.push({ eixo: id, categorias: [] });
    selecaoEmFoco = id;
    categoriasBusca.value = '';
    renderSelecoes();
    renderResumo();
  }
  function excluirSelecao(): void {
    if (!estado || !ativasLista.value) return;
    estado.selecoes = estado.selecoes.filter((selecao) => selecao.eixo !== ativasLista.value);
    selecaoEmFoco = estado.selecoes.at(-1)?.eixo ?? null;
    renderSelecoes();
    renderResumo();
  }
  incluirBotao.addEventListener('click', incluirSelecao);
  excluirBotao.addEventListener('click', excluirSelecao);
  disponiveisLista.addEventListener('dblclick', incluirSelecao);
  ativasLista.addEventListener('dblclick', excluirSelecao);
  ativasLista.addEventListener('change', () => {
    selecaoEmFoco = ativasLista.value || null;
    categoriasBusca.value = '';
    void renderCategorias();
  });
  categoriasBusca.addEventListener('input', () => void renderCategorias());
  marcarTodas.addEventListener('click', () => {
    const selecao = estado?.selecoes.find((item) => item.eixo === selecaoEmFoco);
    const eixo = selecao && catalogo?.selecoes.find((item) => item.id === selecao.eixo);
    const lista = eixo ? categoriasDe(eixo) : null;
    if (!selecao || !lista) return;
    selecao.categorias = lista.map((item) => item.id);
    atualizarContagemAtiva();
    void renderCategorias();
    renderResumo();
  });
  limparCategorias.addEventListener('click', () => {
    const selecao = estado?.selecoes.find((item) => item.eixo === selecaoEmFoco);
    if (!selecao) return;
    selecao.categorias = [];
    atualizarContagemAtiva();
    void renderCategorias();
    renderResumo();
  });
  suprimirLinhas.addEventListener('change', () => { if (estado) estado.suprimirLinhasZeradas = suprimirLinhas.checked; });
  suprimirColunas.addEventListener('change', () => { if (estado) estado.suprimirColunasZeradas = suprimirColunas.checked; });
  for (const radio of [naoClassIgnorar, naoClassIncluir, naoClassDiscriminar]) {
    radio.addEventListener('change', () => { if (estado && radio.checked) estado.naoClassificados = radio.value as PainelEstado['naoClassificados']; });
  }

  function rotuloDaCategoria(eixo: PainelEixo, id: string): string {
    return categoriasDe(eixo)?.find((item) => item.id === id)?.label ?? id;
  }

  async function executar(): Promise<boolean> {
    if (!catalogo || !estado) return false;
    erro.hidden = true;
    let spec: TabulationSpec;
    try {
      if (!arquivosMarcados().length) throw new PainelErro('Selecione ao menos um arquivo.');
      spec = specDoPainel(catalogo, estado, deps.perfil());
    } catch (motivo) {
      const mensagem = motivo instanceof Error ? motivo.message : String(motivo);
      erro.textContent = mensagem;
      erro.hidden = false;
      if (!(motivo instanceof PainelErro)) deps.aviso(mensagem, true);
      return false;
    }
    const inicio = performance.now();
    executarBotao.disabled = true;
    try {
      if (testarCrc.checked && deps.testarCrc) {
        const pendentes = arquivosMarcados().some((arquivo) => !crcConferido.has(`${arquivo.name}:${arquivo.size}`));
        if (pendentes) {
          resumo.textContent = 'Testando o CRC dos arquivos…';
          const tamanhos = new Map(deps.arquivos().map((arquivo) => [arquivo.name, arquivo.size]));
          for (const { name, report } of await deps.testarCrc()) {
            if (report) crcConferido.set(`${name}:${tamanhos.get(name) ?? 0}`, report.ok);
          }
          renderArquivos();
          renderResumo();
        }
        const ruins = arquivosMarcados().filter((arquivo) => crcConferido.get(`${arquivo.name}:${arquivo.size}`) === false);
        if (ruins.length) {
          erro.textContent = `${ruins.map((arquivo) => arquivo.name).join(', ')}: CRC não confere — o arquivo está corrompido ou incompleto. Baixe de novo antes de tabular.`;
          erro.hidden = false;
          return false;
        }
      }
      const subtitulo = subtituloDoPainel(catalogo, estado, deps.perfil());
      const linha = catalogo.linhas.find((eixo) => eixo.id === estado!.linha)?.label ?? '';
      const resultado = await deps.executar(spec, {
        ...(catalogo.titulo ? { titulo: catalogo.titulo } : {}), subtitulo, linha,
        arquivos: arquivosMarcados().map((arquivo) => arquivo.name),
      });
      if (!resultado) return false;
      const defNome = deps.defAtivo();
      ultimoLog = serializeTabwinLog(logDoPainel(catalogo, estado, {
        ...(defNome ? { def: defNome } : {}),
        ...(catalogo.padraoArquivos ? { padrao: catalogo.padraoArquivos } : {}),
        arquivos: arquivosMarcados().map((arquivo) => arquivo.name),
        registros: resultado.recordsSeen,
        tempo: formatTabwinElapsed(performance.now() - inicio),
      }, rotuloDaCategoria, deps.perfil()));
      logTexto.value = ultimoLog.replace(/\r\n/g, '\n');
      if (salvarRegistros.checked && deps.salvarRegistros) await deps.salvarRegistros();
      return true;
    } finally {
      executarBotao.disabled = false;
    }
  }
  executarBotao.addEventListener('click', () => { tocado = true; void executar(); });

  logCopiar.addEventListener('click', async () => {
    const texto = logTexto.value.replace(/\r?\n/g, '\r\n');
    if (!texto.trim()) { deps.aviso('Execute uma tabulação para gerar o log.'); return; }
    try {
      await navigator.clipboard.writeText(texto);
      deps.aviso('Log copiado — cola no Bloco de Notas, num e-mail ou num .TAB.');
    } catch {
      logTexto.select();
      deps.aviso('Selecionei o log; use Ctrl+C para copiar.');
    }
  });

  function restaurar(texto: string): void {
    if (!catalogo) {
      deps.aviso('Abra o arquivo de dados e o DEF antes de restaurar a consulta.', true);
      return;
    }
    const log = parseTabwinLog(texto);
    if (log.def) {
      const nomeDoLog = nomeBaseDoRecurso(log.def);
      const def = [...deps.defs().keys()].find((nome) => nomeBaseDoRecurso(nome) === nomeDoLog);
      if (def && def !== deps.defAtivo()) {
        deps.escolherDef(def);
        catalogo = montarCatalogo();
      }
    }
    if (!catalogo) return;
    const { estado: restaurado, avisos } = estadoDoLog(catalogo, log, categoriasDe);
    // [Arquivos] do log: marca os que estão abertos; avisa dos que não estão.
    if (log.files.length) {
      const abertos = deps.arquivos().map((arquivo) => arquivo.name);
      const pedidos = new Set(log.files.map((nome) => nome.toLowerCase()));
      arquivosDesmarcados.clear();
      for (const nome of abertos) if (!pedidos.has(nome.toLowerCase())) arquivosDesmarcados.add(nome);
      const faltando = log.files.filter((nome) => !abertos.some((aberto) => aberto.toLowerCase() === nome.toLowerCase()));
      if (faltando.length) avisos.push(`Arquivo(s) do log não abertos: ${faltando.join(', ')}.`);
      if (abertos.every((nome) => arquivosDesmarcados.has(nome))) arquivosDesmarcados.clear();
    }
    estado = restaurado;
    tocado = true;
    selecaoEmFoco = estado.selecoes[0]?.eixo ?? null;
    logTexto.value = texto.replace(/\r\n/g, '\n');
    renderTudo();
    if (avisos.length) {
      erro.textContent = `Consulta restaurada com avisos: ${avisos.join(' ')}`;
      erro.hidden = false;
    } else {
      deps.aviso('Consulta restaurada. Confira e clique em Executar.');
    }
  }

  logRestaurar.addEventListener('click', () => {
    if (!logTexto.value.trim()) { deps.aviso('Cole um log do TabWin no quadro, ou abra um .TAB.', true); return; }
    restaurar(logTexto.value);
  });
  logAbrir.addEventListener('click', () => logArquivo.click());
  logArquivo.addEventListener('change', async () => {
    const arquivo = logArquivo.files?.[0];
    logArquivo.value = '';
    if (!arquivo) return;
    const texto = new TextDecoder('windows-1252').decode(await arquivo.arrayBuffer());
    logDetalhes.open = true;
    restaurar(texto);
  });

  /**
   * "Ver arquivo .DBF": o DBF como ele é — um campo por coluna, com tipo e
   * tamanho, e as primeiras linhas. É a melhor resposta para "o que tem dentro
   * deste arquivo?" e mostra a quem está começando que o DEF e a CNV só dão
   * nome ao que já está ali.
   */
  async function abrirRegistros(): Promise<void> {
    const campos = deps.campos();
    if (!campos || !deps.primeirosRegistros) return;
    const LIMITE = 50;
    const usados = new Map<string, string[]>();
    for (const eixo of [...(catalogo?.linhas ?? []), ...(catalogo?.colunas ?? []), ...(catalogo?.selecoes ?? [])]) {
      const nomes = usados.get(eixo.field.toUpperCase()) ?? [];
      if (!nomes.includes(eixo.label)) nomes.push(eixo.label);
      usados.set(eixo.field.toUpperCase(), nomes);
    }
    registrosDialogo.replaceChildren(
      el('header', { className: 'painel-registros-topo' },
        el('div', {}, el('h2', {}, 'Registros do arquivo'),
          el('p', {}, `${deps.arquivos().map((arquivo) => arquivo.name).join(' + ')} · ${campos.length} campos · primeiras ${LIMITE} linhas. `,
            'Cada linha é um registro (uma internação, um óbito…); cada coluna, um campo do DBF. O nome em cima é o do arquivo; embaixo, o nome que o DEF dá e, no SIM e no SINASC, o que o dicionário oficial diz (passe o mouse para a explicação completa).')),
        el('button', { type: 'button', className: 'secondary-button', onclick: () => registrosDialogo.close() }, 'Fechar'),
      ),
      el('p', { className: 'painel-vazio' }, 'Lendo…'),
    );
    registrosDialogo.showModal();
    try {
      const linhas = await deps.primeirosRegistros(campos.map((campo) => campo.name), LIMITE);
      const tabela = el('table', { className: 'painel-registros-tabela' });
      const cabeca = el('tr');
      cabeca.append(el('th', { scope: 'col' }, '#'));
      for (const campo of campos) {
        const rotulos = usados.get(campo.name.toUpperCase());
        const oficial = explicacao(campo.name);
        cabeca.append(el('th', {
          scope: 'col',
          title: [rotulos?.join(' · '), oficial && `${oficial.entry.label}: ${oficial.entry.description}`, oficial?.entry.values && `Valores: ${oficial.entry.values}`].filter(Boolean).join('\n'),
        },
          el('b', {}, campo.name),
          el('small', {}, tipoDoCampo(campo)),
          ...(rotulos ? [el('em', {}, rotulos[0]!)] : []),
          ...(oficial ? [el('small', { className: 'painel-registros-oque' }, oficial.entry.label)] : [])));
      }
      const corpo = el('tbody');
      linhas.forEach((linha, indice) => {
        const tr = el('tr');
        tr.append(el('td', {}, String(indice + 1)));
        for (const campo of campos) {
          const valor = linha[campo.name];
          tr.append(el('td', {}, valor === null || valor === undefined ? '' : valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor)));
        }
        corpo.append(tr);
      });
      tabela.append(el('thead', {}, cabeca), corpo);
      registrosDialogo.lastElementChild?.replaceWith(el('div', { className: 'painel-registros-rolagem' }, tabela));
    } catch (motivo) {
      registrosDialogo.lastElementChild?.replaceWith(el('p', { className: 'painel-erro' }, motivo instanceof Error ? motivo.message : String(motivo)));
    }
  }
  verRegistros.addEventListener('click', () => void abrirRegistros());

  async function executarAgora(): Promise<boolean> {
    atualizar();
    // Sem DEF quem escolhe a primeira tabela é a abertura do arquivo, que sabe
    // achar um campo plausível; o painel só acompanha.
    if (!catalogo || !estado || !deps.campos() || catalogo.origem !== 'def') return false;
    if (!catalogo.linhas.some((eixo) => eixo.id === estado!.linha && eixo.disponivel)) return false;
    return executar();
  }

  atualizar();
  return { atualizar, restaurar, executarAgora, logAtual: () => ultimoLog };
}

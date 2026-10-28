/**
 * A aba "Microdados": o laboratório de microdados sem código.
 *
 * O Laboratório em /lab é para quem programa. Esta aba é para quem não
 * programa e precisa recortar os registros de um jeito que as listas prontas
 * não recortam. Primeiro, ver e escolher: todos os valores de um campo, com
 * quantos registros e o significado de cada código (LTA: forma clínica 1 =
 * cutânea, 2 = mucosa), marcando os que entram. Depois, a definição de caso
 * por códigos (Chagas: B57, sem o B56 que a "Tripanossomíase" junta), com
 * prévia por código antes de aplicar.
 *
 * Conversa com o resto do aplicativo só pelas funções de
 * {@link AbaMicrodadosDeps}, como a aba Consulta. O que ela aplica é uma
 * Seleção comum (de valores, ou do tipo `code-rules` para os códigos),
 * avaliada pelo mesmo motor da tabela e salva na receita.
 */

import {
  RIDE_DF_LC_163_2018,
  descreverDefinicao,
  faixaEtariaSinan,
  lerDefinicao,
  previaDeCaso,
  type DefinicaoDeCaso,
  type PreviaDeCaso,
} from '../../../packages/core/src/definicao-caso.ts';

export interface AbaMicrodadosDeps {
  /** Campos do arquivo aberto, na ordem do cabeçalho. */
  campos(): string[];
  rotuloDoCampo(campo: string): string;
  /**
   * Registros por valor do campo, como estão no arquivo (sem CNV), já com as
   * Seleções em vigor, menos a definição que esta aba aplicou antes neste campo.
   */
  contarPorValor(campo: string): Promise<Array<{ valor: string; registros: number }>>;
  /**
   * Aplica (ou troca) a Seleção desta aba e refaz a tabela. Vai a regra como
   * escrita, não a lista de valores da prévia: a receita salva reabre com
   * outros anos e pega os códigos que só aparecem neles.
   */
  aplicar(campo: string, incluir: string, excluir: string): void;
  /**
   * Registros por valor do campo, com o branco como `''`, já com as outras
   * Seleções em vigor, menos as que recortam este mesmo campo: a lista mostra
   * todos os valores, e o que já estava escolhido vem marcado.
   */
  contarValores(campo: string): Promise<Array<{ valor: string; registros: number }>>;
  /**
   * Código → significado, pelo dicionário oficial do arquivo aberto; vazio se
   * não houver. Num campo de CNES, os nomes vêm do cadastro, pela internet:
   * aí chega uma promessa, e a lista aparece antes, só com os códigos.
   */
  significados(campo: string): Map<string, string> | Promise<Map<string, string>>;
  /** O que o dicionário diz do campo, numa frase; vazio se não diz. */
  descricaoDoCampo(campo: string): string;
  /** Valores aceitos pela Seleção de valores que já recorta este campo, se houver. */
  valoresAceitos(campo: string): string[] | undefined;
  /** Troca as Seleções deste campo pela lista de valores; lista vazia tira o recorte. */
  aplicarValores(campo: string, valores: string[]): void;
  /** Os primeiros registros do arquivo com `campo = valor`, com todos os campos. */
  exemplos(campo: string, valor: string, maximo: number): Promise<Array<Record<string, unknown>>>;
  aviso(mensagem: string, erro?: boolean): void;
}

export interface AbaMicrodados {
  /** Refaz a lista de campos quando um arquivo é aberto. */
  atualizarCampos(): void;
  /** A aba ficou à vista: conta os valores do campo escolhido. */
  aoMostrar(): void;
}

interface DefinicaoSalva {
  nome: string;
  campo: string;
  incluir: string;
  excluir: string;
}

/** Campos de código (CID, agravo) dos sistemas do DATASUS, na ordem de preferência. */
const CAMPOS_DE_CODIGO = ['CAUSABAS', 'DIAG_PRINC', 'ID_AGRAVO', 'CID10', 'DIAGPRINC', 'CAUSABAS_O', 'DIAG_SECUN', 'DIAGSEC1', 'LINHAA'];
/** Campos de município (código IBGE) de residência e de infecção/ocorrência. */
const CAMPOS_DE_MUNICIPIO = ['ID_MN_RESI', 'CODMUNRES', 'MUNIC_RES', 'COMUNINF', 'ID_MUNICIP', 'CODMUNOCOR'];
/**
 * A forma clínica vem antes do CID: num arquivo do SINAN o agravo é um só
 * (ID_AGRAVO = B551 em todo o LTAN), e a forma é o recorte que se pede (LTA:
 * cutânea × mucosa).
 */
const CAMPOS_DE_FORMA = ['CLAS_FORMA', 'FORMACLINI'];
const CHAVE_SALVAS = 'tabsis.definicoes-de-caso';
const MOSTRAR_ATE = 40;
/** Valores na lista de uma vez; num campo de CID há milhares, e a busca acha o resto. */
const VALORES_NA_TELA = 300;
const EXEMPLOS = 10;

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento ausente: ${selector}`);
  return found;
}

const integerFormat = new Intl.NumberFormat('pt-BR');
const percentFormat = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function lerSalvas(): DefinicaoSalva[] {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_SALVAS) ?? '[]') as unknown;
    if (!Array.isArray(bruto)) return [];
    return bruto.filter((item): item is DefinicaoSalva => (
      !!item && typeof item.nome === 'string' && typeof item.campo === 'string'
      && typeof item.incluir === 'string' && typeof item.excluir === 'string'
    ));
  } catch {
    return [];
  }
}

function gravarSalvas(salvas: DefinicaoSalva[]): boolean {
  try {
    localStorage.setItem(CHAVE_SALVAS, JSON.stringify(salvas));
    return true;
  } catch {
    return false;
  }
}

export function criarAbaMicrodados(deps: AbaMicrodadosDeps): AbaMicrodados {
  const campo = element<HTMLSelectElement>('#case-field');
  const incluir = element<HTMLInputElement>('#case-include');
  const excluir = element<HTMLInputElement>('#case-exclude');
  const previaBotao = element<HTMLButtonElement>('#case-preview');
  const aplicarBotao = element<HTMLButtonElement>('#case-apply');
  const salvarBotao = element<HTMLButtonElement>('#case-save');
  const estado = element<HTMLElement>('#case-status');
  const resultado = element<HTMLElement>('#case-result');
  const listaSalvas = element<HTMLElement>('#case-saved');
  const atalhoRide = element<HTMLButtonElement>('#case-shortcut-ride');
  const idadeMinima = element<HTMLInputElement>('#case-age-min');
  const idadeMaxima = element<HTMLInputElement>('#case-age-max');
  const atalhoIdade = element<HTMLButtonElement>('#case-shortcut-age');
  const painel = element<HTMLElement>('#microdata-view');
  const notaDoCampo = element<HTMLElement>('#values-field-note');
  const busca = element<HTMLInputElement>('#values-filter');
  const corpoValores = element<HTMLTableSectionElement>('#values-table tbody');
  const estadoValores = element<HTMLElement>('#values-status');
  const aplicarValoresBotao = element<HTMLButtonElement>('#values-apply');
  const marcarTodos = element<HTMLButtonElement>('#values-all');
  const desmarcarTodos = element<HTMLButtonElement>('#values-none');
  const exemplos = element<HTMLElement>('#values-examples');

  /** A prévia vale para estes campo e texto; mudou qualquer um, precisa refazer. */
  let previa: { campo: string; definicao: DefinicaoDeCaso; dados: PreviaDeCaso } | null = null;
  let chavePrevia = '';
  const chaveAtual = () => `${campo.value}\u0000${incluir.value}\u0000${excluir.value}`;

  function invalidar(): void {
    if (chaveAtual() === chavePrevia) return;
    previa = null;
    aplicarBotao.disabled = true;
    if (resultado.childElementCount) estado.textContent = 'A definição mudou: veja a prévia de novo antes de aplicar.';
  }

  // --- Ver e escolher pelos valores ---------------------------------------

  let valores: Array<{ valor: string; registros: number }> = [];
  let marcados = new Set<string>();
  let significados = new Map<string, string>();
  let campoDosValores = '';
  let pedidoValores = 0;

  /** O significado do código; "01" acha o "1" do dicionário. */
  function significado(valor: string): string {
    if (valor === '') return '';
    return significados.get(valor)
      ?? (/^\d+$/.test(valor) ? significados.get(String(Number(valor))) : undefined)
      ?? '';
  }

  function mostrarCodigo(valor: string): string {
    return valor === '' ? '(em branco)' : valor;
  }

  function resumoDosMarcados(): string {
    const total = valores.reduce((soma, item) => soma + item.registros, 0);
    const entram = valores.reduce((soma, item) => soma + (marcados.has(item.valor) ? item.registros : 0), 0);
    if (!marcados.size) return `${integerFormat.format(valores.length)} valor(es), ${integerFormat.format(total)} registros. Marque os que entram.`;
    return `Marcados ${integerFormat.format(marcados.size)} de ${integerFormat.format(valores.length)} valor(es): ${integerFormat.format(entram)} de ${integerFormat.format(total)} registros entram.`;
  }

  function atualizarBotoesDeValores(): void {
    const prontos = campoDosValores !== '' && campoDosValores === campo.value && valores.length > 0;
    aplicarValoresBotao.disabled = !prontos || marcados.size === 0;
    marcarTodos.disabled = !prontos;
    desmarcarTodos.disabled = !prontos || marcados.size === 0;
  }

  function renderValores(): void {
    const termo = semAcento(busca.value.trim());
    const total = valores.reduce((soma, item) => soma + item.registros, 0);
    const achados = termo
      ? valores.filter((item) => semAcento(item.valor).includes(termo) || semAcento(significado(item.valor)).includes(termo))
      : valores;
    corpoValores.replaceChildren(...achados.slice(0, VALORES_NA_TELA).map((item) => {
      const linha = document.createElement('tr');
      const marca = document.createElement('input');
      marca.type = 'checkbox';
      marca.checked = marcados.has(item.valor);
      marca.setAttribute('aria-label', `Incluir ${mostrarCodigo(item.valor)}${significado(item.valor) ? ` (${significado(item.valor)})` : ''}`);
      marca.addEventListener('change', () => {
        if (marca.checked) marcados.add(item.valor);
        else marcados.delete(item.valor);
        estadoValores.textContent = resumoDosMarcados();
        atualizarBotoesDeValores();
      });
      const celulaMarca = document.createElement('td');
      celulaMarca.append(marca);
      const codigo = document.createElement('td');
      codigo.className = 'values-code';
      codigo.textContent = mostrarCodigo(item.valor);
      const sentido = document.createElement('td');
      sentido.textContent = significado(item.valor);
      const registros = document.createElement('td');
      registros.className = 'numeric';
      registros.textContent = integerFormat.format(item.registros);
      const parte = document.createElement('td');
      parte.className = 'numeric';
      parte.textContent = total ? percentFormat.format(item.registros / total) : '—';
      const ver = document.createElement('button');
      ver.type = 'button';
      ver.className = 'text-button';
      ver.textContent = 'ver';
      ver.setAttribute('aria-label', `Ver registros com ${mostrarCodigo(item.valor)}`);
      ver.addEventListener('click', () => void verExemplos(item.valor));
      const celulaVer = document.createElement('td');
      celulaVer.append(ver);
      linha.append(celulaMarca, codigo, sentido, registros, parte, celulaVer);
      // Tocar na linha marca: a caixinha sozinha é um alvo pequeno no celular.
      for (const celula of [codigo, sentido, registros, parte]) {
        celula.addEventListener('click', () => { marca.checked = !marca.checked; marca.dispatchEvent(new Event('change')); });
      }
      return linha;
    }));
    const escondidos = achados.length - Math.min(achados.length, VALORES_NA_TELA);
    estadoValores.textContent = resumoDosMarcados()
      + (escondidos > 0 ? ` Mostrando ${integerFormat.format(VALORES_NA_TELA)} de ${integerFormat.format(achados.length)}: use a busca para achar os outros.` : '')
      + (termo && !achados.length ? ' Nenhum valor com esse texto.' : '');
    atualizarBotoesDeValores();
  }

  async function carregarValores(): Promise<void> {
    const nome = campo.value;
    if (!nome || painel.hidden) return;
    const meu = ++pedidoValores;
    notaDoCampo.textContent = deps.descricaoDoCampo(nome);
    estadoValores.textContent = 'Contando os registros de cada valor…';
    campoDosValores = '';
    atualizarBotoesDeValores();
    try {
      const contagens = await deps.contarValores(nome);
      if (meu !== pedidoValores || nome !== campo.value) return;
      valores = [...contagens].sort((a, b) => b.registros - a.registros || a.valor.localeCompare(b.valor, 'pt-BR', { numeric: true }));
      const pedidoDeSignificados = deps.significados(nome);
      significados = pedidoDeSignificados instanceof Map ? pedidoDeSignificados : new Map();
      marcados = new Set(deps.valoresAceitos(nome) ?? []);
      campoDosValores = nome;
      exemplos.hidden = true;
      renderValores();
      if (!(pedidoDeSignificados instanceof Map)) {
        estadoValores.textContent = `${estadoValores.textContent} Buscando os nomes no cadastro do CNES…`;
        pedidoDeSignificados.then((mapa) => {
          if (meu !== pedidoValores) return;
          significados = mapa;
          renderValores();
        }).catch((error: unknown) => {
          if (meu === pedidoValores) estadoValores.textContent = `${resumoDosMarcados()} Os nomes não vieram: ${error instanceof Error ? error.message : String(error)}`;
        });
      }
    } catch (error) {
      if (meu === pedidoValores) estadoValores.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function aplicarValores(): void {
    if (campoDosValores !== campo.value || !marcados.size) return;
    const nome = campoDosValores;
    const todos = valores.every((item) => marcados.has(item.valor));
    if (todos) {
      deps.aplicarValores(nome, []);
      estadoValores.textContent = `Todos os valores marcados: ${nome} fica sem recorte.`;
      return;
    }
    const escolhidos = valores.filter((item) => marcados.has(item.valor)).map((item) => item.valor);
    // Um valor marcado que não aparece agora (de uma Seleção anterior, ou de
    // outro ano) continua valendo: desmarcar é que tira.
    for (const valor of marcados) if (!escolhidos.includes(valor)) escolhidos.push(valor);
    deps.aplicarValores(nome, escolhidos);
    const nomes = escolhidos.slice(0, 6).map((valor) => (significado(valor) ? `${mostrarCodigo(valor)} (${significado(valor)})` : mostrarCodigo(valor)));
    estadoValores.textContent = `Aplicado como Seleção: ${nome} = ${nomes.join(', ')}${escolhidos.length > 6 ? ` e mais ${escolhidos.length - 6}` : ''}. A tabela, o mapa e as exportações passam a usar só estes registros.`;
  }

  async function verExemplos(valor: string): Promise<void> {
    const nome = campoDosValores;
    exemplos.hidden = false;
    const titulo = document.createElement('strong');
    titulo.textContent = `Registros com ${nome} = ${mostrarCodigo(valor)}${significado(valor) ? ` (${significado(valor)})` : ''}`;
    const nota = document.createElement('small');
    nota.textContent = 'Lendo o arquivo…';
    exemplos.replaceChildren(titulo, nota);
    try {
      const registros = await deps.exemplos(nome, valor, EXEMPLOS);
      if (nome !== campoDosValores) return;
      nota.textContent = registros.length
        ? `Os ${integerFormat.format(registros.length)} primeiros do arquivo, como estão gravados (sem as outras Seleções). A consulta completa fica na aba Consulta.`
        : 'Nenhum registro com este valor no arquivo.';
      if (!registros.length) return;
      const campos = [nome, ...deps.campos().filter((outro) => outro !== nome)];
      const tabela = document.createElement('table');
      tabela.className = 'values-examples-table';
      const cabeca = tabela.createTHead().insertRow();
      for (const nomeDoCampo of campos) {
        const th = document.createElement('th');
        th.textContent = nomeDoCampo;
        th.title = deps.rotuloDoCampo(nomeDoCampo);
        if (nomeDoCampo === nome) th.className = 'values-chosen';
        cabeca.append(th);
      }
      const corpo = tabela.createTBody();
      for (const registro of registros) {
        const linha = corpo.insertRow();
        for (const nomeDoCampo of campos) {
          const celula = linha.insertCell();
          const bruto = registro[nomeDoCampo];
          celula.textContent = bruto === null || bruto === undefined ? ''
            : bruto instanceof Date ? bruto.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : String(bruto);
          if (nomeDoCampo === nome) celula.className = 'values-chosen';
        }
      }
      const rolagem = document.createElement('div');
      rolagem.className = 'values-examples-scroll';
      rolagem.append(tabela);
      exemplos.append(rolagem);
    } catch (error) {
      nota.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  // --- Definição de caso por códigos ---------------------------------------

  function atualizarCampos(): void {
    const campos = deps.campos();
    const anterior = campo.value;
    campo.replaceChildren(...campos.map((nome) => {
      const rotulo = deps.rotuloDoCampo(nome);
      return new Option(rotulo && rotulo !== nome ? `${nome} — ${rotulo}` : nome, nome);
    }));
    const preferido = campos.includes(anterior) ? anterior : CAMPOS_DE_FORMA.find((nome) => campos.includes(nome))
      ?? CAMPOS_DE_CODIGO.find((nome) => campos.includes(nome));
    if (preferido) campo.value = preferido;
    const aberto = campos.length > 0;
    previaBotao.disabled = !aberto;
    salvarBotao.disabled = !aberto;
    atalhoRide.disabled = !aberto;
    atalhoIdade.disabled = !aberto || !campos.includes('NU_IDADE_N');
    previa = null;
    chavePrevia = '';
    aplicarBotao.disabled = true;
    resultado.replaceChildren();
    valores = [];
    marcados = new Set();
    campoDosValores = '';
    busca.value = '';
    corpoValores.replaceChildren();
    exemplos.hidden = true;
    notaDoCampo.textContent = '';
    estadoValores.textContent = aberto ? 'Escolha um campo para ver os valores.' : 'Abra um arquivo para ver os valores dos microdados.';
    atualizarBotoesDeValores();
    void carregarValores();
    estado.textContent = aberto
      ? 'Escreva os códigos e veja a prévia: quantos registros cada código traz, antes de aplicar.'
      : 'Abra um arquivo para recortar os microdados.';
    renderSalvas();
  }

  function tabelaDeValores(titulo: string, itens: Array<{ valor: string; registros: number }>): HTMLElement {
    const bloco = document.createElement('div');
    bloco.className = 'case-block';
    const cabecalho = document.createElement('strong');
    cabecalho.textContent = titulo;
    const tabela = document.createElement('table');
    tabela.className = 'case-table';
    const corpo = tabela.createTBody();
    for (const item of itens.slice(0, MOSTRAR_ATE)) {
      const linha = corpo.insertRow();
      linha.insertCell().textContent = item.valor;
      const celula = linha.insertCell();
      celula.textContent = integerFormat.format(item.registros);
      celula.className = 'numeric';
    }
    bloco.append(cabecalho, tabela);
    if (itens.length > MOSTRAR_ATE) {
      const mais = document.createElement('small');
      mais.textContent = `e mais ${integerFormat.format(itens.length - MOSTRAR_ATE)} código(s).`;
      bloco.append(mais);
    }
    return bloco;
  }

  async function verPrevia(): Promise<void> {
    let definicao: DefinicaoDeCaso;
    try {
      definicao = lerDefinicao(incluir.value, excluir.value);
    } catch (error) {
      estado.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    if (!definicao.incluir.length && !definicao.excluir.length) {
      estado.textContent = 'Escreva ao menos um código em "Incluir" ou em "Excluir".';
      return;
    }
    const chave = chaveAtual();
    const nomeCampo = campo.value;
    previaBotao.disabled = true;
    estado.textContent = 'Contando os registros por código…';
    try {
      const contagens = await deps.contarPorValor(nomeCampo);
      if (chave !== chaveAtual()) return;
      const dados = previaDeCaso(definicao, contagens);
      previa = { campo: nomeCampo, definicao, dados };
      chavePrevia = chave;
      const total = dados.registrosQueEntram + dados.registrosQueFicamFora;
      const partes = [
        `${integerFormat.format(dados.registrosQueEntram)} de ${integerFormat.format(total)} registros entram`,
        `(${integerFormat.format(dados.entram.length)} código(s) diferentes em ${nomeCampo}).`,
      ];
      if (dados.regrasSemCasamento.length) {
        partes.push(`Nenhum registro com: ${dados.regrasSemCasamento.join(', ')}. Confira se o código está certo e se é deste campo.`);
      }
      estado.textContent = partes.join(' ');
      resultado.replaceChildren(
        ...(dados.entram.length ? [tabelaDeValores('Entram', dados.entram)] : []),
        ...(dados.excluidos.length ? [tabelaDeValores('Tirados por "Excluir"', dados.excluidos)] : []),
      );
      aplicarBotao.disabled = dados.entram.length === 0;
    } catch (error) {
      estado.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      previaBotao.disabled = false;
    }
  }

  function aplicar(): void {
    if (!previa || chavePrevia !== chaveAtual() || !previa.dados.entram.length) return;
    const descricao = descreverDefinicao(previa.definicao);
    deps.aplicar(previa.campo, incluir.value.trim(), excluir.value.trim());
    estado.textContent = `Aplicado como Seleção: ${previa.campo} = ${descricao}. A tabela, o mapa e as exportações (incluindo Abrir no Python) passam a usar só estes registros. Ao salvar a análise, a regra vai junto e vale também para outros anos.`;
  }

  function renderSalvas(): void {
    const salvas = lerSalvas();
    listaSalvas.replaceChildren(...salvas.map((salva, indice) => {
      const item = document.createElement('li');
      const usar = document.createElement('button');
      usar.type = 'button';
      usar.className = 'text-button';
      usar.textContent = salva.nome;
      usar.title = `${salva.campo}: ${salva.incluir}${salva.excluir ? `, sem ${salva.excluir}` : ''}`;
      usar.addEventListener('click', () => {
        if (![...campo.options].some((opcao) => opcao.value === salva.campo)) {
          deps.aviso(`Este arquivo não tem o campo ${salva.campo}.`, true);
          return;
        }
        campo.value = salva.campo;
        incluir.value = salva.incluir;
        excluir.value = salva.excluir;
        invalidar();
        void verPrevia();
      });
      const remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'text-button danger-text-button';
      remover.textContent = 'remover';
      remover.setAttribute('aria-label', `Remover ${salva.nome}`);
      remover.addEventListener('click', () => {
        const atuais = lerSalvas();
        atuais.splice(indice, 1);
        gravarSalvas(atuais);
        renderSalvas();
      });
      item.append(usar, remover);
      return item;
    }));
    listaSalvas.hidden = salvas.length === 0;
  }

  function salvar(): void {
    try {
      lerDefinicao(incluir.value, excluir.value);
    } catch (error) {
      estado.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    if (!incluir.value.trim() && !excluir.value.trim()) {
      estado.textContent = 'Nada para salvar: escreva os códigos primeiro.';
      return;
    }
    const sugestao = incluir.value.trim() ? `${campo.value} ${incluir.value.trim()}` : campo.value;
    const nome = window.prompt('Nome desta definição (por exemplo, "Doença de Chagas"):', sugestao)?.trim();
    if (!nome) return;
    const salvas = lerSalvas().filter((salva) => salva.nome !== nome);
    salvas.push({ nome: nome.slice(0, 60), campo: campo.value, incluir: incluir.value.trim(), excluir: excluir.value.trim() });
    if (!gravarSalvas(salvas)) {
      deps.aviso('O navegador não deixou guardar (modo privado ou armazenamento cheio).', true);
      return;
    }
    renderSalvas();
    deps.aviso(`Definição "${nome}" guardada neste navegador.`);
  }

  for (const entrada of [campo, incluir, excluir]) entrada.addEventListener('input', invalidar);
  campo.addEventListener('change', () => { invalidar(); busca.value = ''; void carregarValores(); });
  busca.addEventListener('input', renderValores);
  aplicarValoresBotao.addEventListener('click', aplicarValores);
  marcarTodos.addEventListener('click', () => { marcados = new Set(valores.map((item) => item.valor)); renderValores(); });
  desmarcarTodos.addEventListener('click', () => { marcados = new Set(); renderValores(); });
  for (const entrada of [incluir, excluir]) {
    entrada.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void verPrevia();
      }
    });
  }
  /** Atalho: escolhe o campo (se existir), escreve a regra e já mostra a prévia. */
  function usarAtalho(campos: readonly string[], regra: string): void {
    const existente = campos.find((nome) => [...campo.options].some((opcao) => opcao.value === nome));
    if (existente && existente !== campo.value) {
      campo.value = existente;
      void carregarValores();
    }
    incluir.value = regra;
    excluir.value = '';
    invalidar();
    void verPrevia();
  }
  atalhoRide.addEventListener('click', () => usarAtalho(CAMPOS_DE_MUNICIPIO, RIDE_DF_LC_163_2018.join(', ')));
  atalhoIdade.addEventListener('click', () => {
    try {
      const minimo = idadeMinima.value.trim() === '' ? 0 : Number(idadeMinima.value);
      const maximo = idadeMaxima.value.trim() === '' ? 999 : Number(idadeMaxima.value);
      usarAtalho(['NU_IDADE_N'], faixaEtariaSinan(minimo, maximo));
    } catch (error) {
      estado.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  previaBotao.addEventListener('click', () => void verPrevia());
  aplicarBotao.addEventListener('click', aplicar);
  salvarBotao.addEventListener('click', salvar);

  atualizarCampos();
  return {
    atualizarCampos,
    // Conta de novo a cada visita: as Seleções podem ter mudado em outra aba.
    aoMostrar: () => void carregarValores(),
  };
}

/**
 * A aba "Microdados": o laboratório de microdados sem código.
 *
 * O Laboratório em /lab é para quem programa. Esta aba é para quem não
 * programa e precisa recortar os registros de um jeito que as listas prontas
 * não recortam. Começa pela definição de caso por códigos (Chagas: B57, sem o
 * B56 que a "Tripanossomíase" junta), com prévia por código antes de aplicar.
 *
 * Conversa com o resto do aplicativo só pelas funções de
 * {@link AbaMicrodadosDeps}, como a aba Consulta. O que ela aplica é uma
 * Seleção do tipo `code-rules`, avaliada pelo mesmo motor da tabela e salva
 * na receita como regra.
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
  aviso(mensagem: string, erro?: boolean): void;
}

export interface AbaMicrodados {
  /** Refaz a lista de campos quando um arquivo é aberto. */
  atualizarCampos(): void;
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
const CHAVE_SALVAS = 'tabsis.definicoes-de-caso';
const MOSTRAR_ATE = 40;

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento ausente: ${selector}`);
  return found;
}

const integerFormat = new Intl.NumberFormat('pt-BR');

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

  function atualizarCampos(): void {
    const campos = deps.campos();
    const anterior = campo.value;
    campo.replaceChildren(...campos.map((nome) => {
      const rotulo = deps.rotuloDoCampo(nome);
      return new Option(rotulo && rotulo !== nome ? `${nome} — ${rotulo}` : nome, nome);
    }));
    const preferido = campos.includes(anterior) ? anterior : CAMPOS_DE_CODIGO.find((nome) => campos.includes(nome));
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
  campo.addEventListener('change', invalidar);
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
    if (existente) campo.value = existente;
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
  return { atualizarCampos };
}

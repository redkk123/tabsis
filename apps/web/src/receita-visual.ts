/**
 * A receita visual (Fase 1 do plano do laboratório, docs/product/
 * PLANO_LABORATORIO_E_MICRODADOS.md): as Seleções em vigor como etapas, em
 * cartões, com quantos registros sobram depois de cada uma.
 *
 * Cada etapa é uma Seleção comum, avaliada pelo mesmo motor da tabela. Aqui
 * só se vê o caminho dos registros e se mexe nele: desligar uma etapa (ela
 * sai da análise, mas fica no cartão para voltar), mudar a ordem, remover.
 * As etapas prontas de saúde montam Seleções com a regra citada da fonte
 * oficial, para não ficar a cargo da memória de quem analisa.
 */

export interface EtapaDaReceita {
  /** "Incluir Tipo de entrada · CLA_TIPO_N · 1 valor(es)", como na lista de Seleções. */
  descricao: string;
  ligada: boolean;
}

export interface EtapaPronta {
  id: string;
  rotulo: string;
  /** De onde vem a regra: aparece na dica do botão e no cartão. */
  fonte: string;
}

export interface ReceitaVisualDeps {
  /** As ligadas na ordem em que são aplicadas, depois as desligadas. */
  etapas(): EtapaDaReceita[];
  /** Registros que passam pelas `n` primeiras etapas ligadas (0 = o arquivo inteiro). */
  contarAte(n: number): Promise<number>;
  registrosNoConjunto(): number;
  alternar(indice: number): void;
  mover(indice: number, para: -1 | 1): void;
  remover(indice: number): void;
  /** As etapas prontas que fazem sentido para o arquivo aberto. */
  prontas(): EtapaPronta[];
  aplicarPronta(id: string): void;
}

export interface ReceitaVisual {
  /** Refaz os cartões e as contagens (Seleções mudaram, arquivo novo, aba à vista). */
  atualizar(): void;
}

/** Acima disto, contar cada etapa espera um clique: cada etapa é uma leitura do arquivo. */
const CONTAR_SOZINHO_ATE = 2_000_000;

const inteiro = new Intl.NumberFormat('pt-BR');

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento ausente: ${selector}`);
  return found;
}

export function criarReceitaVisual(deps: ReceitaVisualDeps): ReceitaVisual {
  const lista = element<HTMLOListElement>('#receita-etapas');
  const estado = element<HTMLElement>('#receita-status');
  const prontas = element<HTMLElement>('#receita-prontas');
  const contar = element<HTMLButtonElement>('#receita-contar');
  const painel = element<HTMLElement>('#microdata-view');

  let pedido = 0;
  let contagens: number[] | null = null;

  function botao(texto: string, rotulo: string, acao: () => void, desabilitado = false): HTMLButtonElement {
    const novo = document.createElement('button');
    novo.type = 'button';
    novo.className = 'text-button';
    novo.textContent = texto;
    novo.setAttribute('aria-label', rotulo);
    novo.disabled = desabilitado;
    novo.addEventListener('click', acao);
    return novo;
  }

  function renderProntas(): void {
    const disponiveis = deps.prontas();
    prontas.hidden = disponiveis.length === 0;
    prontas.replaceChildren(...(disponiveis.length ? [Object.assign(document.createElement('span'), { textContent: 'Etapas prontas' })] : []),
      ...disponiveis.map((pronta) => {
        const novo = botao(pronta.rotulo, `Acrescentar a etapa ${pronta.rotulo}`, () => deps.aplicarPronta(pronta.id));
        novo.title = pronta.fonte;
        return novo;
      }));
  }

  function renderEtapas(): void {
    const etapas = deps.etapas();
    const ligadas = etapas.filter((etapa) => etapa.ligada).length;
    const cartoes: HTMLElement[] = [];
    const inicio = document.createElement('li');
    inicio.className = 'receita-etapa receita-inicio';
    inicio.append(
      Object.assign(document.createElement('strong'), { textContent: 'Arquivo aberto' }),
      Object.assign(document.createElement('span'), {
        className: 'receita-conta',
        textContent: `${inteiro.format(contagens?.[0] ?? deps.registrosNoConjunto())} registros`,
      }),
    );
    cartoes.push(inicio);
    let ordemLigada = 0;
    etapas.forEach((etapa, indice) => {
      const cartao = document.createElement('li');
      cartao.className = `receita-etapa${etapa.ligada ? '' : ' receita-desligada'}`;
      const texto = document.createElement('div');
      texto.className = 'receita-texto';
      texto.append(
        Object.assign(document.createElement('strong'), { textContent: etapa.ligada ? `${++ordemLigada}. ${etapa.descricao}` : `Desligada · ${etapa.descricao}` }),
      );
      const conta = document.createElement('span');
      conta.className = 'receita-conta';
      if (etapa.ligada && contagens && contagens[ordemLigada] !== undefined && contagens[ordemLigada - 1] !== undefined) {
        const depois = contagens[ordemLigada]!;
        const saem = contagens[ordemLigada - 1]! - depois;
        conta.textContent = `${inteiro.format(depois)} registros · saem ${inteiro.format(saem)}`;
      } else if (etapa.ligada) {
        conta.textContent = '…';
      } else {
        conta.textContent = 'fora da análise';
      }
      texto.append(conta);
      const acoes = document.createElement('div');
      acoes.className = 'receita-acoes';
      acoes.append(
        botao('↑', `Aplicar antes: ${etapa.descricao}`, () => deps.mover(indice, -1), !etapa.ligada || ordemLigada === 1),
        botao('↓', `Aplicar depois: ${etapa.descricao}`, () => deps.mover(indice, 1), !etapa.ligada || ordemLigada === ligadas),
        botao(etapa.ligada ? 'desligar' : 'ligar', `${etapa.ligada ? 'Desligar' : 'Ligar'}: ${etapa.descricao}`, () => deps.alternar(indice)),
        botao('remover', `Remover: ${etapa.descricao}`, () => deps.remover(indice)),
      );
      cartao.append(texto, acoes);
      cartoes.push(cartao);
    });
    lista.replaceChildren(...cartoes);
    if (!etapas.length) estado.textContent = 'Nenhuma etapa ainda: cada Seleção (aqui, nos valores, nos códigos ou no painel) vira uma etapa.';
  }

  async function contarTudo(): Promise<void> {
    const meu = ++pedido;
    const ligadas = deps.etapas().filter((etapa) => etapa.ligada).length;
    contagens = [];
    contar.disabled = true;
    try {
      for (let n = 0; n <= ligadas; n += 1) {
        estado.textContent = `Contando os registros de cada etapa: ${n} de ${ligadas}…`;
        const total = await deps.contarAte(n);
        if (meu !== pedido) return;
        contagens[n] = total;
        renderEtapas();
      }
      const final = contagens[ligadas] ?? 0;
      estado.textContent = ligadas
        ? `Depois das ${inteiro.format(ligadas)} etapa(s), ficam ${inteiro.format(final)} de ${inteiro.format(contagens[0] ?? 0)} registros.`
        : '';
    } catch (error) {
      if (meu === pedido) estado.textContent = `Não deu para contar: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (meu === pedido) contar.disabled = false;
    }
  }

  function atualizar(): void {
    pedido += 1;
    contagens = null;
    renderProntas();
    renderEtapas();
    contar.disabled = deps.registrosNoConjunto() === 0;
    if (painel.hidden || deps.registrosNoConjunto() === 0) return;
    if (deps.registrosNoConjunto() <= CONTAR_SOZINHO_ATE) void contarTudo();
    else estado.textContent = 'Arquivo grande: use "Contar cada etapa" para ver quantos registros sobram em cada uma.';
  }

  contar.addEventListener('click', () => void contarTudo());
  atualizar();
  return { atualizar };
}

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
  /** Arrastar um cartão ligado para a posição de outro. */
  moverPara(de: number, para: number): void;
  remover(indice: number): void;
  /** Os primeiros registros que passam pelas `n` primeiras etapas ligadas, com o campo da etapa `n` em destaque. */
  amostraAte(n: number, maximo: number): Promise<{ destaque: string; campos: string[]; registros: Array<Record<string, unknown>> }>;
  /** O campo de idade que a etapa de faixa etária usa (NU_IDADE_N, IDADE do SIM, IDADEMAE); vazio se não há. */
  campoDeIdade(): string;
  aplicarIdade(minimo: number, maximo: number): void;
  /** Datas do arquivo com o eixo "Ano de …": oferece a etapa de período. */
  eixosDeAno(): Array<{ id: string; rotulo: string }>;
  aplicarAnos(eixo: string, de: number, ate: number): void;
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
  const configuraveis = element<HTMLElement>('#receita-configuraveis');
  const amostra = element<HTMLElement>('#receita-amostra');
  let arrastando: number | null = null;

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

  function campoNumero(rotulo: string, valor: string, minimo: number, maximo: number): HTMLInputElement {
    const entrada = document.createElement('input');
    entrada.type = 'number';
    entrada.inputMode = 'numeric';
    entrada.min = String(minimo);
    entrada.max = String(maximo);
    entrada.placeholder = valor;
    entrada.setAttribute('aria-label', rotulo);
    return entrada;
  }

  function renderConfiguraveis(): void {
    const partes: HTMLElement[] = [];
    const idade = deps.campoDeIdade();
    if (idade) {
      const linha = document.createElement('span');
      linha.className = 'receita-config';
      linha.title = `Pelo campo ${idade}`;
      const de = campoNumero('Idade mínima', '0', 0, 999);
      const ate = campoNumero('Idade máxima', '999', 0, 999);
      linha.append('Idade de ', de, ' a ', ate, ' anos ', botao('acrescentar', 'Acrescentar a etapa de idade', () => {
        deps.aplicarIdade(de.value.trim() === '' ? 0 : Number(de.value), ate.value.trim() === '' ? 999 : Number(ate.value));
      }));
      partes.push(linha);
    }
    const eixos = deps.eixosDeAno();
    if (eixos.length) {
      const linha = document.createElement('span');
      linha.className = 'receita-config';
      const qual = document.createElement('select');
      qual.setAttribute('aria-label', 'Data usada no período');
      qual.append(...eixos.map((eixo) => new Option(eixo.rotulo, eixo.id)));
      const de = campoNumero('Primeiro ano', '2016', 1900, 2100);
      const ate = campoNumero('Último ano', '2025', 1900, 2100);
      linha.append(qual, ' de ', de, ' a ', ate, ' ', botao('acrescentar', 'Acrescentar a etapa de período', () => {
        const inicio = Number(de.value || de.placeholder);
        const fim = Number(ate.value || ate.placeholder);
        deps.aplicarAnos(qual.value, Math.min(inicio, fim), Math.max(inicio, fim));
      }));
      partes.push(linha);
    }
    configuraveis.hidden = partes.length === 0;
    configuraveis.replaceChildren(...partes);
  }

  async function mostrarAmostra(n: number, rotulo: string): Promise<void> {
    amostra.hidden = false;
    const titulo = Object.assign(document.createElement('strong'), { textContent: n ? `Registros depois da etapa ${n}: ${rotulo}` : 'Registros do arquivo' });
    const nota = Object.assign(document.createElement('small'), { textContent: 'Lendo…' });
    amostra.replaceChildren(titulo, nota);
    try {
      const { destaque, campos, registros } = await deps.amostraAte(n, 8);
      nota.textContent = registros.length
        ? `Os ${inteiro.format(registros.length)} primeiros que passam${n ? ' até aqui' : ''}, como estão gravados.`
        : 'Nenhum registro passa até aqui.';
      if (!registros.length) return;
      const ordem = destaque && campos.includes(destaque) ? [destaque, ...campos.filter((campo) => campo !== destaque)] : campos;
      const tabela = document.createElement('table');
      tabela.className = 'values-examples-table';
      const cabeca = tabela.createTHead().insertRow();
      for (const campo of ordem) {
        const th = document.createElement('th');
        th.textContent = campo;
        if (campo === destaque) th.className = 'values-chosen';
        cabeca.append(th);
      }
      const corpo = tabela.createTBody();
      for (const registro of registros) {
        const linha = corpo.insertRow();
        for (const campo of ordem) {
          const celula = linha.insertCell();
          const bruto = registro[campo];
          celula.textContent = bruto === null || bruto === undefined ? ''
            : bruto instanceof Date ? bruto.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : String(bruto);
          if (campo === destaque) celula.className = 'values-chosen';
        }
      }
      const rolagem = Object.assign(document.createElement('div'), { className: 'values-examples-scroll' });
      rolagem.append(tabela);
      amostra.append(rolagem);
    } catch (error) {
      nota.textContent = error instanceof Error ? error.message : String(error);
    }
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
      const ordemDestaEtapa = ordemLigada;
      if (etapa.ligada) {
        // Arrastar (com mouse) muda a ordem; no celular, as setas fazem o mesmo.
        cartao.draggable = true;
        cartao.addEventListener('dragstart', (evento) => { arrastando = indice; evento.dataTransfer?.setData('text/plain', String(indice)); cartao.classList.add('receita-arrastando'); });
        cartao.addEventListener('dragend', () => { arrastando = null; cartao.classList.remove('receita-arrastando'); });
        cartao.addEventListener('dragover', (evento) => { if (arrastando !== null && arrastando !== indice) evento.preventDefault(); });
        cartao.addEventListener('drop', (evento) => {
          evento.preventDefault();
          if (arrastando !== null && arrastando !== indice) deps.moverPara(arrastando, indice);
          arrastando = null;
        });
      }
      acoes.append(
        ...(etapa.ligada ? [botao('ver registros', `Ver registros depois de: ${etapa.descricao}`, () => void mostrarAmostra(ordemDestaEtapa, etapa.descricao))] : []),
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
    amostra.hidden = true;
    renderProntas();
    renderConfiguraveis();
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

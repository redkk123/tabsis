/**
 * Janela "Gerar DEF": o Gera DEF do TabWin, a partir dos campos do arquivo
 * aberto. O texto sai de `generateDef` (packages/formats); aqui só a escolha
 * dos campos, a prévia e o que fazer com o resultado.
 */

import {
  defFilePattern,
  encodeWindows1252,
  generateDef,
  type DefGeneratorField,
} from '../../../packages/formats/src/index.ts';

export interface GerarDefDeps {
  /** Campos do arquivo aberto, com tipo e nome na tela; `null` sem arquivo. */
  campos(): DefGeneratorField[] | null;
  /** Nome original do arquivo aberto, ex. `RDAC2401.dbc`. */
  nomeDoArquivo(): string;
  usar(nome: string, texto: string): void;
  aviso(mensagem: string, erro?: boolean): void;
  baixar(blob: Blob, nome: string): void;
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento ausente: ${selector}`);
  return found;
}

export function criarGerarDef(deps: GerarDefDeps): { abrir(): void } {
  const dialog = element<HTMLDialogElement>('#def-generate-dialog');
  const fechar = element<HTMLButtonElement>('#def-generate-close');
  const inverter = element<HTMLButtonElement>('#def-generate-invert');
  const nome = element<HTMLInputElement>('#def-generate-filename');
  const lista = element<HTMLElement>('#def-generate-fields');
  const previa = element<HTMLElement>('#def-generate-preview');
  const baixar = element<HTMLButtonElement>('#def-generate-download');
  const usar = element<HTMLButtonElement>('#def-generate-use');
  let campos: DefGeneratorField[] = [];

  const marcados = (): DefGeneratorField[] => {
    const escolhidos = new Set([...lista.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value));
    return campos.filter((campo) => escolhidos.has(campo.name));
  };
  const nomeDoDef = (): string => {
    const bruto = nome.value.trim() || 'novo.def';
    return /\.def$/i.test(bruto) ? bruto : `${bruto}.def`;
  };
  const texto = (): string => generateDef({
    title: deps.nomeDoArquivo(),
    filePattern: defFilePattern(deps.nomeDoArquivo()),
    fields: marcados(),
  });
  const atualizar = (): void => {
    try { previa.textContent = texto(); } catch (error) { previa.textContent = error instanceof Error ? error.message : String(error); }
  };

  function abrir(): void {
    campos = deps.campos() ?? [];
    if (!campos.length) { deps.aviso('Abra um arquivo de dados para gerar o DEF dos campos dele', true); return; }
    // Como no TabWin, todos começam marcados; "Inverter seleção" desmarca tudo.
    lista.replaceChildren(...campos.map((campo) => {
      const label = document.createElement('label');
      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.value = campo.name;
      caixa.checked = true;
      const texto = document.createElement('span');
      texto.textContent = campo.label && campo.label !== campo.name ? `${campo.label} ` : `${campo.name} `;
      const tipo = document.createElement('small');
      tipo.textContent = campo.label && campo.label !== campo.name ? `${campo.name} · ${campo.type}` : campo.type;
      label.append(caixa, texto, tipo);
      return label;
    }));
    nome.value = deps.nomeDoArquivo().replace(/\.[^.]+$/, '').replace(/\d+$/, '') + '.def';
    atualizar();
    dialog.showModal();
  }

  lista.addEventListener('change', atualizar);
  inverter.addEventListener('click', () => {
    for (const caixa of lista.querySelectorAll<HTMLInputElement>('input')) caixa.checked = !caixa.checked;
    atualizar();
  });
  fechar.addEventListener('click', () => dialog.close());
  baixar.addEventListener('click', () => {
    try { deps.baixar(new Blob([encodeWindows1252(texto())], { type: 'text/plain' }), nomeDoDef()); }
    catch (error) { deps.aviso(error instanceof Error ? error.message : String(error), true); }
  });
  usar.addEventListener('click', () => {
    try { deps.usar(nomeDoDef(), texto()); dialog.close(); }
    catch (error) { deps.aviso(error instanceof Error ? error.message : String(error), true); }
  });
  return { abrir };
}

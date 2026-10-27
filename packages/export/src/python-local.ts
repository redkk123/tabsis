/**
 * "Rodar no computador": o mesmo caderno do Laboratório, empacotado para
 * rodar fora do navegador em Windows, macOS e Linux, sem npm e sem saber
 * programar.
 *
 * ## Por que um iniciador por sistema e a lógica em Python
 *
 * Quem não programa só sabe dar dois cliques. Cada sistema tem o seu arquivo
 * de dois cliques (`.bat`, `.command`, `.sh`), e cada um só faz uma coisa:
 * achar um Python 3.9+ e passar a vez para `preparar_e_rodar.py`. Toda a parte
 * difícil (ambiente só desta pasta, instalar o pandas uma vez, rodar a
 * análise) fica num arquivo Python só, igual nos três sistemas, em vez de
 * três scripts de shell divergindo.
 *
 * O ambiente fica em `.venv` dentro da pasta: nada é instalado no Python do
 * sistema, e apagar a pasta desfaz tudo.
 */

/** Uma célula do caderno; `mostrar` é a expressão exibida no fim (print no script). */
export interface CelulaPython {
  code: string;
  mostrar?: string;
}

export interface ArquivoTexto {
  texto: string;
  /** Precisa do bit de execução (macOS e Linux) para abrir com dois cliques. */
  executavel?: boolean;
}

/** Python mínimo: pandas 2.x exige 3.9. */
export const PYTHON_MINIMO: readonly [number, number] = [3, 9];

export const PASTA_DADOS = 'dados';

/** Cabeçalho que acha a pasta da análise tanto no script quanto no Jupyter. */
export const PYTHON_PASTA = [
  'from pathlib import Path',
  '',
  '# A pasta onde este arquivo está (no Jupyter, a pasta em que o caderno foi aberto).',
  'PASTA = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()',
].join('\n');

/** O caderno como script: cada `mostrar` vira `print`, para aparecer no terminal. */
export function scriptPython(celulas: readonly CelulaPython[]): string {
  const blocos = celulas.map((celula) => {
    const code = celula.code.trimEnd();
    return celula.mostrar ? `${code}\nprint(${celula.mostrar})` : code;
  });
  return `${blocos.join('\n\n\n')}\n`;
}

/** O caderno em `.ipynb` (nbformat 4), para Jupyter, VS Code ou Colab. */
export function cadernoIpynb(celulas: readonly CelulaPython[], titulo: string): string {
  const linhas = (texto: string) => texto.split('\n').map((linha, i, todas) => (i < todas.length - 1 ? `${linha}\n` : linha));
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
      language_info: { name: 'python' },
      title: titulo,
    },
    cells: celulas.map((celula, i) => ({
      cell_type: 'code',
      id: `tabsis-${i + 1}`,
      metadata: {},
      execution_count: null,
      outputs: [],
      source: linhas(celula.mostrar ? `${celula.code.trimEnd()}\n${celula.mostrar}` : celula.code.trimEnd()),
    })),
  };
  return `${JSON.stringify(notebook, null, 1)}\n`;
}

const [MAIOR, MENOR] = PYTHON_MINIMO;

const PREPARAR_E_RODAR = `"""Prepara um Python só desta pasta (na primeira vez) e roda analise.py.

Chamado pelos arquivos "Rodar no ...". Usa apenas a biblioteca padrão.
"""
import functools
import subprocess
import sys
import venv
from pathlib import Path

# Sem buffer: as mensagens daqui têm de sair antes da saída da análise.
print = functools.partial(print, flush=True)

PASTA = Path(__file__).resolve().parent
AMBIENTE = PASTA / ".venv"
REQUISITOS = PASTA / "requirements.txt"
MARCA = AMBIENTE / "tabsis-requisitos.txt"


def python_do_ambiente() -> Path:
    if sys.platform == "win32":
        return AMBIENTE / "Scripts" / "python.exe"
    return AMBIENTE / "bin" / "python"


def preparar() -> Path:
    python = python_do_ambiente()
    pedidos = REQUISITOS.read_text(encoding="utf-8")
    if python.exists() and MARCA.exists() and MARCA.read_text(encoding="utf-8") == pedidos:
        return python
    print("Preparando o Python desta pasta. Só na primeira vez; precisa de internet.")
    if not python.exists():
        try:
            venv.create(AMBIENTE, with_pip=True, clear=AMBIENTE.exists())
        except Exception as erro:
            print()
            print(f"Não consegui criar o ambiente Python ({erro}).")
            if sys.platform.startswith("linux"):
                print("No Ubuntu/Debian, instale o módulo que falta e tente de novo:")
                print("    sudo apt install python3-venv")
            raise SystemExit(1)
    instalar = [str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(REQUISITOS)]
    if subprocess.call(instalar) != 0:
        print()
        print("A instalação dos pacotes falhou. Confira a internet e rode de novo.")
        raise SystemExit(1)
    MARCA.write_text(pedidos, encoding="utf-8")
    return python


def main() -> int:
    if sys.version_info < (${MAIOR}, ${MENOR}):
        print(f"Este Python é o {sys.version.split()[0]}; a análise precisa do ${MAIOR}.${MENOR} ou mais novo.")
        return 1
    python = preparar()
    print("Rodando analise.py...")
    print()
    return subprocess.call([str(python), str(PASTA / "analise.py")], cwd=PASTA)


if __name__ == "__main__":
    sys.exit(main())
`;

/*
 * Os iniciadores evitam acento: o cmd do Windows lê o .bat na página de
 * código do console, e "análise" viraria lixo. O texto com acento fica no
 * Python, que escreve no console direito.
 */
const RODAR_WINDOWS = [
  '@echo off',
  'cd /d "%~dp0"',
  'set "PY="',
  `py -3 -c "import sys; sys.exit(0 if sys.version_info >= (${MAIOR}, ${MENOR}) else 1)" >nul 2>nul && set "PY=py -3"`,
  `if not defined PY python -c "import sys; sys.exit(0 if sys.version_info >= (${MAIOR}, ${MENOR}) else 1)" >nul 2>nul && set "PY=python"`,
  'if not defined PY goto sem_python',
  '%PY% preparar_e_rodar.py',
  'set "STATUS=%ERRORLEVEL%"',
  'echo.',
  'pause',
  'exit /b %STATUS%',
  '',
  ':sem_python',
  `echo Nao encontrei o Python ${MAIOR}.${MENOR} ou mais novo neste computador.`,
  'echo Vou abrir a pagina de download. Na instalacao, marque "Add python.exe to PATH".',
  'echo Depois, de dois cliques neste arquivo de novo.',
  'start "" https://www.python.org/downloads/',
  'pause',
  'exit /b 1',
  '',
].join('\r\n');

function iniciadorUnix(sistema: 'mac' | 'linux'): string {
  const semPython = sistema === 'mac'
    ? [
      '  echo "Vou abrir a página de download. Instale e dê dois cliques neste arquivo de novo."',
      '  open "https://www.python.org/downloads/macos/"',
    ]
    : [
      '  echo "Instale pelo gerenciador do seu sistema, por exemplo:"',
      '  echo "    sudo apt install python3 python3-venv"',
    ];
  return [
    '#!/bin/bash',
    'cd "$(dirname "$0")" || exit 1',
    'PY=""',
    'for candidato in python3 python; do',
    `  if command -v "$candidato" >/dev/null 2>&1 && "$candidato" -c "import sys; sys.exit(0 if sys.version_info >= (${MAIOR}, ${MENOR}) else 1)" >/dev/null 2>&1; then`,
    '    PY="$candidato"',
    '    break',
    '  fi',
    'done',
    'if [ -z "$PY" ]; then',
    `  echo "Não encontrei o Python ${MAIOR}.${MENOR} ou mais novo neste computador."`,
    ...semPython,
    '  read -r -p "Aperte Enter para fechar..." _',
    '  exit 1',
    'fi',
    '"$PY" preparar_e_rodar.py',
    'status=$?',
    'echo',
    'read -r -p "Aperte Enter para fechar..." _',
    'exit "$status"',
    '',
  ].join('\n');
}

function leiaMe(titulo: string, csvNome: string, registros: string): string {
  return [
    titulo,
    '='.repeat(Math.min(titulo.length, 72)),
    '',
    `Microdados: ${PASTA_DADOS}/${csvNome} (${registros} registros, os da tabela do TabSis,`,
    'com Seleções e transformações já aplicadas).',
    '',
    'COMO RODAR (dois cliques)',
    '',
    '  Windows: "Rodar no Windows.bat"',
    '  macOS:   "Rodar no Mac.command"',
    '           Se o macOS bloquear ("desenvolvedor não identificado"): Ajustes do',
    '           Sistema > Privacidade e Segurança > "Abrir Mesmo Assim". Ou, no',
    '           Terminal: bash "Rodar no Mac.command"',
    '  Linux:   "rodar-linux.sh"  (ou, no terminal desta pasta: bash rodar-linux.sh)',
    '',
    `Precisa do Python ${MAIOR}.${MENOR} ou mais novo. Se não houver, o arquivo avisa e`,
    'mostra onde baixar (python.org). Na primeira vez ele prepara um Python só',
    'desta pasta (.venv) e instala os pacotes de requirements.txt; precisa de',
    'internet só nessa hora. Nada é instalado no resto do computador: apagar a',
    'pasta desfaz tudo.',
    '',
    'O resultado aparece na janela e é salvo em resultado-tabela.csv.',
    '',
    'PARA MEXER NA ANÁLISE',
    '',
    '  analise.py     o script; edite em qualquer editor e rode de novo.',
    '  analise.ipynb  o mesmo, como caderno (Jupyter, VS Code ou Google Colab).',
    '  requirements.txt  acrescente pacotes aqui (um por linha, por exemplo',
    '                 matplotlib) e eles são instalados na próxima vez.',
    '',
    'Fonte dos dados: DATASUS/Ministério da Saúde. Gerado pelo TabSis (tabweb.me).',
    '',
  ].join('\n');
}

/**
 * Os arquivos de texto do pacote. O CSV dos microdados entra à parte, em
 * `dados/`, porque já vem em bytes do motor de exportação.
 */
export function arquivosRodarNoComputador(opcoes: {
  celulas: readonly CelulaPython[];
  titulo: string;
  csvNome: string;
  registros: string;
  pacotes?: readonly string[];
}): Record<string, ArquivoTexto> {
  const pacotes = opcoes.pacotes?.length ? opcoes.pacotes : ['pandas>=2'];
  return {
    'LEIA-ME.txt': { texto: leiaMe(opcoes.titulo, opcoes.csvNome, opcoes.registros) },
    'analise.py': { texto: scriptPython(opcoes.celulas) },
    'analise.ipynb': { texto: cadernoIpynb(opcoes.celulas, opcoes.titulo) },
    'requirements.txt': { texto: `${pacotes.join('\n')}\n` },
    'preparar_e_rodar.py': { texto: PREPARAR_E_RODAR },
    'Rodar no Windows.bat': { texto: RODAR_WINDOWS },
    'Rodar no Mac.command': { texto: iniciadorUnix('mac'), executavel: true },
    'rodar-linux.sh': { texto: iniciadorUnix('linux'), executavel: true },
  };
}

/** Atributos externos do zip para um executável Unix (rwxr-xr-x). */
export const ZIP_ATTRS_EXECUTAVEL = 0o100755 * 0x10000;
/** Atributos externos do zip para um arquivo comum (rw-r--r--). */
export const ZIP_ATTRS_COMUM = 0o100644 * 0x10000;

"""Varredura TabSis × TabWin: cada variável de Linha de um DEF oficial, tabulada no TabWin real.

Uso: python3 varrer_tabwin.py <DEF oficial> <arquivo de dados (nome no G001)> <prefixo> [início] [fim]

Para cada linha L do DEF cujo recurso (CNV/DBF) existe no G001, escreve AAA.DEF
(só essa variável), abre no TabWin (Wine, Xvfb :77), executa e salva
C:\\TabWin\\saida\\<prefixo><nnn>.tab. Registra em <prefixo>.jsonl.
"""
import json, os, subprocess, sys, time
from pathlib import Path

PASTA = os.environ.get('TABWIN_PASTA', 'G001')
G001 = Path.home() / '.local/share/wine-tabwin/drive_c/TabWin' / PASTA
SAIDA = Path.home() / '.local/share/wine-tabwin/drive_c/TabWin/saida'
S = Path('/tmp/claude-1000/-home-red-learner/7f241cfa-4ff7-41a6-ac0b-0c3ec3d33823/scratchpad')
PY = str(S / 'venv/bin/python')

def x(*cmds):
    subprocess.run([PY, '-I', str(S / 'x.py'), *cmds], check=True)

def shot(nome):
    subprocess.run([PY, '-I', str(S / 'shot.py'), ':77', str(S / nome)], check=False, capture_output=True)

def pergunta_aberta() -> bool:
    saida = subprocess.run([PY, '-I', str(Path(__file__).parent / 'pixel.py'), '500', '388'], capture_output=True, text=True).stdout.split()
    r, g, b = (int(v) for v in saida) if len(saida) == 3 else (255, 255, 255)
    return b > 200 and r < 120  # barra de título azul da pergunta

def recurso(caminho: str):
    rel = caminho.strip().replace('\\', '/')
    if (G001 / rel).exists():
        return caminho.strip()
    base = rel.split('/')[-1].upper()
    for f in G001.iterdir():
        if f.name.upper() == base and f.is_file():
            return f.name
    for sub in ('CNV', 'DBF'):
        if not (G001 / sub).is_dir():
            continue
        for f in (G001 / sub).iterdir():
            if f.name.upper() == base:
                return f'{sub}\\{f.name}'
    return None

def opcoes(def_path: Path):
    linhas = def_path.read_bytes().decode('cp1252').splitlines()
    for numero, linha in enumerate(linhas, 1):
        if not linha.startswith('L'):
            continue
        partes = [p for p in linha[1:].split(',')]
        if len(partes) < 3:
            continue
        caminho = partes[-1]
        if not ('.' in caminho and ('CNV' in caminho.upper() or 'DBF' in caminho.upper())):
            yield numero, linha, None
            continue
        achado = recurso(caminho)
        if not achado:
            continue
        partes[-1] = achado
        yield numero, 'L' + ','.join(partes), achado

def main():
    def_path = G001 / sys.argv[1]
    dados = sys.argv[2]
    prefixo = sys.argv[3]
    inicio = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    fim = int(sys.argv[5]) if len(sys.argv) > 5 else 10**6
    registro = Path(__file__).parent / f'{prefixo}.jsonl'
    todas = list(opcoes(def_path))
    print('opções', len(todas), flush=True)
    for indice, (numero, linha, achado) in enumerate(todas):
        if indice < inicio or indice >= fim:
            continue
        nome = f'{prefixo}{indice:03d}'
        alvo = SAIDA / f'{nome}.tab'
        if alvo.exists():
            alvo.unlink()
        texto = f';Varredura TabSis {nome}\r\nAC:\\TabWin\\{PASTA}\\{dados}\r\n{linha}\r\n'
        # Um nome novo por variável: o TabWin guarda o DEF aberto pelo nome e,
        # com o mesmo nome, reabria a variável anterior. Só um AAA*.DEF por vez,
        # para ele ser sempre o primeiro da lista.
        for antigo in G001.glob('AAA*.DEF'):
            antigo.unlink()
        (G001 / f'AAA{indice:03d}.DEF').write_bytes(texto.encode('cp1252'))
        ok = False
        try:
            # Arquivo → Executar tabulação; entra e sai da pasta CNV para o seletor
            # reler a lista (ele não vê DEF novo sem isso); abre o primeiro.
            x('c:28,41', 's:0.8', 'c:66,185', 's:1.5', 'dc:698,373', 's:0.8', 'dc:695,357', 's:0.8',
              'c:420,325', 's:0.4', 'c:535,555', 's:2')
            # "Salvar Tabela Atual?" aparece quando já há tabela aberta: Não.
            if pergunta_aberta():
                x('c:725,495', 's:2')
            x('c:1055,312', 's:3')
            # A tabulação pode demorar: espera o log aparecer (até 60 s).
            x('c:790,594', 's:0.6', 'c:28,41', 's:0.6', 'c:50,108', 's:1.2',
              'c:630,414', 'k:Home', 'k:Shift_L+End', f't:{nome}', 'c:797,416', 's:1.2')
            esperado = linha[1:].split(',')[0].strip()
            for _ in range(20):
                if alvo.exists() and alvo.stat().st_size > 0:
                    # Confere que a tabela salva é da variável pedida, e não a anterior.
                    salvo = alvo.read_bytes().decode('cp1252', 'replace')
                    achada = next((l[6:].strip() for l in salvo.splitlines() if l.startswith('Linha=')), '')
                    # O TabWin tira o ponto final do nome ("…de Resid." vira "…de Resid").
                    ok = achada.rstrip('.').strip() == esperado.rstrip('.').strip()
                    if not ok:
                        print('tabela de outra variável:', achada, '≠', esperado, flush=True)
                    break
                time.sleep(0.5)
        except subprocess.CalledProcessError as erro:
            print('erro de clique', erro, flush=True)
        if not ok:
            shot(f'falha-{nome}.png')
            # Fecha o que estiver aberto (mensagem, diálogo) e segue.
            x('k:Escape', 's:0.4', 'k:Return', 's:0.4', 'k:Escape', 's:0.4')
        with registro.open('a', encoding='utf-8') as saida:
            saida.write(json.dumps({'indice': indice, 'nome': nome, 'linhaDef': numero, 'linha': linha, 'recurso': achado, 'ok': ok}, ensure_ascii=False) + '\n')
        print(indice, nome, 'ok' if ok else 'FALHOU', linha[:60], flush=True)

if __name__ == '__main__':
    main()

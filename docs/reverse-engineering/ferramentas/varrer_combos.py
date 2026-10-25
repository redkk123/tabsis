"""Varredura TabSis × TabWin, parte 2: Linha com Colunas, vários Incrementos e Seleções.

Uso: TABWIN_PASTA=G001 python3 varrer_combos.py <combos.json> <dados> <prefixo> [início] [fim]

As combinações vêm de scripts/gerar-combos-varredura.mjs: uma Linha, às vezes
uma Coluna, zero a três Incrementos e às vezes uma Seleção (com o índice de cada
categoria na lista do painel). Escreve um DEF só com essas linhas,
marca tudo no painel do TabWin, executa e salva C:\\TabWin\\saida\\<prefixo><nnn>.tab.
Registra em <prefixo>.jsonl o que foi marcado (o comparador monta o mesmo no TabSis).
"""
import json, subprocess, sys, time
from pathlib import Path

import varrer_tabwin as v

ALTURA = 13  # altura de uma linha nas listas do painel

def com_recurso(linha: str) -> str:
    """Troca o caminho da CNV/DBF pelo nome que o arquivo tem na pasta."""
    partes = linha[1:].split(',')
    caminho = partes[-1]
    if len(partes) >= 3 and '.' in caminho and ('CNV' in caminho.upper() or 'DBF' in caminho.upper()):
        achado = v.recurso(caminho)
        if achado:
            partes[-1] = achado
    return linha[0] + ','.join(partes)

def nome_da_linha(linha: str) -> str:
    return linha[1:].split(',')[0].strip()

def main():
    combos = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    dados = sys.argv[2]
    prefixo = sys.argv[3]
    inicio = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    fim = int(sys.argv[5]) if len(sys.argv) > 5 else 10**6
    registro = Path(__file__).parent / f'{prefixo}.jsonl'
    print('combinações', len(combos), flush=True)
    for indice, combo in enumerate(combos):
        if indice < inicio or indice >= fim:
            continue
        nome = f'{prefixo}{indice:03d}'
        alvo = v.SAIDA / f'{nome}.tab'
        if alvo.exists():
            alvo.unlink()
        corpo = [*combo['incrementos'], combo['linha']]
        if combo['coluna']:
            corpo.append(combo['coluna'])
        if combo['selecao']:
            corpo.append(combo['selecao']['linha'])
        texto = f';Varredura TabSis {nome}\r\nAC:\\TabWin\\{v.PASTA}\\{dados}\r\n' + ''.join(com_recurso(l) + '\r\n' for l in corpo)
        for antigo in list(v.G001.glob('AAA*.DEF')) + list(v.G001.glob('0VZ*.DEF')):
            antigo.unlink()
        (v.G001 / f'0VZ{indice:03d}.DEF').write_bytes(texto.encode('cp1252'))
        ok = False
        motivo = ''
        try:
            if v.log_aberto():
                v.x('c:790,594', 's:0.6')
            v.x('c:28,41', 's:0.8', 'c:66,185', 's:1.5', 'dc:698,373', 's:0.8', 'dc:695,357', 's:0.8',
                'c:420,325', 's:0.4', 'c:535,555', 's:1')
            for _ in range(80):
                if v.pergunta_aberta():
                    v.x('c:725,495', 's:1')
                    continue
                if v.painel_aberto():
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError('o painel da tabulação não abriu')
            cliques = []
            # Colunas: "Não ativa" é a 1ª; a única C do DEF é a 2ª.
            if combo['coluna']:
                cliques += ['c:485,264', 's:0.4']
            # Incremento: "Freqüência" é a 1ª; as I do DEF vêm depois, na ordem.
            for k in range(len(combo['incrementos'])):
                cliques += [f'{"c" if k == 0 else "cc"}:700,{264 + ALTURA * k}', 's:0.3']
            if combo['selecao']:
                cliques += ['c:240,426', 's:0.4', 'c:437,436', 's:2']
                for k, i in enumerate(combo['selecao']['indices']):
                    cliques += [f'{"c" if k == 0 else "cc"}:300,{539 + ALTURA * i}', 's:0.3']
            if cliques:
                v.x(*cliques)
            v.x('c:1055,312', 's:2')
            # Coluna de municípios (5.570) demora: até 5 min.
            for _ in range(300):
                if v.log_aberto():
                    break
                if v.mensagem_aberta():
                    raise RuntimeError('o TabWin cancelou a tabulação ou deu erro')
                time.sleep(1)
            else:
                raise RuntimeError('o TabWin não abriu o Log')
            v.x('c:790,594', 's:0.6', 'c:28,41', 's:0.6', 'c:50,108', 's:1.2',
                'c:630,414', 'k:Home', 'k:Shift_L+End', f't:{nome}', 'c:797,416', 's:1.2')
            for _ in range(20):
                if alvo.exists() and alvo.stat().st_size > 0:
                    salvo = alvo.read_bytes().decode('cp1252', 'replace').splitlines()
                    campo = lambda k: next((l.split('=', 1)[1].strip() for l in salvo if l.startswith(k + '=')), '')
                    confere = lambda achada, esperado: achada == esperado or achada == esperado[:30].rstrip()
                    ok = confere(campo('Linha'), nome_da_linha(combo['linha']))
                    if combo['coluna']:
                        ok = ok and confere(campo('Coluna'), nome_da_linha(combo['coluna']))
                    if combo['selecao']:
                        ok = ok and any(l.startswith('[Seleções_Ativas]') for l in salvo)
                    if not ok:
                        motivo = f'tabela salva não confere: Linha={campo("Linha")} Coluna={campo("Coluna")}'
                    break
                time.sleep(0.5)
            else:
                motivo = 'a tabela não foi salva'
        except (subprocess.CalledProcessError, RuntimeError) as erro:
            motivo = str(erro)
        registro_linha = {k: combo[k] for k in ('linha', 'coluna', 'incrementos', 'selecao')}
        if not ok:
            print('falhou:', motivo, flush=True)
            v.shot(f'falha-{nome}.png')
            subprocess.run([str(Path(__file__).parent / 'abrir_tabwin.sh'), v.PASTA], check=False, capture_output=True)
        with registro.open('a', encoding='utf-8') as saida:
            saida.write(json.dumps({'indice': indice, 'nome': nome, **registro_linha, 'ok': ok, 'motivo': motivo}, ensure_ascii=False) + '\n')
        print(indice, nome, 'ok' if ok else 'FALHOU', nome_da_linha(combo['linha']), '×', combo['coluna'] and nome_da_linha(combo['coluna']),
              len(combo['incrementos']), 'inc', combo['selecao'] and combo['selecao']['indices'], flush=True)

if __name__ == '__main__':
    main()

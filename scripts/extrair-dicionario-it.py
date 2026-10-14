"""Extrai o layout dos arquivos dos Informes Técnicos do DATASUS (SIH, SIA, CNES).

Uso: python3 extrair-dicionario-it.py <informe.pdf> <SISTEMA> > saida.json

Os informes descrevem cada arquivo numa tabela SEQ | CAMPO | TIPO E TAM |
DESCRIÇÃO. No texto corrido a descrição de várias linhas fica centralizada na
altura do nome e não dá para saber a qual campo pertence; por isso o script lê
o PDF com coordenadas (`pdftotext -bbox-layout`): cada célula é um bloco, e a
descrição é o bloco da coluna da direita que cobre a altura do nome do campo.

Saída: {"PREFIXO": {"CAMPO": "descrição"}}, com o prefixo do arquivo tirado do
título da seção ("RD*.dbf", "PAUFAAMM.DBF", "(ST*.dbf)"). Notas de rodapé
(algarismos sobrescritos, mais baixos que o texto) são descartadas. O resultado
é revisado à mão antes de entrar em `datasus-field-dictionary.ts`.
"""
import html
import json
import re
import subprocess
import sys
import tempfile

TIPO = re.compile(r'^(char|numeric|number|num|date|varchar|int|integer|decimal)\s*\(', re.I)
CABECALHO = re.compile(r'^(DESCRIÇÃO|DESCRIÇÃO/OBSERVAÇÕES|Descrição/Observações|TIPO E TAM|SEQ|CAMPO|NOME DO CAMPO)$', re.I)
CAMPO = re.compile(r'^[A-Z][A-Z0-9_ÊÇ]{1,11}$')
SECAO = [
    re.compile(r'\(([A-Z]{2,3})\*\.dbf\s*\)', re.I),
    re.compile(r'\b([A-Z]{2,3})\*\.dbf\b', re.I),
    re.compile(r'\b([A-Z]{2,3})UF(?:AAMM|MM)\.DBF\b', re.I),
]


def linhas_do_bloco(corpo):
    """As linhas do bloco, cada uma com a altura (y0, y1), o x inicial e o texto."""
    linhas = []
    for linha in re.findall(r'<line[^>]*>(.*?)</line>', corpo, re.S):
        ws = []
        for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', linha):
            ws.append((float(m[1]), float(m[2]), float(m[4]), html.unescape(m[5]), float(m[3])))
        if not ws:
            continue
        alturas = sorted(w[2] - w[1] for w in ws)
        normal = alturas[len(alturas) // 2]
        # Sobrescrito de nota de rodapé: algarismo bem mais baixo que o resto.
        ws = [w for w in ws if not (w[3].isdigit() and (w[2] - w[1]) < normal * 0.8)]
        if ws:
            linhas.append({'x0': ws[0][0], 'x1': ws[-1][4], 'y0': min(w[1] for w in ws), 'y1': max(w[2] for w in ws), 't': ' '.join(w[3] for w in ws)})
    return linhas


def main(pdf, sistema):
    with tempfile.NamedTemporaryFile(suffix='.html') as tmp:
        subprocess.run(['pdftotext', '-bbox-layout', pdf, tmp.name], check=True)
        doc = open(tmp.name, encoding='utf-8').read()
    resultado = {}
    prefixo = None
    for pagina in re.findall(r'<page[^>]*>(.*?)</page>', doc, re.S):
        blocos = []
        for m in re.finditer(r'<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</block>', pagina, re.S):
            linhas = linhas_do_bloco(m[5])
            blocos.append({'x0': float(m[1]), 'y0': float(m[2]), 'x1': float(m[3]), 'y1': float(m[4]),
                           'linhas': linhas, 't': ' '.join(l['t'] for l in linhas).strip()})
        blocos.sort(key=lambda b: (b['y0'], b['x0']))
        # Linhas soltas: o nome do campo e o tipo podem estar num bloco com a
        # coluna inteira (SIA), então a busca é linha a linha.
        todas = [l for b in blocos for l in b['linhas']]
        tipos = [l for l in todas if TIPO.match(l['t'])]
        campos = []
        for bloco in blocos:
            for padrao in SECAO:
                achado = padrao.search(bloco['t'])
                if achado and 'layout' in bloco['t'].lower():
                    prefixo = achado[1].upper()
            if not prefixo:
                continue
            for linha in bloco['linhas']:
                nome = linha['t'].split()[-1] if re.match(r'^\d+\s+\S+$', linha['t']) else linha['t']
                if not CAMPO.match(nome):
                    continue
                centro = (linha['y0'] + linha['y1']) / 2
                # O tipo pode estar uma linha abaixo do nome (F_AREIA no CNES).
                tipo = min((t for t in tipos if t['x0'] > linha['x0'] and abs((t['y0'] + t['y1']) / 2 - centro) <= 9),
                           key=lambda t: abs((t['y0'] + t['y1']) / 2 - centro), default=None)
                if tipo:
                    campos.append({'nome': nome.replace('Ê', 'E'), 'centro': centro, 'xdesc': tipo['x1'], 'prefixo': prefixo, 'partes': []})
        if not campos:
            continue
        xdesc = min(c['xdesc'] for c in campos) - 2
        usadas = set()

        def descricao_valida(linha):
            return linha['x0'] >= xdesc and not TIPO.match(linha['t']) and not CABECALHO.match(linha['t'])

        # 1) Página em que cada célula é um bloco (SIH, CNES): o bloco da
        #    coluna de descrição vai inteiro para o campo cuja altura ele cobre.
        #    Se algum bloco cobre dois campos, a coluna está fundida (SIA) e a
        #    página inteira vai pelo passo 2.
        blocos_desc = [b for b in blocos if any(descricao_valida(l) for l in b['linhas'])]
        fundida = any(sum(1 for c in campos if b['y0'] - 2 <= c['centro'] <= b['y1'] + 2) > 1 for b in blocos_desc)
        if not fundida:
            for bloco in blocos_desc:
                dentro = [c for c in campos if bloco['y0'] - 2 <= c['centro'] <= bloco['y1'] + 2]
                if len(dentro) != 1:
                    continue
                for linha in bloco['linhas']:
                    if descricao_valida(linha):
                        dentro[0]['partes'].append(((linha['y0'] + linha['y1']) / 2, linha['t']))
                        usadas.add(id(linha))
        # 2) Coluna fundida num bloco só (SIA): linha na altura de um campo é
        #    dele; linha solta vai para o campo mais próximo que não tem texto
        #    na própria altura (a célula de várias linhas fica centralizada).
        soltas = [l for l in todas if id(l) not in usadas and descricao_valida(l)]
        com_texto = set()
        for linha in soltas:
            centro_linha = (linha['y0'] + linha['y1']) / 2
            dono = next((c for c in campos if linha['y0'] - 0.5 <= c['centro'] <= linha['y1'] + 0.5), None)
            if dono:
                dono['partes'].append((centro_linha, linha['t']))
                com_texto.add(id(dono))
                usadas.add(id(linha))
        for linha in soltas:
            if id(linha) in usadas:
                continue
            centro_linha = (linha['y0'] + linha['y1']) / 2
            vazios = [c for c in campos if id(c) not in com_texto and abs(c['centro'] - centro_linha) <= 40]
            candidatos = vazios or [c for c in campos if abs(c['centro'] - centro_linha) <= 26]
            if candidatos:
                min(candidatos, key=lambda c: abs(c['centro'] - centro_linha))['partes'].append((centro_linha, linha['t']))
        for campo in campos:
            descricao = re.sub(r'\s+', ' ', ' '.join(t for _, t in sorted(campo['partes']))).strip()
            if descricao:
                resultado.setdefault(campo['prefixo'], {})[campo['nome']] = descricao
    json.dump({'sistema': sistema, 'arquivos': resultado}, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

"""RE-004, teste H: código de CNV curta que começa ou termina com hífen.

Uso: python3 re004-cnv-hifen.py <pasta de dados do TabWin (G001)>

Gera RE4H001.DBF (campo C3 com 050, 100, 300, 700, 999, A01, K01 e branco;
pesos 1, 2, 4… no campo QTD, lido pela diretiva G), as CNVs H1–H4 e o
RE4H.DEF. A soma de cada linha diz exatamente quem caiu nela.

  H1: "-zzz"  (como o "-zzzz" da NATJUR.CNV do CNES)
  H2: "-500"
  H3: "500-"
  H4: "---"   (como o "----" das linhas-título do SIH)
  H5: "   -500"  (espaços antes do hífen: o branco como início da faixa)
  H6: "   -zzz"  (como o "    -zzzz" da NATJUR.CNV, com os espaços)
  H7: "000-zzz"  (fim da faixa além do maior código curto)
  H8: "000-500"  (controle)

Em todas, a linha 2 é o código exato 100.
"""
import datetime
import struct
import sys


def dbf(path, fields, records):
    header_length = 32 + 32 * len(fields) + 1
    record_length = 1 + sum(length for _, _, length in fields)
    today = datetime.date.today()
    out = bytearray(struct.pack('<BBBBIHH20x', 3, today.year - 1900, today.month, today.day,
                                len(records), header_length, record_length))
    for name, kind, length in fields:
        out += struct.pack('<11sc4xBB14x', name.encode(), kind.encode(), length, 0)
    out += b'\r'
    for values in records:
        out += b' ' + b''.join(value.encode() for value in values)
    out += b'\x1a'
    open(path, 'wb').write(out)


def line(seq, desc, codes):
    return f"{'':>3}{seq:>4}{'':2}{desc:<50} {codes}"


def main(folder):
    codes = ['050', '100', '300', '700', '999', 'A01', 'K01', '   ']
    dbf(f'{folder}/RE4H001.DBF', [('C3', 'C', 3), ('QTD', 'N', 8)],
        [(code, str(2 ** i).rjust(8)) for i, code in enumerate(codes)])
    forms = {'H1': '-zzz', 'H2': '-500', 'H3': '500-', 'H4': '---',
             'H5': '   -500', 'H6': '   -zzz', 'H7': '000-zzz', 'H8': '000-500'}
    lines = [';RE-004 H hifen na CNV curta', 'AC:\\TabWin\\G001\\RE4H*.DBF', 'GQTD']
    for key, token in forms.items():
        open(f'{folder}/{key}.CNV', 'w', newline='').write(
            '\r\n'.join(['2 3', line(1, f'Hifen [{token}]', token), line(2, 'Exato 100', '100')]) + '\r\n')
        lines.append(f'L{key} [{token.strip()}],C3,1,{key}.CNV')
    open(f'{folder}/RE4H.DEF', 'w', newline='').write('\r\n'.join(lines) + '\r\n')


if __name__ == '__main__':
    main(sys.argv[1])

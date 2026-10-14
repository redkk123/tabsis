"""RE-004, teste I: como o TabWin lê a lista de códigos da CNV curta.

Uso: python3 re004-cnv-leitura.py <pasta de dados do TabWin (G001)>

Previsões da decompilação de CnvCarrega (0x47737c), CnvLeCodigo (0x477314) e
CnvIndiceCurto (0x476c24), a conferir:

  I1: "050, 300"  — o laço para no espaço depois da vírgula: só 050 entra.
  I2: linha-título sem código nenhum — vira o código em branco (índice 0)?
  I3: "*50"       — '*' não é letra: Val falha, vira "050" e pega o 050.
  I4: "1 5"       — espaço no meio (sem espaço na frente): vira "105".

Registros (campo C3): 050, 100, 300, 105, branco, *50, com pesos 1, 2, 4… no
campo QTD (diretiva G). A linha 2 de cada CNV é o código exato 100.
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


def line(seq, desc, codes=None):
    base = f"{'':>3}{seq:>4}{'':2}{desc:<50}"
    return base if codes is None else f"{base} {codes}"


def main(folder):
    codes = ['050', '100', '300', '105', '   ', '*50']
    dbf(f'{folder}/RE4I001.DBF', [('C3', 'C', 3), ('QTD', 'N', 8)],
        [(code, str(2 ** i).rjust(8)) for i, code in enumerate(codes)])
    cnvs = {
        'I1': ['2 3', line(1, 'Virgula espaco', '050, 300'), line(2, 'Exato 100', '100')],
        'I2': ['3 3', line(1, 'Titulo sem codigo').rstrip(), line(2, 'Exato 100', '100'), line(3, 'Outro 300', '300')],
        'I3': ['2 3', line(1, 'Asterisco', '*50'), line(2, 'Exato 100', '100')],
        'I4': ['2 3', line(1, 'Espaco no meio', '1 5'), line(2, 'Exato 100', '100')],
    }
    linhas = [';RE-004 I leitura da CNV curta', 'AC:\\TabWin\\G001\\RE4I*.DBF', 'GQTD']
    for key, conteudo in cnvs.items():
        open(f'{folder}/{key}.CNV', 'w', newline='').write('\r\n'.join(conteudo) + '\r\n')
        linhas.append(f'L{key},C3,1,{key}.CNV')
    open(f'{folder}/RE4I.DEF', 'w', newline='').write('\r\n'.join(linhas) + '\r\n')


if __name__ == '__main__':
    main(sys.argv[1])

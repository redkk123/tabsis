"""RE-003: gera os DBFs, CNVs e DEFs dos quatro testes de código curto.

Uso: python3 re003-cnv-curta.py <pasta de dados do TabWin, ex. drive_c/TabWin/G001>

Cada registro tem um peso diferente (1, 2, 4, 8…) no campo QTD, lido pela
diretiva G do DEF. Assim a soma de cada linha da tabela do TabWin diz
exatamente quais registros caíram nela. Os DEFs se chamam RE3T1..RE3T4.DEF;
cada um lê só o seu DBF (RE3T1*.DBF etc.).
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
        out += b' '
        for (_, kind, length), value in zip(fields, values):
            text = str(value)
            out += (text.rjust(length) if kind == 'N' else text.ljust(length)).encode()
    out += b'\x1a'
    open(path, 'wb').write(out)


def cnv(path, header, rows):
    # colunas fixas: 4-7 número da categoria, 10-59 nome, 61+ códigos
    lines = [header] + [f"{'':3}{seq:>4}{'':2}{name:<50} {codes}" for seq, name, codes in rows]
    open(path, 'w', newline='').write('\r\n'.join(lines) + '\r\n')


def definition(path, title, pattern, lines):
    text = [f';{title}', f'AC:\\TabWin\\G001\\{pattern}', 'GQTD'] + lines
    open(path, 'w', newline='').write('\r\n'.join(text) + '\r\n')


def weighted(codes):
    return [(code, 2 ** index) for index, code in enumerate(codes)]


def main(folder):
    # T1: CNV com A01, 100-199 e 900-999; dados com letras e dígitos.
    data = weighted(['A01', '001', 'B05', 'a01', 'K01', 'J99', 'Z99', '105', '950'])
    dbf(f'{folder}/RE3T1001.DBF', [('COD', 'C', 3), ('QTD', 'N', 8)], data)
    cnv(f'{folder}/RE3T1.CNV', '3 3', [(1, 'Letra A01', 'A01'), (2, 'Faixa 100-199', '100-199'), (3, 'Faixa 900-999', '900-999')])
    definition(f'{folder}/RE3T1.DEF', 'RE-003 T1 letra x faixa', 'RE3T1*.DBF', ['LT1,COD,1,RE3T1.CNV'])

    # T2: dados com letra contra CNV só de dígitos (d01), e o contrário.
    letters = ['A01', 'B01', 'I01', 'J01', 'K01', 'S01', 'T01', 'Z01', 'a01', 'j01', '@01']
    digits = [f'{d}01' for d in range(10)]
    records = [(code, '', 2 ** i) for i, code in enumerate(letters)]
    records += [('', code, 2 ** (i + len(letters))) for i, code in enumerate(digits)]
    dbf(f'{folder}/RE3T2001.DBF', [('COD', 'C', 3), ('NUM', 'C', 3), ('QTD', 'N', 8)], records)
    cnv(f'{folder}/RE3T2D.CNV', '10 3', [(d + 1, f'Digito {d}01', f'{d}01') for d in range(10)])
    cnv(f'{folder}/RE3T2L.CNV', '10 3', [(i + 1, f'Letra {c}01', f'{c}01') for i, c in enumerate('ABCDEFGHIJ')])
    definition(f'{folder}/RE3T2.DEF', 'RE-003 T2 letra x digito', 'RE3T2*.DBF',
               ['LDados letra x CNV digito,COD,1,RE3T2D.CNV', 'LDados digito x CNV letra,NUM,1,RE3T2L.CNV'])

    # T3: letras além do J nos dois lados; letra e espaço fora da 1ª posição.
    data = weighted(['J01', 'K01', 'Z01', '1A1', '101', 'a01', '@01', '001', '1 1', ' 01', '01 '])
    dbf(f'{folder}/RE3T3001.DBF', [('COD', 'C', 3), ('QTD', 'N', 8)], data)
    codes = ['J01', 'K01', 'Z01', '1A1', 'a01', '`01', '1 1', '001']
    cnv(f'{folder}/RE3T3.CNV', f'{len(codes)} 3', [(i + 1, f'CNV {c}', c) for i, c in enumerate(codes)])
    definition(f'{folder}/RE3T3.DEF', 'RE-003 T3 letras no meio', 'RE3T3*.DBF', ['LT3,COD,1,RE3T3.CNV'])

    # T4: campo em branco e zeros à direita.
    data = weighted(['   ', '0  ', '00 ', '000', '  1', 'A  '])
    dbf(f'{folder}/RE3T4001.DBF', [('COD', 'C', 3), ('QTD', 'N', 8)], data)
    cnv(f'{folder}/RE3T4.CNV', '3 3', [(1, 'CNV 000', '000'), (2, 'CNV 001', '001'), (3, 'CNV 100', '100')])
    definition(f'{folder}/RE3T4.DEF', 'RE-003 T4 branco', 'RE3T4*.DBF', ['LT4,COD,1,RE3T4.CNV'])


if __name__ == '__main__':
    main(sys.argv[1])

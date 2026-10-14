"""RE-003, testes T5 a T7: CNV literal (L), faixas literais e código repetido.

Uso: python3 re003-cnv-literal.py <pasta de dados do TabWin> <nudosePB.cnv do TAB_SINANNET>

Gera RE3T5001.DBF e RE3T6001.DBF (campo N2, número de 0 a 20 alinhado à
direita, e um registro em branco; campos C2/C6 para os códigos repetidos), as
CNVs de teste e os DEFs RE3T5.DEF, RE3T6.DEF e RE3T7.DEF. Pesos 1, 2, 4… no
campo QTD (diretiva G): a soma de cada linha diz exatamente quem caiu nela.
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


def line(seq, desc, codes, sub=''):
    return f"{sub:>3}{seq:>4}{'':2}{desc:<50} {codes}"


def write(path, lines):
    open(path, 'w', newline='').write('\r\n'.join(lines) + '\r\n')


def main(folder, nudose):
    numbers = [None] + list(range(21))
    def n2(v): return '  ' if v is None else str(v).rjust(2)

    # T5: nudosePB como veio (l minúsculo), com L, sem modificador; código repetido com e sem pai.
    records = [(n2(v), '  ', str(2 ** i).rjust(8)) for i, v in enumerate(numbers)]
    records += [('  ', 'AA', str(2 ** 22).rjust(8)), ('  ', 'BB', str(2 ** 23).rjust(8))]
    dbf(f'{folder}/RE3T5001.DBF', [('N2', 'N', 2), ('C2', 'C', 2), ('QTD', 'N', 8)], records)
    original = open(nudose, 'rb').read()
    open(f'{folder}/PBORIG.CNV', 'wb').write(original)
    open(f'{folder}/PBUPPER.CNV', 'wb').write(original.replace(b'5 2 l', b'5 2 L', 1))
    open(f'{folder}/PBSHORT.CNV', 'wb').write(original.replace(b'5 2 l', b'5 2', 1))
    write(f'{folder}/LITDUP.CNV', ['3 2 L', line(1, 'Primeira', 'AA'), line(2, 'Segunda', 'AA,BB'), line(3, 'Terceira', 'BB')])
    write(f'{folder}/LITSUB.CNV', ['3 2 L', line(1, 'Pai', 'AA,BB'), line(2, 'Filho A', 'AA', '1'), line(3, 'Filho B', 'BB', '1')])
    write(f'{folder}/RE3T5.DEF', [';RE-003 T5 literal e faixas', 'AC:\\TabWin\\G001\\RE3T5*.DBF', 'GQTD',
                                  'LDoses PB orig,N2,1,PBORIG.CNV', 'LDoses PB L,N2,1,PBUPPER.CNV',
                                  'LDoses PB curto,N2,1,PBSHORT.CNV', 'LLit dup,C2,1,LITDUP.CNV', 'LLit sub,C2,1,LITSUB.CNV'])

    # T6: cada forma de faixa literal sozinha; código longo (6) repetido.
    records = [(n2(v), '      ', str(2 ** i).rjust(8)) for i, v in enumerate(numbers)]
    records += [('  ', '120040', str(2 ** 22).rjust(8)), ('  ', '120050', str(2 ** 23).rjust(8))]
    dbf(f'{folder}/RE3T6001.DBF', [('N2', 'N', 2), ('C6', 'C', 6), ('QTD', 'N', 8)], records)
    forms = {'RA': ' 7-48', 'RB': '07-48', 'RC': '7 -48', 'RD': ' 1- 5', 'RE': '01-05', 'RF': '1 -5 ', 'RG': ' 7- 9', 'RH': ' 7-15'}
    lines = [';RE-003 T6 faixas literais', 'AC:\\TabWin\\G001\\RE3T6*.DBF', 'GQTD']
    for key, codes in forms.items():
        write(f'{folder}/{key}.CNV', ['1 2 L', line(1, f'Faixa [{codes}]', codes)])
        lines.append(f'L{key} [{codes}],N2,1,{key}.CNV')
    write(f'{folder}/LONGDUP.CNV', ['2 6', line(1, 'Primeira', '120040,120050'), line(2, 'Segunda', '120040')])
    lines.append('LLongo dup,C6,1,LONGDUP.CNV')
    write(f'{folder}/RE3T6.DEF', lines)

    # T7: faixas literais sobrepostas, em ordens diferentes.
    write(f'{folder}/K1.CNV', ['2 2 L', line(1, 'A 07-48', '07-48'), line(2, 'B _7-48', ' 7-48')])
    write(f'{folder}/K2.CNV', ['2 2 L', line(1, 'A _7-48', ' 7-48'), line(2, 'B 07-48', '07-48')])
    write(f'{folder}/K3.CNV', ['2 2 L', line(1, 'A 0_', '0 ,'), line(2, 'B _7-48', ' 7-48')])
    write(f'{folder}/K4.CNV', ['1 2 L', line(1, 'Tres faixas', '07-48,7 -48, 7-48')])
    open(f'{folder}/K5.CNV', 'wb').write(original.replace(b'07-48,7 -48, 7-48', b' 7-48'))
    write(f'{folder}/RE3T7.DEF', [';RE-003 T7 faixas literais combinadas', 'AC:\\TabWin\\G001\\RE3T6*.DBF', 'GQTD']
          + [f'L{key},N2,1,{key}.CNV' for key in ['K1', 'K2', 'K3', 'K4', 'K5']])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

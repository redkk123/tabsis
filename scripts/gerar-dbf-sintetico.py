"""Gera DBFs sintéticos com o formato de um arquivo do SINAN, para medir volume.

Uso: python3 scripts/gerar-dbf-sintetico.py <pasta> <registros por arquivo> <ano inicial> <quantos anos>

Os campos imitam os da notificação (município de residência com códigos reais
do IBGE, data de notificação, semana, sexo, idade, raça, classificação,
evolução) e um bloco de enchimento para chegar perto do tamanho de registro de
um arquivo real. Nada aqui é dado de verdade: serve para medir tempo e memória.
"""
import datetime
import json
import random
import struct
import sys
from pathlib import Path

CAMPOS = [
    ('TP_NOT', 'C', 1), ('ID_AGRAVO', 'C', 4), ('DT_NOTIFIC', 'C', 8), ('SEM_NOT', 'C', 6),
    ('NU_ANO', 'C', 4), ('SG_UF_NOT', 'C', 2), ('ID_MUNICIP', 'C', 6), ('ID_MN_RESI', 'C', 6),
    ('DT_SIN_PRI', 'C', 8), ('NU_IDADE_N', 'C', 4), ('CS_SEXO', 'C', 1), ('CS_GESTANT', 'C', 1),
    ('CS_RACA', 'C', 1), ('CS_ESCOL_N', 'C', 2), ('CLASSI_FIN', 'C', 2), ('CRITERIO', 'C', 1),
    ('EVOLUCAO', 'C', 1), ('HOSPITALIZ', 'C', 1), ('DT_ENCERRA', 'C', 8), ('ENCHIMENTO', 'C', 60),
]


def semana(data: datetime.date) -> str:
    ano, sem, _ = data.isocalendar()
    return f'{ano}{sem:02d}'


def gerar(caminho: Path, ano: int, n: int, municipios: list[str]) -> None:
    hl = 32 + 32 * len(CAMPOS) + 1
    rl = 1 + sum(l for _, _, l in CAMPOS)
    hoje = datetime.date.today()
    rnd = random.Random(ano)
    pesos = [1 / (i + 1) for i in range(len(municipios))]  # poucos municípios grandes, muitos pequenos
    with caminho.open('wb') as saida:
        saida.write(struct.pack('<BBBBIHH20x', 3, hoje.year - 1900, hoje.month, hoje.day, n, hl, rl))
        for nome, tipo, tamanho in CAMPOS:
            saida.write(struct.pack('<11sc4xBB14x', nome.encode(), tipo.encode(), tamanho, 0))
        saida.write(b'\r')
        inicio = datetime.date(ano, 1, 1)
        bloco = bytearray()
        escolhidos = rnd.choices(municipios, weights=pesos, k=n)
        for i in range(n):
            # Mais casos no primeiro semestre, como a dengue.
            dia = int(abs(rnd.gauss(100, 70))) % 365
            data = inicio + datetime.timedelta(days=dia)
            mun = escolhidos[i]
            valores = [
                '2', 'A90 ', data.strftime('%Y%m%d'), semana(data), str(ano), mun[:2], mun, mun,
                (data - datetime.timedelta(days=rnd.randint(0, 7))).strftime('%Y%m%d'),
                f'40{rnd.randint(0, 89):02d}', rnd.choice('MF'), rnd.choice('569'), rnd.choice('12345'),
                f'{rnd.randint(1, 10):02d}', rnd.choice(['10', '11', '12', '5 ', '8 ']), rnd.choice('123'),
                rnd.choice('1129'), rnd.choice('12'), data.strftime('%Y%m%d'), 'x' * 60,
            ]
            bloco += b' ' + b''.join(v.ljust(l)[:l].encode() for v, (_, _, l) in zip(valores, CAMPOS))
            if len(bloco) > 8_000_000:
                saida.write(bloco)
                bloco.clear()
        saida.write(bloco)
        saida.write(b'\x1a')


def main() -> None:
    pasta, n, ano0, anos = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    pasta.mkdir(parents=True, exist_ok=True)
    geografia = json.loads((Path(__file__).parent.parent / 'apps/web/public/geografia.json').read_text())
    municipios = sorted(geografia['municipios'])
    random.Random(1).shuffle(municipios)
    for ano in range(ano0, ano0 + anos):
        caminho = pasta / f'DENGBR{ano % 100:02d}.dbf'
        gerar(caminho, ano, n, municipios)
        print(caminho, caminho.stat().st_size)


if __name__ == '__main__':
    main()

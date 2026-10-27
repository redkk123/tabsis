#!/usr/bin/env python3
"""TabSis Local — o TabSis no computador: baixa do DATASUS para uma pasta sua e
recebe os arquivos que o navegador já tinha guardado.

Roda em Windows, Linux e macOS só com a biblioteca padrão do Python (Tkinter
para a janela). Duas formas de usar:

1. Sozinho: escolha sistema, tipo, anos e UF e clique em "Procurar e baixar".
   Os arquivos vêm direto do FTP oficial (ftp.datasus.gov.br), que continua no
   ar quando o portal do DATASUS cai.
2. Com o TabSis (tabweb.me): "Abrir o TabSis conectado" abre o site já ligado
   a este app. Lá, "Salvar no computador" baixa para esta pasta, e "Enviar os
   guardados para o computador" copia o que o navegador tinha em cache.

O servidor escuta só em 127.0.0.1, fala o mesmo protocolo do "downloader local"
do site (service "tabwin-bridge", protocolo 1) e exige um token que muda a cada
vez que o app abre. Endereços aceitos: só o FTP público e os pacotes preparados
do DATASUS — nada mais (ver ORIGENS).
"""
from __future__ import annotations

import argparse
import ftplib
import queue
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import uuid
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSAO = '1.0.2'
PROTOCOLO = 1
PORTA_PADRAO = 8787
SITE = 'https://tabweb.me/'
FTP_HOST = 'ftp.datasus.gov.br'
FTP_RAIZ = '/dissemin/publicos/'
MAXIMO_BYTES = 1024 ** 3  # 1 GB, o mesmo teto do site

# Páginas que podem falar com o app (CORS). Nada de '*'.
ORIGENS_WEB = (
    'https://tabsis.me',
    'https://www.tabsis.me',
    'https://tabweb.me',
    'https://www.tabweb.me',
    'https://redkk123.github.io',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
)

# O que o app aceita baixar a pedido da página.
ORIGENS = (
    ('ftp', FTP_HOST, FTP_RAIZ, None, 'árvore pública de microdados do DATASUS (FTP)'),
    ('https', FTP_HOST, FTP_RAIZ, None, 'árvore pública de microdados do DATASUS (HTTPS)'),
    ('https', 'datasus.saude.gov.br', '/wp-content/zipupload/', '/arquivo.zip', 'pacote preparado pelo catálogo oficial'),
)

# O que o site pode listar e abrir da pasta: dados e auxiliares do TabWin.
EXTENSOES_DE_DADOS = {'.dbc', '.dbf', '.parquet', '.csv', '.tsv', '.def', '.cnv', '.map', '.zip'}

NOMES_RESERVADOS = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}


# ---------------------------------------------------------------- política ---

class Recusado(ValueError):
    """Pedido fora do que o app aceita."""


def validar_url(bruta: str) -> urllib.parse.SplitResult:
    try:
        url = urllib.parse.urlsplit(str(bruta).strip())
    except ValueError as erro:
        raise Recusado('o endereço não é uma URL válida') from erro
    if url.username or url.password:
        raise Recusado('a URL não pode carregar usuário ou senha')
    if url.port not in (None, 21 if url.scheme == 'ftp' else 443):
        raise Recusado('porta não permitida')
    caminho = urllib.parse.unquote(url.path)
    if '..' in caminho.split('/') or '\\' in caminho or url.query or url.fragment:
        raise Recusado('o caminho não corresponde ao que essa origem publica')
    for esquema, host, prefixo, sufixo, _ in ORIGENS:
        if url.scheme == esquema and (url.hostname or '').lower() == host and caminho.startswith(prefixo) \
                and (sufixo is None or caminho.endswith(sufixo)) and len(caminho) > len(prefixo):
            return url
    raise Recusado('o endereço não está na lista do que o app pode baixar')


def nome_seguro(bruto: str) -> str:
    """Nome de arquivo que não escapa da pasta, em nenhum sistema."""
    nome = unicodedata.normalize('NFKC', urllib.parse.unquote(str(bruto))).split('/')[-1].split('\\')[-1]
    nome = re.sub(r'[^A-Za-z0-9._ -]', '_', nome).strip(' .')
    nome = re.sub(r'\.{2,}', '.', nome).lstrip('._-')[:120]
    if not nome or nome.split('.')[0].upper() in NOMES_RESERVADOS:
        raise Recusado('nome de arquivo inválido')
    return nome


def nome_do_url(url: urllib.parse.SplitResult) -> str:
    partes = [p for p in urllib.parse.unquote(url.path).split('/') if p]
    # Todo pacote preparado se chama arquivo.zip: o identificador do pedido vai junto.
    return nome_seguro(f'{partes[-2]}-{partes[-1]}' if partes[-1] == 'arquivo.zip' and len(partes) > 1 else partes[-1])


# ------------------------------------------------------------ onde mora cada arquivo no FTP

UFS = ('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO').split()

SISTEMAS = {
    'SINAN': {'nome': 'SINAN · agravos de notificação', 'tipos': {
        'DENG': 'Dengue', 'CHIK': 'Chikungunya', 'ZIKA': 'Zika', 'LTAN': 'Leishmaniose tegumentar', 'LEIV': 'Leishmaniose visceral',
        'HANS': 'Hanseníase', 'TUBE': 'Tuberculose', 'SIFG': 'Sífilis em gestante', 'SIFC': 'Sífilis congênita', 'VIOL': 'Violência',
        'MALA': 'Malária', 'CHAG': 'Doença de Chagas', 'LEPT': 'Leptospirose', 'ANIM': 'Animais peçonhentos', 'IEXO': 'Intoxicação exógena',
        'HEPA': 'Hepatites virais', 'MENI': 'Meningite', 'ESQU': 'Esquistossomose', 'COQU': 'Coqueluche', 'FMAC': 'Febre maculosa',
    }, 'mensal': False, 'por_uf': False},
    'SIM': {'nome': 'SIM · mortalidade', 'tipos': {'DO': 'Óbitos (por UF)', 'DOFET': 'Óbitos fetais', 'DOINF': 'Óbitos infantis', 'DOMAT': 'Óbitos maternos', 'DOEXT': 'Causas externas'},
            'mensal': False, 'por_uf': True},
    'SINASC': {'nome': 'SINASC · nascidos vivos', 'tipos': {'DN': 'Nascidos vivos (por UF)'}, 'mensal': False, 'por_uf': True},
    'SIH': {'nome': 'SIH · internações', 'tipos': {'RD': 'AIH reduzida', 'SP': 'Serviços profissionais', 'RJ': 'AIH rejeitada', 'ER': 'AIH rejeitada com erro'},
            'mensal': True, 'por_uf': True},
    'SIA': {'nome': 'SIA · ambulatorial', 'tipos': {'PA': 'Produção ambulatorial', 'AM': 'APAC de medicamentos', 'AQ': 'APAC de quimioterapia', 'AR': 'APAC de radioterapia', 'PS': 'RAAS psicossocial'},
            'mensal': True, 'por_uf': True},
    'CNES': {'nome': 'CNES · estabelecimentos', 'tipos': {'ST': 'Estabelecimentos', 'LT': 'Leitos', 'PF': 'Profissionais', 'EQ': 'Equipamentos', 'SR': 'Serviço especializado', 'HB': 'Habilitações'},
             'mensal': True, 'por_uf': True},
}
SINAN_TIPOS_POR_UF = set()  # todos os agravos do SINAN são arquivos nacionais (…BRaa)


def candidatos(sistema: str, tipo: str, ano: int, uf: str = '', mes: int = 0) -> list[tuple[str, str]]:
    """(pasta, nome) onde o arquivo pode estar, em ordem: final antes de preliminar.

    Os nomes seguem o FTP oficial (os mesmos que o TabSis usa); só valem se a
    listagem da pasta mostrar o arquivo — nunca se baixa um nome adivinhado.
    """
    aa, r = f'{ano % 100:02d}', FTP_RAIZ
    if sistema == 'SINAN':
        nome = f'{tipo}BR{aa}.dbc'
        return [(f'{r}SINAN/DADOS/FINAIS/', nome), (f'{r}SINAN/DADOS/PRELIM/', nome)]
    if sistema == 'SIM':
        if tipo == 'DO':
            return [(f'{r}SIM/CID10/DORES/', f'DO{uf}{ano}.dbc'), (f'{r}SIM/PRELIM/DORES/', f'DO{uf}{ano}.dbc')]
        return [(f'{r}SIM/CID10/DOFET/', f'{tipo}{aa}.dbc'), (f'{r}SIM/PRELIM/DOFET/', f'{tipo}{aa}.dbc')]
    if sistema == 'SINASC':
        if ano <= 1995:
            return [(f'{r}SINASC/1994_1995/Dados/DNRES/', f'DNR{uf}{ano}.dbc')]
        return [(f'{r}SINASC/1996_/Dados/DNRES/', f'DN{uf}{ano}.dbc'), (f'{r}SINASC/PRELIM/DNRES/', f'DN{uf}{ano}.dbc')]
    nome = f'{tipo}{uf}{aa}{mes:02d}.dbc'
    if sistema == 'SIH':
        return [(f'{r}SIHSUS/200801_/Dados/' if ano >= 2008 else f'{r}SIHSUS/199201_200712/Dados/', nome)]
    if sistema == 'SIA':
        return [(f'{r}SIASUS/200801_/Dados/' if ano >= 2008 else f'{r}SIASUS/199407_200712/Dados/', nome)]
    if sistema == 'CNES':
        return [(f'{r}CNES/200508_/Dados/{tipo}/', nome)]
    return []


# ------------------------------------------------------------- FTP e HTTPS

def ftp_conectar(timeout: float = 60) -> ftplib.FTP:
    ftp = ftplib.FTP(FTP_HOST, timeout=timeout)
    ftp.login()  # anônimo
    ftp.voidcmd('TYPE I')
    return ftp


_pastas: dict[str, tuple[float, dict[str, str]]] = {}
_pastas_trava = threading.Lock()


def listar_pasta(pasta: str) -> dict[str, str]:
    """Nome em maiúsculas → nome como está no FTP, de uma pasta (guardado por 10 minutos)."""
    with _pastas_trava:
        guardada = _pastas.get(pasta)
        if guardada and time.time() - guardada[0] < 600:
            return guardada[1]
    linhas: list[str] = []
    ftp = ftp_conectar()
    try:
        ftp.retrlines(f'LIST {pasta}', linhas.append)
    finally:
        ftp.close()
    itens = {}
    for linha in linhas:
        iis = re.match(r'^\d{2}-\d{2}-\d{2}\s+\d{1,2}:\d{2}[AP]M\s+(<DIR>|\d+)\s+(.+)$', linha)
        unix = re.match(r'^-[rwxs-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w{3}\s+\d{1,2}\s+[\d:]+\s+(.+)$', linha)
        if iis and iis.group(1) != '<DIR>':
            itens[iis.group(2).strip().upper()] = iis.group(2).strip()
        elif unix:
            itens[unix.group(2).strip().upper()] = unix.group(2).strip()
    with _pastas_trava:
        _pastas[pasta] = (time.time(), itens)
    return itens


@dataclass
class Tarefa:
    url: str
    nome: str
    pasta: Path
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: str = 'pending'  # pending, downloading, done, failed, cancelled
    recebidos: int = 0
    total: int | None = None
    velocidade: int | None = None
    erro: str | None = None
    caminho: str | None = None
    origem: str = 'site'
    iniciada: float = field(default_factory=time.time)
    terminada: float | None = None
    cancelar: threading.Event = field(default_factory=threading.Event)

    def json(self) -> dict:
        return {
            'id': self.id, 'url': self.url, 'filename': self.nome, 'status': self.status,
            'receivedBytes': self.recebidos, 'totalBytes': self.total, 'bytesPerSecond': self.velocidade,
            'attempts': 1, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.iniciada)),
            'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.terminada)) if self.terminada else None,
            'error': self.erro, 'path': self.caminho if self.status == 'done' else None,
        }


class Cancelado(Exception):
    pass


def baixar(tarefa: Tarefa, avisar=lambda tarefa: None) -> None:
    """Baixa para <nome>.part e só renomeia com o arquivo inteiro. Retoma o .part."""
    url = validar_url(tarefa.url)
    tarefa.pasta.mkdir(parents=True, exist_ok=True)
    final = tarefa.pasta / tarefa.nome
    parcial = final.with_name(final.name + '.part')
    tarefa.status = 'downloading'
    inicio = time.time()
    ja = parcial.stat().st_size if parcial.exists() else 0

    def escrever(pedaco: bytes, saida) -> None:
        if tarefa.cancelar.is_set():
            raise Cancelado()
        saida.write(pedaco)
        tarefa.recebidos += len(pedaco)
        if tarefa.recebidos > MAXIMO_BYTES:
            raise IOError('arquivo maior que 1 GB')
        decorrido = max(time.time() - inicio, 0.001)
        tarefa.velocidade = int((tarefa.recebidos - ja) / decorrido)
        avisar(tarefa)

    try:
        if url.scheme == 'ftp':
            ftp = ftp_conectar()
            try:
                caminho = urllib.parse.unquote(url.path)
                tarefa.total = ftp.size(caminho)
                if tarefa.total and ja > tarefa.total:
                    parcial.unlink(); ja = 0
                tarefa.recebidos = ja
                with open(parcial, 'ab') as saida:
                    ftp.retrbinary(f'RETR {caminho}', lambda b: escrever(b, saida), blocksize=256 * 1024, rest=ja or None)
            finally:
                try:
                    ftp.close()
                except Exception:  # noqa: BLE001 - fechar não pode esconder o erro do download
                    pass
        else:
            pedido = urllib.request.Request(urllib.parse.urlunsplit(url), headers={'User-Agent': f'TabSis-Local/{VERSAO}', **({'Range': f'bytes={ja}-'} if ja else {})})
            with urllib.request.urlopen(pedido, timeout=60) as resposta:
                if ja and resposta.status != 206:
                    ja = 0
                    parcial.unlink(missing_ok=True)
                tamanho = resposta.headers.get('Content-Length')
                tarefa.total = (int(tamanho) + ja) if tamanho else None
                tarefa.recebidos = ja
                with open(parcial, 'ab') as saida:
                    while pedaco := resposta.read(256 * 1024):
                        escrever(pedaco, saida)
        if tarefa.total is not None and tarefa.recebidos != tarefa.total:
            raise IOError(f'veio {tarefa.recebidos} de {tarefa.total} bytes; tente de novo para continuar')
        os.replace(parcial, final)
        tarefa.caminho = str(final)
        tarefa.status = 'done'
    except Cancelado:
        tarefa.status = 'cancelled'
    except Exception as erro:  # noqa: BLE001 - o motivo vai para a tela, não derruba o app
        tarefa.status = 'failed'
        tarefa.erro = str(erro) or erro.__class__.__name__
    finally:
        tarefa.terminada = time.time()
        avisar(tarefa)


# ------------------------------------------------------------------ o app

class Local:
    """Estado do app: pasta, token, tarefas. A janela e o servidor usam isto."""

    def __init__(self, pasta: Path):
        self.pasta = pasta
        self.token = secrets.token_urlsafe(24)
        self.tarefas: dict[str, Tarefa] = {}
        self.ouvintes = []
        self.trava = threading.Lock()
        # Fila: um download de cada vez, em segundo plano. Vários ao mesmo
        # tempo dividem a banda e o DATASUS derruba conexões em paralelo; um
        # por vez termina cada arquivo mais cedo e continua mesmo se a página
        # que pediu for fechada.
        self.fila: queue.Queue[Tarefa] = queue.Queue()
        threading.Thread(target=self._trabalhar, daemon=True).start()

    def _trabalhar(self) -> None:
        while True:
            tarefa = self.fila.get()
            if tarefa.cancelar.is_set():
                tarefa.status = 'cancelled'
                tarefa.terminada = time.time()
                self.avisar(tarefa)
                continue
            baixar(tarefa, self.avisar)

    def na_fila(self) -> int:
        return sum(1 for t in self.tarefas.values() if t.status == 'pending')

    def avisar(self, evento) -> None:
        for ouvinte in list(self.ouvintes):
            try:
                ouvinte(evento)
            except Exception:  # noqa: BLE001
                pass

    def iniciar_download(self, url_bruta: str, origem: str = 'site') -> Tarefa:
        url = validar_url(url_bruta)
        tarefa = Tarefa(url=urllib.parse.urlunsplit(url), nome=nome_do_url(url), pasta=self.pasta, origem=origem)
        with self.trava:
            # O mesmo arquivo já na fila ou baixando: devolve o pedido que existe.
            for existente in self.tarefas.values():
                if existente.url == tarefa.url and existente.status in ('pending', 'downloading'):
                    return existente
            self.tarefas[tarefa.id] = tarefa
        self.fila.put(tarefa)
        self.avisar(tarefa)
        return tarefa

    def receber_guardado(self, nome: str, corpo, tamanho: int) -> dict:
        """Um arquivo que estava em cache no navegador, mandado pelo site."""
        if tamanho <= 0 or tamanho > MAXIMO_BYTES:
            raise Recusado('tamanho inválido')
        destino_pasta = self.pasta / 'Guardados do navegador'
        destino_pasta.mkdir(parents=True, exist_ok=True)
        destino = destino_pasta / nome_seguro(nome)
        parcial = destino.with_name(destino.name + '.part')
        resumo = hashlib.sha256()
        faltam = tamanho
        with open(parcial, 'wb') as saida:
            while faltam:
                pedaco = corpo.read(min(faltam, 256 * 1024))
                if not pedaco:
                    break
                resumo.update(pedaco)
                saida.write(pedaco)
                faltam -= len(pedaco)
        if faltam:
            parcial.unlink(missing_ok=True)
            raise Recusado('o arquivo chegou incompleto')
        os.replace(parcial, destino)
        info = {'path': str(destino), 'bytes': tamanho, 'sha256': resumo.hexdigest()}
        self.avisar({'guardado': info})
        return info

    def arquivos(self) -> list[dict]:
        """Os arquivos de dados da pasta (e da subpasta dos guardados), mais novos primeiro."""
        itens = []
        for pasta in (self.pasta, self.pasta / 'Guardados do navegador'):
            if not pasta.is_dir():
                continue
            for arquivo in pasta.iterdir():
                if arquivo.is_file() and arquivo.suffix.lower() in EXTENSOES_DE_DADOS:
                    info = arquivo.stat()
                    itens.append({'nome': arquivo.name, 'pasta': 'guardados' if pasta != self.pasta else 'principal',
                                  'bytes': info.st_size, 'modificado': int(info.st_mtime), 'caminho': str(arquivo)})
        return sorted(itens, key=lambda item: -item['modificado'])

    def arquivo(self, nome: str, pasta: str) -> Path:
        """Um arquivo da pasta pelo nome; nunca fora dela."""
        base = self.pasta / 'Guardados do navegador' if pasta == 'guardados' else self.pasta
        caminho = base / nome_seguro(nome)
        if caminho.suffix.lower() not in EXTENSOES_DE_DADOS or not caminho.is_file() \
                or caminho.resolve().parent != base.resolve():
            raise Recusado('arquivo não encontrado na pasta do TabSis Local')
        return caminho

    def procurar_e_baixar(self, sistema: str, tipo: str, anos: list[int], ufs: list[str], meses: list[int], relatar) -> int:
        """Confere no FTP cada combinação e baixa o que existir. Devolve quantos começaram."""
        config = SISTEMAS[sistema]
        combinacoes = [(a, u, m) for a in anos for u in (ufs if config['por_uf'] else ['']) for m in (meses if config['mensal'] else [0])]
        iniciados = 0
        for ano, uf, mes in combinacoes:
            achou = False
            for pasta, nome in candidatos(sistema, tipo, ano, uf, mes):
                try:
                    lista = listar_pasta(pasta)
                except Exception as erro:  # noqa: BLE001
                    relatar(f'Não deu para ler {pasta}: {erro}')
                    continue
                if nome.upper() in lista:
                    self.iniciar_download(f'ftp://{FTP_HOST}{pasta}{lista[nome.upper()]}', origem='app')
                    iniciados += 1
                    achou = True
                    break
            if not achou:
                rotulo = ' '.join(x for x in (tipo, uf, str(ano), f'{mes:02d}' if mes else '') if x)
                relatar(f'{rotulo}: não publicado no FTP')
        return iniciados


def criar_servidor(local: Local, porta: int) -> ThreadingHTTPServer:
    class Pedido(BaseHTTPRequestHandler):
        server_version = f'TabSisLocal/{VERSAO}'

        def log_message(self, *args):  # silêncio: nada de dados no terminal
            pass

        def _origem(self) -> str | None:
            origem = self.headers.get('Origin')
            return origem if origem in ORIGENS_WEB else None

        def _cabecalhos(self, codigo: int, tipo='application/json; charset=utf-8', tamanho: int | None = None) -> None:
            self.send_response(codigo)
            origem = self._origem()
            if origem:
                self.send_header('Access-Control-Allow-Origin', origem)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Content-Type', tipo)
            self.send_header('Cache-Control', 'no-store')
            if tamanho is not None:
                self.send_header('Content-Length', str(tamanho))
            self.end_headers()

        def _json(self, codigo: int, dado) -> None:
            corpo = json.dumps(dado, ensure_ascii=False).encode('utf-8')
            self._cabecalhos(codigo, tamanho=len(corpo))
            self.wfile.write(corpo)

        def _barrado(self) -> bool:
            # Origem desconhecida não recebe nem o /health: saber que o app existe já é informação.
            if self.headers.get('Origin') and not self._origem():
                self._json(403, {'error': 'origem não autorizada'})
                return True
            return False

        def _autorizado(self) -> bool:
            recebido = self.headers.get('Authorization', '')
            esperado = f'Bearer {local.token}'
            if hmac.compare_digest(recebido.encode(), esperado.encode()):
                return True
            self._json(401, {'error': 'token ausente ou inválido'})
            return False

        def do_OPTIONS(self):  # noqa: N802
            self._cabecalhos(204 if self._origem() else 403, tamanho=0)

        def do_GET(self):  # noqa: N802
            if self._barrado():
                return
            caminho = urllib.parse.urlsplit(self.path).path
            if caminho == '/health':
                self._json(200, {
                    'service': 'tabwin-bridge', 'protocol': PROTOCOLO, 'app': 'tabsis-local', 'version': VERSAO,
                    'features': ['ftp', 'guardados', 'arquivos'], 'directory': str(local.pasta),
                    'allowlist': [f'{e}://{h}{p}…{s or ""}  ({d})' for e, h, p, s, d in ORIGENS],
                })
                return
            if not self._autorizado():
                return
            if caminho == '/arquivos':
                self._json(200, {'directory': str(local.pasta), 'files': local.arquivos()})
                return
            if caminho == '/arquivo':
                consulta = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                try:
                    arquivo = local.arquivo(consulta.get('nome', [''])[0], consulta.get('pasta', ['principal'])[0])
                except Recusado as erro:
                    self._json(404, {'error': str(erro)})
                    return
                tamanho = arquivo.stat().st_size
                self._cabecalhos(200, 'application/octet-stream', tamanho)
                with open(arquivo, 'rb') as entrada:
                    while pedaco := entrada.read(256 * 1024):
                        self.wfile.write(pedaco)
                return
            achado = re.fullmatch(r'/downloads/([0-9a-f-]{36})', caminho)
            tarefa = local.tarefas.get(achado.group(1)) if achado else None
            if tarefa:
                self._json(200, tarefa.json())
            else:
                self._json(404, {'error': 'rota ou download desconhecido'})

        def do_POST(self):  # noqa: N802
            if self._barrado() or not self._autorizado():
                return
            partes = urllib.parse.urlsplit(self.path)
            tamanho = int(self.headers.get('Content-Length') or 0)
            try:
                if partes.path == '/downloads':
                    if tamanho > 8192:
                        raise Recusado('pedido grande demais')
                    corpo = json.loads(self.rfile.read(tamanho) or b'{}')
                    self._json(202, local.iniciar_download(str(corpo.get('url', ''))).json())
                    return
                if partes.path == '/guardados':
                    nome = urllib.parse.parse_qs(partes.query).get('nome', [''])[0]
                    self._json(201, local.receber_guardado(nome, self.rfile, tamanho))
                    return
                achado = re.fullmatch(r'/downloads/([0-9a-f-]{36})/cancel', partes.path)
                tarefa = local.tarefas.get(achado.group(1)) if achado else None
                if tarefa:
                    tarefa.cancelar.set()
                    self._json(200, tarefa.json())
                    return
                self._json(404, {'error': 'rota desconhecida'})
            except Recusado as erro:
                self._json(400, {'error': str(erro), 'code': 'recusado'})
            except (ValueError, json.JSONDecodeError) as erro:
                self._json(400, {'error': str(erro), 'code': 'bad-request'})

    # 127.0.0.1 explícito: nunca 0.0.0.0.
    return ThreadingHTTPServer(('127.0.0.1', porta), Pedido)


# ---------------------------------------------------------------- configuração

def pasta_de_config() -> Path:
    if sys.platform.startswith('win'):
        base = Path(os.environ.get('APPDATA', Path.home()))
    elif sys.platform == 'darwin':
        base = Path.home() / 'Library' / 'Application Support'
    else:
        base = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config'))
    return base / 'TabSis Local'


def ler_config() -> dict:
    try:
        return json.loads((pasta_de_config() / 'config.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def gravar_config(config: dict) -> None:
    try:
        pasta_de_config().mkdir(parents=True, exist_ok=True)
        (pasta_de_config() / 'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=1), encoding='utf-8')
    except OSError:
        pass


def abrir_pasta(caminho: Path) -> None:
    caminho.mkdir(parents=True, exist_ok=True)
    if sys.platform.startswith('win'):
        os.startfile(caminho)  # type: ignore[attr-defined]  # noqa: S606
    elif sys.platform == 'darwin':
        os.spawnlp(os.P_NOWAIT, 'open', 'open', str(caminho))
    else:
        os.spawnlp(os.P_NOWAIT, 'xdg-open', 'xdg-open', str(caminho))


def tamanho_legivel(n: int | None) -> str:
    if n is None:
        return '—'
    for unidade in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or unidade == 'GB':
            return f'{n:.0f} {unidade}' if unidade == 'B' else f'{n:.1f} {unidade}'.replace('.', ',')
        n /= 1024
    return str(n)


# -------------------------------------------------------------------- janela

def janela(local: Local, porta: int) -> None:
    import queue
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    raiz = tk.Tk()
    raiz.title(f'TabSis Local {VERSAO}')
    raiz.geometry('860x700')
    raiz.minsize(640, 480)
    eventos: queue.Queue = queue.Queue()
    local.ouvintes.append(eventos.put)

    estilo = ttk.Style()
    if 'clam' in estilo.theme_names():
        estilo.theme_use('clam')
    estilo.configure('Topo.TFrame', background='#0e3f6c')
    estilo.configure('Topo.TLabel', background='#0e3f6c', foreground='#ffffff', font=('TkDefaultFont', 15, 'bold'))
    estilo.configure('TopoSub.TLabel', background='#0e3f6c', foreground='#c9dcef')

    topo = ttk.Frame(raiz, style='Topo.TFrame', padding=(16, 12))
    topo.pack(fill='x')
    ttk.Label(topo, text='TabSis Local', style='Topo.TLabel').pack(anchor='w')
    ttk.Label(topo, text=f'Escutando em 127.0.0.1:{porta} — só este computador. Os dados ficam na sua pasta.', style='TopoSub.TLabel').pack(anchor='w')

    corpo = ttk.Frame(raiz, padding=16)
    corpo.pack(fill='both', expand=True)

    # Conexão com o site
    conexao = ttk.LabelFrame(corpo, text='Ligar ao TabSis (tabweb.me)', padding=10)
    conexao.pack(fill='x')
    ttk.Label(conexao, text='Token desta sessão (muda a cada vez que o app abre):').grid(row=0, column=0, sticky='w')
    campo_token = ttk.Entry(conexao, width=44)
    campo_token.insert(0, local.token)
    campo_token.configure(state='readonly')
    campo_token.grid(row=1, column=0, sticky='we', pady=4)

    def copiar_token():
        raiz.clipboard_clear()
        raiz.clipboard_append(local.token)
        estado.set('Token copiado. No TabSis: Buscar no DATASUS → Downloader local → colar → Verificar.')

    ttk.Button(conexao, text='Copiar token', command=copiar_token).grid(row=1, column=1, padx=6)
    # O token vai no fragmento (#), que o navegador não manda a servidor nenhum.
    ttk.Button(conexao, text='Abrir o TabSis conectado', command=lambda: webbrowser.open(f'{SITE}#local={local.token}:{porta}')).grid(row=1, column=2)
    conexao.columnconfigure(0, weight=1)

    # Pasta
    linha_pasta = ttk.LabelFrame(corpo, text='Pasta dos arquivos', padding=10)
    linha_pasta.pack(fill='x', pady=(10, 0))
    rotulo_pasta = ttk.Label(linha_pasta, text=str(local.pasta), wraplength=520)
    rotulo_pasta.pack(side='left', fill='x', expand=True)

    def trocar_pasta():
        escolhida = filedialog.askdirectory(initialdir=str(local.pasta), title='Onde guardar os arquivos do DATASUS')
        if escolhida:
            local.pasta = Path(escolhida)
            rotulo_pasta.configure(text=escolhida)
            gravar_config({**ler_config(), 'pasta': escolhida})

    ttk.Button(linha_pasta, text='Trocar…', command=trocar_pasta).pack(side='left', padx=6)
    ttk.Button(linha_pasta, text='Abrir pasta', command=lambda: abrir_pasta(local.pasta)).pack(side='left')

    # Baixar sozinho
    busca = ttk.LabelFrame(corpo, text='Baixar do DATASUS (FTP oficial)', padding=10)
    busca.pack(fill='x', pady=(10, 0))
    var_sistema, var_tipo = tk.StringVar(value='SINAN'), tk.StringVar()
    ano_atual = time.localtime().tm_year
    var_de, var_ate = tk.StringVar(value=str(ano_atual - 2)), tk.StringVar(value=str(ano_atual - 1))
    var_uf, var_mes_de, var_mes_ate = tk.StringVar(value='DF'), tk.StringVar(value='1'), tk.StringVar(value='12')

    ttk.Label(busca, text='Sistema').grid(row=0, column=0, sticky='w')
    caixa_sistema = ttk.Combobox(busca, textvariable=var_sistema, values=list(SISTEMAS), state='readonly', width=10)
    caixa_sistema.grid(row=1, column=0, sticky='w', padx=(0, 8))
    ttk.Label(busca, text='Tipo').grid(row=0, column=1, sticky='w')
    caixa_tipo = ttk.Combobox(busca, textvariable=var_tipo, state='readonly', width=34)
    caixa_tipo.grid(row=1, column=1, sticky='w', padx=(0, 8))
    linha2 = ttk.Frame(busca)
    linha2.grid(row=2, column=0, columnspan=2, sticky='w', pady=(8, 0))
    ttk.Label(linha2, text='Anos').grid(row=0, column=0, sticky='w')
    anos_quadro = ttk.Frame(linha2)
    anos_quadro.grid(row=1, column=0, sticky='w', padx=(0, 12))
    ttk.Spinbox(anos_quadro, from_=1979, to=ano_atual, textvariable=var_de, width=6).pack(side='left')
    ttk.Label(anos_quadro, text=' a ').pack(side='left')
    ttk.Spinbox(anos_quadro, from_=1979, to=ano_atual, textvariable=var_ate, width=6).pack(side='left')
    ttk.Label(linha2, text='UF').grid(row=0, column=1, sticky='w')
    caixa_uf = ttk.Combobox(linha2, textvariable=var_uf, values=['todas'] + UFS, state='readonly', width=7)
    caixa_uf.grid(row=1, column=1, sticky='w', padx=(0, 12))
    ttk.Label(linha2, text='Meses').grid(row=0, column=2, sticky='w')
    meses_quadro = ttk.Frame(linha2)
    meses_quadro.grid(row=1, column=2, sticky='w', padx=(0, 12))
    ttk.Spinbox(meses_quadro, from_=1, to=12, textvariable=var_mes_de, width=3).pack(side='left')
    ttk.Label(meses_quadro, text=' a ').pack(side='left')
    ttk.Spinbox(meses_quadro, from_=1, to=12, textvariable=var_mes_ate, width=3).pack(side='left')

    def ajustar_sistema(*_):
        config = SISTEMAS[var_sistema.get()]
        opcoes = [f'{codigo} · {nome}' for codigo, nome in config['tipos'].items()]
        caixa_tipo.configure(values=opcoes)
        var_tipo.set(opcoes[0])
        caixa_uf.configure(state='readonly' if config['por_uf'] else 'disabled')
        for filho in meses_quadro.winfo_children():
            filho.configure(state='normal' if config['mensal'] else 'disabled')

    caixa_sistema.bind('<<ComboboxSelected>>', ajustar_sistema)
    ajustar_sistema()

    def procurar():
        try:
            de, ate = int(var_de.get()), int(var_ate.get())
            mes_de, mes_ate = int(var_mes_de.get()), int(var_mes_ate.get())
        except ValueError:
            messagebox.showerror('TabSis Local', 'Anos e meses precisam ser números.')
            return
        if ate < de or mes_ate < mes_de or ate - de > 50:
            messagebox.showerror('TabSis Local', 'Confira o intervalo de anos (até 50) e de meses.')
            return
        sistema = var_sistema.get()
        tipo = var_tipo.get().split(' · ')[0]
        ufs = UFS if var_uf.get() == 'todas' else [var_uf.get()]
        botao.configure(state='disabled')
        estado.set('Conferindo no FTP do DATASUS…')

        def trabalho():
            n = local.procurar_e_baixar(sistema, tipo, list(range(de, ate + 1)), ufs, list(range(mes_de, mes_ate + 1)), lambda texto: eventos.put({'log': texto}))
            eventos.put({'log': f'{n} arquivo(s) começaram a baixar.' if n else 'Nada encontrado com essas escolhas.', 'fim_busca': True})

        threading.Thread(target=trabalho, daemon=True).start()

    botao = ttk.Button(linha2, text='Procurar e baixar', command=procurar)
    botao.grid(row=1, column=3, sticky='w')

    # Situação no rodapé (antes da lista, para a lista não a empurrar para fora).
    estado = tk.StringVar(value='Pronto. Escolha o que baixar, ou abra o TabSis conectado: tudo o que ele baixar fica guardado nesta pasta.')
    ttk.Label(corpo, textvariable=estado, wraplength=800).pack(side='bottom', fill='x', pady=(8, 0))

    # Lista
    lista = ttk.Treeview(corpo, columns=('arquivo', 'estado', 'tamanho', 'origem'), show='headings', height=8)
    for coluna, titulo, largura in (('arquivo', 'Arquivo', 260), ('estado', 'Situação', 230), ('tamanho', 'Tamanho', 110), ('origem', 'Pedido por', 110)):
        lista.heading(coluna, text=titulo)
        lista.column(coluna, width=largura, anchor='w')
    lista.pack(fill='both', expand=True, pady=(10, 0))


    rotulos = {'pending': 'na fila (um de cada vez)', 'downloading': 'baixando', 'done': 'pronto', 'failed': 'falhou', 'cancelled': 'cancelado'}

    def processar():
        try:
            while True:
                evento = eventos.get_nowait()
                if isinstance(evento, Tarefa):
                    if evento.status == 'downloading':
                        texto = f'baixando {evento.recebidos * 100 // evento.total}%' if evento.total else 'baixando'
                    else:
                        texto = rotulos.get(evento.status, evento.status) + (f': {evento.erro}' if evento.erro else '')
                    valores = (evento.nome, texto, tamanho_legivel(evento.total or evento.recebidos), 'este app' if evento.origem == 'app' else 'TabSis')
                    if lista.exists(evento.id):
                        lista.item(evento.id, values=valores)
                    else:
                        lista.insert('', 0, iid=evento.id, values=valores)
                    if evento.status == 'done':
                        estado.set(f'{evento.nome} salvo em {evento.caminho}')
                elif isinstance(evento, dict) and 'guardado' in evento:
                    info = evento['guardado']
                    lista.insert('', 0, values=(Path(info['path']).name, 'recebido do navegador', tamanho_legivel(info['bytes']), 'TabSis (cache)'))
                    estado.set(f'Recebido do navegador: {info["path"]}')
                elif isinstance(evento, dict) and 'log' in evento:
                    estado.set(evento['log'])
                    if evento.get('fim_busca'):
                        botao.configure(state='normal')
        except queue.Empty:
            pass
        raiz.after(250, processar)

    processar()
    raiz.mainloop()


# ---------------------------------------------------------------------- main

def main(argv: list[str] | None = None) -> int:
    argumentos = argparse.ArgumentParser(description='TabSis Local: baixa do DATASUS e recebe os guardados do TabSis.')
    argumentos.add_argument('--porta', type=int, default=PORTA_PADRAO)
    argumentos.add_argument('--pasta', type=Path)
    argumentos.add_argument('--sem-janela', action='store_true', help='só o servidor, com o token no terminal')
    argumentos.add_argument('--versao', action='version', version=f'TabSis Local {VERSAO}')
    opcoes = argumentos.parse_args(argv)

    pasta = opcoes.pasta or Path(ler_config().get('pasta') or Path.home() / 'Downloads' / 'TabSis')
    local = Local(pasta)
    try:
        servidor = criar_servidor(local, opcoes.porta)
    except OSError as erro:
        print(f'A porta {opcoes.porta} está ocupada (o TabSis Local já está aberto?): {erro}', file=sys.stderr)
        return 1
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    porta = servidor.server_address[1]  # --porta 0 escolhe uma livre

    if opcoes.sem_janela:
        print(f'TabSis Local {VERSAO}')
        print(f'  escutando em  http://127.0.0.1:{porta} (só este computador)')
        print(f'  salvando em   {pasta}')
        print(f'  token         {local.token}')
        print(f'  conectar      {SITE}#local={local.token}:{porta}')
        print('  Ctrl+C encerra.', flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
    else:
        janela(local, porta)
    servidor.shutdown()
    return 0


if __name__ == '__main__':
    sys.exit(main())

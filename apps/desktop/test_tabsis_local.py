"""Testes do TabSis Local, sem rede: o FTP e o HTTPS do DATASUS ficam simulados."""
import hashlib
import io
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

import tabsis_local as tl


class Politica(unittest.TestCase):
    def test_aceita_so_o_datasus(self):
        for ok in ('ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/LTANBR24.dbc',
                   'https://ftp.datasus.gov.br/dissemin/publicos/SIM/CID10/DORES/DODF2023.dbc',
                   'https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip'):
            tl.validar_url(ok)
        for ruim in ('http://ftp.datasus.gov.br/dissemin/publicos/x.dbc', 'https://evil.com/dissemin/publicos/x',
                     'ftp://user:senha@ftp.datasus.gov.br/dissemin/publicos/x', 'ftp://ftp.datasus.gov.br/etc/passwd',
                     'ftp://ftp.datasus.gov.br/dissemin/publicos/../x', 'https://datasus.saude.gov.br/wp-content/zipupload/a/outro.zip',
                     'ftp://ftp.datasus.gov.br:2121/dissemin/publicos/x', 'ftp://ftp.datasus.gov.br/dissemin/publicos/'):
            with self.assertRaises(tl.Recusado, msg=ruim):
                tl.validar_url(ruim)

    def test_nome_nao_escapa_da_pasta(self):
        self.assertEqual(tl.nome_seguro('../../etc/passwd'), 'passwd')
        self.assertEqual(tl.nome_seguro('..%2F..%2Fevil.exe'), 'evil.exe')
        self.assertEqual(tl.nome_seguro('C:\\Windows\\x.dbc'), 'x.dbc')
        with self.assertRaises(tl.Recusado):
            tl.nome_seguro('CON.dbc')
        self.assertEqual(tl.nome_do_url(tl.validar_url('https://datasus.saude.gov.br/wp-content/zipupload/Arq_9/arquivo.zip')), 'Arq_9-arquivo.zip')

    def test_nomes_do_ftp(self):
        self.assertEqual(tl.candidatos('SINAN', 'LTAN', 2024)[0], ('/dissemin/publicos/SINAN/DADOS/FINAIS/', 'LTANBR24.dbc'))
        self.assertEqual(tl.candidatos('SIM', 'DO', 2023, 'DF')[0], ('/dissemin/publicos/SIM/CID10/DORES/', 'DODF2023.dbc'))
        self.assertEqual(tl.candidatos('SINASC', 'DN', 2022, 'AC')[0][1], 'DNAC2022.dbc')
        self.assertEqual(tl.candidatos('SIH', 'RD', 2024, 'AC', 1), [('/dissemin/publicos/SIHSUS/200801_/Dados/', 'RDAC2401.dbc')])
        self.assertEqual(tl.candidatos('CNES', 'ST', 2025, 'AC', 1), [('/dissemin/publicos/CNES/200508_/Dados/ST/', 'STAC2501.dbc')])


class Servidor(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.local = tl.Local(Path(self.tmp.name))
        self.srv = tl.criar_servidor(self.local, 0)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.srv.server_address[1]}'

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def pedir(self, caminho, metodo='GET', corpo=None, origem='https://tabweb.me', token=True, tipo='application/json'):
        cab = {'Content-Type': tipo}
        if origem:
            cab['Origin'] = origem
        if token:
            cab['Authorization'] = f'Bearer {self.local.token}'
        pedido = urllib.request.Request(self.base + caminho, data=corpo, method=metodo, headers=cab)
        try:
            with urllib.request.urlopen(pedido) as r:
                return r.status, dict(r.headers), json.loads(r.read() or b'null')
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), json.loads(e.read() or b'null')

    def test_health_cors_e_token(self):
        codigo, cab, corpo = self.pedir('/health', token=False)
        self.assertEqual((codigo, corpo['service'], corpo['protocol']), (200, 'tabwin-bridge', 1))
        self.assertEqual(cab['Access-Control-Allow-Origin'], 'https://tabweb.me')
        self.assertIn('guardados', corpo['features'])
        self.assertEqual(self.pedir('/health', origem='https://evil.example', token=False)[0], 403)
        self.assertEqual(self.pedir('/downloads', 'POST', b'{}', token=False)[0], 401)
        codigo, _, corpo = self.pedir('/downloads', 'POST', json.dumps({'url': 'https://evil.com/x'}).encode())
        self.assertEqual((codigo, corpo['code']), (400, 'recusado'))

    def test_recebe_guardado_do_navegador(self):
        dados = b'DBC' * 1000
        codigo, _, corpo = self.pedir('/guardados?nome=..%2F..%2FLTANBR24.dbc', 'POST', dados, tipo='application/octet-stream')
        self.assertEqual(codigo, 201)
        destino = Path(self.tmp.name) / 'Guardados do navegador' / 'LTANBR24.dbc'
        self.assertEqual(Path(corpo['path']), destino)
        self.assertEqual(destino.read_bytes(), dados)
        self.assertEqual(corpo['sha256'], hashlib.sha256(dados).hexdigest())


class Arquivos(Servidor):
    def test_lista_e_entrega_so_o_que_esta_na_pasta(self):
        (Path(self.tmp.name) / 'DNAC2022.dbc').write_bytes(b'abc')
        (Path(self.tmp.name) / 'segredo.txt').write_text('não')
        codigo, _, corpo = self.pedir('/arquivos')
        self.assertEqual([f['nome'] for f in corpo['files']], ['DNAC2022.dbc'])
        pedido = urllib.request.Request(self.base + '/arquivo?nome=DNAC2022.dbc', headers={'Authorization': f'Bearer {self.local.token}', 'Origin': 'https://tabweb.me'})
        with urllib.request.urlopen(pedido) as r:
            self.assertEqual(r.read(), b'abc')
        for nome in ('segredo.txt', '../../etc/passwd', 'naoexiste.dbc'):
            self.assertEqual(self.pedir(f'/arquivo?nome={urllib.request.quote(nome)}')[0], 404, nome)
        self.assertEqual(self.pedir('/arquivos', token=False)[0], 401)


class Download(unittest.TestCase):
    def test_https_completo_e_tamanho_errado(self):
        with tempfile.TemporaryDirectory() as tmp:
            class Resposta(io.BytesIO):
                status = 200
                def __init__(self, dados, anunciado):
                    super().__init__(dados)
                    self.headers = {'Content-Length': str(anunciado)}
                def __enter__(self): return self
                def __exit__(self, *a): return False
            url = 'https://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/LTANBR24.dbc'
            with mock.patch.object(tl.urllib.request, 'urlopen', lambda *a, **k: Resposta(b'x' * 5000, 5000)):
                t = tl.Tarefa(url=url, nome='LTANBR24.dbc', pasta=Path(tmp))
                tl.baixar(t)
            self.assertEqual((t.status, Path(t.caminho).read_bytes()), ('done', b'x' * 5000))
            with mock.patch.object(tl.urllib.request, 'urlopen', lambda *a, **k: Resposta(b'x' * 10, 50)):
                t = tl.Tarefa(url=url, nome='OUTRO.dbc', pasta=Path(tmp))
                tl.baixar(t)
            self.assertEqual(t.status, 'failed')
            self.assertFalse((Path(tmp) / 'OUTRO.dbc').exists())
            self.assertTrue((Path(tmp) / 'OUTRO.dbc.part').exists())  # fica para continuar depois


if __name__ == '__main__':
    unittest.main()

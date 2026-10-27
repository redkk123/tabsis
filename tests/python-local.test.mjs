import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  arquivosRodarNoComputador,
  cadernoIpynb,
  scriptPython,
  ZIP_ATTRS_EXECUTAVEL,
} from '../dist/packages/export/src/python-local.js';

const celulas = [
  { code: 'import pandas as pd\ndados = pd.DataFrame({"UF": ["AC"]})', mostrar: 'dados.head()' },
  { code: '# só comentário' },
];

test('no script, o que o caderno mostraria vira print', () => {
  const script = scriptPython(celulas);
  assert.match(script, /print\(dados\.head\(\)\)/);
  assert.ok(script.endsWith('# só comentário\n'));
});

test('o .ipynb é nbformat 4 com uma célula de código por célula do caderno', () => {
  const nb = JSON.parse(cadernoIpynb(celulas, 'TabSis · teste'));
  assert.equal(nb.nbformat, 4);
  assert.equal(nb.cells.length, 2);
  assert.equal(nb.cells[0].source.join(''), `${celulas[0].code}\ndados.head()`);
  assert.deepEqual(nb.cells[0].outputs, []);
});

test('o pacote tem um iniciador por sistema, e só os Unix pedem bit de execução', () => {
  const arquivos = arquivosRodarNoComputador({ celulas, titulo: 'TabSis · teste', csvNome: 'X-microdados.csv', registros: '3' });
  assert.deepEqual(Object.keys(arquivos).sort(), [
    'LEIA-ME.txt', 'Rodar no Mac.command', 'Rodar no Windows.bat', 'analise.ipynb',
    'analise.py', 'preparar_e_rodar.py', 'requirements.txt', 'rodar-linux.sh',
  ]);
  assert.equal(arquivos['Rodar no Mac.command'].executavel, true);
  assert.equal(arquivos['rodar-linux.sh'].executavel, true);
  assert.ok(!arquivos['Rodar no Windows.bat'].executavel);
  assert.equal(arquivos['requirements.txt'].texto, 'pandas>=2\n');
  // ZIP: modo Unix nos 16 bits altos dos atributos externos.
  assert.equal(ZIP_ATTRS_EXECUTAVEL / 0x10000, 0o100755);
});

test('o .bat usa CRLF e só ASCII: o cmd lê na página de código do console', () => {
  const bat = arquivosRodarNoComputador({ celulas, titulo: 't', csvNome: 'x.csv', registros: '1' })['Rodar no Windows.bat'].texto;
  assert.ok(bat.split('\n').slice(0, -1).every((linha) => linha.endsWith('\r')));
  assert.match(bat, /^[\x00-\x7f]*$/);
  assert.match(bat, /python\.org\/downloads/);
});

test('os scripts gerados são Python e shell válidos', { skip: spawnSync('python3', ['--version']).status !== 0 }, () => {
  const arquivos = arquivosRodarNoComputador({ celulas, titulo: 't', csvNome: 'x.csv', registros: '1' });
  for (const nome of ['preparar_e_rodar.py', 'analise.py']) {
    const r = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: arquivos[nome].texto });
    assert.equal(r.status, 0, `${nome}: ${r.stderr}`);
  }
  for (const nome of ['Rodar no Mac.command', 'rodar-linux.sh']) {
    const r = spawnSync('bash', ['-n'], { input: arquivos[nome].texto });
    assert.equal(r.status, 0, `${nome}: ${r.stderr}`);
  }
});

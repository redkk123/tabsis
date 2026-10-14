import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCnv, parseCnv } from '../dist/packages/formats/src/index.js';

function row(sequence, label, codes, subtotal = '') {
  const subtotalField = subtotal.padStart(3).slice(-3);
  const sequenceField = String(sequence).padStart(4);
  const descriptionField = label.padEnd(50).slice(0, 50);
  return `${subtotalField}${sequenceField}  ${descriptionField} ${codes}`;
}

test('parses legacy fixed-column CNV and preserves comments', () => {
  const text = ['; before header', '3 2', row(3, 'Ignorado', '00-99'), row(1, 'Janeiro', '01'), row(2, 'Fevereiro', '02')].join('\n');
  const cnv = parseCnv(text);
  assert.equal(cnv.categoryCount, 3);
  assert.equal(cnv.codeLength, 2);
  assert.equal(cnv.mode, 'short');
  assert.equal(cnv.precedence, 'last-match-wins');
  assert.equal(cnv.categories.length, 3);
  assert.deepEqual(cnv.comments, ['before header']);
});

test('short-code overlap follows documented later-row precedence', () => {
  const cnv = parseCnv(['3 2', row(3, 'Ignorado', '00-99'), row(1, 'Janeiro', '01'), row(2, 'Fevereiro', '02')].join('\n'));
  assert.deepEqual(classifyCnv(cnv, '01'), { sequence: 1, label: 'Janeiro' });
  assert.deepEqual(classifyCnv(cnv, '02'), { sequence: 2, label: 'Fevereiro' });
  assert.deepEqual(classifyCnv(cnv, '88'), { sequence: 3, label: 'Ignorado' });
});

// Antes: "primeira ocorrência vale", tirado do Help. Medido no TabWin 4.15
// (RE-003, LITDUP e LONGDUP): no literal também vale a última.
test('literal mode: the last line wins, as TabWin 4.15 does (not the Help)', () => {
  const cnv = parseCnv(['2 2 L', row(1, 'Primeiro', 'AA'), row(2, 'Segundo', 'AA')].join('\n'));
  assert.equal(cnv.precedence, 'last-match-wins');
  assert.deepEqual(classifyCnv(cnv, 'AA'), { sequence: 2, label: 'Segundo' });
});

test('numeric range mode uses inclusive upper bounds', () => {
  const cnv = parseCnv(['3 14 Faixas', row(1, 'Baixo', '99.99'), row(2, 'Medio', '499.99'), row(3, 'Alto', '999999.99')].join('\n'));
  assert.deepEqual(classifyCnv(cnv, 99.99), { sequence: 1, label: 'Baixo' });
  assert.deepEqual(classifyCnv(cnv, 100), { sequence: 2, label: 'Medio' });
  assert.deepEqual(classifyCnv(cnv, 800), { sequence: 3, label: 'Alto' });
});

test('subtotal and # metadata are parsed from columns 1-3', () => {
  const cnv = parseCnv(['3 2', row(1, 'Publico', '10,20'), row(2, 'Federal', '10', '1'), row(3, 'Nota', '99', '#')].join('\n'));
  assert.equal(cnv.categories[1]?.subtotalTarget, 1);
  assert.equal(cnv.categories[2]?.excludeFromTotal, true);
});

test('decodes the widened new-format N columns, including its 4-column subtotal indicator', () => {
  const nrow = (parent, sequence, label, codes) =>
    `${parent.padStart(5)}${String(sequence).padStart(4)}  ${label.padEnd(100)} ${codes}`;
  const cnv = parseCnv([
    'N 3 4',
    nrow('', 1, 'Grupo', '1000-1999,'),
    // Real files right-align the indicator in a 5-wide field, but TabWin reads
    // only 4 columns — proven by controlled experiment, see R10_6. "10" here
    // lands as "   10", read as "   1", so the parent is sequence 1, not 10.
    nrow('10', 2, '102-3 Estadual', '1023'),
    nrow('10', 3, '114-7 Fundação', '1147'),
  ].join('\n'));
  assert.equal(cnv.newFormat, true);
  assert.equal(cnv.mode, 'short');
  assert.equal(cnv.codeLength, 4);
  assert.deepEqual(cnv.categories.map(({ sequence, label, subtotalTarget }) => ({ sequence, label, subtotalTarget })), [
    { sequence: 1, label: 'Grupo', subtotalTarget: undefined },
    { sequence: 2, label: '102-3 Estadual', subtotalTarget: 1 },
    { sequence: 3, label: '114-7 Fundação', subtotalTarget: 1 },
  ]);
  assert.deepEqual(cnv.rules[0]?.ranges, [{ from: '1000', to: '1999' }]);
  assert.deepEqual(cnv.rules[1]?.exactCodes, ['1023']);
  // Reading and executing the layout are proven; writing it back out is not.
  assert.match(cnv.warnings.at(-1), /writing this layout back out is still refused/);
});

// RE-003: o código curto (até 4 posições) vira um número, medido no TabWin
// 4.15 real com DBFs e CNVs de teste (pesos 1, 2, 4… no campo G, para cada
// linha da tabela revelar exatamente quais registros caíram nela).
test('CNV curta: letra na 1ª posição vira número (A = 1 … Z = 26), como o TabWin real', () => {
  const digito = parseCnv(['10 3', ...Array.from({ length: 10 }, (_, d) => row(d + 1, `Digito ${d}01`, `${d}01`))].join('\n'));
  const label = (cnv, code) => classifyCnv(cnv, code)?.label;
  assert.equal(label(digito, '@01'), 'Digito 001');
  assert.equal(label(digito, 'A01'), 'Digito 101');
  assert.equal(label(digito, 'a01'), 'Digito 101');
  assert.equal(label(digito, 'B01'), 'Digito 201');
  assert.equal(label(digito, 'I01'), 'Digito 901');
  for (const fora of ['J01', 'j01', 'K01', 'S01', 'T01', 'Z01']) assert.equal(label(digito, fora), undefined, fora);
  // O lado do CNV segue a mesma regra: "A01" escrito no CNV pega o dado "101".
  const letra = parseCnv(['10 3', ...'ABCDEFGHIJ'.split('').map((l, i) => row(i + 1, `Letra ${l}01`, `${l}01`))].join('\n'));
  assert.equal(label(letra, '101'), 'Letra A01');
  assert.equal(label(letra, '901'), 'Letra I01');
  assert.equal(label(letra, '001'), undefined);
  assert.equal(label(letra, 'J01'), 'Letra J01');
});

test('CNV curta: fora da 1ª posição, o que não é dígito vale 0; branco é o código 000', () => {
  const cnv = parseCnv(['3 3', row(1, 'Zero', '000'), row(2, 'Um', '001'), row(3, 'Cem', '100')].join('\n'));
  const label = (code) => classifyCnv(cnv, code)?.label;
  assert.equal(label(null), 'Zero');
  assert.equal(label(''), 'Zero');
  assert.equal(label('0'), 'Zero');
  assert.equal(label('00'), 'Zero');
  assert.equal(label('  1'), 'Um');
  assert.equal(label('A'), 'Cem');
  assert.equal(label('1A'), 'Cem');
  // Número (campo N) continua pela comparação de texto: sem a largura do campo
  // não dá para saber como ele estava alinhado.
  assert.equal(classifyCnv(cnv, 1), undefined);
  // E a CNV literal (L ou código longo) não muda: compara o texto.
  const literal = parseCnv(['2 2 L', row(1, 'Acre', 'AC'), row(2, 'Alagoas', 'AL')].join('\n'));
  assert.equal(classifyCnv(literal, 'AC')?.label, 'Acre');
  assert.equal(classifyCnv(literal, 'AL')?.label, 'Alagoas');
});

test('CNV curta: quem vem depois ganha também quando letra e dígito dão o mesmo código', () => {
  const cnv = parseCnv(['3 3', row(1, 'Letra A01', 'A01'), row(2, 'Faixa 100-199', '100-199'), row(3, 'Faixa 900-999', '900-999')].join('\n'));
  assert.equal(classifyCnv(cnv, 'A01')?.label, 'Faixa 100-199');
  assert.equal(classifyCnv(cnv, 'J99'), undefined);
  assert.equal(classifyCnv(cnv, '950')?.label, 'Faixa 900-999');
  // CID de 3 caracteres numa CNV de 4: "A15" casa "A15" e a faixa A00-A099 pega A05.
  const cid = parseCnv(['2 4', row(1, 'Tuberculose', 'A15'), row(2, 'Intestinais', 'A00-A099')].join('\n'));
  assert.equal(classifyCnv(cid, 'A15')?.label, 'Tuberculose');
  assert.equal(classifyCnv(cid, 'A05')?.label, 'Intestinais');
  assert.equal(classifyCnv(cid, 'A090')?.label, 'Intestinais');
});

test('"----" das linhas-título não é código: não pega o CID M000 (RE-003, Sensíveis AB)', () => {
  const cnv = parseCnv(['2 4', row(1, '19. Pré-natal e parto', '----'), row(2, '19.1 ITU na gravidez', 'O23 -O239', '1')].join('\n'));
  assert.equal(classifyCnv(cnv, 'M000'), undefined);
  assert.equal(classifyCnv(cnv, 'O230')?.sequence, 2);
});

// RE-003, SIM e SINASC oficiais contra o TabWin 4.15 (verify-sim-sinasc 16/16).
test('código "em branco" (espaços antes da vírgula) vale como código, e ganha do 00-99', () => {
  const meses = parseCnv(['3 2', row(3, 'Ign', '00-99'), row(1, 'Jan', '01'), row(2, 'branco', '  ,')].join('\n'));
  assert.equal(classifyCnv(meses, null)?.label, 'branco');
  assert.equal(classifyCnv(meses, '01')?.label, 'Jan');
  assert.equal(classifyCnv(meses, '77')?.label, 'Ign');
  // Linha-título com espaço sobrando no fim, sem vírgula, não vira código.
  const titulo = parseCnv(['2 2', row(1, 'Grupo', '    '), row(2, 'Jan', '01')].join('\n'), { strict: false });
  assert.equal(classifyCnv(titulo, null), undefined);
});

test('rótulo mantém o recuo do começo (hierarquia do CID10_BR), só apara o fim', () => {
  const cnv = parseCnv(['2 4', row(1, '001-031 Infecciosas', 'A000-B999'), row(2, '  001 Intestinais', 'A000-A099', '1')].join('\n'));
  assert.equal(cnv.categories[1].label, '  001 Intestinais');
});

test('subtotal que não é número: a categoria fica sem subtotal, com aviso, e o arquivo abre', () => {
  const text = ['N 2   4 L', '     0001  E00 Iodo', 'E249,0002  E24 Cushing                                                                                          E24'].join('\n');
  const cnv = parseCnv(text, { strict: false });
  assert.equal(cnv.categories.find((c) => c.sequence === 2).subtotalTarget, undefined);
  assert.match(cnv.warnings.join('\n'), /não é número/);
});

// RE-003, testes T5–T7 no TabWin 4.15: N(2) com 0..20 (número alinhado à direita: " 7", "10").
test('CNV literal: faixa e código comparados com os espaços, como o TabWin (T6)', () => {
  const numero = (v) => String(v).padStart(2);
  const pega = (codes) => {
    const cnv = parseCnv(['1 2 L', row(1, 'Faixa', codes)].join('\n'));
    return Array.from({ length: 21 }, (_, v) => v).filter((v) => classifyCnv(cnv, numero(v)));
  };
  const de = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  assert.deepEqual(pega(' 7-48'), de(7, 20));
  assert.deepEqual(pega('07-48'), de(10, 20));
  assert.deepEqual(pega('7 -48'), []);
  assert.deepEqual(pega(' 1- 5'), de(1, 5));
  assert.deepEqual(pega('01-05'), []);
  assert.deepEqual(pega('1 -5 '), de(10, 20));
  assert.deepEqual(pega(' 7- 9'), de(7, 9));
  assert.deepEqual(pega(' 7-15'), de(7, 15));
});

test('CNV literal: lista que começa com vírgula tem o código em branco; l minúsculo é L (T5)', () => {
  const cnv = parseCnv(['2 2 l', row(1, 'não preenchido', ',00-99'), row(2, 'nenhuma dose', '00, 0,0 ,')].join('\n'));
  assert.equal(cnv.mode, 'literal');
  assert.equal(classifyCnv(cnv, null)?.label, 'não preenchido');
  assert.equal(classifyCnv(cnv, ' 0')?.label, 'nenhuma dose');
  // Pai com os códigos dos filhos (CODOCO.CNV do SIA): os filhos ficam com eles.
  const codoco = parseCnv(['3 2 L', row(1, 'Pai', 'AA,BB'), row(2, 'Filho A', 'AA', '1'), row(3, 'Filho B', 'BB', '1')].join('\n'));
  assert.equal(classifyCnv(codoco, 'AA')?.label, 'Filho A');
  // Código longo repetido: também vale a última linha (LONGDUP).
  const longo = parseCnv(['2 6', row(1, 'Primeira', '120040,120050'), row(2, 'Segunda', '120040')].join('\n'));
  assert.equal(classifyCnv(longo, '120040')?.label, 'Segunda');
  assert.equal(classifyCnv(longo, '120050')?.label, 'Primeira');
});

// RE-003, T7/T8 e nudosePB.cnv do SINAN: a estrutura da CNV literal do TabWin
// (decompilada) explica faixas sobrepostas dependerem da ordem.
test('CNV literal com faixas sobrepostas: igual ao TabWin, inclusive a ordem (T7, T8, nudosePB)', () => {
  const numero = (v) => (v === null ? '  ' : String(v).padStart(2));
  const valores = [null, ...Array.from({ length: 21 }, (_, v) => v)];
  const tabela = (lines, header = '2 2 L') => {
    const cnv = parseCnv([header, ...lines].join('\n'));
    const out = {};
    for (const v of valores) { const label = classifyCnv(cnv, numero(v))?.label ?? 'NC'; (out[label] ??= []).push(v); }
    return out;
  };
  const de = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  // K1: "07-48" antes de " 7-48": só o 7 (exato, ponta da faixa) classifica.
  assert.deepEqual(tabela([row(1, 'A', '07-48'), row(2, 'B', ' 7-48')]).B, [7]);
  assert.equal(tabela([row(1, 'A', '07-48'), row(2, 'B', ' 7-48')]).A, undefined);
  // K2: ordem inversa, tudo classifica.
  const k2 = tabela([row(1, 'A', ' 7-48'), row(2, 'B', '07-48')]);
  assert.deepEqual(k2.A, [7, 8, 9]);
  assert.deepEqual(k2.B, de(10, 20));
  // K4: três faixas na mesma linha.
  assert.deepEqual(tabela([row(1, 'Tres', '07-48,7 -48, 7-48')], '1 2 L').Tres, [7, ...de(10, 20)]);
  // M1: exato dentro de faixa já existente herda a faixa; o resto da faixa continua.
  const m1 = tabela([row(1, 'A', ' 1-20'), row(2, 'C', ' 5')]);
  assert.deepEqual(m1.A, [...de(1, 4), ...de(6, 20)]);
  assert.deepEqual(m1.C, [5]);
  // M2: exato antes da faixa quebra a faixa: só as pontas.
  const m2 = tabela([row(1, 'C', ' 5'), row(2, 'A', ' 1-20')]);
  assert.deepEqual(m2.A, [1, 20]);
  assert.deepEqual(m2.C, [5]);
  // nudosePB.cnv (SINAN), como veio: 1..5, 6, só o 7, e 8..20 sem classificação.
  const pb = tabela([row(1, 'não preenchido/Ign', ',00-99'), row(2, 'nenhuma dose', '00, 0,0 ,'),
    row(3, 'menor que 6', '01-05,1 -5 , 1- 5,'), row(4, '6 doses', '06, 6,6 ,'), row(5, 'maior que 6', '07-48,7 -48, 7-48')], '5 2 l');
  assert.deepEqual(pb['não preenchido/Ign'], [null]);
  assert.deepEqual(pb['nenhuma dose'], [0]);
  assert.deepEqual(pb['menor que 6'], de(1, 5));
  assert.deepEqual(pb['6 doses'], [6]);
  assert.deepEqual(pb['maior que 6'], [7]);
  assert.deepEqual(pb.NC, de(8, 20));
});

test('CNV literal salva de volta mantém a ordem dos códigos na linha', async () => {
  const { serializeCnv } = await import('../dist/packages/formats/src/index.js');
  const cnv = parseCnv(['1 2 L', row(1, 'Tres', '07-48,7 -48, 7-48,AB')].join('\n'));
  assert.match(serializeCnv(cnv), /07-48,7 -48, 7-48,AB/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCp850, detectDbfTextEncoding, transcodeDbfCp850ToWindows1252 } from '../dist/packages/formats/src/index.js';

function dbfCom(corpo) {
  const header = new Uint8Array(33); header[8] = 33; header[9] = 0; header[32] = 0x0d;
  const out = new Uint8Array(header.length + corpo.length); out.set(header); out.set(corpo, header.length); return out;
}

test('CP850 decodifica os acentos do português', () => {
  // "Climério", "Brasília", "SOLICITAÇÃO" como estão em HUF_MEC.dbf e MOTERRO.dbf.
  assert.equal(decodeCp850(Uint8Array.from([0x43, 0x6c, 0x69, 0x6d, 0x82, 0x72, 0x69, 0x6f])), 'Climério');
  assert.equal(decodeCp850(Uint8Array.from([0x42, 0x72, 0x61, 0x73, 0xa1, 0x6c, 0x69, 0x61])), 'Brasília');
  assert.equal(decodeCp850(Uint8Array.from([0x80, 0xc7, 0x4f])), 'ÇÃO');
});

test('detecta CP850 e Windows-1252 pelo conteúdo, e regrava em Windows-1252', () => {
  const cp850 = dbfCom(Uint8Array.from([0x20, 0x43, 0x6c, 0x69, 0x6d, 0x82, 0x72, 0x69, 0x6f, 0x20, 0x42, 0x72, 0x61, 0x73, 0xa1, 0x6c, 0x69, 0x61]));
  assert.equal(detectDbfTextEncoding(cp850), 'cp850');
  const convertido = transcodeDbfCp850ToWindows1252(cp850);
  assert.equal(new TextDecoder('windows-1252').decode(convertido.subarray(33)), ' Climério Brasília');
  assert.deepEqual(convertido.subarray(0, 33), cp850.subarray(0, 33));
  const w1252 = dbfCom(new TextEncoder().encode(' ').length ? Uint8Array.from([0x20, 0x43, 0x4f, 0x4d, 0x55, 0x4e, 0x49, 0x43, 0x41, 0xc7, 0xc3, 0x4f]) : []);
  assert.equal(detectDbfTextEncoding(w1252), 'windows-1252');
  assert.equal(detectDbfTextEncoding(dbfCom(Uint8Array.from([0x41, 0x42]))), 'windows-1252');
});

# Arquivos gravados pelo próprio TabWin 4.15 ("Arquivo → Salvar como")

- `sexo-valor.tab`, `.prn`, `.sql`: Linha Sexo, Incrementos Freqüência e Valor
  Total, RDAC2401.dbc, TESTE.DEF (2026-10-14, Wine 10). O `.sql` foi salvo com o
  nome `fmt7`, daí `CREATE TABLE fmt7`.
- `to3-coluna.tab`: captura TO3 (Complexidade × Caráter atendimento), para a
  coluna "Total" que o TabWin acrescenta quando há Colunas.

`tests/tabwin-formats.test.mjs` grava as mesmas tabelas pelo TabSis e compara
byte a byte.

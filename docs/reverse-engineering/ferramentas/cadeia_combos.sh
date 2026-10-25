#!/bin/sh
# Roda a varredura de combinações em cada base, uma depois da outra.
cd "$(dirname "$0")"
while pgrep -f "^python3 varrer_combos.py combos-rd" >/dev/null; do sleep 10; done
rodar() { # pasta combos dados prefixo
  ./abrir_tabwin.sh "$1" >/dev/null 2>&1
  rm -f "$4.jsonl"
  TABWIN_PASTA="$1" python3 varrer_combos.py "$2" "$3" "$4" > "c_$4.log" 2>&1
  echo "FIM $4 $(grep -c ' ok ' c_$4.log) ok $(grep -c FALHOU c_$4.log) falhas"
}
rodar SIM combos-sim.json DOAC2024.dbc CSIM
rodar NASC combos-nasc.json DNAC2022.dbc CNASC
rodar SINAN combos-sinan.json HANSBR23.dbc CSINAN
rodar SIA combos-sia.json 'DADOS\PAAC2501.dbc' CSIA
rodar CNES combos-cnes.json 'ESTABEL\STAC2501.dbc' CCNES
echo CADEIA-TERMINOU

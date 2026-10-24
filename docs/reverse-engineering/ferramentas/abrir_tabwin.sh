#!/bin/sh
# Reabre o TabWin (Wine, Xvfb :77) com outra pasta de dados no TabWin.ini.
# Uso: abrir_tabwin.sh <pasta, ex.: SIM>
S=/tmp/claude-1000/-home-red-learner/7f241cfa-4ff7-41a6-ac0b-0c3ec3d33823/scratchpad
C=$HOME/.local/share/wine-tabwin/drive_c/TabWin
$HOME/.local/opt/wine-root/usr/lib/x86_64-linux-gnu/wine/wineserver -k 2>/dev/null
timeout 4 tail -f /dev/null
printf '[Diretorios]\r\nMapas=C:\\TabWin\\MAPAS\\\r\nSalva=C:\\TabWin\\saida\\\r\nDados=C:\\TabWin\\%s\\\r\nRX=C:\\TabWin\\\r\n[Opcoes]\r\nDBF_CP850=1\r\nFontFixa=Courier\r\nMostraLog=1\r\n' "$1" > $C/TabWin.ini
cd $C && (DISPLAY=:77 $HOME/.local/bin/wine explorer /desktop=tab,1270x890 'C:\TabWin\TabWin415.exe' > $S/tabwin.log 2>&1 &)
timeout 25 tail -f /dev/null
$S/venv/bin/python -I $S/shot.py :77 $S/abriu-$1.png

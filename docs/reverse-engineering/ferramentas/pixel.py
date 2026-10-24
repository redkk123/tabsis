import sys
from Xlib import display, X
d = display.Display(':77'); r = d.screen().root
x, y = int(sys.argv[1]), int(sys.argv[2])
raw = r.get_image(x, y, 1, 1, X.ZPixmap, 0xffffffff).data
print(raw[2], raw[1], raw[0])

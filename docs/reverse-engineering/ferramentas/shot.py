import sys
from Xlib import display, X
from PIL import Image
d=display.Display(sys.argv[1]); r=d.screen().root
g=r.get_geometry(); raw=r.get_image(0,0,g.width,g.height,X.ZPixmap,0xffffffff)
Image.frombytes('RGB',(g.width,g.height),raw.data,'raw','BGRX').save(sys.argv[2]); print('ok',g.width,g.height)

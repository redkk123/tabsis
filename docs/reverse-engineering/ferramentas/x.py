import sys, time
from Xlib import display, X, XK
from Xlib.ext import xtest
d=display.Display(':77')
def click(x,y,b=1,n=1):
    xtest.fake_input(d,X.MotionNotify,x=x,y=y); d.sync(); time.sleep(.1)
    for _ in range(n):
        xtest.fake_input(d,X.ButtonPress,b); d.sync(); xtest.fake_input(d,X.ButtonRelease,b); d.sync(); time.sleep(.08)
def key(name, mods=()):
    ms=[d.keysym_to_keycode(XK.string_to_keysym(m)) for m in mods]
    for m in ms: xtest.fake_input(d,X.KeyPress,m)
    kc=d.keysym_to_keycode(XK.string_to_keysym(name))
    xtest.fake_input(d,X.KeyPress,kc); xtest.fake_input(d,X.KeyRelease,kc)
    for m in ms: xtest.fake_input(d,X.KeyRelease,m)
    d.sync(); time.sleep(.08)
SPECIAL={' ':'space','\\':'backslash','.':'period',':':'colon','_':'underscore','-':'minus','/':'slash','*':'asterisk'}
def typ(s):
    for ch in s:
        if ch.isupper(): key(ch.lower(),('Shift_L',))
        elif ch==':': key('semicolon',('Shift_L',))
        elif ch=='_': key('minus',('Shift_L',))
        elif ch=='*': key('8',('Shift_L',))
        else: key(SPECIAL.get(ch,ch))
for cmd in sys.argv[1:]:
    op,_,arg=cmd.partition(':')
    if op=='c': x,y=map(int,arg.split(',')); click(x,y)
    elif op=='cc':
        x,y=map(int,arg.split(',')); kc=d.keysym_to_keycode(XK.string_to_keysym('Control_L')); xtest.fake_input(d,X.KeyPress,kc); d.sync(); click(x,y); xtest.fake_input(d,X.KeyRelease,kc); d.sync()
    elif op=='dc': x,y=map(int,arg.split(',')); click(x,y,n=2)
    elif op=='k': parts=arg.split('+'); key(parts[-1],tuple(parts[:-1]))
    elif op=='t': typ(arg)
    elif op=='s': time.sleep(float(arg))

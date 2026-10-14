from Xlib import display
d=display.Display(':77'); r=d.screen().root
for w in r.query_tree().children:
    a=w.get_attributes(); 
    if a.map_state!=2: continue
    g=w.get_geometry(); n=w.get_wm_name()
    print(hex(w.id), n, g.x,g.y,g.width,g.height)

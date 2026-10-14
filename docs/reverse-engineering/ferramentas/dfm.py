import pefile, sys, struct, os
pe = pefile.PE(sys.argv[1]); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
    if t.id != 10: continue  # RT_RCDATA
    for e in t.directory.entries:
        name = str(e.name) if e.name else str(e.id)
        for l in e.directory.entries:
            d = pe.get_data(l.data.struct.OffsetToData, l.data.struct.Size)
            if d[:4] == b'TPF0':
                open(f'{out}/{name}.dfm.bin','wb').write(d)
                print(name, len(d))

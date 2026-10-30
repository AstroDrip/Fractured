"""
Validates a GLB without dependencies:  python validate_glb.py <file.glb> [--require-skin] [--max-tris N]

Reports meshes, triangles, materials, skins/joints, animations, and checks that every
skinned vertex has weights summing to ~1 and that joint indices are in range.
Exit code 1 on failure, so it can gate the pipeline.
"""
import json, struct, sys

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def load(path):
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a GLB'
    off, gltf, binc = 12, None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A: gltf = json.loads(chunk)
        elif ctype == 0x004E4942: binc = chunk
        off += 8 + clen
    return gltf, binc

def read(gltf, binc, ai):
    a = gltf['accessors'][ai]
    bv = gltf['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    n = NCOMP[a['type']]
    stride = bv.get('byteStride', size * n)
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = []
    for i in range(a['count']):
        out.append(struct.unpack_from('<' + fmt * n, binc, base + i * stride))
    if a.get('normalized') and fmt in 'BH':
        m = 255.0 if fmt == 'B' else 65535.0
        out = [tuple(x / m for x in v) for v in out]
    return out

def main():
    path = sys.argv[1]
    need_skin = '--require-skin' in sys.argv
    max_tris = int(sys.argv[sys.argv.index('--max-tris') + 1]) if '--max-tris' in sys.argv else None
    gltf, binc = load(path)
    ok = True
    tris = 0
    report = {'file': path, 'meshes': [], 'materials': [m.get('name') for m in gltf.get('materials', [])]}
    for mesh in gltf.get('meshes', []):
        mt = 0
        for p in mesh['primitives']:
            if 'indices' in p: mt += gltf['accessors'][p['indices']]['count'] // 3
            else: mt += gltf['accessors'][p['attributes']['POSITION']]['count'] // 3
            if 'JOINTS_0' in p:
                joints = read(gltf, binc, p['attributes']['JOINTS_0'])
                weights = read(gltf, binc, p['attributes']['WEIGHTS_0'])
                bad = sum(1 for w in weights if abs(sum(w) - 1) > 0.02)
                nj = max(len(s['joints']) for s in gltf.get('skins', [{'joints': [0]}]))
                oob = sum(1 for j in joints for x in j if x >= nj)
                if bad or oob:
                    ok = False
                    print(f'FAIL weights: {bad} vertices not normalised, {oob} joint indices out of range')
        tris += mt
        report['meshes'].append({'name': mesh.get('name'), 'triangles': mt})
    skins = gltf.get('skins', [])
    report['triangles'] = tris
    report['skins'] = [{'joints': [gltf['nodes'][j].get('name') for j in s['joints']]} for s in skins]
    report['animations'] = [a.get('name') for a in gltf.get('animations', [])]
    if need_skin and not skins:
        ok = False; print('FAIL: no skin')
    if max_tris and tris > max_tris:
        ok = False; print(f'FAIL: {tris} triangles > budget {max_tris}')
    print(json.dumps(report, indent=1))
    print('OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()

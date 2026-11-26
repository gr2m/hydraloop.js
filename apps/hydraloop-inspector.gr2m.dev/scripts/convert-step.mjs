// Converts the H600 STEP assembly into a compressed GLB for the web viewer.
//
//   node scripts/convert-step.mjs [input.stp] [output.glb]
//
// Every top-level assembly instance becomes a node; every solid inside it
// becomes a child mesh node. Names, HYD part numbers and the sub-assembly
// path from the STEP product tree are stored in node `extras`.
import fs from "node:fs";
import path from "node:path";
import occtImport from "occt-import-js";
import { Document, NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  weld,
  reorder,
  quantize,
} from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const input = process.argv[2] ?? "3d-models/H600 Standard - Collection 25.stp";
const output = process.argv[3] ?? "public/models/h600.glb";

// Sub-assemblies flattened by OCCT, reconstructed from NEXT_ASSEMBLY_USAGE_OCCURRENCE.
const SUB_ASSEMBLY = {
  HYD1123: "HYD0992 - 2W motor valve DN 32",
  HYD1124: "HYD0992 - 2W motor valve DN 32",
  HYD1125: "HYD0992 - 2W motor valve DN 32",
  HYD1004: "HYD1057 - Glue composition 1",
  HYD1005: "HYD1057 - Glue composition 1",
  HYD0401: "HYD1057 - Glue composition 1",
  HYD1016: "HYD1014 - LED indicator assembly",
  HYD1017: "HYD1014 - LED indicator assembly",
  HYD1019: "HYD1014 - LED indicator assembly",
  HYD0004: "HYD0121 - T1 Assembly",
  HYD0028: "HYD0121 - T1 Assembly",
  HYD0155: "HYD0121 - T1 Assembly",
  HYD1085: "HYD1126 - Aerator ring + rubber cover",
  HYD1107: "HYD1126 - Aerator ring + rubber cover",
  HYD0441: "HYD0967 - Solenoid Module H600 V2.1",
};

// Solids without a product name, labelled by their parent and the STEP product list.
const UNNAMED = {
  HYD1012: { pn: "HYD1019", name: "LED strip" },
  HYD0386: { pn: "HYD0392", name: "Check valve 32mm" },
  HYD0064: { pn: "HYD0064", name: "T2 Tank" },
  HYD1127: { pn: "HYD1127", name: "Outlet dual fitting (PP tee / 90° elbow)" },
};

function parseName(raw) {
  const name = (raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/ M \rM/, " M/M")
    .trim();
  const match = name.match(/^(HYD\d{4})\s*-\s*(.*)$/);
  if (match) return { pn: match[1], name: match[2].trim() };
  return { pn: null, name };
}

const occt = await occtImport();
console.time("read step");
const result = occt.ReadStepFile(new Uint8Array(fs.readFileSync(input)), {
  linearUnit: "millimeter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: 0.0015,
  angularDeflection: 0.4,
});
console.timeEnd("read step");
if (!result.success) throw new Error("Failed to read STEP file");

const doc = new Document();
doc.createBuffer();
const scene = doc.createScene("H600");
const root = doc.createNode("H600 Assembly V2.1").setExtras({ pn: "HYD0950" });
scene.addChild(root);

const materials = new Map();
function material(color) {
  const rgb = color ?? [0.62, 0.62, 0.62];
  const key = rgb.map((c) => c.toFixed(3)).join(",");
  if (!materials.has(key)) {
    materials.set(
      key,
      doc
        .createMaterial(key)
        .setBaseColorFactor([...rgb, 1])
        .setMetallicFactor(0.05)
        .setRoughnessFactor(0.6),
    );
  }
  return materials.get(key);
}

// OCCT returns meshes in world coordinates (Z up, mm). Rotate to Y up and center
// the footprint on the origin with the floor at y = 0.
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const m of result.meshes) {
  const p = m.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
}
console.log("bounds (mm)", min.map(Math.round), max.map(Math.round));
const cx = (min[0] + max[0]) / 2;
const cy = (min[1] + max[1]) / 2;
const z0 = min[2];
const toYUp = (x, y, z) => [x - cx, z - z0, -(y - cy)];

const top = result.root.children[0];
let assemblyIndex = 0;
let solidCount = 0;
for (const child of top.children) {
  const parent = parseName(child.name);
  const id = `a${String(assemblyIndex++).padStart(2, "0")}`;
  const group = doc
    .createNode(child.name)
    .setExtras({ id, pn: parent.pn, name: parent.name });
  root.addChild(group);

  for (const meshIndex of child.meshes) {
    const m = result.meshes[meshIndex];
    let part = parseName(m.name);
    if (!part.name)
      part = UNNAMED[parent.pn] ?? { pn: parent.pn, name: parent.name };
    if (part.name === "Whyte acrylic plate")
      part = { pn: "HYD1010", name: "Logo backplate (white acrylic)" };
    if (part.name === "Draadstift M4")
      part = { pn: null, name: "Draadstift M4" };

    const src = m.attributes.position.array;
    const pos = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3)
      pos.set(toYUp(src[i], src[i + 1], src[i + 2]), i);
    const prim = doc
      .createPrimitive()
      .setAttribute(
        "POSITION",
        doc.createAccessor().setType("VEC3").setArray(pos),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType("SCALAR")
          .setArray(new Uint32Array(m.index.array)),
      )
      .setMaterial(material(m.color));
    if (m.attributes.normal) {
      const n = m.attributes.normal.array;
      const nrm = new Float32Array(n.length);
      for (let i = 0; i < n.length; i += 3)
        nrm.set([n[i], n[i + 2], -n[i + 1]], i);
      prim.setAttribute(
        "NORMAL",
        doc.createAccessor().setType("VEC3").setArray(nrm),
      );
    }
    const sid = `${id}-s${String(solidCount++).padStart(3, "0")}`;
    const mesh = doc.createMesh(part.name).addPrimitive(prim);
    group.addChild(
      doc
        .createNode(part.name)
        .setMesh(mesh)
        .setExtras({
          id: sid,
          pn: part.pn,
          name: part.name,
          sub: SUB_ASSEMBLY[part.pn] ?? null,
        }),
    );
  }
}

await MeshoptEncoder.ready;
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
  method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
});
await doc.transform(
  dedup(),
  weld(),
  prune({ keepExtras: true }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14, quantizeNormal: 10 }),
);
doc
  .getRoot()
  .listExtensionsUsed()
  .find((e) => e instanceof KHRMeshQuantization) ??
  doc.createExtension(KHRMeshQuantization).setRequired(true);

fs.mkdirSync(path.dirname(output), { recursive: true });
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
await io.write(output, doc);
console.log(
  `wrote ${output} (${(fs.statSync(output).size / 1e6).toFixed(1)} MB), ${solidCount} solids`,
);

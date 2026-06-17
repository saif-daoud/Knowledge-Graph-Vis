import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const schemaRoot = process.env.KG_SCHEMA_SOURCE_ROOT
  ? path.resolve(process.env.KG_SCHEMA_SOURCE_ROOT)
  : path.join(repoRoot, "M3", "outputs", "two_kg_schema");
const candidateRoot = path.join(schemaRoot, "book_schema_candidates");
const outputRoot = path.join(appRoot, "public", "data");
const schemaOutputRoot = path.join(outputRoot, "schemas");

const KG_CONFIG = [
  {
    id: "clinical",
    title: "Clinical KG",
    group: "clinical",
    module: "clinical_core",
    finalFile: "clinical_kg_schema.json",
    accent: "#2f80ed",
  },
  {
    id: "islamic",
    title: "Islamic-Cultural KG",
    group: "islamic_cultural",
    module: "islamic_cultural_alignment",
    finalFile: "islamic_cultural_kg_schema.json",
    accent: "#0f9f7a",
  },
];

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function cleanText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeProperty(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^@\{name=([^;]+);\s*description=(.*)\}$/);
    if (match) {
      return {
        name: cleanText(match[1]),
        description: cleanText(match[2]),
      };
    }
    return {
      name: trimmed,
      description: "",
    };
  }

  return {
    name: cleanText(value.name ?? value.property ?? value.field ?? "property"),
    description: cleanText(value.description ?? value.value ?? ""),
  };
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeProperties(properties) {
  if (!Array.isArray(properties)) {
    return [];
  }
  return uniqueBy(
    properties.map(normalizeProperty).filter(Boolean),
    (property) => `${property.name.toLowerCase()}|${property.description.toLowerCase()}`,
  );
}

function normalizeSupport(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(cleanText).filter(Boolean))];
}

function normalizeSchema(schema, meta) {
  const nodeTypes = Array.isArray(schema.node_types) ? schema.node_types : [];
  const edgeTypes = Array.isArray(schema.edge_types) ? schema.edge_types : [];

  const nodes = nodeTypes
    .map((node) => ({
      type: cleanText(node.type),
      description: cleanText(node.description),
      properties: normalizeProperties(node.properties),
      supported_by_books: normalizeSupport(node.supported_by_books),
      supported_by_chapters: normalizeSupport(node.supported_by_chapters),
    }))
    .filter((node) => node.type);

  const edges = edgeTypes
    .map((edge) => ({
      source_type: cleanText(edge.source_type),
      relation: cleanText(edge.relation),
      target_type: cleanText(edge.target_type),
      description: cleanText(edge.description),
      properties: normalizeProperties(edge.properties),
      supported_by_books: normalizeSupport(edge.supported_by_books),
      supported_by_chapters: normalizeSupport(edge.supported_by_chapters),
    }))
    .filter((edge) => edge.source_type && edge.relation && edge.target_type);

  return {
    id: meta.id,
    kg_id: meta.kg_id,
    kg_title: meta.kg_title,
    title: meta.title,
    kind: meta.kind,
    book: cleanText(schema.book ?? meta.book ?? ""),
    book_group: cleanText(schema.book_group ?? meta.book_group ?? ""),
    schema_name: cleanText(schema.schema_name ?? meta.title),
    module: cleanText(schema.module ?? meta.module ?? ""),
    schema_version: cleanText(schema.schema_version ?? ""),
    fusion_method: cleanText(schema.fusion_method ?? ""),
    source_books: normalizeSupport(schema.source_books),
    node_types: nodes,
    edge_types: edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      source_books: normalizeSupport(schema.source_books).length,
    },
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function indexHasViewerData(index) {
  return (index?.kgs ?? []).some((kg) => Array.isArray(kg.items) && kg.items.length > 0);
}

async function readExistingViewerIndex() {
  const existingIndexPath = path.join(outputRoot, "schema-index.json");
  if (!(await pathExists(existingIndexPath))) {
    return null;
  }

  return readJson(existingIndexPath);
}

async function preserveExistingViewerDataIfSourceMissing() {
  if (await pathExists(schemaRoot)) {
    return false;
  }

  const existingIndex = await readExistingViewerIndex();
  if (!existingIndex) {
    return false;
  }

  if (!indexHasViewerData(existingIndex)) {
    return false;
  }

  console.log(`Source schema root not found at ${schemaRoot}; keeping committed viewer data.`);
  return true;
}

async function writeViewerSchema(schema, id) {
  const fileName = `${id}.json`;
  await fs.writeFile(
    path.join(schemaOutputRoot, fileName),
    `${JSON.stringify(schema, null, 2)}\n`,
    "utf8",
  );
  return `data/schemas/${fileName}`;
}

async function loadCandidates() {
  if (!(await pathExists(candidateRoot))) {
    return [];
  }

  const files = (await fs.readdir(candidateRoot))
    .filter((fileName) => fileName.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  const candidates = [];
  for (const fileName of files) {
    const filePath = path.join(candidateRoot, fileName);
    const raw = await readJson(filePath);
    candidates.push({ raw, fileName });
  }
  return candidates;
}

async function main() {
  if (await preserveExistingViewerDataIfSourceMissing()) {
    return;
  }

  await fs.rm(schemaOutputRoot, { recursive: true, force: true });
  await fs.mkdir(schemaOutputRoot, { recursive: true });

  const allCandidates = await loadCandidates();
  const existingIndex = await readExistingViewerIndex();
  const index = {
    generated_at: existingIndex?.generated_at ?? new Date().toISOString(),
    source_root: schemaRoot,
    kgs: [],
  };

  for (const kg of KG_CONFIG) {
    const items = [];
    const finalPath = path.join(schemaRoot, kg.finalFile);

    if (await pathExists(finalPath)) {
      const raw = await readJson(finalPath);
      const id = `${kg.id}__fused`;
      const schema = normalizeSchema(raw, {
        id,
        kg_id: kg.id,
        kg_title: kg.title,
        title: "Fused KG schema",
        kind: "fused",
        module: kg.module,
      });
      const schemaPath = await writeViewerSchema(schema, id);
      items.push({
        id,
        title: "Fused KG schema",
        kind: "fused",
        schemaPath,
        stats: schema.stats,
      });
    }

    const matchingCandidates = allCandidates.filter(
      ({ raw }) => raw.book_group === kg.group || raw.module === kg.module,
    );

    for (const { raw, fileName } of matchingCandidates) {
      const book = cleanText(raw.book ?? fileName.replace(/\.json$/i, ""));
      const id = `${kg.id}__book__${shortHash(book || fileName)}`;
      const schema = normalizeSchema(raw, {
        id,
        kg_id: kg.id,
        kg_title: kg.title,
        title: book,
        kind: "book",
        book,
        book_group: kg.group,
        module: kg.module,
      });
      const schemaPath = await writeViewerSchema(schema, id);
      items.push({
        id,
        title: book,
        kind: "book",
        schemaPath,
        stats: schema.stats,
      });
    }

    index.kgs.push({
      id: kg.id,
      title: kg.title,
      group: kg.group,
      module: kg.module,
      accent: kg.accent,
      items,
      stats: {
        views: items.length,
        books: items.filter((item) => item.kind === "book").length,
      },
    });
  }

  await fs.writeFile(
    path.join(outputRoot, "schema-index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );

  const summary = index.kgs
    .map((kg) => `${kg.title}: ${kg.items.length} views`)
    .join(" | ");
  console.log(`Prepared KG schema viewer data. ${summary}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

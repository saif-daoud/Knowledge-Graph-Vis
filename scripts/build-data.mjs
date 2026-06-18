import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const schemaRoot = process.env.KG_SCHEMA_SOURCE_ROOT
  ? path.resolve(process.env.KG_SCHEMA_SOURCE_ROOT)
  : repoRoot;
const outputRoot = path.join(appRoot, "public", "data");
const schemaOutputRoot = path.join(outputRoot, "schemas");

const KG_CONFIG = [
  {
    id: "clinical_treatment_recommendation",
    title: "Clinical Treatment Recommendation KG",
    module: "clinical_treatment_recommendation",
    finalFile: "clinical_treatment_recommendation_depth_schema_v4_no_taxonomy_edges.json",
    accent: "#2f80ed",
  },
  {
    id: "islamic_cultural_alignment",
    title: "Islamic-Cultural Alignment KG",
    module: "islamic_cultural_alignment",
    finalFile: "islamic_cultural_alignment_depth_schema_v4_no_taxonomy_edges.json",
    accent: "#0f9f7a",
  },
];

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

function normalizeSchema(schema, meta) {
  const nodeTypes = Array.isArray(schema.node_types) ? schema.node_types : [];
  const edgeTypes = Array.isArray(schema.edge_types) ? schema.edge_types : [];

  const nodes = nodeTypes
    .map((node) => ({
      type: cleanText(node.type),
      description: cleanText(node.description),
      properties: normalizeProperties(node.properties),
    }))
    .filter((node) => node.type);

  const edges = edgeTypes
    .map((edge) => ({
      source_type: cleanText(edge.source_type),
      relation: cleanText(edge.relation),
      target_type: cleanText(edge.target_type),
      description: cleanText(edge.description),
      properties: normalizeProperties(edge.properties),
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
    node_types: nodes,
    edge_types: edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
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

async function missingSourceFiles() {
  const missing = [];
  for (const kg of KG_CONFIG) {
    const filePath = path.join(schemaRoot, kg.finalFile);
    if (!(await pathExists(filePath))) {
      missing.push(filePath);
    }
  }
  return missing;
}

async function preserveExistingViewerDataIfSourceMissing() {
  const missing = await missingSourceFiles();
  if (missing.length === 0) {
    return false;
  }

  const existingIndex = await readExistingViewerIndex();
  if (!existingIndex) {
    return false;
  }

  if (!indexHasViewerData(existingIndex)) {
    return false;
  }

  console.log(`Source schema files not found; keeping committed viewer data. Missing: ${missing.join(", ")}`);
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

async function main() {
  if (await preserveExistingViewerDataIfSourceMissing()) {
    return;
  }

  await fs.rm(schemaOutputRoot, { recursive: true, force: true });
  await fs.mkdir(schemaOutputRoot, { recursive: true });

  const existingIndex = await readExistingViewerIndex();
  const index = {
    generated_at: existingIndex?.generated_at ?? new Date().toISOString(),
    source_root: schemaRoot,
    kgs: [],
  };

  for (const kg of KG_CONFIG) {
    const items = [];
    const finalPath = path.join(schemaRoot, kg.finalFile);

    const raw = await readJson(finalPath);
    const id = kg.id;
    const schema = normalizeSchema(raw, {
      id,
      kg_id: kg.id,
      kg_title: kg.title,
      title: kg.title,
      kind: "kg",
      module: kg.module,
    });
    const schemaPath = await writeViewerSchema(schema, id);
    items.push({
      id,
      title: kg.title,
      kind: "kg",
      schemaPath,
      stats: schema.stats,
    });

    index.kgs.push({
      id: kg.id,
      title: kg.title,
      module: kg.module,
      accent: kg.accent,
      items,
      stats: {
        schemas: items.length,
      },
    });
  }

  await fs.writeFile(
    path.join(outputRoot, "schema-index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );

  const summary = index.kgs
    .map((kg) => `${kg.title}: ${kg.items[0]?.stats?.nodes ?? 0} nodes, ${kg.items[0]?.stats?.edges ?? 0} relations`)
    .join(" | ");
  console.log(`Prepared KG schema viewer data. ${summary}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

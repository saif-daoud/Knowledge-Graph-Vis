const CATEGORY_RULES = [
  {
    id: "clinical",
    label: "Clinical",
    color: "#2f6fdf",
    match: /(diagnos|symptom|disorder|risk|outcome|assessment|measure|scale|patient|client|session|therapist)/i,
  },
  {
    id: "treatment",
    label: "Treatment",
    color: "#c76b32",
    match: /(treatment|intervention|technique|protocol|module|homework|plan|exposure|cbt|act|therapy)/i,
  },
  {
    id: "formulation",
    label: "Formulation",
    color: "#7a5ac9",
    match: /(belief|thought|schema|formulation|cognitive|emotion|behavior|maintaining|vulnerability|coping)/i,
  },
  {
    id: "islamic",
    label: "Islamic-cultural",
    color: "#0f8d72",
    match: /(islam|muslim|relig|spiritual|quran|hadith|scriptural|dhikr|prayer|salah|nafs|qalb|ruh|aql|family|community|cultural)/i,
  },
  {
    id: "resource",
    label: "Resource",
    color: "#a47b15",
    match: /(source|resource|scholar|book|evidence|knowledge|reference|authority)/i,
  },
];

export const FALLBACK_CATEGORY = {
  id: "other",
  label: "Other",
  color: "#64748b",
};

export const CATEGORY_STYLES = [...CATEGORY_RULES, FALLBACK_CATEGORY];

function hashString(value) {
  let hash = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function nodeEntityKey(type) {
  return `node:${String(type || "").trim()}`;
}

export function edgeEntityKey(edge, index = 0) {
  return `edge:${index}:${String(edge?.source_type || "").trim()}|${String(edge?.relation || "").trim()}|${String(edge?.target_type || "").trim()}`;
}

export function nodeId(type) {
  return `node-${hashString(type)}-${String(type).replace(/[^a-z0-9]+/gi, "-").slice(0, 36)}`;
}

export function edgeId(edge, index) {
  return `edge-${hashString(`${edge?.source_type}|${edge?.relation}|${edge?.target_type}|${index}`)}`;
}

export function getCategory(node) {
  const haystack = `${node?.type ?? ""} ${node?.description ?? ""}`;
  return CATEGORY_RULES.find((category) => category.match.test(haystack)) ?? FALLBACK_CATEGORY;
}

export function supportList(item) {
  return [
    ...(Array.isArray(item?.supported_by_books) ? item.supported_by_books : []),
    ...(Array.isArray(item?.supported_by_chapters) ? item.supported_by_chapters : []),
  ];
}

export function itemSearchText(item) {
  const propertyText = Array.isArray(item?.properties)
    ? item.properties.map((property) => `${property.name} ${property.description}`).join(" ")
    : "";
  return [
    item?.type,
    item?.relation,
    item?.source_type,
    item?.target_type,
    item?.description,
    propertyText,
    supportList(item).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function changeClasses(entityKey, review = {}) {
  const latest = review.latestByEntity?.get(entityKey);
  const classes = [];
  if (latest?.action === "add") classes.push("change-added");
  if (latest?.action === "edit") classes.push("change-edited");
  if (latest?.action === "delete") classes.push("change-removed");
  if (review.activeEntityKeys?.has(entityKey)) classes.push("active-change");
  return classes;
}

function ensureNode(nodeMap, elements, type, review, options = {}) {
  const entityKey = nodeEntityKey(type);
  if (nodeMap.has(type)) return nodeMap.get(type);

  const placeholder = options.node ?? {
    type,
    description: options.description ?? "Referenced by a relation but not declared as a node type in this schema draft.",
    properties: [],
    supported_by_books: [],
    supported_by_chapters: [],
  };
  const category = getCategory(placeholder);
  const id = nodeId(type);
  nodeMap.set(type, id);
  elements.push({
    group: "nodes",
    data: {
      id,
      entityKey,
      label: type,
      kind: "node",
      category: category.id,
      categoryLabel: category.label,
      color: category.color,
      description: placeholder.description,
      properties: placeholder.properties ?? [],
      supported_by_books: placeholder.supported_by_books ?? [],
      supported_by_chapters: placeholder.supported_by_chapters ?? [],
      placeholder: options.placeholder ?? true,
      ghost: options.ghost ?? false,
      searchText: itemSearchText(placeholder),
    },
    classes: [`category-${category.id}`, options.placeholder ?? true ? "placeholder" : "", options.ghost ? "ghost" : "", ...changeClasses(entityKey, review)]
      .filter(Boolean)
      .join(" "),
  });
  return id;
}

function addGhostForActiveDeletion(schema, nodeMap, elements, review) {
  const change = review.activeChange;
  if (!change || change.action !== "delete") return;

  if (change.entityKind === "node" && change.oldEntity?.type) {
    ensureNode(nodeMap, elements, change.oldEntity.type, review, {
      node: change.oldEntity,
      placeholder: false,
      ghost: true,
    });

    const removedEdges = Array.isArray(change.oldEntity.removedEdges) ? change.oldEntity.removedEdges : [];
    removedEdges.forEach((edge, index) => {
      const source = ensureNode(nodeMap, elements, edge.source_type, review);
      const target = ensureNode(nodeMap, elements, edge.target_type, review);
      const entityKey = edgeEntityKey(edge, index);
      elements.push({
        group: "edges",
        data: {
          id: `ghost-${edgeId(edge, index)}`,
          entityKey,
          source,
          target,
          label: edge.relation,
          relation: edge.relation,
          source_type: edge.source_type,
          target_type: edge.target_type,
          kind: "edge",
          description: edge.description,
          properties: edge.properties ?? [],
          supported_by_books: edge.supported_by_books ?? [],
          supported_by_chapters: edge.supported_by_chapters ?? [],
          ghost: true,
          searchText: itemSearchText(edge),
        },
        classes: "change-removed active-change ghost",
      });
    });
  }

  if (change.entityKind === "edge" && change.oldEntity) {
    const source = ensureNode(nodeMap, elements, change.oldEntity.source_type, review);
    const target = ensureNode(nodeMap, elements, change.oldEntity.target_type, review);
    elements.push({
      group: "edges",
      data: {
        id: `ghost-${edgeId(change.oldEntity, change.edgeIndex ?? 0)}`,
        entityKey: change.entityKey,
        source,
        target,
        label: change.oldEntity.relation,
        relation: change.oldEntity.relation,
        source_type: change.oldEntity.source_type,
        target_type: change.oldEntity.target_type,
        kind: "edge",
        description: change.oldEntity.description,
        properties: change.oldEntity.properties ?? [],
        supported_by_books: change.oldEntity.supported_by_books ?? [],
        supported_by_chapters: change.oldEntity.supported_by_chapters ?? [],
        ghost: true,
        searchText: itemSearchText(change.oldEntity),
      },
      classes: "change-removed active-change ghost",
    });
  }
}

export function buildGraphElements(schema, review = {}) {
  if (!schema) {
    return { elements: [], categories: [], stats: { nodes: 0, edges: 0, properties: 0 } };
  }

  const nodeMap = new Map();
  const elements = [];
  const rawNodes = Array.isArray(schema.node_types) ? schema.node_types : [];
  const rawEdges = Array.isArray(schema.edge_types) ? schema.edge_types : [];

  for (const node of rawNodes) {
    const entityKey = nodeEntityKey(node.type);
    const id = nodeId(node.type);
    const category = getCategory(node);
    nodeMap.set(node.type, id);
    elements.push({
      group: "nodes",
      data: {
        id,
        entityKey,
        label: node.type,
        kind: "node",
        category: category.id,
        categoryLabel: category.label,
        color: category.color,
        description: node.description,
        properties: node.properties ?? [],
        supported_by_books: node.supported_by_books ?? [],
        supported_by_chapters: node.supported_by_chapters ?? [],
        searchText: itemSearchText(node),
      },
      classes: [`category-${category.id}`, ...changeClasses(entityKey, review)].filter(Boolean).join(" "),
    });
  }

  for (const edge of rawEdges) {
    for (const endpoint of [edge.source_type, edge.target_type]) {
      ensureNode(nodeMap, elements, endpoint, review);
    }
  }

  rawEdges.forEach((edge, index) => {
    const entityKey = edgeEntityKey(edge, index);
    elements.push({
      group: "edges",
      data: {
        id: edgeId(edge, index),
        entityKey,
        source: nodeMap.get(edge.source_type),
        target: nodeMap.get(edge.target_type),
        label: edge.relation,
        relation: edge.relation,
        source_type: edge.source_type,
        target_type: edge.target_type,
        kind: "edge",
        schemaIndex: index,
        description: edge.description,
        properties: edge.properties ?? [],
        supported_by_books: edge.supported_by_books ?? [],
        supported_by_chapters: edge.supported_by_chapters ?? [],
        searchText: itemSearchText(edge),
      },
      classes: changeClasses(entityKey, review).join(" "),
    });
  });

  addGhostForActiveDeletion(schema, nodeMap, elements, review);

  const categoryCounts = new Map();
  for (const element of elements) {
    if (element.group === "nodes" && !element.data.ghost) {
      categoryCounts.set(element.data.category, (categoryCounts.get(element.data.category) ?? 0) + 1);
    }
  }

  const categories = CATEGORY_STYLES.map((category) => ({
    ...category,
    count: categoryCounts.get(category.id) ?? 0,
  })).filter((category) => category.count > 0);

  const propertyCount =
    rawNodes.reduce((total, node) => total + (node.properties?.length ?? 0), 0) +
    rawEdges.reduce((total, edge) => total + (edge.properties?.length ?? 0), 0);

  return {
    elements,
    categories,
    stats: {
      nodes: elements.filter((element) => element.group === "nodes" && !element.data.ghost).length,
      declaredNodes: rawNodes.length,
      edges: rawEdges.length,
      properties: propertyCount,
    },
  };
}

export function getLayoutOptions(layoutName, nodeCount) {
  const common = {
    animate: false,
    fit: true,
    padding: 80,
  };

  if (layoutName === "circle") {
    return { name: "circle", ...common, spacingFactor: nodeCount > 120 ? 1.35 : 1.1 };
  }

  if (layoutName === "radial") {
    return {
      name: "concentric",
      ...common,
      minNodeSpacing: nodeCount > 120 ? 18 : 34,
      concentric: (node) => node.degree(),
      levelWidth: () => 2,
    };
  }

  if (layoutName === "hierarchy") {
    return {
      name: "breadthfirst",
      ...common,
      directed: true,
      spacingFactor: nodeCount > 120 ? 1.0 : 1.25,
      circle: false,
      grid: true,
    };
  }

  return {
    name: "cose",
    ...common,
    randomize: false,
    idealEdgeLength: nodeCount > 120 ? 95 : 125,
    nodeOverlap: 12,
    refresh: 16,
    componentSpacing: 90,
    gravity: 0.85,
    numIter: nodeCount > 120 ? 650 : 900,
  };
}

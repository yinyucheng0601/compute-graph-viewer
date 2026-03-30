const SOURCE_SAMPLE_URL = "../data/source-graph.json";

export const SAMPLE_CATALOG = [
  {
    key: "source-graph",
    label: "Source Graph",
    description: "Annotated source graph sample from data/source-graph.json.",
  },
];

export async function loadGraphSample(_sampleKey, _options = {}) {
  return loadSourceSample();
}

async function loadSourceSample() {
  const raw = await fetchJson(SOURCE_SAMPLE_URL);
  return parseSourceSampleGraph(raw, {
    sampleLabel: "Source Graph",
    source: SOURCE_SAMPLE_URL,
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`);
  }
  return response.json();
}

function parseSourceSampleGraph(data, context) {
  const nodes = [];
  const edges = [];

  (data.nodes || []).forEach((rawNode, index) => {
    const kind = mapSourceNodeKind(rawNode.type);
    const role = rawNode.type === "Incast" ? "in" : rawNode.type === "Outcast" ? "out" : null;
    nodes.push({
      id: rawNode.id,
      kind,
      label: rawNode.name,
      parentId: rawNode.parentId || null,
      data: {
        rawType: rawNode.type,
        role,
        semanticLabel: rawNode.semantic_label || "",
        shape: rawNode.shape || [],
        dtype: normalizeDtype(rawNode.dtype),
        details: rawNode.details || "",
        sourceRef: rawNode.source_ref || null,
        sourceLines: rawNode.source_lines || [],
        sourceCode: rawNode.source_code || "",
        index,
      },
    });
  });

  (data.edges || []).forEach((rawEdge, index) => {
    edges.push({
      id: `edge_${index}`,
      source: rawEdge.source,
      target: rawEdge.target,
      data: {
        originalType: "sample",
      },
    });
  });

  return {
    id: "root",
    label: context.sampleLabel,
    nodes,
    edges,
    initialExpanded: [],
    meta: {
      sampleLabel: context.sampleLabel,
      source: context.source,
      description: "Flat DAG sample with explicit tensor and boundary nodes.",
    },
  };
}

function mapSourceNodeKind(type) {
  switch (type) {
    case "Incast":
    case "Outcast":
      return "boundary";
    case "Operation":
      return "op";
    case "Group":
    case "Cluster":
      return "group";
    case "Tensor":
    default:
      return "tensor";
  }
}

function normalizeDtype(raw) {
  return typeof raw === "string" ? raw.replace(/^DT_/, "") : "";
}

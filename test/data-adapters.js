const PASS_FALLBACK_URL =
  "../deepseek_out_pass/After_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json";
const REAL_PASS_BASE_URL =
  "../output_deepseek/Pass_00_RemoveRedundantReshape";
const SOURCE_SAMPLE_URL = "../data/source-graph.json";
const MVP_DATA_URL = "../mvp/data.js";

export const DEFAULT_REAL_PASS_00_FILE =
  "After_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json";

export const REAL_PASS_00_FILES = [
  DEFAULT_REAL_PASS_00_FILE,
  "After_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_6.json",
  "After_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_8.json",
  "After_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_10.json",
  "After_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_12.json",
  "After_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_14.json",
  "After_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_16.json",
  "Before_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_6.json",
  "Before_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_8.json",
  "Before_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_10.json",
  "Before_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_12.json",
  "Before_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_14.json",
  "Before_000_RemoveRedundantReshape_TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_16.json",
  "Before_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json",
];

const DTYPE_MAP = {
  0: "FP32",
  1: "FP16",
  2: "INT8",
  3: "INT32",
  4: "UINT8",
  5: "INT16",
  6: "UINT16",
  7: "UINT32",
  8: "BF16",
  9: "INT64",
  10: "UINT64",
  11: "FP64",
  12: "BOOL",
  13: "STRING",
  26: "BF16",
  27: "BF16",
};

export const SAMPLE_CATALOG = [
  {
    key: "mvp-layer-3",
    label: "MVP Layer 3 · Deep Groups",
    description: "Synthetic deep hierarchy extracted from mvp/data.js layer 3.",
  },
  {
    key: "mvp-layer-0",
    label: "MVP Layer 0 · Deep Groups",
    description: "Dense layer hierarchy extracted from mvp/data.js layer 0.",
  },
  {
    key: "pass-graph",
    label: "Ascend Pass Graph",
    description: "Real compiler pass JSON with tensors and boundary nodes.",
  },
  {
    key: "source-graph",
    label: "Source Graph",
    description: "Annotated source graph sample from data/source-graph.json.",
  },
];

export async function loadGraphSample(sampleKey, options = {}) {
  switch (sampleKey) {
    case "pass-graph":
      return loadPassSample(options.realPassFile);
    case "source-graph":
      return loadSourceSample();
    case "mvp-layer-0":
      return loadMvpLayerSample(0);
    case "mvp-layer-3":
    default:
      return loadMvpLayerSample(3);
  }
}

async function loadPassSample(realPassFile) {
  const sampleFile = realPassFile || REAL_PASS_00_FILES[0];
  const url = sampleFile
    ? `${REAL_PASS_BASE_URL}/${sampleFile}`
    : PASS_FALLBACK_URL;
  const raw = await fetchJson(url);
  return parseAscendPassGraph(raw, {
    sampleLabel: sampleFile || "Ascend Pass Graph",
    source: url,
  });
}

async function loadSourceSample() {
  const raw = await fetchJson(SOURCE_SAMPLE_URL);
  return parseSourceSampleGraph(raw, {
    sampleLabel: "Source Graph",
    source: SOURCE_SAMPLE_URL,
  });
}

async function loadMvpLayerSample(layerIndex) {
  const text = await fetchText(MVP_DATA_URL);
  const data = parseAssignedJson(text, "window.DEEPSEEK_INTERPRETABILITY_DATA");
  return buildDeepHierarchyFromMvp(data, layerIndex);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`);
  }
  return response.text();
}

function parseAssignedJson(text, assignment) {
  const prefix = `${assignment} =`;
  const start = text.indexOf(prefix);
  if (start === -1) {
    throw new Error(`Assignment not found: ${assignment}`);
  }
  const payload = text
    .slice(start + prefix.length)
    .trim()
    .replace(/;+\s*$/, "");
  return JSON.parse(payload);
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

function parseFuncGroupLabel(funcMagicName) {
  const match = String(funcMagicName || "").match(/^TENSOR_(.+?)_Unroll\d+/);
  if (!match) return funcMagicName || "Function";
  return match[1];
}

function parseAscendPassGraph(data, context) {
  const func = (data.functions || [])[0];
  if (!func) {
    throw new Error("No function found in Ascend pass JSON.");
  }

  const tensorList = func.tensors || [];
  const rawTensorList = func.rawtensors || [];
  const opList = func.operations || [];
  const incastList = func.incasts || [];
  const outcastList = func.outcasts || [];

  const tensorMap = new Map(tensorList.map((tensor) => [tensor.magic, tensor]));
  const rawTensorMap = new Map(rawTensorList.map((tensor) => [tensor.rawmagic, tensor]));
  const incastSet = new Set(incastList.map((entry) => entry[0]));
  const outcastSet = new Set(outcastList.map((entry) => entry[0]));
  const incastSlot = new Map(incastList.map((entry, idx) => [entry[0], idx]));
  const outcastSlot = new Map(outcastList.map((entry, idx) => [entry[0], idx]));

  const nodes = [];
  const edges = [];

  // Top-level function group
  const funcGroupId = `func_${func.funcmagic}`;
  nodes.push({
    id: funcGroupId,
    kind: "group",
    label: parseFuncGroupLabel(func.func_magicname),
    parentId: null,
    data: { funcmagic: func.funcmagic },
  });

  // Semantic sub-groups (created on demand from "Prefix-Suffix" label pattern)
  const semanticGroupIds = new Map();
  function ensureSemanticGroup(semanticLabel) {
    const prefix = semanticLabel.split("-")[0];
    if (!semanticGroupIds.has(prefix)) {
      const groupId = `sg_${funcGroupId}_${prefix.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      nodes.push({
        id: groupId,
        kind: "group",
        label: `${prefix} 支路`,
        parentId: funcGroupId,
        data: { semanticPrefix: prefix },
      });
      semanticGroupIds.set(prefix, groupId);
    }
    return semanticGroupIds.get(prefix);
  }

  tensorList.forEach((tensor) => {
    const rawTensor = rawTensorMap.get(tensor.rawtensor) || {};
    const kind = incastSet.has(tensor.magic)
      ? "boundary"
      : outcastSet.has(tensor.magic)
        ? "boundary"
        : "tensor";
    const role = incastSet.has(tensor.magic) ? "in" : outcastSet.has(tensor.magic) ? "out" : null;
    const symbol = rawTensor.symbol || `T${tensor.magic}`;
    nodes.push({
      id: `t_${tensor.magic}`,
      kind,
      label: symbol,
      parentId: funcGroupId,
      data: {
        role,
        dtype: dtypeName(rawTensor.datatype),
        shape: tensor.shape || [],
        rawShape: rawTensor.rawshape || [],
        format: rawTensor.format ?? 0,
        magic: tensor.magic,
        memType: tensor.mem_type || null,
        memId: tensor.mem_id,
        slotIdx: role === "in" ? incastSlot.get(tensor.magic) : role === "out" ? outcastSlot.get(tensor.magic) : null,
      },
    });
  });

  opList.forEach((op) => {
    const semanticLabel = op.semantic_label?.label || "";
    const parentId = semanticLabel ? ensureSemanticGroup(semanticLabel) : funcGroupId;
    const firstOutput = (op.ooperands || []).length ? tensorMap.get(op.ooperands[0]) : null;
    nodes.push({
      id: `op_${op.opmagic}`,
      kind: "op",
      label: op.semantic_label?.label || op.opcode,
      parentId,
      data: {
        opcode: op.opcode,
        semanticLabel,
        shape: firstOutput?.shape || [],
        latency: op.latency ?? null,
        subgraphId: op.subgraphid ?? null,
        opAttr: op.op_attr || {},
        magic: op.opmagic,
      },
    });

    (op.ioperands || []).forEach((operand) => {
      if (!tensorMap.has(operand)) {
        return;
      }
      edges.push({
        id: `edge_t_${operand}_to_op_${op.opmagic}`,
        source: `t_${operand}`,
        target: `op_${op.opmagic}`,
        data: {
          direction: "input",
        },
      });
    });

    (op.ooperands || []).forEach((operand) => {
      if (!tensorMap.has(operand)) {
        return;
      }
      edges.push({
        id: `edge_op_${op.opmagic}_to_t_${operand}`,
        source: `op_${op.opmagic}`,
        target: `t_${operand}`,
        data: {
          direction: "output",
        },
      });
    });
  });

  const initialExpanded = [funcGroupId];

  return {
    id: "root",
    label: func.func_magicname || context.sampleLabel,
    nodes,
    edges,
    initialExpanded,
    meta: {
      sampleLabel: context.sampleLabel,
      source: context.source,
      description: "Real compiler pass graph with explicit tensor and boundary nodes.",
      stats: {
        ops: opList.length,
        tensors: tensorList.length,
        incasts: incastList.length,
        outcasts: outcastList.length,
      },
    },
  };
}

function buildDeepHierarchyFromMvp(data, layerIndex) {
  const layer = (data.layers || []).find((entry) => entry.layer_id === layerIndex) || (data.layers || [])[0];
  if (!layer) {
    throw new Error(`Layer not found in mvp/data.js: ${layerIndex}`);
  }

  const nodes = [];
  const edges = [];
  const initialExpanded = [];
  const seenGroups = new Set();

  const modelGroup = ensureGroup(["model"], "Model");
  const stackGroup = ensureGroup(["model", "decoder_stack"], "Decoder Stack");
  const layerGroup = ensureGroup(["model", "decoder_stack", `layer_${String(layer.layer_id).padStart(2, "0")}`], layer.layer_name);

  const inputBoundaryId = `layer_${layer.layer_id}_input`;
  const outputBoundaryId = `layer_${layer.layer_id}_output`;

  nodes.push({
    id: inputBoundaryId,
    kind: "boundary",
    label: "Hidden State In",
    parentId: layerGroup.id,
    data: {
      role: "in",
      shape: layer.operators?.[0]?.input_shape || "[B, T, H]",
      source: "mvp",
    },
  });

  nodes.push({
    id: outputBoundaryId,
    kind: "boundary",
    label: "Hidden State Out",
    parentId: layerGroup.id,
    data: {
      role: "out",
      shape: layer.operators?.[layer.operators.length - 1]?.output_shape || "[B, T, H]",
      source: "mvp",
    },
  });

  const opIds = [];
  const opNodes = [];

  (layer.operators || []).forEach((operator, index) => {
    const stage = sanitizeSegment(operator.stage || "misc");
    const submoduleParts = String(operator.submodule || "misc")
      .split(".")
      .filter(Boolean)
      .map(sanitizeSegment);

    const groupSegments = [
      "model",
      "decoder_stack",
      `layer_${String(layer.layer_id).padStart(2, "0")}`,
      `stage_${stage}`,
      ...submoduleParts,
    ];

    const parentGroup = ensureGroup(groupSegments, prettifySegment(groupSegments[groupSegments.length - 1]));
    const opId = `layer_${layer.layer_id}_op_${String(index).padStart(2, "0")}`;
    const opNode = {
      id: opId,
      kind: "op",
      label: operator.op_name || `Operator ${index + 1}`,
      parentId: parentGroup.id,
      data: {
        stage: operator.stage || "",
        submodule: operator.submodule || "",
        formula: operator.formula || "",
        inputShape: operator.input_shape || "",
        outputShape: operator.output_shape || "",
        fusionNotes: operator.fusion_notes || "",
        weights: operator.weights || [],
        sourceRef: operator.source_ref || "",
      },
    };
    nodes.push(opNode);
    opNodes.push(opNode);
    opIds.push(opId);
  });

  createTensorBridge(inputBoundaryId, opIds[0], {
    name: "hidden_state",
    shape: firstShape(layer.operators?.[0]?.input_shape),
  });

  for (let index = 0; index < opIds.length - 1; index += 1) {
    const current = opNodes[index];
    const next = opNodes[index + 1];
    createTensorBridge(current.id, next.id, {
      name: current.label,
      shape: firstShape(current.data.outputShape || next.data.inputShape),
    });
  }

  createTensorBridge(opIds[opIds.length - 1], outputBoundaryId, {
    name: "layer_output",
    shape: firstShape(layer.operators?.[layer.operators.length - 1]?.output_shape),
  });

  const attentionResidual = opNodes.find((node) => /attention_residual/.test(node.data.submodule));
  const ffnResidual = opNodes.find((node) => /ffn_residual/.test(node.data.submodule));
  if (attentionResidual) {
    createTensorBridge(inputBoundaryId, attentionResidual.id, {
      name: "residual_skip_attn",
      shape: "[B, T, H]",
    });
  }
  if (attentionResidual && ffnResidual) {
    createTensorBridge(attentionResidual.id, ffnResidual.id, {
      name: "residual_skip_ffn",
      shape: "[B, T, H]",
    });
  }

  return {
    id: "root",
    label: `MVP Layer ${layer.layer_id}`,
    nodes,
    edges,
    initialExpanded,
    meta: {
      sampleLabel: `MVP Layer ${layer.layer_id}`,
      source: MVP_DATA_URL,
      description: "Deep synthetic hierarchy extracted from mvp/data.js with explicit tensor bridges.",
      stats: {
        groups: nodes.filter((node) => node.kind === "group").length,
        ops: nodes.filter((node) => node.kind === "op").length,
      },
    },
  };

  function ensureGroup(pathSegments, label) {
    const id = pathSegments.join("/");
    if (seenGroups.has(id)) {
      return nodes.find((node) => node.id === id);
    }
    const parentId = pathSegments.length > 1 ? pathSegments.slice(0, -1).join("/") : null;
    const groupNode = {
      id,
      kind: "group",
      label,
      parentId,
      data: {
        depth: pathSegments.length,
        source: "mvp",
      },
    };
    nodes.push(groupNode);
    seenGroups.add(id);
    initialExpanded.push(id);
    return groupNode;
  }

  function createTensorBridge(source, target, payload) {
    if (!source || !target) {
      return;
    }
    const tensorId = `tensor_${sanitizeSegment(source)}__${sanitizeSegment(target)}__${edges.length}`;
    nodes.push({
      id: tensorId,
      kind: "tensor",
      label: payload.name,
      parentId: layerGroup.id,
      data: {
        dtype: "",
        shape: payload.shape || "",
        source: "mvp",
      },
    });
    edges.push(
      {
        id: `${source}__${tensorId}`,
        source,
        target: tensorId,
        data: {
          direction: "output",
        },
      },
      {
        id: `${tensorId}__${target}`,
        source: tensorId,
        target,
        data: {
          direction: "input",
        },
      }
    );
  }
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

function dtypeName(raw) {
  return DTYPE_MAP[raw] || (raw == null ? "" : `dtype:${raw}`);
}

function normalizeDtype(raw) {
  return typeof raw === "string" ? raw.replace(/^DT_/, "") : "";
}

function sanitizeSegment(value) {
  return String(value || "node")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "node";
}

function prettifySegment(value) {
  return String(value || "")
    .replace(/^stage_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function firstShape(rawShape) {
  if (!rawShape) {
    return "";
  }
  if (Array.isArray(rawShape)) {
    return `[${rawShape.join(", ")}]`;
  }
  return String(rawShape);
}

/**
 * parser.js — Parse Ascend compute graph JSON into a graph model
 * Nodes: incast | tensor | op | outcast
 * Edges: directed, from tensor → op (input) or op → tensor (output)
 */

const DTYPE_MAP = {
  0: 'FP32', 1: 'FP16', 2: 'INT8',  3: 'INT32',
  4: 'UINT8', 5: 'INT16', 6: 'UINT16', 7: 'UINT32',
  8: 'BF16',  9: 'INT64', 10: 'UINT64', 11: 'FP64',
  12: 'BOOL', 13: 'STRING', 26: 'BF16', 27: 'BF16',
};

function dtypeName(n) {
  return DTYPE_MAP[n] ?? `dtype:${n}`;
}

function shapeStr(shape) {
  if (!shape || shape.length === 0) return '[]';
  return '[' + shape.join(', ') + ']';
}

function parseGraph(data) {
  const func = data.functions[0];

  const tensorList   = func.tensors    || [];
  const rawTensorList = func.rawtensors || [];
  const opList       = func.operations  || [];
  const incastList   = func.incasts     || [];
  const outcastList  = func.outcasts    || [];

  // Maps: magic → tensor/rawtensor object
  const tensorMap    = new Map(tensorList.map(t => [t.magic, t]));
  const rawTensorMap = new Map(rawTensorList.map(rt => [rt.rawmagic, rt]));

  // Sets of tensor magics that are incast / outcast boundary nodes
  const incastSet  = new Set(incastList.map(ic => ic[0]));
  const outcastSet = new Set(outcastList.map(oc => oc[0]));

  // Incast/outcast maps: tensor_magic → [raw_tensor_ids] and → slot index
  const incastConnections  = new Map(incastList.map(ic => [ic[0], ic[1]]));
  const outcastConnections = new Map(outcastList.map(oc => [oc[0], oc[1]]));
  const incastSlot  = new Map(incastList.map((ic, i) => [ic[0], i]));
  const outcastSlot = new Map(outcastList.map((oc, i) => [oc[0], i]));

  const nodes = [];
  const edges = [];

  // ── Tensor nodes ──────────────────────────────────────────────
  for (const tensor of tensorList) {
    const rt = rawTensorMap.get(tensor.rawtensor) || {};
    const magic = tensor.magic;

    let type = 'tensor';
    if (incastSet.has(magic))  type = 'incast';
    if (outcastSet.has(magic)) type = 'outcast';

    const symbol = rt.symbol || `T${magic}`;
    const dtype  = dtypeName(rt.datatype);
    const shape  = tensor.shape;

    // Friendly sub-label for the node header
    let subLabel = symbol;
    if (type === 'incast') {
      // "IN_6" → keep as-is
    } else if (type === 'outcast') {
      // "OUTCAST_SYMBOL0" → "OUTCAST_0"
      subLabel = symbol.replace('OUTCAST_SYMBOL', 'SYM·').replace('OUTCAST_LOCAL_BUF', 'BUF·');
    } else {
      // Shorten long names for display
      subLabel = symbol.replace('INCAST_LOCAL_BUF', 'BUF·');
    }

    const extra = {};
    if (type === 'incast') {
      extra.rawConnections = incastConnections.get(magic);
      extra.slotIdx = incastSlot.get(magic) ?? 0;
    }
    if (type === 'outcast') {
      extra.rawConnections = outcastConnections.get(magic);
      extra.slotIdx = outcastSlot.get(magic) ?? 0;
    }

    nodes.push({
      id: `t_${magic}`,
      type,
      label: symbol,
      subLabel,
      data: {
        magic,
        shape,
        rawShape: rt.rawshape || [],
        dtype,
        rawDtype: rt.datatype,
        symbol,
        format: rt.format ?? 0,
        offset: tensor.offset || [],
        memId: tensor.mem_id,
        kind: tensor.kind,
        lifeRange: tensor.life_range,
        ...extra,
      }
    });
  }

  // ── Operation nodes ────────────────────────────────────────────
  for (const op of opList) {
    const magic = op.opmagic;
    const firstOut = (op.ooperands || []).length > 0 ? tensorMap.get(op.ooperands[0]) : null;
    nodes.push({
      id: `op_${magic}`,
      type: 'op',
      label: op.opcode,
      subLabel: op.opcode,
      data: {
        magic,
        opcode: op.opcode,
        kind: op.kind,
        latency: op.latency,
        ioperands: op.ioperands || [],
        ooperands: op.ooperands || [],
        subgraphId: op.subgraphid,
        outShape: firstOut?.shape ?? null,
        opAttr: op.op_attr || {},
      }
    });

    // Edges: input tensors → op
    for (const tId of (op.ioperands || [])) {
      if (tensorMap.has(tId)) {
        edges.push({ source: `t_${tId}`, target: `op_${magic}` });
      }
    }
    // Edges: op → output tensors
    for (const tId of (op.ooperands || [])) {
      if (tensorMap.has(tId)) {
        edges.push({ source: `op_${magic}`, target: `t_${tId}` });
      }
    }
  }

  const meta = {
    name: func.func_magicname || func.rawname || 'graph',
    hash: func.hash,
    funcId: func._funcid,
    file: func.file,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    incastCount: incastList.length,
    outcastCount: outcastList.length,
    opCount: opList.length,
    tensorCount: tensorList.length,
  };

  return { nodes, edges, meta };
}

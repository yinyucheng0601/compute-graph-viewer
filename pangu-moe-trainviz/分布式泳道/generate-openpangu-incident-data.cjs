const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, 'data/openpangu-moe-incident.config.json');
const ARCHITECTURE_PATH = path.join(__dirname, 'data/openpangu-2.0-flash/model_architecture.json');
const ARCHITECTURE_GRAPH_PATH = path.join(__dirname, 'data/openpangu-2.0-flash/model_architecture_graph.json');
const SCHEMA_PATH = path.join(__dirname, 'training-timeline-v4.schema.json');
const OUTPUT_PATH = path.join(__dirname, 'data/openpangu-moe-incident-step15203.timeline.json');
const contract = require('./timeline-contract-v4.js');

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stableJson = (value) => JSON.stringify(value);
const groupId = (stage) => `epg/dp0/pp${stage}/tp0`;

function graphItems(graph) {
  const items = new Map();
  const visit = (item) => {
    if (items.has(item.id)) throw new Error(`Duplicate architecture node ${item.id}`);
    items.set(item.id, item);
    item.children.forEach(visit);
  };
  graph.roots.forEach(visit);
  return items;
}

function generate(configInput, sourcesInput) {
  const config = clone(configInput);
  const sources = {
    architecture: clone(sourcesInput.architecture),
    architectureGraph: clone(sourcesInput.architectureGraph),
    schema: sourcesInput.schema,
  };
  const { dataset: datasetConfig, training, coverage, incident } = config;
  const architecture = sources.architecture;
  const graph = sources.architectureGraph;
  const architectureItems = graphItems(graph);
  const modelAssetId = architecture.model.asset_id;
  if (graph.metadata.sourceAssetId !== modelAssetId || graph.metadata.sourceAssetHash !== architecture.content_hash) {
    throw new Error('Architecture asset identity mismatch');
  }
  if (graph.content_hash !== graph.metadata?.graphContentHash && graph.metadata?.graphContentHash) {
    throw new Error('Architecture graph metadata hash mismatch');
  }
  if (architecture.symbol_table.E % training.ep !== 0) throw new Error('Expert count must be divisible by EP for the default placement policy');
  if (config.stages.length !== training.pp) throw new Error('Stage config must match PP');

  const stages = config.stages.map((stage) => ({ ...stage, provenanceIds: ['parallel-config'] }));
  const ranks = [];
  const epGroups = [];
  stages.forEach((stage) => {
    const members = [];
    for (let epRank = 0; epRank < training.ep; epRank += 1) {
      const globalRank = stage.id * training.ep + epRank;
      const rank = {
        rank: globalRank,
        globalRank,
        dp: 0,
        stage: stage.id,
        tp: 0,
        epRank,
        epGroupId: groupId(stage.id),
        node: Math.floor(epRank / 8),
        device: epRank % 8,
        provenanceIds: ['parallel-config'],
      };
      ranks.push(rank);
      members.push({ globalRank, epRank });
    }
    epGroups.push({
      id: groupId(stage.id),
      label: `DP0 / PP${stage.id} / TP0 · EP${training.ep}`,
      stage: stage.id,
      dp: 0,
      tp: 0,
      ranks: members,
      provenanceIds: ['parallel-config'],
    });
  });
  const rankById = new Map(ranks.map((rank) => [rank.globalRank, rank]));

  const focusGroupId = groupId(incident.stage);
  const focusGroup = epGroups.find((group) => group.id === focusGroupId);
  const placementOverrides = config.expertPlacement.ownerOverrides || {};
  const expertPlacements = Array.from({ length: architecture.symbol_table.E }, (_, logicalExpertId) => {
    const defaultEpRank = Math.floor(logicalExpertId / config.expertPlacement.defaultExpertsPerEpRank);
    const epRank = Number(placementOverrides[String(logicalExpertId)] ?? defaultEpRank);
    const ownerGlobalRank = focusGroup.ranks.find((member) => member.epRank === epRank)?.globalRank;
    if (!Number.isInteger(ownerGlobalRank)) throw new Error(`No owner rank for E${logicalExpertId}/EP${epRank}`);
    return {
      id: `expert-placement/l${incident.layer}/${focusGroupId}/e${logicalExpertId}`,
      layer: incident.layer,
      epGroupId: focusGroupId,
      logicalExpertId,
      physicalExpertId: null,
      ownerGlobalRank,
      epRank,
      provenanceIds: ['expert-placement-config'],
    };
  });
  const placementByExpert = new Map(expertPlacements.map((placement) => [placement.logicalExpertId, placement]));

  const events = [];
  function addEvent(input) {
    const rank = rankById.get(input.rank);
    if (!rank) throw new Error(`Unknown rank ${input.rank}`);
    const event = {
      id: input.id,
      label: input.label,
      kind: input.kind,
      start: input.start,
      end: input.end,
      scope: input.layer == null ? 'step' : 'layer',
      microbatchId: input.microbatchId ?? null,
      rank: rank.globalRank,
      globalRank: rank.globalRank,
      dp: rank.dp,
      stage: rank.stage,
      tp: rank.tp,
      epRank: rank.epRank,
      epGroupId: rank.epGroupId,
      layer: input.layer ?? null,
      status: input.status || 'normal',
      diagnosisRole: input.diagnosisRole || 'context',
      graphNodeIds: input.graphNodeIds || [],
      participants: input.participants || [],
      stream: input.stream || 'compute',
      taskId: input.taskId || null,
      anomaly: input.anomaly || null,
      communication: input.communication || null,
      dependsOn: input.dependsOn || [],
      blockedBy: input.blockedBy || [],
      affects: input.affects || [],
      expertIds: input.expertIds || [],
      provenanceIds: input.provenanceIds || ['incident-simulation'],
      fidelity: datasetConfig.fidelity,
    };
    events.push(event);
    return event;
  }

  const stageWindows = [[0, 1280], [320, 1910], [660, 2390]];
  for (let stage = 0; stage < incident.stage; stage += 1) {
    for (let epRank = 0; epRank < training.ep; epRank += 1) {
      const rank = stage * training.ep + epRank;
      const [start, end] = stageWindows[stage];
      addEvent({
        id: `event/pp${stage}/mb03/r${rank}/forward`,
        label: `Forward · PP${stage}`,
        kind: 'forward',
        start: start + (epRank % 4) * 3,
        end: end + (epRank % 7) * 4,
        rank,
        microbatchId: incident.microbatchId,
        layer: stages[stage].first,
        stream: 'compute',
        taskId: `pp${stage}-forward-r${rank}`,
        graphNodeIds: ['decoder_layer'],
      });
    }
  }

  const participants = focusGroup.ranks.map((member) => member.globalRank);
  const hotPlacement = placementByExpert.get(incident.hotLogicalExpertId);
  if (hotPlacement.epRank !== incident.hotEpRank) throw new Error('Hot Expert placement does not match incident EP Rank');
  const hotRank = hotPlacement.ownerGlobalRank;
  const routerId = `event/router/l${incident.layer}/mb03/r${hotRank}`;
  const dispatchId = `event/dispatch/l${incident.layer}/mb03/r${hotRank}`;
  const expertId = `event/expert/l${incident.layer}/mb03/r${hotRank}`;
  const combineId = `event/combine/l${incident.layer}/mb03/r${hotRank}`;
  const affectedWaitIds = participants.filter((rank) => rank !== hotRank).map((rank) => `event/wait/l${incident.layer}/mb03/r${rank}`);

  for (let epRank = 0; epRank < training.ep; epRank += 1) {
    const rank = incident.stage * training.ep + epRank;
    const isHot = epRank === incident.hotEpRank;
    const ids = {
      router: isHot ? routerId : `event/router/l${incident.layer}/mb03/r${rank}`,
      dispatch: isHot ? dispatchId : `event/dispatch/l${incident.layer}/mb03/r${rank}`,
      wait: `event/wait/l${incident.layer}/mb03/r${rank}`,
      expert: isHot ? expertId : `event/expert/l${incident.layer}/mb03/r${rank}`,
      combine: isHot ? combineId : `event/combine/l${incident.layer}/mb03/r${rank}`,
    };
    addEvent({
      id: ids.router,
      label: isHot ? `Router collapse · L${incident.layer}` : `Router · L${incident.layer}`,
      kind: 'forward',
      start: 900,
      end: 980 + (epRank % 3),
      rank,
      microbatchId: incident.microbatchId,
      layer: incident.layer,
      status: isHot ? 'critical' : 'normal',
      diagnosisRole: isHot ? 'root-cause' : 'context',
      stream: 'compute/moe',
      taskId: `router-r${rank}`,
      graphNodeIds: ['router_gate', 'route_topk'],
      expertIds: isHot ? [incident.hotLogicalExpertId] : [],
      anomaly: isHot ? {
        baselineDuration: 80,
        deltaRatio: 1,
        reasonCode: 'ROUTER_TOP1_COLLAPSE',
        threshold: 'Top1 share > 20%',
        currentValue: `${(incident.hotTop1Assignments / incident.totalTop1Assignments * 100).toFixed(1)}% · E${incident.hotLogicalExpertId}`,
        baselineValue: `${(100 / architecture.symbol_table.E).toFixed(2)}%`,
      } : null,
      affects: isHot ? [dispatchId] : [],
    });
    addEvent({
      id: ids.dispatch,
      label: isHot ? `EP Dispatch anomaly · L${incident.layer}` : `EP Dispatch · L${incident.layer}`,
      kind: 'comm',
      start: 985,
      end: isHot ? 4980 : 1185 + (epRank % 5) * 4,
      rank,
      microbatchId: incident.microbatchId,
      layer: incident.layer,
      status: isHot ? 'critical' : 'normal',
      diagnosisRole: isHot ? 'symptom' : 'context',
      stream: 'hccl/ep',
      taskId: `a2a-dispatch-r${rank}`,
      graphNodeIds: ['moe_all_to_all_dispatch', 'router_gate', 'routed_expert_bank'],
      participants,
      expertIds: isHot ? [incident.hotLogicalExpertId] : [],
      anomaly: isHot ? {
        baselineDuration: 200,
        deltaRatio: 20,
        reasonCode: 'A2A_SEND_RECV_MISMATCH',
        threshold: 'duration > baseline × 5',
        currentValue: '3995 ms',
        baselineValue: '200 ms',
      } : null,
      communication: {
        primitive: 'dispatch-combine',
        phase: 'dispatch',
        strategy: 'dispatch_combine',
        sendTokens: isHot ? 0 : 128,
        recvTokens: isHot ? 9832 : 128,
        sendBytes: null,
        recvBytes: null,
        bandwidthGBps: null,
        waitDuration: isHot ? 3800 : 0,
      },
      dependsOn: [ids.router],
      blockedBy: isHot ? [routerId] : [],
      affects: isHot ? [...affectedWaitIds, expertId] : [],
    });
    if (!isHot) {
      addEvent({
        id: ids.wait,
        label: `Barrier wait · L${incident.layer}`,
        kind: 'wait',
        start: 1189 + (epRank % 5) * 4,
        end: 4980,
        rank,
        microbatchId: incident.microbatchId,
        layer: incident.layer,
        status: 'warning',
        diagnosisRole: 'affected',
        stream: 'hccl/ep',
        taskId: `barrier-r${rank}`,
        graphNodeIds: ['moe_all_to_all_dispatch'],
        blockedBy: [dispatchId],
        affects: [ids.expert],
      });
    }
    addEvent({
      id: ids.expert,
      label: isHot ? `E${incident.hotLogicalExpertId} Expert Compute` : 'Routed Expert Compute',
      kind: 'forward',
      start: 4980,
      end: isHot ? 7100 : 5220 + (epRank % 6) * 8,
      rank,
      microbatchId: incident.microbatchId,
      layer: incident.layer,
      status: isHot ? 'critical' : 'normal',
      diagnosisRole: isHot ? 'root-cause' : 'context',
      stream: 'compute/moe',
      taskId: `expert-r${rank}`,
      graphNodeIds: isHot ? ['routed_expert_bank', `expert_${incident.hotLogicalExpertId}`] : ['routed_expert_bank'],
      expertIds: isHot ? [incident.hotLogicalExpertId] : [],
      blockedBy: [isHot ? dispatchId : ids.wait],
      affects: [ids.combine],
    });
    addEvent({
      id: ids.combine,
      label: isHot ? `EP Combine anomaly · L${incident.layer}` : `Delayed EP Combine · L${incident.layer}`,
      kind: 'comm',
      start: isHot ? 7100 : 5220 + (epRank % 6) * 8,
      end: isHot ? 8350 : 5500 + (epRank % 6) * 8,
      rank,
      microbatchId: incident.microbatchId,
      layer: incident.layer,
      status: 'warning',
      diagnosisRole: isHot ? 'symptom' : 'affected',
      stream: 'hccl/ep',
      taskId: `a2a-combine-r${rank}`,
      graphNodeIds: ['moe_all_to_all_combine', 'routed_expert_bank', 'moe_combine'],
      participants,
      communication: {
        primitive: 'dispatch-combine',
        phase: 'combine',
        strategy: 'dispatch_combine',
        sendTokens: isHot ? 9832 : 128,
        recvTokens: isHot ? 0 : 128,
        sendBytes: null,
        recvBytes: null,
        bandwidthGBps: null,
        waitDuration: isHot ? 1250 : 280,
      },
      blockedBy: [ids.expert],
    });
  }

  addEvent({
    id: 'event/pp2/propagated-wait/r151',
    label: 'PP2 downstream wait',
    kind: 'wait',
    start: 5550,
    end: 8200,
    rank: 151,
    microbatchId: incident.microbatchId,
    layer: 33,
    status: 'warning',
    diagnosisRole: 'affected',
    stream: 'pipeline',
    taskId: 'pp2-propagated-wait',
    graphNodeIds: ['decoder_layer'],
    blockedBy: [combineId],
  });

  const top1Counts = new Map(Object.entries(incident.residualTop1Assignments).map(([id, count]) => [Number(id), count]));
  top1Counts.set(incident.hotLogicalExpertId, incident.hotTop1Assignments);
  if ([...top1Counts.values()].reduce((sum, count) => sum + count, 0) !== incident.totalTop1Assignments) throw new Error('Top1 assignment input does not conserve tokens');
  const expertLoads = Array.from({ length: architecture.symbol_table.E }, (_, logicalExpertId) => {
    const placement = placementByExpert.get(logicalExpertId);
    const top1TokenCount = top1Counts.get(logicalExpertId) || 0;
    return {
      id: `expert-load/l${incident.layer}/${incident.microbatchId}/e${logicalExpertId}`,
      layer: incident.layer,
      microbatchId: incident.microbatchId,
      epGroupId: focusGroupId,
      logicalExpertId,
      ownerGlobalRank: placement.ownerGlobalRank,
      epRank: placement.epRank,
      top1TokenCount,
      top1Share: top1TokenCount / incident.totalTop1Assignments,
      topKCopyCount: null,
      routingWeightSum: null,
      baselineTop1Share: 1 / architecture.symbol_table.E,
      capacity: null,
      status: logicalExpertId === incident.hotLogicalExpertId ? 'critical' : top1TokenCount > 0 ? 'warning' : 'idle-top1',
      provenanceIds: ['incident-simulation'],
    };
  });

  const bindingIds = new Set(events.flatMap((event) => event.graphNodeIds));
  ['dense_mlp', 'moe_ffn', 'mhc_attention', 'mhc_mlp'].forEach((id) => bindingIds.add(id));
  const modelBindings = [...bindingIds].sort().map((id) => {
    const item = architectureItems.get(id);
    if (!item) throw new Error(`Timeline binding cannot resolve architecture node ${id}`);
    return {
      semanticNodeId: id,
      architectureNodeId: id,
      rendererNodeId: id,
      label: item.label,
      architectureAssetId: modelAssetId,
    };
  });

  const modelExecution = {
    ...incident.modelExecution,
    provenanceIds: ['incident-simulation'],
  };
  const data = {
    schemaVersion: 'training-timeline.v4',
    id: datasetConfig.id,
    label: datasetConfig.label,
    step: datasetConfig.step,
    fidelity: datasetConfig.fidelity,
    timeUnit: 'ms',
    contentHash: '0'.repeat(64),
    inputHash: sha256(stableJson({ config, architectureHash: architecture.content_hash, graphHash: graph.content_hash })),
    model: {
      id: graph.metadata.modelId,
      name: architecture.model.name,
      numHiddenLayers: architecture.symbol_table.L,
      denseLayers: [0, 1],
      moeLayers: { first: 2, last: architecture.symbol_table.L - 1 },
      expertCount: architecture.symbol_table.E,
      topK: architecture.symbol_table.top_k,
      architectureAsset: {
        id: modelAssetId,
        version: architecture.model.asset_version,
        schemaVersion: graph.schema_version,
        contentHash: architecture.content_hash,
        graphContentHash: graph.content_hash,
        uri: './data/openpangu-2.0-flash/model_architecture_graph.json',
      },
    },
    training: clone(training),
    coverage: { ...coverage, visibleRanks: ranks.length },
    modelExecution,
    stages,
    ranks,
    epGroups,
    expertPlacements,
    routingMode: 'aggregate-only',
    routingRecords: [],
    routerMetrics: [{
      id: `router-metric/l${incident.layer}/${incident.microbatchId}/${focusGroupId}`,
      layer: incident.layer,
      microbatchId: incident.microbatchId,
      epGroupId: focusGroupId,
      topExpertId: incident.hotLogicalExpertId,
      topExpertTop1Share: incident.hotTop1Assignments / incident.totalTop1Assignments,
      baselineTop1Share: 1 / architecture.symbol_table.E,
      idleTop1Experts: expertLoads.filter((load) => load.status === 'idle-top1').length,
      baselineIdleTop1Experts: 0,
      loadCv: 15.61,
      entropy: 0.18,
      totalTop1Assignments: incident.totalTop1Assignments,
      provenanceIds: ['incident-simulation'],
    }],
    expertLoads,
    modelBindings,
    incident: {
      id: incident.id,
      status: incident.status,
      summary: incident.summary,
      timeRange: clone(incident.timeRange),
      focus: {
        stage: incident.stage,
        layer: incident.layer,
        microbatchId: incident.microbatchId,
        epGroupId: focusGroupId,
        eventIds: [dispatchId],
        rankIds: [hotRank],
        nodeIds: ['router_gate', 'moe_all_to_all_dispatch', 'routed_expert_bank', `expert_${incident.hotLogicalExpertId}`],
        expertIds: [incident.hotLogicalExpertId],
      },
      provenanceIds: ['incident-simulation'],
    },
    events,
    stepBounds: clone(incident.stepBounds),
    provenance: [
      { id: 'architecture-source', kind: 'source-checked', label: 'openPangu-2.0-Flash canonical source architecture', source: './data/openpangu-2.0-flash/model_architecture_graph.json' },
      { id: 'parallel-config', kind: 'simulated-config', label: 'Explicit PP/EP/DP/TP placement and declared world-size scenario', source: './data/openpangu-moe-incident.config.json' },
      { id: 'expert-placement-config', kind: 'simulated-config', label: 'Explicit logical Expert to owner Global Rank / EP Rank mapping', source: './data/openpangu-moe-incident.config.json' },
      { id: 'incident-simulation', kind: 'simulated-incident', label: 'MoE communication incident replay fixture', source: './data/openpangu-moe-incident.config.json' },
    ],
  };
  data.contentHash = sha256(stableJson({ ...data, contentHash: undefined }));
  contract.validate(data, sources.schema);
  return data;
}

function loadInputs() {
  return {
    config: require(CONFIG_PATH),
    sources: {
      architecture: require(ARCHITECTURE_PATH),
      architectureGraph: require(ARCHITECTURE_GRAPH_PATH),
      schema: require(SCHEMA_PATH),
    },
  };
}

function writeArtifact(data) {
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

if (require.main === module) {
  const { config, sources } = loadInputs();
  const data = generate(config, sources);
  if (process.argv.includes('--write')) writeArtifact(data);
  console.log(JSON.stringify({
    wrote: process.argv.includes('--write'),
    output: OUTPUT_PATH,
    schemaVersion: data.schemaVersion,
    inputHash: data.inputHash,
    contentHash: data.contentHash,
    worldSize: data.training.worldSize,
    worldSizePolicy: data.training.worldSizePolicy.kind,
    visibleRanks: data.ranks.length,
    events: data.events.length,
    expertPlacements: data.expertPlacements.length,
    expertLoads: data.expertLoads.length,
  }, null, 2));
}

module.exports = Object.freeze({ generate, loadInputs, writeArtifact, OUTPUT_PATH });

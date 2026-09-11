const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const directory = __dirname;
const data = require('./data/openpangu-moe-incident-step15203.timeline.json');
const schema = require('./training-timeline-v4.schema.json');
const contract = require('./timeline-contract-v4.js');
const producer = require('./generate-openpangu-incident-data.cjs');
const adapters = require('./training-view-adapters-v4.js');
const architectureGraph = require('./data/openpangu-2.0-flash/model_architecture_graph.json');
const frontViewPattern = require('../../vendor/pto-design-system/patterns/model-architecture-front-view/pattern.js');

const clone = (value) => JSON.parse(JSON.stringify(value));

test('fixture satisfies training-timeline.v4 and producer output is deterministic', () => {
  assert.equal(contract.validate(data, schema), data);
  assert.equal(data.schemaVersion, 'training-timeline.v4');
  assert.equal(data.fidelity, 'simulated');
  const { config, sources } = producer.loadInputs();
  const first = producer.generate(config, sources);
  const second = producer.generate(config, sources);
  assert.deepEqual(second, first);
  assert.deepEqual(first, data, 'committed artifact drifted from producer output');
});

test('world size is an explicit scenario input and visible coverage is independently conserved', () => {
  assert.equal(data.training.worldSize, 2048);
  assert.equal(data.training.worldSizePolicy.kind, 'scenario-declared');
  assert.match(data.training.worldSizePolicy.source, /openpangu-moe-incident\.config\.json/);
  assert.equal(data.coverage.visibleRanks, data.ranks.length);
  assert.equal(data.ranks.length, 256);
  assert.deepEqual(data.coverage.visibleDp, [0]);
});

test('EP identity and Expert placement are explicit without display-slot aliases', () => {
  assert.equal(data.epGroups.length, 4);
  data.epGroups.forEach((group) => {
    assert.equal(group.ranks.length, 64);
    assert.deepEqual(group.ranks.map((member) => member.epRank), [...Array(64).keys()]);
  });
  assert.equal(data.expertPlacements.length, data.model.expertCount);
  const hot = data.expertPlacements.find((item) => item.logicalExpertId === 193);
  assert.deepEqual({ ownerGlobalRank: hot.ownerGlobalRank, epRank: hot.epRank, physicalExpertId: hot.physicalExpertId }, {
    ownerGlobalRank: 215,
    epRank: 23,
    physicalExpertId: null,
  });
  assert.doesNotMatch(JSON.stringify(data), /slot 23|expertToRank|placementShard/);
});

test('Top1 load semantics conserve assignments and keep unavailable TopK fields null', () => {
  const metric = data.routerMetrics[0];
  const total = data.expertLoads.reduce((sum, load) => sum + load.top1TokenCount, 0);
  const share = data.expertLoads.reduce((sum, load) => sum + load.top1Share, 0);
  const hot = data.expertLoads.find((load) => load.logicalExpertId === metric.topExpertId);
  assert.equal(total, metric.totalTop1Assignments);
  assert.ok(Math.abs(share - 1) < 1e-8);
  assert.equal(hot.top1TokenCount, 8028);
  assert.equal(hot.top1Share, 0.97998046875);
  assert.equal(hot.ownerGlobalRank, 215);
  assert.equal(hot.epRank, 23);
  assert.equal(hot.topKCopyCount, null);
  assert.equal(hot.routingWeightSum, null);
  assert.equal(metric.idleTop1Experts, 247);
  assert.equal(data.expertLoads.filter((load) => load.status === 'idle-top1').length, 247);
});

test('incident Dispatch selects the declared runtime strategy and canonical graph IDs', () => {
  assert.equal(data.modelExecution.moeCommunicationStrategy, 'dispatch_combine');
  assert.equal(data.modelExecution.decoderResidualBranch, 'use_mhc=true');
  const dispatch = data.events.find((event) => event.id === 'event/dispatch/l38/mb03/r215');
  assert.ok(dispatch);
  assert.equal(dispatch.status, 'critical');
  assert.equal(dispatch.diagnosisRole, 'symptom');
  assert.equal(dispatch.globalRank, 215);
  assert.equal(dispatch.epRank, 23);
  assert.equal(dispatch.communication.strategy, 'dispatch_combine');
  assert.deepEqual(dispatch.graphNodeIds, ['moe_all_to_all_dispatch', 'router_gate', 'routed_expert_bank']);
  assert.equal(dispatch.end - dispatch.start, 3995);
  assert.equal(dispatch.communication.sendTokens, 0);
  assert.equal(dispatch.communication.recvTokens, 9832);
  assert.equal(dispatch.communication.sendBytes, null);
  assert.equal(dispatch.communication.bandwidthGBps, null);
});

test('every event and incident node resolves through the architecture asset binding', () => {
  const graphIds = new Set();
  const walk = (item) => {
    graphIds.add(item.id);
    item.children.forEach(walk);
  };
  architectureGraph.roots.forEach(walk);
  const bindings = new Map(data.modelBindings.map((binding) => [binding.semanticNodeId, binding]));
  data.events.flatMap((event) => event.graphNodeIds).forEach((id) => {
    assert.ok(bindings.has(id), `missing binding ${id}`);
    assert.ok(graphIds.has(bindings.get(id).architectureNodeId), `missing architecture node ${id}`);
  });
  data.incident.focus.nodeIds.forEach((id) => assert.ok(bindings.has(id)));
  assert.equal(data.model.architectureAsset.graphContentHash, architectureGraph.content_hash);
});

test('front-view adapter emits the approved schema without page-owned geometry', () => {
  const validated = adapters.validateArchitectureBinding(data, architectureGraph);
  assert.equal(validated.asset.id, architectureGraph.metadata.sourceAssetId);
  const view = adapters.buildModelFrontViewInput(data, architectureGraph, { selectedLayer: 38 });
  assert.equal(frontViewPattern.validate(view), view);
  assert.equal(view.schemaVersion, 'model_architecture_front_view.v1');
  assert.equal(view.metadata.selectedLayer, 38);
  assert.equal(Object.values(view.nodes).some((node) => Number.isFinite(node.x) || Number.isFinite(node.y)), false);
  assert.equal(adapters.resolveFrontViewNodeId(view, 'moe_all_to_all_dispatch'), 'router_gate');
  assert.equal(adapters.resolveFrontViewNodeId(view, 'kv_cache'), 'rope_cache');
});

test('Routed Experts expands to all canonical logical children with runtime overlay identity', () => {
  assert.deepEqual([...adapters.defaultCollapsed(data, 38)], []);
  const expanded = adapters.buildModelFrontViewInput(data, architectureGraph, { selectedLayer: 38, collapsedIds: new Set() });
  const layout = frontViewPattern.createLayout(expanded, new Set());
  const experts = layout.nodes.filter((node) => /^expert_\d+$/.test(node.id));
  assert.equal(experts.length, data.model.expertCount);
  assert.deepEqual(experts.map((node) => Number(node.id.slice(7))), [...Array(256).keys()]);
  const hot = expanded.nodes.expert_193;
  assert.equal(hot.attrs.placement.ownerGlobalRank, 215);
  assert.equal(hot.attrs.placement.epRank, 23);
  assert.equal(hot.attrs.load.top1TokenCount, 8028);
  assert.equal(hot.attrs.load.top1Share, 0.97998046875);
  assert.ok(layout.clusters.some((cluster) => cluster.id === 'routed_expert_bank'));
  assert.equal(layout.nodes.find((node) => node.id === 'positions').y, layout.nodes.find((node) => node.id === 'attention_core').y);
  assert.equal(layout.nodes.find((node) => node.id === 'rope_cache').y, layout.nodes.find((node) => node.id === 'attention_core').y);
});

test('Dense layers select the Dense MLP branch and omit Routed Experts', () => {
  const dense = adapters.buildModelFrontViewInput(data, architectureGraph, { selectedLayer: 0 });
  const layout = frontViewPattern.createLayout(dense, new Set());
  assert.ok(layout.clusters.some((cluster) => cluster.id === 'dense_mlp'));
  assert.equal(layout.clusters.some((cluster) => cluster.id === 'moe_ffn'), false);
  assert.equal(layout.nodes.some((node) => /^expert_\d+$/.test(node.id)), false);
});

test('negative contract cases reject coverage, binding, placement, focus, and metric corruption', () => {
  const cases = [
    ['visible rank mismatch', (fixture) => { fixture.coverage.visibleRanks -= 1; }, /coverage\.visibleRanks/],
    ['dangling graph node', (fixture) => { fixture.events[0].graphNodeIds = ['missing-node']; }, /event graph binding/],
    ['placement conflict', (fixture) => { fixture.expertPlacements[193].ownerGlobalRank = 192; }, /expert placement owner/],
    ['focus context mismatch', (fixture) => { fixture.incident.focus.stage = 2; }, /incident focus layer\/stage/],
    ['Top1 share mismatch', (fixture) => { fixture.expertLoads[193].top1Share = 0.5; }, /expert top1 share/],
    ['Top1 conservation mismatch', (fixture) => {
      fixture.expertLoads[193].top1TokenCount -= 1;
      fixture.expertLoads[193].top1Share = fixture.expertLoads[193].top1TokenCount / fixture.routerMetrics[0].totalTop1Assignments;
    }, /Top1 conservation/],
  ];
  cases.forEach(([label, mutate, expected]) => {
    const fixture = clone(data);
    mutate(fixture);
    assert.throws(() => contract.validate(fixture, schema), expected, label);
  });
});

test('page remains schema-driven and does not expose an upstream step selector', () => {
  const html = fs.readFileSync(path.join(directory, 'training-structure-time-v4.html'), 'utf8');
  const js = fs.readFileSync(path.join(directory, 'training-structure-time-v4.js'), 'utf8');
  assert.doesNotMatch(html, /id=["']step-selector["']/);
  assert.doesNotMatch(html, /id=["'](?:layer|graph-fit)["']/);
  assert.equal((html.match(/incident-evidence__item/g) || []).length, 2);
  assert.match(js, /TimelineContractV4\.validate/);
  assert.match(html, /model-architecture-front-view\/pattern\.(?:css|js)/);
  assert.match(js, /TrainingViewAdaptersV4\.buildModelFrontViewInput/);
  assert.match(js, /PtoModelArchitectureFrontView\.render/);
  assert.match(js, /pattern\.drawTaskBar/);
  assert.doesNotMatch(html, /incident-routing-data|moe-routing\/pattern|<iframe/i);
  assert.doesNotMatch(js, /mainRows|auxiliaryPositions|buildModelSidecarInput|PtoMoeRouting/);
});

test('page consumes the front-view Pattern without legacy capsule post-processing', () => {
  const page = fs.readFileSync(path.join(__dirname, 'training-structure-time-v4.html'), 'utf8');
  assert.doesNotMatch(page, /model-graphviz\/capsule\.(?:css|js)/);
  assert.match(page, /model-architecture-front-view\/pattern\.js/);
});

test('the local v3 backup remains byte-identical to the source demo', (t) => {
  const backup = path.resolve(directory, '../.local-archive/training-structure-time-v3-20260910');
  if (!fs.existsSync(backup)) {
    t.skip('local-only v3 archive is not present in this checkout');
    return;
  }
  const files = [
    'training-structure-time-v3.html',
    'training-structure-time-v3.css',
    'training-structure-time-v3.js',
    'timeline-contract.js',
    'training-timeline.schema.json',
    'generate-training-data.cjs',
    'data/deepseek-v4-pro.config.json',
    'data/deepseek-v4-pro.timeline.json',
    'data/training-simulation.config.json',
  ];
  files.forEach((file) => {
    assert.deepEqual(
      fs.readFileSync(path.join(backup, file)),
      fs.readFileSync(path.join(directory, file)),
      `${file} differs from the archived v3 copy`,
    );
  });
});

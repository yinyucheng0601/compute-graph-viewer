(function registerPtoModelTrainingGraphvizPattern(global) {
  'use strict';

  function cloneGraph(graph, evidenceMap) {
    const source = graph || {};
    return {
      ...source,
      clusters: (source.clusters || []).map((cluster) => ({ ...cluster })),
      nodes: (source.nodes || []).map((node) => ({ ...node })),
      edges: (source.edges || []).map((edge) => ({ ...edge })),
      trainingEvidence: evidenceMap || source.trainingEvidence || {},
    };
  }

  function render(container, graph, options) {
    if (!global.PtoModelGraphvizPattern?.renderController) return null;
    const opts = options || {};
    const evidenceMap = opts.evidenceMap || graph?.trainingEvidence || {};
    const data = cloneGraph(graph, evidenceMap);
    const className = [
      'pto-model-training-graphviz',
      opts.className,
    ].filter(Boolean).join(' ');

    return global.PtoModelGraphvizPattern.renderController(container, data, {
      ...opts,
      ariaLabel: opts.ariaLabel || 'Training model architecture graph',
      className,
      reportOverlays: false,
      colormap: {
        coreColors: [
          '#14B8A6',
          '#06B6D4',
          '#EC4899',
          '#A855F7',
          '#3B82F6',
          '#8B5CF6',
          '#F59E0B',
          '#F97316',
          '#22D3EE',
        ],
        ioColors: {
          input: '#A855F7',
          output: '#38BDF8',
          parameter: '#3B82F6',
          constant: '#64748B',
        },
        ...(opts.colormap || {}),
      },
      evidenceMap,
      evidenceActionLabel: opts.evidenceActionLabel || '操作含义',
      hoverClassName: opts.hoverClassName || 'pto-model-training-hover',
      edgeTagLayerClass: opts.edgeTagLayerClass || 'pto-model-training-edge-tags',
      edgeTagClass: opts.edgeTagClass || 'pto-model-training-edge-tag',
      selectedClass: opts.selectedClass || 'is-training-selected',
      relatedClass: opts.relatedClass || 'is-training-related',
      evidenceNodeClass: opts.evidenceNodeClass || 'has-training-evidence',
      parameterClass: opts.parameterClass || 'is-parameter-object',
      stateClass: opts.stateClass || 'is-state-object',
      interaction: {
        panZoom: true,
        selectable: true,
        relatedHighlight: true,
        ...(opts.interaction || {}),
      },
      overlays: {
        evidence: true,
        edgeTags: true,
        ...(opts.overlays || {}),
      },
    });
  }

  global.PtoModelTrainingGraphvizPattern = {
    render,
  };
})(window);

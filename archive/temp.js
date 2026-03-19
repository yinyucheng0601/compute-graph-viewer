    (function () {
      const viewport = document.getElementById('vtViewport');
      const graphRoot = document.getElementById('vtGraphRoot');
      const nodesLayer = document.getElementById('vtNodesLayer');
      const edgesSvg = document.getElementById('vtEdgesSvg');
      const loading = document.getElementById('vtLoading');
      const legend = document.getElementById('vtLegend');
      const statsEl = document.getElementById('vtStats');
      const zoomLabel = document.getElementById('vtZoomLabel');
      const vtTitle = document.getElementById('vtTitle');
      const btnSource = document.getElementById('vtBtnSource');
      const btnCompiler = document.getElementById('vtBtnCompiler');
      const btnDual = document.getElementById('vtBtnDual');
      const btnHorizontal = document.getElementById('vtBtnHorizontal');
      const btnVertical = document.getElementById('vtBtnVertical');
      const canvasArea = document.getElementById('vtCanvasArea');
      const compilerBar = document.getElementById('vtCompilerBar');
      const diffStats = document.getElementById('vtDiffStats');
      const diffAdded = document.getElementById('vtDiffAdded');
      const diffRemoved = document.getElementById('vtDiffRemoved');
      const diffSame = document.getElementById('vtDiffSame');
      const fileInput = document.getElementById('vtFileInput');
      const infoText = document.getElementById('vtInfoText');
      const labelLR = document.getElementById('vtLabelLR');
      // TB panel refs
      const viewport2 = document.getElementById('vtViewport2');
      const graphRoot2 = document.getElementById('vtGraphRoot2');
      const nodesLayer2 = document.getElementById('vtNodesLayer2');
      const edgesSvg2 = document.getElementById('vtEdgesSvg2');
      const zoomLabel2 = document.getElementById('vtZoomLabel2');

      const INFO = {
        source: '开发者视角：3 条计算路径，1 个量化共享原语（Prolog-Quant）',
        compiler: '编译器视角：loop_unroll([32,16,8,4,2,1]) 展开为 6 档子图，每档独立优化',
      };

      const COMPACT_OPTS = { compact: true };

      let sourceGraph = null;
      let sourceLayout = null;
      let compiledGraph = null;
      let compiledLayout = null;
      let currentView = 'source'; // 'source' | 'compiler'

      let tx = 0, ty = 0, scale = 1;
      let panning = false, panStart = { x: 0, y: 0 };
      const SCALE_MIN = 0.06, SCALE_MAX = 4;
      let dualMode = false;
      let tbLayout = null;
      let currentLayout = 'horizontal'; // 'horizontal' | 'vertical'
      // TB viewport state
      let tx2 = 0, ty2 = 0, scale2 = 1;
      let panning2 = false, panStart2 = { x: 0, y: 0 };
      let activePanTarget = null; // 1 or 2

      // Source code viewer state
      let sourceCodeText = '';
      let sourceCodeLines = [];
      const sourcePanel = document.getElementById('vtSourcePanel');
      const sourceCodeEl = document.getElementById('vtSourceCode');

      // Fetch source code
      fetch('lightning_indexer_prolog_quant.py')
        .then(r => r.text())
        .then(text => {
          sourceCodeText = text;
          sourceCodeLines = text.split('\n');
        })
        .catch(err => console.error("Could not load python source list:", err));

      document.getElementById('vtCloseSourceBtn').addEventListener('click', () => {
        sourcePanel.style.display = 'none';
      });

      // ── Transform ────────────────────────────────────────────────
      function applyTransform() {
        graphRoot.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
        zoomLabel.textContent = Math.round(scale * 100) + '%';
      }

      function fitView(layoutObj) {
        const target = layoutObj || (currentView === 'compiler' ? compiledLayout : sourceLayout);
        if (!target) return;
        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        const { canvasW, canvasH } = target;
        const pad = 40;
        const s = Math.min((vw - pad * 2) / canvasW, (vh - pad * 2) / canvasH, 1);
        scale = s;
        tx = (vw - canvasW * s) / 2;
        ty = (vh - canvasH * s) / 2;
        applyTransform();
      }

      function applyTransform2() {
        graphRoot2.style.transform = `translate(${tx2}px, ${ty2}px) scale(${scale2})`;
        zoomLabel2.textContent = Math.round(scale2 * 100) + '%';
      }

      function fitView2() {
        if (!tbLayout) return;
        const vw = viewport2.clientWidth;
        const vh = viewport2.clientHeight;
        const { canvasW, canvasH } = tbLayout;
        const pad = 40;
        const s = Math.min((vw - pad * 2) / canvasW, (vh - pad * 2) / canvasH, 1);
        scale2 = s;
        tx2 = (vw - canvasW * s) / 2;
        ty2 = (vh - canvasH * s) / 2;
        applyTransform2();
      }

      function zoom(delta, cx, cy) {
        const prevScale = scale;
        scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale * (1 + delta)));
        const factor = scale / prevScale;
        tx = cx - factor * (cx - tx);
        ty = cy - factor * (cy - ty);
        applyTransform();
      }

      // ── Wheel zoom ───────────────────────────────────────────────
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const delta = e.deltaY < 0 ? 0.12 : -0.12;
        zoom(delta, cx, cy);
      }, { passive: false });

      // ── Pan ──────────────────────────────────────────────────────
      viewport.addEventListener('mousedown', (e) => {
        if (e.target.closest('.node-card') || e.target.closest('.vt-zoom-controls') || e.target.closest('.vt-pipeline-legend')) return;
        panning = true;
        panStart = { x: e.clientX - tx, y: e.clientY - ty };
        viewport.classList.add('panning');
      });

      viewport2.addEventListener('mousedown', (e) => {
        if (e.target.closest('.node-card') || e.target.closest('.vt-zoom-controls')) return;
        panning2 = true;
        panStart2 = { x: e.clientX - tx2, y: e.clientY - ty2 };
        viewport2.classList.add('panning');
      });

      window.addEventListener('mousemove', (e) => {
        if (panning) {
          tx = e.clientX - panStart.x;
          ty = e.clientY - panStart.y;
          applyTransform();
        }
        if (panning2) {
          tx2 = e.clientX - panStart2.x;
          ty2 = e.clientY - panStart2.y;
          applyTransform2();
        }
      });

      window.addEventListener('mouseup', () => {
        panning = false;
        panning2 = false;
        viewport.classList.remove('panning');
        viewport2.classList.remove('panning');
      });

      // ── Zoom buttons ─────────────────────────────────────────────
      document.getElementById('vtZoomIn').addEventListener('click', () => zoom(0.2, viewport.clientWidth / 2, viewport.clientHeight / 2));
      document.getElementById('vtZoomOut').addEventListener('click', () => zoom(-0.2, viewport.clientWidth / 2, viewport.clientHeight / 2));
      document.getElementById('vtFit').addEventListener('click', () => fitView());

      document.getElementById('vtZoomIn2').addEventListener('click', () => zoom2(0.2, viewport2.clientWidth / 2, viewport2.clientHeight / 2));
      document.getElementById('vtZoomOut2').addEventListener('click', () => zoom2(-0.2, viewport2.clientWidth / 2, viewport2.clientHeight / 2));
      document.getElementById('vtFit2').addEventListener('click', () => fitView2());

      viewport2.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = viewport2.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const delta = e.deltaY < 0 ? 0.12 : -0.12;
        zoom2(delta, cx, cy);
      }, { passive: false });

      function zoom2(delta, cx, cy) {
        const prevScale = scale2;
        scale2 = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale2 * (1 + delta)));
        const factor = scale2 / prevScale;
        tx2 = cx - factor * (cx - tx2);
        ty2 = cy - factor * (cy - ty2);
        applyTransform2();
      }

      // ── Node click ───────────────────────────────────────────────
      function handleNodeClick(node, el) {
        nodesLayer.querySelectorAll('.node-card.selected').forEach(n => n.classList.remove('selected'));
        // Clear previous highlights and gradient strokes
        edgesSvg.querySelectorAll('.edge-highlight').forEach(p => {
          p.classList.remove('edge-highlight');
          p.style.stroke = '';
        });
        edgesSvg.querySelectorAll('.edge-grad').forEach(g => g.remove());
        el.classList.add('selected');
        const defs = edgesSvg.querySelector('defs');
        edgesSvg.querySelectorAll(`[data-source="${node.id}"], [data-target="${node.id}"]`)
          .forEach(p => {
            p.classList.add('edge-highlight');
            const srcEl = nodesLayer.querySelector(`[data-node-id="${p.dataset.source}"]`);
            const tgtEl = nodesLayer.querySelector(`[data-node-id="${p.dataset.target}"]`);
            const c1 = srcEl?.style.getPropertyValue('--node-accent') || 'rgba(255,255,255,0.6)';
            const c2 = tgtEl?.style.getPropertyValue('--node-accent') || 'rgba(255,255,255,0.6)';
            const gid = 'eg' + Math.random().toString(36).slice(2, 8);
            const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
            grad.setAttribute('id', gid);
            grad.setAttribute('class', 'edge-grad');
            grad.setAttribute('gradientUnits', 'objectBoundingBox');
            grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0.5');
            grad.setAttribute('x2', '1'); grad.setAttribute('y2', '0.5');
            const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', c1);
            const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', c2);
            grad.append(s1, s2);
            defs.appendChild(grad);
            p.style.stroke = `url(#${gid})`;
          });

        // ── Highlight Source Code ──
        if (sourceCodeLines.length > 0) {
          let searchStr = '';
          if (node.type === 'op') {
            const semKey = getSemanticKey(node);
            const parsed = parsePipelineLabel(semKey);
            if (parsed) {
              searchStr = `set_semantic_label("${parsed.pipeline}-${parsed.stage}")`;
            } else if (node.data && node.data.opcode) {
              searchStr = `pypto.${node.data.opcode.toLowerCase()}(`;
            }
          } else {
            // Tensor or Incast
            const sym = node.data?.symbol || node.label;
            if (sym) searchStr = sym;
          }

          if (searchStr) {
            let foundLineIdx = -1;
            for (let i = 0; i < sourceCodeLines.length; i++) {
              if (sourceCodeLines[i].includes(searchStr)) {
                foundLineIdx = i;
                break;
              }
            }
            if (foundLineIdx !== -1) {
              // Build HTML with styling
              let html = '';
              for (let i = 0; i < sourceCodeLines.length; i++) {
                const lineNum = String(i + 1).padStart(3, ' ');
                const isMatch = i === foundLineIdx;
                const bg = isMatch ? '#3d5a72' : 'transparent';
                const fw = isMatch ? 'bold' : 'normal';
                html += `<div id="vtSrcline-${i}" style="background:${bg}; font-weight:${fw}; display:flex; padding:0 4px;"><span style="color:#666; width:40px; display:inline-block; user-select:none;">${lineNum} |</span> <span style="white-space:pre;">${sourceCodeLines[i]}</span></div>`;
              }
              sourceCodeEl.innerHTML = html;
              sourcePanel.style.display = 'flex';

              // Scroll to line
              setTimeout(() => {
                const targetLineEl = document.getElementById(`vtSrcline-${foundLineIdx}`);
                if (targetLineEl) {
                  sourceCodeEl.parentElement.scrollTop = Math.max(0, targetLineEl.offsetTop - 100);
                }
              }, 50);
            }
          }
        }
      }

      // ── Semantic color map ────────────────────────────────────────
      function buildSemanticColorMap(nodes, edges) {
        const pipelineMap = buildPipelineSemanticColorMap(nodes);
        const map = new Map();
        const BOUNDARY_COLORS = { incast: '#606060', outcast: '#606060' };
        nodes.forEach(n => {
          if (BOUNDARY_COLORS[n.type]) {
            map.set(n.id, BOUNDARY_COLORS[n.type]);
          } else if (n.type === 'tensor') {
            map.set(n.id, '#606060');
          } else if (n.type === 'op') {
            const c = pipelineMap.get(n.id);
            if (c && c !== '#666666') {
              map.set(n.id, c);
            } else {
              const cat = OPCODE_CATEGORY[(n.data?.opcode || '').toUpperCase()];
              const CAT_FALLBACK = { MEMORY: '#3c7eab', CAST: '#6a6aaa' };
              map.set(n.id, CAT_FALLBACK[cat] ?? '#666666');
            }
          }
        });
        if (edges) fixPrologColors(map, nodes, edges);
        return map;
      }

      // ── Compiler color map (flat teal/violet palette) ─────────────
      function buildCompilerColorMap(nodes) {
        const map = new Map();
        nodes.forEach(n => {
          if (n.type === 'incast' || n.type === 'outcast') map.set(n.id, '#606060');
          else if (n.type === 'tensor') map.set(n.id, '#3d5a72');
          else if (n.type === 'op') map.set(n.id, '#5b3fa6');
        });
        return map;
      }

      // ── Graph Diff ────────────────────────────────────────────────
      // Match source ops by semantic_label; match tensors by symbol.
      // Returns: Map<nodeId, 'added'|'removed'|'preserved'>
      function computeGraphDiff(srcGraph, cmpGraph) {
        const diff = new Map();

        // Collect source op semantic labels and tensor symbols
        const srcOpLabels = new Set();
        const srcTensorSym = new Set();
        for (const n of srcGraph.nodes) {
          if (n.type === 'op') {
            const lbl = n.data.semanticLabel || n.data.opcode || n.label;
            if (lbl) srcOpLabels.add(lbl);
          } else if (n.type === 'tensor' || n.type === 'incast' || n.type === 'outcast') {
            const sym = n.data.symbol || n.label;
            if (sym) srcTensorSym.add(sym);
          }
        }

        // Collect compiled op labels and tensor symbols
        const cmpOpLabels = new Set();
        const cmpTensorSym = new Set();
        for (const n of cmpGraph.nodes) {
          if (n.type === 'op') {
            const lbl = n.data.semanticLabel || n.data.opcode || n.label;
            if (lbl) cmpOpLabels.add(lbl);
          } else {
            const sym = n.data.symbol || n.label;
            if (sym) cmpTensorSym.add(sym);
          }
        }

        // Tag source nodes
        for (const n of srcGraph.nodes) {
          if (n.type === 'op') {
            const lbl = n.data.semanticLabel || n.data.opcode || n.label;
            diff.set(n.id, cmpOpLabels.has(lbl) ? 'preserved' : 'removed');
          } else {
            const sym = n.data.symbol || n.label;
            diff.set(n.id, cmpTensorSym.has(sym) ? 'preserved' : 'removed');
          }
        }

        // Tag compiled nodes
        for (const n of cmpGraph.nodes) {
          if (n.type === 'op') {
            const lbl = n.data.semanticLabel || n.data.opcode || n.label;
            diff.set(n.id, srcOpLabels.has(lbl) ? 'preserved' : 'added');
          } else {
            const sym = n.data.symbol || n.label;
            diff.set(n.id, srcTensorSym.has(sym) ? 'preserved' : 'added');
          }
        }

        return diff;
      }

      function applyDiffClasses(diff) {
        nodesLayer.querySelectorAll('[data-node-id]').forEach(el => {
          const id = el.dataset.nodeId;
          el.classList.remove('node-added', 'node-removed', 'node-preserved');
          if (diff && diff.has(id)) {
            el.classList.add('node-' + diff.get(id));
          }
        });
      }

      function renderWithTransition(graph, layout, colorMap, diffMap, onReady) {
        // Fade out
        graphRoot.classList.add('fading-out');

        setTimeout(() => {
          // Clear
          nodesLayer.innerHTML = '';
          edgesSvg.innerHTML = `<defs>
        <marker id="arrow-default" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.15)"/>
        </marker>
        <marker id="arrow-incast" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="var(--incast-accent)"/>
        </marker>
        <marker id="arrow-op" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="var(--op-accent)"/>
        </marker>
        <marker id="arrow-outcast" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="var(--outcast-accent)"/>
        </marker>
      </defs>`;

          renderGraph(graph, layout, nodesLayer, edgesSvg, handleNodeClick, colorMap, 'semantic', COMPACT_OPTS);

          // Apply diff classes after render
          if (diffMap) {
            applyDiffClasses(diffMap);
          }

          // Fade in
          graphRoot.classList.remove('fading-out');
          // Force reflow then animate in
          graphRoot.style.opacity = '0';
          graphRoot.style.transform = `translate(${tx}px, ${ty}px) scale(${scale * 0.97})`;
          requestAnimationFrame(() => {
            graphRoot.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            graphRoot.style.opacity = '1';
            graphRoot.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
            setTimeout(() => {
              graphRoot.style.transition = '';
              if (onReady) onReady();
            }, 320);
          });
        }, 210);
      }

      // ── Switch to Source View ─────────────────────────────────────
      function switchToSource() {
        if (currentView === 'source') return;
        currentView = 'source';
        btnSource.classList.add('active');
        btnCompiler.classList.remove('active');
        compilerBar.classList.remove('visible');
        vtTitle.textContent = 'Source Graph';
        infoText.textContent = INFO.source;

        const colorMap = buildSemanticColorMap(sourceGraph.nodes, sourceGraph.edges);
        renderWithTransition(sourceGraph, sourceLayout, colorMap, null, () => {
          fitView(sourceLayout);
          const m = sourceGraph.meta;
          statsEl.textContent = `${m.totalNodes} nodes · ${m.totalEdges} edges · ${m.incastCount} in · ${m.outcastCount} out`;
          legend.style.display = 'flex';
        });
      }

      // ── Switch to Compiler View ───────────────────────────────────
      function switchToCompiler() {
        if (currentView === 'compiler') return;
        if (!compiledGraph) {
          // Show compiler bar first so user sees the Load button, then prompt
          btnCompiler.classList.add('active');
          btnSource.classList.remove('active');
          compilerBar.classList.add('visible');
          fileInput.click();
          // Revert button state if user cancels — handled by fileInput change
          fileInput.addEventListener('cancel', () => {
            btnCompiler.classList.remove('active');
            btnSource.classList.add('active');
            compilerBar.classList.remove('visible');
          }, { once: true });
          return;
        }
        currentView = 'compiler';
        btnSource.classList.remove('active');
        btnCompiler.classList.add('active');
        compilerBar.classList.add('visible');
        vtTitle.textContent = 'Compiler Graph';
        infoText.textContent = INFO.compiler;
        legend.style.display = 'none';

        const colorMap = buildCompilerColorMap(compiledGraph.nodes);
        const diffMap = computeGraphDiff(sourceGraph, compiledGraph);

        // Count diff
        let added = 0, removed = 0, preserved = 0;
        for (const v of diffMap.values()) {
          if (v === 'added') added++;
          else if (v === 'removed') removed++;
          else preserved++;
        }
        diffAdded.textContent = `+${added} added`;
        diffRemoved.textContent = `-${removed} removed`;
        diffSame.textContent = `${preserved} preserved`;
        diffStats.style.display = 'flex';

        const srcN = sourceGraph.meta.totalNodes;
        const cmpN = compiledGraph.meta.totalNodes;
        statsEl.textContent = `Source: ${srcN} → Compiled: ${cmpN} nodes`;

        renderWithTransition(compiledGraph, compiledLayout, colorMap, diffMap, () => {
          fitView(compiledLayout);
        });
      }

      // ── File loader ───────────────────────────────────────────────
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const loadLabel = document.getElementById('vtLoadLabel');
        loadLabel.style.opacity = '0.5';
        loadLabel.style.pointerEvents = 'none';

        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            compiledGraph = parseGraph(data);
            compiledLayout = pipelineAwareLayout(compiledGraph, computeLayout(compiledGraph, COMPACT_OPTS), COMPACT_OPTS);

            loadLabel.textContent = file.name.replace(/_/g, '_\u200b'); // allow soft break
            loadLabel.style.opacity = '';
            loadLabel.style.pointerEvents = '';

            // Auto-switch to compiler view
            currentView = 'source'; // reset so switchToCompiler proceeds
            switchToCompiler();
          } catch (err) {
            loadLabel.style.opacity = '';
            loadLabel.style.pointerEvents = '';
            alert('Failed to parse JSON: ' + err.message);
            console.error(err);
          }
        };
        reader.readAsText(file);
        // reset so same file can be reloaded
        fileInput.value = '';
      });

      // ── Layout toggle handlers ─────────────────────────────────────
      function switchToHorizontalLayout() {
        if (currentLayout === 'horizontal') return;
        currentLayout = 'horizontal';
        btnHorizontal.classList.add('active');
        btnVertical.classList.remove('active');
        canvasArea.classList.remove('vertical-layout');
        // 重新适应视图
        fitView(currentView === 'compiler' ? compiledLayout : sourceLayout);
      }

      function switchToVerticalLayout() {
        if (currentLayout === 'vertical') return;
        currentLayout = 'vertical';
        btnHorizontal.classList.remove('active');
        btnVertical.classList.add('active');
        canvasArea.classList.add('vertical-layout');
        // 重新适应视图
        fitView(currentView === 'compiler' ? compiledLayout : sourceLayout);
      }

      // ── Tab button handlers ───────────────────────────────────────
      btnSource.addEventListener('click', switchToSource);
      btnCompiler.addEventListener('click', switchToCompiler);
      btnHorizontal.addEventListener('click', switchToHorizontalLayout);
      btnVertical.addEventListener('click', switchToVerticalLayout);

      btnDual.addEventListener('click', () => {
        dualMode = !dualMode;
        if (dualMode) {
          btnDual.classList.add('active');
          canvasArea.style.flexDirection = 'row';
          viewport.style.borderRight = '1px solid var(--border-color)';
          viewport.style.flex = '1';
          viewport2.style.display = 'block';

          // Ensure source is loaded
          const graph = currentView === 'compiler' ? compiledGraph : sourceGraph;
          if (!graph) return;

          // Compute TB Layout if we haven't already
          if (!tbLayout) {
            tbLayout = computeLayout(graph, { direction: 'TB', compact: true });

            const colorMap = currentView === 'compiler'
              ? buildCompilerColorMap(graph.nodes)
              : buildSemanticColorMap(graph.nodes, graph.edges);

            // diff map only makes sense if compiler
            let diffMap = null;
            if (currentView === 'compiler' && sourceGraph) {
              diffMap = computeGraphDiff(sourceGraph, graph);
            }

            renderGraph(graph, tbLayout, nodesLayer2, edgesSvg2, (n, el) => handleNodeClick(n, el), colorMap, 'semantic', { compact: true });

            if (diffMap) {
              nodesLayer2.querySelectorAll('[data-node-id]').forEach(el => {
                const id = el.dataset.nodeId;
                if (diffMap.has(id)) el.classList.add('node-' + diffMap.get(id));
              });
            }
          }

          fitView(currentView === 'compiler' ? compiledLayout : sourceLayout);
          setTimeout(() => fitView2(), 50);

        } else {
          btnDual.classList.remove('active');
          canvasArea.style.flexDirection = 'column';
          viewport.style.borderRight = 'none';
          viewport2.style.display = 'none';
          fitView(currentView === 'compiler' ? compiledLayout : sourceLayout);
        }
      });

      // ── Initial load: Source Graph ────────────────────────────────
      fetch('data/source-graph.json')
        .then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(data => {
          sourceGraph = parseGraph(data);
          sourceLayout = pipelineAwareLayout(sourceGraph, computeLayout(sourceGraph, COMPACT_OPTS), COMPACT_OPTS);

          const colorMap = buildSemanticColorMap(sourceGraph.nodes, sourceGraph.edges);
          renderGraph(sourceGraph, sourceLayout, nodesLayer, edgesSvg, handleNodeClick, colorMap, 'semantic', COMPACT_OPTS);

          loading.style.display = 'none';
          legend.style.display = 'flex';

          const m = sourceGraph.meta;
          statsEl.textContent = `${m.totalNodes} nodes · ${m.totalEdges} edges · ${m.incastCount} in · ${m.outcastCount} out`;

          fitView(sourceLayout);
        })
        .catch(err => {
          loading.innerHTML = `<span style="color:#e05a5a">Failed to load graph: ${err.message}</span>`;
          console.error(err);
        });

      function pipelineAwareLayout(graph, layoutResult, options = {}) {
        const { positions, layerNodes } = layoutResult;
        const { nodes, edges } = graph;
        const compact = !!options.compact;
        const laneH = compact ? 220 : 440;

        const pred = new Map(nodes.map(n => [n.id, []]));
        const succ = new Map(nodes.map(n => [n.id, []]));
        for (const e of edges) {
          pred.get(e.target)?.push(e.source);
          succ.get(e.source)?.push(e.target);
        }

        const PIPELINE_ORDER = ['Key', 'Query', 'Weight'];
        const nodePipeline = new Map();

        for (const n of nodes) {
          if (n.type !== 'op') continue;
          const parsed = parsePipelineLabel(getSemanticKey(n));
          if (parsed && parsed.pipeline !== 'Prolog') nodePipeline.set(n.id, parsed.pipeline);
        }

        for (const n of nodes) {
          if (n.type !== 'op' || nodePipeline.has(n.id)) continue;
          const parsed = parsePipelineLabel(getSemanticKey(n));
          if (parsed?.pipeline === 'Prolog') {
            const visited = new Set([n.id]);
            const queue = [...(succ.get(n.id) || [])];
            let found = null;
            while (queue.length && !found) {
              const id = queue.shift();
              if (visited.has(id)) continue;
              visited.add(id);
              if (nodePipeline.has(id)) { found = nodePipeline.get(id); break; }
              queue.push(...(succ.get(id) || []));
            }
            if (found) nodePipeline.set(n.id, found);
          }
        }

        const activePipelines = PIPELINE_ORDER.filter(p => [...nodePipeline.values()].includes(p));
        const pipelineLaneY = new Map(activePipelines.map((p, i) => [p, PAD + i * laneH]));

        const newY = new Map();
        for (const n of nodes) {
          if (n.type !== 'op') continue;
          const lane = nodePipeline.get(n.id);
          if (lane) {
            newY.set(n.id, pipelineLaneY.get(lane));
          }
        }

        function collectOpYs(nodeId) {
          const node = nodes.find(n => n.id === nodeId);
          if (!node) return [];

          // 对于RESHAPE等MEMORY操作，需要找到它的目标pipeline
          if (node.type === 'op' && getSemanticKey(node) === 'cat:MEMORY') {
            const visited = new Set([nodeId]);
            const queue = [...(succ.get(nodeId) || [])];
            let targetLane = null;

            while (queue.length > 0 && !targetLane) {
              const id = queue.shift();
              if (visited.has(id)) continue;
              visited.add(id);

              if (nodePipeline.has(id)) {
                targetLane = nodePipeline.get(id);
                break;
              }
              queue.push(...(succ.get(id) || []));
            }

            if (targetLane && pipelineLaneY.has(targetLane)) {
              return [pipelineLaneY.get(targetLane)];
            }
          }

          // 默认策略：优先下游操作，然后上游操作
          // Priority 1: direct successor ops (bias downstream)
          const succYs = (succ.get(nodeId) || []).filter(id => newY.has(id)).map(id => newY.get(id));
          if (succYs.length) return succYs;

          // Priority 2: direct predecessor ops
          const predYs = (pred.get(nodeId) || []).filter(id => newY.has(id)).map(id => newY.get(id));
          if (predYs.length) return predYs;

          // Priority 3: 2-hop BFS
          const ys = [];
          const neighbors = [...(succ.get(nodeId) || []), ...(pred.get(nodeId) || [])];
          for (const nb of neighbors) {
            for (const n2 of [...(succ.get(nb) || []), ...(pred.get(nb) || [])]) {
              if (newY.has(n2)) ys.push(newY.get(n2));
            }
          }
          return ys;
        }

        // 为所有非op节点计算Y坐标
        for (const n of nodes) {
          if (n.type === 'op') continue;
          const ys = collectOpYs(n.id);
          if (ys.length > 0) {
            // 使用平均值，但偏向于最小值（更靠近顶部）
            const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
            const minY = Math.min(...ys);
            // 偏向最小值，但不要过于极端
            newY.set(n.id, Math.min(avgY, minY + 20));
          } else {
            newY.set(n.id, positions.get(n.id)?.y ?? PAD);
          }
        }

        // Refined collision resolution:
        // Instead of forcing everything down by cursor, we respect the calculated newY.
        // We only nudge nodes down if they literally overlap, and we try to keep pipeline nodes 
        // exactly on their lane if possible.
        // Refined collision resolution:
        // Separate layer nodes into "Strict" (pipeline specific ops or MEMORY ops specifically aligned)
        // and "Flexible" (tensors, outcast, or miscellaneous ops).
        for (const ids of layerNodes) {
          const strictNodes = [];
          const flexNodes = [];

          for (const id of ids) {
            const node = nodes.find(n => n.id === id);
            const isPipeline = nodePipeline.has(id);
            const isMemory = node?.type === 'op' && getSemanticKey(node) === 'cat:MEMORY';
            if (isPipeline || isMemory) {
              strictNodes.push(id);
            } else {
              flexNodes.push(id);
            }
          }

          strictNodes.sort((a, b) => (newY.get(a) ?? 0) - (newY.get(b) ?? 0));
          flexNodes.sort((a, b) => (newY.get(a) ?? 0) - (newY.get(b) ?? 0));

          const occupiedBlocks = [];

          // 1. Lock strict nodes 
          for (const id of strictNodes) {
            const h = positions.get(id)?.h ?? 44;
            let y = newY.get(id) ?? PAD;

            // Prevent strict nodes from overlapping each other by nudging slightly if needed
            for (const block of occupiedBlocks) {
              if (y < block.end && y + h > block.start) {
                y = block.end + 8;
              }
            }

            newY.set(id, y);
            occupiedBlocks.push({ start: y, end: y + h, id });
            occupiedBlocks.sort((a, b) => a.start - b.start);
          }

          // 2. Flow flex nodes around strict nodes
          for (const id of flexNodes) {
            const h = positions.get(id)?.h ?? 44;
            let y = newY.get(id) ?? PAD;

            // Push y down until it clears all occupied blocks
            let conflict = true;
            while (conflict) {
              conflict = false;
              for (const block of occupiedBlocks) {
                // overlap check
                if (y < block.end && y + h > block.start) {
                  y = block.end + 8;
                  conflict = true;
                  break;
                }
              }
            }

            newY.set(id, y);
            occupiedBlocks.push({ start: y, end: y + h, id });
            occupiedBlocks.sort((a, b) => a.start - b.start);
          }
        }

        const newPositions = new Map(positions);
        for (const [id, y] of newY) {
          const pos = newPositions.get(id);
          if (pos) newPositions.set(id, { ...pos, y });
        }
        const maxBottom = Math.max(...[...newPositions.values()].map(p => p.y + p.h));
        return { ...layoutResult, positions: newPositions, canvasH: maxBottom + PAD };
      }

    })();

# H-Anchor: Hierarchical Anchor-Based Placement Algorithm

A high-performance placement algorithm inspired by **HNSW (Hierarchical Navigable Small World)** graphs. Features a **C++ core with OpenMP parallelization** achieving ~38x speedup over pure Python.

## 🚀 Performance

| Version | Speed | Throughput |
|---------|-------|------------|
| Pure Python | 42s | 79 cells/sec |
| C++ (single-thread) | 3.0s | 1,084 cells/sec |
| **C++ (multi-core)** | **1.1s** | **2,907 cells/sec** |

### Incremental Update Performance

| Operation | Time | Speedup |
|-----------|------|---------|
| Full Placement (3300 cells) | ~1.1s | baseline |
| **Incremental Update (5 cells)** | **~0.02s** | **50-100x faster** |

✅ **Deterministic**: Multiple runs produce identical results
✅ **Incremental Updates**: Fast local refinement without full re-placement

## 🎯 Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Build C++ extension (requires pybind11)
pip install pybind11
python setup.py build_ext --inplace

# For OpenMP support on macOS:
brew install libomp

# Run synthetic benchmark (no external data needed!)
python run_real_benchmark.py large_cpu
```

### Output
- `output/large_cpu_hierarchy.png` - Layer structure visualization
- `output/large_cpu_placement.png` - Final placement
- `output/large_cpu_modules.png` - Module clustering view
- `output/large_cpu_detailed.png` - Detailed layer view
- `output/large_cpu_placement_comparison.png` - Original vs updated comparison (from `test_incremental_update.py`)

## 📁 Project Structure

```
PycPlacer/
├── src/
│   ├── h_anchor_core.hpp    # C++ header
│   ├── h_anchor_core.cpp    # C++ implementation (OpenMP parallelized)
│   └── bindings.cpp         # pybind11 Python bindings
├── h_anchor_fast.py         # Python wrapper for C++ backend
├── visualization.py         # Placement visualization tools
├── benchmarks.py            # Synthetic benchmark generators
├── run_real_benchmark.py    # Main runner script
├── test_incremental_update.py  # Incremental update comparison test
├── setup.py                 # Build configuration
└── requirements.txt         # Python dependencies
```

## 🔧 Algorithm Overview

```
Layer L_top:  ●───────────────●───────────────●  (Global Anchors)
                   ╲         ╱ ╲         ╱
Layer L_mid:  ●─────●───────●───●───────●─────●  (Local Anchors)  
                ╲ ╱   ╲   ╱       ╲   ╱   ╲ ╱
Layer L_0:    ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●  (All Cells)
```

### Phases
1. **Hierarchy Construction**: Score-based selection with spatial inhibition
2. **Top-Down Placement**: Force-directed with variable node masses
3. **Legalization**: Tetris-style row assignment

## ⚙️ Configuration

```python
from h_anchor_fast import HAnchorPlacer, PlacementConfig

config = PlacementConfig(
    # Hierarchy
    num_layers=5,
    top_layer_size=100,
    decimation_factor=0.25,
    
    # Force-directed
    repulsion_strength=2.0,
    attraction_strength=0.1,
    overlap_repulsion=5.0,    # Prevent cell overlap
    min_spacing=8.0,          # Minimum cell distance
    
    # Layout control
    spread_factor=0.6,        # Initial distribution range (0-1)
    global_attraction=0.02,   # Pull clusters together
    center_gravity=0.01,      # Center pull
    
    # Die area
    die_width=1000.0,
    die_height=1000.0,
)

placer = HAnchorPlacer(config)
placer.load_netlist(graph, cells)
placer.run()

print(f"HPWL: {placer.compute_wirelength()}")
```

## 📊 Benchmarks

### Synthetic (included, no external data needed)
| Benchmark | Description |
|-----------|-------------|
| `large_cpu` | 3,300 cells, 10 modules (ALU, RegFile, etc.) |
| `random` | Erdős–Rényi random graph |
| `clustered` | Hierarchical blocks |
| `mesh` | 2D grid topology |

```bash
python run_real_benchmark.py large_cpu
```

### Real Benchmarks (optional)

Use the benchmark installer to download standard circuits:

```bash
# List available benchmark suites
python install_benchmarks.py --list

# Install specific suite
python install_benchmarks.py iscas89

# Install all benchmarks (~100MB)
python install_benchmarks.py all

# Run real benchmark
python run_real_benchmark.py iscas89/s38417
```

Available suites:
- **ISCAS85**: 10 combinational circuits
- **ISCAS89**: 31 sequential circuits (includes s38417 ★)
- **EPFL**: Arithmetic + random control benchmarks
- **ITC99**: Large sequential circuits
- **MCNC**: Classic combinational circuits

## 🔄 Incremental Updates

H-Anchor supports fast incremental updates when only a few cells need to be moved. This is **50-100x faster** than full re-placement.

```python
from h_anchor_fast import HAnchorPlacer, PlacementConfig

# Initial placement
placer = HAnchorPlacer(config)
placer.load_netlist(graph, cells)
placer.run()

# Move specific cells (much faster than re-running full placement)
new_positions = {
    'cell_123': (500, 300),
    'cell_456': (600, 400)
}
placer.update_positions(new_positions, propagation_radius=2)

# Also supports adding/removing nodes and edges
placer.add_nodes(new_cells, new_edges)
placer.remove_nodes(['cell_789'])
placer.add_edges([('cell_a', 'cell_b', 1.0)])
```

### Test Incremental Updates

```bash
# Run comparison test: original vs updated placement
python test_incremental_update.py
```

This generates comparison visualizations showing:
- **Original placement** (left)
- **Updated placement** (right)
- **Highlighted changes** (different colors for moved cells)
- **Runtime statistics** (speedup comparison)
- **HPWL impact** (wirelength change)

Output files:
- `output/large_cpu_placement_comparison.png`
- `output/clustered_placement_comparison.png`

## 🎨 Visualization

```python
from visualization import PlacementVisualizer, plot_placement_comparison

viz = PlacementVisualizer(placer)
viz.plot_hierarchy_layers()       # Layer structure
viz.plot_placement()              # Final placement
viz.plot_module_view()            # Module clustering
viz.plot_detailed_zoom()          # Detailed view
viz.plot_wirelength_distribution()

# Compare original vs updated placement
plot_placement_comparison(
    original_positions, 
    updated_positions,
    changed_nodes={'cell_123', 'cell_456'},
    graph=graph,
    original_time=1.0,
    update_time=0.02,
    save_path='comparison.png'
)
```

## 🔑 Key Features

- **C++ Core**: OpenMP parallelized force computation
- **Deterministic**: `schedule(static)` ensures reproducible results
- **Module Awareness**: Visualize hierarchical module boundaries
- **Flexible Forces**: Configurable repulsion, attraction, overlap prevention
- **Global Optimization**: `spread_factor` and `global_attraction` for layout control

## 📝 License

MIT License

## 🙏 Acknowledgments

Inspired by:
- HNSW: Hierarchical Navigable Small World graphs
- Force-directed graph drawing (Fruchterman-Reingold)
- Multilevel placement algorithms

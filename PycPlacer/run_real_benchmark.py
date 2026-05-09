#!/usr/bin/env python3
"""
Run H-Anchor placement on real circuit benchmarks from EPFL.

Available benchmarks include:
- Arithmetic: adder, multiplier, divider, sqrt, log2, sin, etc.
- Random/Control: i2c, mem_ctrl, arbiter, voter, router, etc.
- large_cpu: Synthetic large CPU design with multiple modules
"""

import sys
import os
import time
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for saving to files

from h_anchor_fast import HAnchorPlacer, PlacementConfig, ScoringMethod
from blif_parser import load_blif_benchmark, get_available_benchmarks, print_netlist_stats
from benchmarks import generate_large_cpu_design
from visualization import PlacementVisualizer

# Output directory for PNG files
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")


def list_benchmarks():
    """Print available benchmarks."""
    benchmarks = get_available_benchmarks()
    
    if not benchmarks:
        print("No benchmarks found!")
        print("Make sure to run the download script first.")
        return
    
    print("\n" + "="*70)
    print("  Available Circuit Benchmarks")
    print("="*70)
    
    # Group by category
    categories = {
        'epfl/arithmetic': [],
        'epfl/random_control': [],
        'iscas89': [],
        'lgsynth91': [],
        'mcnc': [],
    }
    
    for name, path in sorted(benchmarks.items()):
        size = os.path.getsize(path)
        size_kb = size / 1024
        
        for cat in categories:
            if name.startswith(cat):
                categories[cat].append((name, size_kb))
                break
    
    # EPFL
    if categories['epfl/arithmetic'] or categories['epfl/random_control']:
        print("\n  ═══ EPFL Benchmarks (Combinational) ═══")
        
        if categories['epfl/arithmetic']:
            print("\n  Arithmetic Circuits:")
            for name, size in sorted(categories['epfl/arithmetic'], key=lambda x: x[1]):
                print(f"    {name:<40} ({size:>7.1f} KB)")
        
        if categories['epfl/random_control']:
            print("\n  Control Circuits:")
            for name, size in sorted(categories['epfl/random_control'], key=lambda x: x[1]):
                print(f"    {name:<40} ({size:>7.1f} KB)")
    
    # ISCAS89 - CPU-scale sequential circuits
    if categories['iscas89']:
        print("\n  ═══ ISCAS89 Benchmarks (Sequential - CPU Scale!) ═══")
        for name, size in sorted(categories['iscas89'], key=lambda x: x[1]):
            marker = " ★" if size > 100 else ""
            print(f"    {name:<40} ({size:>7.1f} KB){marker}")
    
    # LGSynth91
    if categories['lgsynth91']:
        print("\n  ═══ LGSynth91 Benchmarks ═══")
        for name, size in sorted(categories['lgsynth91'], key=lambda x: x[1])[:15]:
            print(f"    {name:<40} ({size:>7.1f} KB)")
        if len(categories['lgsynth91']) > 15:
            print(f"    ... and {len(categories['lgsynth91']) - 15} more")
    
    # MCNC
    if categories['mcnc']:
        print("\n  ═══ MCNC Benchmarks ═══")
        for name, size in sorted(categories['mcnc'], key=lambda x: x[1])[:10]:
            print(f"    {name:<40} ({size:>7.1f} KB)")
        if len(categories['mcnc']) > 10:
            print(f"    ... and {len(categories['mcnc']) - 10} more")
    
    print("\n  ═══ Synthetic Benchmarks ═══")
    print("    large_cpu                            (Synthetic CPU with module labels)")
    print("      → Generates module view visualization showing module boundaries")
    
    print("\n" + "="*70)
    print("  ★ = Large CPU-scale circuits (recommended for H-Anchor testing)")
    print("")
    print("  Usage: python run_real_benchmark.py <benchmark_name>")
    print("  Example: python run_real_benchmark.py iscas89/s38417")
    print("  Example: python run_real_benchmark.py large_cpu")
    print("="*70 + "\n")


def run_large_cpu():
    """Run H-Anchor placement on synthetic large CPU design with module labels."""
    print(f"\n{'='*60}")
    print(f"  H-Anchor Placement on Large CPU Design")
    print(f"{'='*60}")
    print(f"  Type: Synthetic CPU with multiple modules")
    print(f"{'='*60}\n")
    
    # Generate large CPU design with module labels
    print("Generating large CPU design...")
    start = time.time()
    graph, cells = generate_large_cpu_design(seed=42)
    gen_time = time.time() - start
    print(f"Generated in {gen_time:.2f}s")
    
    num_cells = graph.number_of_nodes()
    num_edges = graph.number_of_edges()
    
    # Count cells per module
    module_counts = {}
    for cell in cells.values():
        mod = cell.module if cell.module else "unknown"
        module_counts[mod] = module_counts.get(mod, 0) + 1
    
    print(f"\n{'='*50}")
    print(f"  Large CPU Design Statistics")
    print(f"{'='*50}")
    print(f"  Total Cells:  {num_cells:,}")
    print(f"  Total Edges:  {num_edges:,}")
    print(f"  Modules:      {len(module_counts)}")
    print(f"\n  Module Breakdown:")
    for mod, count in sorted(module_counts.items(), key=lambda x: -x[1]):
        print(f"    {mod}: {count:,} cells")
    print(f"{'='*50}\n")
    
    # Configure placer for large design
    # Key adjustments:
    # - More layers with smoother progression
    # - Higher repulsion to spread cells out
    # - Lower attraction to avoid clustering
    # - Higher density spreading
    config = PlacementConfig(
        num_layers=8,
        top_layer_size=30,       # Smaller top layer for more layers
        decimation_factor=0.4,   # Smoother layer progression
        die_width=3000,
        die_height=3000,
        top_layer_iterations=300,
        refinement_iterations=100,
        repulsion_strength=3.0,  # Increased repulsion to spread cells
        attraction_strength=0.03, # Reduced attraction to avoid clustering
        overlap_repulsion=5.0,   # Strong overlap prevention
        min_spacing=10.0,        # Minimum spacing between cells
        center_gravity=0.02,     # Gentle center pull
    )
    
    # Run placement
    print("Running H-Anchor placement...")
    placer = HAnchorPlacer(config)
    placer.load_netlist(graph, cells)
    
    start = time.time()
    placer.run()
    place_time = time.time() - start
    
    print(placer.get_placement_stats())
    print(f"\n  Placement time: {place_time:.2f} seconds")
    print(f"  Throughput: {num_cells / place_time:.0f} cells/sec")
    
    # Generate visualizations
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    safe_name = "large_cpu"
    
    print(f"\nGenerating visualizations to {OUTPUT_DIR}/...")
    viz = PlacementVisualizer(placer)
    
    print("[1] Hierarchy layers...")
    viz.plot_hierarchy_layers(save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_hierarchy.png"))
    
    print("[2] Detailed layer view...")
    viz.plot_detailed_zoom(save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_detailed.png"))
    
    print("[3] Final placement...")
    viz.plot_placement(use_legal=False, save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_placement.png"))
    
    print("[4] Module view (colored by module origin)...")
    viz.plot_module_view(use_legal=False, save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_modules.png"))
    
    print(f"\n✓ Visualizations saved to {OUTPUT_DIR}/")
    print(f"  - {safe_name}_hierarchy.png")
    print(f"  - {safe_name}_detailed.png")
    print(f"  - {safe_name}_placement.png")
    print(f"  - {safe_name}_modules.png  ← Module boundary visualization")
    
    return placer


def run_benchmark(benchmark_name: str):
    """Run H-Anchor placement on a specific benchmark and save visualizations."""
    
    # Special case: large_cpu synthetic benchmark
    if benchmark_name == "large_cpu":
        return run_large_cpu()
    
    benchmarks = get_available_benchmarks()
    
    if benchmark_name not in benchmarks:
        # Try partial match
        matches = [b for b in benchmarks if benchmark_name in b]
        if len(matches) == 1:
            benchmark_name = matches[0]
        elif len(matches) > 1:
            print(f"Ambiguous benchmark name. Matches: {matches}")
            return
        else:
            print(f"Benchmark '{benchmark_name}' not found.")
            print("Available benchmarks:")
            for b in sorted(benchmarks.keys()):
                print(f"  {b}")
            print("  large_cpu  (synthetic CPU with module labels)")
            return
    
    filepath = benchmarks[benchmark_name]
    
    print(f"\n{'='*60}")
    print(f"  H-Anchor Placement on Real Circuit Benchmark")
    print(f"{'='*60}")
    print(f"  Benchmark: {benchmark_name}")
    print(f"  File: {filepath}")
    print(f"{'='*60}\n")
    
    # Load and parse the BLIF file
    print("Loading BLIF netlist...")
    start = time.time()
    graph, cells, netlist = load_blif_benchmark(filepath)
    load_time = time.time() - start
    print(f"Loaded in {load_time:.2f}s")
    
    print_netlist_stats(netlist, graph)
    
    # Configure placer based on circuit size
    num_cells = graph.number_of_nodes()
    
    if num_cells < 500:
        config = PlacementConfig(
            num_layers=4,
            top_layer_size=30,
            decimation_factor=0.3,
            die_width=500,
            die_height=500,
        )
    elif num_cells < 5000:
        config = PlacementConfig(
            num_layers=5,
            top_layer_size=50,
            decimation_factor=0.25,
            die_width=1000,
            die_height=1000,
        )
    elif num_cells < 20000:
        config = PlacementConfig(
            num_layers=6,
            top_layer_size=100,
            decimation_factor=0.2,
            die_width=2000,
            die_height=2000,
            top_layer_iterations=150,
            refinement_iterations=50,
            overlap_repulsion=5.0,     # Overlap prevention
            min_spacing=8.0,           # Minimum spacing
            center_gravity=0.02,       # Gentle center pull
        )
    else:
        # Large circuits
        config = PlacementConfig(
            num_layers=7,
            top_layer_size=200,
            decimation_factor=0.15,
            die_width=4000,
            die_height=4000,
            top_layer_iterations=100,
            refinement_iterations=30,
            overlap_repulsion=5.0,     # Overlap prevention
            min_spacing=10.0,          # Minimum spacing
            center_gravity=0.03,       # Center pull to prevent edge collapse
        )
    
    # Run placement
    print("\nRunning H-Anchor placement...")
    placer = HAnchorPlacer(config)
    placer.load_netlist(graph, cells)
    
    start = time.time()
    placer.run()
    place_time = time.time() - start
    
    print(placer.get_placement_stats())
    print(f"\n  Placement time: {place_time:.2f} seconds")
    print(f"  Throughput: {num_cells / place_time:.0f} cells/sec")
    
    # Always generate visualizations and save to output folder
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Create safe filename from benchmark name
    safe_name = benchmark_name.replace("/", "_").replace("\\", "_")
    
    print(f"\nGenerating visualizations to {OUTPUT_DIR}/...")
    viz = PlacementVisualizer(placer)
    
    print("[1] Hierarchy layers...")
    viz.plot_hierarchy_layers(save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_hierarchy.png"))
    
    print("[2] Detailed layer view...")
    viz.plot_detailed_zoom(save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_detailed.png"))
    
    print("[3] Final placement...")
    viz.plot_placement(use_legal=True, save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_placement.png"))
    
    print("[4] Wirelength distribution...")
    viz.plot_wirelength_distribution(save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_wirelength.png"))
    
    # Check if cells have module labels for module view
    has_modules = any(hasattr(c, 'module') and c.module for c in cells.values())
    if has_modules:
        print("[5] Module view (colored by module origin)...")
        viz.plot_module_view(use_legal=True, save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_modules.png"))
    
    print(f"\n✓ Visualizations saved to {OUTPUT_DIR}/")
    print(f"  - {safe_name}_hierarchy.png")
    print(f"  - {safe_name}_detailed.png")
    print(f"  - {safe_name}_placement.png")
    print(f"  - {safe_name}_wirelength.png")
    if has_modules:
        print(f"  - {safe_name}_modules.png  ← Module boundary visualization")
    
    return placer


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        list_benchmarks()
        return
    
    benchmark_name = sys.argv[1]
    
    if benchmark_name in ("-h", "--help", "help"):
        list_benchmarks()
        return
    
    if benchmark_name in ("-l", "--list", "list"):
        list_benchmarks()
        return
    
    run_benchmark(benchmark_name)


if __name__ == "__main__":
    main()


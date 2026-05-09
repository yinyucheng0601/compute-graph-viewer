#!/usr/bin/env python3
"""
H-Anchor: Hierarchical Anchor-Based Placement Algorithm
Example Usage and Demonstration

This script demonstrates the H-Anchor algorithm on various
synthetic benchmarks, showing how the HNSW-inspired hierarchical
approach handles different circuit topologies.
"""

import sys
import time
from h_anchor_fast import HAnchorPlacer, PlacementConfig, ScoringMethod
from benchmarks import (
    generate_random_netlist,
    generate_clustered_netlist,
    generate_mesh_netlist,
    generate_datapath_netlist,
    generate_heterogeneous_netlist,
    generate_small_world_netlist,
)
from visualization import PlacementVisualizer, visualize_placement


def run_placement(name: str, graph, cells, config=None):
    """Run H-Anchor placement on a netlist and print results."""
    print("\n" + "=" * 60)
    print(f"  {name}")
    print("=" * 60)
    print(f"  Cells: {len(cells):,}")
    print(f"  Edges: {graph.number_of_edges():,}")
    print("=" * 60)
    
    if config is None:
        config = PlacementConfig(
            num_layers=5,
            top_layer_size=50,
            die_width=1000,
            die_height=1000,
        )
    
    placer = HAnchorPlacer(config)
    placer.load_netlist(graph, cells)
    
    start_time = time.time()
    placer.run()
    elapsed = time.time() - start_time
    
    print(placer.get_placement_stats())
    print(f"\n  Total time: {elapsed:.2f} seconds")
    
    return placer


def example_random():
    """Example: Random netlist."""
    graph, cells = generate_random_netlist(
        num_cells=1000,
        num_edges=3000,
        seed=42
    )
    return run_placement("Random Netlist (1K cells)", graph, cells)


def example_clustered():
    """Example: Clustered/hierarchical netlist."""
    graph, cells = generate_clustered_netlist(
        num_clusters=8,
        cells_per_cluster=125,
        intra_cluster_density=0.2,
        inter_cluster_density=0.005,
        seed=42
    )
    return run_placement("Clustered Netlist (8 blocks × 125 cells)", graph, cells)


def example_mesh():
    """Example: Mesh topology."""
    graph, cells = generate_mesh_netlist(
        rows=32,
        cols=32,
        diagonal_connections=True,
        seed=42
    )
    return run_placement("Mesh Topology (32×32)", graph, cells)


def example_datapath():
    """Example: Datapath-like structure."""
    graph, cells = generate_datapath_netlist(
        num_stages=16,
        width=64,
        feedback_ratio=0.05,
        seed=42
    )
    return run_placement("Datapath (16 stages × 64 bits)", graph, cells)


def example_heterogeneous():
    """Example: Heterogeneous FPGA-like netlist."""
    graph, cells = generate_heterogeneous_netlist(
        num_standard_cells=800,
        num_rams=20,
        num_dsps=30,
        num_ios=100,
        seed=42
    )
    
    # For heterogeneous designs, use PageRank to identify important blocks
    config = PlacementConfig(
        num_layers=5,
        top_layer_size=50,
        scoring_method=ScoringMethod.PAGERANK,
        die_width=1000,
        die_height=1000,
    )
    
    return run_placement("Heterogeneous FPGA (RAMs, DSPs, IOs)", graph, cells, config)


def example_small_world():
    """Example: Small-world network."""
    graph, cells = generate_small_world_netlist(
        num_cells=1000,
        k=6,
        p=0.1,
        seed=42
    )
    return run_placement("Small-World Network (1K cells)", graph, cells)


def example_large_scale():
    """Example: Larger scale placement."""
    print("\nGenerating large-scale netlist (10K cells)...")
    graph, cells = generate_random_netlist(
        num_cells=10000,
        num_edges=40000,
        seed=42
    )
    
    config = PlacementConfig(
        num_layers=6,
        top_layer_size=100,
        decimation_factor=0.2,
        top_layer_iterations=300,
        refinement_iterations=30,
        die_width=3000,
        die_height=3000,
    )
    
    return run_placement("Large-Scale (10K cells, 40K edges)", graph, cells, config)


def demo_visualization(placer: HAnchorPlacer):
    """Demonstrate visualization capabilities."""
    print("\n" + "=" * 60)
    print("  Visualization Demo")
    print("=" * 60)
    
    viz = PlacementVisualizer(placer)
    
    print("\n[1] Hierarchy Layers...")
    viz.plot_hierarchy_layers()
    
    print("\n[2] Placement Progression...")
    viz.plot_placement_progression()
    
    print("\n[3] Final Placement...")
    viz.plot_placement(use_legal=True, show_edges=True)
    
    print("\n[4] Wirelength Distribution...")
    viz.plot_wirelength_distribution()


def main():
    """Main entry point."""
    print("""
    ╔═══════════════════════════════════════════════════════════╗
    ║     H-Anchor: Hierarchical Anchor-Based Placement         ║
    ║     Inspired by HNSW (Hierarchical Navigable Small World) ║
    ╚═══════════════════════════════════════════════════════════╝
    
    This algorithm uses a multi-level anchor-driven approach:
    
    1. HIERARCHY CONSTRUCTION (Bottom-Up)
       - Score cells by PageRank/Degree centrality
       - Select anchors with spatial inhibition (spread out)
       - Build layers from dense (all cells) to sparse (key anchors)
    
    2. TOP-DOWN PLACEMENT
       - Place global anchors first (top layer)
       - Descend through layers, projecting new cells
       - Refine with force-directed optimization
       - Anchors have higher "mass" (inertia)
    
    3. LEGALIZATION
       - Snap to placement rows
       - Resolve overlaps
    """)
    
    # Parse command line arguments
    if len(sys.argv) > 1:
        example = sys.argv[1].lower()
        
        examples = {
            'random': example_random,
            'clustered': example_clustered,
            'mesh': example_mesh,
            'datapath': example_datapath,
            'heterogeneous': example_heterogeneous,
            'smallworld': example_small_world,
            'large': example_large_scale,
        }
        
        if example in examples:
            placer = examples[example]()
            
            if '--viz' in sys.argv or '-v' in sys.argv:
                demo_visualization(placer)
        else:
            print(f"Unknown example: {example}")
            print(f"Available: {', '.join(examples.keys())}")
            sys.exit(1)
    else:
        # Run default demo
        print("Running default demo (clustered netlist)...")
        print("Use: python example.py <example> [--viz]")
        print("Examples: random, clustered, mesh, datapath, heterogeneous, smallworld, large\n")
        
        placer = example_clustered()
        
        # Ask for visualization
        try:
            response = input("\nShow visualization? [y/N]: ").strip().lower()
            if response == 'y':
                demo_visualization(placer)
        except (EOFError, KeyboardInterrupt):
            pass
    
    print("\nDone!")


if __name__ == "__main__":
    main()


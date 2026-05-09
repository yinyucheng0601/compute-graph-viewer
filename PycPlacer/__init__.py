"""
H-Anchor: Hierarchical Anchor-Based Placement Algorithm

A VLSI/FPGA placement algorithm inspired by HNSW (Hierarchical Navigable Small World).

Example Usage:
    from hap import HAnchorPlacer, PlacementConfig
    from hap.benchmarks import generate_clustered_netlist
    
    graph, cells = generate_clustered_netlist()
    placer = HAnchorPlacer()
    placer.load_netlist(graph, cells)
    placer.run()
"""

from .h_anchor import (
    HAnchorPlacer,
    PlacementConfig,
    HierarchyBuilder,
    ForceDirectedEngine,
    Legalizer,
    Cell,
    ScoringMethod,
)

__version__ = "1.0.0"
__author__ = "H-Anchor Team"
__all__ = [
    "HAnchorPlacer",
    "PlacementConfig",
    "HierarchyBuilder",
    "ForceDirectedEngine",
    "Legalizer",
    "Cell",
    "ScoringMethod",
]


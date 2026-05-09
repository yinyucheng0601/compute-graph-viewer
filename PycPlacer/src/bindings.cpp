/**
 * Python bindings for H-Anchor Core using pybind11
 */

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include "h_anchor_core.hpp"

namespace py = pybind11;

PYBIND11_MODULE(h_anchor_cpp, m) {
    m.doc() = "H-Anchor Core Algorithm - High-performance C++ implementation";
    
    // PlacementConfig
    py::class_<hanchor::PlacementConfig>(m, "PlacementConfig")
        .def(py::init<>())
        .def_readwrite("num_layers", &hanchor::PlacementConfig::num_layers)
        .def_readwrite("top_layer_size", &hanchor::PlacementConfig::top_layer_size)
        .def_readwrite("decimation_factor", &hanchor::PlacementConfig::decimation_factor)
        .def_readwrite("alpha", &hanchor::PlacementConfig::alpha)
        .def_readwrite("beta", &hanchor::PlacementConfig::beta)
        .def_readwrite("top_layer_iterations", &hanchor::PlacementConfig::top_layer_iterations)
        .def_readwrite("refinement_iterations", &hanchor::PlacementConfig::refinement_iterations)
        .def_readwrite("repulsion_strength", &hanchor::PlacementConfig::repulsion_strength)
        .def_readwrite("attraction_strength", &hanchor::PlacementConfig::attraction_strength)
        .def_readwrite("overlap_repulsion", &hanchor::PlacementConfig::overlap_repulsion)
        .def_readwrite("min_spacing", &hanchor::PlacementConfig::min_spacing)
        .def_readwrite("center_gravity", &hanchor::PlacementConfig::center_gravity)
        .def_readwrite("spread_factor", &hanchor::PlacementConfig::spread_factor)
        .def_readwrite("global_attraction", &hanchor::PlacementConfig::global_attraction)
        .def_readwrite("die_width", &hanchor::PlacementConfig::die_width)
        .def_readwrite("die_height", &hanchor::PlacementConfig::die_height)
        .def_readwrite("use_transitive_edges", &hanchor::PlacementConfig::use_transitive_edges)
        .def_readwrite("transitive_edge_hops", &hanchor::PlacementConfig::transitive_edge_hops)
        .def_readwrite("jitter_scale", &hanchor::PlacementConfig::jitter_scale)
        .def_readwrite("anchor_mass_factor", &hanchor::PlacementConfig::anchor_mass_factor);
    
    // HAnchorCore
    py::class_<hanchor::HAnchorCore>(m, "HAnchorCore")
        .def(py::init<const hanchor::PlacementConfig&>())
        .def("load_graph", &hanchor::HAnchorCore::load_graph,
             py::arg("node_names"),
             py::arg("node_widths"),
             py::arg("node_heights"),
             py::arg("edge_from"),
             py::arg("edge_to"),
             py::arg("edge_weights"))
        .def("run", &hanchor::HAnchorCore::run)
        .def("get_positions_x", &hanchor::HAnchorCore::get_positions_x)
        .def("get_positions_y", &hanchor::HAnchorCore::get_positions_y)
        .def("get_layer_sizes", &hanchor::HAnchorCore::get_layer_sizes)
        .def("get_layers", &hanchor::HAnchorCore::get_layers)
        .def("get_hpwl", &hanchor::HAnchorCore::get_hpwl)
        .def("get_node_layer", &hanchor::HAnchorCore::get_node_layer,
             py::arg("node_idx"))
        // Incremental update API
        .def("incremental_update_positions", &hanchor::HAnchorCore::incremental_update_positions,
             py::arg("node_indices"),
             py::arg("new_x"),
             py::arg("new_y"),
             py::arg("propagation_radius") = 2,
             "Update positions of nodes and propagate changes locally")
        .def("incremental_add_nodes", &hanchor::HAnchorCore::incremental_add_nodes,
             py::arg("node_names"),
             py::arg("node_widths"),
             py::arg("node_heights"),
             py::arg("edge_from"),
             py::arg("edge_to"),
             py::arg("edge_weights"),
             "Add new nodes and edges incrementally")
        .def("incremental_remove_nodes", &hanchor::HAnchorCore::incremental_remove_nodes,
             py::arg("node_indices"),
             "Remove nodes and return index mapping")
        .def("incremental_add_edges", &hanchor::HAnchorCore::incremental_add_edges,
             py::arg("edge_from"),
             py::arg("edge_to"),
             py::arg("edge_weights"),
             "Add edges between existing nodes")
        .def("incremental_remove_edges", &hanchor::HAnchorCore::incremental_remove_edges,
             py::arg("edge_from"),
             py::arg("edge_to"),
             "Remove edges from the graph");
}


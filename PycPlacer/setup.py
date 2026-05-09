"""
Build script for H-Anchor C++ extension module.

Usage:
    pip install .
    # or
    python setup.py build_ext --inplace
"""

import os
import sys
from pathlib import Path

from setuptools import setup, Extension, find_packages

# Try to use pybind11
try:
    from pybind11.setup_helpers import Pybind11Extension, build_ext
    HAS_PYBIND11 = True
except ImportError:
    from setuptools.command.build_ext import build_ext
    HAS_PYBIND11 = False
    Pybind11Extension = Extension


def get_extensions():
    """Build extension modules."""
    if not HAS_PYBIND11:
        print("Warning: pybind11 not found. C++ extension will not be built.")
        return []
    
    # Platform-specific compiler flags for OpenMP support
    if sys.platform == "darwin":
        # macOS: libomp from Homebrew
        # Install with: brew install libomp
        extra_compile_args = ["-O3", "-ffast-math", "-Xpreprocessor", "-fopenmp"]
        extra_link_args = ["-lomp"]
        # Try to find libomp from Homebrew
        import subprocess
        try:
            brew_prefix = subprocess.check_output(["brew", "--prefix", "libomp"]).decode().strip()
            extra_compile_args.extend([f"-I{brew_prefix}/include"])
            extra_link_args.extend([f"-L{brew_prefix}/lib"])
        except:
            print("Warning: libomp not found. Install with: brew install libomp")
            extra_compile_args = ["-O3", "-ffast-math"]
            extra_link_args = []
    elif sys.platform == "win32":
        extra_compile_args = ["/O2", "/openmp"]
        extra_link_args = []
    else:
        # Linux: GCC with OpenMP
        extra_compile_args = ["-O3", "-ffast-math", "-fopenmp"]
        extra_link_args = ["-fopenmp"]
    
    # Define the extension
    ext_modules = [
        Pybind11Extension(
            "h_anchor_cpp",
            sources=[
                "src/h_anchor_core.cpp",
                "src/bindings.cpp",
            ],
            include_dirs=["src"],
            cxx_std=17,
            extra_compile_args=extra_compile_args,
            extra_link_args=extra_link_args,
        ),
    ]
    
    return ext_modules


setup(
    name="h_anchor",
    version="2.0.0",
    author="H-Anchor Team",
    description="H-Anchor: Hierarchical Anchor-Based Placement Algorithm",
    long_description=open("README.md").read() if os.path.exists("README.md") else "",
    long_description_content_type="text/markdown",
    packages=find_packages(),
    ext_modules=get_extensions(),
    cmdclass={"build_ext": build_ext},
    python_requires=">=3.8",
    install_requires=[
        "networkx>=3.0",
        "numpy>=1.24.0",
        "scipy>=1.10.0",
        "matplotlib>=3.7.0",
    ],
    extras_require={
        "dev": ["pybind11>=2.11.0"],
    },
)

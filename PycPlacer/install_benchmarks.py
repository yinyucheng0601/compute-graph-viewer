#!/usr/bin/env python3
"""
Benchmark Data Installer for PycPlacer

Downloads and installs standard benchmark circuits:
- EPFL combinational benchmarks (arithmetic + random_control)
- HDL benchmarks (ISCAS89, MCNC, LGSynth91, etc.)

Usage:
    python install_benchmarks.py           # List available benchmarks
    python install_benchmarks.py --list    # List available benchmarks
    python install_benchmarks.py epfl      # Install specific benchmark suite
    python install_benchmarks.py all       # Install all benchmarks
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

# Benchmark data directory
BENCHMARK_DIR = Path(__file__).parent / "benchmarks_data"

# Benchmark sources
# NOTE: Directory structure must match blif_parser.py expectations:
#   - benchmarks_data/epfl_benchmarks/arithmetic/*.blif
#   - benchmarks_data/epfl_benchmarks/random_control/*.blif
#   - benchmarks_data/hdl_benchmarks/iwls05/iscas/blif/*.blif (ISCAS89)
#   - benchmarks_data/hdl_benchmarks/mcnc/Combinational/*.blif (MCNC)
#   - benchmarks_data/hdl_benchmarks/lgsynth91/blif/*.blif (LGSynth91)

BENCHMARKS = {
    "epfl": {
        "description": "EPFL combinational benchmarks (arithmetic + random_control)",
        "type": "git",
        "url": "https://github.com/lsils/benchmarks.git",
        "target": "epfl_benchmarks",  # Clone entire repo to epfl_benchmarks/
        # No sparse_path - we need the full repo structure (arithmetic/, random_control/)
    },
    "hdl": {
        "description": "HDL benchmarks (ISCAS89, MCNC, LGSynth91, ITC99, etc.) ★",
        "type": "git",
        "url": "https://github.com/ispras/hdl-benchmarks.git",
        "target": "hdl_benchmarks",  # Clone entire repo to hdl_benchmarks/
        # Contains: iwls05/iscas/blif/, mcnc/Combinational/, lgsynth91/blif/
    },
}


def print_banner():
    """Print welcome banner."""
    print("\n" + "=" * 60)
    print("  PycPlacer Benchmark Installer")
    print("=" * 60)


def list_benchmarks():
    """List available benchmark suites."""
    print_banner()
    print("\nAvailable benchmark suites:\n")
    
    for name, info in BENCHMARKS.items():
        target_dir = BENCHMARK_DIR / info["target"]
        status = "✓ installed" if target_dir.exists() else "  not installed"
        print(f"  {name:<12} - {info['description']}")
        print(f"               [{status}]")
    
    print("\n  Directory structure after installation:")
    print("    benchmarks_data/")
    print("      epfl_benchmarks/")
    print("        arithmetic/*.blif")
    print("        random_control/*.blif")
    print("      hdl_benchmarks/")
    print("        iwls05/iscas/blif/*.blif    (ISCAS89: s38417, s35932, etc.)")
    print("        mcnc/Combinational/*.blif   (MCNC benchmarks)")
    print("        lgsynth91/blif/*.blif       (LGSynth91 benchmarks)")
    
    print("\nUsage:")
    print("  python install_benchmarks.py <suite>    # Install specific suite")
    print("  python install_benchmarks.py all        # Install all suites")
    print("")
    
    print("After installation, run benchmarks with:")
    print("  python run_real_benchmark.py iscas89/s38417")
    print("  python run_real_benchmark.py epfl/arithmetic/adder")
    print("  python run_real_benchmark.py mcnc/alu4")
    print("")


def clone_git_repo(url: str, target: Path) -> bool:
    """Clone a git repository."""
    if target.exists():
        print(f"  {target.name} already exists, skipping...")
        return True
    
    print(f"  Cloning {url}...")
    print(f"  Target: {target}")
    
    try:
        # Full clone (shallow)
        result = subprocess.run(
            ["git", "clone", "--depth=1", url, str(target)],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            print(f"  ✗ Failed to clone: {result.stderr}")
            return False
        
        print(f"  ✓ Cloned to {target.name}")
        return True
        
    except FileNotFoundError:
        print("  ✗ Error: git is not installed")
        return False
    except Exception as e:
        print(f"  ✗ Error: {e}")
        # Cleanup on failure
        if target.exists():
            shutil.rmtree(target)
        return False


def install_benchmark(name: str) -> bool:
    """Install a specific benchmark suite."""
    if name not in BENCHMARKS:
        print(f"Unknown benchmark: {name}")
        print(f"Available: {', '.join(BENCHMARKS.keys())}")
        return False
    
    info = BENCHMARKS[name]
    print(f"\nInstalling {name}: {info['description']}")
    
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    
    target = BENCHMARK_DIR / info["target"]
    return clone_git_repo(info["url"], target)


def install_all():
    """Install all benchmark suites."""
    print_banner()
    print("\nInstalling all benchmark suites...\n")
    
    success = True
    for name in BENCHMARKS:
        if not install_benchmark(name):
            success = False
    
    return success


def count_files():
    """Count installed benchmark files."""
    if not BENCHMARK_DIR.exists():
        return 0, 0
    
    total_files = 0
    total_size = 0
    blif_count = 0
    
    for f in BENCHMARK_DIR.rglob("*"):
        if f.is_file() and not f.name.startswith("."):
            total_files += 1
            total_size += f.stat().st_size
            if f.suffix == ".blif":
                blif_count += 1
    
    return total_files, total_size, blif_count


def verify_installation():
    """Verify benchmark directories exist and have expected content."""
    print("\nVerifying installation...")
    
    checks = [
        ("EPFL arithmetic", BENCHMARK_DIR / "epfl_benchmarks" / "arithmetic"),
        ("EPFL random_control", BENCHMARK_DIR / "epfl_benchmarks" / "random_control"),
        ("ISCAS89", BENCHMARK_DIR / "hdl_benchmarks" / "iwls05" / "iscas" / "blif"),
        ("MCNC", BENCHMARK_DIR / "hdl_benchmarks" / "mcnc" / "Combinational" / "blif"),
        ("LGSynth91", BENCHMARK_DIR / "hdl_benchmarks" / "lgsynth91" / "blif"),
    ]
    
    all_ok = True
    for name, path in checks:
        if path.exists():
            blif_files = list(path.glob("*.blif"))
            print(f"  ✓ {name}: {len(blif_files)} .blif files")
        else:
            print(f"  ✗ {name}: not found ({path})")
            all_ok = False
    
    return all_ok


def main():
    if len(sys.argv) < 2:
        list_benchmarks()
        return
    
    arg = sys.argv[1].lower()
    
    if arg == "--list" or arg == "-l":
        list_benchmarks()
    elif arg == "all":
        success = install_all()
        files, size, blif_count = count_files()
        print(f"\n{'='*60}")
        print(f"  Installation {'complete' if success else 'finished with errors'}")
        print(f"  Total: {files:,} files, {size/1024/1024:.1f} MB")
        print(f"  BLIF files: {blif_count:,}")
        print(f"{'='*60}")
        
        verify_installation()
        print("")
    elif arg in BENCHMARKS:
        print_banner()
        success = install_benchmark(arg)
        if success:
            print(f"\n✓ {arg} installed successfully")
            verify_installation()
        else:
            print(f"\n✗ {arg} installation failed")
    elif arg == "--verify" or arg == "-v":
        print_banner()
        verify_installation()
    else:
        print(f"Unknown option: {arg}")
        print(f"Available benchmarks: {', '.join(BENCHMARKS.keys())}")
        print("Use 'all' to install everything, '--list' to see details")


if __name__ == "__main__":
    main()

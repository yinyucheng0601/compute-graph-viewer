cmake_minimum_required(VERSION 3.14)
project(h_anchor_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Optimization flags
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG -march=native")

# Find pybind11
find_package(pybind11 CONFIG QUIET)
if(NOT pybind11_FOUND)
    # Try to find it via Python
    execute_process(
        COMMAND ${Python_EXECUTABLE} -c "import pybind11; print(pybind11.get_cmake_dir())"
        OUTPUT_VARIABLE PYBIND11_CMAKE_DIR
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
    )
    if(PYBIND11_CMAKE_DIR)
        list(APPEND CMAKE_PREFIX_PATH ${PYBIND11_CMAKE_DIR})
        find_package(pybind11 CONFIG REQUIRED)
    else()
        # Fallback: use FetchContent
        include(FetchContent)
        FetchContent_Declare(
            pybind11
            GIT_REPOSITORY https://github.com/pybind/pybind11.git
            GIT_TAG v2.11.1
        )
        FetchContent_MakeAvailable(pybind11)
    endif()
endif()

# Find OpenMP for parallel processing
find_package(OpenMP)

# Source files
set(SOURCES
    src/h_anchor_core.cpp
    src/bindings.cpp
)

# Create Python module
pybind11_add_module(h_anchor_cpp ${SOURCES})

# Include directories
target_include_directories(h_anchor_cpp PRIVATE ${CMAKE_SOURCE_DIR}/src)

# Link OpenMP if available
if(OpenMP_CXX_FOUND)
    target_link_libraries(h_anchor_cpp PRIVATE OpenMP::OpenMP_CXX)
    target_compile_definitions(h_anchor_cpp PRIVATE USE_OPENMP)
endif()

# Install
install(TARGETS h_anchor_cpp DESTINATION .)


cmake_minimum_required(VERSION 3.16)
project(debugscope_cpp VERSION 0.1.0 LANGUAGES CXX)

add_library(debugscope_cpp STATIC debugscope.cpp)
add_library(DebugScope::cpp ALIAS debugscope_cpp)
set_target_properties(debugscope_cpp PROPERTIES EXPORT_NAME cpp)
target_include_directories(debugscope_cpp PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}> $<INSTALL_INTERFACE:include>)
target_compile_features(debugscope_cpp PUBLIC cxx_std_17)

if(WIN32)
  target_link_libraries(debugscope_cpp PUBLIC ws2_32)
endif()

option(DEBUGSCOPE_BUILD_EXAMPLE "Build the DebugScope C++ example" ON)
if(DEBUGSCOPE_BUILD_EXAMPLE)
  add_executable(debugscope_cpp_example example.cpp)
  target_link_libraries(debugscope_cpp_example PRIVATE DebugScope::cpp)
endif()

include(GNUInstallDirs)
install(TARGETS debugscope_cpp EXPORT DebugScopeCppTargets ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR})
install(FILES debugscope.hpp DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(EXPORT DebugScopeCppTargets NAMESPACE DebugScope:: DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/DebugScopeCpp)

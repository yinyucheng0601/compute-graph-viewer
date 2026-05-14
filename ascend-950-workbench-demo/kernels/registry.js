(function () {
  window.WB_KERNELS = window.WB_KERNELS || [];
  window.registerWorkbenchKernel = function registerWorkbenchKernel(kernel) {
    window.WB_KERNELS.push(kernel);
  };
})();

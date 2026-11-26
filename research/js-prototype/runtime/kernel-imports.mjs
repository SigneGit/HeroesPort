// ABI facts checked against XboxDev/nxdk's CC0 kernel declarations/export table.
// This is diagnostic metadata, not a kernel implementation.
export const kernelServices = new Map([
  [255, {
    name: 'PsCreateSystemThreadEx',
    argumentNames: ['threadHandleOut','extensionBytes','stackBytes','tlsBytes','threadIdOut','startRoutine','startContext','suspended','debuggerThread','systemRoutine'],
  }],
]);

import * as migration_20260810_180420_initial from './20260810_180420_initial';

export const migrations = [
  {
    up: migration_20260810_180420_initial.up,
    down: migration_20260810_180420_initial.down,
    name: '20260810_180420_initial'
  },
];

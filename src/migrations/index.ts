import * as migration_20260810_180420_initial from './20260810_180420_initial';
import * as migration_20261015_085252_upgrade_payload_3_90 from './20261015_085252_upgrade_payload_3_90';

export const migrations = [
  {
    up: migration_20260810_180420_initial.up,
    down: migration_20260810_180420_initial.down,
    name: '20260810_180420_initial',
  },
  {
    up: migration_20261015_085252_upgrade_payload_3_90.up,
    down: migration_20261015_085252_upgrade_payload_3_90.down,
    name: '20261015_085252_upgrade_payload_3_90'
  },
];

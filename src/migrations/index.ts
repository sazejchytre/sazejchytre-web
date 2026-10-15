import * as migration_20260810_180420_initial from './20260810_180420_initial'
import * as migration_20261015_085252_upgrade_payload_3_90 from './20261015_085252_upgrade_payload_3_90'
import * as migration_20261015_094554_step_2_billing_model from './20261015_094554_step_2_billing_model'
import * as migration_20261015_174626_step_3_carryover_fixes from './20261015_174626_step_3_carryover_fixes'

export const migrations = [
  {
    up: migration_20260810_180420_initial.up,
    down: migration_20260810_180420_initial.down,
    name: '20260810_180420_initial',
  },
  {
    up: migration_20261015_085252_upgrade_payload_3_90.up,
    down: migration_20261015_085252_upgrade_payload_3_90.down,
    name: '20261015_085252_upgrade_payload_3_90',
  },
  {
    up: migration_20261015_094554_step_2_billing_model.up,
    down: migration_20261015_094554_step_2_billing_model.down,
    name: '20261015_094554_step_2_billing_model',
  },
  {
    up: migration_20261015_174626_step_3_carryover_fixes.up,
    down: migration_20261015_174626_step_3_carryover_fixes.down,
    name: '20261015_174626_step_3_carryover_fixes',
  },
]

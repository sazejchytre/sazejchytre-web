import * as migration_20260810_180420_initial from './20260810_180420_initial';
import * as migration_20261015_085252_upgrade_payload_3_90 from './20261015_085252_upgrade_payload_3_90';
import * as migration_20261015_094554_step_2_billing_model from './20261015_094554_step_2_billing_model';
import * as migration_20261015_174626_step_3_carryover_fixes from './20261015_174626_step_3_carryover_fixes';
import * as migration_20261015_180000_create_auth_schema from './20261015_180000_create_auth_schema';
import * as migration_20261015_192555_step_3_auth_lockouts from './20261015_192555_step_3_auth_lockouts';
import * as migration_20261015_192644_step_3_lockout_integers from './20261015_192644_step_3_lockout_integers';
import * as migration_20261015_201043_step_3b_tips_model from './20261015_201043_step_3b_tips_model';
import * as migration_20261015_201500_tip_immutability_triggers from './20261015_201500_tip_immutability_triggers';
import * as migration_20261015_220849_step_4_billing from './20261015_220849_step_4_billing';
import * as migration_20261016_083730_step_5b_invoicing from './20261016_083730_step_5b_invoicing';
import * as migration_20261016_084500_credit_note_total_trigger from './20261016_084500_credit_note_total_trigger';

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
  {
    up: migration_20261015_180000_create_auth_schema.up,
    down: migration_20261015_180000_create_auth_schema.down,
    name: '20261015_180000_create_auth_schema',
  },
  {
    up: migration_20261015_192555_step_3_auth_lockouts.up,
    down: migration_20261015_192555_step_3_auth_lockouts.down,
    name: '20261015_192555_step_3_auth_lockouts',
  },
  {
    up: migration_20261015_192644_step_3_lockout_integers.up,
    down: migration_20261015_192644_step_3_lockout_integers.down,
    name: '20261015_192644_step_3_lockout_integers',
  },
  {
    up: migration_20261015_201043_step_3b_tips_model.up,
    down: migration_20261015_201043_step_3b_tips_model.down,
    name: '20261015_201043_step_3b_tips_model',
  },
  {
    up: migration_20261015_201500_tip_immutability_triggers.up,
    down: migration_20261015_201500_tip_immutability_triggers.down,
    name: '20261015_201500_tip_immutability_triggers',
  },
  {
    up: migration_20261015_220849_step_4_billing.up,
    down: migration_20261015_220849_step_4_billing.down,
    name: '20261015_220849_step_4_billing',
  },
  {
    up: migration_20261016_083730_step_5b_invoicing.up,
    down: migration_20261016_083730_step_5b_invoicing.down,
    name: '20261016_083730_step_5b_invoicing'
  },
  {
    up: migration_20261016_084500_credit_note_total_trigger.up,
    down: migration_20261016_084500_credit_note_total_trigger.down,
    name: '20261016_084500_credit_note_total_trigger',
  },
];

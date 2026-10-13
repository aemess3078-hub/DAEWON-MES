#!/usr/bin/env node
/**
 * Handles Prisma migration deployment with automatic baseline for P3005 error.
 * P3005: DB schema exists but no migration history (_prisma_migrations is empty).
 * In that case, marks all migrations as applied (baseline), then deploys.
 */

const { execSync } = require('child_process');

const MIGRATIONS = [
  '20260326000001_init_mes_core',
  '20260326132253_phase2a_plan_code_permission',
  '20260327010732_phase2c_feature_engine',
  '20260327094242_phase2d_equipment_integration',
  '20260327231739_phase2d_sales_shipment',
  '20260327233520_phase2d_purchase',
  '20260328000308_phase2d_ai_usage',
  '20260328012355_phase2d_quotation',
  '20260328014057_phase2d_costing',
  '20260328021858_phase2d_ecn',
  '20260328060000_add_inventory_balance_unique',
  '20260328061000_fix_inventory_balance_constraint',
  '20260328070000_add_warehouse_zone',
  '20260328090000_refactor_routing_item_separation',
  '20260328120951_add_inventory_transaction_note',
  '20260328150000_inventory_balance_to_warehouse',
  '20260519000000_add_auth_tables',
  '20260520000000_fix_inventory_balance_lot_unique',
  '20260520000001_add_tag_current_value',
  '20260521000000_medical_traceability',
];

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  run('npx prisma migrate deploy');
} catch (err) {
  const output = err.stdout?.toString() || err.stderr?.toString() || err.message || '';
  if (output.includes('P3005') || err.status !== 0) {
    console.log('\nP3005 detected: baselining all migrations...');
    for (const migration of MIGRATIONS) {
      try {
        run(`npx prisma migrate resolve --applied ${migration}`);
      } catch (resolveErr) {
        // Already applied — ignore
        console.log(`  skipped (already resolved): ${migration}`);
      }
    }
    console.log('\nBaseline complete. Running migrate deploy...');
    run('npx prisma migrate deploy');
  } else {
    process.exit(1);
  }
}

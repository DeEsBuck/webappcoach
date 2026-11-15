const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'dist', 'js', 'modules', 'sensorcalibration.js'),
  'utf8'
);

function createCalibration() {
  const saved = new Map();
  const localStorage = {
    getItem(key) {
      return saved.has(key) ? saved.get(key) : null;
    },
    setItem(key, value) {
      saved.set(key, value);
    },
    removeItem(key) {
      saved.delete(key);
    }
  };
  const gaitBpm = { walk: 40, trot: 100, canter: 180 };
  const samples = gait => [
    { timestamp: 1000, x: 1, y: 2, z: 3, includesGravity: true, gaitBpm: gaitBpm[gait] },
    { timestamp: 91000, x: 4, y: 5, z: 6, includesGravity: false, gaitBpm: gaitBpm[gait] }
  ];
  const mounts = { saddle: {}, rider: {}, other: {} };

  ['walk', 'trot', 'canter'].forEach(gait => {
    mounts.saddle[gait] = [{
      completedAt: 91000,
      samples: samples(gait),
      analysis: {
        bpm: gaitBpm[gait],
        signalDeviation: 1,
        intervalVariationPercent: 5
      }
    }];
  });
  ['rider', 'other'].forEach(mount => {
    mounts[mount] = { walk: [], trot: [], canter: [] };
  });

  localStorage.setItem('equi_sensor_calibration', JSON.stringify({
    version: 1,
    confirmedMounts: {},
    mounts
  }));

  const window = {
    localStorage,
    EquiCoach: {
      GaitAnalyzer: {
        normalizeMotionSamples(values) {
          return values.map(sample => ({
            ...sample,
            magnitude: Math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2)
          }));
        },
        analyzeMotionSamples(values) {
          return {
            label: 'Schritt',
            bpm: values[0].gaitBpm,
            confidence: 1,
            peakCount: 1,
            intervalVariationPercent: 5,
            signalMean: 1,
            signalDeviation: 1
          };
        }
      }
    }
  };
  vm.runInNewContext(source, { window, console });
  return window.EquiCoach.SensorCalibration;
}

test('CSV export requires confirmation and combines raw samples in one CSV', () => {
  const calibration = createCalibration();

  assert.throws(() => calibration.getCsv('saddle'), /Bestätige die Kalibrierung/);
  calibration.confirm('saddle');

  const csv = calibration.getCsv('saddle');
  const rows = csv.split('\r\n');

  assert.equal(rows[0], 'gait,sensor_mount,elapsed_ms,acceleration_x_mps2,acceleration_y_mps2,acceleration_z_mps2,includes_gravity,signal_magnitude_mps2');
  assert.equal(rows.filter(row => row.startsWith('walk,saddle,')).length, 2);
  assert.equal(rows.filter(row => row.startsWith('trot,saddle,')).length, 2);
  assert.equal(rows.filter(row => row.startsWith('canter,saddle,')).length, 2);
  assert.equal(rows.filter(row => row.startsWith('gait,')).length, 1);
});

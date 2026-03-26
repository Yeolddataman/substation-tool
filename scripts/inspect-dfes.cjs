const XLSX = require('../node_modules/xlsx');
const wb = XLSX.readFile('../manual_data/ssen-dfes-2025-results-by-licence-area-and-esav2.xlsx');

// ESA sheet
const ws = wb.Sheets['05_ESA_projections'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const [headers, ...data] = rows;

const col = (name) => headers.indexOf(name);

const techs     = new Set();
const scenarios = new Set();
const categories= new Set();
const units     = new Set();
const primaries = new Set();

data.forEach(r => {
  techs.add(r[col('Technology')]);
  scenarios.add(r[col('Scenario')]);
  categories.add(r[col('Category')]);
  units.add(r[col('Units')]);
  primaries.add(r[col('Primary_name')]);
});

console.log('Technologies:', [...techs].sort().join('\n  '));
console.log('\nScenarios:', [...scenarios]);
console.log('\nCategories:', [...categories]);
console.log('\nUnits:', [...units]);
console.log('\nTotal unique primaries:', primaries.size);
console.log('Sample primaries:', [...primaries].slice(0, 10));

// Licence area sheet
const ws2 = wb.Sheets['04_Licence_area_projections'];
const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
const [h2, ...d2] = rows2;
const techs2 = new Set(d2.map(r => r[0]));
console.log('\nLicence-level technologies:', [...techs2].sort().join(', '));

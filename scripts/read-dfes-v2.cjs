const XLSX = require('../node_modules/xlsx');
const wb = XLSX.readFile('../manual_data/ssen-dfes-2025-results-by-licence-area-and-esav2.xlsx');
console.log('Sheets:', wb.SheetNames.join(' | '));
wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`\n=== ${name} (${rows.length} rows) ===`);
  console.log('Headers:', JSON.stringify(rows[0]).slice(0, 500));
  if (rows[1]) console.log('Row1:', JSON.stringify(rows[1]).slice(0, 500));
  if (rows[2]) console.log('Row2:', JSON.stringify(rows[2]).slice(0, 500));
});

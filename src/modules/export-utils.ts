export function downloadCSV(filename: string, headers: string[], rows: any[][]) {
  var bom = '\uFEFF';
  var csvContent = bom + headers.join(',') + '\n' +
    rows.map(function(row) {
      return row.map(function(cell) {
        var str = String(cell == null ? '' : cell);
        if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\n') >= 0) {
          str = '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }).join(',');
    }).join('\n');
  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

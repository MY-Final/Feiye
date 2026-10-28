export type Alignment = "left" | "center" | "right" | null;

export interface TableModel {
  header: string[];
  rows: string[][];
  alignments: Alignment[];
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlignment(cell: string): Alignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export function parseTable(source: string): TableModel | null {
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return null;

  const header = splitRow(lines[0]);
  const delimiter = splitRow(lines[1]);
  if (!delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;

  const width = Math.max(header.length, delimiter.length);
  while (header.length < width) header.push("");

  const alignments = delimiter.map(parseAlignment);
  while (alignments.length < width) alignments.push(null);

  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line);
    while (cells.length < width) cells.push("");
    return cells.slice(0, width);
  });

  return { header, rows, alignments };
}

export function buildTableDom(model: TableModel): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "cm-wysiwyg-table";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  model.header.forEach((value, index) => {
    const cell = document.createElement("th");
    cell.textContent = value;
    const align = model.alignments[index];
    if (align) cell.style.textAlign = align;
    headRow.appendChild(cell);
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  if (model.rows.length > 0) {
    const tbody = document.createElement("tbody");
    model.rows.forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        const align = model.alignments[index];
        if (align) cell.style.textAlign = align;
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  wrapper.appendChild(table);
  return wrapper;
}

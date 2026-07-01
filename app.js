const sampleLog = `# Simulated CANopen + DS402 startup sequence for node 1
(0.000000) can0 000#0101
(0.010000) can0 701#00
(0.020000) can0 601#2B40600006000000
(0.021000) can0 581#6040600000000000
(0.030000) can0 601#2B40600007000000
(0.031000) can0 581#6040600000000000
(0.040000) can0 601#2B4060000F000000
(0.041000) can0 581#6040600000000000
(0.050000) can0 601#2F60600001000000
(0.051000) can0 581#6060600000000000
(0.060000) can0 601#4061600000000000
(0.061000) can0 581#4F61600001000000
(0.070000) can0 601#4041600000000000
(0.071000) can0 581#4B41600027000000
(0.080000) can0 181#27000100
(0.090000) can0 281#0F000100
(0.100000) can0 701#05
(0.110000) can0 081#0000000000000000
(0.120000) can0 601#2B40600080000000
(0.121000) can0 581#6040600000000000
(0.130000) can0 601#4041600000000000
(0.131000) can0 581#4B41600008000000

# A second node with heartbeat and an emergency
(0.150000) can0 702#05
(0.160000) can0 082#1000010000000000`;

const objectNames = {
  "6040:00": "Controlword",
  "6041:00": "Statusword",
  "6060:00": "Modes of operation",
  "6061:00": "Modes of operation display",
  "6064:00": "Position actual value",
  "607A:00": "Target position",
  "6081:00": "Profile velocity",
  "6077:00": "Torque actual value",
};

const modeNames = {
  "-4": "Torque profile mode",
  "-3": "Profile velocity mode",
  "-1": "Velocity mode",
  1: "Profile position mode",
  3: "Profile velocity mode",
  4: "Profile torque mode",
  6: "Homing mode",
  7: "Interpolated position mode",
  8: "Cyclic synchronous position",
  9: "Cyclic synchronous velocity",
  10: "Cyclic synchronous torque",
};

const nmtCommands = {
  0x01: "Start remote node",
  0x02: "Stop remote node",
  0x80: "Enter pre-operational",
  0x81: "Reset node",
  0x82: "Reset communication",
};

const heartbeatStates = {
  0x00: "Boot-up",
  0x04: "Stopped",
  0x05: "Operational",
  0x7f: "Pre-operational",
};

const els = {
  fileInput: document.querySelector("#fileInput"),
  sampleButton: document.querySelector("#sampleButton"),
  decodeButton: document.querySelector("#decodeButton"),
  logInput: document.querySelector("#logInput"),
  summaryGrid: document.querySelector("#summaryGrid"),
  canopenBody: document.querySelector("#canopenBody"),
  ds402Body: document.querySelector("#ds402Body"),
  rawBody: document.querySelector("#rawBody"),
  rawCount: document.querySelector("#rawCount"),
  ds402Status: document.querySelector("#ds402Status"),
  filterInput: document.querySelector("#filterInput"),
  driveCards: document.querySelector("#driveCards"),
};

let currentRows = [];

function parseLog(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => parseLine(line, index + 1))
    .filter(Boolean);
}

function parseLine(line, lineNumber) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return null;

  const candump = trimmed.match(/^\(?([\d.]+)\)?\s+(\S+)\s+([0-9A-Fa-f]{1,8})#([0-9A-Fa-f]*)/);
  if (candump) {
    return frameFromParts(lineNumber, candump[1], candump[2], candump[3], candump[4]);
  }

  const maraphon = parseMaraphonLine(trimmed, lineNumber);
  if (maraphon) return maraphon;

  const compact = trimmed.match(/^(\S+)\s+([0-9A-Fa-f]{1,8})\s+\[?(\d)\]?\s+((?:[0-9A-Fa-f]{2}\s*){0,8})/);
  if (compact) {
    return frameFromParts(lineNumber, compact[1], "can", compact[2], compact[4]);
  }

  const asc = trimmed.match(/^([\d.]+)\s+\d+\s+([0-9A-Fa-f]{1,8})x?\s+Rx\s+d\s+(\d)\s+((?:[0-9A-Fa-f]{2}\s*){0,8})/i);
  if (asc) {
    return frameFromParts(lineNumber, asc[1], "asc", asc[2], asc[4]);
  }

  const tokens = trimmed.replace(/[#,;]/g, " ").split(/\s+/);
  const idIndex = tokens.findIndex((token) => /^[0-9A-Fa-f]{2,8}$/.test(token));
  if (idIndex >= 0) {
    const bytes = tokens.slice(idIndex + 1).filter((token) => /^[0-9A-Fa-f]{2}$/.test(token));
    if (bytes.length) {
      return frameFromParts(lineNumber, tokens[0], "log", tokens[idIndex], bytes.join(""));
    }
  }

  return {
    lineNumber,
    invalid: true,
    text: trimmed,
  };
}

function parseMaraphonLine(line, lineNumber) {
  const parts = line.split(/\s+/);
  if (parts.length < 7) return null;

  const [direction, sequence, frameType, idText, dlcText, encoding] = parts;
  if (!/^(RX|TX)$/i.test(direction)) return null;
  if (!/^\d+$/.test(sequence)) return null;
  if (!/^(SFF|EFF)$/i.test(frameType)) return null;
  if (!/^[0-9A-Fa-f]{1,8}$/.test(idText)) return null;
  if (!/^\d+$/.test(dlcText)) return null;
  if (encoding.toUpperCase() !== "HEX") return null;

  const dlc = Number(dlcText);
  const byteParts = parts.slice(6, 6 + dlc);
  if (byteParts.length !== dlc || !byteParts.every((part) => /^[0-9A-Fa-f]{2}$/.test(part))) {
    return null;
  }

  const tickText = parts[6 + dlc];
  const tickSeconds = /^\d+$/.test(tickText || "") ? Number(tickText) / 1_000_000 : null;
  const id = parseInt(idText, 16);
  const idWidth = frameType.toUpperCase() === "EFF" ? 8 : 3;

  return {
    lineNumber,
    time: tickSeconds,
    channel: `${direction.toUpperCase()} ${frameType.toUpperCase()}`,
    id,
    idText: hex(id, idWidth),
    dlc,
    data: byteParts.map((part) => parseInt(part, 16)),
    format: "CAN Maraphon",
  };
}

function frameFromParts(lineNumber, time, channel, idText, dataText) {
  const data = normalizeData(dataText);
  return {
    lineNumber,
    time: Number.isFinite(Number(time)) ? Number(time) : null,
    channel,
    id: parseInt(idText, 16),
    idText: hex(parseInt(idText, 16), 3),
    dlc: data.length,
    data,
  };
}

function normalizeData(dataText) {
  const clean = dataText.replace(/[^0-9A-Fa-f]/g, "");
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.slice(i, i + 2);
    if (pair.length === 2) bytes.push(parseInt(pair, 16));
  }
  return bytes;
}

function decodeFrame(frame) {
  if (frame.invalid) {
    return {
      ...frame,
      nodeId: "",
      kind: "Parse error",
      tag: "",
      detail: `Строка ${frame.lineNumber}: не удалось распознать формат`,
    };
  }

  const id = frame.id;
  const nodeId = id & 0x7f;
  const data = frame.data;

  if (id === 0x000) {
    const command = data[0] ?? 0;
    const target = data[1] ?? 0;
    return event(frame, target || "all", "NMT", "nmt", `${nmtCommands[command] || "Unknown NMT command"} (${hex(command, 2)})`);
  }

  if (id === 0x080) return event(frame, "", "SYNC", "", "SYNC object");
  if (id >= 0x081 && id <= 0x0ff) return event(frame, nodeId, "EMCY", "emcy", decodeEmergency(data));
  if (id === 0x100) return event(frame, "", "TIME", "", "Time stamp object");
  if (id >= 0x180 && id <= 0x1ff) return event(frame, nodeId, "TPDO1", "pdo", `Transmit PDO1, ${bytesToHex(data)}`);
  if (id >= 0x200 && id <= 0x27f) return event(frame, nodeId, "RPDO1", "pdo", `Receive PDO1, ${bytesToHex(data)}`);
  if (id >= 0x280 && id <= 0x2ff) return event(frame, nodeId, "TPDO2", "pdo", `Transmit PDO2, ${bytesToHex(data)}`);
  if (id >= 0x300 && id <= 0x37f) return event(frame, nodeId, "RPDO2", "pdo", `Receive PDO2, ${bytesToHex(data)}`);
  if (id >= 0x380 && id <= 0x3ff) return event(frame, nodeId, "TPDO3", "pdo", `Transmit PDO3, ${bytesToHex(data)}`);
  if (id >= 0x400 && id <= 0x47f) return event(frame, nodeId, "RPDO3", "pdo", `Receive PDO3, ${bytesToHex(data)}`);
  if (id >= 0x480 && id <= 0x4ff) return event(frame, nodeId, "TPDO4", "pdo", `Transmit PDO4, ${bytesToHex(data)}`);
  if (id >= 0x500 && id <= 0x57f) return event(frame, nodeId, "RPDO4", "pdo", `Receive PDO4, ${bytesToHex(data)}`);
  if (id >= 0x580 && id <= 0x5ff) return decodeSdo(frame, nodeId, "Server SDO response");
  if (id >= 0x600 && id <= 0x67f) return decodeSdo(frame, nodeId, "Client SDO request");
  if (id >= 0x700 && id <= 0x77f) return event(frame, nodeId, "Heartbeat", "", heartbeatStates[data[0]] || `Unknown state ${hex(data[0] ?? 0, 2)}`);

  return event(frame, nodeId || "", "CAN", "", `Unknown CANopen mapping, ${bytesToHex(data)}`);
}

function event(frame, nodeId, kind, tag, detail, extra = {}) {
  return {
    ...frame,
    nodeId,
    kind,
    tag,
    detail,
    ...extra,
  };
}

function decodeEmergency(data) {
  if (data.length < 2) return "Emergency object";
  const code = data[0] | (data[1] << 8);
  const register = data[2] ?? 0;
  return `Emergency error ${hex(code, 4)}, register ${hex(register, 2)}, manufacturer data ${bytesToHex(data.slice(3))}`;
}

function decodeSdo(frame, nodeId, fallbackKind) {
  const data = frame.data;
  const command = data[0] ?? 0;
  const index = (data[1] ?? 0) | ((data[2] ?? 0) << 8);
  const subIndex = data[3] ?? 0;
  const key = `${hexPlain(index, 4)}:${hexPlain(subIndex, 2)}`;
  const valueBytes = data.slice(4);
  const value = unsignedLe(valueBytes);
  const objectName = objectNames[key] || `Object ${key}`;

  let transfer = fallbackKind;
  if (command === 0x40) transfer = "SDO upload request";
  if ([0x2f, 0x2b, 0x23].includes(command)) transfer = "SDO download request";
  if ([0x4f, 0x4b, 0x43].includes(command)) transfer = "SDO upload response";
  if (command === 0x60) transfer = "SDO download response";
  if (command === 0x80) transfer = "SDO abort";

  const hasObjectValue = [0x2f, 0x2b, 0x23, 0x4f, 0x4b, 0x43].includes(command);
  const detail = command === 0x60
    ? `${transfer}: ${objectName} acknowledged`
    : `${transfer}: ${objectName} = ${formatValue(key, value, valueBytes)}`;

  return event(frame, nodeId, "SDO", "sdo", detail, {
    objectKey: key,
    objectName,
    objectValue: value,
    hasObjectValue,
    transfer,
  });
}

function extractDs402(events) {
  const drives = new Map();
  const rows = [];

  for (const item of events) {
    if (item.kind !== "SDO" || !item.objectKey || !item.nodeId) continue;
    if (!objectNames[item.objectKey] || !item.hasObjectValue) continue;

    const drive = drives.get(item.nodeId) || {
      nodeId: item.nodeId,
      controlword: null,
      statusword: null,
      mode: null,
      modeDisplay: null,
    };

    let meaning = "";
    if (item.objectKey === "6040:00") {
      drive.controlword = item.objectValue;
      meaning = decodeControlword(item.objectValue);
    } else if (item.objectKey === "6041:00") {
      drive.statusword = item.objectValue;
      meaning = decodeStatusword(item.objectValue);
    } else if (item.objectKey === "6060:00") {
      drive.mode = signed8(item.objectValue);
      meaning = modeNames[drive.mode] || `Mode ${drive.mode}`;
    } else if (item.objectKey === "6061:00") {
      drive.modeDisplay = signed8(item.objectValue);
      meaning = modeNames[drive.modeDisplay] || `Mode display ${drive.modeDisplay}`;
    } else {
      meaning = "DS402 object access";
    }

    drives.set(item.nodeId, drive);
    rows.push({
      time: item.time,
      nodeId: item.nodeId,
      object: `${item.objectKey} ${item.objectName}`,
      value: formatValue(item.objectKey, item.objectValue, item.data.slice(4)),
      meaning,
    });
  }

  return {
    drives: [...drives.values()],
    rows,
  };
}

function decodeControlword(value) {
  if ((value & 0x0080) !== 0) return "Fault reset";
  const masked = value & 0x000f;
  if (masked === 0x0006) return "Shutdown";
  if (masked === 0x0007) return "Switch on";
  if (masked === 0x000f) return "Enable operation";
  if ((value & 0x0002) === 0) return "Quick stop";
  return `Controlword ${hex(value, 4)}`;
}

function decodeStatusword(value) {
  if ((value & 0x0008) !== 0) return "Fault";
  if ((value & 0x004f) === 0x0040) return "Switch on disabled";
  if ((value & 0x006f) === 0x0021) return "Ready to switch on";
  if ((value & 0x006f) === 0x0023) return "Switched on";
  if ((value & 0x006f) === 0x0027) return "Operation enabled";
  if ((value & 0x006f) === 0x0007) return "Quick stop active";
  if ((value & 0x004f) === 0x000f) return "Fault reaction active";
  return `Statusword ${hex(value, 4)}`;
}

function render(decoded) {
  currentRows = decoded;
  const valid = decoded.filter((row) => !row.invalid);
  const ds402 = extractDs402(decoded);
  renderSummary(decoded, ds402);
  renderCanopen(decoded);
  renderRaw(decoded);
  renderDs402(ds402);
}

function renderSummary(decoded, ds402) {
  const valid = decoded.filter((row) => !row.invalid);
  const nodes = new Set(valid.map((row) => row.nodeId).filter((nodeId) => Number.isInteger(nodeId) && nodeId > 0));
  const sdo = valid.filter((row) => row.kind === "SDO").length;
  const pdo = valid.filter((row) => row.tag === "pdo").length;
  els.summaryGrid.innerHTML = [
    metric(valid.length, "распознано кадров"),
    metric(nodes.size, "CANopen узлов"),
    metric(sdo, "SDO обменов"),
    metric(pdo + ds402.rows.length, "PDO/DS402 событий"),
  ].join("");
}

function metric(value, label) {
  return `<article class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></article>`;
}

function renderCanopen(rows) {
  const filter = els.filterInput.value.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const haystack = `${row.idText} ${row.nodeId} ${row.kind} ${row.detail}`.toLowerCase();
    return !filter || haystack.includes(filter);
  });
  els.canopenBody.innerHTML = filtered.length
    ? filtered.map(canopenRow).join("")
    : `<tr><td class="empty" colspan="5">Нет событий для выбранного фильтра</td></tr>`;
}

function canopenRow(row) {
  return `<tr>
    <td class="mono">${timeText(row.time)}</td>
    <td class="mono">${row.invalid ? "-" : row.idText}</td>
    <td>${escapeHtml(String(row.nodeId || ""))}</td>
    <td><span class="tag ${row.tag || ""}">${escapeHtml(row.kind)}</span></td>
    <td>${escapeHtml(row.detail)}</td>
  </tr>`;
}

function renderRaw(rows) {
  const valid = rows.filter((row) => !row.invalid);
  els.rawCount.textContent = `${valid.length} кадров`;
  els.rawBody.innerHTML = valid.length
    ? valid.map((row) => `<tr>
      <td class="mono">${timeText(row.time)}</td>
      <td>${escapeHtml(row.channel || "")}</td>
      <td class="mono">${row.idText}</td>
      <td>${row.dlc}</td>
      <td class="mono">${bytesToHex(row.data)}</td>
    </tr>`).join("")
    : `<tr><td class="empty" colspan="5">Сырых кадров пока нет</td></tr>`;
}

function renderDs402(ds402) {
  els.ds402Status.textContent = ds402.rows.length ? `${ds402.rows.length} событий` : "Нет данных";
  els.driveCards.innerHTML = ds402.drives.length
    ? ds402.drives.map(driveCard).join("")
    : `<div class="empty">DS402 объекты появятся после SDO обращений к 6040h, 6041h, 6060h или 6061h</div>`;
  els.ds402Body.innerHTML = ds402.rows.length
    ? ds402.rows.map((row) => `<tr>
      <td class="mono">${timeText(row.time)}</td>
      <td>${escapeHtml(String(row.nodeId))}</td>
      <td>${escapeHtml(row.object)}</td>
      <td class="mono">${escapeHtml(row.value)}</td>
      <td>${escapeHtml(row.meaning)}</td>
    </tr>`).join("")
    : `<tr><td class="empty" colspan="5">Нет DS402 событий</td></tr>`;
}

function driveCard(drive) {
  const state = drive.statusword == null ? "Unknown" : decodeStatusword(drive.statusword);
  const stateClass = state === "Fault" ? "state-danger" : state === "Operation enabled" ? "state-ok" : "state-warn";
  return `<article class="drive-card">
    <h3>Node ${escapeHtml(String(drive.nodeId))}</h3>
    <div class="kv"><span>State</span><strong class="${stateClass}">${escapeHtml(state)}</strong></div>
    <div class="kv"><span>Controlword</span><strong>${drive.controlword == null ? "-" : hex(drive.controlword, 4)}</strong></div>
    <div class="kv"><span>Statusword</span><strong>${drive.statusword == null ? "-" : hex(drive.statusword, 4)}</strong></div>
    <div class="kv"><span>Mode</span><strong>${escapeHtml(modeNames[drive.modeDisplay ?? drive.mode] || String(drive.modeDisplay ?? drive.mode ?? "-"))}</strong></div>
  </article>`;
}

function formatValue(key, value, bytes) {
  if (!bytes.length) return "no payload";
  if (key === "6060:00" || key === "6061:00") {
    const signed = signed8(value);
    return `${signed} (${modeNames[signed] || "unknown mode"})`;
  }
  if (key === "6040:00" || key === "6041:00") return hex(value, 4);
  return `${value} (${hex(value, Math.max(2, bytes.length * 2))})`;
}

function unsignedLe(bytes) {
  return bytes.reduce((acc, byte, index) => acc + (byte << (8 * index)), 0) >>> 0;
}

function signed8(value) {
  const byte = value & 0xff;
  return byte > 127 ? byte - 256 : byte;
}

function hex(value, width) {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(width, "0")}`;
}

function hexPlain(value, width) {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, "0");
}

function bytesToHex(bytes) {
  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function timeText(time) {
  return time == null ? "" : time.toFixed(6);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function decodeCurrentInput() {
  const rows = parseLog(els.logInput.value).map(decodeFrame);
  render(rows);
}

els.sampleButton.addEventListener("click", () => {
  els.logInput.value = sampleLog;
  decodeCurrentInput();
});

els.decodeButton.addEventListener("click", decodeCurrentInput);
els.filterInput.addEventListener("input", () => renderCanopen(currentRows));

els.fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  els.logInput.value = await file.text();
  decodeCurrentInput();
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".table-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}Panel`).classList.add("active");
  });
});

els.logInput.value = sampleLog;
decodeCurrentInput();

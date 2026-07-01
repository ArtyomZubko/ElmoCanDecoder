# Elmo CAN Decoder

Static MVP for decoding recorded CAN logs into CANopen entities and a first DS402 view.

Open `index.html` in a browser or publish the repository with GitHub Pages. No backend or build step is required.

## Current MVP

- Parses common `candump` lines, CAN Maraphon `canmon.log` records, a subset of Vector ASC style lines, and simple whitespace/CSV-like records.
- Decodes CANopen NMT, SYNC, EMCY, Heartbeat, SDO, and PDO1-PDO4 by COB-ID range.
- Keeps PDO decoding intentionally shallow: PDO1, PDO2, PDO3, PDO4 plus direction and payload bytes.
- Extracts DS402 SDO accesses for `6040h`, `6041h`, `6060h`, and `6061h`.
- Includes a simulated CANopen/DS402 log in `samples/simulated-canopen-ds402.log`.

## GitHub Pages

Use repository Pages with the source set to the default branch root. The app is fully client-side.
